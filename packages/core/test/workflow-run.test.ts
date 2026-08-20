import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, WorkflowRun.defaultLayer))

const sessionID = SessionV2.ID.make("ses_wfr_test_1")
const secondSessionID = SessionV2.ID.make("ses_wfr_test_2")

const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function seedSession(sid: string = sessionID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projectID = Project.ID.make("prj_wfr_test")
    yield* db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: AbsolutePath.make("/project"),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: SessionV2.ID.make(sid),
        project_id: projectID,
        slug: sid,
        directory: "/project",
        title: "Workflow Session",
        mode: "custom",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })
}

describe("WorkflowRun Service", () => {
  it.effect("creates a workflow run and seeds initial step runs", () =>
    Effect.gen(function* () {
      yield* seedSession()
      const workflowService = yield* WorkflowRun.Service

      const workflowInfo = new Composition.WorkflowInfo({
        name: "code-and-review",
        description: "Two step workflow",
        relativePath: "pipeline.yaml",
        revision: mockRevision,
        steps: [
          new WorkflowAsset.StepDef({
            id: "step_code",
            name: "Coding",
            agent: "coder",
            next: "step_review",
          }),
          new WorkflowAsset.StepDef({
            id: "step_review",
            name: "Review",
            agent: "reviewer",
            next: "END",
          }),
        ],
      })

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make(sessionID),
        workflow: workflowInfo,
      })

      expect(run.id).toBeDefined()
      expect(run.workflowName).toBe("code-and-review")
      expect(run.status).toBe("pending")

      const steps = yield* workflowService.getSteps(run.id)
      expect(steps).toHaveLength(2)
      expect(steps[0].stepId).toBe("step_code")
      expect(steps[0].status).toBe("ready")
      expect(steps[1].stepId).toBe("step_review")
      expect(steps[1].status).toBe("pending")
    }))

  it.effect("finds ready steps across linear, parallel, and branching workflows", () =>
    Effect.gen(function* () {
      yield* seedSession(secondSessionID)
      const workflowService = yield* WorkflowRun.Service

      // Parallel workflow: start -> [branch_a, branch_b] -> merge
      const parallelSteps: WorkflowAsset.StepDef[] = [
        new WorkflowAsset.StepDef({
          id: "start",
          name: "Start",
          agent: "coder",
          parallel: ["branch_a", "branch_b"],
        }),
        new WorkflowAsset.StepDef({
          id: "branch_a",
          name: "Branch A",
          agent: "coder",
          next: "merge",
        }),
        new WorkflowAsset.StepDef({
          id: "branch_b",
          name: "Branch B",
          agent: "coder",
          next: "merge",
        }),
        new WorkflowAsset.StepDef({
          id: "merge",
          name: "Merge",
          agent: "reviewer",
          next: "END",
        }),
      ]

      const workflowInfo = new Composition.WorkflowInfo({
        name: "parallel-flow",
        description: "Parallel fan-out and merge",
        relativePath: "parallel.yaml",
        revision: mockRevision,
        steps: parallelSteps,
      })

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make(secondSessionID),
        workflow: workflowInfo,
      })

      // 1. Initial ready step should only be "start"
      let ready = yield* workflowService.findReadySteps(run.id, parallelSteps)
      expect(ready).toHaveLength(1)
      expect(ready[0].stepId).toBe("start")

      // 2. Start and settle "start" -> "branch_a" and "branch_b" should become ready
      yield* workflowService.startStep(ready[0].id)
      yield* workflowService.settleStep(ready[0].id, { status: "completed", output: { ok: true } })

      ready = yield* workflowService.findReadySteps(run.id, parallelSteps)
      expect(ready).toHaveLength(2)
      const readyIds = ready.map((r) => r.stepId).sort()
      expect(readyIds).toEqual(["branch_a", "branch_b"])

      // 3. Complete "branch_a" only -> "merge" should NOT be ready yet
      const stepA = ready.find((r) => r.stepId === "branch_a")!
      const stepB = ready.find((r) => r.stepId === "branch_b")!

      yield* workflowService.startStep(stepA.id)
      yield* workflowService.settleStep(stepA.id, { status: "completed" })

      ready = yield* workflowService.findReadySteps(run.id, parallelSteps)
      // Only branch_b remains ready
      expect(ready).toHaveLength(1)
      expect(ready[0].stepId).toBe("branch_b")

      // 4. Complete "branch_b" -> "merge" should become ready
      yield* workflowService.startStep(stepB.id)
      yield* workflowService.settleStep(stepB.id, { status: "completed" })

      ready = yield* workflowService.findReadySteps(run.id, parallelSteps)
      expect(ready).toHaveLength(1)
      expect(ready[0].stepId).toBe("merge")

      // 5. Complete "merge" -> complete run
      yield* workflowService.startStep(ready[0].id)
      yield* workflowService.settleStep(ready[0].id, { status: "completed" })

      const completedRun = yield* workflowService.completeRun(run.id)
      expect(completedRun.status).toBe("completed")
    }))

  it.effect("handles step retry with incremented attempt number", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_retry_test")
      const workflowService = yield* WorkflowRun.Service

      const steps: WorkflowAsset.StepDef[] = [
        new WorkflowAsset.StepDef({
          id: "step_flaky",
          name: "Flaky Step",
          agent: "coder",
          next: "END",
          maxAttempts: 3,
        }),
      ]

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_retry_test"),
        workflow: new Composition.WorkflowInfo({
          name: "retry-flow",
          description: "Retry test",
          relativePath: "retry.yaml",
          revision: mockRevision,
          steps,
        }),
      })

      const initialSteps = yield* workflowService.getSteps(run.id)
      expect(initialSteps[0].attempt).toBe(1)

      // Start attempt 1 and fail it
      yield* workflowService.startStep(initialSteps[0].id)
      yield* workflowService.settleStep(initialSteps[0].id, {
        status: "failed",
        error: "transient network error",
      })

      // Retry step
      const retriedStep = yield* workflowService.retryStep(initialSteps[0].id)
      expect(retriedStep.attempt).toBe(2)
      expect(retriedStep.status).toBe("ready")

      // Check all step runs
      const allSteps = yield* workflowService.getSteps(run.id)
      expect(allSteps).toHaveLength(2)
      expect(allSteps[0].attempt).toBe(1)
      expect(allSteps[0].status).toBe("failed")
      expect(allSteps[1].attempt).toBe(2)
      expect(allSteps[1].status).toBe("ready")
    }))

  it.effect("cancels run and marks all pending/ready/running steps as cancelled", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_cancel_test")
      const workflowService = yield* WorkflowRun.Service

      const steps: WorkflowAsset.StepDef[] = [
        new WorkflowAsset.StepDef({
          id: "step_1",
          name: "Step 1",
          agent: "coder",
          next: "step_2",
        }),
        new WorkflowAsset.StepDef({
          id: "step_2",
          name: "Step 2",
          agent: "reviewer",
          next: "END",
        }),
      ]

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_cancel_test"),
        workflow: new Composition.WorkflowInfo({
          name: "cancel-flow",
          description: "Cancel test",
          relativePath: "cancel.yaml",
          revision: mockRevision,
          steps,
        }),
      })

      const initialSteps = yield* workflowService.getSteps(run.id)
      yield* workflowService.startStep(initialSteps[0].id)

      const cancelledRun = yield* workflowService.cancelRun(run.id, "User requested cancellation")
      expect(cancelledRun.status).toBe("cancelled")
      expect(cancelledRun.error).toBe("User requested cancellation")

      const postSteps = yield* workflowService.getSteps(run.id)
      expect(postSteps[0].status).toBe("cancelled")
      expect(postSteps[1].status).toBe("cancelled")
    }))

  it.effect("handles failurePolicy continue and completes as partial_success", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_partial_test")
      const workflowService = yield* WorkflowRun.Service

      const steps: WorkflowAsset.StepDef[] = [
        new WorkflowAsset.StepDef({
          id: "start",
          name: "Start",
          agent: "coder",
          parallel: ["branch_ok", "branch_fail"],
        }),
        new WorkflowAsset.StepDef({
          id: "branch_ok",
          name: "Good Branch",
          agent: "coder",
          next: "END",
        }),
        new WorkflowAsset.StepDef({
          id: "branch_fail",
          name: "Optional Failing Branch",
          agent: "coder",
          failurePolicy: "continue",
          next: "END",
        }),
      ]

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_partial_test"),
        workflow: new Composition.WorkflowInfo({
          name: "partial-flow",
          description: "Partial success test",
          relativePath: "partial.yaml",
          revision: mockRevision,
          steps,
        }),
      })

      // 1. Complete start
      let ready = yield* workflowService.findReadySteps(run.id, steps)
      yield* workflowService.startStep(ready[0].id)
      yield* workflowService.settleStep(ready[0].id, { status: "completed" })

      // 2. Both branches become ready
      ready = yield* workflowService.findReadySteps(run.id, steps)
      expect(ready).toHaveLength(2)

      const goodBranch = ready.find((r) => r.stepId === "branch_ok")!
      const failBranch = ready.find((r) => r.stepId === "branch_fail")!

      // 3. Complete good branch, fail optional branch
      yield* workflowService.startStep(goodBranch.id)
      yield* workflowService.settleStep(goodBranch.id, { status: "completed", output: { result: "ok" } })

      yield* workflowService.startStep(failBranch.id)
      yield* workflowService.settleStep(failBranch.id, { status: "failed", error: "non-critical failure" })

      // 4. Complete run as partial_success
      const completedRun = yield* workflowService.completeRun(run.id, true)
      expect(completedRun.status).toBe("partial_success")
    }))

  it.effect("handles failurePolicy abort and marks run as failed", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_abort_test")
      const workflowService = yield* WorkflowRun.Service

      const steps: WorkflowAsset.StepDef[] = [
        new WorkflowAsset.StepDef({
          id: "step_1",
          name: "Step 1",
          agent: "coder",
          failurePolicy: "abort",
          next: "step_2",
        }),
        new WorkflowAsset.StepDef({
          id: "step_2",
          name: "Step 2",
          agent: "reviewer",
          next: "END",
        }),
      ]

      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_abort_test"),
        workflow: new Composition.WorkflowInfo({
          name: "abort-flow",
          description: "Abort test",
          relativePath: "abort.yaml",
          revision: mockRevision,
          steps,
        }),
      })

      const initialSteps = yield* workflowService.getSteps(run.id)
      yield* workflowService.startStep(initialSteps[0].id)
      yield* workflowService.settleStep(initialSteps[0].id, {
        status: "failed",
        error: "fatal compile error",
      })

      const failedRun = yield* workflowService.failRun(run.id, "Step 1 failed with fatal compile error")
      expect(failedRun.status).toBe("failed")
      expect(failedRun.error).toBe("Step 1 failed with fatal compile error")

      const postSteps = yield* workflowService.getSteps(run.id)
      expect(postSteps[0].status).toBe("failed")
      expect(postSteps[1].status).toBe("pending")
    }))
})
