import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { expect } from "bun:test"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { Environment } from "@aigcfroge/core/environment/index"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { Location } from "@aigcfroge/core/location"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { Command } from "@aigcfroge/core/command"
import { CommandAsset } from "@aigcfroge/core/command-asset"
import { CommandAssetService } from "@aigcfroge/core/command-asset-service"
import { ProposeCommandAssetTool } from "@aigcfroge/core/tool/propose-command-asset"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import {
  BaseRevision,
  Candidate,
  Info,
  Inspection,
  InvalidEntry,
  Revision,
  Summary,
} from "@aigcfroge/schema/command-asset"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Hash } from "@aigcfroge/util/hash"
import { Context, Deferred, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { initRepo } from "../../core/test/fixture/git"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("command-asset"), providerID: Provider.ID.make("test") })
const contextResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })
const promptResponse = Schema.Struct({ data: Schema.Struct({ id: SessionMessage.ID }) })
const listResponse = Schema.Struct({ assets: Schema.Array(Summary), invalid: Schema.Array(InvalidEntry) })
const selectedListResponse = Schema.Struct({
  assets: Schema.Array(Summary),
  invalid: Schema.Array(InvalidEntry),
  target: AssetPlacement.Target,
})
const nativeResponse = Schema.Struct({ data: Schema.Array(Command.Info) })
const decodeInput = Schema.decodeUnknownSync(ProposeCommandAssetTool.Input)
const input = decodeInput({
  name: "review-command",
  description: "Review the actual change using the user's argument.",
  invocation: "/review-command",
  args: "target",
  source: "Review $ARGUMENTS.",
})

const setup = (
  files: readonly { relativePath: string; content: string }[] = [],
  prepare?: (directory: string) => Promise<void>,
) => {
  const watchers = AssetHttpFixture.observeWatchers(reportObservation)
  return AssetHttpFixture.setup({
    prefix: "aigcfroge-command-http-",
    assetDirectory: ".aigcfroge/commands",
    model,
    files,
    prepare,
    watcher: watchers.layer,
  }).pipe(
    Effect.map((fixture) => ({
      ...fixture,
      watchers,
      assets: Context.getOption(fixture.local, CommandAsset.Service),
      assetService: Context.getOption(fixture.local, CommandAssetService.Service),
      commands: Context.get(fixture.local, Command.Service),
    })),
  )
}

it.live("persists Project Command proposal facts and keeps legacy HTTP writes and native Session consumption", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const target = path.join(fixture.directory, ".aigcfroge/commands/review-command.md")
      const session = yield* fixture.sessions.create({
        title: "Command review",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const other = yield* fixture.sessions.create({
        title: "Other Command Location",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.other }),
        agent: Agent.defaultID,
        model,
      })
      yield* fixture.llm.push(
        TestLLM.tool("propose-new", "propose_command_asset", input),
        TestLLM.text("Ready for review", "review"),
      )
      const first = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Propose the literal review Command" },
          }),
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(2), "Proposer did not finish", "10 seconds")
      yield* awaitInputCompletion(fixture, session.id, first.data.id, "Proposal input did not complete")
      const messages = Schema.decodeUnknownSync(contextResponse)(
        yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
      )
      const proposed = proposal(messages.data, "propose-new")
      expect(proposed.input).toEqual(input)
      expect(proposed.facts).toEqual({
        relativePath: "review-command.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
        target: Schema.decodeUnknownSync(AssetPlacement.Target)({
          scope: "project",
          root: path.join(fixture.directory, ".aigcfroge/commands"),
        }),
      })
      expect(proposed.metadata).toEqual({ ...Schema.encodeSync(Inspection)(proposed.facts), truncated: false })
      expect(proposed.metadata).not.toHaveProperty("candidate")
      expect(proposed.metadata).not.toHaveProperty("input")
      expect(proposed.metadata).not.toHaveProperty("source")
      expect(proposed.metadata).not.toHaveProperty("invocation")
      expect(proposed.metadata).not.toHaveProperty("args")
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      const candidate = Candidate.make({ ...input, relativePath: proposed.facts.relativePath })
      expect(Option.isSome(fixture.assets)).toBe(true)
      expect(Option.isSome(fixture.assetService)).toBe(true)
      const assets = Option.getOrThrow(fixture.assets)
      const assetService = Option.getOrThrow(fixture.assetService)
      expect(yield* assetService.propose(candidate)).toEqual({
        relativePath: "review-command.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      expect(yield* assetService.inspect({ candidate, scope: "project" })).toEqual(proposed.facts)
      const same = yield* fixture.locations.contextEffect(locationRefForRoute({ directory: fixture.directory }))
      expect(Context.get(same, CommandAsset.Service)).toBe(assets)
      expect(Context.get(same, CommandAssetService.Service)).toBe(assetService)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          authenticated: false,
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(401)
      expect(
        (yield* fixture.request(`/session/${other.id}/command-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(409)
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.other, ".aigcfroge/commands/review-command.md")).exists(),
        ),
      ).toBe(false)

      const added = yield* nativeReady(fixture, input.description)
      const appliedBody = yield* readBody(
        yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate, overwrite: false },
        }),
      )
      expect(appliedBody).not.toHaveProperty("target")
      const applied = Schema.decodeUnknownSync(Info)(appliedBody)
      yield* added
      expect(applied.relativePath).toBe(proposed.facts.relativePath)
      expect(applied.invocation).toBe(input.invocation)
      expect(applied.args).toBe(input.args)
      expect(applied.source).toBe(input.source)
      expect(Schema.is(Revision)(applied.revision)).toBe(true)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
        applied.revision,
      )
      const listedBody = yield* readBody(yield* fixture.request("/command-asset?search=REVIEW"))
      expect(listedBody).not.toHaveProperty("target")
      const listed = Schema.decodeUnknownSync(listResponse)(listedBody)
      expect(listed.assets).toContainEqual(
        Summary.make({
          kind: "command",
          name: applied.name,
          description: applied.description,
          relativePath: applied.relativePath,
          revision: applied.revision,
        }),
      )
      const contentBody = yield* readBody(
        yield* fixture.request(`/command-asset/content?path=${encodeURIComponent(applied.relativePath)}`),
      )
      expect(contentBody).not.toHaveProperty("target")
      expect(Schema.decodeUnknownSync(Info)(contentBody)).toEqual(applied)
      expect(
        Schema.decodeUnknownSync(nativeResponse)(yield* readBody(yield* fixture.request("/api/command"))).data,
      ).toContainEqual({ name: input.name, description: input.description })

      const changed = decodeInput({
        ...input,
        description: "Review the actual source after an explicit overwrite.",
        args: "",
        source: "Inspect $ARGUMENTS.",
      })
      yield* fixture.llm.push(
        TestLLM.tool("propose-existing", "propose_command_asset", changed),
        TestLLM.text("Review the overwrite", "overwrite-review"),
      )
      const second = Schema.decodeUnknownSync(promptResponse)(
        yield* readBody(
          yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Propose this revised Command" },
          }),
        ),
      )
      yield* awaitWithTimeout(fixture.llm.wait(4), "Existing proposal did not finish", "10 seconds")
      yield* awaitInputCompletion(fixture, session.id, second.data.id, "Existing proposal input did not complete")
      const existing = proposal(
        Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
        ).data,
        "propose-existing",
      )
      expect(existing.input).toEqual(changed)
      expect(existing.facts).toEqual({
        relativePath: applied.relativePath,
        exists: true,
        revision: applied.revision,
        nameConflict: false,
        pathConflict: false,
        target: proposed.facts.target,
      })
      expect(existing.metadata).toEqual({ ...Schema.encodeSync(Inspection)(existing.facts), truncated: false })
      expect(existing.metadata).not.toHaveProperty("candidate")
      expect(existing.metadata).not.toHaveProperty("input")
      expect(existing.metadata).not.toHaveProperty("source")
      expect(existing.metadata).not.toHaveProperty("invocation")
      expect(existing.metadata).not.toHaveProperty("args")
      const replacement = Candidate.make({ ...changed, relativePath: applied.relativePath })
      expect(yield* assetService.inspect({ candidate: replacement, scope: "project" })).toEqual(existing.facts)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate: replacement, overwrite: true },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate: replacement, baseRevision: applied.revision, overwrite: false },
        })).status,
      ).toBe(409)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
        applied.revision,
      )
      const rescanned = yield* nativeReady(fixture, changed.description)
      const updated = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
            body: { candidate: replacement, baseRevision: applied.revision, overwrite: true },
          }),
        ),
      )
      yield* rescanned
      expect(updated.args).toBe("")
      expect(updated.revision).not.toBe(applied.revision)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate: replacement, baseRevision: applied.revision, overwrite: true },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${other.id}/command-asset/delete`, {
          body: { relativePath: updated.relativePath, baseRevision: updated.revision },
        })).status,
      ).toBe(409)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate: { ...replacement, name: "../escape" }, overwrite: false },
        })).status,
      ).toBe(400)
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
        updated.revision,
      )

      yield* fixture.llm.push(TestLLM.text("Command used", "command-consumed"))
      expect(
        (yield* fixture.request(`/api/session/${session.id}/command`, {
          body: { name: input.name, text: "actual diff", delivery: "steer" },
        })).status,
      ).toBe(204)
      yield* awaitWithTimeout(fixture.llm.wait(5), "Command did not reach the real runner", "10 seconds")
      const consumed = yield* pollWithTimeout(
        fixture.request(`/api/session/${session.id}/context`).pipe(
          Effect.flatMap(readBody),
          Effect.map((body) =>
            Schema.decodeUnknownSync(contextResponse)(body).data.find(
              (message) => message.type === "user" && message.text === "Inspect actual diff.",
            ),
          ),
        ),
        "Command input was not durably projected",
        "10 seconds",
      )
      yield* awaitInputCompletion(fixture, session.id, consumed.id, "Command input did not complete")
      expect(
        yield* SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: consumed.id }),
      ).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: "Command used" }] } })
      const used = (yield* fixture.llm.requests())[4]
      if (!used) return yield* Effect.die(new Error("Command request missing"))
      const userText = used.messages
        .filter((message) => message.role === "user")
        .at(-1)
        ?.content.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      expect(userText).toBe("Inspect actual diff.")

      const removed = yield* nativeReady(fixture, undefined)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
          body: { relativePath: updated.relativePath, baseRevision: updated.revision },
        })).status,
      ).toBe(200)
      yield* removed
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/command-asset/content?path=${encodeURIComponent(updated.relativePath)}`)).status,
      ).toBe(400)
    }),
  ),
)

it.live(
  "persists a Project Command Inspection from a Git child without writing or migrating legacy sources",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const legacySource = "---\ndescription: Existing singular Command\n---\nKeep legacy $ARGUMENTS bytes.\n"
        const configuration = JSON.stringify({
          commands: { "from-config": { description: "Existing Config Command", template: "Keep Config $ARGUMENTS." } },
        })
        const fixture = yield* setup([], async (directory) => {
          await prepareProject(directory)
          await rm(path.join(directory, ".aigcfroge"), { recursive: true })
          const legacy = path.join(directory, "packages/first/.aigcfroge/command/from-file.md")
          await mkdir(path.dirname(legacy), { recursive: true })
          await Bun.write(legacy, legacySource)
          await Bun.write(path.join(directory, "aigcfroge.json"), configuration)
        })
        const directory = path.join(fixture.directory, "packages/first")
        const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
        yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
        const location = Context.get(local, Location.Service)
        const environment = Context.get(local, Environment.Service)
        expect(directory).toBe(location.directory)
        expect(fixture.directory).toBe(location.project.directory)
        expect(location.workspaceID).toBeUndefined()
        const absent = [
          path.join(fixture.directory, ".aigcfroge"),
          path.join(directory, ".aigcfroge/commands"),
          path.join(fixture.global.config, "commands"),
        ]
        yield* Effect.forEach(absent, (root) =>
          Effect.gen(function* () {
            expect(yield* isDirectory(environment, root)).toBe(false)
          }),
        )
        const marker = path.join(directory, ".aigcfroge/.command-asset-migration-v1")
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
        const originals = yield* Effect.forEach(
          [path.join(fixture.directory, "aigcfroge.json"), path.join(directory, ".aigcfroge/command/from-file.md")],
          (file) => Effect.promise(() => Bun.file(file).arrayBuffer()).pipe(Effect.map((bytes) => ({ file, bytes }))),
        )
        const session = yield* fixture.sessions.create({
          title: "Project Command proposal from child",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        const proposedInput = decodeInput({
          ...input,
          args: "",
          source: "\uFEFF# Review\r\n\r\nKeep `backticks`, $HOME, 中文 and $ARGUMENTS.  \r\n",
        })
        yield* fixture.llm.push(
          TestLLM.tool("project-proposal", "propose_command_asset", proposedInput),
          TestLLM.text("Review the Project Command target", "project-review"),
        )
        const admitted = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              directory,
              body: { text: "Propose this Command from the existing child Chat" },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(2), "Project Command proposer did not complete", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, admitted.data.id, "Project Command proposal did not complete")
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
        const messages = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`, { directory })),
        )
        const saved = proposal(messages.data, "project-proposal")
        expect(saved.input).toEqual(Schema.encodeSync(ProposeCommandAssetTool.Input)(proposedInput))
        expect(saved.facts).toBeInstanceOf(Inspection)
        expect(saved.facts.target).toBeInstanceOf(AssetPlacement.Target)
        expect(saved.metadata).toEqual({
          relativePath: "review-command.md",
          exists: false,
          revision: null,
          nameConflict: false,
          pathConflict: false,
          target: { scope: "project", root: path.join(fixture.directory, ".aigcfroge/commands") },
          truncated: false,
        })
        expect(saved.metadata).not.toHaveProperty("candidate")
        expect(saved.metadata).not.toHaveProperty("input")
        expect(saved.metadata).not.toHaveProperty("source")
        expect(saved.metadata).not.toHaveProperty("invocation")
        expect(saved.metadata).not.toHaveProperty("args")
        const inspection = yield* readInspection(
          yield* fixture.request(`/session/${session.id}/command-asset/inspect`, {
            directory,
            body: {
              candidate: Schema.decodeUnknownSync(Candidate)({ ...proposedInput, relativePath: "review-command.md" }),
              scope: "project",
            },
          }),
        )
        expect(saved.facts).toEqual(inspection)
        expect(saved.metadata).toEqual({ ...Schema.encodeSync(Inspection)(inspection), truncated: false })
        expect(proposal(yield* fixture.sessions.context(session.id), "project-proposal").metadata).toEqual(
          saved.metadata,
        )
        yield* Effect.forEach(absent, (root) =>
          Effect.gen(function* () {
            expect(yield* isDirectory(environment, root)).toBe(false)
          }),
        )
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
        yield* Effect.forEach(originals, (original) =>
          Effect.gen(function* () {
            expect(yield* Effect.promise(() => Bun.file(original.file).arrayBuffer())).toEqual(original.bytes)
          }),
        )
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect(yield* fixture.llm.requests()).toHaveLength(2)
      }),
    ),
  30_000,
)

it.live("keeps Command HTTP creation disabled when the existing asset flag is off", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Disabled Command",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate: Candidate.make({ ...input, relativePath: "review-command.md" }), overwrite: false },
        })).status,
      ).toBe(400)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/commands/review-command.md")).exists(),
        ),
      ).toBe(false)
    }),
  ),
)

it.live("reports Command name conflicts and rolls the attempted HTTP write back", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const content = `---\nkind: command\nname: review-command\ndescription: Existing command\ninvocation: /review-command\n---\nExisting $ARGUMENTS.`
      const fixture = yield* setup([{ relativePath: "other.md", content }])
      const session = yield* fixture.sessions.create({
        title: "Command conflict",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const candidate = Candidate.make({ ...input, relativePath: "review-command.md" })
      const service = Option.getOrThrow(fixture.assetService)
      expect(yield* service.propose(candidate)).toMatchObject({ exists: false, revision: null, nameConflict: true })
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate, overwrite: false },
        })).status,
      ).toBe(409)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".aigcfroge/commands/review-command.md")).exists(),
        ),
      ).toBe(false)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".aigcfroge/commands/other.md")).text()),
      ).toBe(content)
    }),
  ),
)

it.live("keeps legacy Command name derivation, JSON omissions and unconditional delete", () =>
  withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Legacy Command omissions",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
      })
      const candidate = Candidate.make({
        name: input.name,
        description: input.description,
        invocation: input.invocation,
        source: input.source,
        relativePath: "legacy-path-is-derived-from-name.md",
      })
      expect(yield* Option.getOrThrow(fixture.assetService).propose(candidate)).toEqual({
        relativePath: "review-command.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      const body = yield* readBody(
        yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          body: { candidate, overwrite: false },
        }),
      )
      expect(body).not.toHaveProperty("target")
      expect(body).not.toHaveProperty("args")
      const applied = Schema.decodeUnknownSync(Info)(body)
      expect(applied.relativePath).toBe("review-command.md")
      expect(applied.source).toBe(candidate.source)
      const file = path.join(fixture.directory, ".aigcfroge/commands", applied.relativePath)
      const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
      expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: "0".repeat(64) },
        })).status,
      ).toBe(409)
      expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
          body: { relativePath: applied.relativePath },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: applied.revision },
        })).status,
      ).toBe(200)
      yield* Effect.forEach(
        [
          { endpoint: "apply", body: { candidate, overwrite: false, baseRevision: null } },
          { endpoint: "delete", body: { relativePath: applied.relativePath, baseRevision: null } },
        ],
        (operation) =>
          Effect.gen(function* () {
            expect(
              (yield* fixture.request(`/session/${session.id}/command-asset/${operation.endpoint}`, {
                body: operation.body,
              })).status,
            ).toBe(400)
          }),
      )
      expect(yield* fixture.sessions.context(session.id)).toEqual([])
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  ),
)

it.live(
  "selects Command HTTP owners while keeping omitted reads at the original Session Location",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Selected Command owners",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const owners = [
          { scope: "project", root: path.join(fixture.directory, ".aigcfroge/commands") },
          { scope: "global", root: path.join(fixture.global.config, "commands") },
          { scope: "location", root: path.join(directory, ".aigcfroge/commands") },
        ] as const
        const saved = yield* Effect.forEach(owners, (owner) =>
          Effect.gen(function* () {
            const candidate = Schema.decodeUnknownSync(Candidate)({
              ...input,
              args: "",
              source: `Selected ${owner.scope} $ARGUMENTS.`,
              relativePath: "review-command.md",
            })
            const file = path.join(owner.root, candidate.relativePath)
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            const inspected = yield* readInspection(
              yield* fixture.request(`/session/${session.id}/command-asset/inspect`, {
                directory,
                body: { candidate, scope: owner.scope },
              }),
            )
            expect(inspected).toEqual({
              relativePath: candidate.relativePath,
              exists: false,
              revision: null,
              nameConflict: false,
              pathConflict: false,
              target: Schema.decodeUnknownSync(AssetPlacement.Target)(owner),
            })
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            const appliedBody = yield* readBody(
              yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
                directory,
                body: { candidate, target: inspected.target, overwrite: false },
              }),
            )
            expect(appliedBody).toMatchObject({ ...candidate, kind: "command", target: owner })
            const applied = Schema.decodeUnknownSync(Info)(appliedBody)
            const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
            expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)
            const listedBody = yield* readBody(
              yield* fixture.request(`/command-asset?scope=${owner.scope}&search=REVIEW`, { directory }),
            )
            expect(listedBody).toHaveProperty("target", owner)
            const listed = Schema.decodeUnknownSync(selectedListResponse)(listedBody)
            expect(listed.assets).toEqual([
              Summary.make({
                kind: "command",
                name: candidate.name,
                description: candidate.description,
                relativePath: candidate.relativePath,
                revision: applied.revision,
              }),
            ])
            expect(listed.invalid).toEqual([])
            expect(listed.assets[0]).not.toHaveProperty("target")
            const contentBody = yield* readBody(
              yield* fixture.request(
                `/command-asset/content?scope=${owner.scope}&path=${encodeURIComponent(candidate.relativePath)}`,
                { directory },
              ),
            )
            expect(contentBody).toHaveProperty("target", owner)
            expect(Schema.decodeUnknownSync(Info)(contentBody)).toEqual(applied)
            expect(
              yield* readInspection(
                yield* fixture.request(`/session/${session.id}/command-asset/inspect`, {
                  directory,
                  body: { candidate, scope: owner.scope },
                }),
              ),
            ).toEqual({ ...inspected, exists: true, revision: applied.revision })
            expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
            expect(
              yield* readBody(
                yield* fixture.request(`/command-asset?scope=${owner.scope}&search=unrelated`, { directory }),
              ),
            ).toEqual({ assets: [], invalid: [], target: owner })
            return applied
          }),
        )
        const legacyList = yield* readBody(yield* fixture.request("/command-asset", { directory }))
        expect(legacyList).not.toHaveProperty("target")
        expect(Schema.decodeUnknownSync(listResponse)(legacyList).assets).toHaveLength(1)
        const legacyContent = yield* readBody(
          yield* fixture.request("/command-asset/content?path=review-command.md", { directory }),
        )
        expect(legacyContent).not.toHaveProperty("target")
        expect(legacyContent).toMatchObject({ source: "Selected location $ARGUMENTS.", args: "" })
        yield* Effect.forEach(saved, (applied) =>
          Effect.gen(function* () {
            const target = applied.target
            if (!target) return yield* Effect.die(new Error("Selected Command response lost its target"))
            expect(
              (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
                directory,
                body: { relativePath: applied.relativePath, target, baseRevision: applied.revision },
              })).status,
            ).toBe(200)
            expect(yield* Effect.promise(() => Bun.file(path.join(target.root, applied.relativePath)).exists())).toBe(
              false,
            )
            expect(
              (yield* fixture.request(`/command-asset/content?scope=${target.scope}&path=review-command.md`, {
                directory,
              })).status,
            ).toBe(400)
          }),
        )
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "keeps Command inspection and mutations bound to the original authenticated Session Location",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const other = path.join(fixture.directory, "packages/second")
        const session = yield* fixture.sessions.create({
          title: "Command route owner",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const workspaceSession = yield* fixture.sessions.create({
          title: "Command workspace owner",
          mode: "chat",
          location: locationRefForRoute({ directory, workspaceID: Workspace.ID.create() }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-command.md" })
        const target = { scope: "project", root: path.join(fixture.directory, ".aigcfroge/commands") }
        yield* Effect.forEach(
          [
            { endpoint: "inspect", body: { candidate, scope: "project" } },
            { endpoint: "apply", body: { candidate, target, overwrite: false } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target } },
          ],
          (operation) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/session/${session.id}/command-asset/${operation.endpoint}`, {
                  directory,
                  authenticated: false,
                  body: operation.body,
                })).status,
              ).toBe(401)
              const misplaced = yield* fixture.request(`/session/${session.id}/command-asset/${operation.endpoint}`, {
                directory: other,
                body: operation.body,
              })
              expect(misplaced.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => misplaced.json())).toMatchObject({
                _tag: "ConflictError",
                resource: session.id,
              })
              const missingWorkspace = yield* fixture.request(
                `/session/${workspaceSession.id}/command-asset/${operation.endpoint}`,
                {
                  directory,
                  body: operation.body,
                },
              )
              expect(missingWorkspace.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => missingWorkspace.json())).toMatchObject({
                _tag: "ConflictError",
                resource: workspaceSession.id,
              })
              const directoryAsSession = yield* fixture.request(
                `/session/${encodeURIComponent(directory)}/command-asset/${operation.endpoint}`,
                {
                  directory,
                  body: operation.body,
                },
              )
              expect(directoryAsSession.status).toBe(400)
            }),
        )
        yield* Effect.forEach(
          [
            { candidate, scope: "workspace" },
            { candidate },
            { scope: "project" },
            { candidate: { name: candidate.name }, scope: "project" },
            { candidate: { ...candidate, relativePath: "../escape.md" }, scope: "project" },
            { candidate: { ...candidate, relativePath: "different.md" }, scope: "project" },
          ],
          (body) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/session/${session.id}/command-asset/inspect`, { directory, body })).status,
              ).toBe(400)
            }),
        )
        yield* Effect.forEach(
          [null, {}, { scope: "project" }, { scope: "workspace", root: target.root }],
          (invalidTarget) =>
            Effect.forEach(
              [
                { endpoint: "apply", body: { candidate, target: invalidTarget, overwrite: false } },
                { endpoint: "delete", body: { relativePath: candidate.relativePath, target: invalidTarget } },
              ],
              (operation) =>
                Effect.gen(function* () {
                  expect(
                    (yield* fixture.request(`/session/${session.id}/command-asset/${operation.endpoint}`, {
                      directory,
                      body: operation.body,
                    })).status,
                  ).toBe(400)
                }),
            ),
        )
        yield* Effect.forEach(["different.md", "../escape.md"], (relativePath) =>
          Effect.gen(function* () {
            const invalid = yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
              directory,
              body: { candidate: { ...candidate, relativePath }, target, overwrite: false },
            })
            expect(invalid.status).toBe(400)
            expect(yield* Effect.promise<unknown>(() => invalid.json())).toMatchObject({
              _tag: "InvalidRequestError",
              kind: "invalid_candidate",
            })
          }),
        )
        yield* Effect.forEach(
          [
            "/command-asset?scope=workspace",
            "/command-asset/content?scope=workspace&path=review-command.md",
            "/command-asset/content?scope=project&path=../escape.md",
            "/command-asset/content?scope=project&path=missing.md",
          ],
          (route) =>
            Effect.gen(function* () {
              expect((yield* fixture.request(route, { directory })).status).toBe(400)
            }),
        )
        expect(
          (yield* fixture.request("/command-asset?scope=project", { directory, authenticated: false })).status,
        ).toBe(401)
        expect(
          (yield* fixture.request("/command-asset/content?scope=project&path=review-command.md", {
            directory,
            authenticated: false,
          })).status,
        ).toBe(401)
        yield* Effect.forEach(
          [target.root, path.join(directory, ".aigcfroge/commands"), path.join(fixture.global.config, "commands")],
          (root) =>
            Effect.gen(function* () {
              expect(yield* Effect.promise(() => Bun.file(path.join(root, candidate.relativePath)).exists())).toBe(
                false,
              )
            }),
        )
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect((yield* fixture.sessions.get(workspaceSession.id)).location).toEqual(workspaceSession.location)
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "rejects mismatched Command target scope and root before revision comparison",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Command target mismatch",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-command.md" })
        const root = path.join(fixture.directory, ".aigcfroge/commands")
        yield* Effect.forEach(
          [
            { scope: "global", root },
            { scope: "location", root },
            { scope: "project", root: path.join(directory, ".aigcfroge/commands") },
            { scope: "project", root: path.join(fixture.other, ".aigcfroge/commands") },
            { scope: "project", root: path.join(fixture.directory, ".aigcfroge/skills") },
          ],
          (target) =>
            Effect.forEach(
              [
                { endpoint: "apply", body: { candidate, target, baseRevision: "0".repeat(64), overwrite: true } },
                {
                  endpoint: "delete",
                  body: { relativePath: candidate.relativePath, target, baseRevision: "0".repeat(64) },
                },
              ],
              (operation) =>
                Effect.gen(function* () {
                  const response = yield* fixture.request(
                    `/session/${session.id}/command-asset/${operation.endpoint}`,
                    {
                      directory,
                      body: operation.body,
                    },
                  )
                  expect(response.status).toBe(400)
                  expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                    _tag: "InvalidRequestError",
                    field: "target",
                    kind: "target_mismatch",
                  })
                }),
            ),
        )
        yield* Effect.forEach(
          [root, path.join(directory, ".aigcfroge/commands"), path.join(fixture.global.config, "commands")],
          (owner) =>
            Effect.gen(function* () {
              expect(yield* Effect.promise(() => Bun.file(path.join(owner, candidate.relativePath)).exists())).toBe(
                false,
              )
            }),
        )
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "uses strict selected Command revisions across Session Locations without changing legacy delete",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const sessions = yield* Effect.forEach(["first", "second"], (name) =>
          fixture.sessions.create({
            title: `Command CAS ${name}`,
            mode: "chat",
            location: locationRefForRoute({ directory: path.join(fixture.directory, "packages", name) }),
            agent: Agent.defaultID,
            model,
          }),
        )
        const first = sessions[0]
        const second = sessions[1]
        if (!first || !second) return yield* Effect.die(new Error("Both Command Session owners are required"))
        const target = { scope: "project", root: path.join(fixture.directory, ".aigcfroge/commands") }
        const candidate = Candidate.make({ ...input, relativePath: "review-command.md" })
        const body = yield* readBody(
          yield* fixture.request(`/session/${first.id}/command-asset/apply`, {
            directory: first.location.directory,
            body: { candidate, target, overwrite: false },
          }),
        )
        expect(body).toHaveProperty("target", target)
        const applied = Schema.decodeUnknownSync(Info)(body)
        const file = path.join(target.root, candidate.relativePath)
        const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
        expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)
        yield* Effect.forEach(
          [
            { endpoint: "apply", body: { candidate, target, overwrite: true } },
            { endpoint: "apply", body: { candidate, target, baseRevision: applied.revision, overwrite: false } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target } },
          ],
          (operation) =>
            Effect.gen(function* () {
              const response = yield* fixture.request(`/session/${second.id}/command-asset/${operation.endpoint}`, {
                directory: second.location.directory,
                body: operation.body,
              })
              expect(response.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                _tag: "ConflictError",
                resource: candidate.relativePath,
              })
            }),
        )
        expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
        const replacement = { ...candidate, args: "", source: "Replaced $ARGUMENTS." }
        const updated = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${second.id}/command-asset/apply`, {
              directory: second.location.directory,
              body: { candidate: replacement, target, baseRevision: applied.revision, overwrite: true },
            }),
          ),
        )
        expect(updated).toMatchObject({ target, source: replacement.source, args: "" })
        expect(updated.revision).not.toBe(applied.revision)
        yield* Effect.forEach(
          [
            { endpoint: "apply", body: { candidate, target, baseRevision: applied.revision, overwrite: true } },
            {
              endpoint: "delete",
              body: { relativePath: candidate.relativePath, target, baseRevision: applied.revision },
            },
          ],
          (operation) =>
            Effect.gen(function* () {
              const response = yield* fixture.request(`/session/${first.id}/command-asset/${operation.endpoint}`, {
                directory: first.location.directory,
                body: operation.body,
              })
              expect(response.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                _tag: "ConflictError",
                resource: candidate.relativePath,
              })
            }),
        )
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
          updated.revision,
        )
        expect(
          (yield* fixture.request(`/session/${first.id}/command-asset/delete`, {
            directory: first.location.directory,
            body: { relativePath: candidate.relativePath, target, baseRevision: updated.revision },
          })).status,
        ).toBe(200)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        expect(
          (yield* fixture.request(`/session/${second.id}/command-asset/delete`, {
            directory: second.location.directory,
            body: { relativePath: candidate.relativePath, target, baseRevision: updated.revision },
          })).status,
        ).toBe(409)
        expect(
          (yield* fixture.request(`/session/${second.id}/command-asset/delete`, {
            directory: second.location.directory,
            body: { relativePath: candidate.relativePath, target },
          })).status,
        ).toBe(200)
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "keeps selected Command reads and deletion available when creation is disabled",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
      Effect.gen(function* () {
        const content =
          "---\nkind: command\nname: review-command\ndescription: Reviewed before disabling creation\ninvocation: /review-command\n---\nReview $ARGUMENTS."
        const fixture = yield* setup([{ relativePath: "review-command.md", content }], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Read existing selected Command",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-command.md" })
        const inspected = yield* readInspection(
          yield* fixture.request(`/session/${session.id}/command-asset/inspect`, {
            directory,
            body: { candidate, scope: "project" },
          }),
        )
        expect(inspected).toMatchObject({
          exists: true,
          target: { scope: "project", root: path.join(fixture.directory, ".aigcfroge/commands") },
        })
        const file = path.join(inspected.target.root, candidate.relativePath)
        expect(Schema.encodeSync(BaseRevision)(inspected.revision)).toBe(
          Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer()))),
        )
        expect(yield* readBody(yield* fixture.request("/command-asset?scope=project", { directory }))).toMatchObject({
          target: Schema.encodeSync(AssetPlacement.Target)(inspected.target),
          assets: [{ name: candidate.name }],
        })
        expect(
          yield* readBody(
            yield* fixture.request("/command-asset/content?scope=project&path=review-command.md", { directory }),
          ),
        ).toMatchObject({
          target: Schema.encodeSync(AssetPlacement.Target)(inspected.target),
          source: "Review $ARGUMENTS.",
        })
        const disabled = yield* fixture.request(`/session/${session.id}/command-asset/apply`, {
          directory,
          body: { candidate, target: inspected.target, baseRevision: inspected.revision, overwrite: true },
        })
        expect(disabled.status).toBe(400)
        expect(yield* Effect.promise<unknown>(() => disabled.json())).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "disabled",
        })
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(content)
        expect(
          (yield* fixture.request(`/session/${session.id}/command-asset/delete`, {
            directory,
            body: { relativePath: candidate.relativePath, target: inspected.target, baseRevision: inspected.revision },
          })).status,
        ).toBe(200)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)
;(
  [
    { label: "Project commands exists", scope: "project", missing: "none" },
    { label: "Project commands is missing", scope: "project", missing: "commands" },
    { label: "Project .aigcfroge is missing", scope: "project", missing: "config" },
    { label: "global commands is missing", scope: "global", missing: "commands" },
  ] as const
).forEach((initial) => {
  it.live(
    `refreshes native Commands in two real Locations through create, replace and delete when ${initial.label}`,
    () =>
      withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
        Effect.gen(function* () {
          const fixture = yield* setup([], async (directory) => {
            await prepareProject(directory)
            if (initial.scope === "global") await prepareProject(path.join(path.dirname(directory), "other"))
            if (initial.scope === "project" && initial.missing !== "none")
              await rm(path.join(directory, initial.missing === "config" ? ".aigcfroge" : ".aigcfroge/commands"), {
                recursive: true,
              })
          })
          const environment = Context.get(fixture.local, Environment.Service)
          const root =
            initial.scope === "global"
              ? path.join(fixture.global.config, "commands")
              : path.join(fixture.directory, ".aigcfroge/commands")
          expect(yield* isDirectory(environment, root)).toBe(initial.missing === "none")
          if (initial.missing === "config") expect(yield* isDirectory(environment, path.dirname(root))).toBe(false)
          const directories = [
            path.join(fixture.directory, "packages/first"),
            path.join(initial.scope === "global" ? fixture.other : fixture.directory, "packages/second"),
          ]
          const sessions = yield* Effect.forEach(directories, (directory) =>
            Effect.gen(function* () {
              const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
              yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
              const location = Context.get(local, Location.Service)
              expect(directory).toBe(location.directory)
              expect(path.resolve(directory, "../..")).toBe(location.project.directory)
              expect(location.workspaceID).toBeUndefined()
              return yield* fixture.sessions.create({
                title: `Command discovery: ${initial.label}`,
                mode: "chat",
                location: locationRefForRoute({ directory }),
                agent: Agent.defaultID,
                model,
              })
            }),
          )
          const first = sessions[0]
          const second = sessions[1]
          if (!first || !second)
            return yield* Effect.die(new Error("Both native Command consumer Locations are required"))
          expect(yield* isDirectory(environment, root)).toBe(initial.missing === "none")
          if (initial.missing === "config") expect(yield* isDirectory(environment, path.dirname(root))).toBe(false)
          const candidate = Schema.decodeUnknownSync(Candidate)({
            ...input,
            description: `Created with ${initial.label}`,
            args: "",
            source: `Created through ${initial.label}: $ARGUMENTS.\n`,
            relativePath: "review-command.md",
          })
          const file = path.join(root, candidate.relativePath)
          const inspected = yield* Effect.forEach(sessions, (session) =>
            fixture
              .request(`/session/${session.id}/command-asset/inspect`, {
                directory: session.location.directory,
                body: { candidate, scope: initial.scope },
              })
              .pipe(Effect.flatMap(readInspection)),
          )
          const inspection = inspected[0]
          if (!inspection) return yield* Effect.die(new Error("Selected Command inspection missing"))
          expect(inspection).toEqual(inspected[1])
          expect(inspection).toEqual({
            relativePath: candidate.relativePath,
            exists: false,
            revision: null,
            nameConflict: false,
            pathConflict: false,
            target: Schema.decodeUnknownSync(AssetPlacement.Target)({ scope: initial.scope, root }),
          })
          expect(yield* isDirectory(environment, root)).toBe(initial.missing === "none")
          if (initial.missing === "config") expect(yield* isDirectory(environment, path.dirname(root))).toBe(false)
          const added = yield* nativeReady(fixture, candidate.description, directories, file)
          const createdWatches = yield* watcherReady(
            fixture,
            directories,
            initial.missing === "config"
              ? { type: "entries", path: fixture.directory, names: [".aigcfroge"] }
              : { type: "directory", path: path.dirname(root) },
          )
          const createdEvents = fixture.watchers.events.length
          const appliedBody = yield* readBody(
            yield* fixture.request(`/session/${first.id}/command-asset/apply`, {
              directory: first.location.directory,
              body: { candidate, target: inspection.target, overwrite: false },
            }),
          )
          expect(appliedBody).toMatchObject({
            ...candidate,
            kind: "command",
            target: Schema.encodeSync(AssetPlacement.Target)(inspection.target),
          })
          const applied = Schema.decodeUnknownSync(Info)(appliedBody)
          yield* added
          yield* watcherReady(fixture, directories, { type: "directory", path: path.dirname(root) })
          yield* recordWatchEvents(fixture, `${initial.label}: create`, createdWatches, createdEvents)
          expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
            applied.revision,
          )
          yield* assertNative(fixture, directories, candidate.description)
          yield* Effect.forEach(directories, (directory) =>
            Effect.gen(function* () {
              expect(
                Schema.decodeUnknownSync(Info)(
                  yield* readBody(
                    yield* fixture.request(`/command-asset/content?scope=${initial.scope}&path=review-command.md`, {
                      directory,
                    }),
                  ),
                ),
              ).toEqual(applied)
              expect(
                yield* Effect.promise(() =>
                  Bun.file(path.join(directory, ".aigcfroge/commands/review-command.md")).exists(),
                ),
              ).toBe(false)
            }),
          )

          const replacement = Schema.decodeUnknownSync(Candidate)({
            ...candidate,
            description: `Replaced with ${initial.label}`,
            source: `Replaced through the other Location with ${initial.label}: $ARGUMENTS.\n`,
          })
          const changed = yield* nativeReady(fixture, replacement.description, directories, file)
          const replacedWatches = yield* watcherReady(fixture, directories, {
            type: "directory",
            path: path.dirname(root),
          })
          const replacedEvents = fixture.watchers.events.length
          const updatedBody = yield* readBody(
            yield* fixture.request(`/session/${second.id}/command-asset/apply`, {
              directory: second.location.directory,
              body: {
                candidate: replacement,
                target: inspection.target,
                baseRevision: applied.revision,
                overwrite: true,
              },
            }),
          )
          expect(updatedBody).toMatchObject({
            ...replacement,
            kind: "command",
            target: Schema.encodeSync(AssetPlacement.Target)(inspection.target),
          })
          const updated = Schema.decodeUnknownSync(Info)(updatedBody)
          yield* changed
          yield* recordWatchEvents(fixture, `${initial.label}: replace`, replacedWatches, replacedEvents)
          expect(updated.revision).not.toBe(applied.revision)
          expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
            updated.revision,
          )
          yield* assertNative(fixture, directories, replacement.description)
          yield* Effect.forEach(directories, (directory) =>
            fixture.request(`/command-asset/content?scope=${initial.scope}&path=review-command.md`, { directory }).pipe(
              Effect.flatMap(readBody),
              Effect.map((body) => expect(Schema.decodeUnknownSync(Info)(body)).toEqual(updated)),
            ),
          )

          const removed = yield* nativeReady(fixture, undefined, directories, file)
          const deletedWatches = yield* watcherReady(fixture, directories, {
            type: "directory",
            path: path.dirname(root),
          })
          const deletedEvents = fixture.watchers.events.length
          expect(
            (yield* fixture.request(`/session/${first.id}/command-asset/delete`, {
              directory: first.location.directory,
              body: { relativePath: candidate.relativePath, target: inspection.target, baseRevision: updated.revision },
            })).status,
          ).toBe(200)
          yield* removed
          yield* recordWatchEvents(fixture, `${initial.label}: delete`, deletedWatches, deletedEvents)
          yield* assertNative(fixture, directories, undefined)
          expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
          yield* Effect.forEach(sessions, (session) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/command-asset/content?scope=${initial.scope}&path=review-command.md`, {
                  directory: session.location.directory,
                })).status,
              ).toBe(400)
              expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
              expect(yield* fixture.sessions.context(session.id)).toEqual([])
            }),
          )
          expect(yield* fixture.llm.requests()).toHaveLength(0)
        }),
      ),
    30_000,
  )
})

it.live(
  "keeps Project Command source above global and consumes the global fallback in the original Session",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directories = [
          path.join(fixture.directory, "packages/first"),
          path.join(fixture.directory, "packages/second"),
        ]
        const sessions = yield* Effect.forEach(directories, (directory) =>
          Effect.gen(function* () {
            const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
            yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
            const location = Context.get(local, Location.Service)
            expect(directory).toBe(location.directory)
            expect(fixture.directory).toBe(location.project.directory)
            expect(location.workspaceID).toBeUndefined()
            return yield* fixture.sessions.create({
              title: "Command source winner",
              mode: "chat",
              location: locationRefForRoute({ directory }),
              agent: Agent.defaultID,
              model,
            })
          }),
        )
        const first = sessions[0]
        const second = sessions[1]
        if (!first || !second) return yield* Effect.die(new Error("Both Command source consumers are required"))
        const projectCandidate = Schema.decodeUnknownSync(Candidate)({
          ...input,
          args: "",
          source: "Project source: $ARGUMENTS.\n",
          relativePath: "review-command.md",
        })
        const globalCandidate = Schema.decodeUnknownSync(Candidate)({
          ...projectCandidate,
          source: "Global source: $ARGUMENTS.\n",
        })
        const project = yield* readInspection(
          yield* fixture.request(`/session/${first.id}/command-asset/inspect`, {
            directory: first.location.directory,
            body: { candidate: projectCandidate, scope: "project" },
          }),
        )
        const global = yield* readInspection(
          yield* fixture.request(`/session/${second.id}/command-asset/inspect`, {
            directory: second.location.directory,
            body: { candidate: globalCandidate, scope: "global" },
          }),
        )
        expect(Schema.encodeSync(AssetPlacement.Target)(project.target)).toEqual({
          scope: "project",
          root: path.join(fixture.directory, ".aigcfroge/commands"),
        })
        expect(Schema.encodeSync(AssetPlacement.Target)(global.target)).toEqual({
          scope: "global",
          root: path.join(fixture.global.config, "commands"),
        })
        expect(project.revision).toBeNull()
        expect(global.revision).toBeNull()
        const projectFile = path.join(project.target.root, projectCandidate.relativePath)
        const globalFile = path.join(global.target.root, globalCandidate.relativePath)
        expect(yield* Effect.promise(() => Bun.file(projectFile).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(globalFile).exists())).toBe(false)

        const projectAdded = yield* nativeReady(fixture, input.description, directories, projectFile)
        const projectWatches = yield* watcherReady(fixture, directories, {
          type: "directory",
          path: path.dirname(project.target.root),
        })
        const projectEvents = fixture.watchers.events.length
        const projectBody = yield* readBody(
          yield* fixture.request(`/session/${first.id}/command-asset/apply`, {
            directory: first.location.directory,
            body: { candidate: projectCandidate, target: project.target, overwrite: false },
          }),
        )
        expect(projectBody).toMatchObject({
          ...projectCandidate,
          kind: "command",
          target: Schema.encodeSync(AssetPlacement.Target)(project.target),
        })
        const projectInfo = Schema.decodeUnknownSync(Info)(projectBody)
        yield* projectAdded
        yield* recordWatchEvents(fixture, "source winner: Project create", projectWatches, projectEvents)
        yield* assertNative(fixture, directories, input.description)
        const projectBytes = yield* Effect.promise(() => Bun.file(projectFile).arrayBuffer())
        expect(Hash.sha256(Buffer.from(projectBytes))).toBe(projectInfo.revision)
        const original = yield* consumeCommand(
          fixture,
          first,
          "first project",
          "Project source: first project.",
          "Global source:",
        )

        const globalAdded = yield* nativeReady(fixture, input.description, directories, globalFile)
        const globalWatches = yield* watcherReady(fixture, directories, {
          type: "directory",
          path: fixture.global.config,
        })
        const globalEvents = fixture.watchers.events.length
        const globalBody = yield* readBody(
          yield* fixture.request(`/session/${second.id}/command-asset/apply`, {
            directory: second.location.directory,
            body: { candidate: globalCandidate, target: global.target, overwrite: false },
          }),
        )
        expect(globalBody).toMatchObject({
          ...globalCandidate,
          kind: "command",
          target: Schema.encodeSync(AssetPlacement.Target)(global.target),
        })
        const globalInfo = Schema.decodeUnknownSync(Info)(globalBody)
        yield* globalAdded
        yield* recordWatchEvents(fixture, "source winner: global create", globalWatches, globalEvents)
        yield* assertNative(fixture, directories, input.description)
        const globalBytes = yield* Effect.promise(() => Bun.file(globalFile).arrayBuffer())
        expect(Hash.sha256(Buffer.from(globalBytes))).toBe(globalInfo.revision)
        expect(yield* Effect.promise(() => Bun.file(projectFile).arrayBuffer())).toEqual(projectBytes)
        yield* Effect.forEach(
          [
            { scope: "project", info: projectInfo },
            { scope: "global", info: globalInfo },
          ],
          (owner) =>
            fixture
              .request(`/command-asset/content?scope=${owner.scope}&path=review-command.md`, {
                directory: first.location.directory,
              })
              .pipe(
                Effect.flatMap(readBody),
                Effect.map((body) => expect(Schema.decodeUnknownSync(Info)(body)).toEqual(owner.info)),
              ),
        )
        const shadowed = yield* consumeCommand(
          fixture,
          first,
          "project remains",
          "Project source: project remains.",
          "Global source:",
        )

        const fallbackReady = yield* nativeReady(fixture, input.description, directories, projectFile)
        const fallbackWatches = yield* watcherReady(fixture, directories, {
          type: "directory",
          path: path.dirname(project.target.root),
        })
        const fallbackEvents = fixture.watchers.events.length
        expect(
          (yield* fixture.request(`/session/${first.id}/command-asset/delete`, {
            directory: first.location.directory,
            body: {
              relativePath: projectInfo.relativePath,
              target: project.target,
              baseRevision: projectInfo.revision,
            },
          })).status,
        ).toBe(200)
        yield* fallbackReady
        yield* recordWatchEvents(fixture, "source winner: Project delete", fallbackWatches, fallbackEvents)
        yield* assertNative(fixture, directories, input.description)
        expect(yield* Effect.promise(() => Bun.file(projectFile).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(globalFile).arrayBuffer())).toEqual(globalBytes)
        const fallback = yield* consumeCommand(
          fixture,
          first,
          "global fallback",
          "Global source: global fallback.",
          "Project source:",
        )
        const history = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${first.id}/context`, { directory: first.location.directory }),
          ),
        )
        expect(history.data.find((message) => message.id === original.id)).toEqual(original)
        expect(history.data.find((message) => message.id === shadowed.id)).toEqual(shadowed)
        expect(history.data.find((message) => message.id === fallback.id)).toEqual(fallback)

        const removed = yield* nativeReady(fixture, undefined, directories, globalFile)
        const removedWatches = yield* watcherReady(fixture, directories, {
          type: "directory",
          path: fixture.global.config,
        })
        const removedEvents = fixture.watchers.events.length
        expect(
          (yield* fixture.request(`/session/${second.id}/command-asset/delete`, {
            directory: second.location.directory,
            body: { relativePath: globalInfo.relativePath, target: global.target, baseRevision: globalInfo.revision },
          })).status,
        ).toBe(200)
        yield* removed
        yield* recordWatchEvents(fixture, "source winner: global delete", removedWatches, removedEvents)
        yield* assertNative(fixture, directories, undefined)
        expect(yield* Effect.promise(() => Bun.file(globalFile).exists())).toBe(false)
        const missing = yield* fixture.request(`/api/session/${first.id}/command`, {
          directory: first.location.directory,
          body: { name: input.name, text: "after both owners were removed", delivery: "steer" },
        })
        expect(missing.status).toBe(404)
        expect(yield* Effect.promise<unknown>(() => missing.json())).toMatchObject({
          _tag: "CommandNotFoundError",
          command: input.name,
        })
        expect(
          Schema.decodeUnknownSync(contextResponse)(
            yield* readBody(
              yield* fixture.request(`/api/session/${first.id}/context`, { directory: first.location.directory }),
            ),
          ),
        ).toEqual(history)
        expect(yield* fixture.sessions.context(second.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(3)
        yield* Effect.forEach(sessions, (session) =>
          Effect.gen(function* () {
            expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
            expect(
              (yield* fixture.request("/command-asset/content?scope=project&path=review-command.md", {
                directory: session.location.directory,
              })).status,
            ).toBe(400)
            expect(
              (yield* fixture.request("/command-asset/content?scope=global&path=review-command.md", {
                directory: session.location.directory,
              })).status,
            ).toBe(400)
          }),
        )
      }),
    ),
  30_000,
)

async function prepareProject(directory: string) {
  await initRepo(directory)
  await Promise.all(
    ["first", "second"].map((name) => mkdir(path.join(directory, "packages", name), { recursive: true })),
  )
}

const isDirectory = (environment: Environment.Interface, root: string) =>
  environment.files.stat(root).pipe(
    Effect.map((info) => info.type === "directory"),
    Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
  )

const readInspection = (response: Response) =>
  Effect.gen(function* () {
    const body = yield* readBody(response)
    expect(Inspection).toBeDefined()
    return Schema.decodeUnknownSync(Inspection)(body)
  })

function proposal(messages: readonly SessionMessage.Info[], id: string) {
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : []))
    .find((part) => part.id === id && part.name === "propose_command_asset")
  if (!tool || tool.state.status !== "completed") throw new Error("Completed proposer Tool result missing")
  return {
    input: tool.state.input,
    metadata: tool.state.metadata,
    facts: Schema.decodeUnknownSync(Inspection)(tool.state.metadata),
  }
}

const readBody = (response: Response) =>
  Effect.gen(function* () {
    if (response.status !== 200)
      yield* Effect.logError("Command asset HTTP response failed", {
        status: response.status,
        detail: (yield* Effect.promise(() => response.clone().text())).slice(0, 512),
      })
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

const nativeReady = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  description: string | undefined,
  directories: readonly string[] = [fixture.directory],
  changedPath?: string,
) =>
  Effect.gen(function* () {
    const observed = fixture.watchers.events.length
    const waits = yield* Effect.forEach(directories, (directory) =>
      Effect.gen(function* () {
        const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
        yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
        const location = Context.get(local, Location.Service)
        const commands = Context.get(local, Command.Service)
        const signal = yield* Deferred.make<void>()
        const present = commands
          .get(input.name)
          .pipe(
            Effect.map((command) =>
              description === undefined
                ? command === undefined
                : command !== undefined && command.description === description,
            ),
          )
        const unsubscribe = yield* fixture.bus.listen((event) => {
          if (
            event.type !== Command.Event.Updated.type ||
            event.location?.directory !== location.directory ||
            event.location.workspaceID !== location.workspaceID
          )
            return Effect.void
          // A same-description rebuild must follow a real update for this owner's mutation.
          if (
            changedPath &&
            !fixture.watchers.events
              .slice(observed)
              .some(
                (entry) =>
                  entry.subscription.location?.directory === location.directory &&
                  entry.subscription.location.workspaceID === location.workspaceID &&
                  (entry.update.path === changedPath || changedPath.startsWith(entry.update.path + path.sep)),
              )
          )
            return Effect.void
          return present.pipe(
            Effect.flatMap((matched) =>
              matched ? Deferred.succeed(signal, undefined).pipe(Effect.asVoid) : Effect.void,
            ),
          )
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        return Deferred.await(signal).pipe(
          Effect.andThen(
            pollWithTimeout(
              present.pipe(Effect.map((matched) => (matched ? true : undefined))),
              `Native Command state did not match the HTTP write in ${directory}`,
              "10 seconds",
            ),
          ),
        )
      }),
    )
    return awaitWithTimeout(
      Effect.all(waits, { concurrency: "unbounded" }),
      "Real Command watchers did not publish the expected updates for all Locations",
      "10 seconds",
    )
  })

const watcherReady = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  directories: readonly string[],
  expected: Watcher.WatchInput,
) =>
  Effect.gen(function* () {
    const owners = yield* Effect.forEach(directories, (directory) =>
      fixture.locations
        .contextEffect(locationRefForRoute({ directory }))
        .pipe(Effect.map((local) => Context.get(local, Location.Service))),
    )
    const ignore = ["node_modules", ".git", "**/{node_modules,.git}/**"]
    const ready = yield* pollWithTimeout(
      Effect.sync(() => {
        const current = owners.map((owner) =>
          Array.from(fixture.watchers.active).find((subscription) => {
            if (
              subscription.location?.directory !== owner.directory ||
              subscription.location.workspaceID !== owner.workspaceID ||
              subscription.input.type !== expected.type ||
              path.resolve(subscription.input.path) !== path.resolve(expected.path)
            )
              return false
            if (expected.type === "entries")
              return (
                subscription.input.type === "entries" &&
                expected.names.every(
                  (name) => subscription.input.type === "entries" && subscription.input.names.includes(name),
                )
              )
            if (expected.type === "directory")
              return (
                subscription.input.type === "directory" &&
                subscription.input.ignore?.length === ignore.length &&
                ignore.every(
                  (name, index) =>
                    subscription.input.type === "directory" && subscription.input.ignore?.[index] === name,
                )
              )
            return true
          }),
        )
        return current.every((item): item is AssetHttpFixture.WatchedSubscription => item !== undefined)
          ? current
          : undefined
      }),
      `Native Command ${expected.type} watch was not ready for all Locations at ${expected.path}`,
      "10 seconds",
    )
    expect(ready.map((item) => item.location?.directory)).toEqual(
      directories.map((directory) => Schema.decodeUnknownSync(AbsolutePath)(directory)),
    )
    expect(ready.map((item) => item.location?.workspaceID)).toEqual(owners.map((owner) => owner.workspaceID))
    expect(ready.every((item) => fixture.watchers.active.has(item))).toBe(true)
    yield* Effect.sync(() => reportObservation({ phase: "watch-ready", expected, subscriptions: ready }))
    return ready
  })

const recordWatchEvents = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  operation: string,
  subscriptions: readonly AssetHttpFixture.WatchedSubscription[],
  offset: number,
) =>
  Effect.sync(() =>
    reportObservation({
      phase: "mutation",
      operation,
      subscriptions: subscriptions.map((subscription) => ({
        ...subscription,
        active: fixture.watchers.active.has(subscription),
      })),
      events: fixture.watchers.events.slice(offset).filter((event) => subscriptions.includes(event.subscription)),
    }),
  )

const assertNative = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  directories: readonly string[],
  description: string | undefined,
) =>
  Effect.forEach(directories, (directory) =>
    Effect.gen(function* () {
      const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
      const current = yield* Context.get(local, Command.Service).get(input.name)
      const listed = Schema.decodeUnknownSync(nativeResponse)(
        yield* readBody(yield* fixture.request("/api/command", { directory })),
      )
      if (description === undefined) {
        expect(current).toBeUndefined()
        expect(listed.data.some((command) => command.name === input.name)).toBe(false)
        return
      }
      expect(current).toEqual({ name: input.name, description })
      expect(listed.data.filter((command) => command.name === input.name)).toEqual([{ name: input.name, description }])
    }),
  )

const consumeCommand = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  session: Session.Info,
  argument: string,
  expected: string,
  excluded: string,
) =>
  Effect.gen(function* () {
    const count = (yield* fixture.llm.requests()).length
    yield* fixture.llm.push(TestLLM.text("Command consumed", `command-consume-${count}`))
    expect(
      (yield* fixture.request(`/api/session/${session.id}/command`, {
        directory: session.location.directory,
        body: { name: input.name, text: argument, delivery: "steer" },
      })).status,
    ).toBe(204)
    yield* awaitWithTimeout(
      fixture.llm.wait(count + 1),
      "Native Command did not reach the ordinary Session runner",
      "10 seconds",
    )
    const user = yield* pollWithTimeout(
      fixture
        .request(`/api/session/${session.id}/context`, {
          directory: session.location.directory,
        })
        .pipe(
          Effect.flatMap(readBody),
          Effect.map((body) =>
            Schema.decodeUnknownSync(contextResponse)(body).data.find(
              (message) => message.type === "user" && message.text === expected,
            ),
          ),
        ),
      "Native Command input was not durably projected",
      "10 seconds",
    )
    yield* awaitInputCompletion(fixture, session.id, user.id, "Native Command input did not complete")
    expect(
      yield* SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: user.id }),
    ).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: "Command consumed" }] } })
    const requests = yield* fixture.llm.requests()
    expect(requests).toHaveLength(count + 1)
    const request = requests[count]
    if (!request) return yield* Effect.die(new Error("Native Command runner request missing"))
    const text = request.messages
      .filter((message) => message.role === "user")
      .at(-1)
      ?.content.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    expect(text).toBe(expected)
    expect(text).not.toContain(excluded)
    if (text === undefined) return yield* Effect.die(new Error("Native Command latest user text missing"))
    yield* Effect.sync(() =>
      reportObservation({
        phase: "consumer",
        sessionID: session.id,
        location: session.location,
        inputID: user.id,
        latestUserSha256: Hash.sha256(Buffer.from(text)),
        expectedSha256: Hash.sha256(Buffer.from(expected)),
        requestCount: requests.length,
        expectedRequestCount: count + 1,
        matchesExpected: text === expected,
        excludesOtherSource: !text.includes(excluded),
      }),
    )
    return user
  })

function reportObservation(observation: Record<string, unknown>) {
  // The snapshot runner persists stdout; Effect logs stay inside TestConsole on successful tests.
  console.log(JSON.stringify({ type: "command-asset.observation", ...observation }))
}
