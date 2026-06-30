import { Effect, Exit } from "effect"
import { WorkflowState } from "./state"
import type { WorkflowStep, WorkflowState as WState, StepResult } from "./state"

export type StepExecutor = (step: WorkflowStep, prevOutput: string | undefined) => Effect.Effect<string>

export function pipeline(
  id: string,
  steps: WorkflowStep[],
  execute: StepExecutor,
): Effect.Effect<WState> {
  return Effect.gen(function* () {
    let state = WorkflowState.createWorkflow(id, steps)
    state = WorkflowState.updateStatus(state, "running")
    let prevOutput: string | undefined

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const exit = yield* Effect.exit(execute(step, prevOutput))

      let stepResult: StepResult
      if (Exit.isSuccess(exit)) {
        stepResult = { step, status: "completed", output: exit.value, seq: i + 1 }
      } else {
        stepResult = { step, status: "failed", error: "Step execution failed", seq: i + 1 }
      }

      state = WorkflowState.addResult(state, stepResult)

      if (stepResult.status === "failed") {
        return WorkflowState.updateStatus(state, "failed")
      }

      prevOutput = stepResult.output
    }

    return WorkflowState.updateStatus(state, "completed")
  })
}

export * as WorkflowPipeline from "./pipeline"
