export * as SessionTask from "./task"

import { and, asc, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { LayerNode } from "../effect/layer-node"
import { nextRun } from "./schedule"
import { TaskDag } from "./dag"
import { SessionSchema } from "./schema"
import { TaskTable } from "./sql"

export const Info = SessionTaskSchema.Info
export type Info = typeof Info.Type

/**
 * Write shape accepted by {@link SessionTask.update}/{@link SessionTask.append}/
 * {@link SessionTask.replaceLegacy}. `id` is optional: absent tasks are minted a
 * stable `tsk_` id. M0 persists id/content/status/priority/parentID/sessionID;
 * M2 adds `output_digest`, written through {@link SessionTask.patch}.
 */
export class WriteInfo extends Schema.Class<WriteInfo>("SessionTask.WriteInfo")({
  id: Schema.optional(Schema.String),
  content: Schema.String,
  status: SessionTaskSchema.TaskStatus,
  priority: SessionTaskSchema.TaskPriority,
  parentID: Schema.optional(Schema.String),
  // M3: scheduled jobs — owning agent, next trigger, and repetition rule.
  agentID: Schema.optional(Schema.String),
  scheduledAt: Schema.optional(Schema.Number),
  recurrence: Schema.optional(SessionTaskSchema.TaskRecurrence),
  // M5: spawning & DAG — originating message id and predecessor task ids.
  spawnedFrom: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * A client-supplied task that cannot be reconciled: `foreign` ids are not
 * owned by the target session (a forge attempt or stale reference), `duplicate`
 * ids repeat a prior id in the same payload, `invalid_schedule` carries a
 * recurrence cron that is malformed or has no future run (a dead job — the
 * HTTP PATCH path bypasses the task_schedule tool's own guard). `depends_on_cycle`
 * rejects a DAG that would never fire (no task in a cycle can trigger). The
 * first two would otherwise hit the global `task.id` PK constraint and surface
 * as an unhandled 500 defect; all four are rejected up front as a typed failure
 * (HTTP 400).
 */
export class TaskWriteError extends Schema.TaggedErrorClass<TaskWriteError>()("SessionTask.TaskWriteError", {
  sessionID: SessionSchema.ID,
  id: Schema.optional(Schema.String),
  reason: Schema.Literals(["foreign", "duplicate", "invalid_schedule", "depends_on_cycle", "stale_revision"]),
}) {
  override get message() {
    switch (this.reason) {
      case "foreign":
        return `Task id "${this.id}" is not owned by session ${this.sessionID}`
      case "duplicate":
        return `Duplicate task id "${this.id}" in payload for session ${this.sessionID}`
      case "invalid_schedule":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} has an invalid recurrence cron: it is malformed or has no future run within the search window`
      case "depends_on_cycle":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} introduces a dependency cycle; no task in the cycle can ever be triggered`
      case "stale_revision":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} changed since the caller last read it; retry with the current revision`
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
export class TodoProjection extends Schema.Class<TodoProjection>("SessionTask.TodoProjection")({
  content: Schema.String,
  status: Schema.String,
  priority: Schema.String,
}) {}

/**
 * Runtime execution phase for a task's current provider turn (P2). Ephemeral -
 * never persisted on the task row; carried only by `task.progress` events so the
 * UI can show a determinate pulse when a tool reports `current/total`.
 */
export const TaskExecutionPhase = Schema.Literals(["thinking", "streaming", "tool", "waiting"])
export type TaskExecutionPhase = typeof TaskExecutionPhase.Type

export const Event = {
  Updated: EventV2.define({
    type: "task.updated",
    schema: {
      sessionID: SessionSchema.ID,
      tasks: Schema.Array(Info),
    },
  }),
  /** Legacy `todo.updated` projection emitted alongside every task write. */
  TodoUpdated: EventV2.define({
    type: "todo.updated",
    schema: {
      sessionID: SessionSchema.ID,
      todos: Schema.Array(TodoProjection),
    },
  }),
  /**
   * Ephemeral runtime progress for a task (P2). Published by execution sources
   * (e.g. the `task` delegation tool reporting child-session completion ratio);
   * never persisted - the app keeps only the latest snapshot in memory.
   */
  Progress: EventV2.define({
    type: "task.progress",
    schema: {
      sessionID: SessionSchema.ID,
      taskID: Schema.String,
      phase: TaskExecutionPhase,
      progress: Schema.optional(Schema.Number),
      current: Schema.optional(Schema.Number),
      total: Schema.optional(Schema.Number),
      updatedAt: Schema.Number,
    },
  }),
}

export interface Interface {
  /**
   * Reconcile a session's task list by id: upsert present rows, delete absent ones, republish.
   * Fails with {@link TaskWriteError} when a client-supplied id is foreign to the session
   * or duplicated within the payload.
   */
  readonly update: (input: {
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
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Append new tasks at the end of the session's list in a single transaction.
   * Positions are computed and the full list is re-read atomically, so
   * concurrent appends (multiple task tool calls in one provider turn) never
   * drop each other's rows — unlike a read-modify-reconcile.
   */
  readonly append: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Legacy todowrite bridge: reconcile by position, reusing existing ids so a
   * delegation writeback to a linked task survives a later full-list replace.
   * New positions mint ids, trailing rows are removed, all in one transaction.
   */
  readonly replaceLegacy: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Target a single task by id and update its status (delegation writeback).
   * Other rows are untouched; `outputDigest` is persisted (M2) and rides the
   * returned Info and the republished `task.updated` event.
   * When `expect` is set, the patch only lands while the current status is one
   * of the expected ones (checked inside the write lock) and resolves
   * `undefined` otherwise — the conditional-claim primitive for
   * ScheduledJob.trigger's pause/claim race.
   */
  readonly patch: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly status: SessionTaskSchema.TaskStatus
    readonly outputDigest?: string
    readonly expect?: ReadonlyArray<SessionTaskSchema.TaskStatus>
    /**
     * Optimistic-concurrency guard (P3-a): when set, the patch only lands while
     * the current revision matches. Resolves `undefined` otherwise (no write),
     * mirroring {@link expect}'s conditional-claim semantics.
     */
    readonly expectedRevision?: number
  }) => Effect.Effect<Info | undefined, TaskWriteError>
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
  readonly removeTask: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
  }) => Effect.Effect<Info | undefined>
  /**
   * Update a single task's content and/or priority without a full-list reconcile
   * (P3-b). Other rows are untouched; `expectedRevision` rejects stale writes the
   * same way {@link patch} does. Resolves `undefined` when the id is unknown or
   * the revision is stale (no write).
   */
  readonly updateTask: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly content?: string
    readonly priority?: SessionTaskSchema.TaskPriority
    readonly expectedRevision?: number
  }) => Effect.Effect<Info | undefined, TaskWriteError>
  /**
   * Reorder a session's tasks by id (P3-b). `ids` must be a permutation of the
   * session's current task ids; otherwise fails with `foreign`/`duplicate`.
   * `expectedRevision` is the max revision the caller observed across all tasks;
   * if any task's revision exceeds it, the caller's view is stale and the reorder
   * fails with `stale_revision`. All tasks get `revision + 1` (structural change).
   */
  readonly reorder: (input: {
    readonly sessionID: SessionSchema.ID
    readonly ids: readonly string[]
    readonly expectedRevision?: number
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
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

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionTask") {}

type TaskRow = typeof TaskTable.$inferSelect

/**
 * Derived next trigger (M3b-2 UI data source): only scheduled/pending tasks
 * carry one — a recurrence's next cron match after `now`, else the one-shot
 * `scheduledAt`. Terminal and in-flight statuses omit the field.
 */
const resolveNextRun = (
  input: {
    status: TaskRow["status"]
    scheduledAt?: number
    recurrence?: SessionTaskSchema.TaskRecurrence
  },
  now: number,
) => {
  if (input.status !== "scheduled" && input.status !== "pending") return undefined
  if (input.recurrence?.enabled) return nextRun(input.recurrence.cron, now)
  return input.scheduledAt
}

const toInfo = (row: TaskRow, now: number): Info => {
  const run = resolveNextRun(
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

/**
 * Schedule invariant (differential-review HIGH-4, re-review M-1): rejects a
 * task that can never fire — (a) a recurrence whose cron is malformed or has no
 * future run, (b) a `scheduled` status with no real trigger (an enabled
 * recurrence with a future cron match, or a one-shot scheduledAt). The
 * effective schedule applies the preserve-omitted rule (input ?? prior), so a
 * reconcile / legacy replace that omits schedule fields against a
 * schedule-bearing row stays valid. Shared by update / append / replaceLegacy /
 * patch so no write path can persist a dead job.
 */
const hasDeadSchedule = (
  task: { status: string; recurrence?: SessionTaskSchema.TaskRecurrence | null; scheduledAt?: number | null },
  prior: { recurrence?: SessionTaskSchema.TaskRecurrence | null; scheduled_at?: number | null } | undefined,
  now: number,
): boolean => {
  const effectiveRecurrence = task.recurrence ?? prior?.recurrence ?? undefined
  const effectiveScheduledAt = task.scheduledAt ?? prior?.scheduled_at ?? undefined
  if (effectiveRecurrence !== undefined && nextRun(effectiveRecurrence.cron, now) === undefined) return true
  if (task.status === "scheduled") {
    const hasTrigger = effectiveRecurrence?.enabled
      ? nextRun(effectiveRecurrence.cron, now) !== undefined
      : effectiveScheduledAt !== undefined && Number.isFinite(effectiveScheduledAt)
    return !hasTrigger
  }
  return false
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
    const events = yield* EventV2.Service

    const read = (sessionID: SessionSchema.ID) =>
      db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, sessionID))
        .orderBy(asc(TaskTable.position))
        .all()
        .pipe(Effect.orDie)

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

    const update = Effect.fn("SessionTask.update")((input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
      readonly expectedRevision?: number
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      // Mint ids up front (deterministic) so the event and the transaction agree.
      const planned = input.tasks.map((task, index) => ({
        ...planTask(task, task.id ?? Identifier.ascending("task")),
        position: index,
      }))
      const retained = new Set(planned.map((task) => task.id))
      const now = (yield* DateTime.nowAsDate).getTime()
      const createdAt = new Map<string, number>()
      const revisionById = new Map<string, number>()
      const parentIdById = new Map<string, string | null>()
      const digestById = new Map<string, string | null>()
      const scheduleById = new Map<
        string,
        { agentID?: string; scheduledAt?: number; recurrence?: SessionTaskSchema.TaskRecurrence }
      >()
      const spawnById = new Map<string, { spawnedFrom?: string; dependsOn?: readonly string[] }>()

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
                      rows.map((row) => ({ id: row.id, status: row.status, dependsOn: row.depends_on ?? undefined })),
                    ),
                    Effect.orDie,
                  ),
              [
                ...existing.map((row) => ({ id: row.id, status: row.status, dependsOn: row.depends_on ?? undefined })),
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
                error: new TaskWriteError({ sessionID: input.sessionID, id: cycle[0], reason: "depends_on_cycle" }),
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
              if (hasDeadSchedule(task, prior, now)) {
                invalid = new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "invalid_schedule" })
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
            for (const row of existing) createdAt.set(row.id, row.time_created)
            for (const task of planned) {
              const prior = existingById.get(task.id)
              const nextRevision = (prior?.revision ?? 0) + 1
              revisionById.set(task.id, nextRevision)
              const columns = {
                content: task.content,
                status: task.status,
                priority: task.priority,
                parent_id: task.parentID ?? prior?.parent_id ?? null,
                agent_id: task.agentID ?? prior?.agent_id ?? null,
                scheduled_at: task.scheduledAt ?? prior?.scheduled_at ?? null,
                recurrence: task.recurrence ?? prior?.recurrence ?? null,
                spawned_from: task.spawnedFrom ?? prior?.spawned_from ?? null,
                depends_on: task.dependsOn ?? prior?.depends_on ?? null,
                revision: nextRevision,
                position: task.position,
                time_updated: now,
              }
              // Capture the effective parent_id (resolved from the input or the
              // existing row) so the returned Info matches what was persisted.
              parentIdById.set(task.id, columns.parent_id)
              // WriteInfo carries no outputDigest (only patch sets it), so the
              // digest always survives reconcile via the existing row; mirror it
              // into the resolved Info to keep the event payload in sync with the DB.
              digestById.set(task.id, prior?.output_digest ?? null)
              scheduleById.set(task.id, {
                ...(columns.agent_id ? { agentID: columns.agent_id } : {}),
                ...(columns.scheduled_at !== null && columns.scheduled_at !== undefined
                  ? { scheduledAt: columns.scheduled_at }
                  : {}),
                ...(columns.recurrence ? { recurrence: columns.recurrence } : {}),
              })
              spawnById.set(task.id, {
                ...(columns.spawned_from ? { spawnedFrom: columns.spawned_from } : {}),
                ...(columns.depends_on && columns.depends_on.length > 0 ? { dependsOn: columns.depends_on } : {}),
              })
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
            return yield* Effect.succeed({ type: "ok" as const })
          }),
        )
        .pipe(Effect.orDie)

      if (result.type === "invalid") {
        return yield* Effect.fail(result.error)
      }

      const resolved: Info[] = planned.map((task) => {
        const parentID = parentIdById.get(task.id)
        const outputDigest = digestById.get(task.id)
        const schedule = scheduleById.get(task.id)
        const spawn = spawnById.get(task.id)
        const run = resolveNextRun({ status: task.status, ...schedule }, now)
        return new Info({
          id: task.id,
          content: task.content,
          status: task.status,
          priority: task.priority,
          sessionID: input.sessionID,
          revision: revisionById.get(task.id) ?? 1,
          ...(parentID ? { parentID } : {}),
          ...(outputDigest ? { outputDigest } : {}),
          ...(schedule?.agentID ? { agentID: schedule.agentID } : {}),
          ...(schedule?.scheduledAt !== undefined ? { scheduledAt: schedule.scheduledAt } : {}),
          ...(schedule?.recurrence ? { recurrence: schedule.recurrence } : {}),
          ...(run !== undefined ? { nextRun: run } : {}),
          ...(spawn?.spawnedFrom ? { spawnedFrom: spawn.spawnedFrom } : {}),
          ...(spawn?.dependsOn && spawn.dependsOn.length > 0 ? { dependsOn: spawn.dependsOn } : {}),
          createdAt: createdAt.get(task.id) ?? now,
          updatedAt: now,
        })
      })
      yield* publishBoth(input.sessionID, resolved)
      return resolved
    })))

    const append = Effect.fn("SessionTask.append")((input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const planned = input.tasks.map((task) => planTask(task, task.id ?? Identifier.ascending("task")))
      // Dead-job guard (differential-review HIGH-4): reject a recurrence cron
      // that is malformed / has no future run, or a `scheduled` task with no
      // trigger, before any insert. Append has no prior row, so the effective
      // schedule is the input itself.
      for (const task of input.tasks) {
        if (hasDeadSchedule(task, undefined, now)) {
          return yield* Effect.fail(
            new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "invalid_schedule" }),
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
            const graph = yield* reachableCycleGraph(
              (ids) =>
                tx
                  .select()
                  .from(TaskTable)
                  .where(inArray(TaskTable.id, [...ids]))
                  .all()
                  .pipe(
                    Effect.map((rows) =>
                      rows.map((row) => ({ id: row.id, status: row.status, dependsOn: row.depends_on ?? undefined })),
                    ),
                    Effect.orDie,
                  ),
              [
                ...existing.map((row) => ({ id: row.id, status: row.status, dependsOn: row.depends_on ?? undefined })),
                ...planned.map((task) => ({ id: task.id, status: task.status, dependsOn: task.dependsOn })),
              ],
            )
            const cycle = TaskDag.findCycle(graph)
            if (cycle) {
              return {
                type: "invalid" as const,
                error: new TaskWriteError({ sessionID: input.sessionID, id: cycle[0], reason: "depends_on_cycle" }),
              }
            }
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
            const full = yield* tx
              .select()
              .from(TaskTable)
              .where(eq(TaskTable.session_id, input.sessionID))
              .orderBy(asc(TaskTable.position))
              .all()
              .pipe(Effect.orDie)
            return { type: "ok" as const, resolved: full.map((row) => toInfo(row, now)) }
          }),
        )
        .pipe(Effect.orDie)
      if (result.type === "invalid") {
        return yield* Effect.fail(result.error)
      }
      yield* publishBoth(input.sessionID, result.resolved)
      return result.resolved
    })))

    const replaceLegacy = Effect.fn("SessionTask.replaceLegacy")((input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<typeof WriteInfo.Type>
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
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
            // Dead-job guard (re-review M-1): the legacy TodoWrite bridge can
            // carry `status: "scheduled"` with no trigger — reject instead of
            // persisting a job the daemon's arm scan can never pick up.
            for (const [index, task] of input.tasks.entries()) {
              if (hasDeadSchedule(task, existing[index], now)) {
                return {
                  type: "invalid" as const,
                  error: new TaskWriteError({
                    sessionID: input.sessionID,
                    id: task.id ?? existing[index]?.id,
                    reason: "invalid_schedule",
                  }),
                }
              }
            }
            for (const [index, task] of input.tasks.entries()) {
              const prior = existing[index]
              const id = prior?.id ?? Identifier.ascending("task")
              const columns = {
                content: task.content,
                status: task.status,
                priority: task.priority,
                parent_id: prior?.parent_id ?? task.parentID ?? null,
                agent_id: prior?.agent_id ?? task.agentID ?? null,
                scheduled_at: prior?.scheduled_at ?? task.scheduledAt ?? null,
                recurrence: prior?.recurrence ?? task.recurrence ?? null,
                spawned_from: prior?.spawned_from ?? task.spawnedFrom ?? null,
                depends_on: prior?.depends_on ?? task.dependsOn ?? null,
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
            const full = yield* tx
              .select()
              .from(TaskTable)
              .where(eq(TaskTable.session_id, input.sessionID))
              .orderBy(asc(TaskTable.position))
              .all()
              .pipe(Effect.orDie)
            return { type: "ok" as const, resolved: full.map((row) => toInfo(row, now)) }
          }),
        )
        .pipe(Effect.orDie)
      if (result.type === "invalid") {
        return yield* Effect.fail(result.error)
      }
      yield* publishBoth(input.sessionID, result.resolved)
      return result.resolved
    })))

    const get = Effect.fn("SessionTask.get")(function* (sessionID: SessionSchema.ID) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const rows = yield* read(sessionID)
      return rows.map((row) => toInfo(row, now))
    })

    const patch = Effect.fn("SessionTask.patch")((input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly status: SessionTaskSchema.TaskStatus
      readonly outputDigest?: string
      readonly expect?: ReadonlyArray<SessionTaskSchema.TaskStatus>
      readonly expectedRevision?: number
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
      const prior = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!prior) return undefined
      // Conditional claim: the expected-status check runs inside the write
      // lock, so a pause (cancelled) racing the claim cannot be flipped back
      // to in_progress — the loser resolves undefined and the caller aborts.
      if (input.expect !== undefined && !input.expect.some((status) => status === prior.status)) return undefined
      // P3-a: revision-level optimistic concurrency. Like `expect`, the check
      // runs inside the write lock so a concurrent write cannot slip in between
      // the read and the update; a stale caller resolves undefined (no write).
      if (input.expectedRevision !== undefined && prior.revision !== input.expectedRevision) return undefined
      // Schedule invariant (differential-review HIGH-4): flipping a task to
      // `scheduled` requires it to already carry a real trigger — patch never
      // sets schedule fields, so a resume on a task that was never a scheduled
      // job would persist a row the daemon's arm scan can never pick up.
      if (hasDeadSchedule(input, prior, now)) {
        return yield* Effect.fail(
          new TaskWriteError({ sessionID: input.sessionID, id: input.id, reason: "invalid_schedule" }),
        )
      }
      // Persist the digest (M2): TaskPanel reload-recovery reads it back after a
      // refresh. A patch without one leaves the stored digest intact.
      yield* db
        .update(TaskTable)
        .set({
          status: input.status,
          revision: prior.revision + 1,
          time_updated: now,
          ...(input.outputDigest !== undefined ? { output_digest: input.outputDigest } : {}),
        })
        .where(scoped)
        .run()
        .pipe(Effect.orDie)
      const row = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!row) return undefined
      // The event re-reads the table and maps rows to Info, so the patched
      // digest rides the payload (DB and event payload stay in agreement).
      const full = yield* read(input.sessionID).pipe(Effect.map((rows) => rows.map((item) => toInfo(item, now))))
      yield* publishBoth(input.sessionID, full)
      // The row was re-read after the update set time_updated = now, so toInfo
      // already carries updatedAt = now — no post-hoc override needed.
      return toInfo(row, now)
    })))

    const remove = Effect.fn("SessionTask.delete")((sessionID: SessionSchema.ID) =>
      writeLock.withPermits(1)(Effect.gen(function* () {
      yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* publishBoth(sessionID, [])
    })))

    const removeTask = Effect.fn("SessionTask.removeTask")((input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
      const row = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!row) return undefined
      yield* db.delete(TaskTable).where(scoped).run().pipe(Effect.orDie)
      const full = yield* read(input.sessionID).pipe(Effect.map((rows) => rows.map((item) => toInfo(item, now))))
      yield* publishBoth(input.sessionID, full)
      return toInfo(row, now)
    })))

    const updateTask = Effect.fn("SessionTask.updateTask")((input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly content?: string
      readonly priority?: SessionTaskSchema.TaskPriority
      readonly expectedRevision?: number
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
      const prior = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!prior) return undefined
      if (input.expectedRevision !== undefined && prior.revision !== input.expectedRevision) return undefined
      yield* db
        .update(TaskTable)
        .set({
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          revision: prior.revision + 1,
          time_updated: now,
        })
        .where(scoped)
        .run()
        .pipe(Effect.orDie)
      const row = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!row) return undefined
      const full = yield* read(input.sessionID).pipe(Effect.map((rows) => rows.map((item) => toInfo(item, now))))
      yield* publishBoth(input.sessionID, full)
      return toInfo(row, now)
    })))

    const reorder = Effect.fn("SessionTask.reorder")((input: {
      readonly sessionID: SessionSchema.ID
      readonly ids: readonly string[]
      readonly expectedRevision?: number
    }) => writeLock.withPermits(1)(Effect.gen(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const existing = yield* read(input.sessionID)
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
      yield* db
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
          }),
        )
        .pipe(Effect.orDie)
      const full = yield* read(input.sessionID).pipe(Effect.map((rows) => rows.map((item) => toInfo(item, now))))
      yield* publishBoth(input.sessionID, full)
      return full
    })))

    const recordProgress = Effect.fn("SessionTask.recordProgress")((input: {
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
      return rows.map((row) => toInfo(row, now))
    })

    return Service.of({ update, append, replaceLegacy, patch, get, delete: remove, removeTask, updateTask, reorder, recordProgress, listAll })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])
