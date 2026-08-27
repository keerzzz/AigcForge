export * as ApprovalPresence from "./approval-presence"

import { Context, Effect, Layer, Schema } from "effect"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Location } from "../location"
import type * as Scope from "effect/Scope"

export const DEFAULT_TTL_MS = 300_000
export const MAX_TTL_MS = 60 * 60 * 1000

const clampTtl = (ttlMs: number) => Math.min(Math.max(Math.floor(ttlMs), 1), MAX_TTL_MS)

/**
 * Connection-fact source for approval prompts (ADR-20 §2.7): can anyone answer
 * a prompt right now? Event-stream connections bind themselves for the lifetime
 * of their connection Scope; zero bound responders means nobody can answer, so
 * the prompt is rejected immediately instead of parking until a TTL. There is
 * deliberately no default "yes someone is there" — absence of facts must never
 * be read as presence of an approver.
 *
 * This is a **coarse liveness hint, not an authorization fact**, and the
 * asymmetry of its failure modes is what fixes its shape:
 *
 * - Over-reporting (a responder is bound that cannot actually see this
 *   Location's or this mode's prompts) costs one bounded TTL wait and then a
 *   typed rejection. Nothing is ever granted. The custom-mode capability is
 *   tracked separately so a legacy SSE connection cannot over-report custom
 *   approval availability.
 * - Under-reporting (no responder bound while a client is in fact watching)
 *   turns every `ask` into a hard denial with no path to approval.
 *
 * So it is provided once per process (`LocationServiceMap` dependencies) rather
 * than per Location: the HTTP layer knows about connections, not about which
 * Locations they may end up asking about, and being coarser is the safe
 * direction. Authorization itself never consults this — `reply` still routes
 * through the owning Location's PermissionV2, and the leaf `assert` remains the
 * final boundary.
 *
 * `PermissionV2` takes this as a **hard dependency on purpose**: an optional
 * lookup let a build ship where nothing provided it, and every `ask` in every
 * mode silently became `RejectedError(no_responder)` while tests stayed green
 * because each harness provided the layer itself. A missing provider must be a
 * layer/type error, not a runtime policy change.
 */
export interface Interface {
  /** Registers one responder and the modes and Location it can observe. */
  readonly bindResponder: (input: {
    readonly location?: Location.Ref
    readonly custom: boolean
  }) => Effect.Effect<void, never, Scope.Scope>
  /** Live connection fact: at least one responder can observe this Location and mode. */
  readonly hasResponder: (input: {
    readonly location: Location.Ref
    readonly mode: ProductMode.ID
  }) => Effect.Effect<boolean>
  /** Bounded wait for an answer once a responder exists; clamped to (0, MAX_TTL_MS]. */
  readonly ttlMs: number
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ApprovalPresence") {}

export const make = (ttlMs: number) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const responders: Array<{ readonly location?: Location.Ref; readonly custom: boolean }> = []
      return Service.of({
        bindResponder: Effect.fn("ApprovalPresence.bindResponder")(function* (input: {
          readonly location?: Location.Ref
          readonly custom: boolean
        }) {
          responders.push(input)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              const index = responders.indexOf(input)
              if (index >= 0) responders.splice(index, 1)
            }),
          )
        }),
        hasResponder: (input) =>
          Effect.sync(() =>
            responders.some(
              (responder) =>
                (input.mode !== "custom" || responder.custom) &&
                (responder.location === undefined || sameLocation(responder.location, input.location)),
            ),
          ),
        ttlMs: clampTtl(ttlMs),
      })
    }),
  )

/** Process-wide instance; belongs in `LocationServiceMap` dependencies, not inside a Location. */
export const defaultLayer = make(DEFAULT_TTL_MS)

export const Reason = Schema.Literals(["no_responder"])

function sameLocation(left: Location.Ref, right: Location.Ref) {
  return left.directory === right.directory && left.workspaceID === right.workspaceID
}
