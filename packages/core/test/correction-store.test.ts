import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionStore } from "../src/session/correction-store"
import { SessionV2 } from "../src/session"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_correction_store")
const otherSessionID = SessionV2.ID.make("ses_correction_other")

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

const layerFor = (meta = {}) => CorrectionStore.layer.pipe(Layer.provide(configLayer(meta)))

const detectorEntry = (overrides: Partial<CorrectionStore.NewEntry> & { key: string; correct: string }) => ({
  source: "reference-checker" as const,
  extractLayer: 1 as const,
  ...overrides,
})

const checkInput = (toolInput: unknown) => ({ sessionID, toolName: "edit", toolInput })

describe("CorrectionStore", () => {
  const it = testEffect(layerFor())

  it.effect("returns an advisory warning when check matches a recorded wrong value", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      const warning = yield* store.check(checkInput({ path: "./old.ts" }))
      expect(warning).toContain("./new.ts")
      expect(warning).toContain("如确需使用旧值请忽略此提醒")
    }),
  )

  it.effect("returns an empty string when check does not match any wrong value", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      const warning = yield* store.check(checkInput({ path: "./unrelated.ts" }))
      expect(warning).toBe("")
    }),
  )

  it.effect("keeps corrections isolated per session", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      const warning = yield* store.check({ sessionID: otherSessionID, toolName: "edit", toolInput: { path: "./old.ts" } })
      expect(warning).toBe("")
    }),
  )

  it.effect("evicts the oldest entry beyond the FIFO cap", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      for (let i = 1; i <= 21; i++) {
        yield* store.record({
          sessionID,
          entry: detectorEntry({ key: `ref:e${i}`, correct: `./new${i}.ts`, wrong: `./old${i}.ts` }),
        })
      }
      expect(yield* store.check(checkInput({ path: "./old1.ts" }))).toBe("")
      expect(yield* store.check(checkInput({ path: "./old21.ts" }))).toContain("./new21.ts")
    }),
  )

  it.effect("stops intercepting L1 detector corrections after 10 turns", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      for (let i = 1; i <= 10; i++) {
        const warning = yield* store.check(checkInput({ path: "./old.ts" }))
        expect(warning).not.toBe("")
      }
      expect(yield* store.check(checkInput({ path: "./old.ts" }))).toBe("")
    }),
  )

  it.effect("never expires user corrections", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: {
          source: "user-correction",
          extractLayer: 2,
          key: "user:./old.ts",
          correct: "./new.ts",
          wrong: "./old.ts",
        },
      })
      for (let i = 1; i <= 15; i++) {
        const warning = yield* store.check(checkInput({ path: "./old.ts" }))
        expect(warning).not.toBe("")
      }
    }),
  )

  it.effect("keeps L1 facts injectable beyond the interception TTL", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      for (let i = 1; i <= 15; i++) {
        yield* store.check(checkInput({ path: "./other.ts" }))
      }
      const facts = yield* store.facts(sessionID)
      expect(facts).toEqual([{ key: "ref:./old.ts", correct: "./new.ts" }])
    }),
  )

  it.effect("drops L3 raw fallback facts after 5 turns", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: { source: "user-correction", extractLayer: 3, key: "raw:./a.ts", correct: "路径是 ./a.ts" },
      })
      for (let i = 1; i <= 6; i++) {
        yield* store.check(checkInput({ path: "./other.ts" }))
      }
      expect(yield* store.facts(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("exposes only correct values through facts", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      const facts = yield* store.facts(sessionID)
      expect(facts).toHaveLength(1)
      expect(facts[0]).toEqual({ key: "ref:./old.ts", correct: "./new.ts" })
    }),
  )
})

describe("CorrectionStore disabled", () => {
  const it = testEffect(layerFor({ enabled: false }))

  it.effect("check returns an empty string and record does not write", () =>
    Effect.gen(function* () {
      const store = yield* CorrectionStore.Service
      yield* store.record({
        sessionID,
        entry: detectorEntry({ key: "ref:./old.ts", correct: "./new.ts", wrong: "./old.ts" }),
      })
      expect(yield* store.check(checkInput({ path: "./old.ts" }))).toBe("")
      expect(yield* store.facts(sessionID)).toHaveLength(0)
    }),
  )
})
