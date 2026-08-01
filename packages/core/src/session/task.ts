export * as SessionTask from "./task"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
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
 * Write shape accepted by {@link SessionTask.update}. `id` is optional: absent
 * tasks are minted a stable `tsk_` id. M0 persists only the id/content/status/
 * priority/parentID/sessionID fields; `outputDigest` rides the returned list and
 * the `task.updated` event but is not stored until M1.5.
 */
export const WriteInfo = Schema.Struct({
  id: Schema.optional(Schema.String),
  content: Schema.String,
  status: SessionTaskSchema.TaskStatus,
  priority: SessionTaskSchema.TaskPriority,
  parentID: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionTask.WriteInfo" })
export type WriteInfo = typeof WriteInfo.Type

export const Event = {
  Updated: EventV2.define({
    type: "task.updated",
    schema: {
      sessionID: SessionSchema.ID,
      tasks: Schema.Array(Info),
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
   * Target a single task by id and update its status (delegation writeback).
   * Other rows are untouched; `outputDigest` rides the returned Info and the
   * republished `task.updated` event but is not stored in M0.
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

const toInfo = (row: TaskRow): Info => ({
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
      const now = yield* Effect.sync(() => Date.now())

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

      const resolved: Info[] = planned.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.status,
        priority: task.priority,
        sessionID: input.sessionID,
        ...(task.parentID ? { parentID: task.parentID } : {}),
        createdAt: now,
        updatedAt: now,
      }))
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, tasks: resolved })
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
      const now = yield* Effect.sync(() => Date.now())
      yield* db
        .update(TaskTable)
        .set({ status: input.status, time_updated: now })
        .where(and(eq(TaskTable.id, input.id), eq(TaskTable.session_id, input.sessionID)))
        .run()
        .pipe(Effect.orDie)
      const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, input.id)).get().pipe(Effect.orDie)
      if (!row) return undefined
      const info: Info = {
        ...toInfo(row),
        updatedAt: now,
        ...(input.outputDigest ? { outputDigest: input.outputDigest } : {}),
      }
      // The event carries the digest for the patched task even though M0 does not
      // store it, so consumers can jump to the child Session from the payload.
      const full = yield* read(input.sessionID).pipe(
        Effect.map((rows) =>
          rows.map((r) => {
            const current = toInfo(r)
            return current.id === input.id && input.outputDigest
              ? { ...current, updatedAt: now, outputDigest: input.outputDigest }
              : current
          }),
        ),
      )
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, tasks: full })
      return info
    })

    const remove = Effect.fn("SessionTask.delete")(function* (sessionID: SessionSchema.ID) {
      yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID, tasks: [] })
    })

    return Service.of({ update, patch, get, delete: remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])
