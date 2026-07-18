import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"

function locationLayer(dir: string) {
  return Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(dir) })),
  )
}

function fullLayer(dir: string) {
  return PromptAssetService.locationLayer.pipe(
    Layer.provide(FileMutation.locationLayer),
    Layer.provide(PromptAsset.locationLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(FSUtil.defaultLayer),
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
  return { name: name as any, description: description as any, template: template as any, relativePath: "" }
}

// ---- Phase C.3: Fault injection & concurrency ----

describe("PromptAssetService.propose", () => {
  test("propose returns not-exists for new asset", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
      )
      const info = await runNow(
        svc.apply({ candidate: makeCandidate("my-prompt", "My prompt", "Hello world"), baseRevision: null, overwrite: false }),
      )
      expect(info.name).toBe("my-prompt")
      expect(info.description).toBe("My prompt")
      expect(info.template).toBe("Hello world")
      expect(info.relativePath).toBe("my-prompt.md")
      expect(info.revision.length).toBe(64)
    })
  })

  test("creates with Chinese name", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
      )
      const info = await runNow(
        svc.apply({ candidate: makeCandidate("提示词", "中文", "你好"), baseRevision: null, overwrite: false }),
      )
      expect(info.name).toBe("提示词")
      expect(info.template).toBe("你好")
    })
  })

  test("creates and is retrievable after reload", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
      )
      await runNow(
        svc.apply({ candidate: makeCandidate("persist", "desc", "data"), baseRevision: null, overwrite: false }),
      )
      const reg = await runNow(
        Effect.gen(function* () { return yield* PromptAsset.Service }).pipe(
          Effect.provide(PromptAsset.locationLayer.pipe(
            Layer.provide(EventV2.defaultLayer),
            Layer.provide(locationLayer(dir)),
            Layer.provide(FSUtil.defaultLayer),
          )), Effect.scoped,
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
      )
      const propose = await runNow(svc.propose(makeCandidate("existing")))
      expect(propose.exists).toBe(true)
      expect(propose.revision).not.toBeNull()
      const info = await runNow(
        svc.apply({ candidate: makeCandidate("existing", "updated", "new content"), baseRevision: propose.revision!, overwrite: true }),
      )
      expect(info.description).toBe("updated")
      expect(info.template).toBe("new content")
    })
  })

  test("fails StaleRevisionError when file exists but baseRevision=null", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "locked")
      const svc = await runNow(
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
      )
      const err = await runNow(
        svc.apply({ candidate: makeCandidate("stale"), baseRevision: "bad".repeat(32), overwrite: true }).pipe(Effect.flip),
      )
      expect(err).toMatchObject({ _tag: "PromptAssetService.StaleRevision" })
    })
  })

  test("fails StaleRevisionError when new file appears between propose and apply", async () => {
    await withTmp(async (dir) => {
      const svc = await runNow(
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
        Effect.gen(function* () { return yield* PromptAssetService.Service }).pipe(
          Effect.provide(fullLayer(dir)), Effect.scoped,
        ),
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
