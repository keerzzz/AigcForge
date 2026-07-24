import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
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
  return PromptAsset.locationLayer.pipe(
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

async function createAsset(dir: string, name: string, description: string, template: string) {
  const assetDir = path.join(dir, ".aigcfroge", "prompts")
  await fs.mkdir(assetDir, { recursive: true })
  await fs.writeFile(
    path.join(assetDir, `${name}.md`),
    `---\nkind: prompt\nname: ${name}\ndescription: ${description}\n---\n${template}`,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runNow<A>(effect: Effect.Effect<A, unknown, any>): Promise<A> {
  return (Effect as any).runPromise(effect)
}

describe("PromptAsset registry", () => {
  test("lists assets from empty directory", async () => {
    await withTmp(async (dir) => {
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list).toEqual([])
    })
  })

  test("loads a single asset from disk", async () => {
    await withTmp(async (dir) => {
      await createAsset(dir, "test-prompt", "A test prompt", "Hello world")
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("test-prompt")
      expect(list[0].description).toBe("A test prompt")
      expect(list[0].template).toBe("Hello world")
      expect(list[0].relativePath).toBe("test-prompt.md")
      expect(list[0].revision.length).toBe(64)
    })
  })

  test("loads Chinese-named assets", async () => {
    await withTmp(async (dir) => {
      await createAsset(dir, "提示词", "中文描述", "你好世界")
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("提示词")
    })
  })

  test("finds an asset by path", async () => {
    await withTmp(async (dir) => {
      await createAsset(dir, "my-prompt", "Desc", "Content")
      const info = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).getByPath("my-prompt.md") }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(info.name).toBe("my-prompt")
    })
  })

  test("returns error for unknown path", async () => {
    await withTmp(async (dir) => {
      const error = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PromptAsset.Service).getByPath("nonexistent.md").pipe(Effect.flip)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(error).toMatchObject({ _tag: "PromptAsset.NotFound" })
    })
  })

  test("finds an asset by name", async () => {
    await withTmp(async (dir) => {
      await createAsset(dir, "find-me", "test", "template")
      const info = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).findByName("find-me") }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(info).toBeDefined()
      expect(info!.name).toBe("find-me")
    })
  })

  test("reloads after adding a new asset", async () => {
    await withTmp(async (dir) => {
      const reg = await runNow(
        Effect.gen(function* () { return yield* PromptAsset.Service }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect((await runNow(reg.list())).length).toBe(0)
      await createAsset(dir, "added-later", "new", "content")
      await runNow(reg.reload())
      const list = await runNow(reg.list())
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("added-later")
    })
  })

  test("skips invalid frontmatter", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(path.join(promptsDir, "bad.md"), "no frontmatter here")
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list.length).toBe(0)
    })
  })

  test("excludes every asset participating in a duplicate-name conflict", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      const c = (n: string) => `---\nkind: prompt\nname: "duplicate"\ndescription: "test"\n---\n${n}`
      await fs.writeFile(path.join(promptsDir, "first.md"), c("first"))
      await fs.writeFile(path.join(promptsDir, "second.md"), c("second"))
      const list = await runNow(
        Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
          Effect.provide(fullLayer(dir)),
          Effect.scoped,
        ),
      )
      expect(list).toEqual([])
    })
  })

  test("isolates location A and B registries", async () => {
    const [dirA, dirB] = await Promise.all([tmpdir(), tmpdir()])
    try {
      await createAsset(dirA.path, "asset-a", "a", "a")
      await createAsset(dirB.path, "asset-b", "b", "b")

      const [listA, listB] = await Promise.all([
        runNow(
          Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
            Effect.provide(fullLayer(dirA.path)),
            Effect.scoped,
          ),
        ),
        runNow(
          Effect.gen(function* () { return yield* (yield* PromptAsset.Service).list() }).pipe(
            Effect.provide(fullLayer(dirB.path)),
            Effect.scoped,
          ),
        ),
      ])
      expect(listA.length).toBe(1)
      expect(listB.length).toBe(1)
      expect(listA[0].name).toBe("asset-a")
      expect(listB[0].name).toBe("asset-b")
    } finally {
      await Promise.all([dirA[Symbol.asyncDispose](), dirB[Symbol.asyncDispose]()])
    }
  })

  test("listInvalid returns parse_error entry for unparseable file", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(path.join(promptsDir, "broken.md"), "no frontmatter here")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PromptAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid).toEqual([{ relativePath: "broken.md", errorTag: "parse_error" }])
    })
  })

  test("listInvalid returns bad_frontmatter entry for invalid frontmatter", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      // 合法 YAML frontmatter 但缺 kind/name 必填字段 -> Frontmatter decode 失败
      await fs.writeFile(path.join(promptsDir, "badfm.md"), "---\ndescription: missing required fields\n---\nbody")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PromptAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid).toEqual([{ relativePath: "badfm.md", errorTag: "bad_frontmatter" }])
    })
  })

  test("listInvalid marks all duplicate-name files as name_conflict", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      const c = (n: string) => `---\nkind: prompt\nname: "dup"\ndescription: "test"\n---\n${n}`
      await fs.writeFile(path.join(promptsDir, "first.md"), c("first"))
      await fs.writeFile(path.join(promptsDir, "second.md"), c("second"))
      const [list, invalid] = await runNow(
        Effect.gen(function* () {
          const svc = yield* PromptAsset.Service
          return [yield* svc.list(), yield* svc.listInvalid()] as const
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list).toEqual([])
      expect(invalid).toHaveLength(2)
      expect(invalid.map((e) => e.errorTag)).toEqual(["name_conflict", "name_conflict"])
      expect(new Set(invalid.map((e) => e.relativePath))).toEqual(new Set(["first.md", "second.md"]))
    })
  })

  test("listInvalid is empty when all assets valid", async () => {
    await withTmp(async (dir) => {
      await createAsset(dir, "good", "desc", "tmpl")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PromptAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid).toEqual([])
    })
  })

  test("getInvalid returns specific entry or undefined", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(path.join(promptsDir, "broken.md"), "no frontmatter")
      const svc = await runNow(
        Effect.gen(function* () {
          return yield* PromptAsset.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      const entry = await runNow(svc.getInvalid("broken.md"))
      expect(entry).toEqual({ relativePath: "broken.md", errorTag: "parse_error" })
      expect(await runNow(svc.getInvalid("nonexistent.md"))).toBeUndefined()
    })
  })

  test("listInvalid reload reflects fixed files", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(path.join(promptsDir, "broken.md"), "no frontmatter")
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* PromptAsset.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect((await runNow(reg.listInvalid())).length).toBe(1)
      await fs.writeFile(
        path.join(promptsDir, "broken.md"),
        "---\nkind: prompt\nname: fixed\ndescription: ok\n---\nbody",
      )
      await runNow(reg.reload())
      expect(await runNow(reg.listInvalid())).toEqual([])
      expect((await runNow(reg.list())).length).toBe(1)
    })
  })

  test("InvalidEntry carries no template or content (C3 desensitization)", async () => {
    await withTmp(async (dir) => {
      const promptsDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptsDir, { recursive: true })
      await fs.writeFile(path.join(promptsDir, "leak.md"), "SECRET-CONTENT-no-frontmatter")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* PromptAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      // errorTag 只存分类标签，不含正文/旧内容（PRD §9.4 C3）
      expect(Object.keys(invalid[0]).sort()).toEqual(["errorTag", "relativePath"])
      expect(JSON.stringify(invalid)).not.toContain("SECRET-CONTENT")
    })
  })
})
