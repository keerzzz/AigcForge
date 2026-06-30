import { describe, it, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { WorkflowFanout } from "../../../../src/agent/meta/workflow/fanout"

describe("workflow fanout", () => {
  it("executes all steps and collects results", () => {
    const executor = (step: { target: string }) =>
      Effect.succeed(`${step.target} done`)

    const exit = Effect.runSync(
      Effect.exit(WorkflowFanout.fanout("wf_003", [
        { target: "explore", type: "subagent", prompt: "Search" },
        { target: "build", type: "subagent", prompt: "Build" },
      ], executor)),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("completed")
      expect(exit.value.results).toHaveLength(2)
      expect(exit.value.results.map((r) => r.output)).toContain("explore done")
      expect(exit.value.results.map((r) => r.output)).toContain("build done")
    }
  })

  it("completes with partial results when some steps fail", () => {
    const executor = (step: { target: string }) =>
      Effect.succeed(`${step.target} done`)

    const exit = Effect.runSync(
      Effect.exit(WorkflowFanout.fanout("wf_004", [
        { target: "a", type: "subagent", prompt: "A" },
        { target: "b", type: "subagent", prompt: "B" },
      ], executor)),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.results).toHaveLength(2)
    }
  })
})
