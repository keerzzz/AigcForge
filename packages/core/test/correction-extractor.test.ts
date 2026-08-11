import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionExtractor } from "../src/session/correction-extractor"
import { CorrectionStore } from "../src/session/correction-store"
import { SessionV2 } from "../src/session"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_correction_extractor")

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

const layerFor = (meta = {}) =>
  CorrectionExtractor.layer.pipe(
    Layer.provideMerge(CorrectionStore.layer.pipe(Layer.provide(configLayer(meta)))),
  )

const extract = (text: string) =>
  Effect.gen(function* () {
    const extractor = yield* CorrectionExtractor.Service
    return yield* extractor.extract(sessionID, text)
  })

describe("CorrectionExtractor", () => {
  const it = testEffect(layerFor())

  it.effect("extracts a path correction pair", () =>
    Effect.gen(function* () {
      const entries = yield* extract("不对，路径是 ./bar 不是 ./foo")
      expect(entries).toEqual([
        {
          key: "user:./bar",
          correct: "./bar",
          wrong: "./foo",
          source: "user-correction",
          extractLayer: 2,
        },
      ])
    }),
  )

  it.effect("extracts a type signature correction pair", () =>
    Effect.gen(function* () {
      const entries = yield* extract("错了，函数返回 Promise<string> 不是 string")
      expect(entries).toEqual([
        {
          key: "user:Promise<string>",
          correct: "Promise<string>",
          wrong: "string",
          source: "user-correction",
          extractLayer: 2,
        },
      ])
    }),
  )

  it.effect("extracts an HTTP method correction pair", () =>
    Effect.gen(function* () {
      const entries = yield* extract("should be POST not GET")
      expect(entries).toEqual([
        {
          key: "user:POST",
          correct: "POST",
          wrong: "GET",
          source: "user-correction",
          extractLayer: 2,
        },
      ])
    }),
  )

  it.effect("rejects API key content", () =>
    Effect.gen(function* () {
      expect(yield* extract("sk-abc123def456ghi789jkl012 is wrong")).toHaveLength(0)
    }),
  )

  it.effect("rejects bearer token content", () =>
    Effect.gen(function* () {
      expect(yield* extract("the token should be Bearer eyJhbGciOiJIUzI1NiJ9.abc not the old")).toHaveLength(0)
    }),
  )

  it.effect("rejects password assignments", () =>
    Effect.gen(function* () {
      expect(yield* extract("password=secret123 should not be committed")).toHaveLength(0)
    }),
  )

  it.effect("does not extract without a correction signal", () =>
    Effect.gen(function* () {
      expect(yield* extract("请帮我写一个函数")).toHaveLength(0)
    }),
  )

  it.effect("falls back to raw text when no structured pair is extractable", () =>
    Effect.gen(function* () {
      const entries = yield* extract("不对，这个算法应该更简单一些")
      expect(entries).toEqual([
        {
          key: "user:不对，这个算法应该更简单一些",
          correct: "不对，这个算法应该更简单一些",
          wrong: undefined,
          source: "user-correction",
          extractLayer: 3,
        },
      ])
    }),
  )

  it.effect("rejects sensitive raw fallback", () =>
    Effect.gen(function* () {
      expect(yield* extract("不对，token=abc123xyz 的值需要改")).toHaveLength(0)
    }),
  )

  it.effect("rejects values longer than 200 characters", () =>
    Effect.gen(function* () {
      expect(yield* extract(`不对，路径应该是 ${"a".repeat(250)} 不是 ./old`)).toHaveLength(0)
    }),
  )

  it.effect("records extracted corrections into the store", () =>
    Effect.gen(function* () {
      yield* extract("不对，路径是 ./bar 不是 ./foo")
      const store = yield* CorrectionStore.Service
      const facts = yield* store.facts(sessionID)
      expect(facts).toEqual([{ key: "user:./bar", correct: "./bar" }])
    }),
  )
})
