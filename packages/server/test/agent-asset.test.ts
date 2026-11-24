import path from "node:path"
import { expect } from "bun:test"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionMessage } from "@omnixa/core/session/message"
import { AgentAsset } from "@omnixa/core/agent-asset"
import { AgentAssetService } from "@omnixa/core/agent-asset-service"
import { ProposeAgentAssetTool } from "@omnixa/core/tool/propose-agent-asset"
import { InvalidRequestError } from "@omnixa/protocol/errors"
import {
  ApplyResult,
  BaseRevision,
  Candidate,
  Info,
  InvalidEntry,
  Name,
  Revision,
  Summary,
  Warning,
} from "@omnixa/schema/agent-asset"
import { Composition } from "@omnixa/schema/composition"
import { SessionCompositionSnapshotTable } from "@omnixa/core/session/sql"
import { Hash } from "@omnixa/util/hash"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("agent-asset"), providerID: Provider.ID.make("test") })
const facts = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: BaseRevision,
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
  warnings: Schema.Array(Warning),
})
const contextResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })
const promptResponse = Schema.Struct({ data: Schema.Struct({ id: SessionMessage.ID }) })
const listResponse = Schema.Struct({ assets: Schema.Array(Summary), invalid: Schema.Array(InvalidEntry) })
const decodeInput = Schema.decodeUnknownSync(ProposeAgentAssetTool.Input)
const input = (() => {
  const decoded = decodeInput({
    name: "review-agent",
    description: "Review code with an explicit permission declaration.",
    config:
      'mode: subagent\nsteps: 3\npermissions:\n  - action: read\n    resource: "*"\n    effect: allow\n  - action: bash\n    resource: "*"\n    effect: allow',
    source: "Review the actual source carefully.\n",
  })
  if ("configAgentID" in decoded) throw new Error("Expected a new Agent proposal fixture")
  return decoded
})()

const warnings = [
  new Warning({ code: "wildcard_allow", action: "read", resource: "*" }),
  new Warning({ code: "dangerous_allow", action: "bash", resource: "*" }),
]

const setup = (files: readonly { relativePath: string; content: string }[] = []) =>
  AssetHttpFixture.setup({
    prefix: "omnixa-agent-http-",
    assetDirectory: ".omnixa/agents",
    model,
    files,
  }).pipe(
    Effect.map((fixture) => ({
      ...fixture,
      assets: Context.getOption(fixture.local, AgentAsset.Service),
      assetService: Context.getOption(fixture.local, AgentAssetService.Service),
    })),
  )

it.live("persists Agent proposal facts and preserves HTTP warnings before freezing the saved configuration", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true", OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(model.providerID),
            activation: "enabled",
            package: "@omnixa/ai/providers/openai/responses",
          }),
          models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
        },
      ]).pipe(Effect.provideContext(fixture.local))
      const target = path.join(fixture.directory, ".omnixa/agents/review-agent.md")
      const session = yield* fixture.sessions.create({
        title: "Agent review",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const other = yield* fixture.sessions.create({
        title: "Other Agent Location",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.other }),
        agent: Agent.defaultID,
        model,
      })
      yield* fixture.llm.push(
        TestLLM.tool("propose-new", "propose_agent_asset", input),
        TestLLM.text("Ready for review", "review"),
      )
      const first = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Propose a reusable reviewer" },
          }),
          "Agent proposal prompt",
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(2), "Agent proposer did not finish", "10 seconds")
      yield* awaitInputCompletion(fixture, session.id, first.data.id, "Agent proposal input did not complete")
      const proposed = proposal(
        Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`), "Agent proposal context"),
        ).data,
        "propose-new",
      )
      expect(proposed.input).toEqual(input)
      expect(proposed.facts).toEqual({
        relativePath: "review-agent.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
        warnings,
      })
      expect(proposed.metadata).not.toHaveProperty("candidate")
      expect(proposed.metadata).not.toHaveProperty("input")
      expect(proposed.metadata).not.toHaveProperty("config")
      expect(proposed.metadata).not.toHaveProperty("source")
      expect(Option.isSome(fixture.assets)).toBe(true)
      expect(Option.isSome(fixture.assetService)).toBe(true)
      expect(Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/agent-asset")))).toEqual({
        assets: [],
        invalid: [],
      })
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      const candidate = Candidate.make({ ...input, relativePath: proposed.facts.relativePath })
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
          body: { candidate, overwrite: false },
          authenticated: false,
        })).status,
      ).toBe(401)
      expect(
        (yield* fixture.request(`/session/${other.id}/agent-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(409)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      const applied = Schema.decodeUnknownSync(ApplyResult)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
            body: { candidate, overwrite: false },
          }),
        ),
      )
      expect(applied.warnings).toEqual(warnings)
      expect(applied.asset.config).toBe(input.config)
      expect(applied.asset.source).toBe(input.source)
      expect(applied.asset.name).toBe(input.name)
      expect(applied.asset.relativePath).toBe("review-agent.md")
      expect(applied.asset.revision).toBe(
        Revision.make(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))),
      )
      expect(
        Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/agent-asset"))).assets,
      ).toContainEqual(new Summary({ ...applied.asset, mode: "subagent", hidden: false, disabled: false }))
      const readback = Schema.decodeUnknownSync(Info)(
        yield* readBody(yield* fixture.request("/agent-asset/content?path=review-agent.md")),
      )
      expect(readback).toEqual(applied.asset)
      expect(yield* fixture.llm.requests()).toHaveLength(2)
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
          body: { candidate, overwrite: true },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
          body: { candidate, baseRevision: applied.asset.revision, overwrite: false },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/delete`, {
          body: { relativePath: applied.asset.relativePath, baseRevision: "0".repeat(64) },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${other.id}/agent-asset/delete`, {
          body: { relativePath: applied.asset.relativePath, baseRevision: applied.asset.revision },
        })).status,
      ).toBe(409)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
        applied.asset.revision,
      )
      const composition = new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          {
            kind: "agent",
            relativePath: readback.relativePath,
            revision: Composition.Revision.make(readback.revision),
          },
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })
      const planned = Schema.decodeUnknownSync(Composition.Plan)(
        yield* readBody(yield* fixture.request("/custom-composition/plan", { body: composition }), "Custom plan"),
      )
      expect(planned.valid).toBe(true)
      const started = Schema.decodeUnknownSync(Composition.StartResponse)(
        yield* readBody(
          yield* fixture.request("/custom-composition/start", { body: { composition, model } }),
          "Custom start",
        ),
      )
      expect(started.session.mode).toBe("custom")
      expect(started.session.model).toEqual(model)
      if (started.snapshot.version !== 2) throw new Error("Expected V2 composition snapshot")
      expect(started.snapshot.data.executors).toMatchObject([
        {
          relativePath: readback.relativePath,
          revision: readback.revision,
          info: {
            id: input.name,
            system: input.source.trim(),
            mode: "subagent",
            steps: 3,
            permissions: [
              { action: "read", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
            ],
            originRelativePath: readback.relativePath,
            originRevision: readback.revision,
          },
        },
      ])
      const snapshots = yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({ session_id: started.session.id, digest: started.snapshot.digest })
      expect(Schema.decodeUnknownSync(Composition.SnapshotDataV2)(snapshots[0]?.data)).toEqual(started.snapshot.data)
      expect((yield* fixture.sessions.get(session.id)).mode).toBe("chat")
      expect(yield* fixture.llm.requests()).toHaveLength(2)
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/delete`, {
          body: { relativePath: applied.asset.relativePath, baseRevision: applied.asset.revision },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(yield* fixture.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
      expect((yield* fixture.request("/agent-asset/content?path=review-agent.md")).status).toBe(400)
      expect(Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/agent-asset")))).toEqual({
        assets: [],
        invalid: [],
      })
    }),
  ),
)

it.live("keeps Agent HTTP creation disabled under the existing asset flag", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Disabled Agent",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const response = yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
        body: { candidate: Candidate.make({ ...input, relativePath: "review-agent.md" }), overwrite: false },
      })
      expect(response.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => response.json())),
      ).toMatchObject({ kind: "disabled", message: "Agent asset creation is not enabled" })
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/agents/review-agent.md")).exists()),
      ).toBe(false)
    }),
  ),
)

it.live("reports Agent name conflicts and rolls the attempted HTTP write back", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const content = "---\nkind: agent\nname: review-agent\ndescription: Existing agent\n---\nExisting instructions."
      const fixture = yield* setup([{ relativePath: "other.md", content }])
      const session = yield* fixture.sessions.create({
        title: "Agent conflict",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const candidate = Candidate.make({ ...input, relativePath: "review-agent.md" })
      const service = Option.getOrThrow(fixture.assetService)
      expect(yield* service.propose(candidate)).toMatchObject({ exists: false, revision: null, nameConflict: true })
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/apply`, { body: { candidate, overwrite: false } }))
          .status,
      ).toBe(409)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/agents/review-agent.md")).exists()),
      ).toBe(false)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/agents/other.md")).text()),
      ).toBe(content)
    }),
  ),
)

it.live("reports invalid Agent files and rejects unsafe HTTP mutation targets", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([
        { relativePath: "invalid.md", content: "No frontmatter" },
        { relativePath: "wrong.md", content: "---\nkind: prompt\nname: wrong\ndescription: Wrong kind\n---\nBody" },
      ])
      const catalog = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/agent-asset")))
      expect(catalog.assets).toEqual([])
      expect(catalog.invalid.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))).toEqual([
        { relativePath: "invalid.md", errorTag: "parse_error" },
        { relativePath: "wrong.md", errorTag: "bad_frontmatter" },
      ])
      const missing = yield* fixture.request("/agent-asset/content?path=invalid.md")
      expect(missing.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => missing.json())),
      ).toMatchObject({ kind: "not_found", field: "path" })
      const session = yield* fixture.sessions.create({
        title: "Agent boundary",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const unknown = yield* fixture.request(`/session/${Session.ID.create()}/agent-asset/apply`, {
        body: { candidate: Candidate.make({ ...input, relativePath: "review-agent.md" }), overwrite: false },
      })
      expect(unknown.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => unknown.json())),
      ).toMatchObject({ kind: "not_found", field: "sessionID" })
      const unsafe = yield* fixture.request(`/session/${session.id}/agent-asset/apply`, {
        body: {
          candidate: Candidate.make({ ...input, name: Name.make("../escape"), relativePath: "escape.md" }),
          overwrite: false,
        },
      })
      expect(unsafe.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => unsafe.json())),
      ).toMatchObject({ kind: "invalid_candidate" })
      expect(
        (yield* fixture.request(`/session/${session.id}/agent-asset/delete`, {
          body: { relativePath: "../invalid.md" },
        })).status,
      ).toBe(400)
      expect(yield* fixture.llm.requests()).toEqual([])
    }),
  ),
)

function proposal(messages: readonly SessionMessage.Info[], id: string) {
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : []))
    .find((part) => part.id === id && part.name === "propose_agent_asset")
  if (tool?.state.status === "error") throw new Error(JSON.stringify(tool.state.error))
  if (!tool || tool.state.status !== "completed")
    throw new Error(`Completed proposer Tool result missing: ${tool?.state.status ?? "absent"}`)
  return {
    input: tool.state.input,
    metadata: tool.state.metadata,
    facts: Schema.decodeUnknownSync(facts)(tool.state.metadata),
  }
}

const readBody = (response: Response, request = "Agent asset HTTP request") =>
  Effect.gen(function* () {
    if (response.status !== 200)
      throw new Error(`${request} returned HTTP ${response.status}: ${yield* Effect.promise(() => response.text())}`)
    expect(response.status).toBe(200)
    return yield* Effect.promise<unknown>(() => response.json())
  })

const awaitInputCompletion = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  sessionID: Session.ID,
  inputID: SessionMessage.ID,
  message: string,
) =>
  pollWithTimeout(
    SessionInputResult.read(fixture.database.db, { sessionID, inputID }).pipe(
      Effect.flatMap((result) => {
        if (result.status === "failed" || result.status === "interrupted")
          return Effect.fail(new Error(message + ": " + result.status))
        return Effect.succeed(result.status === "completed" ? result : undefined)
      }),
    ),
    message,
    "10 seconds",
  )
