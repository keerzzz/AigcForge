import { describe, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { disposeAllInstances } from "../../fixture/fixture"
import { MetaCacheWarmth } from "../../../src/agent/meta/cache-warmth"

const layer = MetaCacheWarmth.defaultLayer
const it = testEffect(layer)

afterEach(async () => {
  await disposeAllInstances()
})

describe("cache warmth", () => {
  it.instance("returns undefined for unknown engine", () =>
    Effect.gen(function* () {
      const svc = yield* MetaCacheWarmth.CacheWarmth
      const result = yield* svc.get("unknown")
      expect(result).toBeUndefined()
    }),
  )

  it.instance("returns entry after record", () =>
    Effect.gen(function* () {
      const svc = yield* MetaCacheWarmth.CacheWarmth
      yield* svc.record({
        engineId: "build",
        lastContextSha: "abc123",
        lastUsed: Date.now(),
        hitRate: 0.8,
        taskCategory: "code_modification",
      })
      const result = yield* svc.get("build")
      expect(result).toBeDefined()
      expect(result!.engineId).toBe("build")
      expect(result!.hitRate).toBe(0.8)
    }),
  )

  it.instance("prewarm returns false for unknown engine", () =>
    Effect.gen(function* () {
      const svc = yield* MetaCacheWarmth.CacheWarmth
      const result = yield* svc.prewarm("unknown", "sha")
      expect(result).toBe(false)
    }),
  )

  it.instance("prewarm returns true when context matches and hitRate > 0.5", () =>
    Effect.gen(function* () {
      const svc = yield* MetaCacheWarmth.CacheWarmth
      yield* svc.record({
        engineId: "build",
        lastContextSha: "abc123",
        lastUsed: Date.now(),
        hitRate: 0.8,
        taskCategory: "code_modification",
      })
      const result = yield* svc.prewarm("build", "abc123")
      expect(result).toBe(true)
    }),
  )

  it.instance("prewarm returns false when hitRate <= 0.5", () =>
    Effect.gen(function* () {
      const svc = yield* MetaCacheWarmth.CacheWarmth
      yield* svc.record({
        engineId: "build",
        lastContextSha: "abc123",
        lastUsed: Date.now(),
        hitRate: 0.3,
        taskCategory: "code_modification",
      })
      const result = yield* svc.prewarm("build", "abc123")
      expect(result).toBe(false)
    }),
  )
})
