import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { VerificationRouter } from "../src/session/verification-router"
import { SessionV2 } from "../src/session"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_verification_router")

const configLayer = (meta: { escalation_enabled?: boolean; escalation_threshold?: number } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({
              meta: ConfigMeta.Info.make({ verifier: ConfigMeta.Verifier.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const layerFor = (meta = {}) => VerificationRouter.layer.pipe(Layer.provide(configLayer(meta)))

const route = (overrides: { intent?: string; failed?: boolean } = {}) =>
  Effect.gen(function* () {
    const router = yield* VerificationRouter.Service
    return yield* router.route({
      sessionID,
      intent: overrides.intent ?? "code_modification",
      failed: overrides.failed ?? false,
    })
  })

describe("VerificationRouter", () => {
  const it = testEffect(layerFor({ escalation_enabled: true, escalation_threshold: 2 }))

  it.effect("routes to L0 by default", () =>
    Effect.gen(function* () {
      expect(yield* route()).toBe("l0")
    }),
  )

  it.effect("stays on L0 until the failure threshold is reached", () =>
    Effect.gen(function* () {
      expect(yield* route({ failed: true })).toBe("l0")
      expect(yield* route()).toBe("l0")
    }),
  )

  it.effect("escalates to L1 after L0 fails twice", () =>
    Effect.gen(function* () {
      expect(yield* route({ failed: true })).toBe("l0")
      expect(yield* route({ failed: true })).toBe("l0")
      expect(yield* route()).toBe("l1")
    }),
  )

  it.effect("escalates to L2 after L1 fails", () =>
    Effect.gen(function* () {
      yield* route({ failed: true })
      yield* route({ failed: true })
      yield* route({ failed: true })
      yield* route({ failed: true })
      expect(yield* route()).toBe("l2")
    }),
  )

  it.effect("resets the counter and returns to L0 after success", () =>
    Effect.gen(function* () {
      yield* route({ failed: true })
      yield* route({ failed: true })
      expect(yield* route()).toBe("l1")
      yield* route({ failed: false })
      expect(yield* route()).toBe("l0")
    }),
  )

  it.effect("routes content_creation directly to L1", () =>
    Effect.gen(function* () {
      expect(yield* route({ intent: "content_creation" })).toBe("l1")
    }),
  )
})

describe("VerificationRouter disabled escalation", () => {
  const it = testEffect(layerFor({ escalation_enabled: false }))

  it.effect("always routes to L0 when escalation is disabled", () =>
    Effect.gen(function* () {
      for (let i = 0; i < 5; i++) {
        yield* route({ failed: true })
      }
      expect(yield* route()).toBe("l0")
    }),
  )
})
