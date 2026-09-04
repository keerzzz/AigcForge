import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-layer"
import { ProductModePolicy } from "../../product-mode-policy"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
export const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        // D12 (S3): custom-mode kill switch at the single SessionRunner.run call
        // site. resume (coordinator.run) and wake both funnel through this drain,
        // so one gate covers provider turns started by either path. Pending inputs
        // stay pending: admission was already gated, and a typed failure here
        // leaves the inbox rows untouched (no durable mutation, no new
        // transaction boundary).
        yield* ProductModePolicy.assertRuntimeSupported(session.mode)
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    return SessionExecution.Service.of({
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
      isActive: (sessionID) => {
        const seam = SessionExecution.isBusySeamActive(sessionID)
        return seam !== undefined ? Effect.succeed(seam) : coordinator.isActive(sessionID)
      },
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStore.defaultLayer))
