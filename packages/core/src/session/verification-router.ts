export * as VerificationRouter from "./verification-router"

import { Context, Effect, Layer, Ref, Schema } from "effect"
import { Config } from "../config"
import { SessionSchema } from "./schema"

const DEFAULT_ESCALATION_ENABLED = false
const DEFAULT_ESCALATION_THRESHOLD = 2

type Settings = {
  readonly escalationEnabled: boolean
  readonly escalationThreshold: number
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.verifier ? [entry.info.meta.verifier] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      escalationEnabled: current.escalation_enabled ?? result.escalationEnabled,
      escalationThreshold: current.escalation_threshold ?? result.escalationThreshold,
    }),
    { escalationEnabled: DEFAULT_ESCALATION_ENABLED, escalationThreshold: DEFAULT_ESCALATION_THRESHOLD },
  )
}

export type RouteLevel = "l0" | "l1" | "l2"

type RouteState = {
  readonly level: RouteLevel
  readonly failures: number
}

export class InvalidLevelError extends Schema.TaggedErrorClass<InvalidLevelError>()(
  "VerificationRouter.InvalidLevelError",
  {
    reason: Schema.String,
  },
) {
  override get message() {
    return `Invalid verification route: ${this.reason}`
  }
}

export interface Interface {
  readonly route: (input: {
    readonly sessionID: SessionSchema.ID
    readonly intent: string | undefined
    readonly failed: boolean
  }) => Effect.Effect<RouteLevel, InvalidLevelError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/VerificationRouter") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const states = yield* Ref.make(new Map<SessionSchema.ID, RouteState>())

    const route = Effect.fn("VerificationRouter.route")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly intent: string | undefined
      readonly failed: boolean
    }) {
      if (!configured.escalationEnabled) return "l0"
      if (input.intent === "content_creation") return "l1"
      return yield* Ref.modify(states, (map) => {
        const current = map.get(input.sessionID) ?? { level: "l0" as const, failures: 0 }
        // The route for this attempt is decided by prior outcomes: once the
        // failure count reaches the threshold, the level moves up one step.
        const level: RouteLevel =
          current.failures >= configured.escalationThreshold
            ? current.level === "l0"
              ? "l1"
              : current.level === "l1"
                ? "l2"
                : "l2"
            : current.level
        if (input.failed) {
          const failures = current.failures + 1
          const next =
            failures >= configured.escalationThreshold
              ? {
                  level:
                    current.level === "l0"
                      ? ("l1" as const)
                      : current.level === "l1"
                        ? ("l2" as const)
                        : ("l2" as const),
                  failures: 0,
                }
              : { level: current.level, failures }
          return [level, map.set(input.sessionID, next)]
        }
        return [level, map.set(input.sessionID, { level: "l0", failures: 0 })]
      })
    })

    return Service.of({ route })
  }),
)
