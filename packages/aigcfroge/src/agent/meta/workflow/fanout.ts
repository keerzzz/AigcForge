import { Effect, Exit } from "effect"
import { WorkflowState } from "./state"
import type { WorkflowStep, WorkflowState as WState, StepResult } from "./state"

export type StepExecutor = (step: WorkflowStep) => Effect.Effect<string>

export function fanout(
  id: string,
  steps: WorkflowStep[],
  execute: StepExecutor,
): Effect.Effect<WState> {
  return Effect.gen(function* () {
    let state = WorkflowState.createWorkflow(id, steps)
    state = WorkflowState.updateStatus(state, "running")

    const results: Array<StepResult> = yield* Effect.forEach(
      steps,
      (step, i) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(execute(step))
          if (Exit.isSuccess(exit)) {
            return { step, status: "completed" as const, output: exit.value, seq: i + 1 }
          }
          return { step, status: "failed" as const, error: "Step execution failed", seq: i + 1 }
        }),
      { concurrency: "unbounded" },
    )

    state = results.reduce((s, r) => WorkflowState.addResult(s, r), state)
    const hasFailures = results.some((r) => r.status === "failed")

    return WorkflowState.updateStatus(state, hasFailures ? "failed" : "completed")
  })
}

export * as WorkflowFanout from "./fanout"
