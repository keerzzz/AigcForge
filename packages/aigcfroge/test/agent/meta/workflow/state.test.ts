import { describe, it, expect } from "bun:test"
import { WorkflowState } from "../../../../src/agent/meta/workflow/state"

describe("workflow state", () => {
  it("creates workflow with pending status", () => {
    const state = WorkflowState.createWorkflow("wf_001", [
      { target: "plan", type: "subagent", prompt: "Design plan" },
      { target: "build", type: "subagent", prompt: "Implement" },
    ])
    expect(state.id).toBe("wf_001")
    expect(state.status).toBe("pending")
    expect(state.steps).toHaveLength(2)
    expect(state.results).toHaveLength(0)
  })

  it("updates status", () => {
    const state = WorkflowState.createWorkflow("wf_001", [])
    const updated = WorkflowState.updateStatus(state, "running")
    expect(updated.status).toBe("running")
    expect(updated.updatedAt).toBeGreaterThanOrEqual(state.createdAt)
  })

  it("adds result", () => {
    const step = { target: "build", type: "subagent" as const, prompt: "Fix" }
    const state = WorkflowState.createWorkflow("wf_001", [step])
    const result = { step, status: "completed" as const, output: "done", seq: 1 }
    const updated = WorkflowState.addResult(state, result)
    expect(updated.results).toHaveLength(1)
    expect(updated.results[0].output).toBe("done")
  })

  it("marks as failed", () => {
    const state = WorkflowState.createWorkflow("wf_001", [
      { target: "plan", type: "subagent", prompt: "Plan" },
    ])
    const failed = WorkflowState.failed(state, "Something broke")
    expect(failed.status).toBe("failed")
    expect(failed.results[0].error).toBe("Something broke")
  })
})
