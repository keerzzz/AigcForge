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
})
