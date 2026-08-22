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

  test("bounds retry and timeout resources", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
        id: "step_1",
        name: "Build",
        agent: "builder",
        maxAttempts: WorkflowAsset.MAX_ATTEMPTS + 1,
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
        id: "step_1",
        name: "Build",
        agent: "builder",
        timeoutSeconds: WorkflowAsset.MAX_TIMEOUT_SECONDS + 1,
      }),
    ).toThrow()
  })

  test("WorkflowRunStatus decodes the durable owner lifecycle", () => {
    const statuses = [
      "pending",
      "running",
      "cancelling",
      "completed",
      "partial_success",
      "failed",
      "cancelled",
      "recovery_required",
    ] as const
    for (const s of statuses) {
      expect(Schema.decodeSync(WorkflowAsset.WorkflowRunStatus)(s)).toBe(s)
    }
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunStatus)("unknown_status")).toThrow()
  })

  test("StepRunStatus distinguishes preparation, cancellation, and unknown execution", () => {
    const statuses = [
      "pending",
      "ready",
      "dispatching",
      "running",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "skipped",
      "execution_unknown",
    ] as const
    for (const s of statuses) {
      expect(Schema.decodeSync(WorkflowAsset.StepRunStatus)(s)).toBe(s)
    }
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.StepRunStatus)("unknown_status")).toThrow()
  })

  test("WorkflowRunInfo carries retry lineage without exposing payloads", () => {
    const run = Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunInfo)({
      id: "run-retry",
      sessionID: "session-1",
      snapshotDigest: "a".repeat(64),
      workflowName: "review-flow",
      workflowRevision: "b".repeat(64),
      status: "recovery_required",
      revision: 3,
      parentRunID: Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunID)("run-parent"),
      rootRunID: Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunID)("run-root"),
      retryOfStepRunID: Schema.decodeUnknownSync(WorkflowAsset.StepRunID)("step-failed"),
      timeCreated: 1,
      timeUpdated: 2,
    })

    expect(String(run.parentRunID)).toBe("run-parent")
    expect(String(run.rootRunID)).toBe("run-root")
    expect(String(run.retryOfStepRunID)).toBe("step-failed")
  })

  test("StepDef input accepts only JSON objects", () => {
    const step = Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
      id: "step_1",
      name: "Build",
      agent: "builder",
      input: { nested: { enabled: true }, values: [1, "two", null] },
    })
    expect(step.input).toEqual({ nested: { enabled: true }, values: [1, "two", null] })

    for (const input of ["prompt", ["array"], null, 1]) {
      expect(() =>
        Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
          id: "step_1",
          name: "Build",
          agent: "builder",
          input,
        }),
      ).toThrow()
    }
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.StepDef)({
        id: "step_1",
        name: "Build",
        agent: "builder",
        input: { callback: () => "not-json" },
      }),
    ).toThrow()
  })

  test("BranchOutput is a strict structured result", () => {
    const decode = Schema.decodeUnknownSync(WorkflowAsset.BranchOutput, { onExcessProperty: "error" })
    expect(decode({ branch: "approved", summary: "Checks passed" })).toEqual({
      branch: "approved",
      summary: "Checks passed",
    })
    expect(() => decode({ branch: "approved", result: "legacy" })).toThrow()
    expect(() => decode({ branch: 1 })).toThrow()
    expect(() => decode({ branch: "approved", summary: "x".repeat(2_001) })).toThrow()
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

    test("rejects continue on a branch node so unresolved routing fails closed", () => {
      const steps = [
        {
          id: "step_1",
          name: "Classify",
          agent: "agent1",
          failurePolicy: "continue",
          branches: { success: "step_good", failure: "step_bad" },
        },
        { id: "step_good", name: "Good", agent: "agent2" },
        { id: "step_bad", name: "Bad", agent: "agent3" },
      ]
      const result = WorkflowAsset.validateGraph(
        steps.map((step) => Schema.decodeUnknownSync(WorkflowAsset.StepDef)(step)),
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.code === "branch_continue_forbidden")).toBe(true)
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
