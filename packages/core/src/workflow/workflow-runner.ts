export * as WorkflowRunner from "./workflow-runner"

import { Context, Effect, Layer, Schema } from "effect"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import type { Session as SessionSchema } from "@aigcfroge/schema/session"
import { ProductModePolicy } from "../product-mode-policy"
import { SessionComposition } from "../session/composition"
import { WorkflowRun } from "./workflow-run"

export class WorkflowExecutionError extends Schema.TaggedErrorClass<WorkflowExecutionError>()(
  "WorkflowRunner.WorkflowExecutionError",
  {
    runID: Schema.String,
    reason: Schema.String,
  },
) {}

export interface StepExecutor {
  readonly execute: (input: {
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly stepRun: WorkflowAsset.StepRunInfo
    readonly stepDef: WorkflowAsset.StepDef
    readonly snapshot: Composition.SnapshotV2
  }) => Effect.Effect<{ output?: unknown; error?: string }>
}

export interface Interface {
  readonly run: (
    sessionID: SessionSchema.ID,
    executor?: StepExecutor,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined, WorkflowExecutionError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowRunner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workflowRun = yield* WorkflowRun.Service
    const sessionComposition = yield* SessionComposition.Service

    const defaultExecutor: StepExecutor = {
      execute: (input) =>
        Effect.succeed({
          output: {
            stepId: input.stepDef.id,
            agent: input.stepDef.agent,
            executedAt: Date.now(),
          },
        }),
    }

    const run: Interface["run"] = Effect.fn("WorkflowRunner.run")(function* (sessionID, customExecutor) {
      const executor = customExecutor ?? defaultExecutor

      // 1. Read composition snapshot
      const snapshot = yield* sessionComposition.read(sessionID).pipe(
        Effect.mapError(
          (err) =>
            new WorkflowExecutionError({
              runID: sessionID,
              reason: `Failed to read composition snapshot: ${err.details}`,
            }),
        ),
      )

      if (!snapshot || snapshot.version !== 2 || !snapshot.data.workflow) {
        return undefined
      }

      const workflow = snapshot.data.workflow
      const stepsDef = workflow.steps

      // 2. Get or create WorkflowRun
      let currentRun = yield* workflowRun.getBySession(sessionID)
      if (!currentRun) {
        currentRun = yield* workflowRun.create({
          sessionID,
          workflow,
        })
      }

      if (
        currentRun.status === "completed" ||
        currentRun.status === "failed" ||
        currentRun.status === "cancelled" ||
        currentRun.status === "partial_success"
      ) {
        return currentRun
      }

      const runID = currentRun.id

      // 3. Execution loop
      let isDone = false
      while (!isDone) {
        // Kill-switch mid-drain check
        if (!ProductModePolicy.isCustomModeEnabled()) {
          return yield* workflowRun.cancelRun(runID, "custom_mode_disabled").pipe(
            Effect.mapError(
              () =>
                new WorkflowExecutionError({
                  runID,
                  reason: "custom_mode_disabled",
                }),
            ),
          )
        }

        const readySteps = yield* workflowRun.findReadySteps(runID, stepsDef)
        if (readySteps.length === 0) {
          const allSteps = yield* workflowRun.getSteps(runID)
          const runningSteps = allSteps.filter((s) => s.status === "running")
          if (runningSteps.length > 0) {
            // Still in flight
            break
          }

          // Group by latest attempt per step
          const latestStepMap = new Map<string, WorkflowAsset.StepRunInfo>()
          for (const s of allSteps) {
            const existing = latestStepMap.get(s.stepId)
            if (!existing || existing.attempt < s.attempt) {
              latestStepMap.set(s.stepId, s)
            }
          }
          const latestSteps = Array.from(latestStepMap.values())

          const hasCancelled = latestSteps.some((s) => s.status === "cancelled")
          if (hasCancelled) {
            return yield* workflowRun.cancelRun(runID, "step_cancelled").pipe(
              Effect.mapError(
                () => new WorkflowExecutionError({ runID, reason: "step_cancelled" }),
              ),
            )
          }

          const failedSteps = latestSteps.filter((s) => s.status === "failed")
          if (failedSteps.length > 0) {
            // Check if all failed steps had failurePolicy: continue
            const allFailuresAllowed = failedSteps.every((s) => {
              const def = stepsDef.find((d) => d.id === s.stepId)
              return def?.failurePolicy === "continue"
            })

            if (allFailuresAllowed) {
              return yield* workflowRun.completeRun(runID, true).pipe(
                Effect.mapError(
                  () => new WorkflowExecutionError({ runID, reason: "partial_success_failed" }),
                ),
              )
            }

            const firstFatal = failedSteps.find((s) => {
              const def = stepsDef.find((d) => d.id === s.stepId)
              return def?.failurePolicy !== "continue"
            })
            const errorMsg = firstFatal?.error
              ? `Step ${firstFatal.stepId} failed: ${firstFatal.error}`
              : "Workflow step execution failed"

            return yield* workflowRun.failRun(runID, errorMsg).pipe(
              Effect.mapError(
                () => new WorkflowExecutionError({ runID, reason: "step_failed" }),
              ),
            )
          }

          // All completed
          return yield* workflowRun.completeRun(runID).pipe(
            Effect.mapError(
              () => new WorkflowExecutionError({ runID, reason: "complete_run_failed" }),
            ),
          )
        }

        // Execute ready steps (in parallel if multiple)
        yield* Effect.forEach(
          readySteps,
          (stepRun) =>
            Effect.gen(function* () {
              const stepDef = stepsDef.find((s) => s.id === stepRun.stepId)
              if (!stepDef) return

              yield* workflowRun.startStep(stepRun.id).pipe(
                Effect.mapError(
                  () => new WorkflowExecutionError({ runID, reason: `start_step_failed:${stepRun.id}` }),
                ),
              )

              const result = yield* executor
                .execute({
                  runID,
                  stepRun,
                  stepDef,
                  snapshot,
                })
                .pipe(
                  Effect.catch((err) =>
                    Effect.succeed({
                      error: typeof err === "string" ? err : JSON.stringify(err),
                    }),
                  ),
                )

              if (result.error) {
                const maxAttempts = stepDef.maxAttempts ?? 1
                if (stepDef.failurePolicy === "retry" && stepRun.attempt < maxAttempts) {
                  yield* workflowRun.settleStep(stepRun.id, {
                    status: "failed",
                    error: result.error,
                  }).pipe(
                    Effect.mapError(
                      () => new WorkflowExecutionError({ runID, reason: `settle_step_failed:${stepRun.id}` }),
                    ),
                  )
                  yield* workflowRun.retryStep(stepRun.id).pipe(
                    Effect.mapError(
                      () => new WorkflowExecutionError({ runID, reason: `retry_step_failed:${stepRun.id}` }),
                    ),
                  )
                } else if (stepDef.failurePolicy === "continue") {
                  yield* workflowRun.settleStep(stepRun.id, {
                    status: "failed",
                    error: result.error,
                  }).pipe(
                    Effect.mapError(
                      () => new WorkflowExecutionError({ runID, reason: `settle_step_failed:${stepRun.id}` }),
                    ),
                  )
                } else {
                  // abort
                  yield* workflowRun.settleStep(stepRun.id, {
                    status: "failed",
                    error: result.error,
                  }).pipe(
                    Effect.mapError(
                      () => new WorkflowExecutionError({ runID, reason: `settle_step_failed:${stepRun.id}` }),
                    ),
                  )
                  yield* workflowRun.failRun(runID, `Step ${stepDef.id} failed: ${result.error}`).pipe(
                    Effect.mapError(
                      () => new WorkflowExecutionError({ runID, reason: `fail_run_failed:${runID}` }),
                    ),
                  )
                }
              } else {
                const output = "output" in result ? result.output : undefined
                yield* workflowRun.settleStep(stepRun.id, {
                  status: "completed",
                  output,
                }).pipe(
                  Effect.mapError(
                    () => new WorkflowExecutionError({ runID, reason: `settle_step_failed:${stepRun.id}` }),
                  ),
                )
              }
            }),
          { concurrency: "unbounded" },
        )
      }

      return yield* workflowRun.get(runID).pipe(
        Effect.mapError(
          () => new WorkflowExecutionError({ runID, reason: `get_run_failed:${runID}` }),
        ),
      )
    })

    return Service.of({
      run,
    } satisfies Interface)
  }),
)

export const locationLayer = layer
export const defaultLayer = layer.pipe(
  Layer.provide(WorkflowRun.defaultLayer),
  Layer.provide(SessionComposition.defaultLayer),
)
