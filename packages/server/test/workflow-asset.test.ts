import { mkdir } from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { TestLLM } from "@aigcfroge/ai/testing"
import { AigcForge } from "@aigcfroge/client"
import { Agent } from "@aigcfroge/core/agent"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionCompositionSnapshotTable } from "@aigcfroge/core/session/sql"
import { ProposeWorkflowAssetTool } from "@aigcfroge/core/tool/propose-workflow-asset"
import { AssetYaml } from "@aigcfroge/core/util/asset-yaml"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { WorkflowAssetService } from "@aigcfroge/core/workflow-asset-service"
import { WorkflowRunTable, WorkflowStepRunTable } from "@aigcfroge/core/workflow/sql"
import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Composition } from "@aigcfroge/schema/composition"
import {
  BaseRevision,
  Candidate,
  Info,
  InvalidEntry,
  MAX_ATTEMPTS,
  MAX_PARALLEL,
  MAX_STEPS,
  MAX_TIMEOUT_SECONDS,
  Summary,
} from "@aigcfroge/schema/workflow-asset"
import { Hash } from "@aigcfroge/util/hash"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("workflow-asset"), providerID: Provider.ID.make("test") })
const content = [
  "\uFEFF# Original review workflow",
  "kind: workflow",
  "name: review",
  "description: Review changes",
  'version: "1"',
  "triggers: [manual]",
  "extra: preserve",
  "steps:",
  "  - id: inspect",
  "    name: Inspect",
  "    agent: reviewer",
  "    next: report",
  "  - id: report",
  "    name: Report",
  "    agent: reviewer",
  "    input:",
  "      format: markdown",
  "",
].join("\r\n")
const input = Schema.decodeUnknownSync(ProposeWorkflowAssetTool.Input)({
  name: "review",
  description: "Review changes",
  content,
})
const facts = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: BaseRevision,
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})
const contextResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })
const promptResponse = Schema.Struct({ data: Schema.Struct({ id: SessionMessage.ID }) })
const listResponse = Schema.Struct({ assets: Schema.Array(Summary), invalid: Schema.Array(InvalidEntry) })
const setup = (files: readonly { relativePath: string; content: string }[] = []) =>
  AssetHttpFixture.setup({ prefix: "aigcfroge-workflow-http-", assetDirectory: ".aigcfroge/workflows", model, files })

it.live("persists Workflow proposal facts and freezes saved steps without starting a Workflow run", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true", AIGCFROGE_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const target = path.join(fixture.directory, ".aigcfroge/workflows/review.yaml")
      expect(Option.isSome(Context.getOption(fixture.local, WorkflowAsset.Service))).toBe(true)
      expect(Option.isSome(Context.getOption(fixture.local, WorkflowAssetService.Service))).toBe(true)
      const session = yield* fixture.sessions.create({
        title: "Workflow proposal",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const other = yield* fixture.sessions.create({ location: locationRefForRoute({ directory: fixture.other }) })
      yield* fixture.llm.push(
        TestLLM.tool("propose-workflow", "propose_workflow_asset", input),
        TestLLM.text("Ready for review", "review"),
      )
      const admitted = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Propose a reusable review workflow" },
          }),
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(2), "Workflow proposer did not finish", "10 seconds")
      yield* pollWithTimeout(
        SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: admitted.data.id }).pipe(
          Effect.flatMap((result) => {
            if (result.status === "failed" || result.status === "interrupted")
              return Effect.fail(new Error("Workflow proposal input " + result.status))
            return Effect.succeed(result.status === "completed" ? result : undefined)
          }),
        ),
        "Workflow proposal input did not complete",
        "10 seconds",
      )
      const messages = Schema.decodeUnknownSync(contextResponse)(
        yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
      )
      const tool = messages.data
        .flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        .find((part) => part.id === "propose-workflow" && part.name === "propose_workflow_asset")
      if (tool?.state.status === "error") throw new Error(JSON.stringify(tool.state.error))
      if (!tool || tool.state.status !== "completed") throw new Error("Completed Workflow proposal missing")
      expect(tool.state.input).toEqual(input)
      expect(Schema.decodeUnknownSync(facts)(tool.state.metadata)).toEqual({
        relativePath: "review.yaml",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      expect(Object.keys(tool.state.metadata ?? {}).toSorted()).toEqual(
        ["relativePath", "exists", "revision", "nameConflict", "pathConflict", "truncated"].toSorted(),
      )
      const candidate = Candidate.make({ ...input, relativePath: "review.yaml" })
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      yield* assertNoWorkflowExecution(fixture, 2)
      expect((yield* fixture.request("/workflow-asset", { authenticated: false })).status).toBe(401)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
          body: { candidate, overwrite: false },
          authenticated: false,
        })).status,
      ).toBe(401)
      expect(
        (yield* fixture.request(`/session/${other.id}/workflow-asset/apply`, { body: { candidate, overwrite: false } }))
          .status,
      ).toBe(409)
      const saved = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
            body: { candidate, overwrite: false },
          }),
        ),
      )
      expect(saved.content).toBe(content)
      expect(saved).toMatchObject({
        name: input.name,
        description: input.description,
        version: "1",
        triggers: ["manual"],
      })
      expect(saved.steps).toMatchObject([
        { id: "inspect", agent: "reviewer", input: {}, next: "report", failurePolicy: "abort", maxAttempts: 1 },
        { id: "report", agent: "reviewer", input: { format: "markdown" }, failurePolicy: "abort", maxAttempts: 1 },
      ])
      const bytes = Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer()))
      expect(bytes.toString("utf8")).toBe(content)
      expect(Hash.sha256(bytes)).toBe(saved.revision)
      expect(
        Schema.decodeUnknownSync(Info)(
          yield* readBody(yield* fixture.request("/workflow-asset/content?path=review.yaml")),
        ),
      ).toEqual(saved)
      expect(
        Schema.decodeUnknownSync(listResponse)(
          yield* readBody(yield* fixture.request("/workflow-asset?search=REVIEW")),
        ),
      ).toEqual({ assets: [Schema.decodeUnknownSync(Summary)(saved)], invalid: [] })
      expect(
        Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/workflow-asset?search=absent")))
          .assets,
      ).toEqual([])
      expect(
        Schema.decodeUnknownSync(listResponse)(
          yield* readBody(yield* fixture.request("/workflow-asset", { directory: fixture.other })),
        ),
      ).toEqual({ assets: [], invalid: [] })
      expect(
        (yield* fixture.request("/workflow-asset/content?path=review.yaml", { directory: fixture.other })).status,
      ).toBe(400)
      expect(yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual([])
      yield* assertNoWorkflowExecution(fixture, 2)
      yield* Effect.forEach(
        [
          { candidate, overwrite: true },
          { candidate, overwrite: false, baseRevision: saved.revision },
        ],
        (body) =>
          Effect.gen(function* () {
            expect((yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, { body })).status).toBe(409)
          }),
      )
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: saved.relativePath },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: saved.relativePath, baseRevision: saved.revision },
          authenticated: false,
        })).status,
      ).toBe(401)
      expect(
        (yield* fixture.request(`/session/${other.id}/workflow-asset/delete`, {
          body: { relativePath: saved.relativePath, baseRevision: saved.revision },
        })).status,
      ).toBe(409)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(saved.revision)

      const agentTarget = path.join(fixture.directory, ".aigcfroge/agents/pool/reviewer.md")
      const agentContent = [
        "---",
        "kind: agent",
        "name: reviewer",
        "description: Workflow reviewer",
        "config: |",
        "  mode: subagent",
        "---",
        "Review the actual changes.",
        "",
      ].join("\n")
      yield* Effect.promise(() => mkdir(path.dirname(agentTarget), { recursive: true }))
      yield* Effect.promise(() => Bun.write(agentTarget, agentContent))
      const agents = Context.get(fixture.local, AgentAsset.Service)
      yield* agents.reload()
      const composition = new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          {
            kind: "agent",
            relativePath: "pool/reviewer.md",
            revision: Composition.Revision.make(
              Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(agentTarget).arrayBuffer()))),
            ),
          },
        ],
        workflow: {
          kind: "workflow",
          relativePath: saved.relativePath,
          revision: Composition.Revision.make(saved.revision),
        },
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })
      const planned = Schema.decodeUnknownSync(Composition.Plan)(
        yield* readBody(yield* fixture.request("/custom-composition/plan", { body: composition })),
      )
      expect(planned.valid).toBe(true)
      expect(planned.diagnostics).toEqual([])
      expect(planned.workflow).toMatchObject({ relativePath: saved.relativePath, revision: saved.revision })
      expect(planned.workflow?.steps).toEqual(saved.steps)
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(Provider.ID.make("test")),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [Model.Info.default(Provider.ID.make("test"), Model.ID.make("workflow"))],
        },
      ]).pipe(Effect.provideContext(fixture.local))
      const started = Schema.decodeUnknownSync(Composition.StartResponse)(
        yield* readBody(
          yield* fixture.request("/custom-composition/start", {
            body: { composition, expectedPlanDigest: planned.digest, model: Model.Ref.parse("test/workflow") },
          }),
        ),
      )
      expect(started.session.mode).toBe("custom")
      if (started.snapshot.version !== 2) throw new Error("Expected V2 composition snapshot")
      expect(started.snapshot.data.workflow).toEqual(planned.workflow)
      expect(started.snapshot.data.executors).toMatchObject([
        {
          relativePath: "pool/reviewer.md",
          revision: composition.agents[0]?.revision,
          info: { id: "reviewer", mode: "subagent", system: "Review the actual changes." },
        },
      ])
      const snapshots = yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({ session_id: started.session.id, digest: started.snapshot.digest })
      expect(Schema.decodeUnknownSync(Composition.SnapshotDataV2)(snapshots[0]?.data)).toEqual(started.snapshot.data)
      expect((yield* fixture.sessions.get(session.id)).mode).toBe("chat")
      yield* assertNoWorkflowExecution(fixture, 2)

      const changed = Schema.decodeUnknownSync(Candidate)({
        ...candidate,
        content: content.replace('version: "1"', 'version: "2"').replace("name: Report", "name: Revised report"),
      })
      const replaced = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
            body: { candidate: changed, baseRevision: saved.revision, overwrite: true },
          }),
        ),
      )
      expect(replaced.content).toBe(changed.content)
      expect(replaced.version).toBe("2")
      expect(replaced.steps[1]?.name).toBe("Revised report")
      expect(replaced.revision).not.toBe(saved.revision)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
        replaced.revision,
      )
      const stale = Schema.decodeUnknownSync(Composition.Plan)(
        yield* readBody(yield* fixture.request("/custom-composition/plan", { body: composition })),
      )
      expect(stale.valid).toBe(false)
      expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain("workflow_stale_revision")
      expect((yield* fixture.request("/custom-composition/start", { body: { composition } })).status).toBe(422)
      expect(yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
          body: { candidate, baseRevision: saved.revision, overwrite: true },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: saved.relativePath, baseRevision: saved.revision },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: replaced.relativePath, baseRevision: replaced.revision },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect((yield* fixture.request("/workflow-asset/content?path=review.yaml")).status).toBe(400)
      expect(yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
      expect((yield* fixture.request("/custom-composition/start", { body: { composition } })).status).toBe(422)
      yield* assertNoWorkflowExecution(fixture, 2)
    }),
  ),
)

it.live("rejects Workflow identity, path, YAML, graph and size errors before writing", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([
        { relativePath: "broken.yaml", content: "invalid: [" },
        { relativePath: "wrong.yaml", content: content.replace("kind: workflow", "kind: plugin") },
      ])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const multibyte = `${content}# ${"界".repeat(34_000)}`
      expect(multibyte.length).toBeLessThan(100_000)
      expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(100_000)
      const step = { id: "inspect", name: "Inspect", agent: "reviewer" }
      const graphs = [
        [step, step],
        [{ ...step, next: "missing" }],
        [{ ...step, next: "inspect" }],
        [step, { ...step, id: "orphan" }],
        [{ ...step, maxAttempts: MAX_ATTEMPTS + 1 }],
        [{ ...step, timeoutSeconds: MAX_TIMEOUT_SECONDS + 1 }],
        Array.from({ length: MAX_STEPS + 1 }, (_, index) => ({
          ...step,
          id: `step-${index}`,
          next: index === MAX_STEPS ? "END" : `step-${index + 1}`,
        })),
        [
          { ...step, parallel: Array.from({ length: MAX_PARALLEL + 1 }, (_, index) => `child-${index}`) },
          ...Array.from({ length: MAX_PARALLEL + 1 }, (_, index) => ({ ...step, id: `child-${index}` })),
        ],
      ]
      yield* Effect.forEach(
        [
          { ...input, content: "invalid: [" },
          { ...input, content: "[]" },
          { ...input, content: content.replace("kind: workflow", "kind: plugin") },
          { ...input, name: "different" },
          { ...input, description: "Different description" },
          { ...input, name: "x".repeat(81) },
          { ...input, description: "x".repeat(301) },
          { ...input, relativePath: "../review.yaml" },
          { ...input, relativePath: ".aigcfroge/workflows/review.yaml" },
          { ...input, relativePath: "other.yaml" },
          { ...input, content: multibyte },
          ...graphs.map((steps) => ({
            ...input,
            content: AssetYaml.stringify({
              kind: "workflow",
              name: input.name,
              description: input.description,
              version: "1",
              steps,
            }),
          })),
        ],
        (candidate) =>
          Effect.gen(function* () {
            expect(
              (yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
                body: { candidate, overwrite: false },
              })).status,
            ).toBe(400)
          }),
      )
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/review.yaml")).exists(),
        ),
      ).toBe(false)
      const catalog = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/workflow-asset")))
      expect(catalog.assets).toEqual([])
      expect(catalog.invalid.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))).toEqual([
        { relativePath: "broken.yaml", errorTag: "parse_error" },
        { relativePath: "wrong.yaml", errorTag: "bad_frontmatter" },
      ])
      expect((yield* fixture.request("/workflow-asset/content?path=broken.yaml")).status).toBe(400)
      const unknown = yield* fixture.request(`/session/${Session.ID.create()}/workflow-asset/apply`, {
        body: { candidate: input, overwrite: false },
      })
      expect(unknown.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => unknown.json())),
      ).toMatchObject({ kind: "not_found", field: "sessionID" })
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: "../broken.yaml" },
        })).status,
      ).toBe(400)
      yield* assertNoWorkflowExecution(fixture)
    }),
  ),
)

it.live("reports Workflow name conflicts and rolls back the attempted HTTP write", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([{ relativePath: "other.yaml", content }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const candidate = Candidate.make({ ...input, relativePath: "review.yaml" })
      const service = Context.get(fixture.local, WorkflowAssetService.Service)
      expect(yield* service.propose(candidate)).toEqual({
        relativePath: "review.yaml",
        exists: false,
        revision: null,
        nameConflict: true,
        pathConflict: false,
      })
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(409)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/review.yaml")).exists(),
        ),
      ).toBe(false)
      expect(
        Buffer.from(
          yield* Effect.promise(() =>
            Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/other.yaml")).arrayBuffer(),
          ),
        ).toString("utf8"),
      ).toBe(content)
      const catalog = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/workflow-asset")))
      expect(catalog.assets).toMatchObject([{ name: "review", relativePath: "other.yaml" }])
      expect(catalog.invalid).toEqual([])
      yield* assertNoWorkflowExecution(fixture)
    }),
  ),
)

it.live("disables Workflow creation while keeping explicit CAS deletion available", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([{ relativePath: "review.yaml", content }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const disabled = yield* fixture.request(`/session/${session.id}/workflow-asset/apply`, {
        body: {
          candidate: { ...input, name: "second", content: content.replace("name: review\r\n", "name: second\r\n") },
          overwrite: false,
        },
      })
      expect(disabled.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => disabled.json())),
      ).toMatchObject({ kind: "disabled", message: "Workflow asset creation is not enabled" })
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/second.yaml")).exists(),
        ),
      ).toBe(false)
      const current = Schema.decodeUnknownSync(Info)(
        yield* readBody(yield* fixture.request("/workflow-asset/content?path=review.yaml")),
      )
      expect(current.content).toBe(content)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: current.relativePath },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/workflow-asset/delete`, {
          body: { relativePath: current.relativePath, baseRevision: current.revision },
        })).status,
      ).toBe(200)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/review.yaml")).exists(),
        ),
      ).toBe(false)
      yield* assertNoWorkflowExecution(fixture)
    }),
  ),
)

it.live("round-trips Workflow content, branches, defaults and nested input through the generated Promise client", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const client = AigcForge.make({
        baseUrl: "http://aigcfroge.local",
        headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
        fetch: Object.assign(
          (input: string | URL | Request, init?: RequestInit) => fixture.handler(new Request(input, init)),
          { preconnect: fetch.preconnect },
        ),
      })
      const nested = { options: { paths: ["src/a.ts", null], strict: true, limit: 2 }, labels: ["review"] }
      const source =
        "\uFEFF# Keep the original client-authored declaration\n" +
        AssetYaml.stringify({
          kind: "workflow",
          name: "review",
          description: "Review changes",
          version: "1",
          extra: { preserve: true },
          steps: [
            { id: "inspect", name: "Inspect", agent: "reviewer", branches: { ready: "report", stop: "END" } },
            { id: "report", name: "Report", agent: "reviewer", input: nested },
          ],
        })
      const saved = yield* Effect.promise(() =>
        client["workflow-asset"].apply({
          sessionID: session.id,
          directory: fixture.directory,
          candidate: { name: "review", description: "Review changes", content: source, relativePath: "review.yaml" },
          overwrite: false,
        }),
      )
      expect(saved.content).toBe(source)
      expect(saved.relativePath).toBe("review.yaml")
      expect(saved.steps).toMatchObject([
        {
          id: "inspect",
          input: {},
          branches: { ready: "report", stop: "END" },
          failurePolicy: "abort",
          maxAttempts: 1,
        },
        { id: "report", input: nested, failurePolicy: "abort", maxAttempts: 1 },
      ])
      const readback = yield* Effect.promise(() =>
        client["workflow-asset"].content({ directory: fixture.directory, path: saved.relativePath }),
      )
      expect(readback.content).toBe(source)
      expect(readback).toEqual(saved)
      const bytes = Buffer.from(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/workflows/review.yaml")).arrayBuffer(),
        ),
      )
      expect(bytes.toString("utf8")).toBe(source)
      expect(Hash.sha256(bytes)).toBe(saved.revision)
      yield* assertNoWorkflowExecution(fixture)
    }),
  ),
)

function readBody(response: Response) {
  return Effect.gen(function* () {
    if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
    expect(response.status).toBe(200)
    return yield* Effect.promise<unknown>(() => response.json())
  })
}

const assertNoWorkflowExecution = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  requests = 0,
) {
  expect(yield* fixture.database.db.select().from(WorkflowRunTable).all()).toEqual([])
  expect(yield* fixture.database.db.select().from(WorkflowStepRunTable).all()).toEqual([])
  expect(yield* fixture.llm.requests()).toHaveLength(requests)
})
