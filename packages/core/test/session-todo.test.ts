import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { Global } from "@aigcfroge/util/global"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/aigcfroge" })),
)
const databaseLayer = Database.layer().pipe(Layer.provide(globalLayer))
const busNodeLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
  Bus.node.replace(Bus.configured()),
])

const it = testEffect(
  SessionTodo.defaultLayer.pipe(
    Layer.provideMerge(SessionTask.defaultLayer),
    Layer.provideMerge(busNodeLayer),
    Layer.provideMerge(databaseLayer),
    Layer.provideMerge(globalLayer),
  ),
)
const sessionID = Session.ID.make("ses_todo_test")

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
      const events = yield* Bus.Service
      const todos = yield* SessionTodo.Service
      const published = new Array<unknown>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.TodoUpdated.type) published.push(event.data)
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
      expect(published).toEqual([
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
      const staleSession = Session.ID.make("ses_todo_stale_test")
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
