import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect"
import { systemError } from "effect/PlatformError"
import os from "os"
import path from "path"
import { FSUtil } from "@omnixa/util/fs-util"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { PromptAsset } from "../src/prompt-asset"
import { SkillAsset } from "../src/skill-asset"
import { SkillAssetService } from "../src/skill-asset-service"
import { AssetPlacement } from "../src/asset-placement"
import { Candidate, Revision } from "@omnixa/schema/skill-asset"
import { FileMutation } from "../src/file-mutation"
import { Environment } from "../src/environment/index"
import { Project } from "../src/project"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Global } from "@omnixa/util/global"
import { AssetKind } from "../src/asset-kind"
import { AbsolutePath } from "../src/schema"
import { NodeFileSystem } from "@effect/platform-node"
import { location } from "./fixture/location"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { transformEnvironmentFiles } from "./fixture/environment"
import { initRepo } from "./fixture/git"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([FSUtil.node, Project.node, Global.node]), [
    Global.node.replace(tempGlobalLayer),
  ]),
)

describe("SkillAsset", () => {
  it.live("loads skills and isolates from prompts with same filename", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "omnixa-skill-test-" })
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

      const baseLayer = Layer.mergeAll(
        locationLayer,
        fsLayer,
        AssetKind.layer,
        Layer.succeed(Global.Service, yield* Global.Service),
      )
      const testAppLayer = Layer.mergeAll(SkillAsset.layer, PromptAsset.layer).pipe(
        Layer.provide(LocationMutation.layer),
        Layer.provide(baseLayer),
      )

      return yield* Effect.gen(function* () {
        const skillService = yield* SkillAsset.Service
        const promptService = yield* PromptAsset.Service

        const skillDir = path.resolve(tmpDir, ".omnixa/skills")
        const promptDir = path.resolve(tmpDir, ".omnixa/prompts")

        yield* fs.makeDirectory(skillDir, { recursive: true })
        yield* fs.makeDirectory(promptDir, { recursive: true })

        const skillFile = path.join(skillDir, "my-tool.md")
        const promptFile = path.join(promptDir, "my-tool.md")

        yield* fs.writeFileString(
          skillFile,
          '---\nname: "my-tool"\ndescription: "skill desc"\nslash: true\ntriggers:\n  - review\ntags:\n  - test\n---\nSkill body',
        )

        yield* fs.writeFileString(
          promptFile,
          '---\nkind: prompt\nname: "my-tool"\ndescription: "prompt desc"\n---\nHello Prompt',
        )

        yield* skillService.reload()
        yield* promptService.reload()

        const skills = yield* skillService.list()
        const prompts = yield* promptService.list()

        expect(skills.length).toBe(1)
        expect(skills[0].name).toBe("my-tool")
        expect(skills[0].kind).toBe("skill")
        expect(skills[0].slash).toBe(true)
        expect(skills[0].content).toBe("Skill body")
        expect(skills[0].triggers).toEqual(["review"])
        expect(skills[0].tags).toEqual(["test"])

        expect(prompts.length).toBe(1)
        expect(prompts[0].name).toBe("my-tool")
        expect(prompts[0].kind).toBe("prompt")
      }).pipe(Effect.provide(testAppLayer))
    }).pipe(Effect.provide(fsLayer)),
  )
})

const openLocation = Effect.fnUntraced(function* (
  directory: string,
  options: { readonly global?: Global.Interface } = {},
) {
  const fs = yield* FSUtil.Service
  const project = yield* Project.Service
  const global = options.global ?? (yield* Global.Service)
  const services = yield* Layer.build(
    AppNodeBuilder.build(
      LayerNode.group([
        Location.node,
        LocationMutation.node,
        SkillAsset.node,
        SkillAssetService.node,
        FileMutation.node,
      ]),
      [
        Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(directory) })),
        Project.node.replace(Layer.succeed(Project.Service, project)),
        Global.node.replace(Layer.succeed(Global.Service, global)),
        FSUtil.node.replace(Layer.succeed(FSUtil.Service, fs)),
        Environment.node.replace(transformEnvironmentFiles()),
      ],
    ),
  )
  return {
    fs,
    location: Context.get(services, Location.Service),
    mutation: Context.get(services, LocationMutation.Service),
    registry: Context.get(services, SkillAsset.Service),
    service: Context.get(services, SkillAssetService.Service),
    files: Context.get(services, FileMutation.Service),
  }
})

type LocationGraph = Effect.Success<ReturnType<typeof openLocation>>

const candidate = (content = "# Review\n\nKeep this body exactly.\r\n", relativePath = "review.md") =>
  new Candidate({
    name: "review",
    description: "Review changes",
    relativePath,
    slash: true,
    content,
    triggers: ["manual", "review"],
    tags: ["quality"],
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
    await $`git remote add origin https://github.com/skill-placement/fixture.git`.cwd(main).quiet()
    await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
    await $`git remote set-url origin https://github.com/skill-placement/fixture.git`.cwd(clone).quiet()
    await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
  })
  return { main, clone, linked }
})

const faultService = Effect.fnUntraced(function* (
  graph: LocationGraph,
  input: {
    readonly files?: Partial<FileMutation.Interface>
    readonly fs?: Partial<FSUtil.Interface>
    readonly registry?: Partial<SkillAsset.Interface>
  },
) {
  return yield* SkillAssetService.Service.pipe(
    Effect.provide(Layer.fresh(SkillAssetService.layer)),
    Effect.provideService(FSUtil.Service, { ...graph.fs, ...input.fs }),
    Effect.provideService(LocationMutation.Service, graph.mutation),
    Effect.provideService(SkillAsset.Service, { ...graph.registry, ...input.registry }),
    Effect.provideService(FileMutation.Service, { ...graph.files, ...input.files }),
  )
})

describe("Skill selected owner", () => {
  it.live("uses the actual current Project from a repository child and keeps legacy Location writes separate", () =>
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
        target: { scope: "project", root: AbsolutePath.make(path.join(tmp.path, ".omnixa/skills")) },
      })
      expect(view.target).toEqual(facts.target)
      expect(yield* fs.exists(view.target.root)).toBe(false)
      const saved = yield* graph.service.apply({
        candidate: candidate(),
        target: facts.target,
        baseRevision: null,
        overwrite: false,
      })
      expect(saved.target).toEqual(facts.target)
      expect(saved.content).toBe(candidate().content)
      expect(saved.triggers).toEqual(candidate().triggers)
      expect(saved.tags).toEqual(candidate().tags)
      expect(yield* view.getByPath("review.md")).toEqual(saved)
      expect(yield* graph.registry.list()).toEqual([])
      expect(yield* fs.exists(path.join(child, ".omnixa/skills/review.md"))).toBe(false)

      expect(yield* graph.service.propose(candidate("legacy", ""))).toEqual({
        relativePath: "review.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      const legacy = yield* graph.service.apply({
        candidate: candidate("legacy"),
        baseRevision: null,
        overwrite: false,
      })
      expect(legacy.target).toBeUndefined()
      expect(Object.keys(legacy)).not.toContain("target")
      expect((yield* graph.registry.getByPath("review.md")).content).toBe("legacy")
      expect((yield* view.getByPath("review.md")).content).toBe(candidate().content)
    }),
  )

  it.live("uses the exact markerless Location and the shared canonical Global.config/skills root", () =>
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
      expect((yield* first.registry.select("project")).target.root).toBe(
        AbsolutePath.make(path.join(firstDirectory, ".omnixa/skills")),
      )
      const view = yield* second.registry.select("global")
      expect(view.target.root).toBe(AbsolutePath.make(path.join(global.config, "skills")))
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
      expect(yield* fs.exists(path.join(global.config, ".omnixa/skills"))).toBe(false)
      expect(yield* first.registry.list()).toEqual([])
      yield* second.service.delete({ relativePath: "review.md", target: view.target, baseRevision: updated.revision })
      expect(yield* (yield* first.registry.select("global")).list()).toEqual([])
    }),
  )

  it.live("keeps inspection read-only and imports legacy sources only on a legacy registry call", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const legacyFile = path.join(tmp.path, ".claude/skills/imported/SKILL.md")
      const original = "---\nname: imported\ndescription: Imported description\n---\nOriginal legacy body\n"
      yield* fs.writeWithDirs(legacyFile, original)
      const graph = yield* openLocation(tmp.path)
      const selected = yield* graph.registry.select("project")
      expect(yield* selected.list()).toEqual([])
      expect((yield* graph.service.inspect({ candidate: candidate(), scope: "project" })).exists).toBe(false)
      expect((yield* graph.service.inspect({ candidate: candidate(), scope: "global" })).exists).toBe(false)
      expect(yield* (yield* graph.registry.select("location")).list()).toEqual([])
      expect(yield* fs.exists(selected.target.root)).toBe(false)
      expect(yield* fs.readFileString(legacyFile)).toBe(original)
      const legacy = yield* graph.registry.list()
      expect(legacy.map((value) => value.name)).toEqual(["imported"])
      expect(legacy[0].target).toBeUndefined()
      const refreshed = yield* selected.getByPath("imported.md")
      expect(refreshed.content).toBe("Original legacy body\n")
      expect(refreshed.target).toEqual(selected.target)
    }),
  )
})

it.live("keeps worktree and clone owners independent even when Project IDs and saved revisions match", () =>
  Effect.gen(function* () {
    const roots = yield* checkouts()
    const fs = yield* FSUtil.Service
    const project = yield* Project.Service
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
        AbsolutePath.make(path.join(directory, ".omnixa/skills")),
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
        .delete({ relativePath: "review.md", target: views[1].target, baseRevision: saved[1].revision })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
    expect((yield* project.list()).find((value) => value.id === graphs[0].location.project.id)?.canonical).toBe(
      AbsolutePath.make(roots.main),
    )
    yield* Effect.forEach(views, (view) =>
      view.getByPath("review.md").pipe(
        Effect.tap((value) => {
          expect(value.content).toBe(candidate().content)
          return Effect.void
        }),
      ),
    )
  }),
)

it.live("accepts a configured Global base alias but rejects owner and child symlinks, including dangling links", () =>
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
    expect(globalView.target.root).toBe(AbsolutePath.make(path.join(outside, "skills")))
    expect(yield* globalView.list()).toEqual([])
    expect(yield* fs.exists(globalView.target.root)).toBe(false)

    yield* fs.symlink(outside, path.join(directory, ".omnixa"))
    expect(yield* graph.registry.select("project").pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    yield* fs.remove(path.join(directory, ".omnixa"))
    yield* fs.makeDirectory(path.join(directory, ".omnixa"))
    yield* fs.symlink(outside, path.join(directory, ".omnixa/skills"))
    expect(yield* graph.service.inspect({ candidate: candidate(), scope: "project" }).pipe(Effect.flip)).toBeInstanceOf(
      AssetPlacement.PathError,
    )
    yield* fs.remove(path.join(directory, ".omnixa/skills"))
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
        .apply({ candidate: candidate(), target: view.target, baseRevision: null, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(
      yield* graph.service
        .delete({ relativePath: "review.md", target: view.target, baseRevision: null })
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
        .apply({ candidate: candidate(), target: view.target, baseRevision: null, overwrite: false })
        .pipe(Effect.flip),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* fs.exists(path.join(outside, "missing.md"))).toBe(false)
    yield* fs.remove(link)
    const saved = yield* graph.service.apply({
      candidate: candidate(),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    expect(saved.content).toBe(candidate().content)
  }),
)

it.live("validates reviewed short paths and requires an exact revision for apply and delete", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    expect(yield* graph.service.propose(candidate("old proposal", ""))).toEqual({
      relativePath: "review.md",
      exists: false,
      revision: null,
      nameConflict: false,
      pathConflict: false,
    })
    yield* Effect.forEach(["", "different.md", "../review.md", ".omnixa/skills/review.md"], (relativePath) =>
      Effect.gen(function* () {
        expect(
          yield* graph.service
            .inspect({ candidate: candidate("rejected", relativePath), scope: "project" })
            .pipe(Effect.flip),
        ).toBeInstanceOf(SkillAssetService.InvalidCandidateError)
        expect(
          yield* graph.service
            .apply({
              candidate: candidate("rejected", relativePath),
              target: view.target,
              baseRevision: null,
              overwrite: false,
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(SkillAssetService.InvalidCandidateError)
        expect(
          yield* graph.service
            .apply({ candidate: candidate("rejected", relativePath), baseRevision: null, overwrite: false })
            .pipe(Effect.flip),
        ).toBeInstanceOf(SkillAssetService.InvalidCandidateError)
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
        .apply({ candidate: candidate("stale"), target: view.target, baseRevision: null, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
    expect(
      yield* graph.service
        .apply({
          candidate: candidate("needs confirmation"),
          target: view.target,
          baseRevision: first.revision,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.OverwriteRequiredError)
    expect(
      yield* graph.service
        .delete({ relativePath: "review.md", target: view.target, baseRevision: null })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
    expect(
      yield* graph.service.delete({ relativePath: "review.md", baseRevision: null }).pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
    const next = yield* graph.service.apply({
      candidate: candidate("next"),
      target: view.target,
      baseRevision: first.revision,
      overwrite: true,
    })
    expect(
      yield* graph.service
        .delete({ relativePath: "review.md", target: view.target, baseRevision: first.revision })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
    expect((yield* view.getByPath("review.md")).content).toBe("next")
    yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: next.revision })
    expect(
      yield* graph.service
        .delete({ relativePath: "review.md", target: view.target, baseRevision: next.revision })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
    yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: null })
    expect(yield* view.list()).toEqual([])
  }),
)

for (const mode of ["project", "global", "legacy"] as const) {
  it.live("serializes the complete Skill CAS transaction across two Location graphs: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const firstDirectory = path.join(tmp.path, "first")
      const secondDirectory = mode === "legacy" ? tmp.path : path.join(tmp.path, "second")
      yield* fs.makeDirectory(firstDirectory)
      if (mode !== "legacy") yield* fs.makeDirectory(secondDirectory)
      yield* Effect.promise(() => initRepo(tmp.path))
      const first = yield* openLocation(firstDirectory)
      const second = yield* openLocation(secondDirectory)
      const selected = yield* first.registry.select(mode === "global" ? "global" : "project")
      const secondSelected = mode === "legacy" ? undefined : yield* second.registry.select(mode)
      if (secondSelected) expect(secondSelected.target).toEqual(selected.target)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const secondWrote = yield* Deferred.make<void>()
      const firstService = yield* faultService(first, {
        files: {
          writeAtomic: (input) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return yield* first.files.writeAtomic(input)
            }),
        },
      })
      const secondService = yield* faultService(second, {
        files: {
          withLock: (targets) => (effect) =>
            Deferred.succeed(attempted, undefined).pipe(Effect.andThen(second.files.withLock(targets)(effect))),
          writeAtomic: (input) =>
            Deferred.succeed(secondWrote, undefined).pipe(Effect.andThen(second.files.writeAtomic(input))),
        },
      })
      const scope = yield* Scope.Scope
      const firstFiber = yield* firstService
        .apply({
          candidate: candidate("first wins"),
          target: selected.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.forkIn(scope))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* awaitWithTimeout(Deferred.await(entered), "First Skill transaction did not reach its write", "10 seconds")
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
        "Second Skill transaction did not request its lock",
        "10 seconds",
      )
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      yield* Deferred.succeed(release, undefined)
      const saved = yield* awaitWithTimeout(
        Fiber.join(firstFiber),
        "First Skill transaction did not complete",
        "10 seconds",
      )
      expect(
        yield* awaitWithTimeout(Fiber.join(secondFiber), "Second Skill CAS did not settle", "10 seconds"),
      ).toBeInstanceOf(SkillAssetService.StaleRevisionError)
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      expect(saved.content).toBe("first wins")
      expect((yield* selected.getByPath("review.md")).revision).toBe(saved.revision)
      if (secondSelected) expect((yield* secondSelected.getByPath("review.md")).content).toBe("first wins")
      if (!secondSelected) expect((yield* second.registry.getByPath("review.md")).content).toBe("first wins")
    }),
  )
}

it.live("allows linked worktree and clone writes to finish while another checkout holds its same-name file lock", () =>
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
    const fiber = yield* service
      .apply({ candidate: candidate(), target: view.target, baseRevision: null, overwrite: false })
      .pipe(Effect.forkIn(yield* Scope.Scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(entered), "Main checkout did not reach its Skill write", "10 seconds")
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
          "Independent checkout was blocked by another Skill owner",
          "10 seconds",
        )
        expect(saved.target).toEqual(selected.target)
      }),
    )
    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(fiber)).content).toBe(candidate().content)
  }),
)

for (const scope of [undefined, "project"] as const) {
  for (const existing of [false, true]) {
    it.live(
      "rolls back the first Skill readback failure: " + (scope ?? "legacy") + (existing ? " overwrite" : " create"),
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          const graph = yield* openLocation(tmp.path)
          const view = yield* graph.registry.select(scope ?? "location")
          const target = scope ? view.target : undefined
          const saved = existing
            ? yield* graph.service.apply({
                candidate: candidate("original"),
                target,
                baseRevision: null,
                overwrite: false,
              })
            : undefined
          const absolute = path.join(view.target.root, "review.md")
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
                target,
                baseRevision: saved?.revision ?? null,
                overwrite: existing,
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(SkillAssetService.WriteFailedError)
          expect(calls.failures).toBe(1)
          expect(calls.writes).toBe(existing ? 2 : 1)
          expect(yield* view.listInvalid()).toEqual([])
          if (!saved) {
            expect(yield* graph.fs.exists(absolute)).toBe(false)
            expect(yield* view.list()).toEqual([])
            return
          }
          if (previous === null)
            return yield* Effect.die(new Error("The existing Skill fixture must retain its original bytes"))
          expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
          expect((yield* view.getByPath("review.md")).content).toBe("original")
          expect((yield* view.getByPath("review.md")).revision).toBe(saved.revision)
        }),
    )
  }
}

it.live("preserves an external overwrite that arrives before the first Skill readback", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    const saved = yield* graph.service.apply({
      candidate: candidate("original"),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    const absolute = path.join(view.target.root, "review.md")
    const external = (yield* graph.fs.readFileString(absolute)).replace("original", "external")
    const calls = { writes: 0 }
    const injected = yield* faultService(graph, {
      files: {
        writeAtomic: (input) =>
          Effect.gen(function* () {
            const result = yield* graph.files.writeAtomic(input)
            calls.writes++
            // A direct filesystem write represents a process outside the cooperating transaction lock.
            if (calls.writes === 1) yield* graph.fs.writeFileString(absolute, external).pipe(Effect.orDie)
            return result
          }),
      },
    })
    expect(
      yield* injected
        .apply({
          candidate: candidate("replacement"),
          target: view.target,
          baseRevision: saved.revision,
          overwrite: true,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.ConcurrentModificationError)
    expect(calls.writes).toBe(1)
    expect(yield* graph.fs.readFileString(absolute)).toBe(external)
    expect((yield* view.getByPath("review.md")).content).toBe("external")
  }),
)

for (const failure of ["read", "write"] as const) {
  it.live("reports a Skill rollback " + failure + " failure without claiming restoration", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const view = yield* graph.registry.select("project")
      const saved = yield* graph.service.apply({
        candidate: candidate("original"),
        target: view.target,
        baseRevision: null,
        overwrite: false,
      })
      const absolute = path.join(view.target.root, "review.md")
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
            target: view.target,
            baseRevision: saved.revision,
            overwrite: true,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(SkillAssetService.RollbackFailedError)
      expect(calls.writes).toBe(failure === "write" ? 2 : 1)
      expect((yield* view.getByPath("review.md")).content).toBe("unconfirmed replacement")
    }),
  )
}

it.live("restores deleted Skill bytes after a transient selected-registry reload failure", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    const saved = yield* graph.service.apply({
      candidate: candidate("original"),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    const absolute = path.join(view.target.root, "review.md")
    const previous = yield* graph.fs.readFile(absolute)
    const state = { deleted: false, failures: 0, restores: 0 }
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
      registry: {
        select: (scope) =>
          graph.registry.select(scope).pipe(
            Effect.map((selected) => ({
              ...selected,
              reload: () =>
                Effect.gen(function* () {
                  if (state.deleted && state.failures === 0) {
                    state.failures++
                    return yield* new FSUtil.FileSystemError({
                      method: "reload",
                      cause: new Error("Injected selected reload failure"),
                    })
                  }
                  return yield* selected.reload()
                }),
            })),
          ),
      },
    })
    expect(
      yield* injected
        .delete({
          relativePath: "review.md",
          target: view.target,
          baseRevision: saved.revision,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.WriteFailedError)
    expect(state.failures).toBe(1)
    expect(state.restores).toBe(1)
    expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
    expect(yield* view.getByPath("review.md")).toEqual(saved)
  }),
)

it.live("preserves an external file recreation while a Skill delete is being confirmed", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    const saved = yield* graph.service.apply({
      candidate: candidate("original"),
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    const absolute = path.join(view.target.root, "review.md")
    const external = (yield* graph.fs.readFileString(absolute)).replace("original", "external recreation")
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
          target: view.target,
          baseRevision: saved.revision,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.ConcurrentModificationError)
    expect(calls.restores).toBe(0)
    expect(yield* graph.fs.readFileString(absolute)).toBe(external)
    expect((yield* view.getByPath("review.md")).content).toBe("external recreation")
  }),
)

it.live("uses the original loader's duplicate-name decision and rolls back only the new conflicting Skill", () =>
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
    expect((yield* graph.service.inspect({ candidate: candidate(), scope: "project" })).nameConflict).toBe(true)
    expect(
      yield* graph.service
        .apply({
          candidate: candidate("new duplicate"),
          target: view.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip),
    ).toBeInstanceOf(SkillAssetService.ReadbackMismatchError)
    expect(yield* graph.fs.readFile(original)).toEqual(previous)
    expect(yield* graph.fs.exists(path.join(view.target.root, "review.md"))).toBe(false)
    expect(yield* view.listInvalid()).toEqual([])
    expect((yield* view.findByName("review"))?.relativePath).toBe("original.md")
  }),
)
