export * as SessionExecution from "./execution"

import { Context, Effect, Layer } from "effect"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"

export interface Interface {
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Reports whether this process owns in-flight or scheduled work for the Session. */
  readonly isActive: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

// TEST-ONLY escape hatch: the instance HttpApi test assembly (HttpApiApp.routes)
// bakes in the real SessionExecutionLocal, so per-test Layer overrides cannot
// reach it. This seam lets a test force isActive for a specific Session.
// Production code must never call setBusySeamForTesting; tracked in
// docs/technical-debt.md (remove once the test assembly exposes an injection point).
let busySeamForTesting: ((sessionID: SessionSchema.ID) => boolean) | undefined = undefined

export const setBusySeamForTesting = (fn: ((sessionID: SessionSchema.ID) => boolean) | undefined): void => {
  busySeamForTesting = fn
}

export const isBusySeamActive = (sessionID: SessionSchema.ID): boolean | undefined =>
  busySeamForTesting ? busySeamForTesting(sessionID) : undefined

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionExecution") {}

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    isActive: (sessionID) => {
      const seam = isBusySeamActive(sessionID)
      return seam !== undefined ? Effect.succeed(seam) : Effect.succeed(false)
    },
  }),
)
