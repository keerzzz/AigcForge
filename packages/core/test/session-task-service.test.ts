import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
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

  it.effect("concurrent appends never drop each other's tasks", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service

      yield* Effect.all(
        ["a", "b", "c"].map((content) =>
          tasks.append({ sessionID, tasks: [{ content, status: "pending", priority: "low" }] }),
        ),
        { concurrency: "unbounded" },
      )

      const got = yield* tasks.get(sessionID)
      expect(got.map((task) => task.content).sort()).toEqual(["a", "b", "c"])
      expect(new Set(got.map((task) => task.id)).size).toBe(3)
    }),
  )

  it.effect("patch is scoped to the owning session", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const otherSession = SessionV2.ID.make("ses_task_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-other",
          directory: "/project",
          title: "task-other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const tasks = yield* SessionTask.Service
      const [otherTask] = yield* tasks.update({
        sessionID: otherSession,
        tasks: [{ content: "other", status: "pending", priority: "low" }],
      })

      // Patching with another session's task id is a no-op, not a cross-session leak.
      const result = yield* tasks.patch({ sessionID, id: otherTask.id, status: "completed" })
      expect(result).toBeUndefined()
      const other = yield* tasks.get(otherSession)
      expect(other[0]?.status).toBe("pending")
    }),
  )

  it.effect("update preserves createdAt for existing tasks", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [created] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "x", status: "pending", priority: "low" }],
      })
      yield* tasks.update({
        sessionID,
        tasks: [{ ...created, status: "completed" }],
      })
      const got = yield* tasks.get(sessionID)
      expect(got[0]?.status).toBe("completed")
      expect(got[0]?.createdAt).toBe(created.createdAt)
    }),
  )

  it.effect("task writes emit a compatible todo.updated projection", () =>
    Effect.gen(function* () {
      yield* setup
      const events = yield* EventV2.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.TodoUpdated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* tasks.update({
        sessionID,
        tasks: [{ content: "x", status: "in_progress", priority: "high" }],
      })
      const data = Schema.decodeUnknownSync(SessionTask.Event.TodoUpdated.data)(published[0]?.data)
      expect(data.todos).toEqual([{ content: "x", status: "in_progress", priority: "high" }])
    }),
  )

  it.effect("legacy todowrite replace preserves the id a background delegation settled", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const todos = yield* SessionTodo.Service

      // A background delegation creates a linked task (tsk_A).
      const [linked] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
      })

      // Legacy todowrite replaces the whole list — the linked id must survive,
      // otherwise the delegation's settle patch would no-op on a rebuilt id.
      yield* todos.update({
        sessionID,
        todos: [{ content: "audit", status: "in_progress", priority: "medium" }],
      })
      const afterReplace = yield* tasks.get(sessionID)
      expect(afterReplace.map((task) => task.id)).toEqual([linked.id])

      // The delegation settle writeback still lands on the linked task.
      const patched = yield* tasks.patch({
        sessionID,
        id: linked.id,
        status: "completed",
        outputDigest: "ses_child",
      })
      expect(patched?.id).toBe(linked.id)
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("completed")
    }),
  )

  it.effect("update rejects foreign and duplicate client ids with TaskWriteError and writes nothing", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [seeded] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "keep", status: "pending", priority: "low" }],
      })

      // An id not owned by this session (stale reference or forge attempt).
      const foreign = yield* tasks
        .update({
          sessionID,
          tasks: [{ id: "tsk_0000000000000000000000zz", content: "x", status: "pending", priority: "low" }],
        })
        .pipe(Effect.flip)
      expect(foreign).toBeInstanceOf(SessionTask.TaskWriteError)
      expect(foreign.reason).toBe("foreign")

      // The same id twice in one payload.
      const duplicate = yield* tasks
        .update({
          sessionID,
          tasks: [
            { id: seeded.id, content: "keep", status: "completed", priority: "low" },
            { id: seeded.id, content: "keep", status: "pending", priority: "low" },
          ],
        })
        .pipe(Effect.flip)
      expect(duplicate).toBeInstanceOf(SessionTask.TaskWriteError)
      expect(duplicate.reason).toBe("duplicate")

      // Rejection happens before any write: the seeded row is untouched.
      const got = yield* tasks.get(sessionID)
      expect(got).toHaveLength(1)
      expect(got[0]?.id).toBe(seeded.id)
      expect(got[0]?.status).toBe("pending")
    }),
  )

  it.effect("update preserves parentID when omitted and reports it in the resolved payload", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [parent] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "parent", status: "pending", priority: "low" }],
      })
      const [, child] = yield* tasks.update({
        sessionID,
        tasks: [parent, { content: "child", status: "in_progress", priority: "medium", parentID: parent.id }],
      })
      expect(child.parentID).toBe(parent.id)

      // A later update that omits parentID must keep the stored link and must
      // reflect it in the resolved Info (event payload matches the DB).
      const resolved = yield* tasks.update({
        sessionID,
        tasks: [parent, { id: child.id, content: "child", status: "completed", priority: "medium" }],
      })
      expect(resolved[1]?.parentID).toBe(parent.id)
      expect((yield* tasks.get(sessionID))[1]?.parentID).toBe(parent.id)
    }),
  )
})
