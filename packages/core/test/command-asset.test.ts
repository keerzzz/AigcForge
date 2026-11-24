import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Scope } from "effect"
import { systemError } from "effect/PlatformError"
import os from "os"
import path from "path"
import { FSUtil } from "@omnixa/util/fs-util"
import { Global } from "@omnixa/util/global"
import { Hash } from "@omnixa/util/hash"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Candidate, Revision } from "@omnixa/schema/command-asset"
import { Composition } from "@omnixa/schema/composition"
import { Document } from "@omnixa/schema/config"
import { Agent } from "../src/agent"
import { AgentAsset } from "../src/agent-asset"
import { AssetPlacement } from "../src/asset-placement"
import { CommandAssetService } from "../src/command-asset-service"
import { CompositionResolver } from "../src/composition-resolver"
import { Config } from "../src/config"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Environment } from "../src/environment/index"
import { FileMutation } from "../src/file-mutation"
import { Image } from "../src/image"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { McpConnection } from "../src/mcp/connection"
import { AgentPlugin } from "../src/plugin/agent"
import { Project } from "../src/project"
import { PromptAsset } from "../src/prompt-asset"
import { SkillAsset } from "../src/skill-asset"
import { MCPAsset } from "../src/mcp-asset"
import { CommandAsset } from "../src/command-asset"
import { AssetKind } from "../src/asset-kind"
import { AbsolutePath } from "../src/schema"
import { NodeFileSystem } from "@effect/platform-node"
import { location } from "./fixture/location"
import { tempGlobalLayer } from "./fixture/global"
import { transformEnvironmentFiles } from "./fixture/environment"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([FSUtil.node, Project.node, Global.node]), [
    Global.node.replace(tempGlobalLayer),
  ]),
)

describe("CommandAsset", () => {
  it.live("loads command assets and isolates from mcp, skill, prompt with same filename", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "omnixa-cmd-test-" })
      yield* Effect.addFinalizer(() => fs.remove(tmpDir, { recursive: true }).pipe(Effect.orDie))
      const locationDir = AbsolutePath.make(tmpDir)

      const locationLayer = Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: locationDir },
            { vcs: { type: "git", store: AbsolutePath.make(path.join(tmpDir, ".git")) } },
          ),
        ),
      )

      const baseLayer = Layer.mergeAll(locationLayer, fsLayer, AssetKind.layer, tempGlobalLayer)
      const testAppLayer = Layer.mergeAll(CommandAsset.layer, MCPAsset.layer, SkillAsset.layer, PromptAsset.layer).pipe(
        Layer.provide(LocationMutation.layer),
        Layer.provide(baseLayer),
      )

      return yield* Effect.gen(function* () {
        const cmdService = yield* CommandAsset.Service
        const mcpService = yield* MCPAsset.Service
        const skillService = yield* SkillAsset.Service
        const promptService = yield* PromptAsset.Service

        const cmdDir = path.resolve(tmpDir, ".omnixa/commands")
        const mcpDir = path.resolve(tmpDir, ".omnixa/mcps")
        const skillDir = path.resolve(tmpDir, ".omnixa/skills")
        const promptDir = path.resolve(tmpDir, ".omnixa/prompts")

        yield* fs.makeDirectory(cmdDir, { recursive: true })
        yield* fs.makeDirectory(mcpDir, { recursive: true })
        yield* fs.makeDirectory(skillDir, { recursive: true })
        yield* fs.makeDirectory(promptDir, { recursive: true })

        const cmdFile = path.join(cmdDir, "my-tool.md")
        const mcpFile = path.join(mcpDir, "my-tool.md")
        const skillFile = path.join(skillDir, "my-tool.md")
        const promptFile = path.join(promptDir, "my-tool.md")

        yield* fs.writeFileString(
          cmdFile,
          '---\nkind: command\nname: "my-tool"\ndescription: "cmd desc"\ninvocation: "/my-tool"\n---\necho cmd',
        )

        yield* fs.writeFileString(
          mcpFile,
          '---\nkind: mcp\nname: "my-tool"\ndescription: "mcp desc"\ncommand: "node"\nargs: ["server.js"]\n---\n{}',
        )

        yield* fs.writeFileString(
          skillFile,
          '---\nkind: skill\nname: "my-tool"\ndescription: "skill desc"\ntrigger: "my-tool"\nsource: "echo hi"\n---\n',
        )

        yield* fs.writeFileString(
          promptFile,
          '---\nkind: prompt\nname: "my-tool"\ndescription: "prompt desc"\n---\nHello Prompt',
        )

        yield* cmdService.reload()
        yield* mcpService.reload()
        yield* skillService.reload()
        yield* promptService.reload()

        const cmds = yield* cmdService.list()
        const mcps = yield* mcpService.list()
        const skills = yield* skillService.list()
        const prompts = yield* promptService.list()

        expect(cmds.length).toBe(1)
        expect(cmds[0].name).toBe("my-tool")
        expect(cmds[0].kind).toBe("command")

        expect(mcps.length).toBe(1)
        expect(mcps[0].name).toBe("my-tool")
        expect(mcps[0].kind).toBe("mcp")

        expect(skills.length).toBe(1)
        expect(skills[0].name).toBe("my-tool")
        expect(skills[0].kind).toBe("skill")

        expect(prompts.length).toBe(1)
        expect(prompts[0].name).toBe("my-tool")
        expect(prompts[0].kind).toBe("prompt")
      }).pipe(Effect.provide(testAppLayer))
    }).pipe(Effect.provide(fsLayer)),
  )
})

const openLocation = Effect.fnUntraced(function* (
  directory: string,
  options: { readonly global?: Global.Interface; readonly config?: Config.Interface } = {},
) {
  const fs = yield* FSUtil.Service
  const project = yield* Project.Service
  const global = options.global ?? (yield* Global.Service)
  const config = options.config ? Layer.succeed(Config.Service, options.config) : Layer.empty
  const services = yield* Layer.build(
    AppNodeBuilder.build(
      LayerNode.group([
        Location.node,
        LocationMutation.node,
        CommandAsset.node,
        CommandAssetService.node,
        FileMutation.node,
      ]),
      [
        Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(directory) })),
        Project.node.replace(Layer.succeed(Project.Service, project)),
        Global.node.replace(Layer.succeed(Global.Service, global)),
        FSUtil.node.replace(Layer.succeed(FSUtil.Service, fs)),
        Environment.node.replace(transformEnvironmentFiles()),
        // Preserve the production node's dependencies while providing its optional Config boundary.
        CommandAsset.node.replace(CommandAsset.node.mapLayer((layer) => layer.pipe(Layer.provide(config)))),
      ],
    ),
  )
  return {
    fs,
    location: Context.get(services, Location.Service),
    mutation: Context.get(services, LocationMutation.Service),
    registry: Context.get(services, CommandAsset.Service),
    service: Context.get(services, CommandAssetService.Service),
    files: Context.get(services, FileMutation.Service),
  }
})

type LocationGraph = Effect.Success<ReturnType<typeof openLocation>>

const candidate = (source = '  Review "$ARGUMENTS"\r\n\nKeep this body exactly.\r\n', relativePath = "review.md") =>
  Schema.decodeUnknownSync(Candidate)({
    name: "review",
    description: 'Review: "quoted" changes',
    invocation: "/review",
    args: "<files> [--strict]",
    source,
    relativePath,
  })

const checkouts = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  const fs = yield* FSUtil.Service
  const main = path.join(tmp.path, "main")
  const clone = path.join(tmp.path, "clone")
  const linked = path.join(tmp.path, "linked")
  yield* fs.makeDirectory(main)
  yield* Effect.promise(async () => {
    await initRepo(main)
    await $`git remote add origin https://github.com/command-placement/fixture.git`.cwd(main).quiet()
    await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
    await $`git remote set-url origin https://github.com/command-placement/fixture.git`.cwd(clone).quiet()
    await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
  })
  return { main, clone, linked }
})

const faultService = Effect.fnUntraced(function* (
  graph: LocationGraph,
  input: {
    readonly files?: Partial<FileMutation.Interface>
    readonly fs?: Partial<FSUtil.Interface>
    readonly registry?: Partial<CommandAsset.Interface>
  },
) {
  return yield* CommandAssetService.Service.pipe(
    Effect.provide(Layer.fresh(CommandAssetService.layer)),
    Effect.provideService(FSUtil.Service, { ...graph.fs, ...input.fs }),
    Effect.provideService(LocationMutation.Service, graph.mutation),
    Effect.provideService(CommandAsset.Service, { ...graph.registry, ...input.registry }),
    Effect.provideService(FileMutation.Service, { ...graph.files, ...input.files }),
  )
})

describe("Command selected owner", () => {
  it.live("uses the current Project from a Git child and keeps omitted-target writes at the Location", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const child = path.join(tmp.path, "packages", "app")
      yield* fs.makeDirectory(child, { recursive: true })
      yield* Effect.promise(() => initRepo(tmp.path))
      const graph = yield* openLocation(child)
      expect(graph.location.directory).toBe(AbsolutePath.make(child))
      expect(graph.location.project.directory).toBe(AbsolutePath.make(tmp.path))
      const view = yield* graph.registry.select("project")
      const facts = yield* graph.service.inspect({ candidate: candidate(), scope: "project" })
      expect(facts).toEqual({
        relativePath: "review.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
        target: { scope: "project", root: AbsolutePath.make(path.join(tmp.path, ".omnixa/commands")) },
      })
      expect(view.target).toEqual(facts.target)
      expect(yield* fs.exists(view.target.root)).toBe(false)
      const saved = yield* graph.service.apply({
        candidate: candidate(),
        target: facts.target,
        baseRevision: null,
        overwrite: false,
      })
      expect(saved).toMatchObject({ ...candidate(), kind: "command", target: facts.target })
      expect(saved.revision).toBe(
        Hash.sha256(Buffer.from(yield* fs.readFile(path.join(view.target.root, "review.md")))),
      )
      expect(yield* view.getByPath("review.md")).toEqual(saved)
      expect(yield* graph.registry.list()).toEqual([])
      expect(yield* fs.exists(path.join(child, ".omnixa/commands/review.md"))).toBe(false)

      const legacy = yield* graph.service.apply({
        candidate: candidate("Location command", "ignored-by-legacy.md"),
        baseRevision: null,
        overwrite: false,
      })
      expect(legacy.relativePath).toBe("review.md")
      expect(Object.keys(legacy)).not.toContain("target")
      expect((yield* graph.registry.getByPath("review.md")).source).toBe("Location command")
      expect((yield* view.getByPath("review.md")).source).toBe(candidate().source)
      const local = yield* graph.registry.select("location")
      expect(local.target).toEqual({
        scope: "location",
        root: AbsolutePath.make(path.join(child, ".omnixa/commands")),
      })
      const localUpdate = yield* graph.service.apply({
        candidate: candidate("explicit Location"),
        target: local.target,
        baseRevision: legacy.revision,
        overwrite: true,
      })
      expect(localUpdate.target).toEqual(local.target)
      expect((yield* view.getByPath("review.md")).revision).toBe(saved.revision)
      yield* graph.service.delete({
        relativePath: "review.md",
        target: local.target,
        baseRevision: localUpdate.revision,
      })
      expect(yield* local.list()).toEqual([])
    }),
  )

  it.live("uses the exact markerless Location and shares only canonical Global.config/commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const firstDirectory = path.join(tmp.path, "notes", "drafts")
      const secondDirectory = path.join(tmp.path, "elsewhere")
      yield* fs.makeDirectory(firstDirectory, { recursive: true })
      yield* fs.makeDirectory(secondDirectory)
      const first = yield* openLocation(firstDirectory)
      const second = yield* openLocation(secondDirectory)
      expect(first.location.vcs).toBeUndefined()
      expect(first.location.project.directory).toBe(AbsolutePath.make(firstDirectory))
      const project = yield* first.registry.select("project")
      const local = yield* first.registry.select("location")
      expect(project.target.root).toBe(AbsolutePath.make(path.join(firstDirectory, ".omnixa/commands")))
      expect(local.target.root).toBe(project.target.root)
      expect(AssetPlacement.targetMismatch(project.target, local.target)).toBeInstanceOf(
        AssetPlacement.TargetMismatchError,
      )
      const view = yield* second.registry.select("global")
      expect(view.target.root).toBe(AbsolutePath.make(path.join(global.config, "commands")))
      expect(yield* view.list()).toEqual([])
      const proposed = yield* first.service.inspect({ candidate: candidate(), scope: "global" })
      const created = yield* first.service.apply({
        candidate: candidate(),
        target: proposed.target,
        baseRevision: null,
        overwrite: false,
      })
      expect(yield* view.getByPath("review.md")).toEqual(created)
      const updated = yield* first.service.apply({
        candidate: candidate("updated by another Location"),
        target: proposed.target,
        baseRevision: created.revision,
        overwrite: true,
      })
      expect(yield* view.getByPath("review.md")).toEqual(updated)
      expect((yield* second.service.inspect({ candidate: candidate(), scope: "global" })).revision).toBe(
        Revision.make(updated.revision),
      )
      expect(yield* fs.exists(path.join(global.config, ".omnixa/commands"))).toBe(false)
      expect(yield* first.registry.list()).toEqual([])
      expect(yield* second.registry.list()).toEqual([])
      yield* second.service.delete({ relativePath: "review.md", target: view.target, baseRevision: updated.revision })
      const refreshed = yield* first.registry.select("global")
      expect(yield* refreshed.list()).toEqual([])
    }),
  )
})

for (const activation of ["selected", "legacy"] as const) {
  it.live("imports genuine legacy Config and singular files only when consumed: " + activation, () =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env["OMNIXA_EXPERIMENTAL_CHAT_ASSET"]
          process.env["OMNIXA_EXPERIMENTAL_CHAT_ASSET"] = "true"
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env["OMNIXA_EXPERIMENTAL_CHAT_ASSET"]
              return
            }
            process.env["OMNIXA_EXPERIMENTAL_CHAT_ASSET"] = previous
          }),
      )
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const child = path.join(tmp.path, "src")
      yield* fs.makeDirectory(child)
      yield* Effect.promise(() => initRepo(tmp.path))
      const configPath = path.join(tmp.path, "omnixa.json")
      const globalPath = path.join(global.config, "omnixa.json")
      const configuration = {
        commands: {
          "from-config": { description: "Config command", template: "Project config body" },
          review: { description: "Config wins", template: "Config winner $ARGUMENTS" },
        },
      }
      const outside = { commands: { "excluded-global": { template: "Outside the Project" } } }
      yield* fs.writeWithDirs(configPath, JSON.stringify(configuration))
      yield* fs.writeWithDirs(globalPath, JSON.stringify(outside))
      const original = "---\ndescription: Legacy command\n---\nOriginal singular body $ARGUMENTS\n"
      const duplicate = "---\ndescription: Same name in a file\n---\nFile must lose to Config\n"
      const legacyFile = path.join(child, ".omnixa/command/from-file.md")
      const duplicateFile = path.join(child, ".omnixa/command/review.md")
      yield* fs.writeWithDirs(legacyFile, original)
      yield* fs.writeWithDirs(duplicateFile, duplicate)
      const config = yield* Config.Service.pipe(
        Effect.provide(
          Config.testLayer([
            Schema.decodeUnknownSync(Document)({ type: "document", path: configPath, info: configuration }),
            Schema.decodeUnknownSync(Document)({ type: "document", path: globalPath, info: outside }),
            Schema.decodeUnknownSync(Document)({
              type: "document",
              info: { commands: { "excluded-inline": { template: "No source path" } } },
            }),
          ]),
        ),
      )
      const owner = path.join(child, ".omnixa/commands")
      const marker = path.join(child, ".omnixa/.command-asset-migration-v1")
      expect(yield* fs.exists(owner)).toBe(false)
      expect(yield* fs.exists(marker)).toBe(false)
      const graph = yield* openLocation(child, { config })
      if (activation === "selected") {
        // This must run before any new method, so the old constructor produces attributable red evidence.
        expect(yield* fs.exists(owner)).toBe(false)
        expect(yield* fs.exists(marker)).toBe(false)
        yield* Effect.forEach(["project", "global", "location"] as const, (scope) =>
          Effect.gen(function* () {
            const selected = yield* graph.registry.select(scope)
            expect(yield* selected.list()).toEqual([])
            expect(yield* selected.listInvalid()).toEqual([])
            expect(yield* selected.findByName("review")).toBeUndefined()
            expect(yield* selected.getInvalid("review.md")).toBeUndefined()
            expect(yield* selected.getByPath("review.md").pipe(Effect.flip)).toBeInstanceOf(CommandAsset.NotFoundError)
            expect((yield* graph.service.inspect({ candidate: candidate(), scope })).exists).toBe(false)
            expect(yield* fs.exists(selected.target.root)).toBe(false)
          }),
        )
        expect(yield* fs.exists(marker)).toBe(false)
      }
      const imported = yield* graph.registry.list()
      expect(imported.map((entry) => entry.name).toSorted()).toEqual(["from-config", "from-file", "review"])
      expect((yield* graph.registry.getByPath("review.md")).source).toBe("Config winner $ARGUMENTS")
      expect((yield* graph.registry.getByPath("from-file.md")).source).toBe("Original singular body $ARGUMENTS\n")
      expect(imported.every((entry) => !Object.keys(entry).includes("target"))).toBe(true)
      expect(yield* fs.exists(marker)).toBe(true)
      expect(yield* fs.exists(path.join(tmp.path, ".omnixa/commands"))).toBe(false)
      expect(yield* fs.exists(path.join(global.config, "commands"))).toBe(false)
      expect(yield* fs.readFileString(legacyFile)).toBe(original)
      expect(yield* fs.readFileString(duplicateFile)).toBe(duplicate)
      expect(yield* fs.readFileString(configPath)).toBe(JSON.stringify(configuration))
      expect(yield* fs.readFileString(globalPath)).toBe(JSON.stringify(outside))
    }),
  )
}

it.live("reads nested V1 plural-owner commands in memory without rewriting their bytes", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const absolute = path.join(tmp.path, ".omnixa/commands/tools/legacy.md")
    const raw = "---\ndescription: V1 command\nargs: '<files>'\n---\n  Legacy $ARGUMENTS\n"
    yield* fs.writeWithDirs(absolute, raw)
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    const read = yield* view.getByPath("tools/legacy.md")
    expect(read).toMatchObject({
      kind: "command",
      name: "tools/legacy",
      invocation: "/tools/legacy",
      args: "<files>",
      source: "  Legacy $ARGUMENTS\n",
      relativePath: "tools/legacy.md",
      target: view.target,
    })
    expect(read.revision).toBe(Hash.sha256(Buffer.from(raw)))
    expect(yield* view.findByName("tools/legacy")).toEqual(read)
    expect(yield* view.listInvalid()).toEqual([])
    expect(yield* fs.readFileString(absolute)).toBe(raw)
    expect(yield* fs.exists(path.join(tmp.path, ".omnixa/.command-asset-migration-v1"))).toBe(false)
  }),
)

it.live("keeps clone and worktree Command owners independent when Project IDs and revisions match", () =>
  Effect.gen(function* () {
    const roots = yield* checkouts()
    const fs = yield* FSUtil.Service
    const graphs = yield* Effect.forEach([roots.main, roots.clone, roots.linked], (directory) =>
      Effect.gen(function* () {
        const child = path.join(directory, "src")
        yield* fs.makeDirectory(child)
        return yield* openLocation(child)
      }),
    )
    expect(graphs.map((graph) => graph.location.project.id)).toEqual(Array(3).fill(graphs[0].location.project.id))
    expect(graphs.map((graph) => graph.location.project.directory)).toEqual(
      [roots.main, roots.clone, roots.linked].map((directory) => AbsolutePath.make(directory)),
    )
    expect(graphs.map((graph) => graph.location.project.canonical)).toEqual(
      [roots.main, roots.clone, roots.main].map((directory) => AbsolutePath.make(directory)),
    )
    const views = yield* Effect.forEach(graphs, (graph) => graph.registry.select("project"))
    expect(views.map((view) => view.target.root)).toEqual(
      [roots.main, roots.clone, roots.linked].map((directory) =>
        AbsolutePath.make(path.join(directory, ".omnixa/commands")),
      ),
    )
    const saved = yield* Effect.forEach(graphs, (graph, index) =>
      graph.service.apply({
        candidate: candidate(),
        target: views[index].target,
        baseRevision: null,
        overwrite: false,
      }),
    )
    expect(new Set(saved.map((info) => info.revision)).size).toBe(1)
    expect(
      yield* graphs[0].service
        .apply({
          candidate: candidate("must not land"),
          target: views[2].target,
          baseRevision: saved[2].revision,
          overwrite: true,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
    expect(
      yield* graphs[0].service
        .delete({
          relativePath: "review.md",
          target: views[1].target,
          baseRevision: saved[1].revision,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
    yield* Effect.forEach(views, (view) =>
      Effect.gen(function* () {
        expect((yield* view.getByPath("review.md")).source).toBe(candidate().source)
      }),
    )
    const foreignRoot = new AssetPlacement.Target({
      scope: "project",
      root: AbsolutePath.make(path.join(roots.main, "arbitrary")),
    })
    expect(
      yield* graphs[0].service
        .apply({
          candidate: candidate(),
          target: foreignRoot,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
    expect(yield* fs.exists(foreignRoot.root)).toBe(false)
  }),
)

it.live("accepts a configured Global alias but rejects owner, child and dangling symlinks", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(tmp.path, "location")
    const outside = path.join(tmp.path, "outside")
    const alias = path.join(tmp.path, "config-alias")
    yield* fs.makeDirectory(directory)
    yield* fs.makeDirectory(outside)
    yield* fs.symlink(outside, alias)
    const graph = yield* openLocation(directory, { global: { ...global, config: alias } })
    const globalView = yield* graph.registry.select("global")
    expect(globalView.target.root).toBe(AbsolutePath.make(path.join(outside, "commands")))
    expect(yield* globalView.list()).toEqual([])
    expect(yield* fs.exists(globalView.target.root)).toBe(false)
    yield* fs.symlink(outside, path.join(directory, ".omnixa"))
    expect(yield* graph.registry.select("project").pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    yield* fs.remove(path.join(directory, ".omnixa"))
    yield* fs.makeDirectory(path.join(directory, ".omnixa"))
    yield* fs.symlink(outside, path.join(directory, ".omnixa/commands"))
    expect(yield* graph.service.inspect({ candidate: candidate(), scope: "project" }).pipe(Effect.flip)).toBeInstanceOf(
      AssetPlacement.PathError,
    )
    yield* fs.remove(path.join(directory, ".omnixa/commands"))
    const view = yield* graph.registry.select("project")
    yield* fs.makeDirectory(view.target.root)
    const external = path.join(outside, "external.md")
    yield* fs.writeFileString(external, "external body")
    const link = path.join(view.target.root, "review.md")
    yield* fs.symlink(external, link)
    expect(yield* view.list().pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* view.getByPath("review.md").pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    expect(
      yield* graph.service
        .apply({
          candidate: candidate(),
          target: view.target,
          baseRevision: null,
          overwrite: true,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(
      yield* graph.service
        .delete({
          relativePath: "review.md",
          target: view.target,
          baseRevision: null,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* fs.readFileString(external)).toBe("external body")
    yield* fs.remove(link)
    yield* fs.symlink(path.join(outside, "missing.md"), link)
    expect(yield* graph.service.inspect({ candidate: candidate(), scope: "project" }).pipe(Effect.flip)).toBeInstanceOf(
      AssetPlacement.PathError,
    )
    expect(
      yield* graph.service
        .apply({
          candidate: candidate(),
          target: view.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* fs.exists(path.join(outside, "missing.md"))).toBe(false)
  }),
)

it.live("binds selected candidates to their reviewed short path and requires exact apply/delete revisions", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    yield* Effect.forEach(["", "other.md", "../review.md", ".omnixa/commands/review.md"], (relativePath) =>
      Effect.gen(function* () {
        expect(
          yield* graph.service
            .inspect({
              candidate: candidate("rejected", relativePath),
              scope: "project",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.InvalidCandidateError)
        expect(
          yield* graph.service
            .apply({
              candidate: candidate("rejected", relativePath),
              target: view.target,
              baseRevision: null,
              overwrite: false,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.InvalidCandidateError)
      }),
    )
    expect(yield* view.list()).toEqual([])
    const first = yield* graph.service.apply({
      candidate: candidate(),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    expect(
      yield* graph.service
        .apply({
          candidate: candidate("stale"),
          target: view.target,
          baseRevision: null,
          overwrite: true,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
    expect(
      yield* graph.service
        .apply({
          candidate: candidate("needs confirmation"),
          target: view.target,
          baseRevision: first.revision,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.OverwriteRequiredError)
    expect(
      yield* graph.service
        .delete({
          relativePath: "review.md",
          target: view.target,
          baseRevision: null,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
    const next = yield* graph.service.apply({
      candidate: candidate("next"),
      target: view.target,
      baseRevision: first.revision,
      overwrite: true,
    })
    expect(
      yield* graph.service
        .delete({
          relativePath: "review.md",
          target: view.target,
          baseRevision: first.revision,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
    expect((yield* view.getByPath("review.md")).source).toBe("next")
    yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: next.revision })
    expect(
      yield* graph.service
        .delete({
          relativePath: "review.md",
          target: view.target,
          baseRevision: next.revision,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
    yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: null })
    expect(yield* view.list()).toEqual([])
  }),
)

it.live("preserves omitted-target proposals, name-derived apply paths and null-revision delete", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    expect(yield* graph.service.propose(candidate("legacy proposal", ""))).toEqual({
      relativePath: "review.md",
      exists: false,
      revision: null,
      nameConflict: false,
      pathConflict: false,
    })
    const saved = yield* graph.service.apply({
      candidate: candidate("legacy body", "ignored.md"),
      baseRevision: null,
      overwrite: false,
    })
    expect(saved.relativePath).toBe("review.md")
    expect(Object.keys(saved)).not.toContain("target")
    expect(yield* graph.fs.exists(path.join(tmp.path, ".omnixa/commands/ignored.md"))).toBe(false)
    expect(yield* graph.service.propose(candidate("legacy proposal", ""))).toEqual({
      relativePath: "review.md",
      exists: true,
      revision: saved.revision,
      nameConflict: false,
      pathConflict: false,
    })
    yield* graph.service.delete({ relativePath: "review.md", baseRevision: null })
    expect(yield* graph.registry.list()).toEqual([])
    yield* graph.service.delete({ relativePath: "review.md", baseRevision: saved.revision })
  }),
)

for (const args of [undefined, "", "<files> [--strict]"]) {
  it.live("round-trips exact Command source and optional args: " + String(args), () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const input = Schema.decodeUnknownSync(Candidate)({ ...candidate(), args })
      const saved = yield* graph.service.apply({ candidate: input, baseRevision: null, overwrite: false })
      expect(saved.source).toBe(input.source)
      expect(saved.args).toBe(args)
      expect(Object.hasOwn(saved, "args")).toBe(args !== undefined)
      expect(saved.invocation).toBe(input.invocation)
      expect(saved.description).toBe(input.description)
      const empty = Schema.decodeUnknownSync(Candidate)({ ...input, source: "" })
      const updated = yield* graph.service.apply({
        candidate: empty,
        baseRevision: saved.revision,
        overwrite: true,
      })
      expect(updated.source).toBe("")
      expect(updated.args).toBe(args)
      expect(Object.hasOwn(updated, "args")).toBe(args !== undefined)
      expect(updated.revision).toBe(
        Hash.sha256(Buffer.from(yield* graph.fs.readFile(path.join(tmp.path, ".omnixa/commands/review.md")))),
      )
    }),
  )
}

for (const mode of ["legacy", "project", "global", "mixed"] as const) {
  it.live("serializes the full Command CAS transaction across Location graphs: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const firstDirectory = mode === "legacy" ? tmp.path : path.join(tmp.path, "first")
      const secondDirectory = mode === "legacy" || mode === "mixed" ? tmp.path : path.join(tmp.path, "second")
      if (mode !== "legacy") {
        yield* fs.makeDirectory(firstDirectory)
        if (mode !== "mixed") yield* fs.makeDirectory(secondDirectory)
      }
      yield* Effect.promise(() => initRepo(tmp.path))
      const first = yield* openLocation(firstDirectory)
      const second = yield* openLocation(secondDirectory)
      const selected = mode === "legacy" ? undefined : yield* first.registry.select(mode === "mixed" ? "project" : mode)
      const secondSelected = mode === "legacy" || mode === "mixed" ? undefined : yield* second.registry.select(mode)
      if (secondSelected) {
        if (!selected) throw new Error("Expected the first Command owner to be selected")
        expect(secondSelected.target).toEqual(selected.target)
      }
      const absolute = path.join(selected?.target.root ?? path.join(firstDirectory, ".omnixa/commands"), "review.md")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const secondWrote = yield* Deferred.make<void>()
      const locks: string[][] = []
      const firstService = yield* faultService(first, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(Effect.andThen(first.files.withLock(targets)(effect))),
          writeAtomic: (input) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(first.files.writeAtomic(input)),
            ),
        },
      })
      const secondService = yield* faultService(second, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(second.files.withLock(targets)(effect)),
            ),
          // Signal either the requested shared lock or an incorrectly reached write, without a timed guess.
          writeAtomic: (input) =>
            Deferred.succeed(secondWrote, undefined).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(second.files.writeAtomic(input)),
            ),
        },
      })
      const scope = yield* Scope.Scope
      const firstFiber = yield* firstService
        .apply({
          candidate: candidate("first wins"),
          target: selected?.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.forkIn(scope))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* awaitWithTimeout(
        Deferred.await(entered),
        "First Command transaction did not reach its write",
        "10 seconds",
      )
      const secondFiber = yield* secondService
        .apply({
          candidate: candidate("stale second"),
          target: secondSelected?.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip, Effect.forkIn(scope))
      yield* awaitWithTimeout(
        Deferred.await(attempted),
        "Second Command transaction did not attempt its lock",
        "10 seconds",
      )
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      expect(locks).toEqual([[absolute], [absolute]])
      yield* Deferred.succeed(release, undefined)
      const saved = yield* awaitWithTimeout(
        Fiber.join(firstFiber),
        "First Command transaction did not complete",
        "10 seconds",
      )
      expect(
        yield* awaitWithTimeout(Fiber.join(secondFiber), "Second Command CAS did not settle", "10 seconds"),
      ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      expect(saved.source).toBe("first wins")
      const reader = secondSelected ?? second.registry
      yield* reader.reload()
      expect((yield* reader.getByPath("review.md")).revision).toBe(saved.revision)
    }),
  )
}

for (const mode of ["legacy", "project"] as const) {
  it.live("keeps Command delete behind an in-flight apply using the same absolute lock: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const first = yield* openLocation(tmp.path)
      const second = yield* openLocation(tmp.path)
      const selected = mode === "legacy" ? undefined : yield* first.registry.select("project")
      const saved = yield* first.service.apply({
        candidate: candidate("original"),
        target: selected?.target,
        baseRevision: null,
        overwrite: false,
      })
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const removed = yield* Deferred.make<void>()
      const writer = yield* faultService(first, {
        files: {
          writeAtomic: (input) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(first.files.writeAtomic(input)),
            ),
        },
      })
      const deleter = yield* faultService(second, {
        files: {
          withLock: (targets) => (effect) =>
            Deferred.succeed(attempted, undefined).pipe(Effect.andThen(second.files.withLock(targets)(effect))),
          remove: (input) =>
            Deferred.succeed(removed, undefined).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(second.files.remove(input)),
            ),
        },
      })
      const scope = yield* Scope.Scope
      const writing = yield* writer
        .apply({
          candidate: candidate("updated"),
          target: selected?.target,
          baseRevision: saved.revision,
          overwrite: true,
        })
        .pipe(Effect.forkIn(scope))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* awaitWithTimeout(Deferred.await(entered), "Command apply did not reach its write", "10 seconds")
      const deleting = yield* deleter
        .delete({
          relativePath: "review.md",
          target: selected?.target,
          baseRevision: saved.revision,
        })
        .pipe(Effect.flip, Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(attempted), "Command delete did not request its lock", "10 seconds")
      expect(yield* Deferred.isDone(removed)).toBe(false)
      yield* Deferred.succeed(release, undefined)
      const updated = yield* awaitWithTimeout(Fiber.join(writing), "Command apply did not complete", "10 seconds")
      expect(
        yield* awaitWithTimeout(Fiber.join(deleting), "Command delete did not settle", "10 seconds"),
      ).toBeInstanceOf(CommandAssetService.StaleRevisionError)
      expect(yield* Deferred.isDone(removed)).toBe(false)
      const reader = selected ?? first.registry
      expect((yield* reader.getByPath("review.md")).revision).toBe(updated.revision)
    }),
  )
}

it.live("inspects only after an in-flight selected Command transaction releases its absolute lock", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const first = yield* openLocation(tmp.path)
    const second = yield* openLocation(tmp.path)
    const selected = yield* first.registry.select("project")
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const attempted = yield* Deferred.make<void>()
    const inspected = yield* Deferred.make<void>()
    const writer = yield* faultService(first, {
      files: {
        writeAtomic: (input) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(first.files.writeAtomic(input)),
          ),
      },
    })
    const inspector = yield* faultService(second, {
      files: {
        withLock: (targets) => (effect) =>
          Deferred.succeed(attempted, undefined).pipe(Effect.andThen(second.files.withLock(targets)(effect))),
      },
    })
    const scope = yield* Scope.Scope
    const writing = yield* writer
      .apply({
        candidate: candidate(),
        target: selected.target,
        baseRevision: null,
        overwrite: false,
      })
      .pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(entered), "Command write did not reach its boundary", "10 seconds")
    const inspection = yield* inspector.inspect({ candidate: candidate(), scope: "project" }).pipe(
      Effect.tap(() => Deferred.succeed(inspected, undefined)),
      Effect.forkIn(scope),
    )
    yield* awaitWithTimeout(Deferred.await(attempted), "Command inspect did not request its lock", "10 seconds")
    expect(yield* Deferred.isDone(inspected)).toBe(false)
    yield* Deferred.succeed(release, undefined)
    const saved = yield* awaitWithTimeout(Fiber.join(writing), "Command write did not complete", "10 seconds")
    const facts = yield* awaitWithTimeout(Fiber.join(inspection), "Command inspect did not complete", "10 seconds")
    expect(facts.exists).toBe(true)
    expect(facts.revision).toBe(Revision.make(saved.revision))
    expect(facts.target).toEqual(selected.target)
  }),
)

it.live("revalidates the Command owner after waiting for the shared absolute lock", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    const absolute = path.join(view.target.root, "review.md")
    const outside = path.join(tmp.path, "outside")
    yield* graph.fs.makeDirectory(view.target.root, { recursive: true })
    yield* graph.fs.makeDirectory(outside)
    const holding = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const attempted = yield* Deferred.make<void>()
    const scope = yield* Scope.Scope
    const holder = yield* graph.files
      .withLock([absolute])(Deferred.succeed(holding, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(holding), "Command target lock was not acquired", "10 seconds")
    const service = yield* faultService(graph, {
      files: {
        withLock: (targets) => (effect) =>
          Deferred.succeed(attempted, undefined).pipe(Effect.andThen(graph.files.withLock(targets)(effect))),
      },
    })
    const pending = yield* service
      .apply({
        candidate: candidate(),
        target: view.target,
        baseRevision: null,
        overwrite: false,
      })
      .pipe(Effect.flip, Effect.forkIn(scope))
    yield* awaitWithTimeout(Deferred.await(attempted), "Command apply did not request its target lock", "10 seconds")
    yield* graph.fs.remove(view.target.root, { recursive: true })
    yield* graph.fs.symlink(outside, view.target.root)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
    expect(
      yield* awaitWithTimeout(Fiber.join(pending), "Command owner revalidation did not settle", "10 seconds"),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* graph.fs.exists(path.join(outside, "review.md"))).toBe(false)
  }),
)

it.live("allows clone and worktree writes while another checkout holds a same-name Command lock", () =>
  Effect.gen(function* () {
    const roots = yield* checkouts()
    const main = yield* openLocation(roots.main)
    const linked = yield* openLocation(roots.linked)
    const clone = yield* openLocation(roots.clone)
    const view = yield* main.registry.select("project")
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const service = yield* faultService(main, {
      files: {
        writeAtomic: (input) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(main.files.writeAtomic(input)),
          ),
      },
    })
    const scope = yield* Scope.Scope
    const fiber = yield* service
      .apply({
        candidate: candidate(),
        target: view.target,
        baseRevision: null,
        overwrite: false,
      })
      .pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(entered), "Main checkout did not reach its Command write", "10 seconds")
    yield* Effect.forEach([linked, clone], (graph) =>
      Effect.gen(function* () {
        const selected = yield* graph.registry.select("project")
        const saved = yield* awaitWithTimeout(
          graph.service.apply({
            candidate: candidate(),
            target: selected.target,
            baseRevision: null,
            overwrite: false,
          }),
          "Independent checkout was blocked by another Command owner",
          "10 seconds",
        )
        expect(saved.target).toEqual(selected.target)
      }),
    )
    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(fiber)).source).toBe(candidate().source)
  }),
)

for (const mode of ["legacy", "project"] as const) {
  for (const existing of [false, true]) {
    it.live("rolls back the first Command readback failure: " + mode + (existing ? " overwrite" : " create"), () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const graph = yield* openLocation(tmp.path)
        const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
        const reader = selected ?? graph.registry
        const saved = existing
          ? yield* graph.service.apply({
              candidate: candidate("original"),
              target: selected?.target,
              baseRevision: null,
              overwrite: false,
            })
          : undefined
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
        const previous = saved ? yield* graph.fs.readFile(absolute) : null
        const calls = { writes: 0, failures: 0 }
        const injected = yield* faultService(graph, {
          files: {
            writeAtomic: (input) =>
              graph.files.writeAtomic(input).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    calls.writes++
                  }),
                ),
              ),
          },
          fs: {
            readFile: (file) =>
              Effect.gen(function* () {
                if (file === absolute && calls.writes > 0 && calls.failures === 0) {
                  calls.failures++
                  return yield* systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFile",
                    pathOrDescriptor: absolute,
                  })
                }
                return yield* graph.fs.readFile(file)
              }),
          },
        })
        expect(
          yield* injected
            .apply({
              candidate: candidate("replacement"),
              target: selected?.target,
              baseRevision: saved?.revision ?? null,
              overwrite: existing,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.WriteFailedError)
        expect(calls.failures).toBe(1)
        expect(calls.writes).toBe(existing ? 2 : 1)
        expect(yield* reader.listInvalid()).toEqual([])
        if (!saved) {
          expect(yield* graph.fs.exists(absolute)).toBe(false)
          expect(yield* reader.list()).toEqual([])
          return
        }
        if (previous === null) throw new Error("Expected original Command bytes before rollback")
        expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
        expect((yield* reader.getByPath("review.md")).source).toBe("original")
        expect((yield* reader.getByPath("review.md")).revision).toBe(saved.revision)
      }),
    )
  }

  it.live("preserves an external overwrite before the first Command readback: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
      const reader = selected ?? graph.registry
      const saved = yield* graph.service.apply({
        candidate: candidate("original"),
        target: selected?.target,
        baseRevision: null,
        overwrite: false,
      })
      const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
      const external = (yield* graph.fs.readFileString(absolute)).replace("original", "external writer")
      const calls = { writes: 0 }
      const injected = yield* faultService(graph, {
        files: {
          writeAtomic: (input) =>
            Effect.gen(function* () {
              const result = yield* graph.files.writeAtomic(input)
              calls.writes++
              // A filesystem write models a separate process that does not participate in FileMutation's lock.
              if (calls.writes === 1) yield* graph.fs.writeFileString(absolute, external).pipe(Effect.orDie)
              return result
            }),
        },
      })
      expect(
        yield* injected
          .apply({
            candidate: candidate("replacement"),
            target: selected?.target,
            baseRevision: saved.revision,
            overwrite: true,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(CommandAssetService.ConcurrentModificationError)
      expect(calls.writes).toBe(1)
      expect(yield* graph.fs.readFileString(absolute)).toBe(external)
      yield* reader.reload()
      expect((yield* reader.getByPath("review.md")).source).toBe("external writer")
    }),
  )

  for (const failure of ["read", "write"] as const) {
    it.live("reports a Command rollback " + failure + " failure without claiming restoration: " + mode, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const graph = yield* openLocation(tmp.path)
        const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
        const saved = yield* graph.service.apply({
          candidate: candidate("original"),
          target: selected?.target,
          baseRevision: null,
          overwrite: false,
        })
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
        const calls = { writes: 0, failedReads: 0 }
        const injected = yield* faultService(graph, {
          files: {
            writeAtomic: (input) =>
              Effect.gen(function* () {
                calls.writes++
                if (calls.writes === 2 && failure === "write")
                  return yield* new Environment.Failed({
                    path: absolute,
                    cause: new Error("Injected rollback write failure"),
                  })
                return yield* graph.files.writeAtomic(input)
              }),
          },
          fs: {
            readFile: (file) =>
              Effect.gen(function* () {
                if (file === absolute && calls.writes > 0 && (calls.failedReads === 0 || failure === "read")) {
                  calls.failedReads++
                  return yield* systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFile",
                    pathOrDescriptor: absolute,
                  })
                }
                return yield* graph.fs.readFile(file)
              }),
          },
        })
        expect(
          yield* injected
            .apply({
              candidate: candidate("unconfirmed replacement"),
              target: selected?.target,
              baseRevision: saved.revision,
              overwrite: true,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.RollbackFailedError)
        expect(calls.writes).toBe(failure === "write" ? 2 : 1)
        const reader = selected ?? graph.registry
        yield* reader.reload()
        expect((yield* reader.getByPath("review.md")).source).toBe("unconfirmed replacement")
      }),
    )
  }

  for (const field of [
    "kind",
    "name",
    "description",
    "relativePath",
    "invocation",
    "args",
    "source",
    "target-scope",
    "target-root",
  ] as const) {
    it.live("compares Command " + field + " during semantic readback even when revision matches: " + mode, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const graph = yield* openLocation(tmp.path)
        const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
        const saved = yield* graph.service.apply({
          candidate: candidate("original"),
          target: selected?.target,
          baseRevision: null,
          overwrite: false,
        })
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
        const previous = yield* graph.fs.readFile(absolute)
        const state = { writes: 0, corruptions: 0 }
        const corrupt = (info: CommandAsset.Info) => {
          if (state.writes !== 1 || state.corruptions !== 0) return info
          state.corruptions++
          if (field === "kind") {
            const readback = { ...info }
            // Corrupt only this returned registry value, including a literal its static interface excludes.
            Object.defineProperty(readback, "kind", { value: "skill" })
            return readback
          }
          if (field === "target-scope" || field === "target-root") {
            const target =
              selected?.target ??
              new AssetPlacement.Target({
                scope: "location",
                root: AbsolutePath.make(path.dirname(absolute)),
              })
            return {
              ...info,
              target: new AssetPlacement.Target({
                scope: field === "target-scope" ? (target.scope === "project" ? "location" : "project") : target.scope,
                root: field === "target-root" ? AbsolutePath.make(path.join(target.root, "other")) : target.root,
              }),
            }
          }
          return { ...info, [field]: "inconsistent readback" }
        }
        const injected = yield* faultService(graph, {
          files: {
            writeAtomic: (input) =>
              graph.files.writeAtomic(input).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    state.writes++
                  }),
                ),
              ),
          },
          registry:
            mode === "legacy"
              ? {
                  getByPath: (relativePath) => graph.registry.getByPath(relativePath).pipe(Effect.map(corrupt)),
                }
              : {
                  select: (scope) =>
                    graph.registry.select(scope).pipe(
                      Effect.map((view) => ({
                        ...view,
                        getByPath: (relativePath: string) => view.getByPath(relativePath).pipe(Effect.map(corrupt)),
                      })),
                    ),
                },
        })
        expect(
          yield* injected
            .apply({
              candidate: candidate("replacement"),
              target: selected?.target,
              baseRevision: saved.revision,
              overwrite: true,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.ReadbackMismatchError)
        expect(state.corruptions).toBe(1)
        expect(state.writes).toBe(2)
        expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
        const reader = selected ?? graph.registry
        expect(yield* reader.getByPath("review.md")).toEqual(saved)
      }),
    )
  }

  it.live("restores deleted Command bytes after a transient owner reload failure: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
      const saved = yield* graph.service.apply({
        candidate: candidate("original"),
        target: selected?.target,
        baseRevision: null,
        overwrite: false,
      })
      const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
      const previous = yield* graph.fs.readFile(absolute)
      const state = { deleted: false, failures: 0, restores: 0 }
      const reload = <E>(actual: () => Effect.Effect<void, E>) =>
        Effect.gen(function* () {
          if (state.deleted && state.failures === 0) {
            state.failures++
            return yield* new FSUtil.FileSystemError({
              method: "reload",
              cause: new Error("Injected owner reload failure"),
            })
          }
          return yield* actual()
        })
      const injected = yield* faultService(graph, {
        files: {
          remove: (input) =>
            graph.files.remove(input).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  state.deleted = true
                }),
              ),
            ),
          writeAtomic: (input) =>
            graph.files.writeAtomic(input).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  state.restores++
                }),
              ),
            ),
        },
        registry:
          mode === "legacy"
            ? {
                reload: () => reload(graph.registry.reload),
              }
            : {
                select: (scope) =>
                  graph.registry.select(scope).pipe(
                    Effect.map((view) => ({
                      ...view,
                      reload: () => reload(view.reload),
                    })),
                  ),
              },
      })
      expect(
        yield* injected
          .delete({
            relativePath: "review.md",
            target: selected?.target,
            baseRevision: saved.revision,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(CommandAssetService.WriteFailedError)
      expect(state.failures).toBe(1)
      expect(state.restores).toBe(1)
      expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
      const reader = selected ?? graph.registry
      expect(yield* reader.getByPath("review.md")).toEqual(saved)
    }),
  )

  for (const recreation of ["same", "different"] as const) {
    it.live("does not overwrite an external Command recreation with " + recreation + " bytes: " + mode, () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const graph = yield* openLocation(tmp.path)
        const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
        const saved = yield* graph.service.apply({
          candidate: candidate("original"),
          target: selected?.target,
          baseRevision: null,
          overwrite: false,
        })
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".omnixa/commands"), "review.md")
        const previous = yield* graph.fs.readFileString(absolute)
        const external = recreation === "same" ? previous : previous.replace("original", "external recreation")
        const calls = { restores: 0 }
        const injected = yield* faultService(graph, {
          files: {
            remove: (input) =>
              Effect.gen(function* () {
                const result = yield* graph.files.remove(input)
                yield* graph.fs.writeFileString(absolute, external).pipe(Effect.orDie)
                return result
              }),
            writeAtomic: (input) =>
              graph.files.writeAtomic(input).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    calls.restores++
                  }),
                ),
              ),
          },
        })
        expect(
          yield* injected
            .delete({
              relativePath: "review.md",
              target: selected?.target,
              baseRevision: saved.revision,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(CommandAssetService.ConcurrentModificationError)
        expect(calls.restores).toBe(0)
        expect(yield* graph.fs.readFileString(absolute)).toBe(external)
      }),
    )
  }
}

it.live("uses frontmatter names for selected Command conflicts and rolls back only the new duplicate", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    yield* graph.service.apply({
      candidate: candidate("preserved original"),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    const original = path.join(view.target.root, "original.md")
    yield* graph.fs.rename(path.join(view.target.root, "review.md"), original)
    const previous = yield* graph.fs.readFile(original)
    const facts = yield* graph.service.inspect({ candidate: candidate(), scope: "project" })
    expect(facts.nameConflict).toBe(true)
    expect(facts.pathConflict).toBe(false)
    expect(facts.exists).toBe(false)
    expect(
      yield* graph.service
        .apply({
          candidate: candidate("new duplicate"),
          target: view.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(CommandAssetService.ReadbackMismatchError)
    expect(yield* graph.fs.readFile(original)).toEqual(previous)
    expect(yield* graph.fs.exists(path.join(view.target.root, "review.md"))).toBe(false)
    expect(yield* view.listInvalid()).toEqual([])
    expect((yield* view.findByName("review"))?.relativePath).toBe("original.md")
    yield* graph.fs.rename(original, path.join(view.target.root, "other.md"))
    const other = Schema.decodeUnknownSync(Candidate)({
      ...candidate(),
      name: "different",
      relativePath: "different.md",
    })
    const created = yield* graph.service.apply({
      candidate: other,
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    yield* graph.fs.rename(path.join(view.target.root, "different.md"), path.join(view.target.root, "review.md"))
    const conflicted = yield* graph.service.inspect({ candidate: candidate(), scope: "project" })
    expect(conflicted).toMatchObject({
      exists: true,
      revision: created.revision,
      nameConflict: true,
      pathConflict: true,
    })
    yield* graph.fs.writeFileString(path.join(view.target.root, "broken.md"), "not command frontmatter")
    expect(yield* view.getInvalid("broken.md")).toEqual({ relativePath: "broken.md", errorTag: "parse_error" })
    expect(yield* graph.fs.readFileString(path.join(view.target.root, "broken.md"))).toBe("not command frontmatter")
  }),
)

for (const changes of ["legacy", "selected"] as const) {
  it.live("keeps Composition Command bindings at their Location and preserves frozen source: " + changes, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const child = path.join(tmp.path, "src")
      yield* fs.makeDirectory(child)
      yield* Effect.promise(() => initRepo(tmp.path))
      yield* fs.writeWithDirs(
        path.join(child, ".omnixa/agents/coder.md"),
        "---\nkind: agent\nname: coder\ndescription: Coder\n---\nCoder body\n",
      )
      const raw =
        "---\nkind: command\nname: review\ndescription: Same description\ninvocation: /review-frozen\nargs: '<files>'\n---\n"
      yield* fs.writeWithDirs(path.join(child, ".omnixa/commands/review.md"), raw + "Location $ARGUMENTS")
      yield* fs.writeWithDirs(path.join(tmp.path, ".omnixa/commands/review.md"), raw + "Project $ARGUMENTS")
      yield* fs.writeWithDirs(path.join(global.config, "commands/review.md"), raw + "Global $ARGUMENTS")
      const graph = yield* openLocation(child)
      const services = yield* Layer.build(
        AppNodeBuilder.build(LayerNode.group([CompositionResolver.node, Agent.node, AgentAsset.node]), [
          Location.node.replace(Layer.succeed(Location.Service, graph.location)),
          LocationMutation.node.replace(Layer.succeed(LocationMutation.Service, graph.mutation)),
          FSUtil.node.replace(Layer.succeed(FSUtil.Service, fs)),
          Global.node.replace(Layer.succeed(Global.Service, global)),
          Environment.node.replace(transformEnvironmentFiles()),
          CommandAsset.node.replace(Layer.succeed(CommandAsset.Service, graph.registry)),
          // Freeze reads connection facts and tool schemas; it must not open a provider or MCP connection.
          McpConnection.node.replace(Layer.mock(McpConnection.Service, { facts: () => Effect.succeed([]) })),
          Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
        ]),
      )
      const agents = Context.get(services, Agent.Service)
      yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
      const agentAssets = Context.get(services, AgentAsset.Service)
      const agent = yield* agentAssets.getByPath("coder.md")
      const resolver = Context.get(services, CompositionResolver.Service)
      const command = yield* graph.registry.getByPath("review.md")
      const binding = new Composition.Binding({
        prompts: [],
        skills: [],
        commands: [
          new Composition.CommandRef({
            kind: "command",
            relativePath: "review.md",
            revision: Composition.Revision.make(command.revision),
          }),
        ],
      })
      const input = new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          new Composition.AgentRef({
            kind: "agent",
            relativePath: "coder.md",
            revision: Composition.Revision.make(agent.revision),
          }),
        ],
        bindings: { orchestrator: binding, "agents/coder": binding },
        presentation: "native",
        requestedCapabilities: [],
      })
      const frozen = yield* resolver.freeze(new Composition.FreezeInput({ input }))
      expect(frozen.data.sourceLocation).toEqual(Location.Ref.make({ directory: AbsolutePath.make(child) }))
      expect(frozen.data.commands).toHaveLength(1)
      const consumers = ["orchestrator", "agents/coder"]
      consumers.forEach((consumer) => {
        expect(frozen.data.bindings?.[consumer].commands).toHaveLength(1)
        expect(frozen.data.bindings?.[consumer].commands[0]).toMatchObject({
          name: "review",
          relativePath: "review.md",
          revision: command.revision,
          invocation: "/review-frozen",
          args: "<files>",
          source: "Location $ARGUMENTS",
        })
      })
      if (changes === "selected") {
        yield* Effect.forEach(["project", "global"] as const, (scope) =>
          Effect.gen(function* () {
            const view = yield* graph.registry.select(scope)
            const current = yield* view.getByPath("review.md")
            const updated = yield* graph.service.apply({
              candidate: candidate("Changed " + scope),
              target: view.target,
              baseRevision: current.revision,
              overwrite: true,
            })
            yield* graph.service.delete({
              relativePath: "review.md",
              target: view.target,
              baseRevision: updated.revision,
            })
          }),
        )
        const unchanged = yield* resolver.freeze(new Composition.FreezeInput({ input }))
        expect(unchanged.data.sourceLocation).toEqual(frozen.data.sourceLocation)
        expect(unchanged.data.bindings).toEqual(frozen.data.bindings)
      }
      const updated = yield* graph.service.apply({
        candidate: candidate("Changed Location body"),
        baseRevision: command.revision,
        overwrite: true,
      })
      yield* graph.service.delete({ relativePath: "review.md", baseRevision: updated.revision })
      expect(yield* graph.registry.list()).toEqual([])
      const current = yield* resolver.resolve(input)
      expect(current.diagnostics.some((item) => item.code === "command_not_found")).toBe(true)
      consumers.forEach((consumer) => {
        expect(frozen.data.bindings?.[consumer].commands[0].source).toBe("Location $ARGUMENTS")
        expect(frozen.data.bindings?.[consumer].commands[0].invocation).toBe("/review-frozen")
      })
      expect(frozen.data.sourceLocation).toEqual(Location.Ref.make({ directory: AbsolutePath.make(child) }))
    }),
  )
}
