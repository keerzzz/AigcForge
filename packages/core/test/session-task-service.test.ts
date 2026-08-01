import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionTask.defaultLayer))
const sessionID = SessionV2.ID.make("ses_task_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "task",
      directory: "/project",
      title: "task",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionTask", () => {
  it.effect("inserts in order, patches by id keeping position, deletes, and publishes task.updated", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      // Insert 3 tasks without ids — the service assigns stable tsk_ ids.
      const resolved = yield* tasks.update({
        sessionID,
        tasks: [
          { content: "third", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
          { content: "second", status: "pending", priority: "medium" },
        ],
      })
      expect(resolved.map((task) => task.content)).toEqual(["third", "first", "second"])
      expect(resolved.every((task) => task.id.startsWith("tsk_"))).toBe(true)
      const [third, first, second] = resolved
      expect(new Set(resolved.map((task) => task.id)).size).toBe(3)

      expect(yield* tasks.get(sessionID)).toEqual(resolved)

      // Update one task's status by id — its position is unchanged.
      const after = yield* tasks.update({
        sessionID,
        tasks: [
          { ...third, status: "completed" },
          { ...first, status: "in_progress" },
          { ...second, status: "pending" },
        ],
      })
      expect(after.map((task) => task.content)).toEqual(["third", "first", "second"])
      expect(after[0].status).toBe("completed")

      const rows = yield* db
        .select()
        .from(TaskTable)
        .orderBy(asc(TaskTable.position))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => ({ id: row.id, content: row.content, position: row.position }))).toEqual([
        { id: third.id, content: "third", position: 0 },
        { id: first.id, content: "first", position: 1 },
        { id: second.id, content: "second", position: 2 },
      ])

      // delete clears the session's tasks.
      yield* tasks.delete(sessionID)
      expect(yield* tasks.get(sessionID)).toEqual([])

      expect(published.map((event) => event.type)).toEqual([
        SessionTask.Event.Updated.type,
        SessionTask.Event.Updated.type,
        SessionTask.Event.Updated.type,
      ])
      expect(published[0].data).toEqual({ sessionID, tasks: resolved })
      expect(published.at(-1)?.data).toEqual({ sessionID, tasks: [] })
    }),
  )
})
