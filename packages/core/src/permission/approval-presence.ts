export * as ApprovalPresence from "./approval-presence"

import { Context, Effect, Layer, Schema } from "effect"
import type * as Scope from "effect/Scope"

export const DEFAULT_TTL_MS = 300_000
export const MAX_TTL_MS = 60 * 60 * 1000

const clampTtl = (ttlMs: number) => Math.min(Math.max(Math.floor(ttlMs), 1), MAX_TTL_MS)

/**
 * Connection-fact source for approval prompts (ADR-20 §2.7). Responders are
 * HTTP/SSE connections carrying the custom-capability header; each one binds
 * itself for the lifetime of its connection Scope. Zero bound responders
 * means nobody can answer — prompts are rejected immediately instead of
 * parking until a TTL. There is intentionally no default "yes someone is
 * there": absence of facts is absence of an approver.
 */
export interface Interface {
  /** Registers one capable responder; released when the connection Scope closes. */
  readonly bindResponder: () => Effect.Effect<void, never, Scope.Scope>
  /** Live connection fact: at least one responder is currently bound. */
  readonly hasResponder: () => Effect.Effect<boolean>
  /** Bounded wait for an answer once a responder exists; clamped to (0, MAX_TTL_MS]. */
  readonly ttlMs: number
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ApprovalPresence") {}

export const make = (ttlMs: number) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      let responders = 0
      return Service.of({
        bindResponder: Effect.fn("ApprovalPresence.bindResponder")(function* () {
          responders += 1
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              responders -= 1
            }),
          )
        }),
        hasResponder: () => Effect.sync(() => responders > 0),
        ttlMs: clampTtl(ttlMs),
      })
    }),
  )

export const locationLayer = make(DEFAULT_TTL_MS)

/** Test convenience: a layer with a permanently bound responder and fixed TTL. */
export const testLayerWithResponder = (ttlMs: number) =>
  Layer.mergeAll(make(ttlMs), Layer.effectDiscard(Effect.gen(function* () {
    yield* (yield* Service).bindResponder()
  })))

export const Reason = Schema.Literals(["no_responder"])
