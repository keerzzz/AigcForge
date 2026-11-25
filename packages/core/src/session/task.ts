export * as SessionTask from "./task"

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { SqlError, UniqueViolation } from "effect/sql/SqlError"
import { Permission } from "@omnixa/schema/permission"
import { SessionMessage } from "@omnixa/schema/session-message"
import { SessionTask } from "@omnixa/schema/session-task"
import { SessionTaskEvent } from "@omnixa/schema/session-task-event"
import { Database } from "../database/database"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { nextRun } from "./schedule"
import { ScheduleTask } from "./schedule-task"
import { TaskDag } from "./dag"
import { SessionSchema } from "./schema"
import { SessionInboxTable, SessionMessageTable, TaskTable } from "./sql"
import { KVTable } from "../kv/sql"
import { WorkflowRunTable, WorkflowStepRunTable } from "../workflow/sql"
import { SessionInputResult } from "./input-result"
import { DelegationReceipt } from "../delegation/receipt"
import { TaskOperation, OperationConflictError } from "./task-operation"
import type { Location } from "@omnixa/schema/location"
import type { ProductMode } from "@omnixa/schema/product-mode"
import type { SessionGoalID } from "@omnixa/schema/session-goal-id"

export { OperationConflictError }
export {
  OperationID,
  OperationDigest,
  OperationRequest,
  OperationInfo,
  OperationSource,
  OperationToolSource,
  OperationUserSource,
  OperationGoalSource,
  OperationScheduleSource,
  OperationSelection,
  OperationPrepared,
  OperationChange,
  OperationResultRef,
  OperationError,
  OperationReadonlyRef,
  OperationNewRootTarget,
  OperationExistingRootTarget,
  TaskCoordination,
} from "@omnixa/schema/session-task"

export const Info = SessionTask.Info
export type Info = typeof Info.Type

/** @internal Invocation identity stays outside every model and HTTP input schema. */
type WriteOptions = {
  readonly management?: Permission.Source
  readonly claim?: Permission.Source
  readonly handoff?: { readonly source: Permission.Source; readonly revision: number }
  readonly settle?: { readonly source: Permission.Source; readonly revision: number }
  readonly commit?: (task: Info) => Effect.Effect<void>
}

class ExecutionClaim extends Schema.Class<ExecutionClaim>("SessionTask.ExecutionClaim")({
  parentTaskID: Schema.String,
  parentTaskRevision: Schema.Int,
  source: Permission.Source,
  operationID: Schema.optional(SessionTask.OperationID),
}) {}

const claimKey = (sessionID: string, id: string) => `task:claim:${sessionID}:${id}`
const sameSource = (left: Permission.Source, right: Permission.Source) => {
  if (left.type === "tool" && right.type === "tool") return left.messageID === right.messageID && left.id === right.id
  if (left.type === "operation" && right.type === "operation")
    return left.sessionID === right.sessionID && left.operationID === right.operationID
  return false
}

/**
 * Write shape accepted by {@link SessionTask.update}/{@link SessionTask.append}/
 * {@link SessionTask.replaceLegacy}. `id` is optional: absent tasks are minted a
 * stable `tsk_` id. M0 persists id/content/status/priority/parentID/sessionID;
 * M2 adds `output_digest`, written through {@link SessionTask.patch}.
 */
export class WriteInfo extends Schema.Class<WriteInfo>("SessionTask.WriteInfo")({
  id: Schema.optional(Schema.String),
  content: Schema.String,
  status: SessionTask.TaskStatus,
  priority: SessionTask.TaskPriority,
  parentID: Schema.optional(Schema.String),
  // M3: scheduled jobs — owning agent, next trigger, and repetition rule.
  agentID: Schema.optional(Schema.String),
  scheduledAt: Schema.optional(Schema.Number),
  recurrence: Schema.optional(SessionTask.TaskRecurrence),
  // M5: spawning & DAG — originating message id and predecessor task ids.
  spawnedFrom: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * A client-supplied task that cannot be reconciled: `foreign` ids are not
 * owned by the target session (a forge attempt or stale reference), `duplicate`
 * ids repeat a prior id in the same payload, `invalid_schedule` carries a dead
 * schedule — a recurrence cron that is malformed or has no future run, or a
 * `scheduled` task with no trigger (no scheduledAt, no enabled recurrence).
 * `depends_on_cycle` rejects a DAG that would never fire (no task in a cycle can
 * trigger). The first two would otherwise hit the global `task.id` PK constraint
 * and surface as an unhandled 500 defect; all four are rejected up front as a
 * typed failure (HTTP 400).
 */
export class TaskWriteError extends Schema.TaggedError<TaskWriteError>()("SessionTask.TaskWriteError", {
  sessionID: SessionSchema.ID,
  id: Schema.optional(Schema.String),
  reason: Schema.Literals([
    "foreign",
    "duplicate",
    "invalid_schedule",
    "depends_on_cycle",
    "stale_revision",
    "execution_owned",
    "dependencies_unfinished",
  ]),
  // Which half of the `invalid_schedule` guard fired (see `scheduleFailureKind`):
  // `cron` = recurrence malformed / no future run, `trigger` = scheduled without
  // a scheduledAt or enabled recurrence. Absent for the other reasons.
  schedule: Schema.optional(Schema.Literals(["cron", "trigger"])),
  blockedBy: Schema.optional(Schema.Array(Schema.String)),
}) {
  override get message() {
    switch (this.reason) {
      case "foreign":
        return `Task id "${this.id}" is not owned by session ${this.sessionID}`
      case "duplicate":
        return `Duplicate task id "${this.id}" in payload for session ${this.sessionID}`
      case "invalid_schedule":
        if (this.schedule === "trigger") {
          return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} is scheduled but has no trigger: it must have a scheduledAt or an enabled recurrence`
        }
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} has an invalid recurrence cron: it is malformed or has no future run within the search window`
      case "depends_on_cycle":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} introduces a dependency cycle; no task in the cycle can ever be triggered`
      case "stale_revision":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} changed since the caller last read it; retry with the current revision`
      case "execution_owned":
        return `Task "${this.id}" in session ${this.sessionID} is owned by unsettled execution; use its execution controls`
      case "dependencies_unfinished":
        return `Task "${this.id}" in session ${this.sessionID} has unfinished dependencies: ${this.blockedBy?.join(", ")}`
    }
    // Unreachable: reason is a closed literal union (narrowed to `never` here),
    // but consistent-return requires every path to return.
    return `Task write failed in session ${this.sessionID} (reason: ${String(this.reason)})`
  }
}

/**
 * Compatibility projection of a task into the legacy three-field todo shape so
 * existing App/TUI `todo.updated` consumers keep working against the task source.
 */
export const TodoProjection = SessionTaskEvent.TodoProjection
export type TodoProjection = typeof TodoProjection.Type

/**
 * Runtime execution phase for a task's current provider turn (P2). Ephemeral -
 * never persisted on the task row; carried only by `task.progress` events so the
 * UI can show a determinate pulse when a tool reports `current/total`.
 */
export const TaskExecutionPhase = SessionTaskEvent.TaskExecutionPhase
export type TaskExecutionPhase = typeof TaskExecutionPhase.Type

export const Event = {
  Updated: SessionTaskEvent.Updated,
  /**
   * M1.5 telemetry for the Work dialogue-level resume entry point (PRD §12,
   * defined following the work.artifact_applied pattern). The resume is
   * triggered client-side (SessionTodoProgress sends a preset prompt), so this
   * type is available for consumers before a server emission channel exists.
   */
  StepResumed: Bus.ephemeral({
    type: "work.step_resumed",
    schema: {
      sessionID: SessionSchema.ID,
    },
  }),
  /** Legacy `todo.updated` projection emitted alongside every task write. */
  TodoUpdated: SessionTaskEvent.TodoUpdated,
  /**
   * Ephemeral runtime progress for a task (P2). Published by execution sources
   * (e.g. the `task` delegation tool reporting child-session completion ratio);
   * never persisted - the app keeps only the latest snapshot in memory.
   */
  Progress: SessionTaskEvent.Progress,
}

export interface Interface {
  /** Internal reservation; public callers submit requests through Session.dispatchTask. */
  readonly reserveOperation: (input: {
    readonly sessionID: SessionSchema.ID
    readonly request: SessionTask.OperationRequest
    readonly source: SessionTask.OperationSource
    readonly selection: SessionTask.OperationSelection
    readonly sourceLocation: Location.Ref
    readonly sourceMode: ProductMode.ID
    readonly targetSessionID?: SessionSchema.ID
    readonly goalRounds?: readonly SessionGoalID.RoundRef[]
  }) => Effect.Effect<
    { readonly operation: SessionTask.OperationInfo; readonly created: boolean },
    TaskWriteError | OperationConflictError
  >
  readonly operation: (input: TaskOperation.Ref) => Effect.Effect<SessionTask.OperationInfo | undefined>
  readonly operations: (input: {
    readonly sessionID: SessionSchema.ID
    readonly taskID?: string
  }) => Effect.Effect<ReadonlyArray<SessionTask.OperationInfo>>
  /** Attach a new Task only after the operation's permission is allowed. */
  readonly attachOperationTask: (
    input: TaskOperation.Ref,
  ) => Effect.Effect<SessionTask.OperationInfo, OperationConflictError>
  readonly claimWaitingOperation: (
    input: TaskOperation.Ref,
  ) => Effect.Effect<SessionTask.OperationInfo, OperationConflictError>
  /** Service-owned facts; source/target/request identity stays immutable. */
  readonly advanceOperation: (
    input: TaskOperation.Ref & {
      readonly change: SessionTask.OperationChange
      readonly expect?: readonly SessionTask.OperationPhase[]
    },
  ) => Effect.Effect<SessionTask.OperationInfo, OperationConflictError>
  /**
   * Reconcile a session's task list by id: upsert present rows, delete absent ones, republish.
   * Fails with {@link TaskWriteError} when a client-supplied id is foreign to the session
   * or duplicated within the payload.
   */
  readonly update: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
      /**
       * Full-list optimistic-concurrency guard (P3-c): the max revision the caller
       * observed across the session's tasks. If any task's current revision exceeds
       * it, a concurrent write landed between the caller's read and this replace;
       * the stale plan is rejected with `stale_revision` so it can't overwrite
       * newer state.
       */
      readonly expectedRevision?: number
    },
    options?: WriteOptions,
  ) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Append new tasks at the end of the session's list in a single transaction.
   * Positions are computed and the full list is re-read atomically, so
   * concurrent appends (multiple task tool calls in one provider turn) never
   * drop each other's rows — unlike a read-modify-reconcile.
   */
  readonly append: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
    },
    options?: WriteOptions,
  ) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Legacy todowrite bridge: reconcile by position, reusing existing ids so a
   * delegation writeback to a linked task survives a later full-list replace.
   * New positions mint ids, trailing rows are removed, all in one transaction.
   * `expectedRevision` is the max revision the caller observed across the
   * session's tasks (see {@link Interface.update}); a mismatch means another
   * write path landed in between and the stale replace fails `stale_revision`.
   */
  readonly replaceLegacy: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
      readonly expectedRevision?: number
    },
    options?: WriteOptions,
  ) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Target a single task by id and update its status (delegation writeback).
   * Other rows are untouched; `outputDigest` is persisted (M2) and rides the
   * returned Info and the republished `task.updated` event.
   * When `expect` is set, the patch only lands while the current status is one
   * of the expected ones (checked inside the write lock) and resolves
   * `undefined` otherwise — the conditional-claim primitive for
   * ScheduledJob.trigger's pause/claim race.
   */
  readonly patch: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly status: SessionTask.TaskStatus
      readonly outputDigest?: string
      readonly expect?: ReadonlyArray<SessionTask.TaskStatus>
      /**
       * Optimistic-concurrency guard (P3-a): when set, the patch only lands while
       * the current revision matches. Resolves `undefined` otherwise (no write),
       * mirroring {@link expect}'s conditional-claim semantics.
       */
      readonly expectedRevision?: number
    },
    options?: WriteOptions,
  ) => Effect.Effect<Info | undefined, TaskWriteError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  /**
   * Every task across all sessions (M4 Agent Hub aggregation source). Rows keep
   * their owning `sessionID` and `agentID` so the client can group by agent and
   * surface unassigned tasks.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<Info>>
  /** Remove every task owned by the session. */
  readonly delete: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /**
   * Remove a single task by id (atomic, differential-review HIGH-2): deletes
   * only that row — other rows are untouched and no full-list reconcile runs —
   * and republishes `task.updated`. `undefined` when the id is not owned by the
   * session.
   */
  readonly removeTask: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
    },
    options?: WriteOptions,
  ) => Effect.Effect<Info | undefined, TaskWriteError>
  /**
   * Update a single task's status and fields in one write, without a full-list
   * reconcile (P3-b). Other rows are untouched; `expectedRevision` rejects stale
   * writes the same way {@link patch} does. Resolves `undefined` when the id is unknown or
   * the revision is stale (no write).
   */
  readonly updateTask: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly status?: SessionTask.TaskStatus
      readonly content?: string
      readonly priority?: SessionTask.TaskPriority
      readonly outputDigest?: string
      readonly expectedRevision?: number
    },
    options?: WriteOptions,
  ) => Effect.Effect<Info | undefined, TaskWriteError>
  /**
   * Reorder a session's tasks by id (P3-b). `ids` must be a permutation of the
   * session's current task ids; otherwise fails with `foreign`/`duplicate`.
   * `expectedRevision` is the max revision the caller observed across all tasks;
   * if any task's revision exceeds it, the caller's view is stale and the reorder
   * fails with `stale_revision`. All tasks get `revision + 1` (structural change).
   */
  readonly reorder: (
    input: {
      readonly sessionID: SessionSchema.ID
      readonly ids: readonly string[]
      readonly expectedRevision?: number
    },
    options?: WriteOptions,
  ) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /** Release only the original execution's claim after its authoritative settlement. */
  readonly releaseClaim: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly revision: number
    readonly source: Permission.Source
  }) => Effect.Effect<void>
  /**
   * Publish an ephemeral `task.progress` event (P2). No DB write - the app keeps
   * the latest snapshot in memory for a determinate pulse when a tool reports
   * `current/total`. `phase` is always required; `progress`/`current`/`total`
   * are optional (phase-only when the source has no discrete count).
   */
  readonly recordProgress: (input: {
    readonly sessionID: SessionSchema.ID
    readonly taskID: string
    readonly phase: TaskExecutionPhase
    readonly progress?: number
    readonly current?: number
    readonly total?: number
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/SessionTask") {}

type TaskRow = typeof TaskTable.$inferSelect

/**
 * Fallback for Tasks without a canonical Schedule rule: scheduled/pending Tasks
 * use the next cron match after `now`, or their one-shot `scheduledAt`.
 */
const resolveNextRun = (
  input: {
    status: TaskRow["status"]
    scheduledAt?: number
    recurrence?: SessionTask.TaskRecurrence
  },
  now: number,
) => {
  if (input.status !== "scheduled" && input.status !== "pending") return undefined
  if (input.recurrence?.enabled) return nextRun(input.recurrence.cron, now, input.recurrence.timezone)
  return input.scheduledAt
}

const toInfo = (row: TaskRow, now: number, schedule?: { readonly nextRun: number | undefined }): Info => {
  const run = schedule
    ? schedule.nextRun
    : resolveNextRun(
        { status: row.status, scheduledAt: row.scheduled_at ?? undefined, recurrence: row.recurrence ?? undefined },
        now,
      )
  return new Info({
    id: row.id,
    content: row.content,
    status: row.status,
    priority: row.priority,
    sessionID: row.session_id,
    ...(row.parent_id ? { parentID: row.parent_id } : {}),
    ...(row.output_digest ? { outputDigest: row.output_digest } : {}),
    ...(row.agent_id ? { agentID: row.agent_id } : {}),
    ...(row.scheduled_at !== null && row.scheduled_at !== undefined ? { scheduledAt: row.scheduled_at } : {}),
    ...(row.recurrence ? { recurrence: row.recurrence } : {}),
    ...(run !== undefined ? { nextRun: run } : {}),
    ...(row.spawned_from ? { spawnedFrom: row.spawned_from } : {}),
    ...(row.depends_on && row.depends_on.length > 0 ? { dependsOn: row.depends_on } : {}),
    ...(row.operation_id
      ? {
          operationRef: new SessionTask.OperationReadonlyRef({
            sourceSessionID: row.session_id,
            operationID: row.operation_id,
          }),
        }
      : {}),
    revision: row.revision,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

/**
 * Materialize a WriteInfo class instance into a plain planned record with its
 * (possibly minted) id. Class instances must not be spread (no-misused-spread),
 * so the write paths project fields explicitly; every optional consumer below
 * reads with `??`/`?.`, making `undefined` and absent equivalent.
 */
const planTask = (task: typeof WriteInfo.Type, id: string) => ({
  id,
  content: task.content,
  status: task.status,
  priority: task.priority,
  parentID: task.parentID,
  agentID: task.agentID,
  scheduledAt: task.scheduledAt,
  recurrence: task.recurrence,
  spawnedFrom: task.spawnedFrom,
  dependsOn: task.dependsOn,
})

type CycleNode = { id: string; status: string; dependsOn?: readonly string[] }

/**
 * Build the DAG cycle-check graph (differential-review MEDIUM-1): the local
 * nodes plus every predecessor referenced across sessions, resolved
 * transitively. The runtime trigger (scheduled-job.ts) queries predecessors
 * globally by id, so the write-time cycle check must see the same cross-session
 * graph — otherwise a permanent cross-session cycle (A→B in session 1, B→A in
 * session 2) could be constructed without either write noticing. Referenced-but-
 * absent predecessors resolve to a leaf (the trigger's `blockedBy` releases
 * deleted predecessors), so they cannot fabricate a cycle.
 */
const reachableCycleGraph = (
  fetchByIds: (ids: readonly string[]) => Effect.Effect<readonly CycleNode[]>,
  local: readonly CycleNode[],
): Effect.Effect<readonly CycleNode[]> =>
  Effect.gen(function* () {
    const nodes = new Map<string, CycleNode>()
    for (const node of local) nodes.set(node.id, node)
    let frontier: readonly string[] = [...nodes.keys()]
    while (frontier.length > 0) {
      const referenced = new Set<string>()
      for (const id of frontier) {
        for (const dep of nodes.get(id)?.dependsOn ?? []) if (!nodes.has(dep)) referenced.add(dep)
      }
      const missing = [...referenced].filter((id) => !nodes.has(id))
      if (missing.length === 0) break
      // Placeholder for referenced-but-absent predecessors (deleted row).
      for (const id of missing) nodes.set(id, { id, status: "released" })
      const fetched = yield* fetchByIds(missing)
      for (const row of fetched) nodes.set(row.id, row)
      frontier = missing
    }
    return [...nodes.values()]
  })

// Recurrence edits retain a fixed timezone until the caller explicitly replaces it.
function recurrenceFor(
  recurrence: SessionTask.TaskRecurrence | null | undefined,
  prior: SessionTask.TaskRecurrence | null | undefined,
) {
  if (recurrence == null) return prior ?? undefined
  if (recurrence.timezone !== undefined || prior?.timezone === undefined) return recurrence
  return { ...recurrence, timezone: prior.timezone }
}

/**
 * Schedule invariant (differential-review HIGH-4, re-review M-1): identifies a
 * task that can never fire — `"cron"` when a recurrence's cron is malformed or
 * has no future run, `"trigger"` when a `scheduled` status carries no real
 * trigger (an enabled recurrence with a future cron match, or a one-shot
 * scheduledAt). `undefined` means the schedule is live. The effective schedule
 * applies the preserve-omitted rule (input ?? prior), so a reconcile / legacy
 * replace that omits schedule fields against a schedule-bearing row stays
 * valid. Shared by update / append / replaceLegacy / updateTask / patch so no write path can
 * persist a dead job.
 */
const scheduleFailureKind = (
  task: { status: string; recurrence?: SessionTask.TaskRecurrence | null; scheduledAt?: number | null },
  prior: { recurrence?: SessionTask.TaskRecurrence | null; scheduled_at?: number | null } | undefined,
  now: number,
): "cron" | "trigger" | undefined => {
  // Existing malformed schedules must remain cancellable; new rows still validate.
  if (task.status === "cancelled" && prior !== undefined) return undefined
  const effectiveRecurrence = recurrenceFor(task.recurrence, prior?.recurrence)
  const effectiveScheduledAt = task.scheduledAt ?? prior?.scheduled_at ?? undefined
  if (
    effectiveRecurrence !== undefined &&
    nextRun(effectiveRecurrence.cron, now, effectiveRecurrence.timezone) === undefined
  )
    return "cron"
  if (task.status === "scheduled") {
    const hasTrigger = effectiveRecurrence?.enabled
      ? nextRun(effectiveRecurrence.cron, now, effectiveRecurrence.timezone) !== undefined
      : effectiveScheduledAt !== undefined && Number.isFinite(effectiveScheduledAt)
    return hasTrigger ? undefined : "trigger"
  }
  return undefined
}

// Process-level single-writer mutex for ALL task mutations (differential-review
// re-review HIGH-2 / BLOCKER-1): SQLite's deferred transactions do NOT
// serialize two concurrent appends across sessions, so an in-transaction cycle
// check alone could let both close a cycle. Module scope keeps one lock shared
// by every SessionTask instance — HTTP/scheduler (`node`) and the per-Location
// tool graphs (location-layer.ts builds `SessionTask.layer` under `Layer.fresh`)
// would otherwise each own a private Semaphore and the serialization guarantee
// would silently vanish (the plan's scheduler is single-process).
const writeLock = Semaphore.makeUnsafe(1)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* Bus.Service

    const read = (sessionID: SessionSchema.ID) =>
      db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, sessionID))
        .orderBy(asc(TaskTable.position))
        .all()
        .pipe(Effect.orDie)

    const readInfo = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, now: number) {
      const schedules = yield* ScheduleTask.nextRuns(db, sessionID)
      return (yield* read(sessionID)).map((row) => toInfo(row, now, schedules.get(row.id)))
    })

    const readClaim = (sessionID: SessionSchema.ID, id: string) =>
      db
        .select({ value: KVTable.value })
        .from(KVTable)
        .where(eq(KVTable.key, claimKey(sessionID, id)))
        .get()
        .pipe(
          Effect.map((row) =>
            Option.getOrUndefined(Schema.decodeUnknownOption(Schema.toCodecJson(ExecutionClaim))(row?.value)),
          ),
          Effect.orDie,
        )

    const saveClaim = (task: Info, source: Permission.Source, operationID?: SessionTask.OperationID) => {
      const value = Schema.encodeSync(Schema.toCodecJson(ExecutionClaim))(
        new ExecutionClaim({
          parentTaskID: task.id,
          parentTaskRevision: task.revision,
          source,
          ...(operationID !== undefined ? { operationID } : {}),
        }),
      )
      return db
        .insert(KVTable)
        .values({ key: claimKey(task.sessionID, task.id), value })
        .onConflictDoUpdate({
          target: KVTable.key,
          set: { value, time_updated: task.updatedAt },
        })
        .run()
        .pipe(Effect.orDie)
    }

    const releaseOwned = Effect.fnUntraced(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly revision: number
      readonly source: Permission.Source
    }) {
      const current = yield* readClaim(input.sessionID, input.id)
      if (!current || current.parentTaskRevision !== input.revision || !sameSource(current.source, input.source)) return
      yield* db
        .delete(KVTable)
        .where(eq(KVTable.key, claimKey(input.sessionID, input.id)))
        .run()
        .pipe(Effect.orDie)
    })

    // Legacy execution remains discoverable through its original persisted owners.
    // These are database reads only: taking a Workflow/Delegation lock here would invert lock order.
    const legacyOwned = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      task: { id: string; status: string },
    ) {
      const children = yield* db
        .select({ id: TaskTable.id })
        .from(TaskTable)
        .where(and(eq(TaskTable.session_id, sessionID), eq(TaskTable.parent_id, task.id)))
        .all()
        .pipe(Effect.orDie)
      if ((yield* Effect.forEach(children, (child) => readClaim(sessionID, child.id))).some(Boolean)) return true
      const ids = [task.id, ...children.map((child) => child.id)]
      const workflow = yield* db
        .select({ id: WorkflowRunTable.id })
        .from(WorkflowRunTable)
        .where(
          and(
            eq(WorkflowRunTable.session_id, sessionID),
            inArray(sql<string>`json_extract(${WorkflowRunTable.task_binding}, '$.parentTaskID')`, ids),
            sql`${WorkflowRunTable.status} NOT IN ('completed', 'partial_success', 'failed', 'cancelled')`,
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (workflow) return true
      const step = yield* db
        .select({ id: WorkflowStepRunTable.id })
        .from(WorkflowStepRunTable)
        .where(
          and(
            inArray(WorkflowStepRunTable.task_id, ids),
            sql`${WorkflowStepRunTable.status} IN ('dispatching', 'running', 'cancelling', 'execution_unknown')`,
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (step) return true
      const inputs = yield* db
        .select({
          id: SessionInboxTable.id,
          sessionID: SessionInboxTable.session_id,
        })
        .from(SessionInboxTable)
        .where(inArray(sql<string>`json_extract(${SessionInboxTable.payload}, '$.metadata.task.parentTaskID')`, ids))
        .all()
        .pipe(Effect.orDie)
      const projected = yield* db
        .select({
          id: SessionMessageTable.id,
          sessionID: SessionMessageTable.session_id,
        })
        .from(SessionMessageTable)
        .where(inArray(sql<string>`json_extract(${SessionMessageTable.data}, '$.metadata.task.parentTaskID')`, ids))
        .all()
        .pipe(Effect.orDie)
      const executing = yield* Effect.forEach([...inputs, ...projected], (input) =>
        Effect.gen(function* () {
          const result = yield* SessionInputResult.read(db, { sessionID: input.sessionID, inputID: input.id }).pipe(
            Effect.orDie,
          )
          return result.status === "pending" || result.status === "processing" || result.status === "unverified"
        }),
      )
      if (executing.some(Boolean)) return true
      const external = yield* db
        .select({ value: KVTable.value })
        .from(KVTable)
        .where(
          and(
            sql`${KVTable.key} LIKE 'delegation:external:%'`,
            sql`json_extract(${KVTable.value}, '$.parentSessionID') = ${sessionID}`,
            inArray(sql<string>`json_extract(${KVTable.value}, '$.parentTaskID')`, ids),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      for (const entry of external) {
        const binding = Option.getOrUndefined(Schema.decodeUnknownOption(DelegationReceipt.Binding)(entry.value))
        if (!binding) continue
        if (binding.settlement?.status === "recovery_required") return true
        if (binding.settlement) continue
        if (binding.execution === "start_unknown") return true
        const job = yield* db
          .select({ value: KVTable.value })
          .from(KVTable)
          .where(
            and(
              sql`${KVTable.key} LIKE 'job.background/%'`,
              sql`json_extract(${KVTable.value}, '$.recovery.delegationID') = ${binding.delegationID}`,
              sql`json_extract(${KVTable.value}, '$.recovery.participantID') = ${binding.participantID}`,
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (job && typeof job.value === "object" && job.value !== null && "status" in job.value) {
          if (job.value.status === "running") return true
          if (job.value.status === "completed" || job.value.status === "error" || job.value.status === "cancelled")
            continue
        }
        // Non-Tool operations are tracked by their durable Task operation, never a fabricated Tool locator.
        if (binding.source.type !== "tool") return true
        const saved = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, SessionMessage.ID.make(binding.source.messageID)))
          .get()
          .pipe(Effect.orDie)
        const assistant =
          saved === undefined
            ? undefined
            : Option.getOrUndefined(
                Schema.decodeUnknownOption(SessionMessage.Assistant)({ ...saved.data, id: saved.id, type: saved.type }),
              )
        const tool = assistant?.content.find((item) => item.type === "tool" && item.id === binding.source.id)
        if (tool?.type === "tool") {
          if (tool.state.status === "streaming" || tool.state.status === "running") return true
          const metadata = tool.state.status === "completed" ? tool.state.metadata : undefined
          if (metadata && typeof metadata === "object" && "status" in metadata) {
            if (metadata.status === "running" || metadata.status === "recovery_required") return true
            if (metadata.status === "completed" || metadata.status === "failed" || metadata.status === "cancelled")
              continue
          }
        }
        return true
      }
      return false
    })

    const managedConflict = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      tasks: ReadonlyArray<{ id: string; status: string }>,
      options?: WriteOptions,
    ) {
      if (!options?.management) return
      for (const task of tasks) {
        if ((yield* readClaim(sessionID, task.id)) || (yield* legacyOwned(sessionID, task)))
          return new TaskWriteError({ sessionID, id: task.id, reason: "execution_owned" })
      }
    })

    // Completion uses the same terminal/deleted-predecessor policy as scheduling.
    // Original execution settlement owns its outcome even if a predecessor is later reopened.
    const completionConflict = Effect.fn("SessionTask.completionConflict")(function* (
      connection: Pick<Database.Interface["db"], "select">,
      sessionID: SessionSchema.ID,
      changes: readonly (TaskDag.DagTask & {
        readonly previousStatus?: string
        readonly previousDependsOn?: readonly string[]
      })[],
      options?: WriteOptions,
      removed: readonly string[] = [],
    ) {
      if (options?.settle) return undefined
      const completed = changes.filter(
        (task) =>
          task.status === "completed" &&
          (task.previousStatus !== "completed" ||
            (task.dependsOn ?? []).some((id) => !task.previousDependsOn?.includes(id))),
      )
      const ids = [...new Set(completed.flatMap((task) => task.dependsOn ?? []))]
      if (ids.length === 0) return undefined
      const predecessors = yield* connection
        .select()
        .from(TaskTable)
        .where(inArray(TaskTable.id, ids))
        .all()
        .pipe(Effect.orDie)
      const graph = [
        ...new Map(
          [
            ...predecessors
              .filter((row) => !removed.includes(row.id))
              .map((row) => ({ id: row.id, status: row.status })),
            ...changes,
          ].map((task) => [task.id, task]),
        ).values(),
      ]
      for (const task of completed) {
        const blockedBy = TaskDag.blockedBy(graph, task.id)
        if (blockedBy.length > 0)
          return new TaskWriteError({ sessionID, id: task.id, reason: "dependencies_unfinished", blockedBy })
      }
      return undefined
    })

    const releaseClaim = Effect.fn("SessionTask.releaseClaim")(
      (input: {
        readonly sessionID: SessionSchema.ID
        readonly id: string
        readonly revision: number
        readonly source: Permission.Source
      }) => writeLock.withPermits(1)(releaseOwned(input)),
    )

    const publishBoth = (sessionID: SessionSchema.ID, tasks: ReadonlyArray<Info>) =>
      Effect.gen(function* () {
        yield* events.publish(Event.Updated, { sessionID, tasks })
        yield* events.publish(Event.TodoUpdated, {
          sessionID,
          todos: tasks.map(
            (task) => new TodoProjection({ content: task.content, status: task.status, priority: task.priority }),
          ),
        })
      })

    const reserveOperation = Effect.fn("SessionTask.reserveOperation")(
      (input: Parameters<Interface["reserveOperation"]>[0]) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const existing = yield* TaskOperation.get(db, {
              sessionID: input.sessionID,
              operationID: input.request.operationID,
            })
            if (existing) {
              if (existing.requestDigest !== TaskOperation.requestDigest(input.request))
                return yield* new OperationConflictError({
                  sessionID: input.sessionID,
                  operationID: input.request.operationID,
                  reason: "request_changed",
                })
              if (!TaskOperation.sameOrigin(existing.source, input.source))
                return yield* new OperationConflictError({
                  sessionID: input.sessionID,
                  operationID: input.request.operationID,
                  reason: "source_changed",
                })
              return { operation: existing, created: false }
            }
            if (input.source.sessionID !== input.sessionID)
              return yield* new OperationConflictError({
                sessionID: input.sessionID,
                operationID: input.request.operationID,
                reason: "source_changed",
              })
            const task =
              input.request.taskID === undefined
                ? undefined
                : yield* db
                    .select()
                    .from(TaskTable)
                    .where(and(eq(TaskTable.session_id, input.sessionID), eq(TaskTable.id, input.request.taskID)))
                    .get()
                    .pipe(Effect.orDie)
            if (input.request.taskID !== undefined && !task)
              return yield* new OperationConflictError({
                sessionID: input.sessionID,
                operationID: input.request.operationID,
                reason: "task_missing",
              })
            if (
              task &&
              input.request.expectedRevision !== undefined &&
              task.revision !== input.request.expectedRevision
            )
              return yield* new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "stale_revision" })
            const claim = task ? yield* readClaim(input.sessionID, task.id) : undefined
            if (claim && claim.operationID === undefined)
              return yield* new TaskWriteError({ sessionID: input.sessionID, id: task?.id, reason: "execution_owned" })
            if (task && !claim && (yield* legacyOwned(input.sessionID, task)))
              return yield* new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "execution_owned" })
            const waiting = task
              ? (yield* TaskOperation.list(db, { sessionID: input.sessionID, taskID: task.id })).filter(
                  (operation) => operation.phase === "waiting",
                )
              : []
            const predecessorID = waiting.at(-1)?.operationID ?? claim?.operationID
            const now = (yield* DateTime.nowAsDate).getTime()
            const data = {
              sessionID: input.sessionID,
              request: input.request,
              source: input.source,
              selection: input.selection,
              sourceLocation: input.sourceLocation,
              sourceMode: input.sourceMode,
              targetSessionID:
                input.request.target.type === "existing_root"
                  ? input.request.target.sessionID
                  : (input.targetSessionID ?? SessionSchema.ID.create()),
              taskRevision: task && predecessorID === undefined ? task.revision + 1 : undefined,
              predecessorID,
              goalRounds: input.goalRounds,
            }
            yield* events
              .publish(SessionTaskEvent.OperationReserved, data, {
                commit: (seq) =>
                  Effect.gen(function* () {
                    const previous = yield* read(input.sessionID)
                    yield* TaskOperation.projectReserved(db, data, now, seq)
                    yield* TaskOperation.assertFreeInput(db, {
                      sessionID: input.sessionID,
                      operationID: input.request.operationID,
                      inputID: input.request.inputID,
                      projected: true,
                    }).pipe(Effect.orDie)
                    if (!task || predecessorID !== undefined) return undefined
                    const updated = yield* db
                      .update(TaskTable)
                      .set({
                        status: "in_progress",
                        operation_id: input.request.operationID,
                        revision: task.revision + 1,
                        time_updated: now,
                      })
                      .where(
                        and(
                          eq(TaskTable.session_id, input.sessionID),
                          eq(TaskTable.id, task.id),
                          eq(TaskTable.revision, task.revision),
                        ),
                      )
                      .returning({ id: TaskTable.id })
                      .get()
                      .pipe(Effect.orDie)
                    if (!updated)
                      return yield* Effect.die(
                        new OperationConflictError({
                          sessionID: input.sessionID,
                          operationID: input.request.operationID,
                          reason: "phase_changed",
                        }),
                      )
                    const saved = yield* TaskOperation.get(db, {
                      sessionID: input.sessionID,
                      operationID: input.request.operationID,
                    })
                    if (!saved) return yield* Effect.die(new Error("Task operation reservation was not projected"))
                    const row = yield* db
                      .select()
                      .from(TaskTable)
                      .where(eq(TaskTable.id, task.id))
                      .get()
                      .pipe(Effect.orDie)
                    if (row)
                      yield* saveClaim(toInfo(row, now), TaskOperation.permissionSource(saved), saved.operationID)
                    yield* ScheduleTask.sync(db, { sessionID: input.sessionID, now, previous, execution: true })
                    return undefined
                  }),
              })
              .pipe(
                Effect.catchDefect((error) => {
                  if (error instanceof OperationConflictError) return Effect.fail(error)
                  // The reservation projector runs before the commit hook in the same transaction.
                  const cause =
                    error instanceof EffectDrizzleQueryError && Cause.isCause(error.cause)
                      ? Cause.findErrorOption(error.cause)
                      : Option.none()
                  if (
                    Option.isSome(cause) &&
                    cause.value instanceof SqlError &&
                    cause.value.reason instanceof UniqueViolation &&
                    cause.value.reason.constraint === "task_operation.input_id"
                  )
                    return Effect.fail(
                      new OperationConflictError({
                        sessionID: input.sessionID,
                        operationID: input.request.operationID,
                        reason: "input_owned",
                      }),
                    )
                  return Effect.die(error)
                }),
              )
            if (task && predecessorID === undefined)
              yield* publishBoth(input.sessionID, yield* readInfo(input.sessionID, now))
            const saved = yield* TaskOperation.get(db, {
              sessionID: input.sessionID,
              operationID: input.request.operationID,
            })
            if (!saved) return yield* Effect.die(new Error("Task operation reservation was not saved"))
            return { operation: saved, created: true }
          }),
        ),
    )

    const attachOperationTask = Effect.fn("SessionTask.attachOperationTask")((input: TaskOperation.Ref) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const operation = yield* TaskOperation.get(db, input)
          if (!operation) return yield* new OperationConflictError({ ...input, reason: "operation_missing" })
          if (operation.taskID !== undefined) return operation
          if (operation.cancelIntent || (operation.phase !== "reserved" && operation.phase !== "permission_pending"))
            return yield* new OperationConflictError({ ...input, reason: "phase_changed" })
          const now = (yield* DateTime.nowAsDate).getTime()
          const taskID = Identifier.ascending("task")
          const change = new SessionTask.OperationChange({ taskID, taskRevision: 1 })
          const data = { sessionID: input.sessionID, operationID: input.operationID, change }
          yield* events.publish(SessionTaskEvent.OperationChanged, data, {
            commit: (seq) =>
              Effect.gen(function* () {
                const rows = yield* read(input.sessionID)
                yield* db
                  .insert(TaskTable)
                  .values({
                    id: taskID,
                    session_id: input.sessionID,
                    content: operation.request.description ?? operation.request.prompt,
                    status: "in_progress",
                    priority: "medium",
                    position: (rows.at(-1)?.position ?? -1) + 1,
                    operation_id: operation.operationID,
                    revision: 1,
                    time_created: now,
                    time_updated: now,
                  })
                  .run()
                  .pipe(Effect.orDie)
                const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, taskID)).get().pipe(Effect.orDie)
                if (row)
                  yield* saveClaim(toInfo(row, now), TaskOperation.permissionSource(operation), operation.operationID)
                yield* TaskOperation.projectChanged(db, data, now, seq)
                yield* ScheduleTask.sync(db, { sessionID: input.sessionID, now, previous: rows, execution: true })
              }),
          })
          yield* publishBoth(input.sessionID, yield* readInfo(input.sessionID, now))
          const saved = yield* TaskOperation.get(db, input)
          if (!saved) return yield* Effect.die(new Error("Task operation attachment was not saved"))
          return saved
        }),
      ),
    )

    const advanceOperation = Effect.fn("SessionTask.advanceOperation")(
      (input: Parameters<Interface["advanceOperation"]>[0]) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* TaskOperation.get(db, input)
            if (!current)
              return yield* new OperationConflictError({
                sessionID: input.sessionID,
                operationID: input.operationID,
                reason: "operation_missing",
              })
            if (input.expect && !input.expect.includes(current.phase))
              return yield* new OperationConflictError({
                sessionID: input.sessionID,
                operationID: input.operationID,
                reason: "phase_changed",
              })
            const terminal = ["settled", "failed", "cancelled", "blocked", "superseded"].includes(current.phase)
            if (
              (terminal && input.change.phase !== undefined && input.change.phase !== current.phase) ||
              (input.change.taskID !== undefined &&
                current.taskID !== undefined &&
                input.change.taskID !== current.taskID) ||
              (input.change.targetSessionID !== undefined &&
                current.targetSessionID !== undefined &&
                input.change.targetSessionID !== current.targetSessionID) ||
              (input.change.prepared !== undefined &&
                current.prepared !== undefined &&
                input.change.prepared.digest !== current.prepared.digest) ||
              (input.change.result !== undefined &&
                current.result !== undefined &&
                input.change.result.digest !== current.result.digest)
            )
              return yield* new OperationConflictError({
                sessionID: input.sessionID,
                operationID: input.operationID,
                reason: "phase_changed",
              })
            const now = (yield* DateTime.nowAsDate).getTime()
            const data = { sessionID: input.sessionID, operationID: input.operationID, change: input.change }
            yield* events.publish(SessionTaskEvent.OperationChanged, data, {
              commit: (seq) =>
                Effect.gen(function* () {
                  const previous = yield* read(input.sessionID)
                  yield* TaskOperation.projectChanged(db, data, now, seq)
                  if (
                    current.taskID === undefined ||
                    current.taskRevision === undefined ||
                    input.change.phase === undefined ||
                    !["settled", "failed", "cancelled", "blocked", "superseded"].includes(input.change.phase)
                  )
                    return
                  const claim = yield* readClaim(input.sessionID, current.taskID)
                  const settled =
                    claim &&
                    claim.operationID === current.operationID &&
                    claim.parentTaskRevision === current.taskRevision &&
                    sameSource(claim.source, TaskOperation.permissionSource(current))
                      ? yield* db
                          .update(TaskTable)
                          .set({
                            status:
                              input.change.phase === "settled"
                                ? "completed"
                                : input.change.phase === "cancelled" || input.change.phase === "superseded"
                                  ? "cancelled"
                                  : "failed",
                            output_digest: input.change.result?.text ?? input.change.error?.message,
                            revision: current.taskRevision + 1,
                            time_updated: now,
                          })
                          .where(
                            and(
                              eq(TaskTable.session_id, input.sessionID),
                              eq(TaskTable.id, current.taskID),
                              eq(TaskTable.revision, current.taskRevision),
                              eq(TaskTable.operation_id, current.operationID),
                            ),
                          )
                          .returning({ id: TaskTable.id })
                          .get()
                          .pipe(Effect.orDie)
                      : undefined
                  const operation = yield* TaskOperation.get(db, input)
                  if (
                    operation &&
                    (operation.sourceSettlement === undefined || operation.sourceSettlement === "pending")
                  )
                    yield* TaskOperation.store(
                      db,
                      new SessionTask.OperationInfo({
                        ...operation,
                        sourceSettlement: settled ? "settled" : "conflict",
                      }),
                    )
                  yield* releaseOwned({
                    sessionID: input.sessionID,
                    id: current.taskID,
                    revision: current.taskRevision,
                    source: TaskOperation.permissionSource(current),
                  })
                  yield* ScheduleTask.sync(db, { sessionID: input.sessionID, now, previous, execution: true })
                }),
            })
            const saved = yield* TaskOperation.get(db, input)
            if (!saved) return yield* Effect.die(new Error("Task operation change was not saved"))
            if (
              current.taskID &&
              input.change.phase &&
              ["settled", "failed", "cancelled", "blocked", "superseded"].includes(input.change.phase)
            )
              yield* publishBoth(input.sessionID, yield* readInfo(input.sessionID, now))
            return saved
          }),
        ),
    )

    const claimWaitingOperation = Effect.fn("SessionTask.claimWaitingOperation")((input: TaskOperation.Ref) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const operation = yield* TaskOperation.get(db, input)
          if (!operation) return yield* new OperationConflictError({ ...input, reason: "operation_missing" })
          if (operation.phase !== "waiting") return operation
          const waiting = (yield* TaskOperation.list(db, {
            sessionID: input.sessionID,
            taskID: operation.taskID,
          })).filter((entry) => entry.phase === "waiting")
          if (
            waiting[0]?.operationID !== input.operationID ||
            !operation.taskID ||
            (yield* readClaim(input.sessionID, operation.taskID))
          )
            return operation
          const predecessor = operation.predecessorID
            ? yield* TaskOperation.get(db, { sessionID: input.sessionID, operationID: operation.predecessorID })
            : undefined
          if (predecessor && !["settled", "failed", "cancelled", "blocked", "superseded"].includes(predecessor.phase))
            return operation
          const task = yield* db
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.session_id, input.sessionID), eq(TaskTable.id, operation.taskID)))
            .get()
            .pipe(Effect.orDie)
          if (!task) return yield* new OperationConflictError({ ...input, reason: "task_missing" })
          const now = (yield* DateTime.nowAsDate).getTime()
          const data = {
            sessionID: input.sessionID,
            operationID: input.operationID,
            change: new SessionTask.OperationChange({ phase: "reserved", taskRevision: task.revision + 1 }),
          }
          yield* events
            .publish(SessionTaskEvent.OperationChanged, data, {
              commit: (seq) =>
                Effect.gen(function* () {
                  const previous = yield* read(input.sessionID)
                  const updated = yield* db
                    .update(TaskTable)
                    .set({
                      status: "in_progress",
                      operation_id: operation.operationID,
                      revision: task.revision + 1,
                      time_updated: now,
                    })
                    .where(
                      and(
                        eq(TaskTable.session_id, input.sessionID),
                        eq(TaskTable.id, task.id),
                        eq(TaskTable.revision, task.revision),
                      ),
                    )
                    .returning({ id: TaskTable.id })
                    .get()
                    .pipe(Effect.orDie)
                  if (!updated)
                    return yield* Effect.die(new OperationConflictError({ ...input, reason: "phase_changed" }))
                  yield* TaskOperation.projectChanged(db, data, now, seq)
                  const row = yield* db
                    .select()
                    .from(TaskTable)
                    .where(eq(TaskTable.id, task.id))
                    .get()
                    .pipe(Effect.orDie)
                  if (row)
                    yield* saveClaim(toInfo(row, now), TaskOperation.permissionSource(operation), operation.operationID)
                  yield* ScheduleTask.sync(db, { sessionID: input.sessionID, now, previous, execution: true })
                  return undefined
                }),
            })
            .pipe(
              Effect.catchDefect((error) =>
                error instanceof OperationConflictError ? Effect.fail(error) : Effect.die(error),
              ),
            )
          yield* publishBoth(input.sessionID, yield* readInfo(input.sessionID, now))
          return (yield* TaskOperation.get(db, input)) ?? operation
        }),
      ),
    )

    const update = Effect.fn("SessionTask.update")(
      (
        input: {
          readonly sessionID: SessionSchema.ID
          readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
          readonly expectedRevision?: number
        },
        options?: WriteOptions,
      ) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            // Mint ids up front (deterministic) so the event and the transaction agree.
            const planned = input.tasks.map((task, index) => ({
              ...planTask(task, task.id ?? Identifier.ascending("task")),
              position: index,
            }))
            const retained = new Set(planned.map((task) => task.id))
            const now = (yield* DateTime.nowAsDate).getTime()

            // Run validation + reconcile in one transaction. The transaction always
            // succeeds: it reports a rejected client id via the tagged result instead
            // of failing, so the typed TaskWriteError is surfaced AFTER the orDie
            // (which would otherwise convert it into an unhandled defect).
            const result = yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const existing = yield* tx
                    .select()
                    .from(TaskTable)
                    .where(eq(TaskTable.session_id, input.sessionID))
                    .all()
                    .pipe(Effect.orDie)
                  const owned = yield* managedConflict(input.sessionID, existing, options)
                  if (owned) return { type: "invalid" as const, error: owned }
                  const existingById = new Map(existing.map((row) => [row.id, row]))
                  // P3-c: full-list optimistic-concurrency guard. The caller's
                  // expectedRevision is the max revision they observed; a higher
                  // current max means a concurrent write landed between their read
                  // and this replace, so the stale plan is rejected before any write.
                  if (input.expectedRevision !== undefined) {
                    const maxRevision = existing.reduce((max, row) => Math.max(max, row.revision), 0)
                    if (maxRevision !== input.expectedRevision) {
                      return yield* Effect.succeed({
                        type: "invalid" as const,
                        error: new TaskWriteError({ sessionID: input.sessionID, reason: "stale_revision" }),
                      })
                    }
                  }
                  // DAG cycle guard (M5 Step 3): a dependsOn cycle means no task in it
                  // can ever be triggered — reject before any write. Graph = existing
                  // rows + this payload's planned tasks (minted ids included), plus
                  // every cross-session predecessor reachable from them (MEDIUM-1:
                  // the runtime trigger resolves predecessors globally).
                  const graph = yield* reachableCycleGraph(
                    (ids) =>
                      tx
                        .select()
                        .from(TaskTable)
                        .where(inArray(TaskTable.id, [...ids]))
                        .all()
                        .pipe(
                          Effect.map((rows) =>
                            rows.map((row) => ({
                              id: row.id,
                              status: row.status,
                              dependsOn: row.depends_on ?? undefined,
                            })),
                          ),
                          Effect.orDie,
                        ),
                    [
                      ...existing.map((row) => ({
                        id: row.id,
                        status: row.status,
                        dependsOn: row.depends_on ?? undefined,
                      })),
                      // Use the *effective* dependsOn — the same preserve-omitted rule as
                      // the column computation below (`task.dependsOn ?? prior?.depends_on`):
                      // an omitted field keeps the existing row's value, so the guard must
                      // evaluate the graph that actually lands in the DB, or an
                      // omitted-preserve write could close a cycle unseen.
                      ...planned.map((task) => ({
                        id: task.id,
                        status: task.status,
                        dependsOn: task.dependsOn ?? existingById.get(task.id)?.depends_on ?? undefined,
                      })),
                    ],
                  )
                  const cycle = TaskDag.findCycle(graph)
                  if (cycle) {
                    return yield* Effect.succeed({
                      type: "invalid" as const,
                      error: new TaskWriteError({
                        sessionID: input.sessionID,
                        id: cycle[0],
                        reason: "depends_on_cycle",
                      }),
                    })
                  }
                  // Reject foreign ids (client-supplied ids not owned by this session)
                  // and duplicate ids within the payload before any writes. The loop
                  // collects the first violation; the failure is raised after the loop
                  // so every return statement in this gen is value-bearing.
                  const seen = new Set<string>()
                  let invalid: TaskWriteError | undefined
                  // Dead-job guard (differential-review HIGH-4): a recurrence cron that
                  // is malformed or yields no future run, or a `scheduled` task with no
                  // trigger, must be rejected — not persisted as a job that can never
                  // fire. Uses the effective (preserve-omitted) schedule; runs for new
                  // (id-less) tasks too, so the HTTP PATCH path cannot revive the hole.
                  for (const task of input.tasks) {
                    const prior = task.id !== undefined ? existingById.get(task.id) : undefined
                    const dead = scheduleFailureKind(task, prior, now)
                    if (dead) {
                      invalid = new TaskWriteError({
                        sessionID: input.sessionID,
                        id: task.id,
                        reason: "invalid_schedule",
                        schedule: dead,
                      })
                      break
                    }
                  }
                  if (invalid) return yield* Effect.succeed({ type: "invalid" as const, error: invalid })
                  for (const task of input.tasks) {
                    if (task.id === undefined) continue
                    if (!existingById.has(task.id)) {
                      invalid = new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "foreign" })
                      break
                    }
                    if (seen.has(task.id)) {
                      invalid = new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "duplicate" })
                      break
                    }
                    seen.add(task.id)
                  }
                  if (invalid) return yield* Effect.succeed({ type: "invalid" as const, error: invalid })
                  const completion = yield* completionConflict(
                    tx,
                    input.sessionID,
                    planned.map((task) => ({
                      ...task,
                      dependsOn: task.dependsOn ?? existingById.get(task.id)?.depends_on ?? undefined,
                      previousStatus: existingById.get(task.id)?.status,
                      previousDependsOn: existingById.get(task.id)?.depends_on ?? undefined,
                    })),
                    options,
                    existing.filter((row) => !retained.has(row.id)).map((row) => row.id),
                  )
                  if (completion) return { type: "invalid" as const, error: completion }
                  for (const task of planned) {
                    const prior = existingById.get(task.id)
                    const nextRevision = (prior?.revision ?? 0) + 1
                    const columns = {
                      content: task.content,
                      status: task.status,
                      priority: task.priority,
                      parent_id: task.parentID ?? prior?.parent_id ?? null,
                      agent_id: task.agentID ?? prior?.agent_id ?? null,
                      scheduled_at: task.scheduledAt ?? prior?.scheduled_at ?? null,
                      recurrence: recurrenceFor(task.recurrence, prior?.recurrence) ?? null,
                      spawned_from: task.spawnedFrom ?? prior?.spawned_from ?? null,
                      depends_on: task.dependsOn ?? prior?.depends_on ?? null,
                      revision: nextRevision,
                      position: task.position,
                      time_updated: now,
                    }
                    if (existingById.has(task.id)) {
                      yield* tx.update(TaskTable).set(columns).where(eq(TaskTable.id, task.id)).run().pipe(Effect.orDie)
                    } else {
                      yield* tx
                        .insert(TaskTable)
                        .values({ id: task.id, session_id: input.sessionID, ...columns, time_created: now })
                        .run()
                        .pipe(Effect.orDie)
                    }
                  }
                  for (const row of existing) {
                    if (!retained.has(row.id)) {
                      yield* tx.delete(TaskTable).where(eq(TaskTable.id, row.id)).run().pipe(Effect.orDie)
                    }
                  }
                  yield* ScheduleTask.sync(tx, {
                    sessionID: input.sessionID,
                    now,
                    previous: existing,
                    execution: options?.claim !== undefined || options?.settle !== undefined,
                  })
                  return { type: "ok" as const, resolved: yield* readInfo(input.sessionID, now) }
                }),
              )
              .pipe(Effect.orDie)

            if (result.type === "invalid") {
              return yield* Effect.fail(result.error)
            }

            yield* publishBoth(input.sessionID, result.resolved)
            return result.resolved
          }),
        ),
    )

    const append = Effect.fn("SessionTask.append")(
      (
        input: { readonly sessionID: SessionSchema.ID; readonly tasks: ReadonlyArray<typeof WriteInfo.Type> },
        options?: WriteOptions,
      ) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const now = (yield* DateTime.nowAsDate).getTime()
            const planned = input.tasks.map((task) => planTask(task, task.id ?? Identifier.ascending("task")))
            // Dead-job guard (differential-review HIGH-4): reject a recurrence cron
            // that is malformed / has no future run, or a `scheduled` task with no
            // trigger, before any insert. Append has no prior row, so the effective
            // schedule is the input itself.
            for (const task of input.tasks) {
              const dead = scheduleFailureKind(task, undefined, now)
              if (dead) {
                return yield* Effect.fail(
                  new TaskWriteError({
                    sessionID: input.sessionID,
                    id: task.id,
                    reason: "invalid_schedule",
                    schedule: dead,
                  }),
                )
              }
            }
            // DAG cycle guard (M5 Step 3) runs INSIDE the same transaction as the
            // insert (differential-review HIGH-2): a guard read outside the
            // transaction lets two concurrent cross-session appends both pass and then
            // close a cycle the runtime trigger would deadlock on. The graph is the
            // session's existing rows + this payload plus every cross-session
            // predecessor reachable from them (MEDIUM-1 — the trigger resolves
            // predecessors globally). The transaction reports a rejected cycle via a
            // tagged result (mirroring update) so the typed TaskWriteError surfaces
            // after the orDie.
            const result = yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const existing = yield* tx
                    .select()
                    .from(TaskTable)
                    .where(eq(TaskTable.session_id, input.sessionID))
                    .orderBy(asc(TaskTable.position))
                    .all()
                    .pipe(Effect.orDie)
                  // Duplicate-id guard (mirrors update): an explicit id repeated
                  // within the payload, or already present in the table, would hit
                  // the task.id PK (global, not session-scoped — hence the
                  // table-wide probe) and surface as an unhandled defect instead of
                  // a typed failure.
                  const seen = new Set<string>()
                  const explicitIds = new Array<string>()
                  for (const task of input.tasks) {
                    if (task.id === undefined) continue
                    if (seen.has(task.id)) {
                      return {
                        type: "invalid" as const,
                        error: new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "duplicate" }),
                      }
                    }
                    seen.add(task.id)
                    explicitIds.push(task.id)
                  }
                  if (explicitIds.length > 0) {
                    const taken = yield* tx
                      .select({ id: TaskTable.id })
                      .from(TaskTable)
                      .where(inArray(TaskTable.id, explicitIds))
                      .all()
                      .pipe(Effect.orDie)
                    if (taken.length > 0) {
                      return {
                        type: "invalid" as const,
                        error: new TaskWriteError({
                          sessionID: input.sessionID,
                          id: taken[0]?.id,
                          reason: "duplicate",
                        }),
                      }
                    }
                  }
                  const graph = yield* reachableCycleGraph(
                    (ids) =>
                      tx
                        .select()
                        .from(TaskTable)
                        .where(inArray(TaskTable.id, [...ids]))
                        .all()
                        .pipe(
                          Effect.map((rows) =>
                            rows.map((row) => ({
                              id: row.id,
                              status: row.status,
                              dependsOn: row.depends_on ?? undefined,
                            })),
                          ),
                          Effect.orDie,
                        ),
                    [
                      ...existing.map((row) => ({
                        id: row.id,
                        status: row.status,
                        dependsOn: row.depends_on ?? undefined,
                      })),
                      ...planned.map((task) => ({ id: task.id, status: task.status, dependsOn: task.dependsOn })),
                    ],
                  )
                  const cycle = TaskDag.findCycle(graph)
                  if (cycle) {
                    return {
                      type: "invalid" as const,
                      error: new TaskWriteError({
                        sessionID: input.sessionID,
                        id: cycle[0],
                        reason: "depends_on_cycle",
                      }),
                    }
                  }
                  const completion = yield* completionConflict(tx, input.sessionID, planned, options)
                  if (completion) return { type: "invalid" as const, error: completion }
                  // Position = max existing position + 1, NOT existing.length
                  // (differential-review MEDIUM-2): a middle DELETE leaves a position
                  // hole, and length-based positions would mint a duplicate — the
                  // position-ordered read then becomes order-unstable.
                  let position = (existing.at(-1)?.position ?? -1) + 1
                  for (const task of planned) {
                    yield* tx
                      .insert(TaskTable)
                      .values({
                        id: task.id,
                        session_id: input.sessionID,
                        content: task.content,
                        status: task.status,
                        priority: task.priority,
                        parent_id: task.parentID ?? null,
                        agent_id: task.agentID ?? null,
                        scheduled_at: task.scheduledAt ?? null,
                        recurrence: task.recurrence ?? null,
                        spawned_from: task.spawnedFrom ?? null,
                        depends_on: task.dependsOn ?? null,
                        position,
                        time_created: now,
                        time_updated: now,
                      })
                      .run()
                      .pipe(Effect.orDie)
                    position++
                  }
                  yield* ScheduleTask.sync(tx, {
                    sessionID: input.sessionID,
                    now,
                    previous: existing,
                    execution: options?.claim !== undefined || options?.settle !== undefined,
                  })
                  const full = yield* readInfo(input.sessionID, now)
                  const added = new Set(planned.map((task) => task.id))
                  for (const task of full) {
                    if (!added.has(task.id)) continue
                    if (options?.claim) yield* saveClaim(task, options.claim)
                    if (options?.commit) yield* options.commit(task)
                  }
                  return { type: "ok" as const, resolved: full }
                }),
              )
              .pipe(Effect.orDie)
            if (result.type === "invalid") {
              return yield* Effect.fail(result.error)
            }
            yield* publishBoth(input.sessionID, result.resolved)
            return result.resolved
          }),
        ),
    )

    const replaceLegacy = Effect.fn("SessionTask.replaceLegacy")(
      (
        input: {
          readonly sessionID: SessionSchema.ID
          readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
          readonly expectedRevision?: number
        },
        options?: WriteOptions,
      ) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const now = (yield* DateTime.nowAsDate).getTime()
            const result = yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const existing = yield* tx
                    .select()
                    .from(TaskTable)
                    .where(eq(TaskTable.session_id, input.sessionID))
                    .orderBy(asc(TaskTable.position))
                    .all()
                    .pipe(Effect.orDie)
                  const owned = yield* managedConflict(input.sessionID, existing, options)
                  if (owned) return { type: "invalid" as const, error: owned }
                  // Full-list optimistic-concurrency guard (same semantics as
                  // update): the caller's expectedRevision is the max revision they
                  // observed; a higher current max means another write path landed
                  // between their read and this replace, so the stale plan is
                  // rejected before any write (the trailing-delete below would
                  // otherwise silently drop the other path's rows).
                  if (input.expectedRevision !== undefined) {
                    const maxRevision = existing.reduce((max, row) => Math.max(max, row.revision), 0)
                    if (maxRevision !== input.expectedRevision) {
                      return {
                        type: "invalid" as const,
                        error: new TaskWriteError({ sessionID: input.sessionID, reason: "stale_revision" }),
                      }
                    }
                  }
                  // Dead-job guard (re-review M-1): the legacy TodoWrite bridge can
                  // carry `status: "scheduled"` with no trigger — reject instead of
                  // persisting a job the daemon's arm scan can never pick up.
                  const planned = input.tasks.map((task, index) => ({
                    ...task,
                    id: existing[index]?.id ?? Identifier.ascending("task"),
                    dependsOn: task.dependsOn ?? existing[index]?.depends_on ?? undefined,
                    previousStatus: existing[index]?.status,
                    previousDependsOn: existing[index]?.depends_on ?? undefined,
                  }))
                  const completion = yield* completionConflict(
                    tx,
                    input.sessionID,
                    planned,
                    options,
                    existing.slice(input.tasks.length).map((row) => row.id),
                  )
                  if (completion) return { type: "invalid" as const, error: completion }
                  for (const [index, task] of input.tasks.entries()) {
                    const dead = scheduleFailureKind(task, existing[index], now)
                    if (dead) {
                      return {
                        type: "invalid" as const,
                        error: new TaskWriteError({
                          sessionID: input.sessionID,
                          id: task.id ?? existing[index]?.id,
                          reason: "invalid_schedule",
                          schedule: dead,
                        }),
                      }
                    }
                  }
                  for (const [index, task] of input.tasks.entries()) {
                    const prior = existing[index]
                    const id = planned[index].id
                    // Preserve-omitted is input-first (same rule as update and
                    // hasDeadSchedule): an omitted field keeps the existing row's
                    // value, an explicit one wins.
                    const columns = {
                      content: task.content,
                      status: task.status,
                      priority: task.priority,
                      parent_id: task.parentID ?? prior?.parent_id ?? null,
                      agent_id: task.agentID ?? prior?.agent_id ?? null,
                      scheduled_at: task.scheduledAt ?? prior?.scheduled_at ?? null,
                      recurrence: recurrenceFor(task.recurrence, prior?.recurrence) ?? null,
                      spawned_from: task.spawnedFrom ?? prior?.spawned_from ?? null,
                      depends_on: task.dependsOn ?? prior?.depends_on ?? null,
                      revision: prior ? prior.revision + 1 : 1,
                      position: index,
                      time_updated: now,
                    }
                    if (prior) {
                      yield* tx.update(TaskTable).set(columns).where(eq(TaskTable.id, id)).run().pipe(Effect.orDie)
                    } else {
                      yield* tx
                        .insert(TaskTable)
                        .values({ id, session_id: input.sessionID, ...columns, time_created: now })
                        .run()
                        .pipe(Effect.orDie)
                    }
                  }
                  for (const row of existing.slice(input.tasks.length)) {
                    yield* tx.delete(TaskTable).where(eq(TaskTable.id, row.id)).run().pipe(Effect.orDie)
                  }
                  yield* ScheduleTask.sync(tx, {
                    sessionID: input.sessionID,
                    now,
                    previous: existing,
                    execution: options?.claim !== undefined || options?.settle !== undefined,
                  })
                  return { type: "ok" as const, resolved: yield* readInfo(input.sessionID, now) }
                }),
              )
              .pipe(Effect.orDie)
            if (result.type === "invalid") {
              return yield* Effect.fail(result.error)
            }
            yield* publishBoth(input.sessionID, result.resolved)
            return result.resolved
          }),
        ),
    )

    const get = Effect.fn("SessionTask.get")(function* (sessionID: SessionSchema.ID) {
      const now = (yield* DateTime.nowAsDate).getTime()
      return yield* readInfo(sessionID, now)
    })

    const patch = Effect.fn("SessionTask.patch")(
      (
        input: {
          readonly sessionID: SessionSchema.ID
          readonly id: string
          readonly status: SessionTask.TaskStatus
          readonly outputDigest?: string
          readonly expect?: ReadonlyArray<SessionTask.TaskStatus>
          readonly expectedRevision?: number
        },
        options?: WriteOptions,
      ) => updateTask(input, options),
    )

    const remove = Effect.fn("SessionTask.delete")((sessionID: SessionSchema.ID) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          const now = (yield* DateTime.nowAsDate).getTime()
          yield* db
            .transaction(() =>
              Effect.gen(function* () {
                const previous = yield* read(sessionID)
                yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
                yield* ScheduleTask.sync(db, { sessionID, now, previous })
              }),
            )
            .pipe(Effect.catchTag("SqlError", Effect.die))
          yield* publishBoth(sessionID, [])
        }),
      ),
    )

    const removeTask = Effect.fn("SessionTask.removeTask")(
      (input: { readonly sessionID: SessionSchema.ID; readonly id: string }, options?: WriteOptions) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const now = (yield* DateTime.nowAsDate).getTime()
            const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
            const removed = yield* db
              .transaction(() =>
                Effect.gen(function* () {
                  const previous = yield* read(input.sessionID)
                  const row = previous.find((task) => task.id === input.id)
                  if (!row) return undefined
                  const owned = yield* managedConflict(input.sessionID, [row], options)
                  if (owned) return yield* owned
                  const schedules = yield* ScheduleTask.nextRuns(db, input.sessionID)
                  yield* db.delete(TaskTable).where(scoped).run().pipe(Effect.orDie)
                  yield* ScheduleTask.sync(db, {
                    sessionID: input.sessionID,
                    now,
                    previous,
                    execution: options?.claim !== undefined || options?.settle !== undefined,
                  })
                  return { task: toInfo(row, now, schedules.get(row.id)), full: yield* readInfo(input.sessionID, now) }
                }),
              )
              .pipe(Effect.catchTag("SqlError", Effect.die))
            if (!removed) return undefined
            yield* publishBoth(input.sessionID, removed.full)
            return removed.task
          }),
        ),
    )

    const updateTask = Effect.fn("SessionTask.updateTask")(
      (
        input: {
          readonly sessionID: SessionSchema.ID
          readonly id: string
          readonly status?: SessionTask.TaskStatus
          readonly expect?: ReadonlyArray<SessionTask.TaskStatus>
          readonly content?: string
          readonly priority?: SessionTask.TaskPriority
          readonly outputDigest?: string
          readonly expectedRevision?: number
        },
        options?: WriteOptions,
      ) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const mutation = Effect.gen(function* () {
              const now = (yield* DateTime.nowAsDate).getTime()
              const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
              const previous = yield* read(input.sessionID)
              const prior = previous.find((task) => task.id === input.id)
              if (!prior) return undefined
              const owned = yield* managedConflict(input.sessionID, [prior], options)
              if (owned) return yield* owned
              if (options?.claim) {
                const claimed = yield* readClaim(input.sessionID, input.id)
                const replacing =
                  (options.settle &&
                    sameSource(options.settle.source, options.claim) &&
                    (!claimed ||
                      (sameSource(claimed.source, options.settle.source) &&
                        claimed.parentTaskRevision === options.settle.revision))) ||
                  (options.handoff &&
                    claimed &&
                    sameSource(claimed.source, options.handoff.source) &&
                    claimed.parentTaskRevision === options.handoff.revision &&
                    prior.revision === options.handoff.revision)
                if (claimed && !replacing) {
                  if (!sameSource(claimed.source, options.claim))
                    return yield* new TaskWriteError({
                      sessionID: input.sessionID,
                      id: input.id,
                      reason: "execution_owned",
                    })
                  if (claimed.parentTaskRevision !== prior.revision) return undefined
                  const schedules = yield* ScheduleTask.nextRuns(db, input.sessionID)
                  return { task: toInfo(prior, now, schedules.get(prior.id)), full: undefined }
                }
                if (!claimed && !replacing && (yield* legacyOwned(input.sessionID, prior)))
                  return yield* new TaskWriteError({
                    sessionID: input.sessionID,
                    id: input.id,
                    reason: "execution_owned",
                  })
              }
              // Execution claims and field edits share one write boundary; stale claims cannot overwrite edits.
              if (input.expect !== undefined && !input.expect.some((status) => status === prior.status))
                return undefined
              if (input.expectedRevision !== undefined && prior.revision !== input.expectedRevision) return undefined
              const completion = yield* completionConflict(
                db,
                input.sessionID,
                [
                  {
                    id: prior.id,
                    status: input.status ?? prior.status,
                    previousStatus: prior.status,
                    previousDependsOn: prior.depends_on ?? undefined,
                    dependsOn: prior.depends_on ?? undefined,
                  },
                ],
                options,
              )
              if (completion) return yield* completion
              const dead =
                input.status === undefined ? undefined : scheduleFailureKind({ status: input.status }, prior, now)
              if (dead)
                return yield* new TaskWriteError({
                  sessionID: input.sessionID,
                  id: input.id,
                  reason: "invalid_schedule",
                  schedule: dead,
                })
              yield* db
                .update(TaskTable)
                .set({
                  ...(input.status !== undefined ? { status: input.status } : {}),
                  ...(input.content !== undefined ? { content: input.content } : {}),
                  ...(input.priority !== undefined ? { priority: input.priority } : {}),
                  ...(input.outputDigest !== undefined ? { output_digest: input.outputDigest } : {}),
                  revision: prior.revision + 1,
                  time_updated: now,
                })
                .where(scoped)
                .run()
                .pipe(Effect.orDie)
              const row = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
              if (!row) return undefined
              yield* ScheduleTask.sync(db, {
                sessionID: input.sessionID,
                now,
                previous,
                execution: options?.claim !== undefined || options?.settle !== undefined,
              })
              const schedules = yield* ScheduleTask.nextRuns(db, input.sessionID)
              const task = toInfo(row, now, schedules.get(row.id))
              if (options?.claim) yield* saveClaim(task, options.claim)
              if (options?.commit) yield* options.commit(task)
              return { task, full: yield* readInfo(input.sessionID, now) }
            })
            const settlement = options?.settle
            const committed = settlement
              ? mutation.pipe(
                  Effect.tap(() => releaseOwned({ sessionID: input.sessionID, id: input.id, ...settlement })),
                )
              : mutation
            const result = yield* db.transaction(() => committed).pipe(Effect.catchTag("SqlError", Effect.die))
            if (!result) return undefined
            if (result.full) yield* publishBoth(input.sessionID, result.full)
            return result.task
          }),
        ),
    )

    const reorder = Effect.fn("SessionTask.reorder")(
      (
        input: {
          readonly sessionID: SessionSchema.ID
          readonly ids: readonly string[]
          readonly expectedRevision?: number
        },
        options?: WriteOptions,
      ) =>
        writeLock.withPermits(1)(
          Effect.gen(function* () {
            const now = (yield* DateTime.nowAsDate).getTime()
            const existing = yield* read(input.sessionID)
            const owned = yield* managedConflict(input.sessionID, existing, options)
            if (owned) return yield* owned
            const existingIds = new Set(existing.map((row) => row.id))
            // Unknown ids in the input (not owned by this session).
            for (const id of input.ids) {
              if (!existingIds.has(id)) {
                return yield* Effect.fail(new TaskWriteError({ sessionID: input.sessionID, id, reason: "foreign" }))
              }
            }
            // Duplicate ids within the input.
            if (new Set(input.ids).size !== input.ids.length) {
              return yield* Effect.fail(new TaskWriteError({ sessionID: input.sessionID, reason: "duplicate" }))
            }
            // Partial permutation: all ids are known and unique but don't cover every
            // task - the caller omitted rows. Reject so a stale partial view can't
            // silently drop tasks from the reordered list.
            if (input.ids.length !== existing.length) {
              return yield* Effect.fail(new TaskWriteError({ sessionID: input.sessionID, reason: "foreign" }))
            }
            // expectedRevision = max revision the caller observed. A higher current
            // max means a concurrent write landed between the caller's read and this
            // reorder; the caller's ordering is based on a stale list.
            if (input.expectedRevision !== undefined) {
              const maxRevision = existing.reduce((max, row) => Math.max(max, row.revision), 0)
              if (maxRevision !== input.expectedRevision) {
                return yield* Effect.fail(new TaskWriteError({ sessionID: input.sessionID, reason: "stale_revision" }))
              }
            }
            const idToRow = new Map(existing.map((row) => [row.id, row]))
            const full = yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  for (let i = 0; i < input.ids.length; i++) {
                    const id = input.ids[i]
                    const row = idToRow.get(id)
                    if (!row) continue
                    yield* tx
                      .update(TaskTable)
                      .set({ position: i, revision: row.revision + 1, time_updated: now })
                      .where(eq(TaskTable.id, id))
                      .run()
                      .pipe(Effect.orDie)
                  }
                  yield* ScheduleTask.sync(tx, {
                    sessionID: input.sessionID,
                    now,
                    previous: existing,
                    execution: options?.claim !== undefined || options?.settle !== undefined,
                  })
                  return yield* readInfo(input.sessionID, now)
                }),
              )
              .pipe(Effect.orDie)
            yield* publishBoth(input.sessionID, full)
            return full
          }),
        ),
    )

    const recordProgress = Effect.fn("SessionTask.recordProgress")(
      (input: {
        readonly sessionID: SessionSchema.ID
        readonly taskID: string
        readonly phase: TaskExecutionPhase
        readonly progress?: number
        readonly current?: number
        readonly total?: number
      }) =>
        Effect.gen(function* () {
          const now = (yield* DateTime.nowAsDate).getTime()
          yield* events.publish(Event.Progress, {
            sessionID: input.sessionID,
            taskID: input.taskID,
            phase: input.phase,
            ...(input.progress !== undefined ? { progress: input.progress } : {}),
            ...(input.current !== undefined ? { current: input.current } : {}),
            ...(input.total !== undefined ? { total: input.total } : {}),
            updatedAt: now,
          })
        }),
    )

    const listAll = Effect.fn("SessionTask.listAll")(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const rows = yield* db.select().from(TaskTable).orderBy(asc(TaskTable.position)).all().pipe(Effect.orDie)
      const schedules = new Map(
        (yield* Effect.forEach([...new Set(rows.map((row) => row.session_id))], (sessionID) =>
          ScheduleTask.nextRuns(db, sessionID),
        )).flatMap((runs) => [...runs]),
      )
      return rows.map((row) => toInfo(row, now, schedules.get(row.id)))
    })

    return Service.of({
      reserveOperation,
      operation: (input) => TaskOperation.get(db, input),
      operations: (input) => TaskOperation.list(db, input),
      attachOperationTask,
      claimWaitingOperation,
      advanceOperation,
      update,
      append,
      replaceLegacy,
      patch,
      get,
      delete: remove,
      removeTask,
      updateTask,
      reorder,
      recordProgress,
      listAll,
      releaseClaim,
    })
  }),
)

export const defaultLayer = layer
export const node = LayerNode.make({ name: "SessionTask", layer, deps: [Database.node, Bus.node] })
