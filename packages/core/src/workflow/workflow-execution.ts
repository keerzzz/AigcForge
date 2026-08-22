export * as WorkflowExecution from "./workflow-execution"

import { Context, Effect, Layer, Scope } from "effect"
import { SessionSchema } from "../session/schema"
import { SessionRunCoordinator } from "../session/run-coordinator"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { WorkflowRunner } from "./workflow-runner"
import { WorkflowRun } from "./workflow-run"

export interface Options<E> {
  readonly admit: (
    sessionID: SessionSchema.ID,
    requestID?: string,
    expectedSnapshotDigest?: string,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined, E>
  readonly drain: (sessionID: SessionSchema.ID) => Effect.Effect<void, E>
}

export interface Coordinator<E> {
  readonly submit: (
    sessionID: SessionSchema.ID,
    requestID?: string,
    expectedSnapshotDigest?: string,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined, E>
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly isActive: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

export const make = <E>(options: Options<E>): Effect.Effect<Coordinator<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, E>({
      drain: (sessionID) => options.drain(sessionID),
    })

    const submit = Effect.fn("WorkflowExecution.submit")(
      (sessionID: SessionSchema.ID, requestID?: string, expectedSnapshotDigest?: string) =>
        Effect.gen(function* () {
          const run = yield* options.admit(sessionID, requestID, expectedSnapshotDigest)
          yield* coordinator.wake(sessionID)
          return run
        }),
    )

    return {
      submit,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      isActive: coordinator.isActive,
    }
  })

export interface Interface extends Coordinator<WorkflowRunner.WorkflowExecutionError | WorkflowRun.RequestConflictError> {}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowExecution") {}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const coordinator = yield* make<WorkflowRunner.WorkflowExecutionError>({
    admit: () => Effect.die("WorkflowExecution requires a location-scoped admission implementation"),
    drain: () => Effect.die("WorkflowExecution requires a location-scoped drain implementation"),
  })
  return Service.of(coordinator)
}))
