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
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionTask.defaultLayer, SessionTodo.defaultLayer),
)
const sessionID = SessionV2.ID.make("ses_todo_test")

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
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionTodo", () => {
  it.effect("replaces persisted todos in order and publishes updates", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.TodoUpdated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* todos.update({
        sessionID,
        todos: [
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
        ],
      })
      expect(yield* todos.get(sessionID)).toEqual([
        { content: "second", status: "pending", priority: "low" },
        { content: "first", status: "in_progress", priority: "high" },
      ])
      // SessionTodo now forwards to the Task source: rows land in TaskTable.
      const rows = yield* db.select().from(TaskTable).orderBy(asc(TaskTable.position)).all().pipe(Effect.orDie)
      expect(rows.map((row) => ({ content: row.content, position: row.position }))).toEqual([
        { content: "second", position: 0 },
        { content: "first", position: 1 },
      ])
      expect(rows.every((row) => row.id.startsWith("tsk_"))).toBe(true)

      yield* todos.update({ sessionID, todos: [{ content: "replacement", status: "completed", priority: "medium" }] })
      expect(yield* todos.get(sessionID)).toEqual([{ content: "replacement", status: "completed", priority: "medium" }])

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          todos: [
            { content: "second", status: "pending", priority: "low" },
            { content: "first", status: "in_progress", priority: "high" },
          ],
        },
        { sessionID, todos: [{ content: "replacement", status: "completed", priority: "medium" }] },
        { sessionID, todos: [] },
      ])
    }),
  )

  it.effect("rejects a stale full-list write after an out-of-band append, then accepts the merged retry", () =>
    Effect.gen(function* () {
      yield* setup
      // Own session: the process-level write baseline is keyed by sessionID
      // and shared across tests in this file.
      const staleSession = SessionV2.ID.make("ses_todo_stale_test")
      const { db } = yield* Database.Service
      yield* db
        .insert(SessionTable)
        .values({
          id: staleSession,
          project_id: Project.ID.global,
          slug: "todo-stale",
          directory: "/project",
          title: "todo-stale",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const tasks = yield* SessionTask.Service
      const todos = yield* SessionTodo.Service

      yield* todos.update({
        sessionID: staleSession,
        todos: [{ content: "a", status: "pending", priority: "low" }],
      })
      // Another write path (task tool / HTTP / scheduler) lands in between.
      yield* tasks.append({
        sessionID: staleSession,
        tasks: [{ content: "server", status: "in_progress", priority: "high" }],
      })

      const stale = yield* todos
        .update({
          sessionID: staleSession,
          todos: [{ content: "a", status: "completed", priority: "low" }],
        })
        .pipe(Effect.flip)
      expect(stale).toBeInstanceOf(SessionTask.TaskWriteError)
      expect(stale.reason).toBe("stale_revision")
      // The rejected write did not touch the out-of-band row.
      expect((yield* todos.get(staleSession)).map((todo) => todo.content)).toEqual(["a", "server"])

      // The caller merged against the current list; the retry passes and
      // rebuilds the baseline.
      const merged = yield* todos.update({
        sessionID: staleSession,
        todos: [
          { content: "a", status: "completed", priority: "low" },
          { content: "server", status: "in_progress", priority: "high" },
        ],
      })
      expect(merged.map((todo) => todo.content)).toEqual(["a", "server"])
      expect((yield* todos.get(staleSession))[0]?.status).toBe("completed")
    }),
  )
})
