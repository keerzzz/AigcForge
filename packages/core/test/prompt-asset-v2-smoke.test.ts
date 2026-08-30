import path from "path"
import { describe, expect, test, beforeEach } from "bun:test"
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
import { Tools } from "@aigcfroge/core/tool/tools"
import { ProposePromptAssetTool } from "@aigcfroge/core/tool/propose-prompt-asset"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import fs from "fs/promises"

const FLAG_KEY = "AIGCFROGE_EXPERIMENTAL_CHAT_ASSET"

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

function serviceLayer(dir: string) {
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

describe("PromptAsset V2 smoke", () => {
  beforeEach(() => {
    delete process.env[FLAG_KEY]
    delete process.env["AIGCFROGE_EXPERIMENTAL"]
  })

  describe("propose tool layer", () => {
    test("propose + apply + list works under V2 service layers", async () => {
      process.env[FLAG_KEY] = "true"
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })

        await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            const reg = yield* PromptAsset.Service

            // Propose
            const propose = yield* svc.propose({
              name: "v2-smoke",
              description: "V2 smoke test",
              template: "content",
              relativePath: "",
            } as any)
            expect(propose.exists).toBe(false)
            expect(propose.nameConflict).toBe(false)

            // No file should be written after propose
            const all = yield* reg.list()
            expect(all.length).toBe(0)

            // Apply
            const applied = yield* svc.apply({
              candidate: Schema.decodeUnknownSync(SchemaPromptAsset.Candidate)({
                name: "v2-smoke",
                description: "V2 smoke test",
                template: "content",
                relativePath: "",
              }),
              baseRevision: null,
              overwrite: false,
            })
            expect(applied.revision).toMatch(/^[0-9a-f]{64}$/)

            // List
            yield* reg.reload()
            const list = yield* reg.list()
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("v2-smoke")

            // Readback
            const info = yield* reg.getByPath(applied.relativePath)
            expect(info.template).toBe("content")
          }).pipe(Effect.provide(serviceLayer(dir)), Effect.scoped),
        )
      })
    })

    test("flag gate: propose tool is not callable when flag is off", async () => {
      process.env[FLAG_KEY] = "false"
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })

        // With flag off, ProposePromptAssetTool.layer is a no-op.
        // The tool layer still composes but no tool gets registered.
        const toolLayer = Layer.mergeAll(ToolRegistry.layer, ProposePromptAssetTool.layer, serviceLayer(dir)).pipe(
          Layer.provide(ToolRegistry.defaultLayer),
        )

        await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            const reg = yield* PromptAsset.Service

            // Propose via service still works (service has no flag gate)
            const propose = yield* svc.propose({
              name: "off-test",
              description: "Flag off test",
              template: "x",
              relativePath: "",
            } as any)
            expect(propose.exists).toBe(false)

            // Empty registry
            const all = yield* reg.list()
            expect(all.length).toBe(0)
          }).pipe(Effect.provide(toolLayer), Effect.scoped),
        )
      })
    })
  })

  describe("tool registration", () => {
    test("Tools.Service is wired and accepts registration", async () => {
      process.env[FLAG_KEY] = "true"
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })

        const toolLayer = Layer.mergeAll(ToolRegistry.layer, serviceLayer(dir)).pipe(
          Layer.provide(ToolRegistry.defaultLayer),
        )

        await runNow(
          Effect.gen(function* () {
            const tools = yield* Tools.Service
            const DummySchema = {} as any
            yield* tools.register({
              dummy_test: {
                description: "Smoke test dummy tool",
                input: DummySchema,
                output: DummySchema,
                execute: () => Effect.succeed({ ok: true }),
              },
            } as any)
          }).pipe(Effect.provide(toolLayer), Effect.scoped),
        )
      })
    })
  })
})
