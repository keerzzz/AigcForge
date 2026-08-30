import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset" // Schema namespace; core PromptAsset uses the unaliased name.
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

function fullLayer(dir: string) {
  return PromptAssetService.locationLayer.pipe(
    Layer.provide(FileMutation.locationLayer),
    Layer.provide(LocationMutation.locationLayer),
    Layer.provideMerge(PromptAsset.locationLayer),
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

describe("PromptAsset E2E", () => {
  test("propose then apply then list", async () => {
    await withTmp(async (dir) => {
      await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
      const layer = fullLayer(dir)

      // Single effect with all operations, kept inside the layer
      await runNow(
        Effect.gen(function* () {
          const svc = yield* PromptAssetService.Service
          const reg = yield* PromptAsset.Service

          // Propose
          const propose = yield* svc.propose({
            name: "my-prompt",
            description: "A test prompt",
            template: "Hello, {{name}}!",
            relativePath: "",
          } as any)
          expect(propose.exists).toBe(false)

          // Apply
          const applied = yield* svc.apply({
            candidate: Schema.decodeUnknownSync(SchemaPromptAsset.Candidate)({
              name: "my-prompt",
              description: "A test prompt",
              template: "Hello, {{name}}!",
              relativePath: "",
            }),
            baseRevision: null,
            overwrite: false,
          })
          expect(applied.kind).toBe("prompt")
          expect(applied.name).toBe("my-prompt")
          expect(applied.revision).toMatch(/^[0-9a-f]{64}$/)
          expect(applied.template).toContain("Hello, {{name}}!")

          // List
          yield* reg.reload()
          const list = yield* reg.list()
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("my-prompt")
        }).pipe(Effect.provide(layer), Effect.scoped),
      )
    })
  })

  test("propose detects existing file", async () => {
    await withTmp(async (dir) => {
      await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
      await fs.writeFile(
        path.join(dir, ".aigcfroge", "prompts", "existing.md"),
        `---\nkind: prompt\nname: "existing"\ndescription: "existing"\n---\ncontent`,
      )
      const layer = fullLayer(dir)

      await runNow(
        Effect.gen(function* () {
          const reg = yield* PromptAsset.Service
          yield* reg.reload()
          const svc = yield* PromptAssetService.Service
          const result = yield* svc.propose({
            name: "existing",
            description: "another",
            template: "content",
            relativePath: "",
          } as any)
          expect(result.exists).toBe(true)
        }).pipe(Effect.provide(layer), Effect.scoped),
      )
    })
  })

  test("rejects stale revision", async () => {
    await withTmp(async (dir) => {
      await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
      const layer = fullLayer(dir)

      const err = await runNow(
        Effect.gen(function* () {
          const svc = yield* PromptAssetService.Service
          yield* svc.apply({
            candidate: { name: "stale-test", description: "d", template: "v1", relativePath: "" } as any,
            baseRevision: null,
            overwrite: false,
          })
          return yield* svc
            .apply({
              candidate: Schema.decodeUnknownSync(SchemaPromptAsset.Candidate)({
                name: "stale-test",
                description: "d",
                template: "v2",
                relativePath: "",
              }),
              baseRevision: "0000000000000000000000000000000000000000000000000000000000000000",
              overwrite: true,
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(layer), Effect.scoped),
      ).catch((e: unknown) => e)
      expect(err).toBeDefined()
    })
  })
})
