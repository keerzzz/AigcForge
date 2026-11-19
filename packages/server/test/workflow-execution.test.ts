import path from "node:path"
import { expect } from "bun:test"
import { AigcForge } from "@aigcfroge/client"
import { LanguageModel, LLMClient } from "../../ai/src"
import { OpenAIChat } from "../../ai/src/protocols"
import { TestLLM } from "../../ai/src/testing"
import { Database } from "@aigcfroge/core/database/database"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowRunTable, WorkflowStepRunTable } from "@aigcfroge/core/workflow/sql"
import { AssetYaml } from "@aigcfroge/core/util/asset-yaml"
import { Composition } from "@aigcfroge/schema/composition"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Hash } from "@aigcfroge/util/hash"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, it, pollWithTimeout } from "../../core/test/lib/effect"
import { withCustomMode } from "../../core/test/lib/product-mode"
import { createRoutes } from "../src/routes"

const setup = Effect.fnUntraced(function* (steps: readonly WorkflowAsset.StepDef[]) {
  const directory = (yield* tmpdirScoped("aigcfroge-workflow-http-")).path
  const agent = "---\nkind: agent\nname: coder\ndescription: Workflow executor\n---\nExecute the supplied JSON input.\n"
  const workflow = AssetYaml.stringify({
    kind: "workflow",
    name: "http",
    description: "HTTP workflow",
    version: "1",
    steps,
  })
  yield* Effect.promise(() => Bun.write(path.join(directory, ".aigcfroge/agents/coder.md"), agent))
  yield* Effect.promise(() => Bun.write(path.join(directory, ".aigcfroge/workflows/http.yaml"), workflow))
  const llm = Context.get(yield* Layer.build(TestLLM.testLayer()), TestLLM.Test)
  const context = yield* Layer.build(
    createRoutes(
      {
        password: "secret",
        database: { path: ":memory:" },
        events: { persist: true },
        config: { directory: path.join(directory, "config"), project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      () => [],
      [
        LayerNodePlatform.llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, {
            resolve: () =>
              Effect.succeed(
                SessionRunnerModel.resolved(
                  LanguageModel.make({ id: "workflow", provider: "test", route: OpenAIChat.route }),
                  {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    cost: [],
                    limit: { context: 200_000, output: 32_000 },
                  },
                ),
              ),
          }),
        ),
      ],
    ).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const request = (
    route: string,
    input: { body?: unknown; directory?: string; authenticated?: boolean; workspace?: string } = {},
  ) =>
    Effect.promise(() => {
      const url = new URL(route, "http://aigcfroge.local")
      url.searchParams.set("directory", input.directory ?? directory)
      if (input.workspace !== undefined) url.searchParams.set("workspace", input.workspace)
      return handler(
        new Request(url, {
          method: input.body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            ...(input.authenticated === false ? {} : { authorization: `Basic ${btoa("aigcfroge:secret")}` }),
          },
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
        }),
      )
    })
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  const local = yield* Context.get(context, LocationServiceMap.Service).contextEffect(location)
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(Provider.ID.make("test")),
        activation: "enabled",
        package: "@aigcfroge/ai/providers/openai/responses",
      }),
      models: [Model.Info.default(Provider.ID.make("test"), Model.ID.make("workflow"))],
    },
  ]).pipe(Effect.provideContext(local))
  const client = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })
  const api = client["session-instance"].session.instance.session.workflow
  const sessions = Context.get(context, Session.Service)
  const created = yield* sessions.createCustom({
    location,
    model: Model.Ref.parse("test/workflow"),
    composition: new Composition.TemporaryInput({
      source: "temporary",
      agents: [
        new Composition.AgentRef({
          kind: "agent",
          relativePath: "coder.md",
          revision: Composition.Revision.make(Hash.sha256(Buffer.from(agent))),
        }),
      ],
      workflow: new Composition.WorkflowRef({
        kind: "workflow",
        relativePath: "http.yaml",
        revision: Composition.Revision.make(Hash.sha256(Buffer.from(workflow))),
      }),
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    }),
  })
  const runs = Context.get(context, WorkflowRun.Service)
  const execution = Context.get(context, WorkflowExecution.Service)
  const current = () => runs.getBySession(created.session.id)
  const terminal = () =>
    pollWithTimeout(
      current().pipe(
        Effect.map((run) =>
          run && ["completed", "partial_success", "failed", "cancelled", "recovery_required"].includes(run.status)
            ? run
            : undefined,
        ),
      ),
      "HTTP workflow did not settle",
      "10 seconds",
    )
  return {
    context,
    request,
    api,
    events: client.event,
    directory,
    location,
    llm,
    sessions,
    created,
    runs,
    execution,
    current,
    terminal,
  }
})

const state = Effect.fnUntraced(function* (context: Context.Context<Database.Service>) {
  const db = Context.get(context, Database.Service).db
  return {
    runs: yield* db.select().from(WorkflowRunTable).all().pipe(Effect.orDie),
    steps: yield* db.select().from(WorkflowStepRunTable).all().pipe(Effect.orDie),
    sessions: yield* db.select().from(SessionTable).all().pipe(Effect.orDie),
    inbox: yield* db.select().from(SessionInboxTable).all().pipe(Effect.orDie),
    messages: yield* db.select().from(SessionMessageTable).all().pipe(Effect.orDie),
  }
})

const first = new WorkflowAsset.StepDef({
  id: "first",
  name: "First",
  agent: "coder",
  input: { prompt: "Review the work" },
  next: "END",
})

it.live("rejects invalid admission before persistent work and enforces HTTP ownership and authentication", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const test = yield* setup([first])
      const sessionID = test.created.session.id
      const route = `/session/${sessionID}/workflow/run`
      const body = { requestID: "admit", expectedSnapshotDigest: test.created.snapshot.digest }
      const ordinary = yield* test.sessions.create({ location: test.location })
      const before = yield* state(test.context)
      expect((yield* test.request(route, { body, authenticated: false })).status).toBe(401)
      expect((yield* test.request(route, { body, directory: `${test.directory}/other` })).status).toBe(404)
      expect((yield* test.request(`/session/${Session.ID.create()}/workflow/run`, { body })).status).toBe(404)
      expect((yield* test.request(`/session/${ordinary.id}/workflow/run`, { body })).status).toBe(400)
      expect((yield* test.request(route, { body: { ...body, expectedSnapshotDigest: "b".repeat(64) } })).status).toBe(
        409,
      )
      expect((yield* withCustomMode("false", test.request(route, { body }))).status).toBe(400)
      expect(yield* state(test.context)).toEqual(before)
    }),
  ),
)

it.live("admits through the generated client, settles actual child results and preserves exact terminal retries", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const test = yield* setup([first])
      yield* test.llm.push(TestLLM.text("Child complete", "child"), TestLLM.text("Root complete", "root"))
      const input = {
        sessionID: test.created.session.id,
        directory: test.directory,
        requestID: "once",
        expectedSnapshotDigest: test.created.snapshot.digest,
      }
      const response = yield* test.request(`/session/${input.sessionID}/workflow/run`, { body: input })
      expect(response.status).toBe(202)
      const admitted = Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse))(
        yield* Effect.promise(() => response.json()),
      )
      expect(admitted.run).toBeDefined()
      const settled = yield* test.terminal()
      expect(settled.status).toBe("completed")
      yield* awaitWithTimeout(test.llm.wait(2), "Root handoff was not executed", "10 seconds")
      yield* test.sessions.wait(test.created.session.id)
      const result = yield* Effect.promise(() =>
        test.api.get({ sessionID: input.sessionID, directory: test.directory }),
      )
      expect(result.run?.id).toBe(admitted.run?.id)
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0]).toMatchObject({ status: "completed", attempt: 1 })
      const childID = result.steps[0].childSessionId
      expect(childID).toBeDefined()
      if (childID === undefined) return yield* Effect.die(new Error("Missing workflow child"))
      const child = yield* test.sessions.get(Session.ID.make(childID))
      expect(child).toMatchObject({ parentID: input.sessionID, mode: "custom" })
      expect(
        (yield* test.sessions.messages({ sessionID: child.id })).filter((message) => message.type === "user"),
      ).toHaveLength(1)
      const before = yield* state(test.context)
      const retried = yield* Effect.promise(() => test.api.run(input))
      expect(retried.run?.id).toBe(settled.id)
      expect(yield* state(test.context)).toEqual(before)
    }),
  ),
)

it.live(
  "uses run and step CAS for cancellation, then admits an immutable retry lineage through the generated client",
  () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const test = yield* setup([new WorkflowAsset.StepDef({ ...first, failurePolicy: "retry", maxAttempts: 3 })])
        yield* test.llm.push(TestLLM.hangAfter())
        const input = {
          sessionID: test.created.session.id,
          directory: test.directory,
          requestID: "cancel",
          expectedSnapshotDigest: test.created.snapshot.digest,
        }
        const admitted = yield* Effect.promise(() => test.api.run(input))
        if (admitted.run === undefined) return yield* Effect.die(new Error("Run missing"))
        yield* awaitWithTimeout(test.llm.wait(1), "Workflow child did not start", "10 seconds")
        const run = yield* test.runs.get(WorkflowAsset.WorkflowRunID.make(admitted.run.id))
        const step = (yield* test.runs.getSteps(run.id))[0]
        if (step === undefined) return yield* Effect.die(new Error("Step missing"))
        const route = `/session/${input.sessionID}/workflow/${run.id}/step/${step.id}/cancel`
        const other = yield* test.sessions.create({ location: test.location })
        const before = yield* state(test.context)
        expect(
          (yield* test.request(`/session/${input.sessionID}/workflow/run`, {
            body: { requestID: "different", expectedSnapshotDigest: input.expectedSnapshotDigest },
          })).status,
        ).toBe(409)
        expect(
          (yield* test.request(route, {
            body: { expectedRunRevision: run.revision + 1, expectedStepRevision: step.revision },
          })).status,
        ).toBe(409)
        expect(
          (yield* test.request(route, {
            body: { expectedRunRevision: run.revision, expectedStepRevision: step.revision + 1 },
          })).status,
        ).toBe(409)
        expect(
          (yield* test.request(`/session/${other.id}/workflow/${run.id}/step/${step.id}/cancel`, {
            body: { expectedRunRevision: run.revision, expectedStepRevision: step.revision },
          })).status,
        ).toBe(404)
        expect(yield* state(test.context)).toEqual(before)
        yield* test.llm.push(TestLLM.text("Cancelled workflow acknowledged", "cancel-root"))
        const cancelled = yield* Effect.promise(() =>
          test.api.cancelStep({
            sessionID: input.sessionID,
            directory: test.directory,
            runID: run.id,
            stepRunID: step.id,
            expectedRunRevision: run.revision,
            expectedStepRevision: step.revision,
          }),
        )
        expect(cancelled.steps.find((item) => item.id === step.id)?.status).toBe("cancelled")
        const terminal = yield* test.terminal()
        yield* test.sessions.wait(input.sessionID)
        const settledStep = (yield* test.runs.getSteps(run.id)).find((item) => item.id === step.id)
        if (settledStep === undefined) return yield* Effect.die(new Error("Cancelled step missing"))
        expect(yield* test.runs.getSteps(run.id)).toHaveLength(1)
        yield* test.llm.push(
          TestLLM.text("Retried child", "retry-child"),
          TestLLM.text("Retry acknowledged", "retry-root"),
        )
        const retry = yield* Effect.promise(() =>
          test.api.retryStep({
            sessionID: input.sessionID,
            directory: test.directory,
            runID: run.id,
            stepRunID: step.id,
            requestID: "retry",
            expectedRunRevision: terminal.revision,
            expectedStepRevision: settledStep.revision,
          }),
        )
        expect(retry.run).toMatchObject({ parentRunID: run.id, rootRunID: run.id, retryOfStepRunID: step.id })
        expect(retry.run?.id).not.toBe(run.id)
        expect((yield* test.terminal()).status).toBe("completed")
        expect(yield* test.runs.get(run.id)).toEqual(terminal)
      }),
    ),
)

it.live("cancels a run through HTTP and releases its active child before returning", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const test = yield* setup([first])
      yield* test.llm.push(TestLLM.hangAfter())
      const input = {
        sessionID: test.created.session.id,
        directory: test.directory,
        requestID: "stop-run",
        expectedSnapshotDigest: test.created.snapshot.digest,
      }
      const admitted = yield* Effect.promise(() => test.api.run(input))
      if (admitted.run === undefined) return yield* Effect.die(new Error("Run missing"))
      yield* awaitWithTimeout(test.llm.wait(1), "Workflow child did not start", "10 seconds")
      const run = yield* test.runs.get(WorkflowAsset.WorkflowRunID.make(admitted.run.id))
      const route = `/session/${input.sessionID}/workflow/${run.id}/cancel`
      const before = yield* state(test.context)
      expect((yield* test.request(route, { body: { expectedRunRevision: run.revision + 1 } })).status).toBe(409)
      expect(yield* state(test.context)).toEqual(before)
      yield* test.llm.push(TestLLM.text("Run cancellation acknowledged", "cancel-run-root"))
      const cancelled = yield* Effect.promise(() =>
        test.api.cancelRun({
          sessionID: input.sessionID,
          directory: test.directory,
          runID: run.id,
          expectedRunRevision: run.revision,
        }),
      )
      expect(cancelled.run?.status).toBe("cancelled")
      expect(cancelled.steps[0]?.status).toBe("cancelled")
      const childID = cancelled.steps[0]?.childSessionId
      if (childID === undefined) return yield* Effect.die(new Error("Cancelled child missing"))
      expect((yield* test.sessions.active).has(Session.ID.make(childID))).toBe(false)
      yield* awaitWithTimeout(test.llm.wait(2), "Cancellation handoff did not reach the root", "10 seconds")
      yield* test.sessions.wait(input.sessionID)
      expect(yield* test.runs.getSteps(run.id)).toHaveLength(1)
    }),
  ),
)

it.live("publishes Workflow invalidations through the existing authenticated SSE and generated client", () =>
  withCustomMode(
    "true",
    Effect.gen(function* () {
      const test = yield* setup([first])
      const scope = yield* Scope.Scope
      const connected = yield* Deferred.make<void>()
      const updated = yield* Deferred.make<string>()
      const completed = yield* Deferred.make<{ runID: string; revision: number }>()
      const listener = yield* Stream.fromAsyncIterable(
        test.events.subscribe(),
        (cause) => new Error("Workflow SSE failed", { cause }),
      ).pipe(
        Stream.runForEach((event) => {
          if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
          if (event.type !== "workflow.run.updated" || event.data.sessionID !== test.created.session.id)
            return Effect.void
          if (event.data.status === "completed") {
            return Deferred.succeed(completed, { runID: event.data.runID, revision: event.data.revision }).pipe(
              Effect.asVoid,
            )
          }
          return Deferred.succeed(updated, event.data.runID).pipe(Effect.asVoid)
        }),
        Effect.forkIn(scope),
      )
      yield* awaitWithTimeout(Deferred.await(connected), "Workflow SSE did not connect", "10 seconds")
      yield* test.llm.push(TestLLM.text("Child complete", "sse-child"), TestLLM.text("Root complete", "sse-root"))
      const admitted = yield* Effect.promise(() =>
        test.api.run({
          sessionID: test.created.session.id,
          directory: test.directory,
          requestID: "sse",
          expectedSnapshotDigest: test.created.snapshot.digest,
        }),
      )
      if (admitted.run === undefined) return yield* Effect.die(new Error("SSE workflow admission returned no Run"))
      expect(
        yield* awaitWithTimeout(Deferred.await(updated), "Workflow update was filtered from public SSE", "10 seconds"),
      ).toBe(admitted.run.id)
      const terminal = yield* awaitWithTimeout(
        Deferred.await(completed),
        "Workflow completion was filtered from public SSE",
        "10 seconds",
      )
      expect(terminal.runID).toBe(admitted.run.id)
      const result = yield* Effect.promise(() =>
        test.api.get({ sessionID: test.created.session.id, directory: test.directory }),
      )
      expect(result.run).toMatchObject({ id: terminal.runID, status: "completed", revision: terminal.revision })
      expect(result.steps).toMatchObject([{ status: "completed", attempt: 1 }])
      yield* awaitWithTimeout(test.llm.wait(2), "SSE workflow handoff was not executed", "10 seconds")
      yield* test.sessions.wait(test.created.session.id)
      yield* Fiber.interrupt(listener)
    }),
  ),
)
