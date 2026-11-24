import { describe, expect } from "bun:test"
import path from "node:path"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Location } from "@omnixa/core/location"
import { Session } from "@omnixa/core/session"
import { Tool } from "@omnixa/core/tool"
import { ListAssetsTool } from "@omnixa/core/tool/list-assets"
import { AssetPublication } from "@omnixa/core/asset-publication"
import { Database } from "@omnixa/core/database/database"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionTable } from "@omnixa/core/session/sql"
import { SessionStore } from "@omnixa/core/session/store"
import { LocationMutation } from "@omnixa/core/location-mutation"
import { Skill } from "@omnixa/core/skill"
import { AbsolutePath } from "@omnixa/core/schema"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { FSUtil } from "@omnixa/util/fs-util"
import { tempLocationLayer } from "./fixture/location"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      FSUtil.node,
      Location.node,
      LocationMutation.node,
      Global.node,
      Database.node,
      SessionStore.node,
      Skill.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Global.node.replace(tempGlobalLayer),
      Database.node.replace(Database.layer({ path: ":memory:" }).pipe(Layer.provide(tempGlobalLayer))),
    ],
  ),
)
const permissionTest = process.platform === "win32" || process.getuid?.() === 0 ? it.live.skip : it.live
const call = (input: typeof ListAssetsTool.Input.Type = {}, id = "call-list-assets") => ({
  sessionID: Session.ID.make("ses_list_assets_test"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: ListAssetsTool.name, input },
})
const setup = Effect.gen(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const registry = yield* Tool.Service
  yield* registerToolPlugin(ListAssetsTool.Plugin)
  return { location, fs, registry }
})

describe("list_assets registered tool", () => {
  it.live("preserves raw output while publishing JSON metadata only for a matching ordinary Session", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const database = yield* Database.Service
      const skills = yield* Skill.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: f.location.directory, sandboxes: [] })
        .run()
      yield* database.db
        .insert(SessionTable)
        .values({
          id: call().sessionID,
          project_id: Project.ID.global,
          directory: f.location.directory,
          slug: "list-assets",
          title: "Asset publication",
          version: "test",
          mode: "work",
          agent: "meta",
        })
        .run()
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, ".omnixa/skills/craft.md"),
        "---\nkind: skill\nname: Craft definition\ndescription: Description\n---\nPRIVATE_DEFINITION_BODY",
      )
      yield* skills.transform((editor) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("runtime-craft"),
            name: Skill.Name.make("Runtime craft"),
            path: AbsolutePath.make("/virtual/craft"),
            content: "PRIVATE_RUNTIME_BODY",
          }),
        ),
      )
      const result = yield* executeTool(f.registry, call())
      expect(result.output).toEqual({
        assets: [{ kind: "skill", name: "craft", relativePath: ".omnixa/skills/craft.md" }],
      })
      const publication = Schema.decodeUnknownSync(AssetPublication.Json)(result.metadata?.publication)
      expect(publication.runtime.skills[0].id).toBe(Skill.ID.make("runtime-craft"))
      expect(
        publication.definitions.find((source) => source.kind === "skill" && source.target.scope === "location")
          ?.assets[0].name,
      ).toBe("Craft definition")
      expect(JSON.stringify(result.metadata)).not.toContain("PRIVATE_")
      expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Registered skills:") }])
      yield* registerToolPlugin(ListAssetsTool.Plugin).pipe(
        Effect.provideService(
          FSUtil.Service,
          FSUtil.Service.of({ ...f.fs, scan: () => Effect.die("Frozen or unmatched Session read live sources") }),
        ),
      )
      yield* database.db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, call().sessionID)).run()
      expect(yield* executeTool(f.registry, call({}, "call-custom"))).toEqual({
        status: "completed",
        output: result.output,
        content: [{ type: "text", text: "Found 1 asset(s):\n- **skill**: craft" }],
      })
      yield* database.db
        .update(SessionTable)
        .set({ mode: "work", directory: "/another-location" })
        .where(eq(SessionTable.id, call().sessionID))
        .run()
      expect((yield* executeTool(f.registry, call({}, "call-unmatched"))).metadata).toBeUndefined()
    }),
  )
  it.live("keeps missing optional directories as a legitimate empty catalog", () =>
    Effect.gen(function* () {
      const f = yield* setup
      expect((yield* toolDefinitions(f.registry)).some((tool) => tool.name === ListAssetsTool.name)).toBe(true)
      expect(yield* executeTool(f.registry, call())).toMatchObject({
        status: "completed",
        output: { assets: [] },
        content: [{ type: "text", text: "No assets found." }],
      })
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa"))
      expect(yield* executeTool(f.registry, call({}, "call-empty-root"))).toMatchObject({
        status: "completed",
        output: { assets: [] },
      })
    }),
  )

  it.live("preserves names, relative paths, kind filtering and asset order", () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/prompts"), { recursive: true })
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/skills/toolkit"), { recursive: true })
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/agents"))
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/mcps"))
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/workflows"))
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/prompts/a.md"), "a")
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/mcps/b.json"), "{}")
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/workflows/c.yaml"), "c: true")
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/prompts/.hidden.md"), "hidden")
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/agents/helper.agent.md"), "helper")
      expect((yield* executeTool(f.registry, call())).output).toEqual({
        assets: [
          { kind: "prompt", name: "a", relativePath: ".omnixa/prompts/a.md" },
          { kind: "skill", name: "toolkit", relativePath: ".omnixa/skills/toolkit" },
          { kind: "mcp", name: "b", relativePath: ".omnixa/mcps/b.json" },
          { kind: "agent", name: "helper", relativePath: ".omnixa/agents/helper.agent.md" },
          { kind: "workflow", name: "c", relativePath: ".omnixa/workflows/c.yaml" },
        ],
      })
      expect((yield* executeTool(f.registry, call({ kind: "agent" }))).output).toEqual({
        assets: [{ kind: "agent", name: "helper", relativePath: ".omnixa/agents/helper.agent.md" }],
      })
      expect((yield* executeTool(f.registry, call({ kind: "unknown" }))).output).toEqual({ assets: [] })
    }),
  )

  it.live("observes additions and removals through the same registered executor", () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".omnixa/prompts"), { recursive: true })
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/prompts/first.md"), "first")
      expect((yield* executeTool(f.registry, call({}, "call-first"))).output).toEqual({
        assets: [{ kind: "prompt", name: "first", relativePath: ".omnixa/prompts/first.md" }],
      })
      yield* f.fs.remove(path.join(f.location.directory, ".omnixa/prompts/first.md"))
      yield* f.fs.writeFileString(path.join(f.location.directory, ".omnixa/prompts/second.md"), "second")
      expect((yield* executeTool(f.registry, call({}, "call-second"))).output).toEqual({
        assets: [{ kind: "prompt", name: "second", relativePath: ".omnixa/prompts/second.md" }],
      })
    }),
  )
  ;["missing", "file"].forEach((state) => {
    it.live(`fails when the Location root is ${state}`, () =>
      Effect.gen(function* () {
        const f = yield* setup
        yield* f.fs.remove(f.location.directory, { recursive: true })
        if (state === "file") yield* f.fs.writeFileString(f.location.directory, "not a directory")
        expect(yield* executeTool(f.registry, call())).toMatchObject({
          status: "error",
          error: { type: "tool.execution", message: expect.stringContaining("Failed to list assets:") },
        })
      }),
    )
  })
  ;[".omnixa", ".omnixa/prompts"].forEach((relativePath) => {
    it.live(`fails for a non-directory ${relativePath}`, () =>
      Effect.gen(function* () {
        const f = yield* setup
        yield* f.fs.makeDirectory(path.dirname(path.join(f.location.directory, relativePath)), { recursive: true })
        yield* f.fs.writeFileString(path.join(f.location.directory, relativePath), "not a directory")
        expect(yield* executeTool(f.registry, call())).toMatchObject({
          status: "error",
          error: { type: "tool.execution", message: expect.stringContaining("Failed to list assets:") },
        })
      }),
    )
  })

  permissionTest("fails on unreadable asset directories", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const directory = path.join(f.location.directory, ".omnixa/prompts")
      yield* f.fs.makeDirectory(directory, { recursive: true })
      yield* Effect.acquireRelease(f.fs.chmod(directory, 0), () => f.fs.chmod(directory, 0o700).pipe(Effect.orDie))
      expect(yield* executeTool(f.registry, call())).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: expect.stringContaining("Failed to list assets:") },
      })
    }),
  )
  ;[
    { name: "defects", effect: Effect.die("scan defect"), matches: Cause.hasDies },
    { name: "interruption", effect: Effect.interrupt, matches: Cause.hasInterruptsOnly },
  ].forEach((failure) => {
    it.live(`preserves ${failure.name} at the captured filesystem boundary`, () =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const registry = yield* Tool.Service
        yield* registerToolPlugin(ListAssetsTool.Plugin).pipe(
          Effect.provideService(FSUtil.Service, FSUtil.Service.of({ ...fs, readDirectory: () => failure.effect })),
        )
        const result = yield* Effect.exit(executeTool(registry, call()))
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) expect(failure.matches(result.cause)).toBe(true)
      }),
    )
  })
})
