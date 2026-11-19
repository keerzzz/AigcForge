import path from "node:path"
import { expect } from "bun:test"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { PluginAssetService } from "@aigcfroge/core/plugin-asset-service"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { ProposePluginAssetTool } from "@aigcfroge/core/tool/propose-plugin-asset"
import { BaseRevision, Candidate, Info, InvalidEntry, Summary, BridgeEntry } from "@aigcfroge/schema/plugin-asset"
import { Hash } from "@aigcfroge/util/hash"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("plugin-asset"), providerID: Provider.ID.make("test") })
const content =
  '# Original declaration\nkind: plugin\nname: review\ndescription: Review changes\nversion: "1.0.0"\nauthor:\n  name: Example\n  email: example@example.test\nsource:\n  type: mcp\n  mcp:\n    name: unconnected-review\nhooks:\n  - event: PreToolUse\n    command: "not-an-executable-review-command"\n    timeout: 10\nextra: preserve\n'
const input = Schema.decodeUnknownSync(ProposePluginAssetTool.Input)({
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
const listResponse = Schema.Struct({
  assets: Schema.Array(Summary),
  invalid: Schema.Array(InvalidEntry),
  bridged: Schema.Array(BridgeEntry),
})
const setup = (files: readonly { relativePath: string; content: string }[] = []) =>
  AssetHttpFixture.setup({ prefix: "aigcfroge-plugin-http-", assetDirectory: ".aigcfroge/plugins", model, files })

it.live("persists plugin proposal facts and round-trips original YAML with explicit CAS", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Plugin proposal",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
      })
      expect(Option.isSome(Context.getOption(fixture.local, PluginAsset.Service))).toBe(true)
      expect(Option.isSome(Context.getOption(fixture.local, PluginAssetService.Service))).toBe(true)
      yield* fixture.llm.push(
        TestLLM.tool("propose-plugin", "propose_plugin_asset", input),
        TestLLM.text("Ready", "review"),
      )
      const admitted = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Propose a plugin declaration" },
          }),
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(2), "Plugin proposer did not finish", "10 seconds")
      yield* pollWithTimeout(
        SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: admitted.data.id }).pipe(
          Effect.flatMap((result) => {
            if (result.status === "failed" || result.status === "interrupted")
              return Effect.fail(new Error("Plugin proposal input " + result.status))
            return Effect.succeed(result.status === "completed" ? result : undefined)
          }),
        ),
        "Plugin proposal input did not complete",
        "10 seconds",
      )
      const messages = Schema.decodeUnknownSync(contextResponse)(
        yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
      )
      const tool = messages.data
        .flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        .find((part) => part.id === "propose-plugin")
      if (!tool || tool.state.status !== "completed") throw new Error("Completed plugin proposal missing")
      expect(tool.state.input).toEqual(input)
      expect(Schema.decodeUnknownSync(facts)(tool.state.metadata)).toEqual({
        relativePath: "review.plugin.yaml",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      expect(Object.keys(tool.state.metadata ?? {}).toSorted()).toEqual(
        ["exists", "nameConflict", "pathConflict", "relativePath", "revision", "truncated"].toSorted(),
      )
      const candidate = Candidate.make({ ...input, relativePath: "review.plugin.yaml" })
      const target = path.join(fixture.directory, ".aigcfroge/plugins/review.plugin.yaml")
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
          body: { candidate, overwrite: false },
          authenticated: false,
        })).status,
      ).toBe(401)
      const other = yield* fixture.sessions.create({ location: locationRefForRoute({ directory: fixture.other }) })
      expect(
        (yield* fixture.request(`/session/${other.id}/plugin-asset/apply`, { body: { candidate, overwrite: false } }))
          .status,
      ).toBe(409)
      const saved = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
            body: { candidate, overwrite: false },
          }),
        ),
      )
      expect(saved.content).toBe(input.content)
      expect(saved.source).toMatchObject({ type: "mcp", mcp: { name: "unconnected-review" } })
      expect(saved.hooks).toMatchObject([
        { event: "PreToolUse", command: "not-an-executable-review-command", timeout: 10 },
      ])
      expect(yield* Effect.promise(() => Bun.file(target).text())).toBe(content)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(saved.revision)
      expect(
        Schema.decodeUnknownSync(Info)(
          yield* readBody(yield* fixture.request("/plugin-asset/content?path=review.plugin.yaml")),
        ),
      ).toEqual(saved)
      const catalog = Schema.decodeUnknownSync(listResponse)(
        yield* readBody(yield* fixture.request("/plugin-asset?search=REVIEW")),
      )
      expect(catalog).toEqual({
        assets: [Schema.decodeUnknownSync(Summary)({ ...saved, source: "mcp", toolCount: 0 })],
        invalid: [],
        bridged: [],
      })
      expect(
        Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/plugin-asset?search=absent")))
          .assets,
      ).toEqual([])
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, { body: { candidate, overwrite: true } }))
          .status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
          body: { candidate, overwrite: false, baseRevision: saved.revision },
        })).status,
      ).toBe(409)
      const changed = Schema.decodeUnknownSync(Candidate)({
        ...candidate,
        content: content.replace('"1.0.0"', '"2.0.0"'),
      })
      const replaced = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
            body: { candidate: changed, baseRevision: saved.revision, overwrite: true },
          }),
        ),
      )
      expect(replaced.content).toBe(changed.content)
      expect(replaced.version).toBe("2.0.0")
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/delete`, {
          body: { relativePath: saved.relativePath, baseRevision: saved.revision },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/delete`, {
          body: { relativePath: saved.relativePath, baseRevision: replaced.revision },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      const connections = Context.get(fixture.local, McpConnection.Service)
      expect(yield* connections.connections()).toEqual([])
      expect(yield* fixture.llm.requests()).toHaveLength(2)
    }),
  ),
)

it.live("rejects identity and target drift and reports invalid plugin files", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([{ relativePath: "broken.plugin.yaml", content: "invalid: [" }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      for (const candidate of [
        { ...input, relativePath: "other.plugin.yaml" },
        { ...input, name: "different" },
        { ...input, description: "Different" },
      ]) {
        expect(
          (yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
            body: { candidate, overwrite: false },
          })).status,
        ).toBe(400)
      }
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/plugins/review.plugin.yaml")).exists(),
        ),
      ).toBe(false)
      expect(Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/plugin-asset")))).toEqual({
        assets: [],
        invalid: [{ relativePath: "broken.plugin.yaml", errorTag: "parse_error" }],
        bridged: [],
      })
      expect((yield* fixture.request("/plugin-asset/content?path=broken.plugin.yaml")).status).toBe(400)
      expect(
        (yield* fixture.request(`/session/${Session.ID.create()}/plugin-asset/apply`, {
          body: { candidate: input, overwrite: false },
        })).status,
      ).toBe(400)
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/delete`, {
          body: { relativePath: "../broken.plugin.yaml" },
        })).status,
      ).toBe(400)
    }),
  ),
)

it.live("disabled creation leaves explicit deletion available", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([{ relativePath: "review.plugin.yaml", content }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/apply`, {
          body: { candidate: input, overwrite: true },
        })).status,
      ).toBe(400)
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/delete`, {
          body: { relativePath: "review.plugin.yaml" },
        })).status,
      ).toBe(409)
      const current = Schema.decodeUnknownSync(Info)(
        yield* readBody(yield* fixture.request("/plugin-asset/content?path=review.plugin.yaml")),
      )
      expect(
        (yield* fixture.request(`/session/${session.id}/plugin-asset/delete`, {
          body: { relativePath: current.relativePath, baseRevision: current.revision },
        })).status,
      ).toBe(200)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/plugins/review.plugin.yaml")).exists(),
        ),
      ).toBe(false)
    }),
  ),
)

function readBody(response: Response) {
  expect(response.status).toBe(200)
  return Effect.promise<unknown>(() => response.json())
}
