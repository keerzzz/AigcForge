export * as WorkflowRun from "./workflow-run"

import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import type { Session as SessionSchema } from "@aigcfroge/schema/session"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { computeDigest } from "../composition/digest"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { WorkflowEvent } from "./event"
import { WorkflowRunTable, WorkflowStepRunTable } from "./sql"

export class WorkflowNotFoundError extends Schema.TaggedErrorClass<WorkflowNotFoundError>()(
  "WorkflowRun.WorkflowNotFoundError",
  {
    runID: Schema.String,
  },
) {
  override get message() {
    return `Workflow run not found: ${this.runID}`
  }
}

export class StepNotFoundError extends Schema.TaggedErrorClass<StepNotFoundError>()("WorkflowRun.StepNotFoundError", {
  stepRunID: Schema.String,
}) {
  override get message() {
    return `Workflow step run not found: ${this.stepRunID}`
  }
}

export class InvalidStateTransitionError extends Schema.TaggedErrorClass<InvalidStateTransitionError>()(
  "WorkflowRun.InvalidStateTransitionError",
  {
    from: Schema.String,
    to: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class InvalidBranchOutputError extends Schema.TaggedErrorClass<InvalidBranchOutputError>()(
  "WorkflowRun.InvalidBranchOutputError",
  {
    stepID: Schema.String,
  },
) {
  override get message() {
    return `Workflow step ${this.stepID} completed without a valid branch target`
  }
}

export class RequestConflictError extends Schema.TaggedErrorClass<RequestConflictError>()(
  "WorkflowRun.RequestConflictError",
  {
    requestID: Schema.String,
  },
) {
  override get message() {
    return `Workflow request ${this.requestID} conflicts with an existing request`
  }
}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionSchema.ID
    workflow: Composition.WorkflowInfo
    snapshotDigest?: string
    requestID?: string
  }) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, RequestConflictError>

  readonly getOrCreate: (input: {
    sessionID: SessionSchema.ID
    workflow: Composition.WorkflowInfo
    snapshotDigest?: string
    requestID?: string
  }) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, RequestConflictError>

  readonly get: (
    runID: WorkflowAsset.WorkflowRunID,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError>

  readonly getBySession: (sessionID: SessionSchema.ID) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined>

  readonly getSteps: (runID: WorkflowAsset.WorkflowRunID) => Effect.Effect<readonly WorkflowAsset.StepRunInfo[]>

  readonly findReadySteps: (
    runID: WorkflowAsset.WorkflowRunID,
    stepsDef: readonly WorkflowAsset.StepDef[],
  ) => Effect.Effect<readonly WorkflowAsset.StepRunInfo[], InvalidBranchOutputError>

  readonly startStep: (
    input:
      | {
          stepRunID: WorkflowAsset.StepRunID
          expectedRevision?: number
          taskID?: string
          childSessionID?: string
        }
      | WorkflowAsset.StepRunID,
    expectedRevision?: number,
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError | InvalidStateTransitionError>

  readonly dispatchStep: (input: {
    stepRunID: WorkflowAsset.StepRunID
    expectedRevision?: number
    taskID?: string
    childSessionID?: string
  }) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError | InvalidStateTransitionError>

  readonly settleStep: (
    input:
      | {
          stepRunID: WorkflowAsset.StepRunID
          expectedRevision?: number
          status: "completed" | "failed" | "cancelled" | "skipped"
          outputDigest?: string
          branchTarget?: string
          errorCategory?: WorkflowAsset.ErrorCategory
        }
      | WorkflowAsset.StepRunID,
    result?: {
      expectedRevision?: number
      status: "completed" | "failed" | "cancelled" | "skipped"
      outputDigest?: string
      branchTarget?: string
      errorCategory?: WorkflowAsset.ErrorCategory
    },
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError | InvalidStateTransitionError>

  readonly retryStep: (
    input:
      | {
          stepRunID: WorkflowAsset.StepRunID
          expectedRevision?: number
        }
      | WorkflowAsset.StepRunID,
    expectedRevision?: number,
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError | InvalidStateTransitionError>

  /** Reconcile process-crash/request-interruption orphans without replaying provider work. */
  readonly recoverRunning: (
    runID: WorkflowAsset.WorkflowRunID,
    errorCategory?: WorkflowAsset.ErrorCategory,
    expectedRevision?: number,
  ) => Effect.Effect<readonly WorkflowAsset.StepRunInfo[], WorkflowNotFoundError | InvalidStateTransitionError>

  readonly cancelStep: (input: {
    stepRunID: WorkflowAsset.StepRunID
    expectedRevision?: number
    errorCategory?: string
  }) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError | InvalidStateTransitionError>

  readonly finalizeCancelRun: (input: {
    runID: WorkflowAsset.WorkflowRunID
    expectedRevision?: number
    errorCategory?: string
  }) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError | InvalidStateTransitionError>

  readonly retryRun: (input: {
    runID: WorkflowAsset.WorkflowRunID
    stepRunID: WorkflowAsset.StepRunID
    requestID: string
    expectedRunRevision: number
    expectedStepRevision: number
    stepsDef: readonly WorkflowAsset.StepDef[]
    /** Defence in depth: when set, a run owned by another Session reads as missing. */
    sessionID?: SessionSchema.ID
  }) => Effect.Effect<
    WorkflowAsset.WorkflowRunInfo,
    WorkflowNotFoundError | StepNotFoundError | RequestConflictError | InvalidStateTransitionError
  >

  readonly cancelRun: (
    runID:
      | WorkflowAsset.WorkflowRunID
      | {
          runID: WorkflowAsset.WorkflowRunID
          expectedRevision?: number
          errorCategory?: string
        },
    errorCategory?: string,
    expectedRevision?: number,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError | InvalidStateTransitionError>

  readonly completeRun: (
    runID:
      | WorkflowAsset.WorkflowRunID
      | { runID: WorkflowAsset.WorkflowRunID; expectedRevision?: number; partial?: boolean },
    partial?: boolean,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError | InvalidStateTransitionError>

  readonly failRun: (
    runID:
      | WorkflowAsset.WorkflowRunID
      | {
          runID: WorkflowAsset.WorkflowRunID
          expectedRevision?: number
          errorCategory: string
        },
    errorCategory?: string,
    expectedRevision?: number,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError | InvalidStateTransitionError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowRun") {}

const makeRunID = Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunID)
const makeStepRunID = Schema.decodeUnknownSync(WorkflowAsset.StepRunID)
const isErrorCategory = Schema.is(WorkflowAsset.ErrorCategory)

function rowToRunInfo(row: typeof WorkflowRunTable.$inferSelect): WorkflowAsset.WorkflowRunInfo {
  return new WorkflowAsset.WorkflowRunInfo({
    id: row.id,
    sessionID: row.session_id,
    snapshotDigest: row.snapshot_digest,
    workflowName: row.workflow_name,
    workflowRevision: row.workflow_revision,
    parentRunID: row.parent_run_id ?? undefined,
    rootRunID: row.root_run_id ?? undefined,
    retryOfStepRunID: row.retry_of_step_run_id ?? undefined,
    status: row.status,
    revision: row.revision,
    currentStepId: row.current_step_id ?? undefined,
    errorCategory: row.error_category ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    timeCompleted: row.time_completed ?? undefined,
  })
}

function rowToStepInfo(row: typeof WorkflowStepRunTable.$inferSelect): WorkflowAsset.StepRunInfo {
  return new WorkflowAsset.StepRunInfo({
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    agentId: row.agent_id,
    status: row.status,
    attempt: row.attempt,
    revision: row.revision,
    taskId: row.task_id ?? undefined,
    childSessionId: row.child_session_id ?? undefined,
    inputDigest: row.input_digest ?? undefined,
    outputDigest: row.output_digest ?? undefined,
    branchTarget: row.branch_target ?? undefined,
    errorCategory: row.error_category ?? undefined,
    timeCreated: row.time_created,
    timeStarted: row.time_started ?? undefined,
    timeCompleted: row.time_completed ?? undefined,
  })
}

function transitiveDescendants(startID: string, stepsDef: readonly WorkflowAsset.StepDef[]): Set<string> {
  if (startID === "END") return new Set()
  const result = new Set<string>()
  const queue = [startID]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || result.has(current)) continue
    result.add(current)
    const step = stepsDef.find((candidate) => candidate.id === current)
    if (!step) continue
    if (step.next && step.next !== "END") queue.push(step.next)
    if (step.branches) {
      queue.push(...Object.values(step.branches).filter((target) => target !== "END"))
    }
    if (step.parallel) queue.push(...step.parallel)
  }

  return result
}

const terminalRunStatuses: readonly WorkflowAsset.WorkflowRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "partial_success",
  "recovery_required",
]

const publishWorkflowEvent = Effect.fn("WorkflowRun.publishWorkflowEvent")(function* (
  events: EventV2.Interface,
  update: WorkflowEvent.Update,
  commit: (seq: number) => Effect.Effect<boolean>,
) {
  return yield* events
    .publish(WorkflowEvent.Updated, update, {
      commit: (seq) => {
        if (seq + 1 !== update.revision) {
          return Effect.die(new WorkflowEvent.CommitRejected({ runID: update.runID, revision: update.revision }))
        }
        return commit(seq).pipe(
          Effect.flatMap((accepted) =>
            accepted
              ? Effect.void
              : Effect.die(new WorkflowEvent.CommitRejected({ runID: update.runID, revision: update.revision })),
          ),
        )
      },
    })
    .pipe(
      Effect.catchDefect((defect) =>
        defect instanceof WorkflowEvent.CommitRejected ? Effect.fail(defect) : Effect.die(defect),
      ),
    )
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const getOrCreate: Interface["getOrCreate"] = Effect.fn("WorkflowRun.getOrCreate")(function* (input) {
      const now = Date.now()
      const snapshotDigest = input.snapshotDigest ?? input.workflow.revision
      const requestDigest = input.requestID
        ? computeDigest({ snapshotDigest, workflowRevision: input.workflow.revision })
        : undefined
      if (input.requestID) {
        const existingRequest = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(
            and(eq(WorkflowRunTable.session_id, input.sessionID), eq(WorkflowRunTable.request_id, input.requestID)),
          )
          .get()
          .pipe(Effect.orDie)
        if (existingRequest) {
          if (existingRequest.request_digest !== requestDigest) {
            return yield* new RequestConflictError({ requestID: input.requestID })
          }
          return rowToRunInfo(existingRequest)
        }
      }
      const identity = and(
        eq(WorkflowRunTable.session_id, input.sessionID),
        eq(WorkflowRunTable.snapshot_digest, snapshotDigest),
        eq(WorkflowRunTable.workflow_revision, input.workflow.revision),
      )
      // Run identity dedupe (ADR-18 §2.4.2) means "one *active* run per identity":
      // terminal runs must stay reachable as history without swallowing a fresh
      // submit, and terminal-retry lineage deliberately reuses the same identity.
      const activeIdentity = and(identity, notInArray(WorkflowRunTable.status, [...terminalRunStatuses]))
      const existing = yield* db.select().from(WorkflowRunTable).where(activeIdentity).get().pipe(Effect.orDie)
      if (existing) return rowToRunInfo(existing)

      const runID = makeRunID(Identifier.ascending("workflowRun"))
      const committed = yield* publishWorkflowEvent(
        events,
        {
          runID,
          sessionID: input.sessionID,
          status: "pending",
          revision: 1,
          timeUpdated: now,
        },
        () =>
          Effect.gen(function* () {
            // Re-check inside the event transaction: the identity index was
            // dropped (it cannot be unique — retry lineage reuses the identity),
            // so `onConflictDoNothing` below has no identity target and the
            // pre-transaction read alone would let two concurrent submits with
            // different `requestID`s both create a run.
            const raced = yield* db.select().from(WorkflowRunTable).where(activeIdentity).get().pipe(Effect.orDie)
            if (raced) return false
            const inserted = yield* db
              .insert(WorkflowRunTable)
              .values({
                id: runID,
                session_id: input.sessionID,
                snapshot_digest: snapshotDigest,
                workflow_name: input.workflow.name,
                workflow_revision: input.workflow.revision,
                request_id: input.requestID,
                request_digest: requestDigest,
                status: "pending",
                revision: 1,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoNothing()
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!inserted) return false

            for (let index = 0; index < input.workflow.steps.length; index++) {
              const step = input.workflow.steps[index]
              yield* db
                .insert(WorkflowStepRunTable)
                .values({
                  id: makeStepRunID(Identifier.ascending("workflowStep")),
                  run_id: inserted.id,
                  step_id: step.id,
                  agent_id: step.agent,
                  status: index === 0 ? "ready" : "pending",
                  attempt: 1,
                  revision: 1,
                  input_digest: computeDigest(step.input ?? {}),
                  time_created: now,
                })
                .run()
                .pipe(Effect.orDie)
            }
            return true
          }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("WorkflowEvent.CommitRejected", () => Effect.succeed(false)),
      )

      if (!committed) {
        const concurrent = yield* db.select().from(WorkflowRunTable).where(activeIdentity).get().pipe(Effect.orDie)
        if (concurrent) return rowToRunInfo(concurrent)
        // The other possible rejection is the `(session_id, request_id)` unique
        // index: a concurrent submit with the *same* requestID won the race.
        if (input.requestID) {
          const byRequest = yield* db
            .select()
            .from(WorkflowRunTable)
            .where(
              and(eq(WorkflowRunTable.session_id, input.sessionID), eq(WorkflowRunTable.request_id, input.requestID)),
            )
            .get()
            .pipe(Effect.orDie)
          if (byRequest) return rowToRunInfo(byRequest)
        }
        return yield* Effect.die("Workflow run identity conflict without an owner row")
      }

      return yield* get(runID).pipe(Effect.orDie)
    })

    const create: Interface["create"] = Effect.fn("WorkflowRun.create")(function* (input) {
      return yield* getOrCreate(input)
    })

    const get: Interface["get"] = Effect.fn("WorkflowRun.get")(function* (runID) {
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, runID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new WorkflowNotFoundError({ runID })
      return rowToRunInfo(row)
    })

    const getBySession: Interface["getBySession"] = Effect.fn("WorkflowRun.getBySession")(function* (sessionID) {
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.session_id, sessionID))
        .orderBy(desc(WorkflowRunTable.time_created))
        .get()
        .pipe(Effect.orDie)
      return row ? rowToRunInfo(row) : undefined
    })

    const getSteps: Interface["getSteps"] = Effect.fn("WorkflowRun.getSteps")(function* (runID) {
      const rows = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.run_id, runID))
        .orderBy(WorkflowStepRunTable.time_created)
        .all()
        .pipe(Effect.orDie)
      return rows.map(rowToStepInfo)
    })

    const findReadySteps: Interface["findReadySteps"] = Effect.fn("WorkflowRun.findReadySteps")(
      function* (runID, stepsDef) {
        const latestStepRuns = new Map<string, WorkflowAsset.StepRunInfo>()
        for (const stepRun of yield* getSteps(runID)) {
          const existing = latestStepRuns.get(stepRun.stepId)
          if (!existing || existing.attempt < stepRun.attempt) latestStepRuns.set(stepRun.stepId, stepRun)
        }

        const predecessors = new Map<string, string[]>()
        for (const step of stepsDef) {
          if (!predecessors.has(step.id)) predecessors.set(step.id, [])
          const targets = [
            ...(step.next && step.next !== "END" ? [step.next] : []),
            ...(step.branches ? Object.values(step.branches).filter((target) => target !== "END") : []),
            ...(step.parallel ?? []),
          ]
          for (const target of targets) {
            predecessors.set(target, [...(predecessors.get(target) ?? []), step.id])
          }
        }

        for (const step of stepsDef) {
          if (!step.branches) continue
          const stepRun = latestStepRuns.get(step.id)
          if (stepRun?.status !== "completed") continue
          if (!stepRun.branchTarget || !Object.values(step.branches).includes(stepRun.branchTarget)) {
            return yield* new InvalidBranchOutputError({ stepID: step.id })
          }

          const selected = transitiveDescendants(stepRun.branchTarget, stepsDef)
          const abandoned = new Set<string>()
          for (const target of Object.values(step.branches)) {
            if (target === stepRun.branchTarget) continue
            for (const descendant of transitiveDescendants(target, stepsDef)) {
              if (selected.has(descendant)) continue
              abandoned.add(descendant)
            }
          }
          // A node the non-taken arm merely *also* feeds must survive: a diamond
          // where the taken arm (or any step outside this branch) is still a live
          // predecessor can satisfy it later, and `skipped` counts as satisfied in
          // the frontier rule below. Spare those nodes, then re-run to a fixed
          // point because sparing one node makes the nodes it feeds live too.
          for (let changed = true; changed; ) {
            changed = false
            for (const descendant of [...abandoned]) {
              const live = (predecessors.get(descendant) ?? []).some(
                (predecessor) => predecessor !== step.id && !abandoned.has(predecessor),
              )
              if (!live) continue
              abandoned.delete(descendant)
              changed = true
            }
          }
          for (const descendant of abandoned) {
            const candidate = latestStepRuns.get(descendant)
            if (!candidate || (candidate.status !== "pending" && candidate.status !== "ready")) continue
            const updated = yield* db
              .update(WorkflowStepRunTable)
              .set({
                status: "skipped",
                revision: sql`${WorkflowStepRunTable.revision} + 1`,
                time_completed: Date.now(),
              })
              .where(
                and(
                  eq(WorkflowStepRunTable.id, candidate.id),
                  eq(WorkflowStepRunTable.revision, candidate.revision),
                  inArray(WorkflowStepRunTable.status, ["pending", "ready"]),
                ),
              )
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (updated) latestStepRuns.set(descendant, rowToStepInfo(updated))
          }
        }

        const ready: WorkflowAsset.StepRunInfo[] = []
        for (const step of stepsDef) {
          const stepRun = latestStepRuns.get(step.id)
          if (!stepRun) continue
          if (stepRun.status === "ready") {
            ready.push(stepRun)
            continue
          }
          if (stepRun.status !== "pending") continue

          const dependencies = predecessors.get(step.id) ?? []
          const satisfied = dependencies.every((predecessorID) => {
            const predecessor = latestStepRuns.get(predecessorID)
            if (!predecessor) return false
            if (predecessor.status === "completed" || predecessor.status === "skipped") return true
            const definition = stepsDef.find((candidate) => candidate.id === predecessorID)
            return predecessor.status === "failed" && definition?.failurePolicy === "continue"
          })
          if (!satisfied) continue

          const updated = yield* db
            .update(WorkflowStepRunTable)
            .set({
              status: "ready",
              revision: sql`${WorkflowStepRunTable.revision} + 1`,
            })
            .where(
              and(
                eq(WorkflowStepRunTable.id, stepRun.id),
                eq(WorkflowStepRunTable.status, "pending"),
                eq(WorkflowStepRunTable.revision, stepRun.revision),
              ),
            )
            .returning()
            .get()
            .pipe(Effect.orDie)
          if (updated) ready.push(rowToStepInfo(updated))
        }

        return ready
      },
    )

    const dispatchStep: Interface["dispatchStep"] = Effect.fn("WorkflowRun.dispatchStep")(function* (input) {
      const now = Date.now()
      const current = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, input.stepRunID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      const expectedRevision = input.expectedRevision ?? current.revision
      if (current.status !== "ready" || current.revision !== expectedRevision) {
        return yield* new InvalidStateTransitionError({
          from: `${current.status}@${current.revision}`,
          to: "dispatching",
          reason: `Step ${input.stepRunID} is not dispatchable at revision ${input.expectedRevision ?? "current"}`,
        })
      }

      const parent = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, current.run_id))
        .get()
        .pipe(Effect.orDie)
      if (!parent || terminalRunStatuses.includes(parent.status)) {
        return yield* new InvalidStateTransitionError({
          from: `${current.status}@${current.revision}`,
          to: "dispatching",
          reason: `Step ${input.stepRunID} belongs to an immutable run`,
        })
      }

      const taskID = input.taskID ?? `task_${current.run_id}_${current.step_id}_${current.attempt}`
      const childSessionID = input.childSessionID ?? `child_${current.run_id}_${current.step_id}_${current.attempt}`
      const accepted = yield* publishWorkflowEvent(
        events,
        {
          runID: parent.id,
          sessionID: parent.session_id,
          status: "running",
          revision: parent.revision + 1,
          currentStepId: current.step_id,
          timeUpdated: now,
        },
        () =>
          Effect.gen(function* () {
            const claimedParent = yield* db
              .update(WorkflowRunTable)
              .set({
                status: "running",
                revision: parent.revision + 1,
                current_step_id: current.step_id,
                time_updated: now,
              })
              .where(
                and(
                  eq(WorkflowRunTable.id, current.run_id),
                  eq(WorkflowRunTable.revision, parent.revision),
                  inArray(WorkflowRunTable.status, ["pending", "running"]),
                ),
              )
              .returning({ id: WorkflowRunTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!claimedParent) return false
            const updated = yield* db
              .update(WorkflowStepRunTable)
              .set({
                status: "dispatching",
                revision: expectedRevision + 1,
                task_id: taskID,
                child_session_id: childSessionID,
                time_started: null,
              })
              .where(
                and(
                  eq(WorkflowStepRunTable.id, input.stepRunID),
                  eq(WorkflowStepRunTable.status, "ready"),
                  eq(WorkflowStepRunTable.revision, expectedRevision),
                ),
              )
              .returning()
              .get()
              .pipe(Effect.orDie)
            return updated !== undefined
          }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("WorkflowEvent.CommitRejected", () => Effect.succeed(false)),
      )
      if (!accepted) {
        const latest = yield* db
          .select()
          .from(WorkflowStepRunTable)
          .where(eq(WorkflowStepRunTable.id, input.stepRunID))
          .get()
          .pipe(Effect.orDie)
        if (!latest) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
        return yield* new InvalidStateTransitionError({
          from: `${latest.status}@${latest.revision}`,
          to: "dispatching",
          reason: `Step ${input.stepRunID} is not dispatchable at revision ${input.expectedRevision ?? "current"}`,
        })
      }
      return rowToStepInfo({
        ...current,
        status: "dispatching",
        revision: expectedRevision + 1,
        task_id: taskID,
        child_session_id: childSessionID,
        time_started: null,
      })
    })

    const startStep: Interface["startStep"] = Effect.fn("WorkflowRun.startStep")(function* (rawInput, legacyRevision) {
      const input =
        typeof rawInput === "string"
          ? yield* dispatchStep({ stepRunID: rawInput, expectedRevision: legacyRevision }).pipe(
              Effect.map((dispatching) => ({
                stepRunID: dispatching.id,
                expectedRevision: dispatching.revision,
                taskID: dispatching.taskId,
                childSessionID: dispatching.childSessionId,
              })),
            )
          : rawInput
      const now = Date.now()
      const current = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, input.stepRunID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      const expectedRevision = input.expectedRevision ?? current.revision
      if (current.status !== "dispatching" || current.revision !== expectedRevision) {
        return yield* new InvalidStateTransitionError({
          from: `${current.status}@${current.revision}`,
          to: "running",
          reason: `Step ${input.stepRunID} is not startable at revision ${input.expectedRevision ?? "current"}`,
        })
      }
      const parent = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, current.run_id))
        .get()
        .pipe(Effect.orDie)
      if (!parent || terminalRunStatuses.includes(parent.status)) {
        return yield* new InvalidStateTransitionError({
          from: `${current.status}@${current.revision}`,
          to: "running",
          reason: `Step ${input.stepRunID} belongs to an immutable run`,
        })
      }
      const accepted = yield* publishWorkflowEvent(
        events,
        {
          runID: parent.id,
          sessionID: parent.session_id,
          status: "running",
          revision: parent.revision + 1,
          currentStepId: current.step_id,
          timeUpdated: now,
        },
        () =>
          Effect.gen(function* () {
            const updatedParent = yield* db
              .update(WorkflowRunTable)
              .set({ revision: parent.revision + 1, time_updated: now })
              .where(and(eq(WorkflowRunTable.id, parent.id), eq(WorkflowRunTable.revision, parent.revision)))
              .returning({ id: WorkflowRunTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!updatedParent) return false
            const updatedStep = yield* db
              .update(WorkflowStepRunTable)
              .set({
                status: "running",
                revision: expectedRevision + 1,
                task_id: input.taskID ?? current.task_id,
                child_session_id: input.childSessionID ?? current.child_session_id,
                time_started: now,
              })
              .where(
                and(
                  eq(WorkflowStepRunTable.id, input.stepRunID),
                  eq(WorkflowStepRunTable.status, "dispatching"),
                  eq(WorkflowStepRunTable.revision, expectedRevision),
                ),
              )
              .returning()
              .get()
              .pipe(Effect.orDie)
            return updatedStep !== undefined
          }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("WorkflowEvent.CommitRejected", () => Effect.succeed(false)),
      )
      if (!accepted) {
        return yield* new InvalidStateTransitionError({
          from: `${current.status}@${current.revision}`,
          to: "running",
          reason: `Step ${input.stepRunID} changed before provider execution`,
        })
      }
      return rowToStepInfo({
        ...current,
        status: "running",
        revision: expectedRevision + 1,
        task_id: input.taskID ?? current.task_id,
        child_session_id: input.childSessionID ?? current.child_session_id,
        time_started: now,
      })
    })

    const settleStep: Interface["settleStep"] = Effect.fn("WorkflowRun.settleStep")(function* (rawInput, legacyResult) {
      const input =
        typeof rawInput === "string"
          ? { stepRunID: rawInput, ...(legacyResult ?? { status: "failed" as const }) }
          : rawInput
      const current = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, input.stepRunID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      const expectedRevision = input.expectedRevision ?? current.revision
      const updated = yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: input.status,
          revision: sql`${WorkflowStepRunTable.revision} + 1`,
          output_digest: input.outputDigest ?? null,
          branch_target: input.branchTarget ?? null,
          error_category: input.errorCategory ?? null,
          time_completed: Date.now(),
        })
        .where(
          and(
            eq(WorkflowStepRunTable.id, input.stepRunID),
            eq(WorkflowStepRunTable.status, "running"),
            eq(WorkflowStepRunTable.revision, expectedRevision),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (updated) return rowToStepInfo(updated)

      const latest = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, input.stepRunID))
        .get()
        .pipe(Effect.orDie)
      if (!latest) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      return yield* new InvalidStateTransitionError({
        from: `${latest.status}@${latest.revision}`,
        to: input.status,
        reason: `Step ${input.stepRunID} cannot settle from revision ${input.expectedRevision ?? "current"}`,
      })
    })

    const retryStep: Interface["retryStep"] = Effect.fn("WorkflowRun.retryStep")(function* (rawInput, legacyRevision) {
      const input = typeof rawInput === "string" ? { stepRunID: rawInput, expectedRevision: legacyRevision } : rawInput
      const now = Date.now()
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(WorkflowStepRunTable)
              .where(eq(WorkflowStepRunTable.id, input.stepRunID))
              .get()
              .pipe(Effect.orDie)
            if (!current) return { type: "missing" as const }
            const parent = yield* tx
              .select()
              .from(WorkflowRunTable)
              .where(eq(WorkflowRunTable.id, current.run_id))
              .get()
              .pipe(Effect.orDie)
            const expectedRevision = input.expectedRevision ?? current.revision
            if (
              !parent ||
              terminalRunStatuses.includes(parent.status) ||
              current.status !== "failed" ||
              current.revision !== expectedRevision
            ) {
              return { type: "invalid" as const, current }
            }

            const claimed = yield* tx
              .update(WorkflowStepRunTable)
              .set({ revision: sql`${WorkflowStepRunTable.revision} + 1` })
              .where(
                and(
                  eq(WorkflowStepRunTable.id, input.stepRunID),
                  eq(WorkflowStepRunTable.status, "failed"),
                  eq(WorkflowStepRunTable.revision, expectedRevision),
                ),
              )
              .returning({ id: WorkflowStepRunTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!claimed) return { type: "invalid" as const, current }

            const created = yield* tx
              .insert(WorkflowStepRunTable)
              .values({
                id: makeStepRunID(Identifier.ascending("workflowStep")),
                run_id: current.run_id,
                step_id: current.step_id,
                agent_id: current.agent_id,
                status: "ready",
                attempt: current.attempt + 1,
                revision: 1,
                input_digest: current.input_digest,
                time_created: now,
              })
              .returning()
              .get()
              .pipe(Effect.orDie)
            return { type: "ok" as const, created }
          }),
        )
        .pipe(Effect.orDie)

      if (result.type === "missing") {
        return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      }
      if (result.type === "invalid") {
        return yield* new InvalidStateTransitionError({
          from: `${result.current.status}@${result.current.revision}`,
          to: "ready",
          reason: `Step ${input.stepRunID} cannot retry from revision ${input.expectedRevision ?? "current"}`,
        })
      }
      return rowToStepInfo(result.created)
    })

    const retryRun: Interface["retryRun"] = Effect.fn("WorkflowRun.retryRun")(function* (input) {
      const requestDigest = computeDigest({
        runID: input.runID,
        stepRunID: input.stepRunID,
        expectedRunRevision: input.expectedRunRevision,
        expectedStepRevision: input.expectedStepRevision,
      })
      const source = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(
          input.sessionID
            ? and(eq(WorkflowRunTable.id, input.runID), eq(WorkflowRunTable.session_id, input.sessionID))
            : eq(WorkflowRunTable.id, input.runID),
        )
        .get()
        .pipe(Effect.orDie)
      if (!source) return yield* new WorkflowNotFoundError({ runID: input.runID })

      const existingRequest = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(
          and(eq(WorkflowRunTable.session_id, source.session_id), eq(WorkflowRunTable.request_id, input.requestID)),
        )
        .get()
        .pipe(Effect.orDie)
      if (existingRequest) {
        if (existingRequest.request_digest !== requestDigest) {
          return yield* new RequestConflictError({ requestID: input.requestID })
        }
        return rowToRunInfo(existingRequest)
      }

      const target = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(and(eq(WorkflowStepRunTable.id, input.stepRunID), eq(WorkflowStepRunTable.run_id, input.runID)))
        .get()
        .pipe(Effect.orDie)
      if (!target) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      if (source.revision !== input.expectedRunRevision || target.revision !== input.expectedStepRevision) {
        return yield* new InvalidStateTransitionError({
          from: `${source.status}@${source.revision}/${target.status}@${target.revision}`,
          to: "pending",
          reason: `Workflow retry ${input.requestID} used a stale revision`,
        })
      }
      if (!terminalRunStatuses.includes(source.status)) {
        return yield* new InvalidStateTransitionError({
          from: source.status,
          to: "pending",
          reason: `Workflow run ${input.runID} is not terminal and cannot be manually retried`,
        })
      }
      if (target.status !== "failed" && target.status !== "execution_unknown" && target.status !== "cancelled") {
        return yield* new InvalidStateTransitionError({
          from: target.status,
          to: "ready",
          reason: `Workflow step ${input.stepRunID} is not retryable`,
        })
      }

      const latestRows = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.run_id, input.runID))
        .all()
        .pipe(Effect.orDie)
      const latestByStep = new Map<string, (typeof latestRows)[number]>()
      for (const row of latestRows) {
        const current = latestByStep.get(row.step_id)
        if (!current || row.attempt > current.attempt) latestByStep.set(row.step_id, row)
      }
      const retryClosure = transitiveDescendants(target.step_id, input.stepsDef)
      const rootRunID = source.root_run_id ?? source.id
      const runID = makeRunID(Identifier.ascending("workflowRun"))
      const now = Date.now()
      const committed = yield* publishWorkflowEvent(
        events,
        {
          runID,
          sessionID: source.session_id,
          status: "pending",
          revision: 1,
          timeUpdated: now,
        },
        () =>
          Effect.gen(function* () {
            const inserted = yield* db
              .insert(WorkflowRunTable)
              .values({
                id: runID,
                session_id: source.session_id,
                snapshot_digest: source.snapshot_digest,
                workflow_name: source.workflow_name,
                workflow_revision: source.workflow_revision,
                request_id: input.requestID,
                request_digest: requestDigest,
                parent_run_id: source.id,
                root_run_id: rootRunID,
                retry_of_step_run_id: target.id,
                status: "pending",
                revision: 1,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoNothing()
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!inserted) return false

            for (const stepDef of input.stepsDef) {
              const previous = latestByStep.get(stepDef.id)
              const shouldRetry = retryClosure.has(stepDef.id)
              yield* db
                .insert(WorkflowStepRunTable)
                .values({
                  id: makeStepRunID(Identifier.ascending("workflowStep")),
                  run_id: runID,
                  step_id: stepDef.id,
                  agent_id: stepDef.agent,
                  status: shouldRetry
                    ? stepDef.id === target.step_id
                      ? "ready"
                      : "pending"
                    : (previous?.status ?? "pending"),
                  attempt: shouldRetry
                    ? stepDef.id === target.step_id
                      ? target.attempt + 1
                      : 1
                    : (previous?.attempt ?? 1),
                  revision: 1,
                  task_id: shouldRetry ? null : (previous?.task_id ?? null),
                  child_session_id: shouldRetry ? null : (previous?.child_session_id ?? null),
                  input_digest: previous?.input_digest ?? computeDigest(stepDef.input ?? {}),
                  output_digest: shouldRetry ? null : (previous?.output_digest ?? null),
                  branch_target: shouldRetry ? null : (previous?.branch_target ?? null),
                  error_category: shouldRetry ? null : (previous?.error_category ?? null),
                  time_created: now,
                  time_started: shouldRetry ? null : (previous?.time_started ?? null),
                  time_completed: shouldRetry ? null : (previous?.time_completed ?? null),
                })
                .run()
                .pipe(Effect.orDie)
            }
            return true
          }),
      ).pipe(
        Effect.as(true),
        Effect.catchTag("WorkflowEvent.CommitRejected", () => Effect.succeed(false)),
      )
      if (committed) return yield* get(runID)
      const concurrent = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(
          and(eq(WorkflowRunTable.session_id, source.session_id), eq(WorkflowRunTable.request_id, input.requestID)),
        )
        .get()
        .pipe(Effect.orDie)
      if (concurrent?.request_digest === requestDigest) return rowToRunInfo(concurrent)
      return yield* new RequestConflictError({ requestID: input.requestID })
    })

    const recoverRunning: Interface["recoverRunning"] = Effect.fn("WorkflowRun.recoverRunning")(function* (
      runID,
      errorCategory = "execution_unknown",
      expectedRevision,
    ) {
      const now = Date.now()
      const category: WorkflowAsset.ErrorCategory = isErrorCategory(errorCategory) ? errorCategory : "execution_unknown"
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(WorkflowRunTable)
              .where(eq(WorkflowRunTable.id, runID))
              .get()
              .pipe(Effect.orDie)
            if (!current) return { type: "missing" as const }
            if (terminalRunStatuses.includes(current.status)) return { type: "ok" as const, rows: [] }
            const claimedRevision = expectedRevision ?? current.revision
            if (current.revision !== claimedRevision) {
              return { type: "invalid" as const, current, expectedRevision: claimedRevision }
            }

            const steps = yield* tx
              .select()
              .from(WorkflowStepRunTable)
              .where(eq(WorkflowStepRunTable.run_id, runID))
              .all()
              .pipe(Effect.orDie)
            const hasRunning = steps.some((step) => step.status === "running")
            if (!hasRunning) {
              const recovered = yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "ready",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  time_started: null,
                  time_completed: null,
                })
                .where(and(eq(WorkflowStepRunTable.run_id, runID), eq(WorkflowStepRunTable.status, "dispatching")))
                .returning()
                .all()
                .pipe(Effect.orDie)
              const recoveredByID = new Map(recovered.map((step) => [step.id, step]))
              return {
                type: "safe_dispatch" as const,
                rows: steps.map((step) => recoveredByID.get(step.id) ?? step),
              }
            }

            const claimed = yield* tx
              .update(WorkflowRunTable)
              .set({
                status: "recovery_required",
                revision: sql`${WorkflowRunTable.revision} + 1`,
                error_category: category,
                time_completed: now,
                time_updated: now,
              })
              .where(
                and(
                  eq(WorkflowRunTable.id, runID),
                  eq(WorkflowRunTable.status, current.status),
                  eq(WorkflowRunTable.revision, claimedRevision),
                ),
              )
              .returning({ id: WorkflowRunTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!claimed) return { type: "invalid" as const, current, expectedRevision: claimedRevision }

            yield* tx
              .update(WorkflowStepRunTable)
              .set({
                status: "execution_unknown",
                revision: sql`${WorkflowStepRunTable.revision} + 1`,
                error_category: category,
                time_completed: now,
              })
              .where(and(eq(WorkflowStepRunTable.run_id, runID), eq(WorkflowStepRunTable.status, "running")))
              .run()
              .pipe(Effect.orDie)
            yield* tx
              .update(WorkflowStepRunTable)
              .set({
                status: "skipped",
                revision: sql`${WorkflowStepRunTable.revision} + 1`,
                error_category: category,
                time_completed: now,
              })
              .where(
                and(
                  eq(WorkflowStepRunTable.run_id, runID),
                  inArray(WorkflowStepRunTable.status, ["pending", "ready", "dispatching", "cancelling"]),
                ),
              )
              .run()
              .pipe(Effect.orDie)
            const rows = yield* tx
              .select()
              .from(WorkflowStepRunTable)
              .where(eq(WorkflowStepRunTable.run_id, runID))
              .all()
              .pipe(Effect.orDie)
            return { type: "ok" as const, rows }
          }),
        )
        .pipe(Effect.orDie)
      if (result.type === "missing") return yield* new WorkflowNotFoundError({ runID })
      if (result.type === "invalid") {
        return yield* new InvalidStateTransitionError({
          from: `${result.current.status}@${result.current.revision}`,
          to: "recovery_required",
          reason: `Workflow run ${runID} changed since revision ${result.expectedRevision}`,
        })
      }
      if (result.type === "safe_dispatch") return result.rows.map(rowToStepInfo)
      return result.rows.map(rowToStepInfo)
    })

    const cancelRun: Interface["cancelRun"] = Effect.fn("WorkflowRun.cancelRun")(
      function* (rawRunID, legacyCategory, legacyRevision) {
        const input =
          typeof rawRunID === "string"
            ? {
                runID: rawRunID,
                errorCategory: legacyCategory ?? "step_cancelled",
                expectedRevision: legacyRevision,
              }
            : {
                runID: rawRunID.runID,
                errorCategory: rawRunID.errorCategory ?? "step_cancelled",
                expectedRevision: rawRunID.expectedRevision,
              }
        const now = Date.now()
        const category: WorkflowAsset.ErrorCategory = isErrorCategory(input.errorCategory)
          ? input.errorCategory
          : "step_cancelled"
        const result = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select()
                .from(WorkflowRunTable)
                .where(eq(WorkflowRunTable.id, input.runID))
                .get()
                .pipe(Effect.orDie)
              if (!current) return { type: "missing" as const }
              const expectedRevision = input.expectedRevision ?? current.revision
              if (current.revision !== expectedRevision) return { type: "invalid" as const, current, expectedRevision }
              if (terminalRunStatuses.includes(current.status) || current.status === "cancelling") {
                return { type: "ok" as const, row: current }
              }

              const row = yield* tx
                .update(WorkflowRunTable)
                .set({
                  status: "cancelling",
                  revision: sql`${WorkflowRunTable.revision} + 1`,
                  error_category: category,
                  time_updated: now,
                })
                .where(
                  and(
                    eq(WorkflowRunTable.id, input.runID),
                    eq(WorkflowRunTable.status, current.status),
                    eq(WorkflowRunTable.revision, expectedRevision),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              if (!row) return { type: "invalid" as const, current, expectedRevision }

              yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "cancelling",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  error_category: category,
                })
                .where(
                  and(
                    eq(WorkflowStepRunTable.run_id, input.runID),
                    inArray(WorkflowStepRunTable.status, ["running", "dispatching"]),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
              yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "skipped",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                })
                .where(
                  and(
                    eq(WorkflowStepRunTable.run_id, input.runID),
                    inArray(WorkflowStepRunTable.status, ["pending", "ready"]),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
              return { type: "ok" as const, row }
            }),
          )
          .pipe(Effect.orDie)
        if (result.type === "missing") return yield* new WorkflowNotFoundError({ runID: input.runID })
        if (result.type === "invalid") {
          return yield* new InvalidStateTransitionError({
            from: `${result.current.status}@${result.current.revision}`,
            to: "cancelling",
            reason: `Workflow run ${input.runID} changed since revision ${result.expectedRevision}`,
          })
        }
        return rowToRunInfo(result.row)
      },
    )

    const finalizeCancelRun: Interface["finalizeCancelRun"] = Effect.fn("WorkflowRun.finalizeCancelRun")(
      function* (input) {
        const now = Date.now()
        const category: WorkflowAsset.ErrorCategory = isErrorCategory(input.errorCategory)
          ? input.errorCategory
          : "step_cancelled"
        const result = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select()
                .from(WorkflowRunTable)
                .where(eq(WorkflowRunTable.id, input.runID))
                .get()
                .pipe(Effect.orDie)
              if (!current) return { type: "missing" as const }
              const expectedRevision = input.expectedRevision ?? current.revision
              if (current.revision !== expectedRevision) return { type: "invalid" as const, current, expectedRevision }
              if (terminalRunStatuses.includes(current.status)) return { type: "ok" as const, row: current }
              if (current.status !== "cancelling") return { type: "invalid" as const, current, expectedRevision }
              const row = yield* tx
                .update(WorkflowRunTable)
                .set({
                  status: "cancelled",
                  revision: sql`${WorkflowRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                  time_updated: now,
                })
                .where(and(eq(WorkflowRunTable.id, input.runID), eq(WorkflowRunTable.revision, expectedRevision)))
                .returning()
                .get()
                .pipe(Effect.orDie)
              if (!row) return { type: "invalid" as const, current, expectedRevision }
              yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "cancelled",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                })
                .where(and(eq(WorkflowStepRunTable.run_id, input.runID), eq(WorkflowStepRunTable.status, "cancelling")))
                .run()
                .pipe(Effect.orDie)
              return { type: "ok" as const, row }
            }),
          )
          .pipe(Effect.orDie)
        if (result.type === "missing") return yield* new WorkflowNotFoundError({ runID: input.runID })
        if (result.type === "invalid") {
          return yield* new InvalidStateTransitionError({
            from: `${result.current.status}@${result.current.revision}`,
            to: "cancelled",
            reason: `Workflow run ${input.runID} is not finalizable at revision ${result.expectedRevision}`,
          })
        }
        return rowToRunInfo(result.row)
      },
    )

    const cancelStep: Interface["cancelStep"] = Effect.fn("WorkflowRun.cancelStep")(function* (input) {
      const current = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, input.stepRunID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new StepNotFoundError({ stepRunID: input.stepRunID })
      const expectedRevision = input.expectedRevision ?? current.revision
      const category: WorkflowAsset.ErrorCategory = isErrorCategory(input.errorCategory)
        ? input.errorCategory
        : "step_cancelled"
      const updated = yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "cancelled",
          revision: expectedRevision + 1,
          error_category: category,
          time_completed: Date.now(),
        })
        .where(
          and(
            eq(WorkflowStepRunTable.id, input.stepRunID),
            eq(WorkflowStepRunTable.revision, expectedRevision),
            inArray(WorkflowStepRunTable.status, ["dispatching", "running"]),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (updated) return rowToStepInfo(updated)
      if (current.status === "cancelled" || current.status === "cancelling") return rowToStepInfo(current)
      return yield* new InvalidStateTransitionError({
        from: `${current.status}@${current.revision}`,
        to: "cancelling",
        reason: `Workflow step ${input.stepRunID} cannot be cancelled at revision ${expectedRevision}`,
      })
    })

    const completeRun: Interface["completeRun"] = Effect.fn("WorkflowRun.completeRun")(function* (
      rawRunID,
      legacyPartial = false,
    ) {
      const input =
        typeof rawRunID === "string"
          ? { runID: rawRunID, partial: legacyPartial, expectedRevision: undefined }
          : rawRunID
      const runID = input.runID
      const partial = input.partial ?? false
      const now = Date.now()
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(WorkflowRunTable)
              .where(eq(WorkflowRunTable.id, runID))
              .get()
              .pipe(Effect.orDie)
            if (!current) return { type: "missing" as const }
            const expectedRevision = input.expectedRevision ?? current.revision
            if (current.revision !== expectedRevision)
              return { type: "invalid_revision" as const, current, expectedRevision }
            if (terminalRunStatuses.includes(current.status)) return { type: "ok" as const, row: current }

            const unfinished = yield* tx
              .select({ id: WorkflowStepRunTable.id })
              .from(WorkflowStepRunTable)
              .where(
                and(
                  eq(WorkflowStepRunTable.run_id, runID),
                  inArray(WorkflowStepRunTable.status, [
                    "pending",
                    "ready",
                    "dispatching",
                    "running",
                    "cancelling",
                    "execution_unknown",
                  ]),
                ),
              )
              .get()
              .pipe(Effect.orDie)
            if (unfinished) return { type: "invalid" as const, current }

            const row = yield* tx
              .update(WorkflowRunTable)
              .set({
                status: partial ? "partial_success" : "completed",
                revision: sql`${WorkflowRunTable.revision} + 1`,
                time_completed: now,
                time_updated: now,
              })
              .where(and(eq(WorkflowRunTable.id, runID), eq(WorkflowRunTable.revision, expectedRevision)))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!row) return { type: "invalid_revision" as const, current, expectedRevision }
            return { type: "ok" as const, row }
          }),
        )
        .pipe(Effect.orDie)

      if (result.type === "missing") return yield* new WorkflowNotFoundError({ runID })
      if (result.type === "invalid_revision") {
        return yield* new InvalidStateTransitionError({
          from: `${result.current.status}@${result.current.revision}`,
          to: partial ? "partial_success" : "completed",
          reason: `Workflow run ${runID} changed since revision ${result.expectedRevision}`,
        })
      }
      if (result.type === "invalid") {
        return yield* new InvalidStateTransitionError({
          from: result.current.status,
          to: partial ? "partial_success" : "completed",
          reason: `Workflow run ${runID} still has unfinished steps`,
        })
      }
      return rowToRunInfo(result.row)
    })

    const failRun: Interface["failRun"] = Effect.fn("WorkflowRun.failRun")(
      function* (rawRunID, legacyCategory, legacyRevision) {
        const input =
          typeof rawRunID === "string"
            ? { runID: rawRunID, errorCategory: legacyCategory ?? "step_failed", expectedRevision: legacyRevision }
            : rawRunID
        const runID = input.runID
        const now = Date.now()
        const category: WorkflowAsset.ErrorCategory = isErrorCategory(input.errorCategory)
          ? input.errorCategory
          : "step_failed"
        const result = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select()
                .from(WorkflowRunTable)
                .where(eq(WorkflowRunTable.id, runID))
                .get()
                .pipe(Effect.orDie)
              if (!current) return { type: "missing" as const }
              const expectedRevision = input.expectedRevision ?? current.revision
              if (current.revision !== expectedRevision) return { type: "invalid" as const, current, expectedRevision }
              if (terminalRunStatuses.includes(current.status)) return { type: "ok" as const, row: current }

              const row = yield* tx
                .update(WorkflowRunTable)
                .set({
                  status: "failed",
                  revision: sql`${WorkflowRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                  time_updated: now,
                })
                .where(
                  and(
                    eq(WorkflowRunTable.id, runID),
                    eq(WorkflowRunTable.status, current.status),
                    eq(WorkflowRunTable.revision, expectedRevision),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              if (!row) return { type: "invalid" as const, current, expectedRevision }

              yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "cancelled",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                })
                .where(
                  and(
                    eq(WorkflowStepRunTable.run_id, runID),
                    // Every dispatched step must settle (ADR-18 §2.2). `dispatching`
                    // and `cancelling` are dispatched-but-unsettled: a sibling that
                    // was interrupted between `dispatchStep` and `startStep` sits in
                    // `dispatching`, and `completeRun` refuses to settle a run that
                    // still holds either — so omitting them here leaves an orphan
                    // step under a terminal run that `recoverRunning` can never
                    // reach (it early-returns for terminal runs).
                    inArray(WorkflowStepRunTable.status, ["running", "dispatching", "cancelling"]),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
              yield* tx
                .update(WorkflowStepRunTable)
                .set({
                  status: "skipped",
                  revision: sql`${WorkflowStepRunTable.revision} + 1`,
                  error_category: category,
                  time_completed: now,
                })
                .where(
                  and(
                    eq(WorkflowStepRunTable.run_id, runID),
                    inArray(WorkflowStepRunTable.status, ["pending", "ready"]),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
              return { type: "ok" as const, row }
            }),
          )
          .pipe(Effect.orDie)
        if (result.type === "missing") return yield* new WorkflowNotFoundError({ runID })
        if (result.type === "invalid") {
          return yield* new InvalidStateTransitionError({
            from: `${result.current.status}@${result.current.revision}`,
            to: "failed",
            reason: `Workflow run ${runID} changed since revision ${result.expectedRevision}`,
          })
        }
        return rowToRunInfo(result.row)
      },
    )

    return Service.of({
      create,
      getOrCreate,
      get,
      getBySession,
      getSteps,
      findReadySteps,
      dispatchStep,
      startStep,
      settleStep,
      retryStep,
      retryRun,
      recoverRunning,
      cancelRun,
      finalizeCancelRun,
      cancelStep,
      completeRun,
      failRun,
    } satisfies Interface)
  }),
)

export const locationLayer = layer
export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
