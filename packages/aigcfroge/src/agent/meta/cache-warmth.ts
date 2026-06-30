import { Context, Effect, Layer, Ref } from "effect"
import type { IntentCategory } from "./intent"

export interface CacheWarmthEntry {
  engineId: string
  lastContextSha: string
  lastUsed: number
  hitRate: number
  taskCategory: IntentCategory
}

export interface Interface {
  readonly get: (engineId: string) => Effect.Effect<CacheWarmthEntry | undefined>
  readonly record: (entry: CacheWarmthEntry) => Effect.Effect<void>
  readonly prewarm: (engineId: string, contextSha: string) => Effect.Effect<boolean>
}

export class CacheWarmth extends Context.Service<CacheWarmth, Interface>()("@aigcfroge/CacheWarmth") {}

export const layer = Layer.effect(
  CacheWarmth,
  Effect.gen(function* () {
    const state = yield* Ref.make(new Map<string, CacheWarmthEntry>())

    return CacheWarmth.of({
      get: Effect.fn("CacheWarmth.get")(function* (engineId: string) {
        const map = yield* Ref.get(state)
        return map.get(engineId)
      }),

      record: Effect.fn("CacheWarmth.record")(function* (entry: CacheWarmthEntry) {
        yield* Ref.update(state, (map) => {
          map.set(entry.engineId, entry)
          return map
        })
      }),

      prewarm: Effect.fn("CacheWarmth.prewarm")(function* (engineId: string, contextSha: string) {
        const map = yield* Ref.get(state)
        const entry = map.get(engineId)
        if (!entry) return false
        return entry.lastContextSha === contextSha && entry.hitRate > 0.5
      }),
    })
  }),
)

export const defaultLayer = layer

export * as MetaCacheWarmth from "./cache-warmth"
