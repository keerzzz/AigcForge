import { describe, it, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { WorkflowPipeline } from "../../../../src/agent/meta/workflow/pipeline"

describe("workflow pipeline", () => {
  it("executes steps sequentially", () => {
    const order: number[] = []
    const executor = (step: { target: string }, _prev?: string) => {
      order.push(step.target === "plan" ? 1 : 2)
      return Effect.succeed(`${step.target} done`)
    }

    const exit = Effect.runSync(
      Effect.exit(WorkflowPipeline.pipeline("wf_001", [
        { target: "plan", type: "subagent", prompt: "Plan" },
        { target: "build", type: "subagent", prompt: "Build" },
      ], executor)),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("completed")
      expect(exit.value.results).toHaveLength(2)
      expect(exit.value.results[0].output).toBe("plan done")
      expect(exit.value.results[1].output).toBe("build done")
    }
    expect(order).toEqual([1, 2])
  })

  it("stops on first failure", () => {
    let callCount = 0
    const executor = () => {
      callCount++
      return Effect.die(new Error("boom"))
    }

    const exit = Effect.runSync(
      Effect.exit(WorkflowPipeline.pipeline("wf_002", [
        { target: "ok", type: "subagent", prompt: "Ok" },
        { target: "ok", type: "subagent", prompt: "Ok" },
      ], executor)),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("failed")
      expect(exit.value.results).toHaveLength(1)
    }
    expect(callCount).toBe(1)
  })
})
