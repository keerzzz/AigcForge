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
import { Skill } from "@aigcfroge/core/skill"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { SkillAssetService } from "@aigcfroge/core/skill-asset-service"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import {
  BaseRevision,
  Candidate,
  Info,
  Inspection,
  InvalidEntry,
  Revision,
  Summary,
} from "@aigcfroge/schema/skill-asset"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Hash } from "@aigcfroge/util/hash"
import { Context, Deferred, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { initRepo } from "../../core/test/fixture/git"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("skill-asset"), providerID: Provider.ID.make("test") })
const contextResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })
const promptResponse = Schema.Struct({ data: Schema.Struct({ id: SessionMessage.ID }) })
const listResponse = Schema.Struct({
  assets: Schema.Array(Summary),
  invalid: Schema.Array(InvalidEntry),
  target: Schema.optional(AssetPlacement.Target),
})
const nativeResponse = Schema.Struct({ data: Schema.Array(Skill.Info) })
const input = {
  name: "review-basics",
  description: "Review changes using the current source and validation evidence.",
  slash: false,
  content: "Read the actual diff and report the changed behavior plus the validation result.",
}

const setup = (
  files: readonly { relativePath: string; content: string }[] = [],
  prepare?: (directory: string) => Promise<void>,
) => {
  const watchers = AssetHttpFixture.observeWatchers()
  return AssetHttpFixture.setup({
    prefix: "aigcfroge-skill-http-",
    assetDirectory: ".aigcfroge/skills",
    model,
    files,
    prepare,
    watcher: watchers.layer,
  }).pipe(
    Effect.map((fixture) => ({
      ...fixture,
      watchers,
      assets: Context.getOption(fixture.local, SkillAsset.Service),
      assetService: Context.getOption(fixture.local, SkillAssetService.Service),
      skills: Context.get(fixture.local, Skill.Service),
    })),
    Effect.tap((fixture) =>
      fixture.skills.list().pipe(
        Effect.flatMap((skills) =>
          Effect.logInfo("Skill HTTP fixture discovery sources", {
            selectedGlobalRoot: path.join(fixture.global.config, "skills"),
            // tempGlobalLayer retains home. These compatibility sources remain ambient;
            // selected-global and native assertions use the exact temporary config root.
            ambient: [".claude", ".agents"].map((name) => {
              const root = path.join(fixture.global.home, name, "skills")
              return {
                root,
                visibleSkills: skills.filter((skill) => path.resolve(skill.path).startsWith(root + path.sep)).length,
              }
            }),
          }),
        ),
      ),
    ),
  )
}

it.live(
  "persists Skill proposal facts and hands real HTTP writes to native Skill and Session consumption",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const target = path.join(fixture.directory, ".aigcfroge/skills/review-basics.md")
        const session = yield* fixture.sessions.create({
          title: "Skill review",
          mode: "chat",
          location: locationRefForRoute({ directory: fixture.directory }),
          agent: Agent.defaultID,
          model,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
        const other = yield* fixture.sessions.create({
          title: "Other Skill Location",
          mode: "chat",
          location: locationRefForRoute({ directory: fixture.other }),
          agent: Agent.defaultID,
          model,
        })
        yield* fixture.llm.push(
          TestLLM.tool("propose-new", "propose_skill_asset", input),
          TestLLM.text("Ready for review", "review"),
        )
        const prompted = yield* fixture.request(`/api/session/${session.id}/prompt`, {
          body: { text: "Propose the basic review Skill" },
        })
        expect(prompted.status).toBe(200)
        const firstInput = Schema.decodeUnknownSync(promptResponse)(yield* readBody(prompted))
        yield* awaitWithTimeout(fixture.llm.wait(2), "Proposer did not finish", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, firstInput.data.id, "Proposal input did not complete")
        const messages = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
        )
        const proposed = proposal(messages.data, "propose-new")
        expect(proposed.input).toEqual(input)
        expect(proposed.facts).toEqual({
          relativePath: "review-basics.md",
          exists: false,
          revision: null,
          nameConflict: false,
          pathConflict: false,
          target: { scope: "project", root: AbsolutePath.make(path.join(fixture.directory, ".aigcfroge/skills")) },
        })
        expect(proposed.metadata).not.toHaveProperty("candidate")
        expect(proposed.metadata).not.toHaveProperty("input")
        expect(proposed.metadata).not.toHaveProperty("content")
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        const candidate = Candidate.make({
          ...input,
          relativePath: proposed.facts.relativePath,
          triggers: [],
          tags: [],
        })
        expect(Option.isSome(fixture.assets)).toBe(true)
        expect(Option.isSome(fixture.assetService)).toBe(true)
        const assets = Option.getOrThrow(fixture.assets)
        const assetService = Option.getOrThrow(fixture.assetService)
        expect(yield* assetService.propose(candidate)).toEqual({
          relativePath: "review-basics.md",
          exists: false,
          revision: null,
          nameConflict: false,
          pathConflict: false,
        })
        const same = yield* fixture.locations.contextEffect(locationRefForRoute({ directory: fixture.directory }))
        expect(Context.get(same, SkillAsset.Service)).toBe(assets)
        expect(Context.get(same, SkillAssetService.Service)).toBe(assetService)
        const unauthorized = yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
          authenticated: false,
          body: { candidate, overwrite: false },
        })
        expect(unauthorized.status).toBe(401)
        const misplaced = yield* fixture.request(`/session/${other.id}/skill-asset/apply`, {
          body: { candidate, overwrite: false },
        })
        expect(misplaced.status).toBe(409)
        expect(yield* Effect.promise<unknown>(() => misplaced.json())).toMatchObject({
          _tag: "ConflictError",
          resource: other.id,
        })
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        expect(
          yield* Effect.promise(() =>
            Bun.file(path.join(fixture.other, ".aigcfroge/skills/review-basics.md")).exists(),
          ),
        ).toBe(false)

        const added = yield* nativeReady(fixture, target, input.content)
        const createdWatches = yield* watcherReady(fixture, [fixture.directory], {
          type: "directory",
          path: path.dirname(target),
        })
        const applied = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
              body: { candidate, overwrite: false },
            }),
          ),
        )
        yield* added
        expect(applied).not.toHaveProperty("target")
        expect(applied.relativePath).toBe(proposed.facts.relativePath)
        expect(applied.content).toBe(input.content)
        expect(applied.revision).toBe(
          Schema.decodeUnknownSync(Revision)(
            Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer()))),
          ),
        )
        expect(Schema.decodeUnknownSync(Info)(yield* assets.getByPath(applied.relativePath))).toEqual(applied)
        const native = Schema.decodeUnknownSync(nativeResponse)(yield* readBody(yield* fixture.request("/api/skill")))
        expect(native.data).toContainEqual(
          expect.objectContaining({ id: Skill.ID.make("review-basics"), content: input.content }),
        )
        const list = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/skill-asset")))
        expect(list).not.toHaveProperty("target")
        expect(list.assets).toContainEqual(
          expect.objectContaining({ relativePath: applied.relativePath, revision: applied.revision }),
        )
        const content = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/skill-asset/content?path=${encodeURIComponent(applied.relativePath)}`),
          ),
        )
        expect(content).toEqual(applied)

        const changed = {
          ...input,
          content: "Inspect the current source, then report the behavior and the executed validation command.",
        }
        yield* fixture.llm.push(
          TestLLM.tool("propose-existing", "propose_skill_asset", changed),
          TestLLM.text("Review the overwrite", "overwrite-review"),
        )
        const existingPrompt = yield* fixture.request(`/api/session/${session.id}/prompt`, {
          body: { text: "Propose this revised Skill" },
        })
        expect(existingPrompt.status).toBe(200)
        const existingInput = Schema.decodeUnknownSync(promptResponse)(yield* readBody(existingPrompt))
        yield* awaitWithTimeout(fixture.llm.wait(4), "Existing proposal did not finish", "10 seconds")
        yield* awaitInputCompletion(
          fixture,
          session.id,
          existingInput.data.id,
          "Existing proposal input did not complete",
        )
        const updatedMessages = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
        )
        const existing = proposal(updatedMessages.data, "propose-existing")
        expect(existing.input).toEqual(changed)
        expect(existing.facts).toEqual({
          relativePath: applied.relativePath,
          exists: true,
          revision: applied.revision,
          nameConflict: false,
          pathConflict: false,
          target: proposed.facts.target,
        })
        const replacement = Candidate.make({
          ...changed,
          relativePath: existing.facts.relativePath,
          triggers: [],
          tags: [],
        })
        const overwriteRequired = yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
          body: { candidate: replacement, baseRevision: existing.facts.revision, overwrite: false },
        })
        expect(overwriteRequired.status).toBe(409)
        expect(yield* Effect.promise<unknown>(() => overwriteRequired.json())).toMatchObject({
          _tag: "ConflictError",
          resource: applied.relativePath,
        })
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
          applied.revision,
        )
        const rescanned = yield* nativeReady(fixture, target, changed.content)
        const updatedWatches = yield* watcherReady(
          fixture,
          [fixture.directory],
          { type: "directory", path: path.dirname(target) },
          createdWatches,
        )
        const updated = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
              body: { candidate: replacement, baseRevision: existing.facts.revision, overwrite: true },
            }),
          ),
        )
        yield* rescanned
        expect(updated.revision).not.toBe(applied.revision)
        const stale = yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
          body: { candidate: replacement, baseRevision: existing.facts.revision, overwrite: true },
        })
        expect(stale.status).toBe(409)
        expect(yield* Effect.promise<unknown>(() => stale.json())).toMatchObject({
          _tag: "ConflictError",
          resource: updated.relativePath,
        })
        expect(
          (yield* fixture.request(`/session/${other.id}/skill-asset/delete`, {
            body: { relativePath: updated.relativePath, baseRevision: updated.revision },
          })).status,
        ).toBe(409)
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
          updated.revision,
        )
        yield* Effect.forEach([{ slash: true }, { triggers: ["review"] }, { tags: ["review"] }], (unsupported) =>
          fixture
            .request(`/session/${session.id}/skill-asset/apply`, {
              body: { candidate: { ...replacement, ...unsupported }, baseRevision: updated.revision, overwrite: true },
            })
            .pipe(Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(400)))),
        )
        expect(
          (yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
            body: { candidate: { ...replacement, name: "../escape" }, overwrite: false },
          })).status,
        ).toBe(400)
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
          updated.revision,
        )

        yield* fixture.llm.push(TestLLM.text("Skill used", "skill-consumed"))
        const admitted = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              body: { text: "Use the selected Skill", skills: [{ id: Skill.ID.make("review-basics") }] },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(5), "Selected Skill did not reach the real runner", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, admitted.data.id, "Skill consumption input did not complete")
        expect(
          yield* SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: admitted.data.id }),
        ).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: "Skill used" }] } })
        const requests = yield* fixture.llm.requests()
        const used = requests[4]
        if (!used) return yield* Effect.die(new Error("Skill request missing"))
        const systemText = used.messages
          .filter((message) => message.role === "system")
          .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
          .join("\n")
        const userText = used.messages
          .filter((message) => message.role === "user")
          .flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
          .join("\n")
        expect(systemText).toContain("<id>review-basics</id>")
        expect(systemText).toContain(input.description)
        expect(userText).toContain('<skill_content name="review-basics">')
        expect(userText).toContain(changed.content)
        const retained = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
        )
        const user = retained.data.find((message) => message.id === admitted.data.id)
        expect(user).toMatchObject({
          type: "user",
          skills: [{ id: Skill.ID.make("review-basics"), text: expect.stringContaining(changed.content) }],
        })

        const staleDelete = yield* fixture.request(`/session/${session.id}/skill-asset/delete`, {
          body: { relativePath: updated.relativePath, baseRevision: applied.revision },
        })
        expect(staleDelete.status).toBe(409)
        expect(yield* Effect.promise<unknown>(() => staleDelete.json())).toMatchObject({
          _tag: "ConflictError",
          resource: updated.relativePath,
        })
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
          updated.revision,
        )
        const removed = yield* nativeReady(fixture, target, undefined)
        yield* watcherReady(
          fixture,
          [fixture.directory],
          { type: "directory", path: path.dirname(target) },
          updatedWatches,
        )
        const deleted = yield* fixture.request(`/session/${session.id}/skill-asset/delete`, {
          body: { relativePath: updated.relativePath, baseRevision: updated.revision },
        })
        expect(deleted.ok).toBe(true)
        yield* removed
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        expect(
          (yield* fixture.request(`/skill-asset/content?path=${encodeURIComponent(updated.relativePath)}`)).status,
        ).toBe(400)
        const missing = yield* fixture.request(`/api/session/${session.id}/prompt`, {
          body: { text: "Try the deleted Skill", skills: [{ id: Skill.ID.make("review-basics") }] },
        })
        expect(missing.status).toBe(400)
        const afterDelete = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
        )
        expect(afterDelete.data.find((message) => message.id === admitted.data.id)).toEqual(user)
        expect(yield* fixture.llm.requests()).toHaveLength(5)
      }),
    ),
  30_000,
)

it.live(
  "persists a Project Inspection from a Git child without writing or migrating any Skill owner",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], async (directory) => {
          await prepareProject(directory)
          await rm(path.join(directory, ".aigcfroge"), { recursive: true })
          const legacy = path.join(directory, "packages/first/.claude/skills/legacy/SKILL.md")
          await mkdir(path.dirname(legacy), { recursive: true })
          await Bun.write(
            legacy,
            "---\nname: legacy\ndescription: Existing compatibility Skill\n---\nKeep these bytes.",
          )
        })
        const directory = path.join(fixture.directory, "packages/first")
        const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
        yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
        const location = Context.get(local, Location.Service)
        const environment = Context.get(local, Environment.Service)
        expect(location.directory).toBe(AbsolutePath.make(directory))
        expect(location.project.directory).toBe(AbsolutePath.make(fixture.directory))
        const session = yield* fixture.sessions.create({
          title: "Project Skill proposal from child",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
        const candidate = {
          ...input,
          name: "Ｒｅｖｉｅｗ Ｂａｓｉｃｓ",
          content: "\uFEFF# Review\r\n\r\nKeep `backticks`, $HOME, 中文 and trailing spaces.  \r\n",
        }
        yield* fixture.llm.push(
          TestLLM.tool("project-proposal", "propose_skill_asset", candidate),
          TestLLM.text("Review the Project target", "project-review"),
        )
        const admitted = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              directory,
              body: { text: "Propose this Skill" },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(2), "Project proposer did not complete", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, admitted.data.id, "Project proposal input did not complete")
        const messages = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`, { directory })),
        )
        const saved = proposal(messages.data, "project-proposal")
        expect(saved.input).toEqual(candidate)
        expect(saved.metadata).toEqual({
          relativePath: "Review Basics.md",
          exists: false,
          revision: null,
          nameConflict: false,
          pathConflict: false,
          target: { scope: "project", root: path.join(fixture.directory, ".aigcfroge/skills") },
          truncated: false,
        })
        const inspection = Schema.decodeUnknownSync(Inspection)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
              directory,
              body: {
                candidate: { ...candidate, relativePath: "Review Basics.md", triggers: [], tags: [] },
                scope: "project",
              },
            }),
          ),
        )
        expect(saved.facts).toEqual(inspection)
        yield* Effect.forEach(
          [
            path.join(fixture.directory, ".aigcfroge"),
            path.join(directory, ".aigcfroge"),
            path.join(fixture.global.config, "skills"),
          ],
          (root) =>
            Effect.gen(function* () {
              expect(yield* isDirectory(environment, root)).toBe(false)
            }),
        )
        expect(
          yield* Effect.promise(() => Bun.file(path.join(directory, ".claude/skills/legacy/SKILL.md")).text()),
        ).toBe("---\nname: legacy\ndescription: Existing compatibility Skill\n---\nKeep these bytes.")
        expect(yield* fixture.llm.requests()).toHaveLength(2)
      }),
    ),
  30_000,
)

for (const initial of [
  { label: "Project skills exists", scope: "project", missing: "none" },
  { label: "Project skills is missing", scope: "project", missing: "skills" },
  { label: "Project .aigcfroge is missing", scope: "project", missing: "config" },
  { label: "global skills is missing", scope: "global", missing: "skills" },
] as const) {
  it.live(
    `refreshes two real Locations through create, replace and delete when ${initial.label}`,
    () =>
      withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
        Effect.gen(function* () {
          const fixture = yield* setup([], async (directory) => {
            await prepareProject(directory)
            await prepareProject(path.join(path.dirname(directory), "other"))
            if (initial.scope === "project" && initial.missing !== "none")
              await rm(path.join(directory, initial.missing === "config" ? ".aigcfroge" : ".aigcfroge/skills"), {
                recursive: true,
              })
          })
          const directories = [
            path.join(fixture.directory, "packages/first"),
            path.join(initial.scope === "global" ? fixture.other : fixture.directory, "packages/second"),
          ]
          const sessions = yield* Effect.forEach(directories, (directory) =>
            Effect.gen(function* () {
              const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
              yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
              const location = Context.get(local, Location.Service)
              expect(location.directory).toBe(AbsolutePath.make(directory))
              expect(location.project.directory).toBe(AbsolutePath.make(path.resolve(directory, "../..")))
              return yield* fixture.sessions.create({
                title: initial.label,
                mode: "chat",
                location: locationRefForRoute({ directory }),
                agent: Agent.defaultID,
                model,
              })
            }),
          )
          const root =
            initial.scope === "global"
              ? path.join(fixture.global.config, "skills")
              : path.join(fixture.directory, ".aigcfroge/skills")
          const target = path.join(root, "review-basics.md")
          const environment = Context.get(fixture.local, Environment.Service)
          expect(yield* isDirectory(environment, root)).toBe(initial.missing === "none")
          if (initial.missing === "config") expect(yield* isDirectory(environment, path.dirname(root))).toBe(false)
          const candidate = Candidate.make({
            ...input,
            relativePath: "review-basics.md",
            triggers: [],
            tags: [],
            content: `Created through ${initial.label}.`,
          })
          const inspected = yield* Effect.forEach(sessions, (session) =>
            fixture
              .request(`/session/${session.id}/skill-asset/inspect`, {
                directory: session.location.directory,
                body: { candidate, scope: initial.scope },
              })
              .pipe(Effect.flatMap(readBody), Effect.map(Schema.decodeUnknownSync(Inspection))),
          )
          const first = sessions[0]
          const second = sessions[1]
          const inspection = inspected[0]
          if (!first || !second || !inspection)
            return yield* Effect.die(new Error("Both Skill Locations and their inspections are required"))
          expect(inspection).toEqual(inspected[1])
          expect(inspection.target).toEqual({ scope: initial.scope, root: AbsolutePath.make(root) })
          expect(yield* isDirectory(environment, root)).toBe(initial.missing === "none")
          const added = yield* nativeReady(fixture, target, candidate.content, directories)
          const createdWatches = yield* watcherReady(
            fixture,
            directories,
            initial.missing === "config"
              ? { type: "entries", path: fixture.directory, names: [".aigcfroge"] }
              : initial.missing === "none"
                ? { type: "directory", path: root }
                : { type: "file", path: root },
          )
          const applied = Schema.decodeUnknownSync(Info)(
            yield* readBody(
              yield* fixture.request(`/session/${first.id}/skill-asset/apply`, {
                directory: first.location.directory,
                body: { candidate, target: inspection.target, baseRevision: inspection.revision, overwrite: false },
              }),
            ),
          )
          yield* added
          expect(applied.target).toEqual(inspection.target)
          expect(applied.revision).toBe(
            Revision.make(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))),
          )
          yield* Effect.forEach(directories, (directory) =>
            Effect.gen(function* () {
              const native = Schema.decodeUnknownSync(nativeResponse)(
                yield* readBody(yield* fixture.request("/api/skill", { directory })),
              )
              expect(native.data.find((skill) => skill.id === "review-basics")).toMatchObject({
                path: AbsolutePath.make(target),
                content: candidate.content,
              })
              expect(
                yield* Effect.promise(() =>
                  Bun.file(path.join(directory, ".aigcfroge/skills/review-basics.md")).exists(),
                ),
              ).toBe(false)
            }),
          )
          yield* consumeSkill(fixture, first, candidate.content)
          const replacement = Candidate.make({
            ...candidate,
            content: `Replaced through the other Location for ${initial.label}.`,
          })
          const changed = yield* nativeReady(fixture, target, replacement.content, directories)
          const replacedWatches = yield* watcherReady(
            fixture,
            directories,
            { type: "directory", path: root },
            createdWatches,
          )
          const updated = Schema.decodeUnknownSync(Info)(
            yield* readBody(
              yield* fixture.request(`/session/${second.id}/skill-asset/apply`, {
                directory: second.location.directory,
                body: {
                  candidate: replacement,
                  target: inspection.target,
                  baseRevision: applied.revision,
                  overwrite: true,
                },
              }),
            ),
          )
          yield* changed
          expect(updated.content).toBe(replacement.content)
          expect(updated.revision).not.toBe(applied.revision)
          yield* consumeSkill(fixture, second, replacement.content, candidate.content)
          const removed = yield* nativeReady(fixture, target, undefined, directories)
          yield* watcherReady(fixture, directories, { type: "directory", path: root }, replacedWatches)
          expect(
            (yield* fixture.request(`/session/${first.id}/skill-asset/delete`, {
              directory: first.location.directory,
              body: { relativePath: candidate.relativePath, target: inspection.target, baseRevision: updated.revision },
            })).status,
          ).toBe(200)
          yield* removed
          expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
          yield* Effect.forEach(sessions, (session) =>
            Effect.gen(function* () {
              const native = Schema.decodeUnknownSync(nativeResponse)(
                yield* readBody(yield* fixture.request("/api/skill", { directory: session.location.directory })),
              )
              expect(native.data.some((skill) => skill.id === "review-basics")).toBe(false)
              expect(
                (yield* fixture.request(`/skill-asset/content?scope=${initial.scope}&path=review-basics.md`, {
                  directory: session.location.directory,
                })).status,
              ).toBe(400)
              expect(
                (yield* fixture.request(`/api/session/${session.id}/prompt`, {
                  directory: session.location.directory,
                  body: { text: "Try the deleted Skill", skills: [{ id: Skill.ID.make("review-basics") }] },
                })).status,
              ).toBe(400)
            }),
          )
          expect(yield* fixture.llm.requests()).toHaveLength(2)
        }),
      ),
    30_000,
  )
}

it.live(
  "keeps the Project native winner after a global save and exposes global fallback after Project deletion",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const projectContent = "Project winner: inspect the repository diff."
        const globalContent = "Global fallback: inspect the shared review checklist."
        const fixture = yield* setup(
          [
            {
              relativePath: "review-basics.md",
              content: `---\nname: review-basics\ndescription: ${input.description}\n---\n${projectContent}`,
            },
          ],
          prepareProject,
        )
        const directories = [
          path.join(fixture.directory, "packages/first"),
          path.join(fixture.directory, "packages/second"),
        ]
        const sessions = yield* Effect.forEach(directories, (directory) =>
          Effect.gen(function* () {
            const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
            yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
            return yield* fixture.sessions.create({
              title: "Native Skill shadow and fallback",
              mode: "chat",
              location: locationRefForRoute({ directory }),
              agent: Agent.defaultID,
              model,
            })
          }),
        )
        const first = sessions[0]
        const second = sessions[1]
        if (!first || !second) return yield* Effect.die(new Error("Both Skill Locations are required"))
        const candidate = Candidate.make({
          ...input,
          content: globalContent,
          relativePath: "review-basics.md",
          triggers: [],
          tags: [],
        })
        const project = Schema.decodeUnknownSync(Inspection)(
          yield* readBody(
            yield* fixture.request(`/session/${first.id}/skill-asset/inspect`, {
              directory: first.location.directory,
              body: { candidate, scope: "project" },
            }),
          ),
        )
        const global = Schema.decodeUnknownSync(Inspection)(
          yield* readBody(
            yield* fixture.request(`/session/${second.id}/skill-asset/inspect`, {
              directory: second.location.directory,
              body: { candidate, scope: "global" },
            }),
          ),
        )
        expect(project.exists).toBe(true)
        expect(global.exists).toBe(false)
        const projectFile = path.join(project.target.root, candidate.relativePath)
        const globalFile = path.join(global.target.root, candidate.relativePath)
        const projectWatches = yield* watcherReady(fixture, directories, {
          type: "directory",
          path: project.target.root,
        })
        const globalWatches = yield* watcherReady(fixture, directories, { type: "file", path: global.target.root })
        const before = fixture.watchers.events.length
        const saved = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${second.id}/skill-asset/apply`, {
              directory: second.location.directory,
              body: { candidate, target: global.target, baseRevision: global.revision, overwrite: false },
            }),
          ),
        )
        expect(saved.target).toEqual(global.target)
        expect(saved.content).toBe(globalContent)
        // Observe the real missing-directory event and the replacement subscription;
        // a shadowed save need not change the effective Skill winner.
        yield* pollWithTimeout(
          Effect.sync(() =>
            directories.every((directory) =>
              fixture.watchers.events
                .slice(before)
                .some(
                  (event) =>
                    event.subscription.location?.directory === directory &&
                    event.subscription.location.workspaceID === undefined &&
                    event.update.path === global.target.root &&
                    globalWatches.includes(event.subscription),
                ),
            )
              ? true
              : undefined,
          ),
          "Both Locations did not observe creation of the global Skill directory",
          "10 seconds",
        )
        yield* watcherReady(fixture, directories, { type: "directory", path: global.target.root }, globalWatches)
        yield* Effect.forEach(directories, (directory) =>
          Effect.gen(function* () {
            const native = Schema.decodeUnknownSync(nativeResponse)(
              yield* readBody(yield* fixture.request("/api/skill", { directory })),
            )
            expect(native.data.find((skill) => skill.id === "review-basics")).toMatchObject({
              path: AbsolutePath.make(projectFile),
              content: projectContent,
            })
            const content = Schema.decodeUnknownSync(Info)(
              yield* readBody(
                yield* fixture.request("/skill-asset/content?scope=global&path=review-basics.md", { directory }),
              ),
            )
            expect(content).toEqual(saved)
          }),
        )
        const retained = yield* consumeSkill(fixture, first, projectContent, globalContent)
        const fallback = yield* nativeReady(fixture, globalFile, globalContent, directories)
        yield* watcherReady(fixture, directories, { type: "directory", path: project.target.root }, projectWatches)
        expect(
          (yield* fixture.request(`/session/${first.id}/skill-asset/delete`, {
            directory: first.location.directory,
            body: { relativePath: candidate.relativePath, target: project.target, baseRevision: project.revision },
          })).status,
        ).toBe(200)
        yield* fallback
        expect(yield* Effect.promise(() => Bun.file(projectFile).exists())).toBe(false)
        expect(
          Revision.make(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(globalFile).arrayBuffer())))),
        ).toBe(saved.revision)
        yield* Effect.forEach(sessions, (session) =>
          Effect.gen(function* () {
            const native = Schema.decodeUnknownSync(nativeResponse)(
              yield* readBody(yield* fixture.request("/api/skill", { directory: session.location.directory })),
            )
            expect(native.data.find((skill) => skill.id === "review-basics")).toMatchObject({
              path: AbsolutePath.make(globalFile),
              content: globalContent,
            })
            yield* consumeSkill(fixture, session, globalContent, projectContent)
          }),
        )
        const context = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${first.id}/context`, { directory: first.location.directory }),
          ),
        )
        expect(context.data.find((message) => message.id === retained.id)).toEqual(retained)
        expect(yield* fixture.llm.requests()).toHaveLength(3)
      }),
    ),
  30_000,
)

for (const conflict of [
  {
    label: "name",
    relativePath: "elsewhere.md",
    existingName: "review-basics",
    exists: false,
    nameConflict: true,
    pathConflict: false,
  },
  {
    label: "path",
    relativePath: "review-basics.md",
    existingName: "another-skill",
    exists: true,
    nameConflict: false,
    pathConflict: true,
  },
]) {
  it.live(
    `retains ${conflict.label} conflict facts through real proposer Tool.Success and HTTP readback`,
    () =>
      withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
        Effect.gen(function* () {
          const content = `---\nname: ${conflict.existingName}\ndescription: Existing Skill\n---\nExisting content.`
          const fixture = yield* setup([{ relativePath: conflict.relativePath, content }])
          const session = yield* fixture.sessions.create({
            title: "Skill conflict review",
            mode: "chat",
            location: locationRefForRoute({ directory: fixture.directory }),
            agent: Agent.defaultID,
            model,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          })
          yield* fixture.llm.push(
            TestLLM.tool("propose-conflict", "propose_skill_asset", input),
            TestLLM.text("Review conflict facts", "conflict-review"),
          )
          const conflictPrompt = yield* fixture.request(`/api/session/${session.id}/prompt`, {
            body: { text: "Check this Skill proposal for conflicts" },
          })
          expect(conflictPrompt.status).toBe(200)
          const conflictInput = Schema.decodeUnknownSync(promptResponse)(yield* readBody(conflictPrompt))
          yield* awaitWithTimeout(fixture.llm.wait(2), "Conflict proposal did not finish", "10 seconds")
          yield* awaitInputCompletion(
            fixture,
            session.id,
            conflictInput.data.id,
            "Conflict proposal input did not complete",
          )
          const messages = Schema.decodeUnknownSync(contextResponse)(
            yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
          )
          const saved = proposal(messages.data, "propose-conflict")
          expect(saved.input).toEqual(input)
          expect(saved.facts).toEqual({
            relativePath: "review-basics.md",
            exists: conflict.exists,
            revision: Schema.decodeUnknownSync(BaseRevision)(
              conflict.exists ? Hash.sha256(Buffer.from(content)) : null,
            ),
            nameConflict: conflict.nameConflict,
            pathConflict: conflict.pathConflict,
            target: { scope: "project", root: AbsolutePath.make(path.join(fixture.directory, ".aigcfroge/skills")) },
          })
          const inspected = Schema.decodeUnknownSync(Inspection)(
            yield* readBody(
              yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
                body: {
                  candidate: { ...input, relativePath: saved.facts.relativePath, triggers: [], tags: [] },
                  scope: "location",
                },
              }),
            ),
          )
          expect(inspected).toEqual({
            ...saved.facts,
            target: { scope: "location", root: AbsolutePath.make(path.join(fixture.directory, ".aigcfroge/skills")) },
          })
          expect(
            yield* Effect.promise(() =>
              Bun.file(path.join(fixture.directory, ".aigcfroge/skills", conflict.relativePath)).text(),
            ),
          ).toBe(content)
          expect(
            yield* Effect.promise(() =>
              Bun.file(path.join(fixture.directory, ".aigcfroge/skills/review-basics.md")).exists(),
            ),
          ).toBe(conflict.exists)
          const readback = Schema.decodeUnknownSync(Info)(
            yield* readBody(
              yield* fixture.request(`/skill-asset/content?path=${encodeURIComponent(conflict.relativePath)}`),
            ),
          )
          expect(readback).toMatchObject({
            relativePath: conflict.relativePath,
            name: conflict.existingName,
            content: "Existing content.",
            revision: Hash.sha256(Buffer.from(content)),
          })
          expect(yield* fixture.llm.requests()).toHaveLength(2)
        }),
      ),
    30_000,
  )
}

it.live(
  "inspects and writes selected Skill owners while omitted scope and target stay at the Session Location",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Selected Skill owners",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-basics.md", triggers: [], tags: [] })
        const legacy = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
              directory,
              body: { candidate: { ...candidate, content: "Legacy Location body." }, overwrite: false },
            }),
          ),
        )
        expect(legacy.content).toBe("Legacy Location body.")
        expect(legacy).not.toHaveProperty("target")
        yield* Effect.forEach(
          [
            {
              scope: "project",
              root: path.join(fixture.directory, ".aigcfroge/skills"),
              content: "Project body.\n\nPreserve `backticks`, $HOME, and 中文.",
            },
            {
              scope: "global",
              root: path.join(fixture.global.config, "skills"),
              content: "Global body.\n\nKeep this owner's content independent.",
            },
          ] as const,
          (owner) =>
            Effect.gen(function* () {
              const target = { scope: owner.scope, root: AbsolutePath.make(owner.root) }
              const file = path.join(owner.root, candidate.relativePath)
              const inspection = Schema.decodeUnknownSync(Inspection)(
                yield* readBody(
                  yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
                    directory,
                    body: { candidate: { ...candidate, content: owner.content }, scope: owner.scope },
                  }),
                ),
              )
              expect(inspection).toEqual({
                relativePath: candidate.relativePath,
                exists: false,
                revision: null,
                nameConflict: false,
                pathConflict: false,
                target,
              })
              expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
              const empty = Schema.decodeUnknownSync(listResponse)(
                yield* readBody(yield* fixture.request(`/skill-asset?scope=${owner.scope}`, { directory })),
              )
              expect(empty).toEqual({ assets: [], invalid: [], target })
              const applied = Schema.decodeUnknownSync(Info)(
                yield* readBody(
                  yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
                    directory,
                    body: {
                      candidate: { ...candidate, content: owner.content },
                      target: inspection.target,
                      overwrite: false,
                    },
                  }),
                ),
              )
              expect(applied).toMatchObject({
                relativePath: candidate.relativePath,
                content: owner.content,
                target,
              })
              const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
              expect(applied.revision).toBe(Revision.make(Hash.sha256(Buffer.from(bytes))))
              const listed = Schema.decodeUnknownSync(listResponse)(
                yield* readBody(yield* fixture.request(`/skill-asset?scope=${owner.scope}`, { directory })),
              )
              expect(listed).toMatchObject({
                target,
                invalid: [],
                assets: [{ name: candidate.name, relativePath: candidate.relativePath, revision: applied.revision }],
              })
              expect(listed.assets).toHaveLength(1)
              expect(listed.assets[0]).not.toHaveProperty("target")
              const readback = Schema.decodeUnknownSync(Info)(
                yield* readBody(
                  yield* fixture.request(`/skill-asset/content?scope=${owner.scope}&path=${candidate.relativePath}`, {
                    directory,
                  }),
                ),
              )
              expect(readback).toEqual(applied)
              const reinspection = Schema.decodeUnknownSync(Inspection)(
                yield* readBody(
                  yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
                    directory,
                    body: { candidate: { ...candidate, content: "Reviewed replacement." }, scope: owner.scope },
                  }),
                ),
              )
              expect(reinspection).toEqual({
                relativePath: candidate.relativePath,
                exists: true,
                revision: applied.revision,
                nameConflict: false,
                pathConflict: false,
                target,
              })
              expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
              expect(
                Schema.decodeUnknownSync(listResponse)(
                  yield* readBody(
                    yield* fixture.request(`/skill-asset?scope=${owner.scope}&search=unrelated`, { directory }),
                  ),
                ),
              ).toEqual({ assets: [], invalid: [], target })
            }),
        )
        const local = Schema.decodeUnknownSync(Info)(
          yield* readBody(yield* fixture.request(`/skill-asset/content?path=${candidate.relativePath}`, { directory })),
        )
        expect(local).toEqual(legacy)
        const selectedLocal = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/skill-asset/content?scope=location&path=${candidate.relativePath}`, { directory }),
          ),
        )
        expect(selectedLocal).toEqual({
          ...legacy,
          target: { scope: "location", root: AbsolutePath.make(path.join(directory, ".aigcfroge/skills")) },
        })
        const listedLocal = Schema.decodeUnknownSync(listResponse)(
          yield* readBody(yield* fixture.request("/skill-asset", { directory })),
        )
        expect(listedLocal).not.toHaveProperty("target")
        expect(listedLocal.assets).toHaveLength(1)
        expect(
          Schema.decodeUnknownSync(contextResponse)(
            yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`, { directory })),
          ).data,
        ).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "keeps selected target validation separate from Session placement and cross-Location Skill CAS",
  () =>
    withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const other = path.join(fixture.directory, "packages/second")
        const session = yield* fixture.sessions.create({
          title: "First selected Skill writer",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const second = yield* fixture.sessions.create({
          title: "Second selected Skill writer",
          mode: "chat",
          location: locationRefForRoute({ directory: other }),
          agent: Agent.defaultID,
          model,
        })
        const workspaceSession = yield* fixture.sessions.create({
          title: "Skill Session with explicit workspace placement",
          mode: "chat",
          location: locationRefForRoute({ directory, workspaceID: Workspace.ID.create() }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-basics.md", triggers: [], tags: [] })
        const inspected = Schema.decodeUnknownSync(Inspection)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
              directory,
              body: { candidate, scope: "project" },
            }),
          ),
        )
        const otherInspection = Schema.decodeUnknownSync(Inspection)(
          yield* readBody(
            yield* fixture.request(`/session/${second.id}/skill-asset/inspect`, {
              directory: other,
              body: { candidate, scope: "project" },
            }),
          ),
        )
        expect(otherInspection).toEqual(inspected)
        expect(inspected).toMatchObject({
          exists: false,
          revision: null,
          target: { scope: "project", root: path.join(fixture.directory, ".aigcfroge/skills") },
        })
        yield* Effect.forEach(
          [
            { endpoint: "inspect", body: { candidate, scope: "project" } },
            { endpoint: "apply", body: { candidate, target: inspected.target, overwrite: false } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target: inspected.target } },
          ],
          (operation) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/session/${session.id}/skill-asset/${operation.endpoint}`, {
                  directory,
                  authenticated: false,
                  body: operation.body,
                })).status,
              ).toBe(401)
              const misplaced = yield* fixture.request(`/session/${session.id}/skill-asset/${operation.endpoint}`, {
                directory: other,
                body: operation.body,
              })
              expect(misplaced.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => misplaced.json())).toMatchObject({
                _tag: "ConflictError",
                resource: session.id,
              })
              const missingWorkspace = yield* fixture.request(
                `/session/${workspaceSession.id}/skill-asset/${operation.endpoint}`,
                { directory, body: operation.body },
              )
              expect(missingWorkspace.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => missingWorkspace.json())).toMatchObject({
                _tag: "ConflictError",
                resource: workspaceSession.id,
              })
            }),
        )
        expect(
          (yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
            directory,
            body: { candidate: { name: candidate.name }, scope: "project" },
          })).status,
        ).toBe(400)
        yield* Effect.forEach(["different.md", "../escape.md"], (relativePath) =>
          Effect.gen(function* () {
            expect(
              (yield* fixture.request(`/session/${session.id}/skill-asset/inspect`, {
                directory,
                body: { candidate: { ...candidate, relativePath }, scope: "project" },
              })).status,
            ).toBe(400)
            const invalid = yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
              directory,
              body: { candidate: { ...candidate, relativePath }, target: inspected.target, overwrite: false },
            })
            expect(invalid.status).toBe(400)
            expect(yield* Effect.promise<unknown>(() => invalid.json())).toMatchObject({
              _tag: "InvalidRequestError",
              kind: "invalid_candidate",
            })
          }),
        )
        const file = path.join(inspected.target.root, candidate.relativePath)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        const raced = yield* Effect.all(
          [
            fixture.request(`/session/${session.id}/skill-asset/apply`, {
              directory,
              body: {
                candidate: { ...candidate, content: "First Location body." },
                target: inspected.target,
                overwrite: false,
              },
            }),
            fixture.request(`/session/${second.id}/skill-asset/apply`, {
              directory: other,
              body: {
                candidate: { ...candidate, content: "Second Location body." },
                target: otherInspection.target,
                overwrite: false,
              },
            }),
          ],
          { concurrency: "unbounded" },
        )
        expect(raced.map((response) => response.status).sort()).toEqual([200, 409])
        const winner = raced.find((response) => response.status === 200)
        const loser = raced.find((response) => response.status === 409)
        if (!winner || !loser)
          return yield* Effect.die(new Error("Expected one successful writer and one CAS conflict"))
        const applied = Schema.decodeUnknownSync(Info)(yield* readBody(winner))
        expect(yield* Effect.promise<unknown>(() => loser.json())).toMatchObject({
          _tag: "ConflictError",
          resource: candidate.relativePath,
        })
        expect(applied.target).toEqual(inspected.target)
        const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
        expect(applied.revision).toBe(Revision.make(Hash.sha256(Buffer.from(bytes))))
        yield* Effect.forEach([directory, other], (location) =>
          Effect.gen(function* () {
            expect(
              Schema.decodeUnknownSync(Info)(
                yield* readBody(
                  yield* fixture.request(`/skill-asset/content?scope=project&path=${candidate.relativePath}`, {
                    directory: location,
                  }),
                ),
              ),
            ).toEqual(applied)
          }),
        )
        yield* Effect.forEach(
          [
            { scope: "project", root: path.join(directory, ".aigcfroge/skills") },
            { scope: "global", root: inspected.target.root },
            { scope: "location", root: inspected.target.root },
            { scope: "project", root: path.join(fixture.other, ".aigcfroge/skills") },
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
                  const mismatch = yield* fixture.request(`/session/${session.id}/skill-asset/${operation.endpoint}`, {
                    directory,
                    body: operation.body,
                  })
                  expect(mismatch.status).toBe(400)
                  expect(yield* Effect.promise<unknown>(() => mismatch.json())).toMatchObject({
                    _tag: "InvalidRequestError",
                    field: "target",
                    kind: "target_mismatch",
                  })
                }),
            ),
        )
        expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
        expect(
          yield* Effect.promise(() =>
            Bun.file(path.join(fixture.other, ".aigcfroge/skills", candidate.relativePath)).exists(),
          ),
        ).toBe(false)
        const replacement = { ...candidate, content: "Updated after both Locations inspected the same revision." }
        const updated = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/skill-asset/apply`, {
              directory,
              body: {
                candidate: replacement,
                target: inspected.target,
                baseRevision: applied.revision,
                overwrite: true,
              },
            }),
          ),
        )
        expect(updated.content).toBe(replacement.content)
        expect(updated.target).toEqual(inspected.target)
        expect(updated.revision).not.toBe(applied.revision)
        yield* Effect.forEach(
          [
            {
              endpoint: "apply",
              body: { candidate, target: inspected.target, baseRevision: applied.revision, overwrite: true },
            },
            {
              endpoint: "delete",
              body: { relativePath: candidate.relativePath, target: inspected.target, baseRevision: applied.revision },
            },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target: inspected.target } },
          ],
          (operation) =>
            Effect.gen(function* () {
              const stale = yield* fixture.request(`/session/${second.id}/skill-asset/${operation.endpoint}`, {
                directory: other,
                body: operation.body,
              })
              expect(stale.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => stale.json())).toMatchObject({
                _tag: "ConflictError",
                resource: candidate.relativePath,
              })
            }),
        )
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
          updated.revision,
        )
        expect(
          (yield* fixture.request(`/session/${second.id}/skill-asset/delete`, {
            directory: other,
            body: { relativePath: candidate.relativePath, target: inspected.target, baseRevision: updated.revision },
          })).ok,
        ).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        yield* Effect.forEach([directory, other], (location) =>
          Effect.gen(function* () {
            expect(
              (yield* fixture.request(`/skill-asset/content?scope=project&path=${candidate.relativePath}`, {
                directory: location,
              })).status,
            ).toBe(400)
          }),
        )
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live("isolates an invalid fallback Skill name from public catalog reads", () =>
  Effect.gen(function* () {
    const valid = "a".repeat(80)
    const invalid = "b".repeat(81)
    const fixture = yield* setup([
      { relativePath: valid + ".md", content: "---\ndescription: Fallback name\n---\nBoundary content." },
      { relativePath: invalid + ".md", content: "---\ndescription: Fallback name\n---\nInvalid content." },
      { relativePath: "short.md", content: "---\ndescription: Fallback name\n---\nShort content." },
      { relativePath: "null.md", content: "---\nname: null\ndescription: Fallback name\n---\nNull name." },
      { relativePath: "empty.md", content: '---\nname: ""\ndescription: Fallback name\n---\nEmpty name.' },
    ])
    const listed = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/skill-asset")))
    expect(listed.assets.map((asset) => asset.name).sort()).toEqual([valid, "short"])
    expect(listed.invalid.map((entry) => [entry.relativePath, entry.errorTag]).sort()).toEqual([
      [invalid + ".md", "bad_frontmatter"],
      ["empty.md", "bad_frontmatter"],
      ["null.md", "bad_frontmatter"],
    ])
    const content = Schema.decodeUnknownSync(Info)(
      yield* readBody(yield* fixture.request(`/skill-asset/content?path=${encodeURIComponent(valid + ".md")}`)),
    )
    expect(content.name).toBe(valid)
    expect(content.content).toBe("Boundary content.")
    expect((yield* fixture.request(`/skill-asset/content?path=${encodeURIComponent(invalid + ".md")}`)).status).toBe(
      400,
    )
    expect((yield* fixture.request("/skill-asset/content?path=null.md")).status).toBe(400)
    expect((yield* fixture.request("/skill-asset/content?path=empty.md")).status).toBe(400)
    expect(yield* fixture.llm.requests()).toHaveLength(0)
  }),
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

function proposal(messages: readonly SessionMessage.Info[], id: string) {
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : []))
    .find((part) => part.id === id && part.name === "propose_skill_asset")
  if (!tool) throw new Error("Proposer Tool result missing")
  if (tool.state.status === "error")
    throw new Error(`Proposer Tool failed (${tool.state.error.type}): ${tool.state.error.message}`)
  if (tool.state.status !== "completed") throw new Error(`Proposer Tool is ${tool.state.status}`)
  return {
    input: tool.state.input,
    metadata: tool.state.metadata,
    facts: Schema.decodeUnknownSync(Inspection)(tool.state.metadata),
  }
}

const readBody = (response: Response) =>
  Effect.gen(function* () {
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
  target: string,
  content: string | undefined,
  directories: readonly string[] = [fixture.directory],
) =>
  Effect.gen(function* () {
    const waits = yield* Effect.forEach(directories, (directory) =>
      Effect.gen(function* () {
        const local = yield* fixture.locations.contextEffect(locationRefForRoute({ directory }))
        yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
        const location = Context.get(local, Location.Service)
        const skills = Context.get(local, Skill.Service)
        const signal = yield* Deferred.make<void>()
        const present = skills
          .get(Skill.ID.make("review-basics"))
          .pipe(
            Effect.map((skill) =>
              content === undefined
                ? skill === undefined
                : skill !== undefined && path.resolve(skill.path) === path.resolve(target) && skill.content === content,
            ),
          )
        const unsubscribe = yield* fixture.bus.listen((event) => {
          if (
            event.type !== Skill.Event.Updated.type ||
            event.location?.directory !== location.directory ||
            event.location.workspaceID !== location.workspaceID
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
              `Native Skill state did not match the HTTP write in ${directory}`,
              "10 seconds",
            ),
          ),
        )
      }),
    )
    return awaitWithTimeout(
      Effect.all(waits, { concurrency: "unbounded" }),
      "Real Skill watchers did not publish the expected updates for both Locations",
      "10 seconds",
    )
  })

const watcherReady = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  directories: readonly string[],
  expected: Watcher.WatchInput,
  previous: readonly AssetHttpFixture.WatchedSubscription[] = [],
) =>
  Effect.gen(function* () {
    const owners = yield* Effect.forEach(directories, (directory) =>
      fixture.locations
        .contextEffect(locationRefForRoute({ directory }))
        .pipe(Effect.map((local) => Context.get(local, Location.Service))),
    )
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
            const prior = previous.find(
              (item) => item.location?.directory === owner.directory && item.location.workspaceID === owner.workspaceID,
            )
            if (prior && subscription.generation <= prior.generation) return false
            if (expected.type === "entries")
              return (
                subscription.input.type === "entries" &&
                expected.names.every(
                  (name) => subscription.input.type === "entries" && subscription.input.names.includes(name),
                )
              )
            if (expected.type === "directory")
              return subscription.input.type === "directory" && (subscription.input.ignore?.length ?? 0) === 0
            return true
          }),
        )
        return current.every((item): item is AssetHttpFixture.WatchedSubscription => item !== undefined)
          ? current
          : undefined
      }),
      `Native ${expected.type} watch was not ready for both Locations at ${expected.path}`,
      "10 seconds",
    )
    expect(ready.map((item) => item.location?.directory)).toEqual(
      directories.map((directory) => AbsolutePath.make(directory)),
    )
    expect(ready.map((item) => item.location?.workspaceID)).toEqual(owners.map((owner) => owner.workspaceID))
    expect(ready.every((item) => fixture.watchers.active.has(item))).toBe(true)
    return ready
  })

const consumeSkill = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  session: Session.Info,
  content: string,
  previous?: string,
) =>
  Effect.gen(function* () {
    const count = (yield* fixture.llm.requests()).length
    yield* fixture.llm.push(TestLLM.text("Skill consumed", `consume-${count}`))
    const admitted = Schema.decodeUnknownSync(promptResponse)(
      yield* readBody(
        yield* fixture.request(`/api/session/${session.id}/prompt`, {
          directory: session.location.directory,
          body: { text: "Use the selected Skill", skills: [{ id: Skill.ID.make("review-basics") }] },
        }),
      ),
    )
    yield* awaitWithTimeout(
      fixture.llm.wait(count + 1),
      "Native Skill did not reach the ordinary Session runner",
      "10 seconds",
    )
    yield* awaitInputCompletion(fixture, session.id, admitted.data.id, "Native Skill input did not complete")
    const request = (yield* fixture.llm.requests())[count]
    if (!request) return yield* Effect.die(new Error("Native Skill runner request missing"))
    const latest = request.messages.filter((message) => message.role === "user").at(-1)
    const text = latest?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    expect(text).toContain('<skill_content name="review-basics">')
    expect(text).toContain(content)
    if (previous) expect(text).not.toContain(previous)
    const context = Schema.decodeUnknownSync(contextResponse)(
      yield* readBody(
        yield* fixture.request(`/api/session/${session.id}/context`, { directory: session.location.directory }),
      ),
    )
    const user = context.data.find((message) => message.id === admitted.data.id)
    if (!user || user.type !== "user")
      return yield* Effect.die(new Error("Persisted native Skill user message missing"))
    expect(user).toMatchObject({
      type: "user",
      skills: [{ id: Skill.ID.make("review-basics"), text: expect.stringContaining(content) }],
    })
    return user
  })
