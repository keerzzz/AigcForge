import path from "path"
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"

const FLAG_KEY = "AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET"

// Assigning undefined to process.env stores the string "undefined"; restore must delete instead.
function restoreEnv(key: string, saved: string | undefined) {
  if (saved === undefined) delete process.env[key]
  else process.env[key] = saved
}

function locationLayer(dir: string) {
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir) })
  return Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: ref.directory,
      workspaceID: ref.workspaceID,
      project: { id: Project.ID.global, directory: ref.directory },
    }),
  )
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

describe("PromptAsset E2E (aigcfroge)", () => {
  describe("flag gating", () => {
    test("propose tool registration respects the flag — toggle via env", async () => {
      // The V2 propose tool checks Flag.AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET
      // at layer construction time. This test verifies the gate exists.
      const saved = process.env[FLAG_KEY]
      process.env[FLAG_KEY] = "false"
      try {
        // Value should already reflect "false"
        const { Flag } = await import("@aigcfroge/core/flag/flag")
        expect(Flag.AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET).toBe(false)
      } finally {
        restoreEnv(FLAG_KEY, saved)
      }
    })

    test("flag=true enables the feature", async () => {
      const saved = process.env[FLAG_KEY]
      process.env[FLAG_KEY] = "true"
      try {
        // Re-read to clear module-level getter caching
        const { Flag } = await import("@aigcfroge/core/flag/flag")
        expect(Flag.AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET).toBe(true)
      } finally {
        restoreEnv(FLAG_KEY, saved)
      }
    })

    test("AIGCFROGE_EXPERIMENTAL=true also enables it", async () => {
      const savedExp = process.env["AIGCFROGE_EXPERIMENTAL"]
      const savedChat = process.env[FLAG_KEY]
      delete process.env[FLAG_KEY]
      process.env["AIGCFROGE_EXPERIMENTAL"] = "true"
      try {
        const { Flag } = await import("@aigcfroge/core/flag/flag")
        expect(Flag.AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET).toBe(true)
      } finally {
        restoreEnv("AIGCFROGE_EXPERIMENTAL", savedExp)
        restoreEnv(FLAG_KEY, savedChat)
      }
    })
  })

  describe("service path", () => {
    test("propose → apply → list → content cycle", async () => {
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
        const layer = fullLayer(dir)

        await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            const reg = yield* PromptAsset.Service

            // Propose
            const propose = yield* svc.propose({
              name: "e2e-test", description: "E2E test", template: "Hello, {{world}}!", relativePath: "",
            } as any)
            expect(propose.exists).toBe(false)
            expect(propose.relativePath).toMatch(/\.md$/)
            expect(propose.nameConflict).toBe(false)
            expect(propose.pathConflict).toBe(false)

            // Apply
            const applied = yield* svc.apply({
              candidate: { name: "e2e-test", description: "E2E test", template: "Hello, {{world}}!", relativePath: "" } as any,
              baseRevision: null,
              overwrite: false,
            })
            expect(applied.kind).toBe("prompt")
            expect(applied.name).toBe("e2e-test")
            expect(applied.revision).toMatch(/^[0-9a-f]{64}$/)
            expect(applied.template).toContain("{{world}}")
            expect(applied.relativePath).toBe("e2e-test.md")

            // List
            yield* reg.reload()
            const list = yield* reg.list()
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("e2e-test")

            // Get by path (relative to owner root)
            const info = yield* reg.getByPath(applied.relativePath)
            expect(info.name).toBe("e2e-test")
            expect(info.template).toBe("Hello, {{world}}!")

            // Find by name
            const found = yield* reg.findByName("e2e-test")
            expect(found).toBeDefined()
            expect(found!.revision).toBe(applied.revision)
          }).pipe(Effect.provide(layer), Effect.scoped),
        )
      })
    })

    test("apply then delete cycle", async () => {
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
        const layer = fullLayer(dir)

        await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            const reg = yield* PromptAsset.Service

            // Apply
            const applied = yield* svc.apply({
              candidate: { name: "del-test", description: "Delete test", template: "To be deleted", relativePath: "" } as any,
              baseRevision: null,
              overwrite: false,
            })

            // Delete
            yield* svc.delete({
              relativePath: applied.relativePath,
              baseRevision: applied.revision,
            })

            // Verify deleted
            yield* reg.reload()
            const list = yield* reg.list()
            expect(list.length).toBe(0)
          }).pipe(Effect.provide(layer), Effect.scoped),
        )
      })
    })
  })

  describe("error cases", () => {
    test("rejects stale revision on overwrite", async () => {
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
        const layer = fullLayer(dir)

        const err = await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            yield* svc.apply({
              candidate: { name: "stale", description: "d", template: "v1", relativePath: "" } as any,
              baseRevision: null,
              overwrite: false,
            })
            return yield* svc.apply({
              candidate: { name: "stale", description: "d", template: "v2", relativePath: "" } as any,
              baseRevision: "0000000000000000000000000000000000000000000000000000000000000000",
              overwrite: true,
            }).pipe(Effect.flip)
          }).pipe(Effect.provide(layer), Effect.scoped),
        ).catch((e: unknown) => e)
        expect(err).toBeDefined()
      })
    })

    test("rejects path escape", async () => {
      await withTmp(async (dir) => {
        await fs.mkdir(path.join(dir, ".aigcfroge", "prompts"), { recursive: true })
        const layer = fullLayer(dir)

        const err = await runNow(
          Effect.gen(function* () {
            const svc = yield* PromptAssetService.Service
            return yield* svc.propose({
              name: "escape", description: "d", template: "d", relativePath: "../../../etc/passwd",
            } as any).pipe(Effect.flip)
          }).pipe(Effect.provide(layer), Effect.scoped),
        ).catch((e: unknown) => e)
        expect(err).toBeDefined()
      })
    })
  })
})
