import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CacheShape } from "../src/cache/cache-shape"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionFacts } from "../src/system-context/correction-facts"
import { CorrectionStore } from "../src/session/correction-store"
import { SessionV2 } from "../src/session"
import { SystemContext } from "../src/system-context/index"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_correction_facts")

const configLayer = (meta: { enabled?: boolean; max_entries?: number } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({
              meta: ConfigMeta.Info.make({ correction_store: ConfigMeta.CorrectionStore.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const storeLayer = (meta = {}) => CorrectionStore.layer.pipe(Layer.provide(configLayer(meta)))

// A stable companion source so the baseline resembles the real runner prefix.
const env = SystemContext.make({
  key: SystemContext.Key.make("core/environment"),
  codec: Schema.toCodecJson(Schema.String),
  load: Effect.succeed("<env>working-directory: /repo</env>"),
  baseline: (value) => value,
  update: (_previous, value) => value,
})

const load = (meta = {}) =>
  Effect.gen(function* () {
    const store = yield* CorrectionStore.Service
    const facts = CorrectionFacts.source(store, sessionID)
    const combined = SystemContext.combine([env, ...(facts ? [facts] : [])])
    return yield* SystemContext.initialize(combined)
  })

const recordEntry = (key: string, correct: string) =>
  Effect.gen(function* () {
    const store = yield* CorrectionStore.Service
    yield* store.record({
      sessionID,
      entry: { key, correct, source: "reference-checker", extractLayer: 1 },
    })
  })

describe("CorrectionFacts", () => {
  const it = testEffect(storeLayer())

  it.live("renders no verified facts for an empty store", () =>
    Effect.gen(function* () {
      const generation = yield* load()
      expect(generation.baseline).toContain("No verified facts recorded.")
    }),
  )

  it.live("renders one verified fact with key and correct value only", () =>
    Effect.gen(function* () {
      yield* recordEntry("ref:path-renamed", "./new.ts")
      const generation = yield* load()
      expect(generation.baseline).toContain("Verified facts:\n- ref:path-renamed ./new.ts")
    }),
  )

  it.live("renders all recorded facts", () =>
    Effect.gen(function* () {
      yield* recordEntry("ref:a", "./a.ts")
      yield* recordEntry("ref:b", "./b.ts")
      yield* recordEntry("ref:c", "./c.ts")
      const generation = yield* load()
      const lines = generation.baseline.split("\n").filter((line) => line.startsWith("- "))
      expect(lines).toHaveLength(3)
    }),
  )

  it.live("hides wrong values from the baseline", () =>
    Effect.gen(function* () {
      yield* recordEntry("ref:path-renamed", "./new.ts")
      const generation = yield* load()
      expect(generation.baseline).not.toContain("./old.ts")
    }),
  )
})

describe("CorrectionFacts disabled", () => {
  const it = testEffect(storeLayer({ enabled: false }))

  it.live("returns no source when the store is disabled", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      expect(CorrectionFacts.source(store, sessionID)).toBeUndefined()
    }),
  )
})

describe("CorrectionFacts cache impact", () => {
  const it = testEffect(storeLayer({ enabled: false }))

  it.live("keeps the prefix hash identical when disabled", () =>
    Effect.gen(function* () {
      yield* recordEntry("ref:./old.ts", "./new.ts")
      const generation = yield* load()
      const withoutSource = yield* SystemContext.initialize(env)
      expect(generation.baseline).toBe(withoutSource.baseline)
      const capture = CacheShape.capture(generation.baseline, [], 0)
      const baselineCapture = CacheShape.capture(withoutSource.baseline, [], 0)
      expect(capture.prefixHash).toBe(baselineCapture.prefixHash)
      expect(capture.systemHash).toBe(baselineCapture.systemHash)
    }),
  )
})
