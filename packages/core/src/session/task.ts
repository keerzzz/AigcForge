export * as SessionTask from "./task"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { LayerNode } from "../effect/layer-node"
import { SessionSchema } from "./schema"
import { TaskTable } from "./sql"

export const Info = SessionTaskSchema.Info
export type Info = typeof Info.Type

/**
 * Write shape accepted by {@link SessionTask.update}/{@link SessionTask.append}/
 * {@link SessionTask.replaceLegacy}. `id` is optional: absent tasks are minted a
 * stable `tsk_` id. M0 persists only the id/content/status/priority/parentID/
 * sessionID fields; `outputDigest` rides the returned list and the `task.updated`
 * event but is not stored until M2.
 */
export class WriteInfo extends Schema.Class<WriteInfo>("SessionTask.WriteInfo")({
  id: Schema.optional(Schema.String),
  content: Schema.String,
  status: SessionTaskSchema.TaskStatus,
  priority: SessionTaskSchema.TaskPriority,
  parentID: Schema.optional(Schema.String),
}) {}

/**
 * Compatibility projection of a task into the legacy three-field todo shape so
 * existing App/TUI `todo.updated` consumers keep working against the task source.
 */
export const TodoProjection = Schema.Struct({
  content: Schema.String,
  status: Schema.String,
  priority: Schema.String,
}).annotate({ identifier: "SessionTask.TodoProjection" })

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
  /** Reconcile a session's task list by id: upsert present rows, delete absent ones, republish. */
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<WriteInfo>
  }) => Effect.Effect<ReadonlyArray<Info>>
  /**
   * Append new tasks at the end of the session's list in a single transaction.
   * Positions are computed and the full list is re-read atomically, so
   * concurrent appends (multiple task tool calls in one provider turn) never
   * drop each other's rows — unlike a read-modify-reconcile.
   */
  readonly append: (input: {
    readonly sessionID: SessionSchema.ID
    readonly tasks: ReadonlyArray<WriteInfo>
  }) => Effect.Effect<ReadonlyArray<Info>>
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
   * Other rows are untouched; `outputDigest` rides the returned Info and the
   * republished `task.updated` event but is not stored in M2.
   */
  readonly patch: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly status: SessionTaskSchema.TaskStatus
    readonly outputDigest?: string
  }) => Effect.Effect<Info | undefined>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  /** Remove every task owned by the session. */
  readonly delete: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionTask") {}

type TaskRow = typeof TaskTable.$inferSelect

const toInfo = (row: TaskRow): Info =>
  new Info({
    id: row.id,
    content: row.content,
    status: row.status,
    priority: row.priority,
    sessionID: row.session_id,
    ...(row.parent_id ? { parentID: row.parent_id } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

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
          todos: tasks.map((task) => ({ content: task.content, status: task.status, priority: task.priority })),
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

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx
              .select()
              .from(TaskTable)
              .where(eq(TaskTable.session_id, input.sessionID))
              .all()
              .pipe(Effect.orDie)
            const existingById = new Map(existing.map((row) => [row.id, row]))
            for (const row of existing) createdAt.set(row.id, row.time_created)
            for (const task of planned) {
              const columns = {
                content: task.content,
                status: task.status,
                priority: task.priority,
                parent_id: task.parentID ?? null,
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
          }),
        )
        .pipe(Effect.orDie)

      const resolved: Info[] = planned.map((task) =>
        new Info({
          id: task.id,
          content: task.content,
          status: task.status,
          priority: task.priority,
          sessionID: input.sessionID,
          ...(task.parentID ? { parentID: task.parentID } : {}),
          createdAt: createdAt.get(task.id) ?? now,
          updatedAt: now,
        }),
      )
      yield* publishBoth(input.sessionID, resolved)
      return resolved
    })

    const append = Effect.fn("SessionTask.append")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly tasks: ReadonlyArray<WriteInfo>
    }) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const planned = input.tasks.map((task) => ({ id: task.id ?? Identifier.ascending("task"), ...task }))
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
            return full.map(toInfo)
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
            return full.map(toInfo)
          }),
        )
        .pipe(Effect.orDie)
      yield* publishBoth(input.sessionID, resolved)
      return resolved
    })

    const get = Effect.fn("SessionTask.get")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* read(sessionID)
      return rows.map(toInfo)
    })

    const patch = Effect.fn("SessionTask.patch")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly id: string
      readonly status: SessionTaskSchema.TaskStatus
      readonly outputDigest?: string
    }) {
      const now = (yield* DateTime.nowAsDate).getTime()
      const scoped = and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID))
      yield* db.update(TaskTable).set({ status: input.status, time_updated: now }).where(scoped).run().pipe(Effect.orDie)
      const row = yield* db.select().from(TaskTable).where(scoped).get().pipe(Effect.orDie)
      if (!row) return undefined
      const info: Info = new Info({
        ...toInfo(row),
        updatedAt: now,
        ...(input.outputDigest ? { outputDigest: input.outputDigest } : {}),
      })
      // The event carries the digest for the patched task even though M2 does not
      // store it yet, so consumers can jump to the child Session from the payload.
      const full = yield* read(input.sessionID).pipe(
        Effect.map((rows) =>
          rows.map((r) => {
            const current = toInfo(r)
            return current.id === input.id && input.outputDigest
              ? new Info({ ...current, updatedAt: now, outputDigest: input.outputDigest })
              : current
          }),
        ),
      )
      yield* publishBoth(input.sessionID, full)
      return info
    })

    const remove = Effect.fn("SessionTask.delete")(function* (sessionID: SessionSchema.ID) {
      yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* publishBoth(sessionID, [])
    })

    return Service.of({ update, append, replaceLegacy, patch, get, delete: remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])
