import { describe, expect, test } from "bun:test"
import { Schema, SchemaRepresentation } from "effect"
import { WorkflowAsset } from "../src/workflow-asset.js"

describe("WorkflowAsset Schema M2", () => {
  test("minimal workflow step JSON omits absent options and preserves defaults", () => {
    const step = Schema.decodeUnknownSync(WorkflowAsset.StepDef)({ id: "review", name: "Review", agent: "coder" })
    const encoded = Schema.encodeSync(Schema.toCodecJson(WorkflowAsset.StepDef))(step)
    expect(encoded).toEqual({
      id: "review",
      name: "Review",
      agent: "coder",
      input: {},
      failurePolicy: "abort",
      maxAttempts: 1,
    })
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.StepDef))(encoded)).toEqual(step)
  })

  test("workflow declaration JSON preserves raw content and nested step options", () => {
    const content = "\uFEFF# original YAML\n" + "x".repeat(100_001)
    const info = Schema.decodeUnknownSync(WorkflowAsset.Info)({
      kind: "workflow",
      name: "review",
      description: "Review",
      relativePath: "review.yaml",
      revision: "a".repeat(64),
      content,
      version: "1",
      triggers: [],
      steps: [
        {
          id: "review",
          name: "Review",
          agent: "coder",
          input: { nested: [true, null, { text: "keep" }] },
          branches: { yes: "END" },
          timeoutSeconds: 30,
        },
      ],
    })
    const encoded = Schema.encodeSync(Schema.toCodecJson(WorkflowAsset.Info))(info)
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(WorkflowAsset.Info))(encoded)).toEqual(info)
    expect(info.content).toBe(content)
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.Candidate)({ name: "review", description: "Review", content }),
    ).toThrow()
  })

  test("workflow frontmatter uses the same identity limits as public assets", () => {
    const value = { kind: "workflow", name: "review", description: "Review", version: "1", steps: [] }
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.Frontmatter)({ ...value, name: "x".repeat(81) })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.Frontmatter)({ ...value, description: "x".repeat(301) }),
    ).toThrow()
  })

  test("workflow candidate omits the optional target and retains an explicit null revision", () => {
    const candidate = WorkflowAsset.Candidate.make({
      name: WorkflowAsset.Name.make("review"),
      description: WorkflowAsset.Description.make("Review"),
      content: WorkflowAsset.Content.make("source"),
    })
    expect(Schema.encodeSync(Schema.toCodecJson(WorkflowAsset.Candidate))(candidate)).toEqual({
      name: "review",
      description: "Review",
      content: "source",
    })
    expect(Schema.decodeUnknownSync(WorkflowAsset.BaseRevision)(null)).toBeNull()
    expect(() => Schema.decodeUnknownSync(WorkflowAsset.BaseRevision)("invalid")).toThrow()
  })

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

  test("workflow status omits an undefined run from the JSON contract", () => {
    const response = new WorkflowAsset.WorkflowStatusResponse({ run: undefined, steps: [] })
    expect(Schema.encodeSync(Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse))(response)).toEqual({ steps: [] })
  })

  test("workflow run and step JSON omit undefined fields and preserve their decoded values", () => {
    const run = new WorkflowAsset.WorkflowRunInfo({
      id: WorkflowAsset.WorkflowRunID.make("run-json"),
      sessionID: "session-json",
      snapshotDigest: "a".repeat(64),
      workflowName: "review",
      workflowRevision: "b".repeat(64),
      status: "pending",
      revision: 1,
      parentRunID: undefined,
      rootRunID: undefined,
      retryOfStepRunID: undefined,
      currentStepId: undefined,
      errorCategory: undefined,
      timeCreated: 1,
      timeUpdated: 1,
      timeCompleted: undefined,
    })
    const step = new WorkflowAsset.StepRunInfo({
      id: WorkflowAsset.StepRunID.make("step-json"),
      runId: run.id,
      stepId: "review",
      agentId: "coder",
      status: "ready",
      attempt: 1,
      revision: 1,
      taskId: undefined,
      childSessionId: undefined,
      inputDigest: undefined,
      outputDigest: undefined,
      branchTarget: undefined,
      errorCategory: undefined,
      timeCreated: 1,
      timeStarted: undefined,
      timeCompleted: undefined,
    })
    const response = new WorkflowAsset.WorkflowStatusResponse({ run, steps: [step] })
    const codec = Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse)
    const encoded = Schema.encodeSync(WorkflowAsset.WorkflowStatusResponse)(response)
    expect(Schema.encodeSync(codec)(response)).toEqual(encoded)
    expect(encoded.run).toEqual({
      id: run.id,
      sessionID: run.sessionID,
      snapshotDigest: run.snapshotDigest,
      workflowName: run.workflowName,
      workflowRevision: run.workflowRevision,
      status: run.status,
      revision: run.revision,
      timeCreated: run.timeCreated,
      timeUpdated: run.timeUpdated,
    })
    expect(encoded.steps).toEqual([
      {
        id: step.id,
        runId: step.runId,
        stepId: step.stepId,
        agentId: step.agentId,
        status: step.status,
        attempt: step.attempt,
        revision: step.revision,
        timeCreated: step.timeCreated,
      },
    ])
    expect(Schema.decodeUnknownSync(codec)(encoded)).toEqual(response)
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
    expect(decode({ branch: "approved", summary: "😀".repeat(1_001) }).summary).toBe("😀".repeat(1_001))
    expect(decode({ branch: "approved", summary: "😀".repeat(2_000) }).summary).toBe("😀".repeat(2_000))
    expect(() => decode({ branch: "approved", summary: "😀".repeat(2_001) })).toThrow()
  })

  test("BranchOutput preserves its codepoint limit through representation persistence and codegen", () => {
    const encoded = Schema.toEncoded(WorkflowAsset.BranchOutput)
    const persisted = SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(encoded.ast))
    const restored = SchemaRepresentation.fromRepresentation(SchemaRepresentation.fromJson(persisted), {
      revivers: [SchemaRepresentation.isMaxCodePointsReviver],
    })
    const decode = Schema.decodeUnknownSync(Schema.make<Schema.Codec<unknown>>(restored.ast))
    const summaries = [
      "x".repeat(WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS),
      "😀".repeat(WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS),
      "e\u0301".repeat(WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS / 2),
      "\ud800".repeat(WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS),
    ]
    for (const summary of summaries) {
      expect(decode({ branch: "approved", summary })).toEqual({ branch: "approved", summary })
      expect(() => decode({ branch: "approved", summary: `${summary}x` })).toThrow()
    }

    const document = SchemaRepresentation.toCodeDocument(SchemaRepresentation.toRepresentations([encoded.ast]))
    const runtime = [
      ...document.codes.map((code) => code.runtime),
      ...document.references.nonRecursives.map((reference) => reference.code.runtime),
    ].join("\n")
    expect(runtime).toContain(`Schema.isMaxCodePoints(${WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS})`)
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
