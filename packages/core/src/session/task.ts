export * as SessionTask from "./task"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
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
export interface WriteInfo {
  readonly id?: string
  readonly content: string
  readonly status: SessionTaskSchema.TaskStatus
  readonly priority: SessionTaskSchema.TaskPriority
  readonly parentID?: string
  readonly outputDigest?: string
}

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
        ...(task.outputDigest ? { outputDigest: task.outputDigest } : {}),
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

    const remove = Effect.fn("SessionTask.delete")(function* (sessionID: SessionSchema.ID) {
      yield* db.delete(TaskTable).where(eq(TaskTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID, tasks: [] })
    })

    return Service.of({ update, get, delete: remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
