import path from "node:path"
import { expect } from "bun:test"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { MCPAsset } from "@omnixa/core/mcp-asset"
import { MCPAssetService } from "@omnixa/core/mcp-asset-service"
import { McpConnection } from "@omnixa/core/mcp/connection"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionMessage } from "@omnixa/core/session/message"
import { ProposeMCPAssetTool } from "@omnixa/core/tool/propose-mcp-asset"
import { InvalidRequestError } from "@omnixa/protocol/errors"
import { BaseRevision, Candidate, Info, InvalidEntry, Revision, Summary } from "@omnixa/schema/mcp-asset"
import { Hash } from "@omnixa/util/hash"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("mcp-asset"), providerID: Provider.ID.make("test") })
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
const decodeInput = Schema.decodeUnknownSync(ProposeMCPAssetTool.Input)

const setup = (files: readonly { relativePath: string; content: string }[] = []) =>
  AssetHttpFixture.setup({ prefix: "omnixa-mcp-http-", assetDirectory: ".omnixa/mcps", model, files })

it.live("persists MCP facts and round-trips the reviewed configuration without starting a process", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true", OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const marker = path.join(fixture.directory, "mcp-started.txt")
      const input = decodeInput({
        name: "review-server",
        description: "Reusable review MCP configuration",
        command: process.execPath,
        args: [path.join(import.meta.dir, "fixture/mcp-starts.cjs"), marker],
        env: { REVIEW_LABEL: 'quoted "value"\nsecond line', EMPTY: "" },
        configJson: '{\n  "transport": "stdio",\n  "enabled": false\n}\n',
      })
      const session = yield* fixture.sessions.create({
        title: "MCP proposal",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
      })
      expect(Option.isSome(Context.getOption(fixture.local, MCPAsset.Service))).toBe(true)
      expect(Option.isSome(Context.getOption(fixture.local, MCPAssetService.Service))).toBe(true)
      yield* fixture.llm.push(TestLLM.tool("propose-mcp", "propose_mcp_asset", input), TestLLM.text("Ready", "review"))
      const admitted = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, { body: { text: "Propose an MCP" } }),
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(2), "MCP proposer did not finish", "10 seconds")
      yield* pollWithTimeout(
        SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: admitted.data.id }).pipe(
          Effect.flatMap((result) => {
            if (result.status === "failed" || result.status === "interrupted")
              return Effect.fail(new Error("MCP proposal input " + result.status))
            return Effect.succeed(result.status === "completed" ? result : undefined)
          }),
        ),
        "MCP proposal input did not complete",
        "10 seconds",
      )
      const messages = Schema.decodeUnknownSync(contextResponse)(
        yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
      )
      const tool = messages.data
        .flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        .find((part) => part.id === "propose-mcp" && part.name === "propose_mcp_asset")
      if (!tool || tool.state.status !== "completed") throw new Error("Completed MCP proposal missing")
      expect(tool.state.input).toEqual(input)
      expect(Schema.decodeUnknownSync(facts)(tool.state.metadata)).toEqual({
        relativePath: "review-server.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      expect(Object.keys(tool.state.metadata ?? {}).toSorted()).toEqual(
        ["exists", "nameConflict", "pathConflict", "relativePath", "revision", "truncated"].toSorted(),
      )
      const candidate = Candidate.make({ ...input, relativePath: "review-server.md" })
      const target = path.join(fixture.directory, ".omnixa/mcps", candidate.relativePath)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
          body: { candidate, overwrite: false },
          authenticated: false,
        })).status,
      ).toBe(401)
      const other = yield* fixture.sessions.create({ location: locationRefForRoute({ directory: fixture.other }) })
      expect(
        (yield* fixture.request(`/session/${other.id}/mcp-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(409)
      const saved = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, { body: { candidate, overwrite: false } }),
        ),
      )
      expect(saved).toMatchObject({ kind: "mcp", ...candidate })
      expect(saved.revision).toBe(
        Schema.decodeUnknownSync(Revision)(
          Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer()))),
        ),
      )
      expect(
        Schema.decodeUnknownSync(Info)(
          yield* readBody(yield* fixture.request("/mcp-asset/content?path=review-server.md")),
        ),
      ).toEqual(saved)
      expect(
        Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/mcp-asset?search=REUSABLE")))
          .assets,
      ).toEqual([Schema.decodeUnknownSync(Summary)(saved)])
      expect(
        Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/mcp-asset?search=absent")))
          .assets,
      ).toEqual([])
      const connections = Context.get(fixture.local, McpConnection.Service)
      expect(yield* connections.facts()).toEqual([])
      expect(yield* connections.connections()).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      // Saving is inert. Bindings consume the saved command; environment belongs to credential resolution.
      const connected = yield* connections.connect({
        binding: {
          serverName: saved.name,
          ref: { relativePath: saved.relativePath, revision: saved.revision },
          transport: "stdio",
          command: [saved.command, ...saved.args],
        },
      })
      expect(connected.serverName).toBe(saved.name)
      expect(yield* connections.facts()).toMatchObject([
        {
          serverName: saved.name,
          ref: { relativePath: saved.relativePath, revision: saved.revision },
          health: "ready",
        },
      ])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
      const started = yield* Effect.promise(() => Bun.file(marker).text())
      yield* connections.disconnect(saved.name)
      expect(yield* connections.connections()).toEqual([])
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
          body: { candidate, overwrite: true },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
          body: { candidate, baseRevision: saved.revision, overwrite: false },
        })).status,
      ).toBe(409)
      const changed = Schema.decodeUnknownSync(Candidate)({
        ...candidate,
        args: [],
        env: { NEXT: "value" },
        configJson: "{}",
      })
      const replaced = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
            body: { candidate: changed, baseRevision: saved.revision, overwrite: true },
          }),
        ),
      )
      expect(replaced).toMatchObject(changed)
      expect(replaced.revision).not.toBe(saved.revision)
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/delete`, {
          body: { relativePath: candidate.relativePath, baseRevision: saved.revision },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/delete`, {
          body: { relativePath: candidate.relativePath, baseRevision: replaced.revision },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/mcp-asset")))).toEqual({
        assets: [],
        invalid: [],
      })
      expect(yield* connections.connections()).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe(started)
      expect(yield* fixture.llm.requests()).toHaveLength(2)
    }),
  ),
)

it.live("rejects mismatched MCP targets before writing and reports invalid inventory", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup([{ relativePath: "broken.md", content: "No frontmatter" }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const candidate = Schema.decodeUnknownSync(Candidate)({
        name: "review",
        description: "Review",
        command: "node",
        args: [],
        env: {},
        configJson: "{}",
        relativePath: "another.md",
      })
      const response = yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
        body: { candidate, overwrite: false },
      })
      expect(response.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => response.json())),
      ).toMatchObject({ kind: "invalid_candidate" })
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/mcps/review.md")).exists()),
      ).toBe(false)
      const catalogue = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/mcp-asset")))
      expect(catalogue).toEqual({ assets: [], invalid: [{ relativePath: "broken.md", errorTag: "parse_error" }] })
      expect((yield* fixture.request("/mcp-asset/content?path=broken.md")).status).toBe(400)
      expect(
        (yield* fixture.request(`/session/${Session.ID.create()}/mcp-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(400)
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/delete`, { body: { relativePath: "../broken.md" } }))
          .status,
      ).toBe(400)
      expect(yield* fixture.llm.requests()).toEqual([])
    }),
  ),
)

it.live("keeps MCP creation disabled while allowing an explicit existing asset deletion", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const content = "---\nkind: mcp\nname: review\ndescription: Review\ncommand: node\nargs: []\nenv: {}\n---\n{}"
      const fixture = yield* setup([{ relativePath: "review.md", content }])
      const session = yield* fixture.sessions.create({
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const saved = Schema.decodeUnknownSync(Info)(
        yield* readBody(yield* fixture.request("/mcp-asset/content?path=review.md")),
      )
      const candidate = Schema.decodeUnknownSync(Candidate)({ ...saved })
      const response = yield* fixture.request(`/session/${session.id}/mcp-asset/apply`, {
        body: { candidate, overwrite: false },
      })
      expect(response.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => response.json())),
      ).toMatchObject({ kind: "disabled" })
      expect(yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/mcps/review.md")).text())).toBe(
        content,
      )
      expect(
        (yield* fixture.request(`/session/${session.id}/mcp-asset/delete`, {
          body: { relativePath: saved.relativePath },
        })).status,
      ).toBe(200)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/mcps/review.md")).exists()),
      ).toBe(false)
      expect(yield* fixture.llm.requests()).toEqual([])
    }),
  ),
)

const readBody = (response: Response) =>
  Effect.gen(function* () {
    expect(response.status).toBe(200)
    return yield* Effect.promise<unknown>(() => response.json())
  })
