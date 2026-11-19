import path from "node:path"
import { expect } from "bun:test"
import { AigcForge } from "@aigcfroge/client"
import { Agent } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventSequenceTable } from "@aigcfroge/core/event/sql"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Location } from "@aigcfroge/core/location"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionInboxTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowRunTable, WorkflowStepRunTable } from "@aigcfroge/core/workflow/sql"
import { Composition } from "@aigcfroge/schema/composition"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { createLegacySession } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { CompositionFixture } from "../../core/test/lib/composition"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const setup = Effect.fnUntraced(function* (directory: string, filename = ":memory:") {
  const context = yield* Layer.build(
    createRoutes(
      {
        password: "secret",
        database: { path: filename },
        config: { directory: path.join(directory, "config"), project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      () => [],
      [Global.node.replace(tempGlobalLayer)],
    ).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const request = (route: string, options: { directory?: string; authenticated?: boolean } = {}) =>
    Effect.promise(() => {
      const url = new URL(route, "http://aigcfroge.local")
      url.searchParams.set("directory", options.directory ?? directory)
      return handler(
        new Request(url, {
          headers: options.authenticated === false ? {} : { authorization: `Basic ${btoa("aigcfroge:secret")}` },
        }),
      )
    })
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })["session-instance"].session.instance.session
  yield* Context.get(context, LocationServiceMap.Service).contextEffect(
    Location.Ref.make({ directory: AbsolutePath.make(directory) }),
  )
  return { context, request, api, directory }
})

const session = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof setup>>) {
  return yield* createLegacySession({
    location: Location.Ref.make({ directory: AbsolutePath.make(test.directory) }),
  }).pipe(Effect.provide(test.context))
})

const storedState = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof setup>>) {
  const db = Context.get(test.context, Database.Service).db
  return {
    inbox: yield* db.select().from(SessionInboxTable).all().pipe(Effect.orDie),
    messages: yield* db.select().from(SessionMessageTable).all().pipe(Effect.orDie),
    runs: yield* db.select().from(WorkflowRunTable).all().pipe(Effect.orDie),
    steps: yield* db.select().from(WorkflowStepRunTable).all().pipe(Effect.orDie),
    sequence: yield* db.select().from(EventSequenceTable).all().pipe(Effect.orDie),
  }
})

const workflow = new Composition.WorkflowInfo({
  relativePath: "review.yaml",
  revision: Composition.Revision.make("a".repeat(64)),
  name: "Review",
  description: "Review a result",
  steps: [
    new WorkflowAsset.StepDef({ id: "review", name: "Review", agent: "coder", next: "verify" }),
    new WorkflowAsset.StepDef({ id: "verify", name: "Verify", agent: "coder", next: "END" }),
  ],
})

it.live("reads frozen snapshots through the generated client without changing durable execution state", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-composition-status-%2F-")).path
    const test = yield* setup(directory)
    const info = yield* session(test)
    const snapshot = yield* CompositionFixture.attach(info.id, Agent.Info.empty(Agent.ID.make("coder"))).pipe(
      Effect.provide(test.context),
    )
    const before = yield* storedState(test)
    const result = yield* Effect.promise(() =>
      test.api.composition({ sessionID: info.id, directory: `${directory}/.` }),
    )
    expect(Schema.decodeUnknownSync(Composition.Snapshot)(result)).toEqual(snapshot)
    expect(yield* storedState(test)).toEqual(before)
    const legacySession = yield* session(test)
    const legacy = new Composition.SnapshotV1({
      version: 1,
      sessionID: legacySession.id,
      digest: snapshot.digest,
      createdAt: snapshot.createdAt,
      data: new Composition.SnapshotDataV1({
        agentID: "legacy",
        instructions: [],
        prompts: [],
        skills: [],
        tools: snapshot.data.tools,
      }),
    })
    yield* Context.get(test.context, SessionComposition.Service).attach(legacySession.id, legacy)
    const retained = yield* storedState(test)
    expect(
      Schema.decodeUnknownSync(Composition.Snapshot)(
        yield* Effect.promise(() => test.api.composition({ sessionID: legacySession.id, directory })),
      ),
    ).toEqual(legacy)
    expect(yield* storedState(test)).toEqual(retained)
  }),
)

it.live("maps missing and malformed snapshots and enforces Session ownership and authentication", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-composition-errors-")).path
    const test = yield* setup(directory)
    const info = yield* session(test)
    const route = `/session/${info.id}/composition`
    expect((yield* test.request(route)).status).toBe(404)
    yield* CompositionFixture.attach(info.id, Agent.Info.empty(Agent.ID.make("coder"))).pipe(
      Effect.provide(test.context),
    )
    expect((yield* test.request(route, { authenticated: false })).status).toBe(401)
    expect((yield* test.request(route, { directory: `${directory}/other` })).status).toBe(404)
    expect((yield* test.request(`/session/${Session.ID.create()}/composition`)).status).toBe(404)
    yield* Context.get(test.context, Database.Service)
      .db.run(`UPDATE session_composition_snapshot SET data = '{"sensitive":"workflow-read-private"'`)
      .pipe(Effect.orDie)
    const before = yield* storedState(test)
    const response = yield* test.request(route)
    expect(response.status).toBe(400)
    expect(JSON.stringify(yield* Effect.promise(() => response.json()))).not.toContain("workflow-read-private")
    expect(yield* storedState(test)).toEqual(before)
  }),
)

it.live("reads ready and dispatching workflow state without advancing its frontier", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-workflow-status-")).path
    const test = yield* setup(directory)
    const info = yield* session(test)
    expect(yield* Effect.promise(() => test.api.workflow.get({ sessionID: info.id, directory }))).toEqual({
      steps: [],
    })
    const runs = Context.get(test.context, WorkflowRun.Service)
    const run = yield* runs.getOrCreate({ sessionID: info.id, workflow, requestID: "read-only-status" })
    const steps = yield* runs.getSteps(run.id)
    const before = yield* storedState(test)
    const response = yield* Effect.promise(() =>
      test.api.workflow.get({ sessionID: info.id, directory: `${directory}/.` }),
    )
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse))(response)).toEqual(
      new WorkflowAsset.WorkflowStatusResponse({ run, steps }),
    )
    expect(response.run).not.toHaveProperty("parentRunID")
    expect(response.steps[0]).not.toHaveProperty("taskId")
    expect(yield* storedState(test)).toEqual(before)
    yield* runs.dispatchStep({
      stepRunID: steps[0].id,
      expectedRevision: steps[0].revision,
      childSessionID: Session.ID.create(),
    })
    const dispatched = yield* storedState(test)
    const active = yield* Effect.promise(() => test.api.workflow.get({ sessionID: info.id, directory }))
    expect(active.steps.find((step) => step.id === steps[0].id)?.status).toBe("dispatching")
    expect(yield* storedState(test)).toEqual(dispatched)
    const route = `/session/${info.id}/workflow`
    expect((yield* test.request(route, { authenticated: false })).status).toBe(401)
    expect((yield* test.request(route, { directory: `${directory}/other` })).status).toBe(404)
    expect((yield* test.request(`/session/${Session.ID.create()}/workflow`)).status).toBe(404)

    // This isolated fixture has one run; give it a distinct historical timestamp before creating the next one.
    yield* Context.get(test.context, Database.Service)
      .db.run("UPDATE workflow_run SET time_created = time_created - 1")
      .pipe(Effect.orDie)
    const failed = yield* runs.failRun(run.id)
    const failedSteps = yield* runs.getSteps(run.id)
    const latest = yield* runs.getOrCreate({ sessionID: info.id, workflow, requestID: "latest-read-only-status" })
    const other = yield* session(test)
    const historicalBefore = yield* storedState(test)
    expect((yield* Effect.promise(() => test.api.workflow.get({ sessionID: info.id, directory }))).run?.id).toBe(
      latest.id,
    )
    const historical = yield* Effect.promise(() =>
      test.api.workflow.get({ sessionID: info.id, directory, runID: run.id }),
    )
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse))(historical)).toEqual(
      new WorkflowAsset.WorkflowStatusResponse({ run: failed, steps: failedSteps }),
    )
    expect((yield* test.request(`${route}?runID=${encodeURIComponent(`${run.id}-missing`)}`)).status).toBe(404)
    const foreign = yield* test.request(`/session/${other.id}/workflow?runID=${encodeURIComponent(run.id)}`)
    expect(foreign.status).toBe(404)
    expect(JSON.stringify(yield* Effect.promise(() => foreign.json()))).not.toContain(workflow.name)
    expect(yield* storedState(test)).toEqual(historicalBefore)
  }),
)

it.live("reads persisted workflow runs and steps after an isolated database reopen", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-workflow-reopen-")).path
    const filename = path.join(directory, "workflow.db")
    const prior = yield* Effect.gen(function* () {
      const test = yield* setup(directory, filename)
      const info = yield* session(test)
      const runs = Context.get(test.context, WorkflowRun.Service)
      const run = yield* runs.getOrCreate({ sessionID: info.id, workflow, requestID: "retained-status" })
      return { sessionID: info.id, run, steps: yield* runs.getSteps(run.id) }
    }).pipe(Effect.scoped)
    const test = yield* setup(directory, filename)
    const before = yield* storedState(test)
    const response = yield* Effect.promise(() => test.api.workflow.get({ sessionID: prior.sessionID, directory }))
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse))(response)).toEqual(
      new WorkflowAsset.WorkflowStatusResponse({ run: prior.run, steps: prior.steps }),
    )
    expect(yield* storedState(test)).toEqual(before)
  }),
)
