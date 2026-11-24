import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Exit, Schema, Stream } from "effect"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionTable } from "@omnixa/core/session/sql"
import { WorkflowRunTable, WorkflowStepRunTable } from "@omnixa/core/workflow/sql"
import { WorkflowRun } from "@omnixa/core/workflow/workflow-run"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionTask } from "@omnixa/core/session/task"
import { Agent } from "@omnixa/core/agent"
import { Composition } from "@omnixa/schema/composition"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Updated } from "@omnixa/schema/workflow-event"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { CompositionFixture } from "./lib/composition"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([WorkflowRun.node, SessionComposition.node, SessionTask.node, Database.node, Bus.node]),
    [
      Database.node.replace(Database.configured({ path: ":memory:" })),
      Bus.node.replace(Bus.configured({ persist: true })),
    ],
  ),
)

const step = (id: string, fields: Partial<WorkflowAsset.StepDef> = {}) =>
  new WorkflowAsset.StepDef({ id, name: id, agent: "coder", ...fields })

const setup = Effect.fnUntraced(function* (steps: readonly WorkflowAsset.StepDef[] = [step("worker")]) {
  const database = yield* Database.Service
  const runs = yield* WorkflowRun.Service
  const sessionID = Session.ID.make("ses_workflow_events")
  const projectID = Project.ID.make("workflow_events")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/workflow/events"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "workflow-events",
      directory: AbsolutePath.make("/workflow/events"),
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  const workflow = new Composition.WorkflowInfo({
    name: "events",
    description: "Owner transaction regression",
    relativePath: "events.yaml",
    revision: Composition.Revision.make("a".repeat(64)),
    steps,
  })
  const run = yield* runs.create({ sessionID, workflow })
  return { database, runs, run, workflow, steps: yield* runs.getSteps(run.id) }
})

const started = Effect.fnUntraced(function* (steps: readonly WorkflowAsset.StepDef[] = [step("worker")]) {
  const fixture = yield* setup(steps)
  const first = fixture.steps.at(0)
  if (!first) return yield* Effect.die(new Error("Workflow fixture has no first Step"))
  const running = yield* fixture.runs.startStep(first.id, first.revision)
  return { ...fixture, running }
})

const mixed = Effect.fnUntraced(function* () {
  const fixture = yield* started([step("worker", { next: "blocked" }), step("staged"), step("ready"), step("blocked")])
  const ready = yield* fixture.runs.findReadySteps(fixture.run.id, fixture.workflow.steps)
  const staged = ready.find((candidate) => candidate.stepId === "staged")
  if (!staged) return yield* Effect.die(new Error("Workflow fixture has no staged Step"))
  yield* fixture.runs.dispatchStep({ stepRunID: staged.id, expectedRevision: staged.revision })
  return fixture
})

const log = Effect.fnUntraced(function* (runID: WorkflowAsset.WorkflowRunID) {
  const bus = yield* Bus.Service
  const entries = yield* bus.log({ aggregateID: runID }).pipe(Stream.runCollect)
  return entries
    .filter((event) => !Bus.isSynced(event))
    .map((event) => Schema.decodeUnknownSync(Schema.toType(Updated))(event))
})

const snapshot = Effect.fnUntraced(function* (runID: WorkflowAsset.WorkflowRunID) {
  const database = yield* Database.Service
  return {
    run: yield* database.db
      .select()
      .from(WorkflowRunTable)
      .where(eq(WorkflowRunTable.id, runID))
      .get()
      .pipe(Effect.orDie),
    steps: yield* database.db
      .select()
      .from(WorkflowStepRunTable)
      .where(eq(WorkflowStepRunTable.run_id, runID))
      .orderBy(WorkflowStepRunTable.id)
      .all()
      .pipe(Effect.orDie),
    sequence: yield* database.db
      .select()
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, runID))
      .get()
      .pipe(Effect.orDie),
    events: yield* database.db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, runID))
      .orderBy(EventTable.seq)
      .all()
      .pipe(Effect.orDie),
  }
})

const observe = Effect.fnUntraced(function* (runID: WorkflowAsset.WorkflowRunID) {
  const bus = yield* Bus.Service
  const revisions: number[] = []
  const unsubscribe = yield* bus.listen((event) =>
    Effect.sync(() => {
      if (event.type !== Updated.type) return
      const update = Schema.decodeUnknownSync(Schema.toType(Updated))(event)
      if (update.data.runID === runID) revisions.push(update.data.revision)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return revisions
})

describe("Workflow Run owner events", () => {
  it.effect("MC08 W2 commits one complete frozen admission and keeps exact request conflicts immutable", () =>
    Effect.gen(function* () {
      const fixture = yield* setup([
        step("A", { input: { value: "published" }, next: "B" }),
        step("B", { next: "END" }),
      ])
      const cancelled = yield* fixture.runs.cancelRun(fixture.run.id)
      yield* fixture.runs.finalizeCancelRun({ runID: cancelled.id })
      const policy = yield* CompositionFixture.attach(
        Session.ID.make(fixture.run.sessionID),
        Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("coder")), mode: "subagent" }),
      )
      const frozen = new Composition.SnapshotV2({
        ...policy,
        data: new Composition.SnapshotDataV2({ ...policy.data, workflow: fixture.workflow }),
      })
      const tasks = yield* SessionTask.Service
      const parentTask = (yield* tasks.append({
        sessionID: Session.ID.make(fixture.run.sessionID),
        tasks: [{ content: "Actual workflow Task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!parentTask) return yield* Effect.die(new Error("Missing actual parent Task"))
      const binding = new WorkflowRun.TaskBinding({
        parentTaskID: parentTask.id,
        parentTaskRevision: parentTask.revision,
        source: { type: "tool", messageID: "msg_mc08_w2", id: "actual-call" },
      })
      const bus = yield* Bus.Service
      const observed: { snapshot: string | null; binding: string | null; steps: number }[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Updated.type) return
          const update = Schema.decodeUnknownSync(Schema.toType(Updated))(event)
          if (update.data.sessionID !== fixture.run.sessionID || update.data.status !== "pending") return
          const row = yield* fixture.database.db
            .select()
            .from(WorkflowRunTable)
            .where(eq(WorkflowRunTable.id, update.data.runID))
            .get()
            .pipe(Effect.orDie)
          if (row)
            observed.push({
              snapshot: row.frozen_snapshot,
              binding: row.task_binding,
              steps: (yield* fixture.runs.getSteps(row.id)).length,
            })
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const input = {
        sessionID: Session.ID.make(fixture.run.sessionID),
        workflow: fixture.workflow,
        snapshotDigest: frozen.digest,
        frozenSnapshot: frozen,
        taskBinding: binding,
        requestID: "mc08-w2",
      }
      const run = yield* fixture.runs.getOrCreate(input)
      expect(observed).toEqual([
        {
          snapshot: Schema.encodeSync(Schema.fromJsonString(Composition.SnapshotV2))(frozen),
          binding: Schema.encodeSync(Schema.fromJsonString(WorkflowRun.TaskBinding))(binding),
          steps: 2,
        },
      ])
      expect(Object.hasOwn(run, "frozenSnapshot")).toBe(false)
      expect(Object.hasOwn(run, "taskBinding")).toBe(false)
      expect(run).toMatchObject({ source: binding.source, parentTaskID: binding.parentTaskID })
      const before = yield* snapshot(run.id)
      expect(yield* fixture.runs.getOrCreate(input)).toEqual(run)
      const receipt = yield* fixture.runs.byRequest(input.sessionID, input.requestID)
      expect(receipt?.run).toEqual(run)
      expect(receipt?.snapshot?.data).toEqual(frozen.data)
      expect(receipt?.taskBinding).toEqual(binding)
      for (const changed of [
        {
          ...input,
          taskBinding: new WorkflowRun.TaskBinding({ ...binding, source: { ...binding.source, id: "other-call" } }),
        },
        { ...input, taskBinding: new WorkflowRun.TaskBinding({ ...binding, parentTaskID: "tsk_other" }) },
        {
          ...input,
          frozenSnapshot: new Composition.SnapshotV2({ ...frozen, digest: Composition.Digest.make("b".repeat(64)) }),
          snapshotDigest: Composition.Digest.make("b".repeat(64)),
        },
      ])
        expect(yield* fixture.runs.getOrCreate(changed).pipe(Effect.flip)).toMatchObject({
          _tag: "WorkflowRun.RequestConflictError",
        })
      expect(yield* snapshot(run.id)).toEqual(before)
      expect(yield* fixture.runs.admission(Session.ID.make("ses_other"), run.id).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRun.WorkflowNotFoundError",
      })
      const first = (yield* fixture.runs.getSteps(run.id))[0]
      if (!first) return yield* Effect.die(new Error("Missing first frozen step"))
      const running = yield* fixture.runs.startStep(first.id)
      const failed = yield* fixture.runs.settleStep({
        stepRunID: running.id,
        status: "failed",
        errorCategory: "step_failed",
      })
      const source = yield* fixture.runs.failRun(run.id)
      const retry = {
        sessionID: input.sessionID,
        runID: source.id,
        stepRunID: failed.id,
        expectedRunRevision: source.revision,
        expectedStepRevision: failed.revision,
        requestID: "mc08-w2-retry",
        stepsDef: fixture.workflow.steps,
      }
      expect(yield* fixture.runs.retryRun(retry).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
        reason: "workflow_task_retry_requires_new_source",
      })
      const nextTask = (yield* tasks.append({
        sessionID: input.sessionID,
        tasks: [{ content: "Actual retry Task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!nextTask) return yield* Effect.die(new Error("Missing retry Task"))
      const nextBinding = new WorkflowRun.TaskBinding({
        parentTaskID: nextTask.id,
        parentTaskRevision: nextTask.revision,
        source: { type: "tool", messageID: "msg_mc08_w2_retry", id: "retry-call" },
      })
      const retried = yield* fixture.runs.retryRun({ ...retry, taskBinding: nextBinding })
      const inherited = yield* fixture.runs.admission(input.sessionID, retried.id)
      expect(inherited.snapshot?.data).toEqual(frozen.data)
      expect(inherited.taskBinding).toEqual(nextBinding)
      expect(inherited.run).toMatchObject({ source: nextBinding.source, parentTaskID: nextBinding.parentTaskID })
      expect(inherited.run.parentRunID).toBe(run.id)
      expect((yield* fixture.runs.getSteps(retried.id)).map((step) => step.inputDigest)).toEqual(
        fixture.steps.map((step) => step.inputDigest),
      )
      expect(yield* fixture.runs.retryRun({ ...retry, taskBinding: nextBinding })).toEqual(retried)
      yield* fixture.database.db
        .update(WorkflowRunTable)
        .set({ frozen_snapshot: "{}" })
        .where(eq(WorkflowRunTable.id, retried.id))
        .run()
        .pipe(Effect.orDie)
      expect(yield* fixture.runs.admission(input.sessionID, retried.id).pipe(Effect.flip)).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
        reason: "workflow_frozen_admission_invalid",
      })
    }),
  )

  it.effect("MC08 W2 rolls back run steps and both private columns when admission commit fails", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const cancelled = yield* fixture.runs.cancelRun(fixture.run.id)
      yield* fixture.runs.finalizeCancelRun({ runID: cancelled.id })
      const policy = yield* CompositionFixture.attach(
        Session.ID.make(fixture.run.sessionID),
        Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("coder")), mode: "subagent" }),
      )
      const frozen = new Composition.SnapshotV2({
        ...policy,
        data: new Composition.SnapshotDataV2({ ...policy.data, workflow: fixture.workflow }),
      })
      yield* fixture.database.db
        .run(
          sql`CREATE TEMP TRIGGER mc08_w2_fail_step BEFORE INSERT ON workflow_step_run BEGIN SELECT RAISE(ABORT, 'MC08 W2 admission step failure'); END`,
        )
        .pipe(Effect.orDie)
      const attempted = yield* fixture.runs
        .getOrCreate({
          sessionID: Session.ID.make(fixture.run.sessionID),
          workflow: fixture.workflow,
          snapshotDigest: frozen.digest,
          frozenSnapshot: frozen,
          taskBinding: new WorkflowRun.TaskBinding({
            parentTaskID: "tsk_bound",
            parentTaskRevision: 1,
            source: { type: "tool", messageID: "msg_atomic", id: "atomic" },
          }),
          requestID: "atomic",
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(attempted)).toBe(true)
      expect(yield* fixture.runs.byRequest(Session.ID.make(fixture.run.sessionID), "atomic")).toBeUndefined()
      expect(
        (yield* fixture.database.db.select().from(WorkflowRunTable).all().pipe(Effect.orDie)).map((row) => row.id),
      ).toEqual([fixture.run.id])
      expect(
        (yield* fixture.database.db.select().from(WorkflowStepRunTable).all().pipe(Effect.orDie)).map((row) => row.id),
      ).toEqual(fixture.steps.map((step) => step.id))
    }),
  )

  it.effect("keeps live and retained Run fields equal to GET across interleaved dispatch/start", () =>
    Effect.gen(function* () {
      const fixture = yield* setup([step("A"), step("B")])
      const ready = yield* fixture.runs.findReadySteps(fixture.run.id, fixture.workflow.steps)
      const first = ready.find((candidate) => candidate.stepId === "A")
      const second = ready.find((candidate) => candidate.stepId === "B")
      if (!first || !second) return yield* Effect.die(new Error("Workflow fixture has no parallel frontier"))
      const bus = yield* Bus.Service
      const live: Schema.Schema.Type<typeof Updated>[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type !== Updated.type) return
          const update = Schema.decodeUnknownSync(Schema.toType(Updated))(event)
          if (update.data.runID === fixture.run.id) live.push(update)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const verify = Effect.fnUntraced(function* (currentStepId: string | undefined) {
        const current = yield* fixture.runs.get(fixture.run.id)
        const retained = (yield* log(fixture.run.id)).at(-1)
        if (!retained) return yield* Effect.die(new Error("Workflow revision has no retained owner event"))
        const expected = {
          runID: current.id,
          sessionID: current.sessionID,
          status: current.status,
          revision: current.revision,
          currentStepId: current.currentStepId,
          errorCategory: current.errorCategory,
          timeUpdated: current.timeUpdated,
        }
        expect(current.currentStepId).toBe(currentStepId)
        expect(retained.data).toEqual(expected)
        expect(retained.durable.seq + 1).toBe(current.revision)
        if (current.revision > fixture.run.revision) expect(live.at(-1)?.data).toEqual(expected)
        return current
      })

      yield* verify(undefined)
      const dispatchedA = yield* fixture.runs.dispatchStep({ stepRunID: first.id, expectedRevision: first.revision })
      yield* verify("A")
      const dispatchedB = yield* fixture.runs.dispatchStep({ stepRunID: second.id, expectedRevision: second.revision })
      yield* verify("B")
      const runningA = yield* fixture.runs.startStep({
        stepRunID: dispatchedA.id,
        expectedRevision: dispatchedA.revision,
      })
      yield* verify("A")
      yield* fixture.runs.startStep({ stepRunID: dispatchedB.id, expectedRevision: dispatchedB.revision })
      const running = yield* verify("B")
      yield* fixture.runs.cancelStep({
        stepRunID: runningA.id,
        runID: running.id,
        expectedRevision: runningA.revision,
        expectedRunRevision: running.revision,
      })
      const cancelled = yield* verify("B")
      yield* fixture.runs.requireRecovery({ runID: cancelled.id, expectedRevision: cancelled.revision })
      yield* verify("B")
      expect((yield* log(fixture.run.id)).map((event) => [event.data.revision, event.data.currentStepId])).toEqual([
        [1, undefined],
        [2, "A"],
        [3, "B"],
        [4, "A"],
        [5, "B"],
        [6, "B"],
        [7, "B"],
      ])
      expect(live.map((event) => event.data.revision)).toEqual([2, 3, 4, 5, 6, 7])
      expect(
        Object.fromEntries((yield* fixture.runs.getSteps(fixture.run.id)).map((item) => [item.stepId, item.status])),
      ).toEqual({
        A: "cancelled",
        B: "execution_unknown",
      })
    }),
  )

  it.effect("persists settlement and completion after dispatch/start in the same Run log", () =>
    Effect.gen(function* () {
      const fixture = yield* started()
      const published = yield* observe(fixture.run.id)
      const settled = yield* fixture.runs.settleStep({
        stepRunID: fixture.running.id,
        expectedRevision: fixture.running.revision,
        status: "completed",
        outputDigest: "answer",
        branchTarget: "END",
      })
      expect(settled).toMatchObject({ status: "completed", outputDigest: "answer", branchTarget: "END" })
      const settling = yield* fixture.runs.get(fixture.run.id)
      expect(settling).toMatchObject({ status: "running", revision: 4 })
      const before = yield* snapshot(fixture.run.id)
      expect(
        yield* fixture.runs
          .settleStep({ stepRunID: settled.id, expectedRevision: settled.revision, status: "completed" })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(
        yield* fixture.runs
          .completeRun({ runID: fixture.run.id, expectedRevision: settling.revision - 1 })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(yield* snapshot(fixture.run.id)).toEqual(before)
      const completed = yield* fixture.runs.completeRun({ runID: fixture.run.id, expectedRevision: settling.revision })
      expect(completed).toMatchObject({ status: "completed", revision: 5 })
      const events = yield* log(fixture.run.id)
      expect(events.map((event) => [event.data.status, event.data.revision, event.durable.seq])).toEqual([
        ["pending", 1, 0],
        ["running", 2, 1],
        ["running", 3, 2],
        ["running", 4, 3],
        ["completed", 5, 4],
      ])
      expect(events.at(-1)?.data).toMatchObject({
        runID: completed.id,
        sessionID: completed.sessionID,
        status: completed.status,
        revision: completed.revision,
        timeUpdated: completed.timeUpdated,
      })
      expect(published).toEqual([4, 5])
      const terminal = yield* snapshot(fixture.run.id)
      expect(terminal.sequence?.seq).toBe(completed.revision - 1)
      expect(yield* fixture.runs.completeRun({ runID: completed.id, expectedRevision: completed.revision })).toEqual(
        completed,
      )
      expect(yield* fixture.runs.cancelRun({ runID: completed.id, expectedRevision: completed.revision })).toEqual(
        completed,
      )
      expect(
        yield* fixture.runs.failRun({
          runID: completed.id,
          expectedRevision: completed.revision,
          errorCategory: "step_failed",
        }),
      ).toEqual(completed)
      expect(
        yield* fixture.runs.finalizeCancelRun({ runID: completed.id, expectedRevision: completed.revision }),
      ).toEqual(completed)
      expect(yield* fixture.runs.recoverRunning(completed.id, undefined, completed.revision - 1)).toEqual([])
      expect(yield* snapshot(fixture.run.id)).toEqual(terminal)
      expect(published).toEqual([4, 5])
    }),
  )

  it.effect("persists failed Step settlement and partial completion", () =>
    Effect.gen(function* () {
      const fixture = yield* started()
      yield* fixture.runs.settleStep({
        stepRunID: fixture.running.id,
        expectedRevision: fixture.running.revision,
        status: "failed",
        errorCategory: "step_failed",
      })
      const current = yield* fixture.runs.get(fixture.run.id)
      const completed = yield* fixture.runs.completeRun({
        runID: current.id,
        expectedRevision: current.revision,
        partial: true,
      })
      expect(completed.status).toBe("partial_success")
      expect((yield* log(current.id)).at(-1)?.data).toMatchObject({
        status: "partial_success",
        revision: completed.revision,
      })
      expect((yield* fixture.runs.getSteps(current.id)).at(0)).toMatchObject({
        status: "failed",
        errorCategory: "step_failed",
      })
      expect((yield* snapshot(current.id)).sequence?.seq).toBe(completed.revision - 1)
    }),
  )

  it.effect("publishes both cancellation phases with their Step changes and ignores exact duplicates", () =>
    Effect.gen(function* () {
      const fixture = yield* mixed()
      const current = yield* fixture.runs.get(fixture.run.id)
      const published = yield* observe(current.id)
      const cancelling = yield* fixture.runs.cancelRun({ runID: current.id, expectedRevision: current.revision })
      expect(cancelling).toMatchObject({ status: "cancelling", revision: current.revision + 1 })
      expect(cancelling.timeCompleted).toBeUndefined()
      expect(
        Object.fromEntries((yield* fixture.runs.getSteps(current.id)).map((item) => [item.stepId, item.status])),
      ).toEqual({
        worker: "cancelling",
        staged: "cancelling",
        ready: "skipped",
        blocked: "skipped",
      })
      const before = yield* snapshot(current.id)
      expect(yield* fixture.runs.cancelRun({ runID: current.id, expectedRevision: cancelling.revision })).toEqual(
        cancelling,
      )
      expect(
        yield* fixture.runs.cancelRun({ runID: current.id, expectedRevision: current.revision }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(
        yield* fixture.runs
          .settleStep({
            stepRunID: fixture.running.id,
            expectedRevision: fixture.running.revision,
            status: "completed",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(yield* snapshot(current.id)).toEqual(before)
      const cancelled = yield* fixture.runs.finalizeCancelRun({
        runID: current.id,
        expectedRevision: cancelling.revision,
      })
      expect(cancelled).toMatchObject({ status: "cancelled", revision: cancelling.revision + 1 })
      expect(cancelled.timeCompleted).toBeDefined()
      expect(
        Object.fromEntries((yield* fixture.runs.getSteps(current.id)).map((item) => [item.stepId, item.status])),
      ).toEqual({
        worker: "cancelled",
        staged: "cancelled",
        ready: "skipped",
        blocked: "skipped",
      })
      expect(
        (yield* log(current.id))
          .slice(-2)
          .map((event) => [event.data.status, event.data.revision, event.data.errorCategory]),
      ).toEqual([
        ["cancelling", cancelling.revision, "step_cancelled"],
        ["cancelled", cancelled.revision, "step_cancelled"],
      ])
      const terminal = yield* snapshot(current.id)
      expect(
        yield* fixture.runs.finalizeCancelRun({ runID: current.id, expectedRevision: cancelled.revision }),
      ).toEqual(cancelled)
      expect(yield* snapshot(current.id)).toEqual(terminal)
      expect(published).toEqual([cancelling.revision, cancelled.revision])
      expect(terminal.sequence?.seq).toBe(cancelled.revision - 1)
    }),
  )

  it.effect("retains cancellation intent even when no unfinished Steps remain", () =>
    Effect.gen(function* () {
      const fixture = yield* setup([])
      const cancelling = yield* fixture.runs.cancelRun({
        runID: fixture.run.id,
        expectedRevision: fixture.run.revision,
      })
      const before = yield* snapshot(cancelling.id)
      expect(
        yield* fixture.runs
          .completeRun({ runID: cancelling.id, expectedRevision: cancelling.revision })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(
        yield* fixture.runs
          .failRun({ runID: cancelling.id, expectedRevision: cancelling.revision, errorCategory: "step_failed" })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(
        yield* fixture.runs.recoverRunning(cancelling.id, undefined, cancelling.revision).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(yield* snapshot(cancelling.id)).toEqual(before)
    }),
  )

  it.effect("publishes failure with all dispatched Steps closed and future Steps skipped", () =>
    Effect.gen(function* () {
      const fixture = yield* mixed()
      const current = yield* fixture.runs.get(fixture.run.id)
      const failed = yield* fixture.runs.failRun({
        runID: current.id,
        expectedRevision: current.revision,
        errorCategory: "step_failed",
      })
      expect(failed).toMatchObject({ status: "failed", revision: current.revision + 1 })
      expect(
        Object.fromEntries((yield* fixture.runs.getSteps(current.id)).map((item) => [item.stepId, item.status])),
      ).toEqual({
        worker: "cancelled",
        staged: "cancelled",
        ready: "skipped",
        blocked: "skipped",
      })
      expect((yield* log(current.id)).at(-1)?.data).toMatchObject({
        status: "failed",
        revision: failed.revision,
        errorCategory: "step_failed",
      })
      const before = yield* snapshot(current.id)
      expect(
        yield* fixture.runs.failRun({
          runID: current.id,
          expectedRevision: failed.revision,
          errorCategory: "step_cancelled",
        }),
      ).toEqual(failed)
      expect(
        yield* fixture.runs
          .failRun({ runID: current.id, expectedRevision: current.revision, errorCategory: "step_failed" })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(yield* snapshot(current.id)).toEqual(before)
      expect(before.sequence?.seq).toBe(failed.revision - 1)
    }),
  )

  it.effect("publishes legacy recovery with unknown dispatched execution and no automatic replay", () =>
    Effect.gen(function* () {
      const fixture = yield* mixed()
      const current = yield* fixture.runs.get(fixture.run.id)
      const recovered = yield* fixture.runs.recoverRunning(current.id, "execution_unknown", current.revision)
      expect(Object.fromEntries(recovered.map((item) => [item.stepId, item.status]))).toEqual({
        worker: "execution_unknown",
        staged: "execution_unknown",
        ready: "skipped",
        blocked: "skipped",
      })
      const run = yield* fixture.runs.get(current.id)
      expect(run).toMatchObject({
        status: "recovery_required",
        revision: current.revision + 1,
        errorCategory: "execution_unknown",
      })
      expect((yield* log(current.id)).at(-1)?.data).toMatchObject({
        status: run.status,
        revision: run.revision,
        errorCategory: run.errorCategory,
      })
      const before = yield* snapshot(current.id)
      expect(yield* fixture.runs.recoverRunning(current.id, "execution_unknown", current.revision)).toEqual([])
      expect(yield* snapshot(current.id)).toEqual(before)
      expect(before.sequence?.seq).toBe(run.revision - 1)
    }),
  )

  it.effect("does not return a dispatch-only legacy orphan to ready without exact-input proof", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const first = fixture.steps.at(0)
      if (!first) return yield* Effect.die(new Error("Workflow fixture has no first Step"))
      yield* fixture.runs.dispatchStep({ stepRunID: first.id, expectedRevision: first.revision })
      const current = yield* fixture.runs.get(fixture.run.id)
      const recovered = yield* fixture.runs.recoverRunning(current.id, "execution_unknown", current.revision)
      expect(recovered.at(0)).toMatchObject({ status: "execution_unknown" })
      expect((yield* log(current.id)).at(-1)?.data).toMatchObject({
        status: "recovery_required",
        revision: current.revision + 1,
      })
    }),
  )

  it.effect("leaves legacy terminal row/event drift and orphan Steps unchanged", () =>
    Effect.gen(function* () {
      const fixture = yield* started()
      const current = yield* fixture.runs.get(fixture.run.id)
      yield* fixture.database.db
        .update(WorkflowRunTable)
        .set({ status: "completed", revision: current.revision + 1, time_completed: 100, time_updated: 100 })
        .where(eq(WorkflowRunTable.id, current.id))
        .run()
        .pipe(Effect.orDie)
      const terminal = yield* fixture.runs.get(current.id)
      const before = yield* snapshot(current.id)
      const published = yield* observe(current.id)
      expect(before.sequence?.seq).toBe(terminal.revision - 2)
      expect(yield* fixture.runs.recoverRunning(current.id, undefined, current.revision)).toEqual([])
      expect(yield* fixture.runs.completeRun({ runID: current.id, expectedRevision: terminal.revision })).toEqual(
        terminal,
      )
      expect(yield* fixture.runs.cancelRun({ runID: current.id, expectedRevision: terminal.revision })).toEqual(
        terminal,
      )
      expect(yield* fixture.runs.finalizeCancelRun({ runID: current.id, expectedRevision: terminal.revision })).toEqual(
        terminal,
      )
      expect(
        yield* fixture.runs.failRun({
          runID: current.id,
          expectedRevision: terminal.revision,
          errorCategory: "step_failed",
        }),
      ).toEqual(terminal)
      expect(
        yield* fixture.runs
          .settleStep({
            stepRunID: fixture.running.id,
            expectedRevision: fixture.running.revision,
            status: "completed",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(yield* snapshot(current.id)).toEqual(before)
      expect(published).toEqual([])
    }),
  )

  it.effect("rejects active Run/event drift as typed conflicts without changing any durable snapshot", () =>
    Effect.gen(function* () {
      const fixture = yield* started()
      const current = yield* fixture.runs.get(fixture.run.id)
      yield* fixture.database.db
        .update(WorkflowRunTable)
        .set({ revision: current.revision + 1 })
        .where(eq(WorkflowRunTable.id, current.id))
        .run()
        .pipe(Effect.orDie)
      const drifted = yield* fixture.runs.get(current.id)
      const before = yield* snapshot(current.id)
      const published = yield* observe(current.id)
      expect(
        yield* fixture.runs
          .settleStep({
            stepRunID: fixture.running.id,
            expectedRevision: fixture.running.revision,
            status: "completed",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(
        yield* fixture.runs.cancelRun({ runID: current.id, expectedRevision: drifted.revision }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(
        yield* fixture.runs
          .failRun({ runID: current.id, expectedRevision: drifted.revision, errorCategory: "step_failed" })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(
        yield* fixture.runs.recoverRunning(current.id, undefined, drifted.revision).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(yield* snapshot(current.id)).toEqual(before)
      expect(published).toEqual([])
    }),
  )

  it.effect("rejects completion and cancellation finalization drift without filling event gaps", () =>
    Effect.gen(function* () {
      const fixture = yield* setup([])
      yield* fixture.database.db
        .update(WorkflowRunTable)
        .set({ revision: 2 })
        .where(eq(WorkflowRunTable.id, fixture.run.id))
        .run()
        .pipe(Effect.orDie)
      const before = yield* snapshot(fixture.run.id)
      expect(
        yield* fixture.runs.completeRun({ runID: fixture.run.id, expectedRevision: 2 }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(yield* snapshot(fixture.run.id)).toEqual(before)
      yield* fixture.database.db
        .update(WorkflowRunTable)
        .set({ status: "cancelling" })
        .where(eq(WorkflowRunTable.id, fixture.run.id))
        .run()
        .pipe(Effect.orDie)
      const cancelling = yield* snapshot(fixture.run.id)
      expect(
        yield* fixture.runs.finalizeCancelRun({ runID: fixture.run.id, expectedRevision: 2 }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "WorkflowRun.InvalidStateTransitionError",
      })
      expect(yield* snapshot(fixture.run.id)).toEqual(cancelling)
    }),
  )

  for (const failure of ["step", "event"] as const) {
    it.effect(`rolls back Run, Step, sequence and log on a real ${failure} write failure`, () =>
      Effect.gen(function* () {
        const fixture = yield* started()
        const before = yield* snapshot(fixture.run.id)
        const published = yield* observe(fixture.run.id)
        yield* fixture.database.db
          .run(
            failure === "step"
              ? sql`CREATE TEMP TRIGGER block_workflow_transition BEFORE UPDATE ON workflow_step_run
                  BEGIN SELECT RAISE(ABORT, 'Workflow Step write failed'); END`
              : sql`CREATE TEMP TRIGGER block_workflow_transition BEFORE INSERT ON event
                  WHEN NEW.type = 'workflow.run.updated.1'
                  BEGIN SELECT RAISE(ABORT, 'Workflow event write failed'); END`,
          )
          .pipe(Effect.orDie)
        yield* Effect.addFinalizer(() =>
          fixture.database.db.run(sql`DROP TRIGGER IF EXISTS block_workflow_transition`).pipe(Effect.orDie),
        )
        expect(
          Exit.isFailure(
            yield* fixture.runs
              .settleStep({
                stepRunID: fixture.running.id,
                expectedRevision: fixture.running.revision,
                status: "completed",
              })
              .pipe(Effect.exit),
          ),
        ).toBe(true)
        expect(yield* snapshot(fixture.run.id)).toEqual(before)
        expect(published).toEqual([])
        yield* fixture.database.db.run(sql`DROP TRIGGER block_workflow_transition`).pipe(Effect.orDie)
        yield* fixture.runs.settleStep({
          stepRunID: fixture.running.id,
          expectedRevision: fixture.running.revision,
          status: "completed",
        })
        const committed = yield* fixture.runs.get(fixture.run.id)
        expect(published).toEqual([committed.revision])
        expect((yield* snapshot(fixture.run.id)).sequence?.seq).toBe(committed.revision - 1)
      }),
    )
  }

  it.effect("rolls back the parent claim when the Step CAS loses inside the owner transaction", () =>
    Effect.gen(function* () {
      const fixture = yield* started()
      const before = yield* snapshot(fixture.run.id)
      const published = yield* observe(fixture.run.id)
      yield* fixture.database.db
        .run(
          sql`CREATE TEMP TRIGGER block_workflow_transition AFTER UPDATE OF revision ON workflow_run
          BEGIN UPDATE workflow_step_run SET revision = revision + 1
            WHERE run_id = NEW.id AND status = 'running'; END`,
        )
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        fixture.database.db.run(sql`DROP TRIGGER IF EXISTS block_workflow_transition`).pipe(Effect.orDie),
      )
      expect(
        yield* fixture.runs
          .settleStep({
            stepRunID: fixture.running.id,
            expectedRevision: fixture.running.revision,
            status: "completed",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "WorkflowRun.InvalidStateTransitionError" })
      expect(yield* snapshot(fixture.run.id)).toEqual(before)
      expect(published).toEqual([])
    }),
  )
})
