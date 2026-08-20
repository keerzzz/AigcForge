import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkflowAsset } from "../src/workflow-asset"

describe("WorkflowAsset Schema M2", () => {
  test("StepDef accepts failurePolicy, maxAttempts, and timeoutSeconds", () => {
    const step = Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
      id: "step_1",
      name: "Run Tests",
      agent: "tester",
      input: { suite: "unit" },
      next: "step_2",
      failurePolicy: "retry",
      maxAttempts: 3,
      timeoutSeconds: 120,
    })

    expect(step.id).toBe("step_1")
    expect(step.agent).toBe("tester")
    expect(step.failurePolicy).toBe("retry")
    expect(step.maxAttempts).toBe(3)
    expect(step.timeoutSeconds).toBe(120)
  })

  test("StepDef failurePolicy defaults to abort", () => {
    const step = Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
      id: "step_1",
      name: "Build",
      agent: "builder",
    })

    expect(step.failurePolicy).toBe("abort")
    expect(step.maxAttempts).toBe(1)
  })

  test("StepDef rejects invalid failurePolicy", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
        id: "step_1",
        name: "Build",
        agent: "builder",
        failurePolicy: "invalid_policy",
      }),
    ).toThrow()
  })

  test("WorkflowRunStatus decodes all 6 statuses", () => {
    const statuses = ["pending", "running", "completed", "failed", "cancelled", "partial_success"] as const
    for (const s of statuses) {
      expect(Schema.decodeSync(WorkflowAsset.WorkflowRunStatus)(s)).toBe(s)
    }
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunStatus)("unknown_status")).toThrow()
  })

  test("StepRunStatus decodes all 7 statuses", () => {
    const statuses = ["pending", "ready", "running", "completed", "failed", "cancelled", "skipped"] as const
    for (const s of statuses) {
      expect(Schema.decodeSync(WorkflowAsset.StepRunStatus)(s)).toBe(s)
    }
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.StepRunStatus)("unknown_status")).toThrow()
  })

  describe("Graph Validation", () => {
    test("validates a valid linear workflow", () => {
      const steps = [
        { id: "step_1", name: "Step 1", agent: "agent1", next: "step_2" },
        { id: "step_2", name: "Step 2", agent: "agent2", next: "step_3" },
        { id: "step_3", name: "Step 3", agent: "agent3" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("validates a valid branching workflow", () => {
      const steps = [
        {
          id: "step_1",
          name: "Step 1",
          agent: "agent1",
          branches: { success: "step_good", failure: "step_bad" },
        },
        { id: "step_good", name: "Good", agent: "agent2" },
        { id: "step_bad", name: "Bad", agent: "agent3" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("validates a valid parallel workflow", () => {
      const steps = [
        {
          id: "step_1",
          name: "Step 1",
          agent: "agent1",
          parallel: ["task_a", "task_b"],
        },
        { id: "task_a", name: "Task A", agent: "agent2", next: "step_join" },
        { id: "task_b", name: "Task B", agent: "agent3", next: "step_join" },
        { id: "step_join", name: "Join", agent: "agent1" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("rejects duplicate step IDs", () => {
      const steps = [
        { id: "dup", name: "Step 1", agent: "agent1", next: "step_2" },
        { id: "dup", name: "Step 2", agent: "agent2" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "duplicate_step_id")).toBe(true)
    })

    test("rejects unknown next step target", () => {
      const steps = [{ id: "step_1", name: "Step 1", agent: "agent1", next: "non_existent" }]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "unknown_step_target")).toBe(true)
    })

    test("rejects unknown branch target", () => {
      const steps = [
        {
          id: "step_1",
          name: "Step 1",
          agent: "agent1",
          branches: { ok: "non_existent" },
        },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "unknown_branch_target")).toBe(true)
    })

    test("rejects unknown parallel target", () => {
      const steps = [
        {
          id: "step_1",
          name: "Step 1",
          agent: "agent1",
          parallel: ["non_existent"],
        },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "unknown_parallel_target")).toBe(true)
    })

    test("rejects cycles in graph", () => {
      const steps = [
        { id: "step_1", name: "Step 1", agent: "agent1", next: "step_2" },
        { id: "step_2", name: "Step 2", agent: "agent2", next: "step_1" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "graph_cycle")).toBe(true)
    })

    test("rejects unreachable disconnected steps", () => {
      const steps = [
        { id: "step_1", name: "Step 1", agent: "agent1" },
        { id: "step_island", name: "Island", agent: "agent2" },
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "unreachable_step")).toBe(true)
    })

    test("rejects exceeding maximum steps limit (64)", () => {
      const steps = Array.from({ length: 65 }, (_, i) => ({
        id: `step_${i}`,
        name: `Step ${i}`,
        agent: "agent",
        next: i < 64 ? `step_${i + 1}` : undefined,
      }))
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "max_steps_exceeded")).toBe(true)
    })

    test("rejects exceeding maximum parallel concurrency limit (8)", () => {
      const parallelTargets = Array.from({ length: 9 }, (_, i) => `parallel_${i}`)
      const steps = [
        {
          id: "step_start",
          name: "Start",
          agent: "agent",
          parallel: parallelTargets,
        },
        ...parallelTargets.map((id) => ({
          id,
          name: id,
          agent: "agent",
        })),
      ]
      const result = WorkflowAsset.validateGraph(steps.map((s) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(s)))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === "max_parallel_exceeded")).toBe(true)
    })
  })
})
