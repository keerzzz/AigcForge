import path from "path"
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import { Candidate, Revision } from "@aigcfroge/schema/prompt-asset"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { AssetPlacement } from "@aigcfroge/core/asset-placement"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Environment } from "@aigcfroge/core/environment/index"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { Project } from "@aigcfroge/core/project"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { Hash } from "@aigcfroge/util/hash"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Location } from "@aigcfroge/core/location"
import { Bus } from "@aigcfroge/core/bus"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { hostEnvironmentLayer, transformEnvironmentFiles } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { initRepo } from "./fixture/git"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Event } from "@aigcfroge/schema/event"
import fs from "fs/promises"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([FSUtil.node, Project.node, Global.node]), [
    Global.node.replace(tempGlobalLayer),
  ]),
)

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

function fullLayer(dir: string) {
  return PromptAssetService.locationLayer.pipe(
    Layer.provide(FileMutation.layer),
    Layer.provide(PromptAsset.locationLayer),
    Layer.provide(LocationMutation.locationLayer),
    Layer.provide(tempGlobalLayer),
    Layer.provide(fsLayer),
    Layer.provide(hostEnvironmentLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(fsLayer),
  )
}

function runNow<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  return (Effect as unknown as { runPromise: (e: Effect.Effect<A, unknown>) => Promise<A> }).runPromise(
    effect as unknown as Effect.Effect<A, unknown>,
  )
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await tmpdir()
  try {
    return await fn(tmp.path)
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

async function initAsset(dir: string, name: string) {
  const d = path.join(dir, ".aigcfroge", "prompts")
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(
    path.join(d, `${name}.md`),
    `---\nkind: prompt\nname: "${name}"\ndescription: "test"\n---\noriginal content`,
  )
}

function makeCandidate(name: string, description = "desc", template = "content") {
  return Schema.decodeUnknownSync(Candidate)({ name, description, template, relativePath: "" })
}

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
        PromptAsset.node,
        PromptAssetService.node,
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
    registry: Context.get(services, PromptAsset.Service),
    service: Context.get(services, PromptAssetService.Service),
    files: Context.get(services, FileMutation.Service),
  }
})

type LocationGraph = Effect.Success<ReturnType<typeof openLocation>>

const candidate = (
  template = '\uFEFF  Review "{{selection}}" and $ARGUMENTS.\r\n\r\nKeep ${literal} and {{cursor}}.  \r\n',
  relativePath = "review.md",
  name = "review",
) =>
  Schema.decodeUnknownSync(Candidate)({
    name,
    description: 'Review: "quoted" changes',
    template,
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
    await $`git remote add origin https://github.com/prompt-placement/fixture.git`.cwd(main).quiet()
    await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
    await $`git remote set-url origin https://github.com/prompt-placement/fixture.git`.cwd(clone).quiet()
    await $`git worktree add ${linked} -b linked`.cwd(main).quiet()
  })
  return { main, clone, linked }
})

const faultService = Effect.fnUntraced(function* (
  graph: LocationGraph,
  input: {
    readonly files?: Partial<FileMutation.Interface>
    readonly fs?: Partial<FSUtil.Interface>
    readonly registry?: Partial<PromptAsset.Interface>
  },
) {
  return yield* PromptAssetService.Service.pipe(
    Effect.provide(Layer.fresh(PromptAssetService.layer)),
    Effect.provideService(FSUtil.Service, { ...graph.fs, ...input.fs }),
    Effect.provideService(LocationMutation.Service, graph.mutation),
    Effect.provideService(PromptAsset.Service, { ...graph.registry, ...input.registry }),
    Effect.provideService(FileMutation.Service, { ...graph.files, ...input.files }),
  )
})

const concurrentOwners = Effect.fnUntraced(function* (mode: "legacy" | "project" | "global" | "mixed") {
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
  expect(first.service).not.toBe(second.service)
  expect(first.registry).not.toBe(second.registry)
  const selected = mode === "legacy" ? undefined : yield* first.registry.select(mode === "mixed" ? "project" : mode)
  const secondSelected = mode === "legacy" || mode === "mixed" ? undefined : yield* second.registry.select(mode)
  if (secondSelected) {
    if (!selected) throw new Error("Expected the first Prompt owner to be selected")
    expect(secondSelected.target).toEqual(selected.target)
  }
  return {
    first,
    second,
    selected,
    secondSelected,
    absolute: path.join(selected?.target.root ?? path.join(firstDirectory, ".aigcfroge/prompts"), "review.md"),
  }
})

// ---- Phase C.3: Fault injection & concurrency ----

describe("PromptAssetService.propose", () => {
  test("propose returns not-exists for new asset", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const r = await runNow(svc.propose(makeCandidate("new-prompt", "desc", "hello")))
      expect(r.exists).toBe(false)
      expect(r.revision).toBeNull()
    })
  })

  test("propose returns exists for file on disk", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "myprompt")
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const r = await runNow(svc.propose(makeCandidate("myprompt", "desc", "new")))
      expect(r.exists).toBe(true)
      expect(typeof r.revision).toBe("string")
    })
  })
})

describe("PromptAssetService.apply creates", () => {
  test("creates a new asset", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const info = await runNow(
        svc.apply({
          candidate: makeCandidate("my-prompt", "My prompt", "Hello world"),
          baseRevision: null,
          overwrite: false,
        }),
      )
      expect(info.name).toBe("my-prompt")
      expect(info.description).toBe("My prompt")
      expect(info.template).toBe("Hello world")
      expect(info.relativePath).toBe("my-prompt.md")
      expect(info.revision.length).toBe(64)
    })
  })

  test("publishes work.asset_saved after a successful apply (M2 telemetry, no body)", async () => {
    await withTmp(async (dir) => {
      // M1 范式（artifact.test.ts）：Layer.mock EventV2，记录 publish 调用。
      const published: Array<{ type: string; data: unknown }> = []
      const mockEvents = Layer.succeed(
        Bus.Service,
        Bus.Service.of({
          retainsEvents: false,
          publish: ((definition: any, data: any) =>
            Effect.sync(() => {
              published.push({ type: definition.type, data })
              return { id: Event.ID.create(), type: definition.type, data } as Event.Payload
            })) as unknown as Bus.Interface["publish"],
          publishAll: (() => Effect.succeed([])) as unknown as Bus.Interface["publishAll"],
          subscribe: () => Stream.empty,
          log: () => Stream.empty,
          listen: () => Effect.succeed(Effect.void),
          project: () => Effect.void,
          replay: () => Effect.void,
          remove: () => Effect.void,
          claim: () => Effect.void,
        }),
      )
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(
          // M1 范式：mock 放在 locationLayer 的 provide 链内（构造时生效）。
          Effect.provide(
            PromptAssetService.locationLayer.pipe(
              Layer.provide(FileMutation.layer),
              Layer.provide(PromptAsset.locationLayer),
              Layer.provide(LocationMutation.locationLayer),
              Layer.provide(tempGlobalLayer),
              Layer.provide(mockEvents),
              Layer.provide(locationLayer(dir)),
              Layer.provide(fsLayer),
              Layer.provide(hostEnvironmentLayer),
            ),
          ),
          Effect.scoped,
        ),
      )
      await runNow(
        svc.apply({
          candidate: makeCandidate("m2-telemetry", "desc", "content"),
          baseRevision: null,
          overwrite: false,
        }),
      )
      expect(published).toEqual([{ type: "work.asset_saved", data: { relativePath: "m2-telemetry.md" } }])
    })
  })

  test("creates with Chinese name", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const info = await runNow(
        svc.apply({ candidate: makeCandidate("提示词", "中文", "你好"), baseRevision: null, overwrite: false }),
      )
      expect(info.name).toBe("提示词")
      expect(info.template).toBe("你好")
    })
  })

  test("rolls back when the registry rejects a duplicate name", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(
        path.join(promptsDir, "existing.md"),
        `---\nkind: prompt\nname: "duplicate"\ndescription: "existing"\n---\nold`,
      )
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )

      const error = await runNow(
        svc
          .apply({ candidate: makeCandidate("duplicate", "new", "new"), baseRevision: null, overwrite: false })
          .pipe(Effect.flip),
      )

      expect(error).toMatchObject({ _tag: "PromptAssetService.ReadbackMismatch" })
      expect(
        await fs.stat(path.join(promptsDir, "duplicate.md")).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    })
  })

  test("creates and is retrievable after reload", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      await runNow(
        svc.apply({ candidate: makeCandidate("persist", "desc", "data"), baseRevision: null, overwrite: false }),
      )
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* PromptAsset.Service
        }).pipe(
          Effect.provide(
            PromptAsset.locationLayer.pipe(
              Layer.provide(LocationMutation.locationLayer),
              Layer.provide(tempGlobalLayer),
              Layer.provide(fsLayer),
              Layer.provide(locationLayer(dir)),
              Layer.provide(fsLayer),
            ),
          ),
          Effect.scoped,
        ),
      )
      const list = await runNow(reg.list())
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("persist")
    })
  })
})

describe("PromptAssetService.apply overwrite", () => {
  test("overwrites with matching revision", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "existing")
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const propose = await runNow(svc.propose(makeCandidate("existing")))
      expect(propose.exists).toBe(true)
      expect(propose.revision).not.toBeNull()
      const info = await runNow(
        svc.apply({
          candidate: makeCandidate("existing", "updated", "new content"),
          baseRevision: propose.revision!,
          overwrite: true,
        }),
      )
      expect(info.description).toBe("updated")
      expect(info.template).toBe("new content")
    })
  })

  test("fails StaleRevisionError when file exists but baseRevision=null", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "locked")
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      // baseRevision=null means "expect new file", but file exists → StaleRevision
      const err = await runNow(
        svc.apply({ candidate: makeCandidate("locked"), baseRevision: null, overwrite: false }).pipe(Effect.flip),
      )
      expect(err).toMatchObject({ _tag: "PromptAssetService.StaleRevision" })
    })
  })

  test("fails StaleRevisionError on revision mismatch", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "stale")
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const err = await runNow(
        svc
          .apply({ candidate: makeCandidate("stale"), baseRevision: "bad".repeat(32), overwrite: true })
          .pipe(Effect.flip),
      )
      expect(err).toMatchObject({ _tag: "PromptAssetService.StaleRevision" })
    })
  })

  test("fails StaleRevisionError when new file appears between propose and apply", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      // File doesn't exist at propose time
      const propose = await runNow(svc.propose(makeCandidate("surprise")))
      expect(propose.exists).toBe(false)

      // File appears before apply
      await initAsset(dir, "surprise")

      // apply with baseRevision=null (file was new) should fail
      const err = await runNow(
        svc.apply({ candidate: makeCandidate("surprise"), baseRevision: null, overwrite: false }).pipe(Effect.flip),
      )
      expect(err).toMatchObject({ _tag: "PromptAssetService.StaleRevision" })
    })
  })
})

describe("PromptAssetService serializes concurrent writes", () => {
  test("serializes writes to the same target", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )

      const results = await Promise.allSettled([
        runNow(svc.apply({ candidate: makeCandidate("shared", "a", "first"), baseRevision: null, overwrite: false })),
        runNow(svc.apply({ candidate: makeCandidate("shared", "b", "second"), baseRevision: null, overwrite: false })),
      ])
      const successes = results.filter((r): r is PromiseFulfilledResult<PromptAsset.Info> => r.status === "fulfilled")
      expect(successes.length).toBe(1)
    })
  })

  test("allows writes to different targets", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAssetService.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const [a, b] = await Promise.all([
        runNow(svc.apply({ candidate: makeCandidate("alpha", "a", "aaa"), baseRevision: null, overwrite: false })),
        runNow(svc.apply({ candidate: makeCandidate("beta", "b", "bbb"), baseRevision: null, overwrite: false })),
      ])
      expect(a.name).toBe("alpha")
      expect(b.name).toBe("beta")
    })
  })
})

describe("PromptAssetService.delete", () => {
  async function fileExists(dir: string, name: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, ".aigcfroge", "prompts", `${name}.md`))
      return true
    } catch {
      return false
    }
  }

  async function makeSvc(dir: string) {
    return runNow(
      Effect.gen(function* () {
        return yield* PromptAssetService.Service
      }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
    )
  }

  test("deletes an existing asset with matching revision", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "todelete")
      const svc = await makeSvc(dir)
      const propose = await runNow(svc.propose(makeCandidate("todelete")))
      expect(propose.revision).not.toBeNull()
      await runNow(svc.delete({ relativePath: "todelete.md", baseRevision: propose.revision! }))
      expect(await fileExists(dir, "todelete")).toBe(false)
    })
  })

  test("idempotent: deleting non-existent asset succeeds (REST DELETE semantics)", async () => {
    await withTmp(async (dir) => {
      const svc = await makeSvc(dir)
      // 不存在 -> 成功(幂等),不抛 NotFound
      await runNow(svc.delete({ relativePath: "ghost.md", baseRevision: null }))
    })
  })

  test("idempotent: re-delete after success succeeds", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "once")
      const svc = await makeSvc(dir)
      await runNow(svc.delete({ relativePath: "once.md", baseRevision: null }))
      expect(await fileExists(dir, "once")).toBe(false)
      // 重删(已不存在)-> 成功(幂等)
      await runNow(svc.delete({ relativePath: "once.md", baseRevision: null }))
    })
  })

  test("fails StaleRevisionError on revision mismatch and keeps file", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "locked")
      const svc = await makeSvc(dir)
      const err = await runNow(
        svc.delete({ relativePath: "locked.md", baseRevision: "bad".repeat(32) }).pipe(Effect.flip),
      )
      expect(err).toMatchObject({ _tag: "PromptAssetService.StaleRevision" })
      expect(await fileExists(dir, "locked")).toBe(true)
    })
  })

  test("baseRevision=null force-deletes (no CAS, delete-specific semantics)", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "force")
      const svc = await makeSvc(dir)
      await runNow(svc.delete({ relativePath: "force.md", baseRevision: null }))
      expect(await fileExists(dir, "force")).toBe(false)
    })
  })

  test("rejects invalid path (traversal/backslash normalized)", async () => {
    await withTmp(async (dir) => {
      const svc = await makeSvc(dir)
      const err = await runNow(svc.delete({ relativePath: "../escape.md", baseRevision: null }).pipe(Effect.flip))
      expect(err).toMatchObject({ _tag: "PromptAssetService.InvalidCandidate" })
    })
  })

  test("uses normalized path: leading/trailing whitespace does not cause NotFound", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "trim")
      const svc = await makeSvc(dir)
      // 带空格的 relativePath 应被 normalize(trim)后正确删除,而非 NotFound
      await runNow(svc.delete({ relativePath: " trim.md ", baseRevision: null }))
      expect(await fileExists(dir, "trim")).toBe(false)
    })
  })

  test("delete is retrievable as gone after reload", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "gone")
      const svc = await makeSvc(dir)
      await runNow(svc.delete({ relativePath: "gone.md", baseRevision: null }))
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* PromptAsset.Service
        }).pipe(
          Effect.provide(
            PromptAsset.locationLayer.pipe(
              Layer.provide(LocationMutation.locationLayer),
              Layer.provide(tempGlobalLayer),
              Layer.provide(fsLayer),
              Layer.provide(locationLayer(dir)),
              Layer.provide(fsLayer),
            ),
          ),
          Effect.scoped,
        ),
      )
      const list = await runNow(reg.list())
      expect(list.length).toBe(0)
    })
  })
})

describe("Prompt selected owner", () => {
  it.live("inspects and reads each absent owner without creating files or directories", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const child = path.join(tmp.path, "src")
      yield* fs.makeDirectory(child)
      yield* Effect.promise(() => initRepo(tmp.path))
      const graph = yield* openLocation(child)
      yield* Effect.forEach(["project", "global", "location"] as const, (scope) =>
        Effect.gen(function* () {
          const view = yield* graph.registry.select(scope)
          const root =
            scope === "global"
              ? path.join(global.config, "prompts")
              : path.join(scope === "project" ? tmp.path : child, ".aigcfroge/prompts")
          expect(view.target).toEqual({ scope, root: AbsolutePath.make(root) })
          expect(yield* view.list()).toEqual([])
          expect(yield* view.listInvalid()).toEqual([])
          expect(yield* view.findByName("review")).toBeUndefined()
          expect(yield* view.getInvalid("review.md")).toBeUndefined()
          expect(yield* view.getByPath("review.md").pipe(Effect.flip)).toBeInstanceOf(PromptAsset.NotFoundError)
          expect(yield* graph.service.inspect({ candidate: candidate(), scope })).toEqual({
            relativePath: "review.md",
            exists: false,
            revision: null,
            nameConflict: false,
            pathConflict: false,
            target: view.target,
          })
          expect(yield* fs.exists(root)).toBe(false)
        }),
      )
      expect(yield* graph.registry.list()).toEqual([])
      expect(yield* fs.exists(path.join(child, ".aigcfroge"))).toBe(false)
      expect(yield* fs.exists(path.join(tmp.path, ".aigcfroge"))).toBe(false)
      expect(yield* fs.exists(path.join(global.config, ".aigcfroge/prompts"))).toBe(false)
    }),
  )

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
      expect(facts.target).toEqual({
        scope: "project",
        root: AbsolutePath.make(path.join(tmp.path, ".aigcfroge/prompts")),
      })
      expect(view.target).toEqual(facts.target)
      const saved = yield* graph.service.apply({
        candidate: candidate(),
        target: facts.target,
        baseRevision: null,
        overwrite: false,
      })
      expect(saved).toMatchObject({ ...candidate(), kind: "prompt", target: facts.target })
      expect(saved.revision).toBe(
        Hash.sha256(Buffer.from(yield* fs.readFile(path.join(view.target.root, "review.md")))),
      )
      expect(yield* view.getByPath("review.md")).toEqual(saved)
      expect(yield* graph.registry.list()).toEqual([])
      expect(yield* fs.exists(path.join(child, ".aigcfroge/prompts/review.md"))).toBe(false)

      const legacy = yield* graph.service.apply({
        candidate: candidate("Location prompt", "ignored-by-legacy.md"),
        baseRevision: null,
        overwrite: false,
      })
      expect(legacy.relativePath).toBe("review.md")
      expect(legacy).not.toHaveProperty("target")
      expect((yield* graph.registry.getByPath("review.md")).template).toBe("Location prompt")
      expect((yield* view.getByPath("review.md")).template).toBe(candidate().template)
      const local = yield* graph.registry.select("location")
      expect(local.target).toEqual({
        scope: "location",
        root: AbsolutePath.make(path.join(child, ".aigcfroge/prompts")),
      })
      const updated = yield* graph.service.apply({
        candidate: candidate("explicit Location"),
        target: local.target,
        baseRevision: legacy.revision,
        overwrite: true,
      })
      expect(updated.target).toEqual(local.target)
      expect((yield* view.getByPath("review.md")).revision).toBe(saved.revision)
      yield* graph.service.delete({ relativePath: "review.md", target: local.target, baseRevision: updated.revision })
      expect(yield* local.list()).toEqual([])
      expect(yield* view.getByPath("review.md")).toEqual(saved)
    }),
  )

  it.live("keeps same-name same-path Prompt files isolated and preserves the complete template in every owner", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const child = path.join(tmp.path, "src")
      yield* fs.makeDirectory(child)
      yield* Effect.promise(() => initRepo(tmp.path))
      const graph = yield* openLocation(child)
      const owners = yield* Effect.forEach(["project", "global", "location"] as const, (scope) =>
        Effect.gen(function* () {
          const view = yield* graph.registry.select(scope)
          const input = candidate(candidate().template + scope + " 中文  \r\n")
          const saved = yield* graph.service.apply({
            candidate: input,
            target: view.target,
            baseRevision: null,
            overwrite: false,
          })
          const bytes = yield* fs.readFile(path.join(view.target.root, "review.md"))
          expect(saved.template).toBe(input.template)
          expect(saved.name).toBe(input.name)
          expect(saved.description).toBe(input.description)
          expect(saved.revision).toBe(Hash.sha256(Buffer.from(bytes)))
          expect(Buffer.from(bytes).subarray(-Buffer.byteLength(input.template)).toString()).toBe(input.template)
          return { view, saved, bytes }
        }),
      )
      expect(new Set(owners.map((owner) => owner.view.target.root)).size).toBe(3)
      yield* Effect.forEach(owners, (owner) =>
        Effect.gen(function* () {
          yield* owner.view.reload()
          expect(yield* owner.view.list()).toEqual([owner.saved])
          expect(yield* owner.view.getByPath("review.md")).toEqual(owner.saved)
          expect(yield* owner.view.findByName("review")).toEqual(owner.saved)
          expect(yield* owner.view.listInvalid()).toEqual([])
          expect(yield* owner.view.getInvalid("review.md")).toBeUndefined()
          expect(yield* fs.readFile(path.join(owner.view.target.root, "review.md"))).toEqual(owner.bytes)
        }),
      )
      const legacy = yield* graph.registry.getByPath("review.md")
      expect(legacy.template).toBe(candidate().template + "location 中文  \r\n")
      expect(legacy).not.toHaveProperty("target")
    }),
  )

  it.live("uses the exact markerless Location and shares only Global.config/prompts across independent graphs", () =>
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
      expect(project.target.root).toBe(AbsolutePath.make(path.join(firstDirectory, ".aigcfroge/prompts")))
      expect(local.target.root).toBe(project.target.root)
      expect(AssetPlacement.targetMismatch(project.target, local.target)).toBeInstanceOf(
        AssetPlacement.TargetMismatchError,
      )
      const view = yield* second.registry.select("global")
      expect(view.target.root).toBe(AbsolutePath.make(path.join(global.config, "prompts")))
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
      expect(yield* fs.exists(path.join(global.config, ".aigcfroge/prompts"))).toBe(false)
      expect(yield* first.registry.list()).toEqual([])
      expect(yield* second.registry.list()).toEqual([])
      yield* second.service.delete({ relativePath: "review.md", target: view.target, baseRevision: updated.revision })
      const refreshed = yield* first.registry.select("global")
      expect(yield* refreshed.list()).toEqual([])
    }),
  )

  it.live("keeps clone and worktree Prompt owners independent when Project IDs and revisions match", () =>
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
          AbsolutePath.make(path.join(directory, ".aigcfroge/prompts")),
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
      yield* Effect.forEach(views, (view, index) =>
        Effect.gen(function* () {
          expect(yield* view.getByPath("review.md")).toEqual(saved[index])
          expect(Hash.sha256(Buffer.from(yield* fs.readFile(path.join(view.target.root, "review.md"))))).toBe(
            saved[index].revision,
          )
        }),
      )
      const foreignRoot = new AssetPlacement.Target({
        scope: "project",
        root: AbsolutePath.make(path.join(roots.main, "arbitrary")),
      })
      expect(
        yield* graphs[0].service
          .apply({ candidate: candidate(), target: foreignRoot, baseRevision: null, overwrite: true })
          .pipe(Effect.flip),
      ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
      expect(
        yield* graphs[0].service
          .delete({ relativePath: "review.md", target: foreignRoot, baseRevision: "0".repeat(64) })
          .pipe(Effect.flip),
      ).toBeInstanceOf(AssetPlacement.TargetMismatchError)
      expect(yield* fs.exists(foreignRoot.root)).toBe(false)
    }),
  )
})

it.live("binds selected Prompt candidates to the short path derived from the normalized name", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const graph = yield* openLocation(tmp.path)
    const view = yield* graph.registry.select("project")
    yield* Effect.forEach(
      [
        "",
        "other.md",
        "../review.md",
        "nested/review.md",
        ".aigcfroge/prompts/review.md",
        "/review.md",
        "C:\\review.md",
      ],
      (relativePath) =>
        Effect.gen(function* () {
          expect(
            yield* graph.service
              .inspect({ candidate: candidate("rejected", relativePath), scope: "project" })
              .pipe(Effect.flip),
          ).toBeInstanceOf(PromptAssetService.InvalidCandidateError)
          expect(
            yield* graph.service
              .apply({
                candidate: candidate("rejected", relativePath),
                target: view.target,
                baseRevision: null,
                overwrite: false,
              })
              .pipe(Effect.flip),
          ).toBeInstanceOf(PromptAssetService.InvalidCandidateError)
        }),
    )
    yield* Effect.forEach(
      ["", "../review.md", "/review.md", "C:\\review.md", "review.txt", "nested/../review.md"],
      (relativePath) =>
        Effect.gen(function* () {
          expect(
            yield* graph.service.delete({ relativePath, target: view.target, baseRevision: null }).pipe(Effect.flip),
          ).toBeInstanceOf(PromptAssetService.InvalidCandidateError)
        }),
    )
    expect(yield* view.list()).toEqual([])
    expect(yield* graph.fs.exists(view.target.root)).toBe(false)
    const input = candidate("Exact normalized-path body", "Review.md", " Ｒｅｖｉｅｗ ")
    expect((yield* graph.service.inspect({ candidate: input, scope: "project" })).relativePath).toBe("Review.md")
    const saved = yield* graph.service.apply({
      candidate: input,
      target: view.target,
      baseRevision: null,
      overwrite: false,
    })
    expect(saved.name).toBe(input.name)
    expect(saved.relativePath).toBe("Review.md")
    expect(saved.template).toBe(input.template)
    expect(yield* view.getByPath("Review.md")).toEqual(saved)
    expect(yield* graph.fs.exists(path.join(view.target.root, `${input.name}.md`))).toBe(false)
  }),
)

for (const scope of ["project", "global", "location"] as const) {
  it.live("requires exact Prompt apply/delete revisions for selected " + scope, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const view = yield* graph.registry.select(scope)
      const first = yield* graph.service.apply({
        candidate: candidate(),
        target: view.target,
        baseRevision: null,
        overwrite: false,
      })
      expect(yield* graph.service.inspect({ candidate: candidate(), scope })).toEqual({
        relativePath: "review.md",
        exists: true,
        revision: Revision.make(first.revision),
        nameConflict: false,
        pathConflict: false,
        target: view.target,
      })
      yield* Effect.forEach([null, "0".repeat(64)], (baseRevision) =>
        Effect.gen(function* () {
          expect(
            yield* graph.service
              .apply({ candidate: candidate("stale"), target: view.target, baseRevision, overwrite: true })
              .pipe(Effect.flip),
          ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
        }),
      )
      expect(
        yield* graph.service
          .apply({
            candidate: candidate("needs confirmation"),
            target: view.target,
            baseRevision: first.revision,
            overwrite: false,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(PromptAssetService.OverwriteRequiredError)
      expect(
        yield* graph.service
          .delete({ relativePath: "review.md", target: view.target, baseRevision: null })
          .pipe(Effect.flip),
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      expect(yield* view.getByPath("review.md")).toEqual(first)
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
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      expect((yield* view.getByPath("review.md")).template).toBe("next")
      yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: next.revision })
      expect(
        yield* graph.service
          .delete({ relativePath: "review.md", target: view.target, baseRevision: next.revision })
          .pipe(Effect.flip),
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      expect(
        yield* graph.service
          .apply({
            candidate: candidate("missing stale"),
            target: view.target,
            baseRevision: next.revision,
            overwrite: true,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      yield* graph.service.delete({ relativePath: "review.md", target: view.target, baseRevision: null })
      expect(yield* view.list()).toEqual([])
      expect(yield* view.getByPath("review.md").pipe(Effect.flip)).toBeInstanceOf(PromptAsset.NotFoundError)
    }),
  )
}

it.live("preserves five legacy proposal facts, name-derived paths and missing-file delete idempotence", () =>
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
    expect(saved).not.toHaveProperty("target")
    expect(yield* graph.fs.exists(path.join(tmp.path, ".aigcfroge/prompts/ignored.md"))).toBe(false)
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

it.live("loads existing Prompt files when the graph is built and uses frontmatter names for owner conflicts", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const owner = path.join(tmp.path, ".aigcfroge/prompts")
    const existing =
      '---\nkind: prompt\nname: "review"\ndescription: "Existing name"\n---\n\uFEFF  Existing {{CODE}}.\r\n'
    const pathConflict = '---\nkind: prompt\nname: "another-name"\ndescription: "Existing path"\n---\nOther body\r\n'
    yield* fs.writeWithDirs(path.join(owner, "alias.md"), existing)
    yield* fs.writeWithDirs(path.join(owner, "review.md"), pathConflict)
    const graph = yield* openLocation(tmp.path)
    expect((yield* graph.registry.list()).map((info) => info.name).toSorted()).toEqual(["another-name", "review"])
    expect((yield* graph.registry.getByPath("alias.md")).template).toBe("\uFEFF  Existing {{CODE}}.\r\n")
    const view = yield* graph.registry.select("project")
    const facts = yield* graph.service.inspect({ candidate: candidate(), scope: "project" })
    expect(facts).toEqual({
      relativePath: "review.md",
      exists: true,
      revision: Revision.make(Hash.sha256(Buffer.from(pathConflict))),
      nameConflict: true,
      pathConflict: true,
      target: view.target,
    })
    expect(yield* fs.readFileString(path.join(owner, "alias.md"))).toBe(existing)
    expect(yield* fs.readFileString(path.join(owner, "review.md"))).toBe(pathConflict)
    expect(
      yield* graph.service
        .apply({ candidate: candidate(), target: view.target, baseRevision: facts.revision, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(PromptAssetService.ReadbackMismatchError)
    expect(yield* fs.readFileString(path.join(owner, "alias.md"))).toBe(existing)
    expect(yield* fs.readFileString(path.join(owner, "review.md"))).toBe(pathConflict)
    expect((yield* view.list()).map((info) => info.name).toSorted()).toEqual(["another-name", "review"])
    expect(yield* view.listInvalid()).toEqual([])
  }),
)

it.live("accepts a configured Global alias but rejects Prompt owner, child and dangling symlinks", () =>
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
    expect(globalView.target.root).toBe(AbsolutePath.make(path.join(outside, "prompts")))
    expect(yield* globalView.list()).toEqual([])
    expect(yield* fs.exists(globalView.target.root)).toBe(false)
    const globalSaved = yield* graph.service.apply({
      candidate: candidate(),
      target: globalView.target,
      baseRevision: null,
      overwrite: false,
    })
    expect(yield* globalView.getByPath("review.md")).toEqual(globalSaved)
    expect(yield* fs.exists(path.join(outside, ".aigcfroge/prompts"))).toBe(false)
    yield* fs.symlink(outside, path.join(directory, ".aigcfroge"))
    expect(yield* graph.registry.select("project").pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    yield* fs.remove(path.join(directory, ".aigcfroge"))
    yield* fs.makeDirectory(path.join(directory, ".aigcfroge"))
    yield* fs.symlink(outside, path.join(directory, ".aigcfroge/prompts"))
    expect(yield* graph.service.inspect({ candidate: candidate(), scope: "project" }).pipe(Effect.flip)).toBeInstanceOf(
      AssetPlacement.PathError,
    )
    yield* fs.remove(path.join(directory, ".aigcfroge/prompts"))
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
    yield* fs.symlink(outside, path.join(view.target.root, "nested"))
    expect(yield* view.getByPath("nested/external.md").pipe(Effect.flip)).toBeInstanceOf(AssetPlacement.PathError)
    // The shared scanner skips directory symlinks; an explicit linked path still fails above.
    expect(yield* view.list()).toEqual([])
    expect(yield* fs.readFile(external)).toEqual(new TextEncoder().encode("external body"))
  }),
)

for (const mode of ["legacy", "project", "global", "mixed"] as const) {
  it.live("serializes the full Prompt CAS transaction across independent Location graphs: " + mode, () =>
    Effect.gen(function* () {
      const owners = yield* concurrentOwners(mode)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const secondWrote = yield* Deferred.make<void>()
      const locks: string[][] = []
      const firstService = yield* faultService(owners.first, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(Effect.andThen(owners.first.files.withLock(targets)(effect))),
          writeAtomic: (input) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(owners.first.files.writeAtomic(input)),
            ),
        },
      })
      const secondService = yield* faultService(owners.second, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(owners.second.files.withLock(targets)(effect)),
            ),
          // An unlocked implementation signals its reached write, so this assertion does not guess at timing.
          writeAtomic: (input) =>
            Deferred.succeed(secondWrote, undefined).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(owners.second.files.writeAtomic(input)),
            ),
        },
      })
      const scope = yield* Scope.Scope
      const firstFiber = yield* firstService
        .apply({
          candidate: candidate("first wins"),
          target: owners.selected?.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.forkIn(scope))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* awaitWithTimeout(Deferred.await(entered), "First Prompt transaction did not reach its write", "10 seconds")
      const secondFiber = yield* secondService
        .apply({
          candidate: candidate("stale second"),
          target: owners.secondSelected?.target,
          baseRevision: null,
          overwrite: false,
        })
        .pipe(Effect.flip, Effect.forkIn(scope))
      yield* awaitWithTimeout(
        Deferred.await(attempted),
        "Second Prompt transaction did not attempt its lock",
        "10 seconds",
      )
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      expect(locks).toEqual([[owners.absolute], [owners.absolute]])
      yield* Deferred.succeed(release, undefined)
      const saved = yield* awaitWithTimeout(
        Fiber.join(firstFiber),
        "First Prompt transaction did not complete",
        "10 seconds",
      )
      expect(
        yield* awaitWithTimeout(Fiber.join(secondFiber), "Second Prompt CAS did not settle", "10 seconds"),
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      expect(yield* Deferred.isDone(secondWrote)).toBe(false)
      expect(saved.template).toBe("first wins")
      const reader = owners.secondSelected ?? owners.second.registry
      yield* reader.reload()
      const read = yield* reader.getByPath("review.md")
      expect(read.revision).toBe(saved.revision)
      expect(read.template).toBe("first wins")
      expect(Hash.sha256(Buffer.from(yield* owners.first.fs.readFile(owners.absolute)))).toBe(saved.revision)
    }),
  )

  it.live("keeps Prompt delete behind an in-flight apply on the same absolute path: " + mode, () =>
    Effect.gen(function* () {
      const owners = yield* concurrentOwners(mode)
      const saved = yield* owners.first.service.apply({
        candidate: candidate("original"),
        target: owners.selected?.target,
        baseRevision: null,
        overwrite: false,
      })
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const removed = yield* Deferred.make<void>()
      const locks: string[][] = []
      const writer = yield* faultService(owners.first, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(Effect.andThen(owners.first.files.withLock(targets)(effect))),
          writeAtomic: (input) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(owners.first.files.writeAtomic(input)),
            ),
        },
      })
      const deleter = yield* faultService(owners.second, {
        files: {
          withLock: (targets) => (effect) =>
            Effect.sync(() => {
              locks.push([...targets])
            }).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(owners.second.files.withLock(targets)(effect)),
            ),
          remove: (input) =>
            Deferred.succeed(removed, undefined).pipe(
              Effect.andThen(Deferred.succeed(attempted, undefined)),
              Effect.andThen(owners.second.files.remove(input)),
            ),
        },
      })
      const scope = yield* Scope.Scope
      const writing = yield* writer
        .apply({
          candidate: candidate("updated"),
          target: owners.selected?.target,
          baseRevision: saved.revision,
          overwrite: true,
        })
        .pipe(Effect.forkIn(scope))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      yield* awaitWithTimeout(Deferred.await(entered), "Prompt apply did not reach its write", "10 seconds")
      const deleting = yield* deleter
        .delete({ relativePath: "review.md", target: owners.secondSelected?.target, baseRevision: saved.revision })
        .pipe(Effect.flip, Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(attempted), "Prompt delete did not request its lock", "10 seconds")
      expect(yield* Deferred.isDone(removed)).toBe(false)
      expect(locks).toEqual([[owners.absolute], [owners.absolute]])
      yield* Deferred.succeed(release, undefined)
      const updated = yield* awaitWithTimeout(Fiber.join(writing), "Prompt apply did not complete", "10 seconds")
      expect(
        yield* awaitWithTimeout(Fiber.join(deleting), "Prompt delete did not settle", "10 seconds"),
      ).toBeInstanceOf(PromptAssetService.StaleRevisionError)
      expect(yield* Deferred.isDone(removed)).toBe(false)
      const reader = owners.secondSelected ?? owners.second.registry
      yield* reader.reload()
      const read = yield* reader.getByPath("review.md")
      expect(read.template).toBe("updated")
      expect(read.revision).toBe(updated.revision)
      expect(Hash.sha256(Buffer.from(yield* owners.first.fs.readFile(owners.absolute)))).toBe(updated.revision)
    }),
  )
}

it.live("inspects a selected Prompt only after its active transaction releases the absolute lock", () =>
  Effect.gen(function* () {
    const owners = yield* concurrentOwners("project")
    if (!owners.selected) throw new Error("Expected the project Prompt owner to be selected")
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const attempted = yield* Deferred.make<void>()
    const inspected = yield* Deferred.make<void>()
    const writer = yield* faultService(owners.first, {
      files: {
        writeAtomic: (input) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(owners.first.files.writeAtomic(input)),
          ),
      },
    })
    const inspector = yield* faultService(owners.second, {
      files: {
        withLock: (targets) => (effect) =>
          Deferred.succeed(attempted, undefined).pipe(Effect.andThen(owners.second.files.withLock(targets)(effect))),
      },
    })
    const scope = yield* Scope.Scope
    const writing = yield* writer
      .apply({ candidate: candidate(), target: owners.selected.target, baseRevision: null, overwrite: false })
      .pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(entered), "Prompt write did not reach its boundary", "10 seconds")
    const inspection = yield* inspector.inspect({ candidate: candidate(), scope: "project" }).pipe(
      Effect.tap(() =>
        Deferred.succeed(inspected, undefined).pipe(Effect.andThen(Deferred.succeed(attempted, undefined))),
      ),
      Effect.forkIn(scope),
    )
    yield* awaitWithTimeout(Deferred.await(attempted), "Prompt inspect did not request its lock", "10 seconds")
    expect(yield* Deferred.isDone(inspected)).toBe(false)
    yield* Deferred.succeed(release, undefined)
    const saved = yield* awaitWithTimeout(Fiber.join(writing), "Prompt write did not complete", "10 seconds")
    const facts = yield* awaitWithTimeout(Fiber.join(inspection), "Prompt inspect did not complete", "10 seconds")
    expect(facts.exists).toBe(true)
    expect(facts.revision).toBe(Revision.make(saved.revision))
    expect(facts.target).toEqual(owners.selected.target)
  }),
)

it.live("revalidates the Prompt owner after waiting for the shared absolute lock", () =>
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
    yield* awaitWithTimeout(Deferred.await(holding), "Prompt target lock was not acquired", "10 seconds")
    const service = yield* faultService(graph, {
      files: {
        withLock: (targets) => (effect) =>
          Deferred.succeed(attempted, undefined).pipe(Effect.andThen(graph.files.withLock(targets)(effect))),
      },
    })
    const pending = yield* service
      .apply({ candidate: candidate(), target: view.target, baseRevision: null, overwrite: false })
      .pipe(Effect.flip, Effect.forkIn(scope))
    yield* awaitWithTimeout(Deferred.await(attempted), "Prompt apply did not request its target lock", "10 seconds")
    yield* graph.fs.remove(view.target.root, { recursive: true })
    yield* graph.fs.symlink(outside, view.target.root)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
    expect(
      yield* awaitWithTimeout(Fiber.join(pending), "Prompt owner revalidation did not settle", "10 seconds"),
    ).toBeInstanceOf(AssetPlacement.PathError)
    expect(yield* graph.fs.exists(path.join(outside, "review.md"))).toBe(false)
  }),
)

it.live("allows clone and worktree Prompt writes while another checkout holds a same-name lock", () =>
  Effect.gen(function* () {
    const roots = yield* checkouts()
    const main = yield* openLocation(roots.main)
    const view = yield* main.registry.select("project")
    const holding = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const scope = yield* Scope.Scope
    const holder = yield* main.files
      .withLock([path.join(view.target.root, "review.md")])(
        Deferred.succeed(holding, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* awaitWithTimeout(Deferred.await(holding), "Main checkout Prompt lock was not acquired", "10 seconds")
    yield* Effect.forEach([roots.clone, roots.linked], (directory) =>
      Effect.gen(function* () {
        const graph = yield* openLocation(directory)
        const selected = yield* graph.registry.select("project")
        const saved = yield* awaitWithTimeout(
          graph.service.apply({
            candidate: candidate(),
            target: selected.target,
            baseRevision: null,
            overwrite: false,
          }),
          "Independent checkout Prompt write was blocked by another owner",
          "10 seconds",
        )
        expect(saved.target).toEqual(selected.target)
        expect(saved.template).toBe(candidate().template)
      }),
    )
    expect(yield* main.fs.exists(path.join(view.target.root, "review.md"))).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
  }),
)

for (const mode of ["legacy", "project"] as const) {
  for (const existing of [false, true]) {
    it.live("rolls back the first Prompt readback failure: " + mode + (existing ? " overwrite" : " create"), () =>
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
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
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
        ).toBeInstanceOf(PromptAssetService.WriteFailedError)
        expect(calls.failures).toBe(1)
        expect(calls.writes).toBe(existing ? 2 : 1)
        expect(yield* reader.listInvalid()).toEqual([])
        if (!saved) {
          expect(yield* graph.fs.exists(absolute)).toBe(false)
          expect(yield* reader.list()).toEqual([])
          return
        }
        if (previous === null) throw new Error("Expected original Prompt bytes before rollback")
        expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
        expect(yield* reader.getByPath("review.md")).toEqual(saved)
      }),
    )
  }

  it.live("preserves an external overwrite before the first Prompt readback: " + mode, () =>
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
      const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
      const external = (yield* graph.fs.readFileString(absolute)).replace("original", "external writer")
      const calls = { writes: 0 }
      const injected = yield* faultService(graph, {
        files: {
          writeAtomic: (input) =>
            Effect.gen(function* () {
              const result = yield* graph.files.writeAtomic(input)
              calls.writes++
              // A raw write models a separate process outside FileMutation's shared lock.
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
      ).toBeInstanceOf(PromptAssetService.ConcurrentModificationError)
      expect(calls.writes).toBe(1)
      expect(yield* graph.fs.readFileString(absolute)).toBe(external)
      yield* reader.reload()
      const read = yield* reader.getByPath("review.md")
      expect(read.template).toBe("external writer")
      expect(read.revision).toBe(Hash.sha256(Buffer.from(external)))
    }),
  )

  for (const failure of ["read", "write"] as const) {
    it.live("reports a Prompt rollback " + failure + " failure without claiming restoration: " + mode, () =>
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
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
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
        ).toBeInstanceOf(PromptAssetService.RollbackFailedError)
        expect(calls.writes).toBe(failure === "write" ? 2 : 1)
        const reader = selected ?? graph.registry
        yield* reader.reload()
        expect((yield* reader.getByPath("review.md")).template).toBe("unconfirmed replacement")
      }),
    )
  }

  for (const field of [
    "kind",
    "name",
    "description",
    "relativePath",
    "template",
    "target-scope",
    "target-root",
  ] as const) {
    it.live("compares Prompt " + field + " during complete readback even when revision matches: " + mode, () =>
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
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
        const previous = yield* graph.fs.readFile(absolute)
        const state = { writes: 0, corruptions: 0 }
        const corrupt = (info: PromptAsset.Info) => {
          if (state.writes !== 1 || state.corruptions !== 0) return info
          state.corruptions++
          if (field === "kind") {
            const readback = { ...info }
            // Corrupt only this returned registry value, including a literal excluded by its static type.
            Object.defineProperty(readback, "kind", { value: "skill" })
            return readback
          }
          if (field === "target-scope" || field === "target-root") {
            const target =
              selected?.target ??
              new AssetPlacement.Target({ scope: "location", root: AbsolutePath.make(path.dirname(absolute)) })
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
              ? { getByPath: (relativePath) => graph.registry.getByPath(relativePath).pipe(Effect.map(corrupt)) }
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
        ).toBeInstanceOf(PromptAssetService.ReadbackMismatchError)
        expect(state.corruptions).toBe(1)
        expect(state.writes).toBe(2)
        expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
        const reader = selected ?? graph.registry
        expect(yield* reader.getByPath("review.md")).toEqual(saved)
      }),
    )
  }

  it.live("restores deleted Prompt bytes after a transient owner reload failure: " + mode, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const graph = yield* openLocation(tmp.path)
      const selected = mode === "legacy" ? undefined : yield* graph.registry.select("project")
      const saved = yield* graph.service.apply({
        candidate: candidate(),
        target: selected?.target,
        baseRevision: null,
        overwrite: false,
      })
      const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
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
            ? { reload: () => reload(graph.registry.reload) }
            : {
                select: (scope) =>
                  graph.registry
                    .select(scope)
                    .pipe(Effect.map((view) => ({ ...view, reload: () => reload(view.reload) }))),
              },
      })
      expect(
        yield* injected
          .delete({ relativePath: "review.md", target: selected?.target, baseRevision: saved.revision })
          .pipe(Effect.flip),
      ).toBeInstanceOf(PromptAssetService.WriteFailedError)
      expect(state.failures).toBe(1)
      expect(state.restores).toBe(1)
      expect(yield* graph.fs.readFile(absolute)).toEqual(previous)
      const reader = selected ?? graph.registry
      expect(yield* reader.getByPath("review.md")).toEqual(saved)
    }),
  )

  for (const recreation of ["same", "different"] as const) {
    it.live("does not overwrite an external Prompt recreation with " + recreation + " bytes: " + mode, () =>
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
        const absolute = path.join(selected?.target.root ?? path.join(tmp.path, ".aigcfroge/prompts"), "review.md")
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
            .delete({ relativePath: "review.md", target: selected?.target, baseRevision: saved.revision })
            .pipe(Effect.flip),
        ).toBeInstanceOf(PromptAssetService.ConcurrentModificationError)
        expect(calls.restores).toBe(0)
        expect(yield* graph.fs.readFileString(absolute)).toBe(external)
      }),
    )
  }
}
