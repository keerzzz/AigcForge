import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function locationLayer(dir: string) {
  return Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(dir) })),
  )
}

function fullLayer(dir: string) {
  return PluginAsset.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(FSUtil.defaultLayer),
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

async function createPlugin(dir: string, name: string, description: string, extra?: string) {
  const assetDir = path.join(dir, ".aigcfroge", "plugins")
  await fs.mkdir(assetDir, { recursive: true })
  const lines = [
    "kind: plugin",
    `name: ${name}`,
    `description: ${description}`,
    "version: 1.0.0",
  ]
  if (extra) lines.push(extra)
  await fs.writeFile(path.join(assetDir, `${name}.plugin.yaml`), lines.join("\n"))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runNow<A>(effect: Effect.Effect<A, unknown, any>): Promise<A> {
  return (Effect as any).runPromise(effect)
}

describe("PluginAsset registry", () => {
  test("lists assets from empty directory", async () => {
    await withTmp(async (dir) => {
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PluginAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list).toEqual([])
    })
  })

  test("loads a single plugin from disk", async () => {
    await withTmp(async (dir) => {
      await createPlugin(dir, "code-review", "Automated code review")
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PluginAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list.length).toBe(1)
      expect(list[0].kind).toBe("plugin")
      expect(list[0].name).toBe("code-review")
      expect(list[0].description).toBe("Automated code review")
      expect(list[0].version).toBe("1.0.0")
      expect(list[0].relativePath).toBe("code-review.plugin.yaml")
      expect(list[0].revision.length).toBe(64)
    })
  })

  test("loads multiple plugins", async () => {
    await withTmp(async (dir) => {
      await createPlugin(dir, "review", "Code review")
      await createPlugin(dir, "deploy", "Deploy pipeline")
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PluginAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list.length).toBe(2)
      const names = list.map((a) => a.name).toSorted()
      expect(names).toEqual(["deploy", "review"])
    })
  })

  test("finds a plugin by path", async () => {
    await withTmp(async (dir) => {
      await createPlugin(dir, "my-plugin", "A plugin")
      const info = await runNow(
        Effect.gen(function* () { return yield* (yield* PluginAsset.Service).getByPath("my-plugin.plugin.yaml") }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(info.name).toBe("my-plugin")
    })
  })

  test("returns error for unknown path", async () => {
    await withTmp(async (dir) => {
      const error = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PluginAsset.Service).getByPath("nonexistent.plugin.yaml").pipe(Effect.flip)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(error).toMatchObject({ _tag: "PluginAsset.NotFound" })
    })
  })

  test("finds a plugin by name", async () => {
    await withTmp(async (dir) => {
      await createPlugin(dir, "find-me", "test")
      const info = await runNow(
        Effect.gen(function* () { return yield* (yield* PluginAsset.Service).findByName("find-me") }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(info).toBeDefined()
      expect(info!.name).toBe("find-me")
    })
  })

  test("reloads after adding a new plugin", async () => {
    await withTmp(async (dir) => {
      const reg = await runNow(
        Effect.gen(function* () { return yield* PluginAsset.Service }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect((await runNow(reg.list())).length).toBe(0)
      await createPlugin(dir, "added-later", "new")
      await runNow(reg.reload())
      const list = await runNow(reg.list())
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("added-later")
    })
  })

  test("marks YAML parse error as parse_error", async () => {
    await withTmp(async (dir) => {
      const pluginsDir = path.join(dir, ".aigcfroge", "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(path.join(pluginsDir, "bad.plugin.yaml"), "not: valid: yaml: [[[")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PluginAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid.length).toBeGreaterThanOrEqual(1)
      expect(invalid.some((e) => e.errorTag === "parse_error")).toBe(true)
    })
  })

  test("marks schema decode failure as bad_frontmatter", async () => {
    await withTmp(async (dir) => {
      const pluginsDir = path.join(dir, ".aigcfroge", "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(path.join(pluginsDir, "badfm.plugin.yaml"), "kind: plugin\nname: only_name")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PluginAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      // description is required, so this should be bad_frontmatter
      expect(invalid.some((e) => e.errorTag === "bad_frontmatter")).toBe(true)
    })
  })

  test("marks duplicate-name files as name_conflict", async () => {
    await withTmp(async (dir) => {
      const pluginsDir = path.join(dir, ".aigcfroge", "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })
      const c = () =>
        [
          "kind: plugin",
          'name: "dup"',
          'description: "test"',
          'version: "1.0"',
        ].join("\n")
      await fs.writeFile(path.join(pluginsDir, "first.plugin.yaml"), c())
      await fs.writeFile(path.join(pluginsDir, "second.plugin.yaml"), c())
      const [list, invalid] = await runNow(
        Effect.gen(function* () {
          const svc = yield* PluginAsset.Service
          return [yield* svc.list(), yield* svc.listInvalid()] as const
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list).toEqual([])
      expect(invalid).toHaveLength(2)
      expect(invalid.map((e) => e.errorTag)).toEqual(["name_conflict", "name_conflict"])
    })
  })

  test("isolates location A and B registries", async () => {
    const [dirA, dirB] = await Promise.all([tmpdir(), tmpdir()])
    try {
      await createPlugin(dirA.path, "plugin-a", "a")
      await createPlugin(dirB.path, "plugin-b", "b")

      const [listA, listB] = await Promise.all([
        runNow(
          Effect.gen(function* () { return yield* (yield* PluginAsset.Service).list() }).pipe(
            Effect.provide(fullLayer(dirA.path)),
            Effect.scoped,
          ),
        ),
        runNow(
          Effect.gen(function* () { return yield* (yield* PluginAsset.Service).list() }).pipe(
            Effect.provide(fullLayer(dirB.path)),
            Effect.scoped,
          ),
        ),
      ])
      expect(listA.length).toBe(1)
      expect(listB.length).toBe(1)
      expect(listA[0].name).toBe("plugin-a")
      expect(listB[0].name).toBe("plugin-b")
    } finally {
      await Promise.all([dirA[Symbol.asyncDispose](), dirB[Symbol.asyncDispose]()])
    }
  })

  test("listInvalid is empty when all assets valid", async () => {
    await withTmp(async (dir) => {
      await createPlugin(dir, "good", "desc")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PluginAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid).toEqual([])
    })
  })

  test("listInvalid reload reflects fixed files", async () => {
    await withTmp(async (dir) => {
      const pluginsDir = path.join(dir, ".aigcfroge", "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(path.join(pluginsDir, "broken.plugin.yaml"), "not: valid: yaml: [[[")
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* PluginAsset.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect((await runNow(reg.listInvalid())).length).toBeGreaterThanOrEqual(1)
      const goodYaml = [
        "kind: plugin",
        'name: "fixed"',
        'description: "ok"',
        'version: "1.0"',
      ].join("\n")
      await fs.writeFile(path.join(pluginsDir, "broken.plugin.yaml"), goodYaml)
      await runNow(reg.reload())
      expect(await runNow(reg.listInvalid())).toEqual([])
      expect((await runNow(reg.list())).length).toBe(1)
    })
  })
})
