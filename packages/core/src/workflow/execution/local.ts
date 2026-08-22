import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-layer"
import { SessionStore } from "../../session/store"
import { WorkflowExecution } from "../workflow-execution"
import { WorkflowRunner } from "../workflow-runner"
import { WorkflowRun } from "../workflow-run"

/** Routes process-local Workflow ownership through the root Session's full Location. */
export const layer = Layer.effect(
  WorkflowExecution.Service,
    Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap
    const coordinator = yield* WorkflowExecution.make<WorkflowRunner.WorkflowExecutionError | WorkflowRun.RequestConflictError>({
      admit: (sessionID, requestID, expectedSnapshotDigest) =>
        Effect.gen(function* () {
          const session = yield* store.get(sessionID)
          if (!session) {
            return yield* new WorkflowRunner.WorkflowExecutionError({
              runID: sessionID,
              reason: "session_not_found",
            })
          }
          return yield* WorkflowRunner.Service.use((runner) =>
            runner.admit(sessionID, requestID, expectedSnapshotDigest),
          ).pipe(Effect.provide(locations.get(session.location)))
        }),
      drain: (sessionID) =>
        Effect.gen(function* () {
          const session = yield* store.get(sessionID)
          if (!session) {
            return yield* new WorkflowRunner.WorkflowExecutionError({
              runID: sessionID,
              reason: "session_not_found",
            })
          }
          return yield* WorkflowRunner.Service.use((runner) => runner.run(sessionID)).pipe(
            Effect.provide(locations.get(session.location)),
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("Failed to drain Workflow", cause).pipe(Effect.annotateLogs({ sessionID })),
            ),
          )
        }),
    })
    return WorkflowExecution.Service.of(coordinator)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStore.defaultLayer))
