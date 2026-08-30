import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowEvent } from "@aigcfroge/core/workflow/event"
import { WorkflowRunTable, WorkflowStepRunTable } from "@aigcfroge/core/workflow/sql"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import { and, eq, sql } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const databaseLayer = Database.defaultLayer
const eventLayer = EventV2.layer.pipe(Layer.provide(databaseLayer))
const workflowRunLayer = WorkflowRun.layer.pipe(Layer.provide(eventLayer), Layer.provide(databaseLayer))
const it = testEffect(Layer.mergeAll(databaseLayer, eventLayer, workflowRunLayer))

const sessionID = SessionV2.ID.make("ses_wfr_test_1")
const secondSessionID = SessionV2.ID.make("ses_wfr_test_2")

const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function seedSession(sid: string = sessionID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const columns = new Set(
      (yield* db.all<{ name: string }>(sql`PRAGMA table_info(workflow_run)`)).map((column) => column.name),
    )
    for (const name of ["request_id", "request_digest", "parent_run_id", "root_run_id", "retry_of_step_run_id"]) {
      if (!columns.has(name)) yield* db.run(sql.raw(`ALTER TABLE workflow_run ADD COLUMN ${name} text`))
    }
    yield* db.run(sql`DROP INDEX IF EXISTS workflow_run_identity_idx`)
    yield* db.run(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS workflow_run_request_idx
      ON workflow_run (session_id, request_id)
    `)
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
  it.effect("commits durable workflow events with event seq plus one equal to run revision", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_wfr_event_revision")
      const workflowService = yield* WorkflowRun.Service
      const { db } = yield* Database.Service
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_wfr_event_revision"),
        workflow: new Composition.WorkflowInfo({
          name: "event-revision",
          description: "Event revision invariant",
          relativePath: "event-revision.yaml",
          revision: mockRevision,
          steps: [
            new WorkflowAsset.StepDef({
              id: "step_event",
              name: "Event step",
              agent: "coder",
              next: "END",
            }),
          ],
        }),
      })

      const initialRows = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, run.id)).all()
      expect(initialRows).toHaveLength(1)
      expect(initialRows[0]?.type).toBe(EventV2.versionedType(WorkflowEvent.Updated.type, 1))
      expect(initialRows[0]?.seq + 1).toBe(run.revision)
      expect(initialRows[0]?.data).toEqual({
        runID: run.id,
        sessionID: run.sessionID,
        status: "pending",
        revision: 1,
        timeUpdated: run.timeUpdated,
      })

      const step = (yield* workflowService.getSteps(run.id))[0]
      const dispatching = yield* workflowService.dispatchStep({ stepRunID: step.id, expectedRevision: step.revision })
      yield* workflowService.startStep({ stepRunID: dispatching.id, expectedRevision: dispatching.revision })
      const started = yield* workflowService.get(run.id)
      const rows = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, run.id)).all()
      expect(rows).toHaveLength(3)
      expect(rows[2]?.seq + 1).toBe(started.revision)
      expect(rows[2]?.data).toEqual({
        runID: run.id,
        sessionID: run.sessionID,
        status: "running",
        revision: started.revision,
        currentStepId: "step_event",
        timeUpdated: started.timeUpdated,
      })
    }),
  )

  it.effect("rolls back workflow state and durable event when the commit fails", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_wfr_event_rollback")
      const workflowService = yield* WorkflowRun.Service
      const { db } = yield* Database.Service
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_wfr_event_rollback"),
        workflow: new Composition.WorkflowInfo({
          name: "event-rollback",
          description: "Event rollback invariant",
          relativePath: "event-rollback.yaml",
          revision: mockRevision,
          steps: [
            new WorkflowAsset.StepDef({
              id: "step_rollback",
              name: "Rollback step",
              agent: "coder",
              next: "END",
            }),
          ],
        }),
      })
      const step = (yield* workflowService.getSteps(run.id))[0]
      yield* db.run(`
        CREATE TRIGGER workflow_event_commit_failure
        BEFORE UPDATE ON workflow_step_run
        WHEN OLD.id = '${step.id}'
        BEGIN
          SELECT RAISE(ABORT, 'workflow event commit failed');
        END
      `)

      const exit = yield* workflowService
        .dispatchStep({ stepRunID: step.id, expectedRevision: step.revision })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBeTrue()
      expect((yield* workflowService.get(run.id)).revision).toBe(run.revision)
      expect((yield* workflowService.getSteps(run.id))[0]).toMatchObject({ status: "ready", revision: step.revision })
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, run.id)).all()).toHaveLength(1)
      yield* db.run("DROP TRIGGER workflow_event_commit_failure")
    }),
  )

  it.effect("allows one concurrent step CAS winner and emits one matching event", () =>
    Effect.gen(function* () {
      yield* seedSession("ses_wfr_event_cas")
      const workflowService = yield* WorkflowRun.Service
      const { db } = yield* Database.Service
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make("ses_wfr_event_cas"),
        workflow: new Composition.WorkflowInfo({
          name: "event-cas",
          description: "Concurrent CAS invariant",
          relativePath: "event-cas.yaml",
          revision: mockRevision,
          steps: [
            new WorkflowAsset.StepDef({
              id: "step_cas",
              name: "CAS step",
              agent: "coder",
              next: "END",
            }),
          ],
        }),
      })
      const step = (yield* workflowService.getSteps(run.id))[0]
      const dispatching = yield* workflowService.dispatchStep({ stepRunID: step.id, expectedRevision: step.revision })
      const exits = yield* Effect.all(
        Array.from({ length: 20 }, () =>
          workflowService
            .startStep({ stepRunID: dispatching.id, expectedRevision: dispatching.revision })
            .pipe(Effect.exit),
        ),
        { concurrency: "unbounded" },
      )

      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(19)
      const latestRun = yield* workflowService.get(run.id)
      const latestStep = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(and(eq(WorkflowStepRunTable.run_id, run.id), eq(WorkflowStepRunTable.id, step.id)))
        .get()
      const rows = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, run.id)).all()
      expect(latestRun.revision).toBe(3)
      expect(latestStep).toMatchObject({ status: "running", revision: 3 })
      expect(rows.map((row) => row.seq)).toEqual([0, 1, 2])
      expect(rows[2]?.seq + 1).toBe(latestRun.revision)
      expect(yield* db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, run.id)).get()).toMatchObject({
        revision: 3,
      })
    }),
  )

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
    }),
  )

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
      yield* workflowService.settleStep(ready[0].id, { status: "completed", outputDigest: mockRevision })

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
    }),
  )

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
        errorCategory: "step_failed",
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
    }),
  )

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

      const cancellingRun = yield* workflowService.cancelRun(run.id, "User requested cancellation")
      expect(cancellingRun.status).toBe("cancelling")
      expect(cancellingRun.errorCategory).toBe("step_cancelled")

      const cancelledRun = yield* workflowService.finalizeCancelRun({
        runID: run.id,
        expectedRevision: cancellingRun.revision,
      })
      expect(cancelledRun.status).toBe("cancelled")

      const postSteps = yield* workflowService.getSteps(run.id)
      expect(postSteps[0].status).toBe("cancelled")
      expect(postSteps[1].status).toBe("skipped")
    }),
  )

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
      yield* workflowService.settleStep(goodBranch.id, { status: "completed", outputDigest: mockRevision })

      yield* workflowService.startStep(failBranch.id)
      yield* workflowService.settleStep(failBranch.id, { status: "failed", errorCategory: "step_failed" })

      // 4. Complete run as partial_success
      const completedRun = yield* workflowService.completeRun(run.id, true)
      expect(completedRun.status).toBe("partial_success")
    }),
  )

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
        errorCategory: "step_failed",
      })

      const failedRun = yield* workflowService.failRun(run.id, "step_failed")
      expect(failedRun.status).toBe("failed")
      expect(failedRun.errorCategory).toBe("step_failed")

      const postSteps = yield* workflowService.getSteps(run.id)
      expect(postSteps[0].status).toBe("failed")
      expect(postSteps[1].status).toBe("skipped")
    }),
  )

  it.effect("recovers dispatching work back to ready without replaying provider work", () =>
    Effect.gen(function* () {
      const sid = "ses_dispatching_recovery"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const workflow = new Composition.WorkflowInfo({
        name: "dispatching-recovery",
        description: "Safe dispatch recovery",
        relativePath: "dispatching-recovery.yaml",
        revision: mockRevision,
        steps: [new WorkflowAsset.StepDef({ id: "step", name: "Step", agent: "coder", next: "END" })],
      })
      const run = yield* workflowService.create({ sessionID: SessionV2.ID.make(sid), workflow })
      const step = (yield* workflowService.getSteps(run.id))[0]

      const dispatching = yield* workflowService.dispatchStep({
        stepRunID: step.id,
        expectedRevision: step.revision,
        taskID: "task_dispatching_recovery",
        childSessionID: "child_dispatching_recovery",
      })
      expect(dispatching.status).toBe("dispatching")
      expect(dispatching.taskId).toBe("task_dispatching_recovery")

      const recovered = yield* workflowService.recoverRunning(run.id)
      const recoveredStep = recovered.find((candidate) => candidate.id === dispatching.id)
      expect(recoveredStep).toMatchObject({
        status: "ready",
        taskId: "task_dispatching_recovery",
        childSessionId: "child_dispatching_recovery",
      })
      expect((yield* workflowService.get(run.id)).status).toBe("running")
    }),
  )

  it.effect("cancels one active step without enabling automatic retry", () =>
    Effect.gen(function* () {
      const sid = "ses_step_cancel"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make(sid),
        workflow: new Composition.WorkflowInfo({
          name: "step-cancel",
          description: "Step cancellation",
          relativePath: "step-cancel.yaml",
          revision: mockRevision,
          steps: [new WorkflowAsset.StepDef({ id: "step", name: "Step", agent: "coder", next: "END" })],
        }),
      })
      const step = (yield* workflowService.getSteps(run.id))[0]
      const running = yield* workflowService.startStep(step.id)

      const cancelled = yield* workflowService.cancelStep({
        stepRunID: running.id,
        expectedRevision: running.revision,
      })
      expect(cancelled.status).toBe("cancelled")
      expect(cancelled.errorCategory).toBe("step_cancelled")
      expect((yield* workflowService.get(run.id)).status).toBe("running")

      const retry = yield* Effect.flip(
        workflowService.retryStep({ stepRunID: cancelled.id, expectedRevision: cancelled.revision }),
      )
      expect(retry._tag).toBe("WorkflowRun.InvalidStateTransitionError")
    }),
  )

  it.effect("freezes a run when provider execution is orphaned and keeps terminal state immutable", () =>
    Effect.gen(function* () {
      const sid = "ses_execution_unknown"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const workflow = new Composition.WorkflowInfo({
        name: "execution-unknown",
        description: "Unknown provider execution",
        relativePath: "execution-unknown.yaml",
        revision: mockRevision,
        steps: [new WorkflowAsset.StepDef({ id: "step", name: "Step", agent: "coder", next: "END" })],
      })
      const run = yield* workflowService.create({ sessionID: SessionV2.ID.make(sid), workflow })
      const step = (yield* workflowService.getSteps(run.id))[0]
      const dispatching = yield* workflowService.dispatchStep({ stepRunID: step.id, expectedRevision: step.revision })
      const running = yield* workflowService.startStep({
        stepRunID: dispatching.id,
        expectedRevision: dispatching.revision,
      })

      const recovered = yield* workflowService.recoverRunning(run.id)
      expect(recovered.find((candidate) => candidate.id === running.id)).toMatchObject({
        status: "execution_unknown",
        errorCategory: "execution_unknown",
      })
      const frozen = yield* workflowService.get(run.id)
      expect(frozen.status).toBe("recovery_required")
      expect(frozen.errorCategory).toBe("execution_unknown")

      const unchanged = yield* workflowService.failRun({
        runID: run.id,
        expectedRevision: frozen.revision,
        errorCategory: "step_failed",
      })
      expect(unchanged).toEqual(frozen)
      expect((yield* workflowService.getSteps(run.id))[0].status).toBe("execution_unknown")
    }),
  )

  it.effect("creates an idempotent terminal retry lineage and rejects request reuse conflicts", () =>
    Effect.gen(function* () {
      const sid = "ses_terminal_retry"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const steps = [
        new WorkflowAsset.StepDef({ id: "prepare", name: "Prepare", agent: "coder", next: "review" }),
        new WorkflowAsset.StepDef({ id: "review", name: "Review", agent: "reviewer", next: "publish" }),
        new WorkflowAsset.StepDef({ id: "publish", name: "Publish", agent: "coder", next: "END" }),
      ]
      const workflow = new Composition.WorkflowInfo({
        name: "terminal-retry",
        description: "Terminal retry lineage",
        relativePath: "terminal-retry.yaml",
        revision: mockRevision,
        steps,
      })
      const source = yield* workflowService.create({ sessionID: SessionV2.ID.make(sid), workflow })
      const prepare = (yield* workflowService.getSteps(source.id))[0]
      const runningPrepare = yield* workflowService.startStep(prepare.id)
      yield* workflowService.settleStep(runningPrepare.id, {
        expectedRevision: runningPrepare.revision,
        status: "completed",
        outputDigest: "prepare_digest",
      })
      const readyReview = (yield* workflowService.findReadySteps(source.id, steps)).find(
        (candidate) => candidate.stepId === "review",
      )!
      const runningReview = yield* workflowService.startStep(readyReview.id)
      const failedReview = yield* workflowService.settleStep(runningReview.id, {
        expectedRevision: runningReview.revision,
        status: "failed",
        errorCategory: "step_failed",
      })
      const terminal = yield* workflowService.failRun(source.id, "step_failed")

      const retried = yield* workflowService.retryRun({
        runID: source.id,
        stepRunID: failedReview.id,
        requestID: "request_terminal_retry",
        expectedRunRevision: terminal.revision,
        expectedStepRevision: failedReview.revision,
        stepsDef: steps,
      })
      expect(retried.parentRunID).toBe(source.id)
      expect(retried.rootRunID).toBe(source.id)
      expect(retried.retryOfStepRunID).toBe(failedReview.id)
      const retriedSteps = yield* workflowService.getSteps(retried.id)
      expect(retriedSteps.find((candidate) => candidate.stepId === "prepare")).toMatchObject({
        status: "completed",
        outputDigest: "prepare_digest",
      })
      expect(retriedSteps.find((candidate) => candidate.stepId === "review")?.status).toBe("ready")
      expect(retriedSteps.find((candidate) => candidate.stepId === "publish")?.status).toBe("pending")

      const exact = yield* workflowService.retryRun({
        runID: source.id,
        stepRunID: failedReview.id,
        requestID: "request_terminal_retry",
        expectedRunRevision: terminal.revision,
        expectedStepRevision: failedReview.revision,
        stepsDef: steps,
      })
      expect(exact.id).toBe(retried.id)

      const conflict = yield* Effect.flip(
        workflowService.retryRun({
          runID: source.id,
          stepRunID: failedReview.id,
          requestID: "request_terminal_retry",
          expectedRunRevision: terminal.revision,
          expectedStepRevision: failedReview.revision + 1,
          stepsDef: steps,
        }),
      )
      expect(conflict._tag).toBe("WorkflowRun.RequestConflictError")
    }),
  )

  it.effect("settles dispatching and cancelling steps when the run fails", () =>
    Effect.gen(function* () {
      const sid = "ses_fail_settles_dispatching"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const steps = [
        new WorkflowAsset.StepDef({ id: "left", name: "Left", agent: "coder", parallel: ["a", "b"] }),
        new WorkflowAsset.StepDef({ id: "a", name: "A", agent: "coder", next: "END" }),
        new WorkflowAsset.StepDef({ id: "b", name: "B", agent: "coder", next: "END" }),
      ]
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make(sid),
        workflow: new Composition.WorkflowInfo({
          name: "fail-settles",
          description: "failRun settles every dispatched step",
          relativePath: "fail-settles.yaml",
          revision: mockRevision,
          steps,
        }),
      })
      const left = (yield* workflowService.getSteps(run.id))[0]
      const running = yield* workflowService.startStep(left.id)
      yield* workflowService.settleStep(running.id, {
        expectedRevision: running.revision,
        status: "completed",
        outputDigest: "left_digest",
      })
      const ready = yield* workflowService.findReadySteps(run.id, steps)
      const stepA = ready.find((candidate) => candidate.stepId === "a")!
      const stepB = ready.find((candidate) => candidate.stepId === "b")!
      // `a` never leaves `dispatching` (interrupted between dispatch and start);
      // `b` is mid-cancel. Both are dispatched-but-unsettled.
      yield* workflowService.dispatchStep({ stepRunID: stepA.id, expectedRevision: stepA.revision })
      const runningB = yield* workflowService.startStep(stepB.id)
      yield* workflowService.cancelStep({ stepRunID: runningB.id, expectedRevision: runningB.revision })

      const failed = yield* workflowService.failRun(run.id, "step_failed")
      expect(failed.status).toBe("failed")
      const settled = yield* workflowService.getSteps(run.id)
      for (const step of settled) {
        expect({ stepId: step.stepId, status: step.status }).toMatchObject({
          stepId: step.stepId,
          status: expect.stringMatching(/^(completed|failed|cancelled|skipped)$/),
        })
      }
      expect(settled.find((candidate) => candidate.stepId === "a")?.status).toBe("cancelled")
      expect(settled.find((candidate) => candidate.stepId === "b")?.status).toBe("cancelled")
    }),
  )

  it.effect("keeps a merge step that a taken path still feeds out of the branch skip closure", () =>
    Effect.gen(function* () {
      const sid = "ses_diamond_skip"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      // fan -> [classify, other]; classify branches to armA|armB; armB -> join; other -> join.
      // Picking armA must not skip `join`, because `other` is still a live predecessor.
      const steps = [
        new WorkflowAsset.StepDef({ id: "fan", name: "Fan", agent: "coder", parallel: ["classify", "other"] }),
        new WorkflowAsset.StepDef({
          id: "classify",
          name: "Classify",
          agent: "coder",
          branches: { a: "armA", b: "armB" },
        }),
        new WorkflowAsset.StepDef({ id: "other", name: "Other", agent: "coder", next: "join" }),
        new WorkflowAsset.StepDef({ id: "armA", name: "Arm A", agent: "coder", next: "END" }),
        new WorkflowAsset.StepDef({ id: "armB", name: "Arm B", agent: "coder", next: "join" }),
        new WorkflowAsset.StepDef({ id: "join", name: "Join", agent: "coder", next: "END" }),
      ]
      const run = yield* workflowService.create({
        sessionID: SessionV2.ID.make(sid),
        workflow: new Composition.WorkflowInfo({
          name: "diamond-skip",
          description: "Skip closure respects live predecessors",
          relativePath: "diamond-skip.yaml",
          revision: mockRevision,
          steps,
        }),
      })
      const complete = (stepRunID: WorkflowAsset.StepRunID, options?: { branchTarget?: string }) =>
        Effect.gen(function* () {
          const running = yield* workflowService.startStep(stepRunID)
          return yield* workflowService.settleStep(running.id, {
            expectedRevision: running.revision,
            status: "completed",
            ...(options?.branchTarget ? { branchTarget: options.branchTarget } : {}),
          })
        })

      yield* complete((yield* workflowService.getSteps(run.id))[0].id)
      const afterFan = yield* workflowService.findReadySteps(run.id, steps)
      yield* complete(afterFan.find((candidate) => candidate.stepId === "classify")!.id, { branchTarget: "armA" })
      yield* complete(afterFan.find((candidate) => candidate.stepId === "other")!.id)

      const frontier = yield* workflowService.findReadySteps(run.id, steps)
      const byStep = new Map((yield* workflowService.getSteps(run.id)).map((step) => [step.stepId, step]))
      expect(byStep.get("armB")?.status).toBe("skipped")
      expect(byStep.get("join")?.status).not.toBe("skipped")
      expect(frontier.map((candidate) => candidate.stepId).sort()).toEqual(["armA", "join"])
    }),
  )

  it.effect("dedupes run identity against the active run only, never a terminal one", () =>
    Effect.gen(function* () {
      const sid = "ses_identity_active_only"
      yield* seedSession(sid)
      const workflowService = yield* WorkflowRun.Service
      const workflow = new Composition.WorkflowInfo({
        name: "identity-active",
        description: "Identity dedupe skips terminal runs",
        relativePath: "identity-active.yaml",
        revision: mockRevision,
        steps: [new WorkflowAsset.StepDef({ id: "only", name: "Only", agent: "coder", next: "END" })],
      })
      const first = yield* workflowService.getOrCreate({ sessionID: SessionV2.ID.make(sid), workflow })
      const same = yield* workflowService.getOrCreate({ sessionID: SessionV2.ID.make(sid), workflow })
      expect(same.id).toBe(first.id)

      yield* workflowService.failRun(first.id, "step_failed")
      const afterTerminal = yield* workflowService.getOrCreate({ sessionID: SessionV2.ID.make(sid), workflow })
      expect(afterTerminal.id).not.toBe(first.id)
      expect(afterTerminal.status).toBe("pending")
    }),
  )
})
