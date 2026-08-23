export * as ApprovalPresence from "./approval-presence"

import { Context, Effect, Layer } from "effect"

export const DEFAULT_TTL_MS = 300_000
export const MAX_TTL_MS = 60 * 60 * 1000

/**
 * Connection/subscription fact source for approval prompts (ADR-20 §2.7):
 * whether at least one capable approver is attached right now. The `attended`
 * flag is a default, not evidence of a human — only wired connection facts
 * may answer this. Hosts that do not provide the service keep the legacy
 * bounded-wait behavior (TTL still applies, no responder facts exist).
 */
export interface Interface {
  readonly hasResponder: () => Effect.Effect<boolean>
  /** Bounded wait for an answer; clamped to (0, MAX_TTL_MS]. */
  readonly ttlMs: number
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ApprovalPresence") {}

const clamp = (ttlMs: number) => Math.min(Math.max(Math.floor(ttlMs), 1), MAX_TTL_MS)

export const make = (ttlMs: number, hasResponder: () => Effect.Effect<boolean>) =>
  Layer.succeed(Service, Service.of({ ttlMs: clamp(ttlMs), hasResponder }))

/**
 * Process-local host wiring seam (same pattern as session/runner/auth-seam):
 * the HTTP/SSE layer registers the live connection fact source at startup.
 * Unwired hosts get the bounded default TTL with no responder facts, so asks
 * can never wait indefinitely even before the approval center exists.
 */
let wired: Interface | undefined

export const wire = (impl: Interface): void => {
  wired = impl
}

export const current = (): Interface | undefined =>
  wired ?? { ttlMs: DEFAULT_TTL_MS, hasResponder: () => Effect.succeed(true) }
