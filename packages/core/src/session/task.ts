export * as SessionTask from "./task"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { LayerNode } from "../effect/layer-node"
import { nextRun } from "./schedule"
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
 * HTTP PATCH path bypasses the task_schedule tool's own guard). The first two
 * would otherwise hit the global `task.id` PK constraint and surface as an
 * unhandled 500 defect; all three are rejected up front as a typed failure
 * (HTTP 400).
 */
export class TaskWriteError extends Schema.TaggedErrorClass<TaskWriteError>()("SessionTask.TaskWriteError", {
  sessionID: SessionSchema.ID,
  id: Schema.optional(Schema.String),
  reason: Schema.Literals(["foreign", "duplicate", "invalid_schedule"]),
}) {
  override get message() {
    switch (this.reason) {
      case "foreign":
        return `Task id "${this.id}" is not owned by session ${this.sessionID}`
      case "duplicate":
        return `Duplicate task id "${this.id}" in payload for session ${this.sessionID}`
      case "invalid_schedule":
        return `Task ${this.id ? `"${this.id}" ` : ""}in session ${this.sessionID} has an invalid recurrence cron: it is malformed or has no future run within the search window`
    }
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
}

export interface Interface {
  /**
   * Reconcile a session's task list by id: upsert present rows, delete absent ones, republish.
   * Fails with {@link TaskWriteError} when a client-supplied id is foreign to the session
   * or duplicated within the payload.
   */
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<WriteInfo>
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Append new tasks at the end of the session's list in a single transaction.
   * Positions are computed and the full list is re-read atomically, so
   * concurrent appends (multiple task tool calls in one provider turn) never
   * drop each other's rows — unlike a read-modify-reconcile.
   */
  readonly append: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<WriteInfo>
  }) => Effect.Effect<ReadonlyArray<Info>, TaskWriteError>
  /**
   * Legacy todowrite bridge: reconcile by position, reusing existing ids so a
   * delegation writeback to a linked task survives a later full-list replace.
   * New positions mint ids, trailing rows are removed, all in one transaction.
   */
  readonly replaceLegacy: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<WriteInfo>
  }) => Effect.Effect<ReadonlyArray<Info>>
  /**
   * Target a single task by id and update its status (delegation writeback).
   * Other rows are untouched; `outputDigest` is persisted (M2) and rides the
   * returned Info and the republished `task.updated` event.
   */
  readonly patch: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly status: SessionTaskSchema.TaskStatus
    readonly outputDigest?: string
  }) => Effect.Effect<Info | undefined>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  /**
   * Every task across all sessions (M4 Agent Hub aggregation source). Rows keep
   * their owning `sessionID` and `agentID` so the client can group by agent and
   * surface unassigned tasks.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<Info>>
  /** Remove every task owned by the session. */
  readonly delete: (sessionID: SessionSchema.ID) => Effect.Effect<void>
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
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })
}

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

    const update = Effect.fn("SessionTask.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<WriteInfo>
    }) {
      // Mint ids up front (deterministic) so the event and the transaction agree.
      const planned = input.tasks.map((task, index) => ({
        id: task.id ?? Identifier.ascending("task"),
        ...task,
        position: index,
      }))
      const retained = new Set(planned.map((task) => task.id))
      const now = (yield* DateTime.nowAsDate).getTime()
      const createdAt = new Map<string, number>()
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
            // Reject foreign ids (client-supplied ids not owned by this session)
            // and duplicate ids within the payload before any writes. The loop
            // collects the first violation; the failure is raised after the loop
            // so every return statement in this gen is value-bearing.
            const seen = new Set<string>()
            let invalid: TaskWriteError | undefined
            // Dead-job guard (mirrors task_schedule): a recurrence cron that is
            // malformed or yields no future run within the search window must be
            // rejected, not persisted as a job that can never fire. Runs for new
            // (id-less) tasks too, so the HTTP PATCH path cannot revive the hole.
            for (const task of input.tasks) {
              if (task.recurrence !== undefined && nextRun(task.recurrence.cron, now) === undefined) {
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
    })

    const append = Effect.fn("SessionTask.append")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<WriteInfo>
    }) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const planned = input.tasks.map((task) => ({ id: task.id ?? Identifier.ascending("task"), ...task }))
      // Dead-job guard (mirrors task_schedule): reject malformed / no-future-run
      // recurrence crons before any insert.
      for (const task of input.tasks) {
        if (task.recurrence !== undefined && nextRun(task.recurrence.cron, now) === undefined) {
          return yield* Effect.fail(
            new TaskWriteError({ sessionID: input.sessionID, id: task.id, reason: "invalid_schedule" }),
          )
        }
      }
      const resolved = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx
              .select()
              .from(TaskTable)
              .where(eq(TaskTable.session_id, input.sessionID))
              .orderBy(asc(TaskTable.position))
              .all()
              .pipe(Effect.orDie)
            let position = existing.length
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
            return full.map((row) => toInfo(row, now))
          }),
        )
        .pipe(Effect.orDie)
      yield* publishBoth(input.sessionID, resolved)
      return resolved
    })

    const replaceLegacy = Effect.fn("SessionTask.replaceLegacy")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<WriteInfo>
    }) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const resolved = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx
              .select()
              .from(TaskTable)
              .where(eq(TaskTable.session_id, input.sessionID))
              .orderBy(asc(TaskTable.position))
              .all()
              .pipe(Effect.orDie)
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
            return full.map((row) => toInfo(row, now))
          }),
        )
        .pipe(Effect.orDie)
      yield* publishBoth(input.sessionID, resolved)
      return resolved
    })

    const get = Effect.fn("SessionTask.get")(function* (sessionID: SessionSchema.ID) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const rows = yield* read(sessionID)
      return rows.map((row) => toInfo(row, now))
    })

    const patch = Effect.fn("SessionTask.patch")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly status: SessionTaskSchema.TaskStatus
      readonly outputDigest?: string
    }) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
      // Persist the digest (M2): TaskPanel reload-recovery reads it back after a
      // refresh. A patch without one leaves the stored digest intact.
      yield* db
        .update(TaskTable)
        .set({
          status: input.status,
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
      return new Info({ ...toInfo(row, now), updatedAt: now })
    })

    const remove = Effect.fn("SessionTask.delete")(function* (sessionID: SessionSchema.ID) {
      yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* publishBoth(sessionID, [])
    })

    const listAll = Effect.fn("SessionTask.listAll")(function* () {
      const now = (yield* DateTime.nowAsDate).getTime()
      const rows = yield* db.select().from(TaskTable).orderBy(asc(TaskTable.position)).all().pipe(Effect.orDie)
      return rows.map((row) => toInfo(row, now))
    })

    return Service.of({ update, append, replaceLegacy, patch, get, delete: remove, listAll })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])
