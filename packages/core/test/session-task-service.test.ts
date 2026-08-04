import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer, Result, Schema } from "effect"
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

  it.effect("patch persists outputDigest and a later patch without one keeps it", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
      })

      // M2: the digest is now stored, so a re-read after patch still sees it
      // (TaskPanel reload-recovery depends on this surviving a page refresh).
      yield* tasks.patch({ sessionID, id: task.id, status: "completed", outputDigest: "ses_child" })
      const after = yield* tasks.get(sessionID)
      expect(after[0]?.outputDigest).toBe("ses_child")

      // A patch without a digest must not clear the stored one.
      yield* tasks.patch({ sessionID, id: task.id, status: "cancelled" })
      const final = yield* tasks.get(sessionID)
      expect(final[0]?.status).toBe("cancelled")
      expect(final[0]?.outputDigest).toBe("ses_child")
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
        tasks: [{ id: created.id, content: "x", status: "completed", priority: "low" }],
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

  it.effect("persists M3 schedule fields and keeps them through an omitting reconcile", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const recurrence = { cron: "0 9 * * *", enabled: true }
      const [scheduled] = yield* tasks.update({
        sessionID,
        tasks: [
          {
            content: "daily audit",
            status: "scheduled",
            priority: "medium",
            agentID: "ag_audit",
            scheduledAt: 1234,
            recurrence,
          },
        ],
      })
      expect(scheduled.agentID).toBe("ag_audit")
      expect(scheduled.scheduledAt).toBe(1234)
      expect(scheduled.recurrence).toMatchObject(recurrence)

      // Re-read from the table: the columns survived.
      const got = yield* tasks.get(sessionID)
      expect(got[0]?.agentID).toBe("ag_audit")
      expect(got[0]?.scheduledAt).toBe(1234)
      expect(got[0]?.recurrence).toMatchObject(recurrence)

      // A later reconcile that omits the schedule fields must keep the stored
      // values (same rule as parentID/digest) and report them in the resolved Info.
      const resolved = yield* tasks.update({
        sessionID,
        tasks: [{ id: scheduled.id, content: "daily audit", status: "scheduled", priority: "medium" }],
      })
      expect(resolved[0]?.agentID).toBe("ag_audit")
      expect(resolved[0]?.scheduledAt).toBe(1234)
      expect(resolved[0]?.recurrence).toMatchObject(recurrence)
    }),
  )

  it.effect("update reconcile preserves outputDigest in the resolved payload and the event", () =>
    Effect.gen(function* () {
      yield* setup
      const events = yield* EventV2.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      // A delegation settle writeback lands the child-session digest.
      const [created] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
      })
      yield* tasks.patch({ sessionID, id: created.id, status: "completed", outputDigest: "ses_child" })

      // A full-list reconcile (taskwrite / PATCH) must keep the digest in the DB,
      // the resolved Info, and the republished task.updated payload alike.
      const resolved = yield* tasks.update({
        sessionID,
        tasks: [{ id: created.id, content: "audit", status: "in_progress", priority: "medium" }],
      })
      expect(resolved[0]?.outputDigest).toBe("ses_child")
      expect((yield* tasks.get(sessionID))[0]?.outputDigest).toBe("ses_child")
      const data = Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(published.at(-1)?.data)
      expect(data.tasks[0]?.outputDigest).toBe("ses_child")
    }),
  )

  it.effect("listAll aggregates every task across sessions with session and agent tags (M4 hub)", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const otherSession = SessionV2.ID.make("ses_task_list_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-list-other",
          directory: "/project",
          title: "task-list-other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      yield* tasks.update({
        sessionID,
        tasks: [{ content: "build-a", status: "in_progress", priority: "high", agentID: "build" }],
      })
      yield* tasks.update({
        sessionID: otherSession,
        tasks: [
          {
            content: "build-b",
            status: "scheduled",
            priority: "medium",
            agentID: "build",
            recurrence: { cron: "0 9 * * *", enabled: true },
          },
          { content: "unowned", status: "pending", priority: "low" },
        ],
      })

      const all = yield* tasks.listAll()
      expect(all.map((task) => task.content).sort()).toEqual(["build-a", "build-b", "unowned"])
      const buildA = all.find((task) => task.content === "build-a")
      expect(buildA?.sessionID).toBe(sessionID)
      expect(buildA?.agentID).toBe("build")
      const buildB = all.find((task) => task.content === "build-b")
      expect(buildB?.sessionID).toBe(otherSession)
      expect(buildB?.agentID).toBe("build")
      expect(buildB?.recurrence?.cron).toBe("0 9 * * *")
      const unowned = all.find((task) => task.content === "unowned")
      expect(unowned?.sessionID).toBe(otherSession)
      expect(unowned?.agentID).toBeUndefined()
    }),
  )

  it.effect("update and append reject recurrence crons with no future run (dead-job guard)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service

      // A valid recurring cron persists.
      const ok = yield* tasks.update({
        sessionID,
        tasks: [
          { content: "nightly", status: "scheduled", priority: "medium", recurrence: { cron: "0 9 * * *", enabled: true } },
        ],
      })
      expect(ok[0]?.recurrence?.cron).toBe("0 9 * * *")

      // Malformed cron → typed TaskWriteError (surfaces as HTTP 400 on PATCH).
      const malformed = yield* tasks
        .update({
          sessionID,
          tasks: [
            { content: "bad", status: "scheduled", priority: "medium", recurrence: { cron: "not a cron", enabled: true } },
          ],
        })
        .pipe(Effect.flip)
      expect(malformed.reason).toBe("invalid_schedule")

      // A cron that parses but never matches in the search window is a dead job.
      const dead = yield* tasks
        .update({
          sessionID,
          tasks: [
            { content: "dead", status: "scheduled", priority: "medium", recurrence: { cron: "0 0 30 2 *", enabled: true } },
          ],
        })
        .pipe(Effect.flip)
      expect(dead.reason).toBe("invalid_schedule")

      // append rejects too (the tool call path shares the guard).
      const appended = yield* tasks
        .append({
          sessionID,
          tasks: [
            { content: "bad", status: "scheduled", priority: "medium", recurrence: { cron: "not a cron", enabled: true } },
          ],
        })
        .pipe(Effect.flip)
      expect(appended.reason).toBe("invalid_schedule")
    }),
  )

  it.effect("update/append/patch reject a scheduled task with no trigger (HIGH-4 schedule invariant)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const future = new Date(2030, 0, 1).getTime()

      // `scheduled` without recurrence or scheduledAt is a dead job.
      const noTrigger = yield* tasks
        .update({ sessionID, tasks: [{ content: "stuck", status: "scheduled", priority: "medium" }] })
        .pipe(Effect.flip)
      expect(noTrigger.reason).toBe("invalid_schedule")

      // A disabled recurrence without a one-shot fallback is also trigger-less.
      const disabledOnly = yield* tasks
        .update({
          sessionID,
          tasks: [
            { content: "off", status: "scheduled", priority: "medium", recurrence: { cron: "0 9 * * *", enabled: false } },
          ],
        })
        .pipe(Effect.flip)
      expect(disabledOnly.reason).toBe("invalid_schedule")

      // A one-shot scheduledAt alone is a valid trigger.
      const oneShot = yield* tasks.update({
        sessionID,
        tasks: [{ content: "once", status: "scheduled", priority: "medium", scheduledAt: future }],
      })
      expect(oneShot[0]?.status).toBe("scheduled")

      // Disabled recurrence with a scheduledAt fallback is valid (tool rule).
      const fallback = yield* tasks.update({
        sessionID,
        tasks: [
          {
            content: "fallback",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", enabled: false },
            scheduledAt: future,
          },
        ],
      })
      expect(fallback[0]?.status).toBe("scheduled")

      // append rejects a trigger-less scheduled task too.
      const appended = yield* tasks
        .append({ sessionID, tasks: [{ content: "stuck", status: "scheduled", priority: "medium" }] })
        .pipe(Effect.flip)
      expect(appended.reason).toBe("invalid_schedule")

      // patch (the resume path): flipping a schedule-less task to `scheduled`
      // is rejected, while a task that already carries a schedule resumes fine.
      const plain = yield* tasks.append({ sessionID, tasks: [{ content: "plain", status: "pending", priority: "medium" }] })
      const plainID = plain.find((task) => task.content === "plain")?.id
      if (!plainID) throw new Error("append returned no plain task")
      const resumeDenied = yield* tasks.patch({ sessionID, id: plainID, status: "scheduled" }).pipe(Effect.flip)
      expect(resumeDenied.reason).toBe("invalid_schedule")

      const scheduled = yield* tasks.append({
        sessionID,
        tasks: [{ content: "real", status: "scheduled", priority: "medium", scheduledAt: future }],
      })
      const scheduledID = scheduled.find((task) => task.content === "real")?.id
      if (!scheduledID) throw new Error("append returned no scheduled task")
      yield* tasks.patch({ sessionID, id: scheduledID, status: "cancelled" })
      const resumed = yield* tasks.patch({ sessionID, id: scheduledID, status: "scheduled" })
      expect(resumed?.status).toBe("scheduled")
    }),
  )

  it.effect("persists M5 spawn fields and keeps them through an omitting reconcile", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [spawned] = yield* tasks.append({
        sessionID,
        tasks: [
          {
            content: "spawn audit",
            status: "pending",
            priority: "medium",
            spawnedFrom: "msg_spawn_1",
            dependsOn: ["tsk_pred_a", "tsk_pred_b"],
          },
        ],
      })
      expect(spawned.spawnedFrom).toBe("msg_spawn_1")
      expect(spawned.dependsOn).toEqual(["tsk_pred_a", "tsk_pred_b"])

      // Re-read from the table: the columns survived.
      const got = yield* tasks.get(sessionID)
      expect(got[0]?.spawnedFrom).toBe("msg_spawn_1")
      expect(got[0]?.dependsOn).toEqual(["tsk_pred_a", "tsk_pred_b"])

      // A reconcile omitting them preserves the stored values and reports them.
      const resolved = yield* tasks.update({
        sessionID,
        tasks: [{ id: spawned.id, content: "spawn audit", status: "completed", priority: "medium" }],
      })
      expect(resolved[0]?.spawnedFrom).toBe("msg_spawn_1")
      expect(resolved[0]?.dependsOn).toEqual(["tsk_pred_a", "tsk_pred_b"])
    }),
  )

  it.effect("update rejects a dependsOn cycle with TaskWriteError (depends_on_cycle)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [a, b] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
        ],
      })

      const error = yield* tasks
        .update({
          sessionID,
          tasks: [
            { id: a.id, content: "a", status: "pending", priority: "medium", dependsOn: [b.id] },
            { id: b.id, content: "b", status: "pending", priority: "medium", dependsOn: [a.id] },
          ],
        })
        .pipe(Effect.flip)
      expect(error.reason).toBe("depends_on_cycle")

      // The rejected write left the rows untouched (still no cross-deps).
      const got = yield* tasks.get(sessionID)
      expect(got.every((task) => task.dependsOn === undefined)).toBe(true)
    }),
  )

  it.effect("update rejects an omitted-preserve dependsOn cycle (guard uses effective deps)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [b] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "b", status: "pending", priority: "medium" }],
      })
      const a = (yield* tasks.append({
        sessionID,
        tasks: [{ content: "a", status: "pending", priority: "medium", dependsOn: [b.id] }],
      })).find((t) => t.content === "a")
      expect(a).toBeDefined()
      if (!a) throw new Error("a not created")

      // The PATCH omits A's dependsOn (preserve-omitted keeps [b]) while adding
      // B → [a]. The guard must evaluate A's *preserved* edge, not the omitted
      // input, or the closed cycle would slip into the DB.
      const error = yield* tasks
        .update({
          sessionID,
          tasks: [
            { id: a.id, content: "a", status: "pending", priority: "medium" },
            { id: b.id, content: "b", status: "pending", priority: "medium", dependsOn: [a.id] },
          ],
        })
        .pipe(Effect.flip)
      expect(error.reason).toBe("depends_on_cycle")

      // Nothing was persisted by the rejected write.
      const got = yield* tasks.get(sessionID)
      const aRow = got.find((t) => t.id === a.id)
      expect(aRow?.dependsOn).toEqual([b.id])
      const bRow = got.find((t) => t.id === b.id)
      expect(bRow?.dependsOn).toBeUndefined()
    }),
  )

  it.effect("append defensively rejects a pre-existing dependsOn cycle", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [a, b] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
        ],
      })
      // Inject a cycle directly (bypassing the service guard) to prove append's
      // defensive findCycle still catches it. `depends_on` is a json column, so
      // pass the array (drizzle encodes it).
      yield* db.update(TaskTable).set({ depends_on: [b.id] }).where(eq(TaskTable.id, a.id)).run()
      yield* db.update(TaskTable).set({ depends_on: [a.id] }).where(eq(TaskTable.id, b.id)).run()

      const error = yield* tasks
        .append({ sessionID, tasks: [{ content: "c", status: "pending", priority: "medium" }] })
        .pipe(Effect.flip)
      expect(error.reason).toBe("depends_on_cycle")
    }),
  )

  it.effect("rejects a cross-session dependsOn cycle (MEDIUM-1: write check uses the global graph)", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const otherSession = SessionV2.ID.make("ses_task_other")
      // The task table has a session FK; the second session must exist too.
      yield* db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-other",
          directory: "/project",
          title: "task other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const [a1] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "a1", status: "pending", priority: "medium" }],
      })
      const [b1] = yield* tasks.append({
        sessionID: otherSession,
        tasks: [{ content: "b1", status: "pending", priority: "medium" }],
      })

      // A single cross-session edge is fine — the runtime trigger resolves
      // predecessors globally, so cross-session deps are allowed by design.
      yield* tasks.update({
        sessionID,
        tasks: [{ id: a1.id, content: "a1", status: "pending", priority: "medium", dependsOn: [b1.id] }],
      })

      // Closing the loop from the other session must be rejected: the write-time
      // check now sees the globally-referenced predecessor (transitively fetched).
      const error = yield* tasks
        .update({
          sessionID: otherSession,
          tasks: [{ id: b1.id, content: "b1", status: "pending", priority: "medium", dependsOn: [a1.id] }],
        })
        .pipe(Effect.flip)
      expect(error.reason).toBe("depends_on_cycle")

      // The rejected write left session 2's edge unpersisted.
      const got = yield* tasks.get(otherSession)
      expect(got[0]?.dependsOn).toBeUndefined()
    }),
  )

  it.effect("concurrent cross-session updates reject a would-be cycle (re-review HIGH-2)", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const otherSession = SessionV2.ID.make("ses_task_concurrent_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-concurrent-other",
          directory: "/project",
          title: "task concurrent other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const [a1] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "a1", status: "pending", priority: "medium" }],
      })
      const [b1] = yield* tasks.append({
        sessionID: otherSession,
        tasks: [{ content: "b1", status: "pending", priority: "medium" }],
      })

      const results = yield* Effect.all(
        [
          tasks
            .update({
              sessionID,
              tasks: [{ id: a1.id, content: "a1", status: "pending", priority: "medium", dependsOn: [b1.id] }],
            })
            .pipe(Effect.result),
          tasks
            .update({
              sessionID: otherSession,
              tasks: [{ id: b1.id, content: "b1", status: "pending", priority: "medium", dependsOn: [a1.id] }],
            })
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )

      const failures = results.filter(Result.isFailure)
      expect(failures.length).toBeGreaterThanOrEqual(1)
      for (const failure of failures) {
        if (Result.isFailure(failure)) expect(failure.failure.reason).toBe("depends_on_cycle")
      }

      const aGot = yield* tasks.get(sessionID)
      const bGot = yield* tasks.get(otherSession)
      const aHasB = aGot[0]?.dependsOn?.includes(b1.id) ?? false
      const bHasA = bGot[0]?.dependsOn?.includes(a1.id) ?? false
      expect(aHasB && bHasA).toBe(false)
    }),
  )

  it.effect("concurrent cross-session appends cannot both close a cycle (M-2)", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const otherSession = SessionV2.ID.make("ses_task_other2")
      yield* db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-append-other",
          directory: "/project",
          title: "task append other",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      // Each append references the OTHER session's planned id. On a single
      // SQLite connection + the service write lock, the two transactions
      // serialize, so whichever runs second sees the first's committed edge and
      // the closing edge forms a cycle → exactly one may land, never both.
      const results = yield* Effect.all(
        [
          tasks
            .append({
              sessionID,
              tasks: [
                { id: "tsk_app_a", content: "a2", status: "pending", priority: "medium", dependsOn: ["tsk_app_b"] },
              ],
            })
            .pipe(Effect.result),
          tasks
            .append({
              sessionID: otherSession,
              tasks: [
                { id: "tsk_app_b", content: "b2", status: "pending", priority: "medium", dependsOn: ["tsk_app_a"] },
              ],
            })
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      )

      const failures = results.filter(Result.isFailure)
      expect(failures.length).toBeGreaterThanOrEqual(1)
      for (const failure of failures) {
        if (Result.isFailure(failure)) expect(failure.failure.reason).toBe("depends_on_cycle")
      }
      // Only one edge may exist server-side (never both).
      const aGot = yield* tasks.get(sessionID)
      const bGot = yield* tasks.get(otherSession)
      const aHasB = aGot[0]?.dependsOn?.includes("tsk_app_b") ?? false
      const bHasA = bGot[0]?.dependsOn?.includes("tsk_app_a") ?? false
      expect(aHasB && bHasA).toBe(false)
    }),
  )

  it.effect("removeTask + append keep positions unique after a middle delete (MEDIUM-2)", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const created = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
          { content: "c", status: "pending", priority: "medium" },
        ],
      })
      const b = created.find((task) => task.content === "b")
      if (!b) throw new Error("b not created")

      // Delete the middle task — the (session_id, position) PK would reject a
      // later insert that reuses its position.
      yield* tasks.removeTask({ sessionID, id: b.id })

      // Append again: position must continue from max+1, not existing.length.
      const appended = yield* tasks.append({
        sessionID,
        tasks: [{ content: "d", status: "pending", priority: "medium" }],
      })
      expect(appended.find((task) => task.content === "d")).toBeDefined()

      const rows = yield* db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, sessionID))
        .orderBy(asc(TaskTable.position))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.content)).toEqual(["a", "c", "d"])
      const positions = rows.map((row) => row.position)
      expect(new Set(positions).size).toBe(positions.length)
    }),
  )

  it.effect("replaceLegacy rejects a dead scheduled task via the legacy TodoWrite bridge (M-1)", () =>
    Effect.gen(function* () {
      yield* setup
      const todo = yield* SessionTodo.Service
      const error = yield* todo
        .update({ sessionID, todos: [{ content: "legacy sched", status: "scheduled", priority: "medium" }] })
        .pipe(Effect.flip)
      expect(error.reason).toBe("invalid_schedule")
    }),
  )
})
