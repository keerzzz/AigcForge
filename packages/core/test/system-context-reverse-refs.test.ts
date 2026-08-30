import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CacheShape } from "../src/cache/cache-shape"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { ReverseRefs } from "../src/system-context/reverse-refs"
import { SystemContext } from "../src/system-context/index"
import { testEffect } from "./lib/effect"

const configLayer = (meta: { enabled?: boolean } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({
              meta: ConfigMeta.Info.make({ reverse_refs: ConfigMeta.ReverseRefs.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const codegraphLayer = Layer.mock(ReverseRefs.Codegraph, {
  callers: (module) => Effect.succeed(module === "packages/core" ? ["packages/app/src/consumer.ts"] : []),
})

const env = SystemContext.make({
  key: SystemContext.Key.make("core/environment"),
  codec: Schema.toCodecJson(Schema.String),
  load: Effect.succeed("<env>working-directory: /repo</env>"),
  baseline: (value) => value,
  update: (_previous, value) => value,
})

const load = (files: readonly string[]) =>
  Effect.gen(function* () {
    const source = yield* ReverseRefs.source(files)
    const combined = SystemContext.combine([env, ...(source ? [source] : [])])
    return yield* SystemContext.initialize(combined)
  })

describe("ReverseRefs", () => {
  const it = testEffect(Layer.mergeAll(configLayer({ enabled: true }), codegraphLayer))

  it.live("injects callers for changed modules", () =>
    Effect.gen(function* () {
      const generation = yield* load(["packages/core/src/foo.ts"])
      expect(generation.baseline).toContain("Modules referenced")
      expect(generation.baseline).toContain("packages/app/src/consumer.ts")
    }),
  )

  it.live("renders no reverse references without changed files", () =>
    Effect.gen(function* () {
      const generation = yield* load([])
      expect(generation.baseline).toContain("No reverse references.")
    }),
  )
})

describe("ReverseRefs degradation", () => {
  const it = testEffect(configLayer({ enabled: true }))

  it.live("returns no source when codegraph is unavailable", () =>
    Effect.gen(function* () {
      expect(yield* ReverseRefs.source(["packages/core/src/foo.ts"])).toBeUndefined()
    }),
  )
})

describe("ReverseRefs disabled", () => {
  const it = testEffect(Layer.mergeAll(configLayer({ enabled: false }), codegraphLayer))

  it.live("keeps the prefix hash identical when disabled", () =>
    Effect.gen(function* () {
      const generation = yield* load(["packages/core/src/foo.ts"])
      const withoutSource = yield* SystemContext.initialize(env)
      expect(generation.baseline).toBe(withoutSource.baseline)
      const capture = CacheShape.capture(generation.baseline, [], 0)
      const baselineCapture = CacheShape.capture(withoutSource.baseline, [], 0)
      expect(capture.prefixHash).toBe(baselineCapture.prefixHash)
      expect(capture.systemHash).toBe(baselineCapture.systemHash)
    }),
  )
})
