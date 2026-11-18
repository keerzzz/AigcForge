import { describe, expect } from "bun:test"
import path from "node:path"
import { Cause, Effect, Exit, Schema } from "effect"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { Hash } from "@aigcfroge/util/hash"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Definition } from "@aigcfroge/schema/asset-publication"
import { AssetPublication } from "../src/asset-publication"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { AbsolutePath } from "../src/schema"
import { Skill } from "../src/skill"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([FSUtil.node, Global.node, Location.node, LocationMutation.node]), [
    Global.node.replace(tempGlobalLayer),
    Location.node.replace(tempLocationLayer),
  ]),
)
const posixTest = process.platform === "win32" ? it.live.skip : it.live
const sources = Effect.gen(function* () {
  return {
    fs: yield* FSUtil.Service,
    global: yield* Global.Service,
    location: yield* Location.Service,
    mutation: yield* LocationMutation.Service,
  }
})

describe("shared asset publication", () => {
  it.live("reports a disappeared source base rather than a successful empty inventory", () =>
    Effect.gen(function* () {
      const f = yield* sources
      yield* f.fs.remove(f.global.config, { recursive: true })
      const missing = yield* AssetPublication.read(f, [])
      expect(missing.errors.map((source) => [source.kind, source.scope, source.error.reason])).toEqual([
        ["prompt", "global", "reload_failed"],
        ["skill", "global", "reload_failed"],
        ["command", "global", "reload_failed"],
      ])
      expect(missing.definitions.some((source) => source.target.scope === "global")).toBe(false)
      yield* f.fs.writeFileString(f.global.config, "not a source directory")
      expect(
        (yield* AssetPublication.read(f, [])).errors.every((source) => source.error.reason === "path_escape"),
      ).toBe(true)
    }),
  )
  it.live("reads existing owners per scope with raw revisions and no definition bodies", () =>
    Effect.gen(function* () {
      const f = yield* sources
      const prompt =
        "\uFEFF---\r\nkind: prompt\r\nname: Source prompt\r\ndescription: Description\r\n---\r\nPRIVATE_PROMPT_BODY\r\n"
      yield* Effect.forEach(
        [
          ["prompts/first.md", prompt],
          [
            "skills/craft.md",
            "---\nkind: skill\nname: Craft definition\ndescription: Description\n---\nPRIVATE_SKILL_BODY",
          ],
          [
            "commands/check.md",
            "---\nkind: command\nname: Check\ndescription: Description\ninvocation: /check\n---\nPRIVATE_COMMAND_BODY",
          ],
          ["agents/coder.md", "---\nkind: agent\nname: Coder\ndescription: Description\n---\nPRIVATE_AGENT_BODY"],
          [
            "mcps/tool.md",
            "---\nkind: mcp\nname: Tool\ndescription: Description\ncommand: node\n---\nPRIVATE_MCP_BODY",
          ],
          ["workflows/flow.yaml", "kind: workflow\nname: Flow\ndescription: Description\nversion: '1'\nsteps: []\n"],
          ["plugins/extension.plugin.yaml", "kind: plugin\nname: Extension\ndescription: Description\nversion: '1'\n"],
        ],
        ([relativePath, content]) =>
          f.fs.writeWithDirs(path.join(f.location.directory, ".aigcfroge", relativePath), content),
      )
      yield* f.fs.writeWithDirs(
        path.join(f.global.config, "prompts/global.md"),
        prompt.replace("Source prompt", "Global prompt"),
      )
      const skills = [
        Skill.Info.make({
          id: Skill.ID.make("runtime-id"),
          name: Skill.Name.make("Registered name"),
          path: AbsolutePath.make("/virtual/runtime"),
          content: "PRIVATE_RUNTIME_BODY",
          autoinvoke: false,
        }),
      ]
      const scans: string[] = []
      const publication = yield* AssetPublication.read(
        {
          ...f,
          fs: FSUtil.Service.of({
            ...f.fs,
            scan: (pattern, options) => {
              scans.push(options?.cwd + ":" + pattern)
              return f.fs.scan(pattern, options)
            },
          }),
        },
        skills,
      )
      expect(publication.errors).toEqual([])
      expect(publication.definitions).toHaveLength(13)
      expect(
        publication.definitions.filter((source) => source.target.scope === "location").map((source) => source.kind),
      ).toEqual(["prompt", "skill", "command", "agent", "mcp", "workflow", "plugin"])
      expect(
        publication.definitions
          .filter((source) => source.target.scope === "location")
          .every((source) => source.assets.length === 1 && source.invalid.length === 0),
      ).toBe(true)
      const locationPrompt = publication.definitions.find(
        (source) => source.kind === "prompt" && source.target.scope === "location",
      )
      expect(locationPrompt?.assets[0]).toMatchObject({
        name: "Source prompt",
        relativePath: "first.md",
        revision: Hash.sha256(Buffer.from(prompt)),
      })
      expect(
        publication.definitions.find((source) => source.kind === "prompt" && source.target.scope === "global")
          ?.assets[0].name,
      ).toBe("Global prompt")
      expect(scans).toHaveLength(11)
      const json = Schema.encodeSync(AssetPublication.Json)(publication)
      expect(Schema.decodeUnknownSync(AssetPublication.Json)(JSON.parse(JSON.stringify(json)))).toEqual(publication)
      const rendered = AssetPublication.toModelAssets(publication, skills)
        .map((row) => row.name)
        .join("\n")
      expect(JSON.stringify(json)).not.toContain("PRIVATE_")
      expect(rendered).not.toContain("PRIVATE_")
      expect(rendered).toContain('"id":"runtime-id"')
    }),
  )

  it.live("separates invalid conflicts and source failures from legitimate empty owners", () =>
    Effect.gen(function* () {
      const f = yield* sources
      const command = "---\nkind: command\nname: Repeated\ndescription: Description\ninvocation: /repeated\n---\nBody"
      yield* f.fs.writeWithDirs(path.join(f.location.directory, ".aigcfroge/commands/one.md"), command)
      yield* f.fs.writeWithDirs(path.join(f.location.directory, ".aigcfroge/commands/two.md"), command)
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, ".aigcfroge/prompts/broken.md"),
        "---\nkind: prompt\nname: Broken\ndescription: Description\n---\n" + "x".repeat(100001),
      )
      yield* f.fs.writeWithDirs(path.join(f.location.directory, ".aigcfroge/agents/coder.md"), "unread")
      const publication = yield* AssetPublication.read(
        {
          ...f,
          fs: FSUtil.Service.of({
            ...f.fs,
            scan: (pattern, options) =>
              options?.cwd?.endsWith("/agents")
                ? Effect.fail(new FSUtil.FileSystemError({ method: "scan", cause: "source unavailable" }))
                : f.fs.scan(pattern, options),
          }),
        },
        [],
      )
      const commands = publication.definitions.find(
        (source) => source.kind === "command" && source.target.scope === "location",
      )
      expect(commands?.assets).toEqual([])
      expect(commands?.invalid.map((entry) => entry.errorTag)).toEqual(["name_conflict", "name_conflict"])
      expect(
        publication.definitions.find((source) => source.kind === "prompt" && source.target.scope === "location")
          ?.invalid[0].errorTag,
      ).toBe("bad_template")
      expect(
        publication.definitions.find((source) => source.kind === "skill" && source.target.scope === "global")?.assets,
      ).toEqual([])
      expect(publication.errors).toHaveLength(1)
      expect(publication.errors[0]).toMatchObject({
        kind: "agent",
        scope: "location",
        target: { root: path.join(f.location.directory, ".aigcfroge/agents") },
        error: { reason: "reload_failed" },
      })
      expect(publication.definitions.some((source) => source.kind === "agent")).toBe(false)
      expect(AssetPublication.toModelAssets(publication).some((row) => row.kind === "Definition source errors")).toBe(
        true,
      )
      expect(yield* f.fs.existsSafe(path.join(f.location.directory, ".aigcfroge/skills"))).toBe(false)
    }),
  )

  it.live("rejects owner and discovered file redirects before reading their bodies", () =>
    Effect.gen(function* () {
      const f = yield* sources
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".aigcfroge"))
      yield* f.fs.makeDirectory(path.join(f.location.directory, "outside"))
      yield* f.fs.writeFileString(path.join(f.location.directory, "outside/secret.md"), "PRIVATE_REDIRECT_BODY")
      yield* f.fs.symlink(
        path.join(f.location.directory, "outside"),
        path.join(f.location.directory, ".aigcfroge/agents"),
      )
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".aigcfroge/mcps"))
      yield* f.fs.symlink(
        path.join(f.location.directory, "outside/secret.md"),
        path.join(f.location.directory, ".aigcfroge/mcps/redirect.md"),
      )
      const reads: string[] = []
      const publication = yield* AssetPublication.read(
        {
          ...f,
          fs: FSUtil.Service.of({
            ...f.fs,
            readFile: (file) => {
              reads.push(file)
              return f.fs.readFile(file)
            },
          }),
        },
        [],
      )
      expect(publication.errors.map((source) => source.kind)).toEqual(["agent", "mcp"])
      expect(publication.errors.every((source) => source.error.reason === "path_escape")).toBe(true)
      expect(reads).toEqual([])
    }),
  )

  posixTest("validates the scanned file identity before normalizing POSIX backslash names", () =>
    Effect.gen(function* () {
      const f = yield* sources
      yield* f.fs.writeWithDirs(
        path.join(f.location.directory, "outside/secret.md"),
        "---\nkind: agent\nname: Redirected\ndescription: Description\n---\nPRIVATE_ALIAS_BODY",
      )
      yield* f.fs.makeDirectory(path.join(f.location.directory, ".aigcfroge/agents"), { recursive: true })
      yield* f.fs.symlink(
        path.join(f.location.directory, "outside/secret.md"),
        path.join(f.location.directory, ".aigcfroge/agents/folder\\escape.md"),
      )
      const reads: string[] = []
      const publication = yield* AssetPublication.read(
        {
          ...f,
          fs: FSUtil.Service.of({
            ...f.fs,
            readFile: (file) => {
              reads.push(file)
              return f.fs.readFile(file)
            },
          }),
        },
        [],
      )
      expect(reads).toEqual([])
      expect(publication.errors).toMatchObject([{ kind: "agent", error: { reason: "path_escape" } }])
    }),
  )
  ;[
    { name: "defects", failure: Effect.die("catalog defect"), matches: Cause.hasDies },
    { name: "interruption", failure: Effect.interrupt, matches: Cause.hasInterruptsOnly },
  ].forEach((scenario) => {
    it.live("preserves " + scenario.name + " rather than publishing an empty source", () =>
      Effect.gen(function* () {
        const f = yield* sources
        yield* f.fs.makeDirectory(path.join(f.location.directory, ".aigcfroge/agents"), { recursive: true })
        const result = yield* Effect.exit(
          AssetPublication.read({ ...f, fs: FSUtil.Service.of({ ...f.fs, scan: () => scenario.failure }) }, []),
        )
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) expect(scenario.matches(result.cause)).toBe(true)
      }),
    )
  })

  it.live("rejects mixed kind summaries and invalid tags while omitting undefined JSON fields", () =>
    Effect.gen(function* () {
      const f = yield* sources
      const publication = Schema.encodeSync(AssetPublication.Json)(yield* AssetPublication.read(f, []))
      expect(JSON.stringify(publication)).not.toContain("workspaceID")
      const definition = {
        kind: "skill",
        target: { scope: "location", root: path.join(f.location.directory, ".aigcfroge/skills") },
        assets: [],
        invalid: [{ relativePath: "bad.md", errorTag: "bad_template" }],
      }
      expect(() => Schema.decodeUnknownSync(Definition)(definition)).toThrow()
      expect(() =>
        Schema.decodeUnknownSync(Definition)({
          ...definition,
          invalid: [],
          assets: [
            { kind: "prompt", name: "Wrong kind", description: "", relativePath: "bad.md", revision: "a".repeat(64) },
          ],
        }),
      ).toThrow()
    }),
  )
})
