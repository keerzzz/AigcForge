import { describe, expect, test } from "bun:test"
import { and, asc, eq, sql } from "drizzle-orm"
import type { SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Result, Schema } from "effect"
import { TestClock } from "effect/testing"
import type { SqlError } from "effect/sql/SqlError"
import { Database } from "@aigcfroge/core/database/database"
import { Bus } from "@aigcfroge/core/bus"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import {
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
  TaskOperationTable,
  TaskTable,
} from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ScheduleTask } from "@aigcfroge/core/session/schedule-task"
import { ScheduleTable } from "@aigcfroge/core/session/schedule.sql"
import { KVTable } from "@aigcfroge/core/kv/sql"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { Event } from "@aigcfroge/schema/event"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { Agent } from "@aigcfroge/schema/agent"
import { Location } from "@aigcfroge/schema/location"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { testEffect, awaitWithTimeout } from "./lib/effect"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"

/** The drizzle-effect transaction handle, derived from the database client's own signature. */
type SQLiteTx = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/aigcfroge" })),
)
const databaseLayer = Database.layer().pipe(Layer.provide(globalLayer))
const busNodeLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
  Bus.node.replace(Bus.configured()),
])

const taskLayer = SessionTodo.defaultLayer.pipe(
  Layer.provideMerge(SessionTask.defaultLayer),
  Layer.provideMerge(busNodeLayer),
  Layer.provideMerge(databaseLayer),
  Layer.provideMerge(globalLayer),
)
const it = testEffect(taskLayer)
const scheduleIt = testEffect(ScheduleService.layer.pipe(Layer.provideMerge(taskLayer)))
const sessionID = Session.ID.make("ses_task_test")

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

const listenUpdates = Effect.gen(function* () {
  const events = yield* Bus.Service
  const published = new Array<Event.Payload>()
  const unsubscribe = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === SessionTask.Event.Updated.type || event.type === SessionTask.Event.TodoUpdated.type)
        published.push(event)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return published
})

describe("SessionTask", () => {
  describe("execution claims", () => {
    const source = { type: "tool" as const, messageID: "msg_task_owner", id: "call-task-owner" }
    const management = { type: "tool" as const, messageID: "msg_task_manager", id: "call-task-manager" }

    it.effect("MP05 anchors an append claim before its commit hook and rolls all writes back on failure", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const published = yield* listenUpdates
        const failed = yield* tasks
          .append(
            {
              sessionID,
              tasks: [
                {
                  id: "tsk_claim_rollback",
                  content: "start worker",
                  status: "in_progress",
                  priority: "medium",
                  scheduledAt: 60_000,
                },
              ],
            },
            {
              claim: source,
              commit: (task) =>
                Effect.gen(function* () {
                  const claim = yield* database.db
                    .select()
                    .from(KVTable)
                    .where(eq(KVTable.key, `task:claim:${sessionID}:${task.id}`))
                    .get()
                    .pipe(Effect.orDie)
                  expect(claim?.value).toEqual({
                    parentTaskID: task.id,
                    parentTaskRevision: task.revision,
                    source,
                  })
                  expect(
                    yield* database.db
                      .select()
                      .from(ScheduleTable)
                      .where(eq(ScheduleTable.task_id, task.id))
                      .get()
                      .pipe(Effect.orDie),
                  ).toMatchObject({
                    task_id: task.id,
                    status: "paused",
                  })
                  return yield* Effect.die(new Error("Task admission failed"))
                }),
            },
          )
          .pipe(Effect.exit)
        expect(Exit.isFailure(failed)).toBe(true)
        expect(yield* tasks.get(sessionID)).toEqual([])
        expect(yield* database.db.select().from(KVTable).all().pipe(Effect.orDie)).toEqual([])
        expect(yield* database.db.select().from(ScheduleTable).all().pipe(Effect.orDie)).toEqual([])
        expect(published).toEqual([])

        const [task] = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "start worker", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )
        expect((yield* database.db.select().from(KVTable).all().pipe(Effect.orDie))[0]?.value).toEqual({
          parentTaskID: task.id,
          parentTaskRevision: task.revision,
          source,
        })
        expect(published.map((event) => event.type)).toEqual([
          SessionTask.Event.Updated.type,
          SessionTask.Event.TodoUpdated.type,
        ])
      }),
    )

    it.effect("MP05 a restored nullable operation key keeps the original Tool claim owned", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [task] = yield* tasks.append(
          { sessionID, tasks: [{ content: "restored Tool worker", status: "in_progress", priority: "medium" }] },
          { claim: source },
        )
        yield* database.db
          .update(KVTable)
          .set({
            value: {
              parentTaskID: task.id,
              parentTaskRevision: task.revision,
              source,
              operationID: null,
            },
          })
          .where(eq(KVTable.key, `task:claim:${sessionID}:${task.id}`))
          .run()
          .pipe(Effect.orDie)
        const rejected = yield* tasks
          .updateTask({ sessionID, id: task.id, content: "management overwrite" }, { management })
          .pipe(Effect.result)
        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) expect(rejected.failure.reason).toBe("execution_owned")
        expect((yield* tasks.get(sessionID))[0]).toEqual(task)
        yield* tasks.releaseClaim({ sessionID, id: task.id, revision: task.revision, source })
        expect(
          yield* database.db
            .select()
            .from(KVTable)
            .where(eq(KVTable.key, `task:claim:${sessionID}:${task.id}`))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
      }),
    )

    it.effect("one competing source claims a Task and an exact owner retry keeps its revision and events", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "one worker", status: "pending", priority: "medium" }],
        })
        const contenders = [source, management]
        const claims = yield* Effect.forEach(
          contenders,
          (claim) =>
            tasks
              .patch(
                {
                  sessionID,
                  id: seed.id,
                  status: "in_progress",
                  expectedRevision: seed.revision,
                },
                { claim },
              )
              .pipe(Effect.result),
          { concurrency: "unbounded" },
        )
        expect(claims.filter(Result.isSuccess)).toHaveLength(1)
        const failures = claims.filter(Result.isFailure)
        expect(failures).toHaveLength(1)
        expect(failures[0]?.failure.reason).toBe("execution_owned")
        const winner = contenders[claims.findIndex(Result.isSuccess)]
        const [claimed] = yield* tasks.get(sessionID)
        const published = yield* listenUpdates
        const replayed = yield* tasks.patch(
          {
            sessionID,
            id: seed.id,
            status: "in_progress",
            expectedRevision: seed.revision,
          },
          { claim: winner },
        )
        expect(replayed).toEqual(claimed)
        expect(replayed?.revision).toBe(seed.revision + 1)
        expect(published).toEqual([])
      }),
    )

    it.effect("hands off a current execution claim without letting the previous source settle its successor", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [owned] = yield* tasks.append(
          { sessionID, tasks: [{ content: "running A", status: "in_progress", priority: "medium" }] },
          { claim: source },
        )
        yield* Effect.forEach(
          [
            { source: management, revision: owned.revision },
            { source, revision: owned.revision + 1 },
          ],
          (handoff) =>
            Effect.gen(function* () {
              const result = yield* tasks
                .patch(
                  { sessionID, id: owned.id, status: "in_progress", expectedRevision: owned.revision },
                  { claim: management, handoff },
                )
                .pipe(Effect.result)
              expect(Result.isFailure(result) && result.failure.reason).toBe("execution_owned")
            }),
        )
        expect(yield* tasks.get(sessionID)).toEqual([owned])
        const handed = yield* tasks.patch(
          { sessionID, id: owned.id, status: "in_progress", expectedRevision: owned.revision },
          { claim: management, handoff: { source, revision: owned.revision } },
        )
        if (!handed) return yield* Effect.die(new Error("Execution claim handoff is missing"))
        expect(handed.revision).toBe(owned.revision + 1)
        expect(
          yield* tasks.patch(
            { sessionID, id: owned.id, status: "in_progress", expectedRevision: owned.revision },
            { claim: management },
          ),
        ).toEqual(handed)
        expect(
          yield* tasks.patch(
            { sessionID, id: owned.id, status: "cancelled", expectedRevision: owned.revision },
            { settle: { source, revision: owned.revision } },
          ),
        ).toBeUndefined()
        yield* tasks.releaseClaim({ sessionID, id: owned.id, source, revision: owned.revision })
        const protectedEdit = yield* tasks
          .updateTask({ sessionID, id: owned.id, content: "old A must not release B" }, { management })
          .pipe(Effect.result)
        expect(Result.isFailure(protectedEdit) && protectedEdit.failure.reason).toBe("execution_owned")
        expect(yield* tasks.get(sessionID)).toEqual([handed])
        expect(
          yield* tasks.patch(
            { sessionID, id: owned.id, status: "completed", expectedRevision: handed.revision },
            { settle: { source: management, revision: handed.revision } },
          ),
        ).toMatchObject({ status: "completed", revision: handed.revision + 1 })
      }),
    )

    it.effect("automatic update delete full write reorder and legacy write cannot change owned execution", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const todos = yield* SessionTodo.Service
        const database = yield* Database.Service
        const [owned] = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "worker", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )
        yield* tasks.append({
          sessionID,
          tasks: [
            { content: "other plan", status: "pending", priority: "medium" },
            { content: "unbound active plan", status: "in_progress", priority: "medium" },
          ],
        })
        const before = yield* tasks.get(sessionID)
        const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
        const claims = yield* database.db.select().from(KVTable).all().pipe(Effect.orDie)
        const published = yield* listenUpdates
        const attempts = yield* Effect.forEach(
          [
            tasks
              .updateTask({ sessionID, id: owned.id, content: "overwrite worker" }, { management })
              .pipe(Effect.asVoid),
            tasks.removeTask({ sessionID, id: owned.id }, { management }).pipe(Effect.asVoid),
            tasks
              .update({ sessionID, tasks: before.filter((task) => task.id !== owned.id) }, { management })
              .pipe(Effect.asVoid),
            tasks
              .reorder({ sessionID, ids: before.map((task) => task.id).reverse() }, { management })
              .pipe(Effect.asVoid),
            todos.update({ sessionID, todos: [] }, { management }).pipe(Effect.asVoid),
          ],
          (attempt) => attempt.pipe(Effect.result),
        )
        expect(attempts.every(Result.isFailure)).toBe(true)
        expect(attempts.filter(Result.isFailure).map((result) => result.failure.reason)).toEqual(
          Array(5).fill("execution_owned"),
        )
        expect(yield* tasks.get(sessionID)).toEqual(before)
        expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
        expect(yield* database.db.select().from(KVTable).all().pipe(Effect.orDie)).toEqual(claims)
        expect(published).toEqual([])

        const free = before[2]
        const updated = yield* tasks.updateTask(
          {
            sessionID,
            id: free.id,
            status: "completed",
            content: "ordinary plan completed",
          },
          { management },
        )
        expect(updated).toMatchObject({ id: free.id, status: "completed", revision: free.revision + 1 })
        expect((yield* tasks.get(sessionID))[0]).toEqual(owned)
      }),
    )

    it.effect("only the captured source and revision release a claim", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [owned] = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "worker", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )
        yield* tasks.releaseClaim({ sessionID, id: owned.id, source: management, revision: owned.revision })
        yield* tasks.releaseClaim({ sessionID, id: owned.id, source, revision: owned.revision + 1 })
        const blocked = yield* tasks
          .updateTask({ sessionID, id: owned.id, content: "blocked" }, { management })
          .pipe(Effect.result)
        expect(Result.isFailure(blocked) && blocked.failure.reason).toBe("execution_owned")
        expect(yield* tasks.get(sessionID)).toEqual([owned])
        yield* tasks.releaseClaim({ sessionID, id: owned.id, source, revision: owned.revision })
        expect(yield* database.db.select().from(KVTable).all().pipe(Effect.orDie)).toEqual([])
        const editable = yield* tasks.updateTask({ sessionID, id: owned.id, content: "released plan" }, { management })
        expect(editable?.content).toBe("released plan")
      }),
    )

    it.effect("HTTP style editing keeps its revision while the old owner settles and releases its claim", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [owned] = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "worker", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )
        const edited = yield* tasks.updateTask({
          sessionID,
          id: owned.id,
          content: "user revised plan",
          status: "pending",
        })
        if (!edited) return yield* Effect.die(new Error("Expected the explicit Task edit to land"))
        expect(edited?.revision).toBe(owned.revision + 1)
        const protectedEdit = yield* tasks.removeTask({ sessionID, id: owned.id }, { management }).pipe(Effect.result)
        expect(Result.isFailure(protectedEdit) && protectedEdit.failure.reason).toBe("execution_owned")
        const published = yield* listenUpdates
        const settled = yield* tasks.patch(
          {
            sessionID,
            id: owned.id,
            expectedRevision: owned.revision,
            expect: ["in_progress"],
            status: "completed",
          },
          { settle: { source, revision: owned.revision } },
        )
        expect(settled).toBeUndefined()
        expect(yield* tasks.get(sessionID)).toEqual([edited])
        expect(yield* database.db.select().from(KVTable).all().pipe(Effect.orDie)).toEqual([])
        expect(published).toEqual([])
        const removed = yield* tasks.removeTask({ sessionID, id: owned.id }, { management })
        expect(removed).toEqual(edited)
      }),
    )

    it.effect("an explicit owner retry replaces its old claim without releasing the new revision", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [owned] = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "recover worker", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )
        const unknown = yield* tasks.patch({
          sessionID,
          id: owned.id,
          status: "failed",
          expectedRevision: owned.revision,
        })
        const retried = yield* tasks.patch(
          {
            sessionID,
            id: owned.id,
            status: "in_progress",
            expectedRevision: unknown?.revision,
          },
          { claim: source, settle: { source, revision: owned.revision } },
        )
        expect(retried?.revision).toBe(owned.revision + 2)
        expect((yield* database.db.select().from(KVTable).all().pipe(Effect.orDie))[0]?.value).toMatchObject({
          parentTaskRevision: retried?.revision,
          source,
        })
        yield* tasks.releaseClaim({ sessionID, id: owned.id, source, revision: owned.revision })
        const blocked = yield* tasks.removeTask({ sessionID, id: owned.id }, { management }).pipe(Effect.result)
        expect(Result.isFailure(blocked) && blocked.failure.reason).toBe("execution_owned")
      }),
    )

    it.effect("an aggregate remains protected by its genuine worker claim", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [aggregate] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "Judge aggregate", status: "in_progress", priority: "medium" }],
        })
        const rows = yield* tasks.append(
          {
            sessionID,
            tasks: [{ content: "Judge worker", status: "in_progress", priority: "medium", parentID: aggregate.id }],
          },
          { claim: source },
        )
        const worker = rows[1]
        const blocked = yield* tasks.removeTask({ sessionID, id: aggregate.id }, { management }).pipe(Effect.result)
        expect(Result.isFailure(blocked) && blocked.failure.reason).toBe("execution_owned")
        yield* tasks.patch(
          {
            sessionID,
            id: worker.id,
            status: "completed",
            expectedRevision: worker.revision,
          },
          { settle: { source, revision: worker.revision } },
        )
        const released = yield* tasks.updateTask({ sessionID, id: aggregate.id, status: "completed" }, { management })
        expect(released?.status).toBe("completed")
      }),
    )

    for (const placement of ["pending", "promoted"] as const) {
      it.effect(`protects a legacy ${placement} TaskLink until its child input settles`, () =>
        Effect.gen(function* () {
          yield* setup
          const tasks = yield* SessionTask.Service
          const database = yield* Database.Service
          const [task] = yield* tasks.append({
            sessionID,
            tasks: [{ content: "historical worker", status: "in_progress", priority: "medium" }],
          })
          const childID = Session.ID.make("ses_legacy_task_worker")
          const inputID = SessionMessage.ID.make("msg_legacy_task_input")
          yield* database.db
            .insert(SessionTable)
            .values({
              id: childID,
              project_id: Project.ID.global,
              parent_id: sessionID,
              slug: "legacy-worker",
              directory: "/project",
              version: "test",
            })
            .run()
            .pipe(Effect.orDie)
          const payload = {
            text: "historical worker input",
            metadata: {
              task: {
                parentTaskID: task.id,
                parentTaskRevision: task.revision,
                description: task.content,
                background: false,
              },
            },
          }
          if (placement === "pending")
            yield* database.db
              .insert(SessionInboxTable)
              .values({
                id: inputID,
                session_id: childID,
                type: "synthetic",
                payload,
                delivery: "steer",
                enqueued_seq: 1,
              })
              .run()
              .pipe(Effect.orDie)
          if (placement === "promoted")
            yield* database.db
              .insert(SessionMessageTable)
              .values({
                id: inputID,
                session_id: childID,
                type: "synthetic",
                seq: 1,
                data: { ...payload, time: { created: 1 } },
              })
              .run()
              .pipe(Effect.orDie)
          const blocked = yield* tasks
            .updateTask({ sessionID, id: task.id, status: "completed" }, { management })
            .pipe(Effect.result)
          expect(Result.isFailure(blocked) && blocked.failure.reason).toBe("execution_owned")
          expect(yield* tasks.get(sessionID)).toEqual([task])
          if (placement === "pending")
            yield* database.db
              .delete(SessionInboxTable)
              .where(eq(SessionInboxTable.id, inputID))
              .run()
              .pipe(Effect.orDie)
          if (placement === "promoted")
            yield* database.db
              .insert(SessionMessageTable)
              .values({
                id: SessionMessage.ID.make("msg_legacy_task_cancelled"),
                session_id: childID,
                type: "idle",
                seq: 2,
                data: { outcome: "interrupted", time: { created: 2 } },
              })
              .run()
              .pipe(Effect.orDie)
          const released = yield* tasks.updateTask({ sessionID, id: task.id, status: "cancelled" }, { management })
          expect(released?.status).toBe("cancelled")
        }),
      )
    }
  })

  it.effect("can cancel an existing invalid-timezone Task and correct its stored recurrence", () =>
    Effect.gen(function* () {
      yield* setup
      yield* TestClock.setTime(Date.parse("2026-08-01T23:59:00.000Z"))
      const database = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const seeded = yield* tasks.append({
        sessionID,
        tasks: [{ content: "historical task", status: "pending", priority: "medium" }],
      })
      const task = seeded[0]
      if (!task) throw new Error("Expected a historical Task fixture")
      yield* database.db
        .update(TaskTable)
        .set({
          status: "scheduled",
          recurrence: { cron: "0 9 * * *", timezone: "Not/A_TimeZone", enabled: true },
        })
        .where(eq(TaskTable.id, task.id))
        .run()
        .pipe(Effect.orDie)

      const cancelled = yield* tasks.patch({
        sessionID,
        id: task.id,
        status: "cancelled",
        expectedRevision: task.revision,
      })
      expect(cancelled?.status).toBe("cancelled")
      if (!cancelled) throw new Error("Expected cancellation of the historical Task")
      const corrected = yield* tasks.update({
        sessionID,
        expectedRevision: cancelled.revision,
        tasks: [
          {
            id: task.id,
            content: "corrected task",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", timezone: "Asia/Tokyo", enabled: true },
          },
        ],
      })
      expect(corrected[0]?.recurrence?.timezone).toBe("Asia/Tokyo")
      expect(corrected[0]?.nextRun).toBe(Date.parse("2026-08-02T00:00:00.000Z"))
      expect((yield* tasks.get(sessionID))[0]?.recurrence?.timezone).toBe("Asia/Tokyo")
    }),
  )

  it.effect("persists fixed recurrence timezones and derives nextRun in each stored zone", () =>
    Effect.gen(function* () {
      yield* setup
      yield* TestClock.setTime(Date.parse("2026-08-01T23:59:00.000Z"))
      const database = yield* Database.Service
      const tasks = yield* SessionTask.Service
      yield* tasks.append({
        sessionID,
        tasks: [
          {
            content: "Tokyo morning",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", timezone: "Asia/Tokyo", enabled: true },
          },
          {
            content: "London morning",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", timezone: "Europe/London", enabled: true },
          },
        ],
      })

      const rows = yield* database.db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, sessionID))
        .orderBy(asc(TaskTable.position))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.recurrence?.timezone)).toEqual(["Asia/Tokyo", "Europe/London"])
      const restored = yield* tasks.get(sessionID)
      expect(restored.map((task) => task.nextRun)).toEqual([
        Date.parse("2026-08-02T00:00:00.000Z"),
        Date.parse("2026-08-02T08:00:00.000Z"),
      ])
    }),
  )

  it.effect("inserts in order, patches by id keeping position, deletes, and publishes task.updated", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* Bus.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<Event.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      // Insert 3 tasks without ids — the service assigns stable tsk_ ids.
      const resolved: readonly (typeof SessionTask.Info.Type)[] = yield* tasks.update({
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
          // oxlint-disable-next-line no-misused-spread -- Schema.Class data carries no prototype members
          { ...third, status: "completed" },
          // oxlint-disable-next-line no-misused-spread -- Schema.Class data carries no prototype members
          { ...first, status: "in_progress" },
          // oxlint-disable-next-line no-misused-spread -- Schema.Class data carries no prototype members
          { ...second, status: "pending" },
        ],
      })
      expect(after.map((task) => task.content)).toEqual(["third", "first", "second"])
      expect(after[0].status).toBe("completed")

      const rows = yield* db.select().from(TaskTable).orderBy(asc(TaskTable.position)).all().pipe(Effect.orDie)
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

  it.effect("patch with expect only lands on an expected status (conditional claim)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.update({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 }],
      })

      // Lost race: a pause (cancelled) landed before the claim, so the claim
      // must abort instead of flipping the row back to in_progress.
      yield* tasks.patch({ sessionID, id: task.id, status: "cancelled" })
      const lost = yield* tasks.patch({
        sessionID,
        id: task.id,
        status: "in_progress",
        expect: ["scheduled", "pending"],
      })
      expect(lost).toBeUndefined()
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("cancelled")

      // Won race: the row is still scheduled, so the claim lands.
      yield* tasks.patch({ sessionID, id: task.id, status: "scheduled" })
      const won = yield* tasks.patch({
        sessionID,
        id: task.id,
        status: "in_progress",
        expect: ["scheduled", "pending"],
      })
      expect(won?.status).toBe("in_progress")
    }),
  )

  it.effect("patch is scoped to the owning session", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const otherSession = Session.ID.make("ses_task_other")
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
      const events = yield* Bus.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<Event.Payload>()
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
      const events = yield* Bus.Service
      const tasks = yield* SessionTask.Service
      const published = new Array<Event.Payload>()
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
      const otherSession = Session.ID.make("ses_task_list_other")
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
          {
            content: "nightly",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", enabled: true },
          },
        ],
      })
      expect(ok[0]?.recurrence?.cron).toBe("0 9 * * *")

      // Malformed cron → typed TaskWriteError (surfaces as HTTP 400 on PATCH).
      const malformed = yield* tasks
        .update({
          sessionID,
          tasks: [
            {
              content: "bad",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "not a cron", enabled: true },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(malformed.reason).toBe("invalid_schedule")
      // Malformed / no-future-run crons are attributed to the cron.
      expect(malformed.message).toContain("invalid recurrence cron")

      // A cron that parses but never matches in the search window is a dead job.
      const dead = yield* tasks
        .update({
          sessionID,
          tasks: [
            {
              content: "dead",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "0 0 30 2 *", enabled: true },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(dead.reason).toBe("invalid_schedule")
      expect(dead.message).toContain("invalid recurrence cron")

      // append rejects too (the tool call path shares the guard).
      const appended = yield* tasks
        .append({
          sessionID,
          tasks: [
            {
              content: "bad",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "not a cron", enabled: true },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(appended.reason).toBe("invalid_schedule")

      const invalidZone = yield* tasks
        .append({
          sessionID,
          tasks: [
            {
              content: "unknown timezone",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "0 9 * * *", timezone: "Not/A_TimeZone", enabled: true },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(invalidZone.reason).toBe("invalid_schedule")
      expect(invalidZone.schedule).toBe("cron")
      expect((yield* tasks.get(sessionID)).map((task) => task.content)).toEqual(["nightly"])
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
      // A schedule-less `scheduled` task is attributed to the missing trigger.
      expect(noTrigger.message).toContain("must have a scheduledAt or an enabled recurrence")

      // A disabled recurrence without a one-shot fallback is also trigger-less.
      const disabledOnly = yield* tasks
        .update({
          sessionID,
          tasks: [
            {
              content: "off",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "0 9 * * *", enabled: false },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(disabledOnly.reason).toBe("invalid_schedule")
      // A disabled recurrence without a fallback is trigger-less, not a cron fault.
      expect(disabledOnly.message).toContain("must have a scheduledAt or an enabled recurrence")

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
      const plain = yield* tasks.append({
        sessionID,
        tasks: [{ content: "plain", status: "pending", priority: "medium" }],
      })
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
      yield* db
        .update(TaskTable)
        .set({ depends_on: [b.id] })
        .where(eq(TaskTable.id, a.id))
        .run()
      yield* db
        .update(TaskTable)
        .set({ depends_on: [a.id] })
        .where(eq(TaskTable.id, b.id))
        .run()

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
      const otherSession = Session.ID.make("ses_task_other")
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
      const otherSession = Session.ID.make("ses_task_concurrent_other")
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
      const otherSession = Session.ID.make("ses_task_other2")
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

  it.live("two independently-built services still serialize on the process-level write lock (BLOCKER-1)", () =>
    Effect.gen(function* () {
      yield* setup
      // The two services are distinct instances (HTTP/scheduler `node` vs a
      // per-Location `Layer.fresh` graph) sharing ONE Database (same SQLite
      // file). Layer.fresh bypasses the outer memo map so these are genuinely
      // two SessionTask builds; Layer.succeed injects the same Database
      // instance (two independent `:memory:` defaults would not share tables,
      // so the second instance would hit `no such table`).
      //
      // A single shared connection serializes transactions at the driver level
      // (SqlClient single-connection semaphore), so a plain concurrent append
      // pair cannot distinguish lock scope. Instead the test orchestrates the
      // interleaving deterministically: the wrapped transaction signals when A
      // holds the write lock and is blocked inside it, then the test asserts
      // that B never reaches its transaction entry while A is blocked — a
      // process-level lock keeps B out (green), a per-instance Semaphore lets
      // B in (red).
      const real = yield* Database.Service
      const aEntered = yield* Deferred.make<void>()
      const aRelease = yield* Deferred.make<void>()
      const bEntered = yield* Deferred.make<void>()
      let calls = 0
      const wrappedDb: typeof real.db = Object.create(real.db)
      wrappedDb.transaction = <A, E, R>(
        transaction: (tx: SQLiteTx) => Effect.Effect<A, E, R>,
        config?: SQLiteTransactionConfig,
      ): Effect.Effect<A, E | SqlError, R> =>
        Effect.gen(function* () {
          calls += 1
          if (calls > 1) {
            yield* Deferred.succeed(bEntered, void 0)
            return yield* real.db.transaction(transaction, config)
          }
          yield* Deferred.succeed(aEntered, void 0)
          yield* Deferred.await(aRelease)
          return yield* real.db.transaction(transaction, config)
        })
      const dbLayer = Layer.succeed(Database.Service, { db: wrappedDb })

      const tasksA = yield* Layer.build(
        Layer.provide(Layer.fresh(SessionTask.layer), Layer.mergeAll(busNodeLayer, dbLayer)),
      ).pipe(Effect.map((ctx) => Context.get(ctx, SessionTask.Service)))
      const tasksB = yield* Layer.build(
        Layer.provide(Layer.fresh(SessionTask.layer), Layer.mergeAll(busNodeLayer, dbLayer)),
      ).pipe(Effect.map((ctx) => Context.get(ctx, SessionTask.Service)))

      const otherSession = Session.ID.make("ses_task_blocker1_b")
      yield* real.db
        .insert(SessionTable)
        .values({
          id: otherSession,
          project_id: Project.ID.global,
          slug: "task-blocker1-b",
          directory: "/project",
          title: "task blocker1 b",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      // Start A first and wait until it holds the write lock inside its
      // transaction entry, then start B: the process-level lock must keep B
      // from ever reaching its transaction while A is blocked.
      const scope = yield* Effect.scope
      const fiberA = yield* Effect.forkIn(scope)(
        tasksA
          .append({
            sessionID,
            tasks: [
              { id: "tsk_blk1_a", content: "a", status: "pending", priority: "medium", dependsOn: ["tsk_blk1_b"] },
            ],
          })
          .pipe(Effect.result),
      )
      yield* Deferred.await(aEntered)
      const fiberB = yield* Effect.forkIn(scope)(
        tasksB
          .append({
            sessionID: otherSession,
            tasks: [
              { id: "tsk_blk1_b", content: "b", status: "pending", priority: "medium", dependsOn: ["tsk_blk1_a"] },
            ],
          })
          .pipe(Effect.result),
      )
      // B must stay blocked behind the process-level write lock while A is
      // inside it; reaching its transaction entry means the lock is
      // per-instance (the BLOCKER-1 regression).
      const bBlocked = yield* awaitWithTimeout(
        Deferred.await(bEntered),
        "B must not reach its transaction while A holds the write lock",
        "2 seconds",
      ).pipe(Effect.isFailure)
      expect(bBlocked).toBe(true)

      // Release A so it commits; then B runs under the lock and must observe
      // A's committed edge: exactly one append may land (HIGH-2 / BLOCKER-1).
      yield* Deferred.succeed(aRelease, void 0)
      const results = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)])

      const failures = results.filter(Result.isFailure)
      expect(failures.length).toBeGreaterThanOrEqual(1)
      for (const failure of failures) {
        if (Result.isFailure(failure)) expect(failure.failure.reason).toBe("depends_on_cycle")
      }
      // Only one edge may exist server-side (never both).
      const aGot = yield* tasksA.get(sessionID)
      const bGot = yield* tasksB.get(otherSession)
      const aHasB = aGot[0]?.dependsOn?.includes("tsk_blk1_b") ?? false
      const bHasA = bGot[0]?.dependsOn?.includes("tsk_blk1_a") ?? false
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

      // Delete the middle task — append must continue from max+1 (MEDIUM-2),
      // not existing.length, or the new row would duplicate a position and make
      // the orderBy(position) read order-unstable.
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
      const tasks = yield* SessionTask.Service
      // SessionTodo's strict WriteItem can no longer carry "scheduled", so the
      // guard is exercised through replaceLegacy directly.
      const error = yield* tasks
        .replaceLegacy({ sessionID, tasks: [{ content: "legacy sched", status: "scheduled", priority: "medium" }] })
        .pipe(Effect.flip)
      expect(error.reason).toBe("invalid_schedule")
    }),
  )

  // P3-a: revision tracking + expectedRevision optimistic concurrency. Revision is
  // server-managed (never client-supplied): new tasks start at 1, every write
  // increments, and patch accepts expectedRevision to reject stale writes the
  // same way expect rejects stale status transitions.
  describe("revision (P3-a)", () => {
    it.effect("starts at 1 for new tasks created via update", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        expect(task.revision).toBe(1)
        expect((yield* tasks.get(sessionID))[0]?.revision).toBe(1)
      }),
    )

    it.effect("starts at 1 for new tasks created via append", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        expect(task.revision).toBe(1)
      }),
    )

    it.effect("increments on update (same task re-updated -> revision 2)", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const [after] = yield* tasks.update({
          sessionID,
          // oxlint-disable-next-line no-misused-spread -- Schema.Class data carries no prototype members
          tasks: [{ ...task, status: "in_progress" }],
        })
        expect(after.revision).toBe(2)
      }),
    )

    it.effect("increments on patch", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "in_progress", priority: "medium" }],
        })
        const patched = yield* tasks.patch({ sessionID, id: task.id, status: "completed" })
        expect(patched?.revision).toBe(2)
        expect((yield* tasks.get(sessionID))[0]?.revision).toBe(2)
      }),
    )

    it.effect("increments on replaceLegacy", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        yield* tasks.append({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const after = yield* tasks.replaceLegacy({
          sessionID,
          tasks: [{ content: "seed", status: "in_progress", priority: "medium" }],
        })
        expect(after[0]?.revision).toBe(2)
      }),
    )

    it.effect("replaceLegacy with stale expectedRevision fails and does not write", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        yield* tasks.append({
          sessionID,
          tasks: [{ content: "other", status: "pending", priority: "medium" }],
        })
        // A concurrent write bumped the max revision to 2.
        yield* tasks.patch({ sessionID, id: seed.id, status: "in_progress" })
        const error = yield* tasks
          .replaceLegacy({
            sessionID,
            tasks: [{ content: "seed", status: "completed", priority: "medium" }],
            expectedRevision: 1,
          })
          .pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(error.reason).toBe("stale_revision")
        // The stale replace did not land — the other path's rows survive.
        const got = yield* tasks.get(sessionID)
        expect(got.map((task) => task.content)).toEqual(["seed", "other"])
        expect(got[0]?.status).toBe("in_progress")
      }),
    )

    it.effect("append rejects an explicit id that collides with the table or repeats in the payload", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        yield* tasks.append({
          sessionID,
          tasks: [{ id: "tsk_dupe_seed", content: "seed", status: "pending", priority: "medium" }],
        })

        // An id already present in the table.
        const colliding = yield* tasks
          .append({
            sessionID,
            tasks: [{ id: "tsk_dupe_seed", content: "copy", status: "pending", priority: "medium" }],
          })
          .pipe(Effect.flip)
        expect(colliding).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(colliding.reason).toBe("duplicate")

        // The same fresh id twice in one payload.
        const repeated = yield* tasks
          .append({
            sessionID,
            tasks: [
              { id: "tsk_dupe_new", content: "one", status: "pending", priority: "medium" },
              { id: "tsk_dupe_new", content: "two", status: "pending", priority: "medium" },
            ],
          })
          .pipe(Effect.flip)
        expect(repeated).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(repeated.reason).toBe("duplicate")

        // Both rejections happened before any write.
        const got = yield* tasks.get(sessionID)
        expect(got).toHaveLength(1)
        expect(got[0]?.content).toBe("seed")
      }),
    )

    it.effect("patch with matching expectedRevision succeeds and increments", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "in_progress", priority: "medium" }],
        })
        const patched = yield* tasks.patch({
          sessionID,
          id: task.id,
          status: "completed",
          expectedRevision: 1,
        })
        expect(patched?.revision).toBe(2)
        expect(patched?.status).toBe("completed")
      }),
    )

    it.effect("patch with stale expectedRevision resolves undefined and does not write", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "in_progress", priority: "medium" }],
        })
        // A concurrent patch bumped revision to 2.
        yield* tasks.patch({ sessionID, id: task.id, status: "completed" })
        // The caller's stale expectedRevision=1 must NOT land.
        const lost = yield* tasks.patch({
          sessionID,
          id: task.id,
          status: "pending",
          expectedRevision: 1,
        })
        expect(lost).toBeUndefined()
        const got = yield* tasks.get(sessionID)
        expect(got[0]?.status).toBe("completed")
        expect(got[0]?.revision).toBe(2)
      }),
    )

    it.effect("revision is carried in the task.updated event payload", () =>
      Effect.gen(function* () {
        yield* setup
        const events = yield* Bus.Service
        const tasks = yield* SessionTask.Service
        const published = new Array<Event.Payload>()
        const unsubscribe = yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === SessionTask.Event.Updated.type) published.push(event)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        // The event payload carries revision (1 for a new task).
        expect(published.at(-1)?.data).toEqual({ sessionID, tasks: [task] })
        expect(task.revision).toBe(1)

        yield* tasks.patch({ sessionID, id: task.id, status: "completed" })
        const after = yield* tasks.get(sessionID)
        // The patch event carries the incremented revision.
        expect(published.at(-1)?.data).toEqual({ sessionID, tasks: after })
        expect(after[0]?.revision).toBe(2)
      }),
    )
  })

  // P3-b: incremental single-task commands so the LLM never needs a full-list
  // replace to edit one task or to reorder. updateTask edits status and fields
  // in one write; patch retains execution claim guards. Both updateTask and
  // reorder carry expectedRevision to reject stale writes.
  describe("incremental commands (P3-b)", () => {
    it.effect("updateTask writes status and fields with one revision and one pair of events", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [task, other] = yield* tasks.update({
          sessionID,
          tasks: [
            { content: "seed", status: "in_progress", priority: "medium" },
            { content: "other", status: "pending", priority: "low" },
          ],
        })
        const before = yield* database.db
          .select()
          .from(TaskTable)
          .orderBy(asc(TaskTable.position))
          .all()
          .pipe(Effect.orDie)
        const published = yield* listenUpdates

        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          status: "completed",
          content: "reviewed",
          priority: "high",
          outputDigest: "audit passed",
          expectedRevision: task.revision,
        })
        if (!updated) throw new Error("combined update returned no task")
        expect(updated).toMatchObject({
          id: task.id,
          status: "completed",
          content: "reviewed",
          priority: "high",
          outputDigest: "audit passed",
          revision: task.revision + 1,
          createdAt: task.createdAt,
        })
        expect(yield* tasks.get(sessionID)).toEqual([updated, other])
        const rows = yield* database.db
          .select()
          .from(TaskTable)
          .orderBy(asc(TaskTable.position))
          .all()
          .pipe(Effect.orDie)
        expect(rows[0]).toMatchObject({
          id: task.id,
          status: "completed",
          content: "reviewed",
          priority: "high",
          output_digest: "audit passed",
          revision: task.revision + 1,
          position: before[0]?.position,
          time_created: before[0]?.time_created,
        })
        expect(rows[1]).toEqual(before[1])
        expect(published.map((event) => event.type)).toEqual([
          SessionTask.Event.Updated.type,
          SessionTask.Event.TodoUpdated.type,
        ])
        expect(Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(published[0]?.data)).toEqual({
          sessionID,
          tasks: [updated, other],
        })
        expect(Schema.decodeUnknownSync(SessionTask.Event.TodoUpdated.data)(published[1]?.data)).toEqual({
          sessionID,
          todos: [
            { content: "reviewed", status: "completed", priority: "high" },
            { content: "other", status: "pending", priority: "low" },
          ],
        })
      }),
    )

    it.effect("updateTask rejects an invalid scheduled combination before any field or event changes", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "in_progress", priority: "medium" }],
        })
        yield* tasks.patch({ sessionID, id: seed.id, status: "in_progress", outputDigest: "saved audit" })
        const before = yield* tasks.get(sessionID)
        const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
        const published = yield* listenUpdates

        const error = yield* tasks
          .updateTask({
            sessionID,
            id: seed.id,
            status: "scheduled",
            content: "must not land",
            priority: "high",
            outputDigest: "must not replace saved audit",
            expectedRevision: before[0]?.revision,
          })
          .pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(error.reason).toBe("invalid_schedule")
        expect(error.schedule).toBe("trigger")
        expect(yield* tasks.get(sessionID)).toEqual(before)
        expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
        expect(published).toEqual([])
      }),
    )

    it.effect("updateTask rejects a stale status and fields combination without writes or events", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        yield* tasks.patch({ sessionID, id: seed.id, status: "in_progress", outputDigest: "current audit" })
        const before = yield* tasks.get(sessionID)
        const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
        const published = yield* listenUpdates

        const lost = yield* tasks.updateTask({
          sessionID,
          id: seed.id,
          status: "completed",
          content: "stale rename",
          priority: "high",
          outputDigest: "stale audit",
          expectedRevision: seed.revision,
        })
        expect(lost).toBeUndefined()
        expect(yield* tasks.get(sessionID)).toEqual(before)
        expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
        expect(published).toEqual([])
      }),
    )

    it.effect("patch requires both the status claim and revision after a field edit", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        yield* tasks.updateTask({ sessionID, id: seed.id, content: "current rename", outputDigest: "current audit" })
        const [current] = yield* tasks.get(sessionID)
        const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
        const published = yield* listenUpdates

        const stale = yield* tasks.patch({
          sessionID,
          id: seed.id,
          status: "completed",
          outputDigest: "stale audit",
          expect: ["pending"],
          expectedRevision: seed.revision,
        })
        expect(stale).toBeUndefined()
        const wrongStatus = yield* tasks.patch({
          sessionID,
          id: seed.id,
          status: "completed",
          outputDigest: "wrong claim",
          expect: ["in_progress"],
          expectedRevision: current.revision,
        })
        expect(wrongStatus).toBeUndefined()
        expect(yield* tasks.get(sessionID)).toEqual([current])
        expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
        expect(published).toEqual([])

        const won = yield* tasks.patch({
          sessionID,
          id: seed.id,
          status: "completed",
          outputDigest: "claimed audit",
          expect: ["pending"],
          expectedRevision: current.revision,
        })
        expect(won).toMatchObject({
          content: "current rename",
          status: "completed",
          outputDigest: "claimed audit",
          revision: current.revision + 1,
        })
        expect(published.map((event) => event.type)).toEqual([
          SessionTask.Event.Updated.type,
          SessionTask.Event.TodoUpdated.type,
        ])
      }),
    )

    it.effect("updateTask updates content with matching expectedRevision and increments", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          content: "renamed",
          expectedRevision: 1,
        })
        expect(updated?.content).toBe("renamed")
        expect(updated?.revision).toBe(2)
        // Unspecified fields are preserved.
        expect(updated?.status).toBe("pending")
        expect(updated?.priority).toBe("medium")
      }),
    )

    it.effect("updateTask without fields keeps the task data and still increments revision", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const published = yield* listenUpdates

        const updated = yield* tasks.updateTask({ sessionID, id: task.id, expectedRevision: task.revision })
        expect(updated).toMatchObject({
          id: task.id,
          content: task.content,
          status: task.status,
          priority: task.priority,
          revision: task.revision + 1,
          createdAt: task.createdAt,
        })
        expect(published.map((event) => event.type)).toEqual([
          SessionTask.Event.Updated.type,
          SessionTask.Event.TodoUpdated.type,
        ])
      }),
    )

    it.effect("updateTask can edit a legacy invalid cron row without revalidating its unchanged status", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        // Historical rows can predate schedule validation; a field edit retains their status.
        yield* database.db
          .update(TaskTable)
          .set({ status: "scheduled", recurrence: { cron: "invalid cron", enabled: true } })
          .where(eq(TaskTable.id, task.id))
          .run()
          .pipe(Effect.orDie)
        const published = yield* listenUpdates

        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          content: "renamed legacy task",
          expectedRevision: task.revision,
        })
        expect(updated).toMatchObject({
          content: "renamed legacy task",
          status: "scheduled",
          recurrence: { cron: "invalid cron", enabled: true },
          revision: task.revision + 1,
        })
        expect(published.map((event) => event.type)).toEqual([
          SessionTask.Event.Updated.type,
          SessionTask.Event.TodoUpdated.type,
        ])
        const before = yield* tasks.get(sessionID)
        const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)

        const error = yield* tasks
          .updateTask({
            sessionID,
            id: task.id,
            status: "completed",
            content: "must not land",
            expectedRevision: updated?.revision,
          })
          .pipe(Effect.flip)
        expect(error.reason).toBe("invalid_schedule")
        expect(error.schedule).toBe("cron")
        expect(yield* tasks.get(sessionID)).toEqual(before)
        expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
        expect(published).toHaveLength(2)
      }),
    )

    it.effect("updateTask with stale expectedRevision resolves undefined and does not write", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        // Concurrent patch bumped revision to 2.
        yield* tasks.patch({ sessionID, id: task.id, status: "in_progress" })
        const lost = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          content: "stale rename",
          expectedRevision: 1,
        })
        expect(lost).toBeUndefined()
        const got = yield* tasks.get(sessionID)
        expect(got[0]?.content).toBe("seed")
        expect(got[0]?.revision).toBe(2)
      }),
    )

    it.effect("updateTask updates priority and preserves content", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          priority: "high",
        })
        expect(updated?.priority).toBe("high")
        expect(updated?.content).toBe("seed")
        expect(updated?.revision).toBe(2)
      }),
    )

    it.effect("updateTask on an unknown id resolves undefined", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const updated = yield* tasks.updateTask({
          sessionID,
          id: "tsk_missing",
          content: "nope",
        })
        expect(updated).toBeUndefined()
      }),
    )

    it.effect("updateTask writes outputDigest and rides the republished event payload", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const events = yield* Bus.Service
        const published = new Array<Event.Payload>()
        const unsubscribe = yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === SessionTask.Event.Updated.type) published.push(event)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          outputDigest: "已构思 5 个分镜场景",
        })
        expect(updated?.outputDigest).toBe("已构思 5 个分镜场景")
        expect(updated?.revision).toBe(2)
        expect(published.at(-1)?.data).toEqual({ sessionID, tasks: [updated] })
      }),
    )

    it.effect("updateTask without outputDigest preserves an existing digest (backward compatible)", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "seed", status: "pending", priority: "medium" }],
        })
        yield* tasks.patch({ sessionID, id: task.id, status: "completed", outputDigest: "step done" })
        const updated = yield* tasks.updateTask({
          sessionID,
          id: task.id,
          content: "renamed",
          expectedRevision: 2,
        })
        expect(updated?.content).toBe("renamed")
        expect(updated?.outputDigest).toBe("step done")
      }),
    )

    it.effect("reorder reorders positions and increments revision for all tasks", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [a, b, c] = yield* tasks.update({
          sessionID,
          tasks: [
            { content: "a", status: "pending", priority: "medium" },
            { content: "b", status: "pending", priority: "medium" },
            { content: "c", status: "pending", priority: "medium" },
          ],
        })
        const reordered = yield* tasks.reorder({
          sessionID,
          ids: [c.id, b.id, a.id],
          expectedRevision: 1,
        })
        expect(reordered.map((task) => task.id)).toEqual([c.id, b.id, a.id])
        // All tasks are part of the structural change, so all get revision 2.
        expect(reordered.every((task) => task.revision === 2)).toBe(true)
      }),
    )

    it.effect("reorder with stale expectedRevision (max) fails and does not write", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [a, b] = yield* tasks.update({
          sessionID,
          tasks: [
            { content: "a", status: "pending", priority: "medium" },
            { content: "b", status: "pending", priority: "medium" },
          ],
        })
        // A concurrent patch bumped b's revision to 2; max is now 2.
        yield* tasks.patch({ sessionID, id: b.id, status: "in_progress" })
        const error = yield* tasks.reorder({ sessionID, ids: [b.id, a.id], expectedRevision: 1 }).pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(error.reason).toBe("stale_revision")
        // Positions unchanged.
        const got = yield* tasks.get(sessionID)
        expect(got.map((task) => task.id)).toEqual([a.id, b.id])
      }),
    )

    it.effect("reorder rejects an unknown id", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [a] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "a", status: "pending", priority: "medium" }],
        })
        const error = yield* tasks
          .reorder({ sessionID, ids: [a.id, "tsk_foreign"], expectedRevision: 1 })
          .pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(error.reason).toBe("foreign")
      }),
    )

    it.effect("update with stale expectedRevision (max) fails and does not write", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [a, b] = yield* tasks.update({
          sessionID,
          tasks: [
            { content: "a", status: "pending", priority: "medium" },
            { content: "b", status: "pending", priority: "medium" },
          ],
        })
        // A concurrent patch bumped b's revision to 2; max is now 2.
        yield* tasks.patch({ sessionID, id: b.id, status: "in_progress" })
        const error = yield* tasks
          .update({
            sessionID,
            // oxlint-disable-next-line no-misused-spread -- Schema.Class data carries no prototype members
            tasks: [
              { ...a, status: "completed" },
              { ...b, status: "completed" },
            ],
            expectedRevision: 1,
          })
          .pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionTask.TaskWriteError)
        expect(error.reason).toBe("stale_revision")
        // The stale replace did not land - b is still in_progress (revision 2).
        const got = yield* tasks.get(sessionID)
        expect(got.find((task) => task.id === b.id)?.status).toBe("in_progress")
      }),
    )
  })

  // P2-a: TaskExecutionProgress - ephemeral runtime progress for the pulse.
  // recordProgress publishes a task.progress event (no DB write); the app keeps
  // the latest snapshot in memory for a determinate pulse when a tool reports
  // current/total.
  describe("task progress (P2-a)", () => {
    it.effect("recordProgress publishes a task.progress event with the given fields", () =>
      Effect.gen(function* () {
        yield* setup
        const events = yield* Bus.Service
        const tasks = yield* SessionTask.Service
        const published = new Array<Event.Payload>()
        const unsubscribe = yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === SessionTask.Event.Progress.type) published.push(event)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
        })
        yield* tasks.recordProgress({
          sessionID,
          taskID: task.id,
          phase: "streaming",
          progress: 0.5,
          current: 3,
          total: 10,
        })

        expect(published).toHaveLength(1)
        const data = Schema.decodeUnknownSync(SessionTask.Event.Progress.data)(published[0].data)
        expect(data.taskID).toBe(task.id)
        expect(data.sessionID).toBe(sessionID)
        expect(data.phase).toBe("streaming")
        expect(data.progress).toBe(0.5)
        expect(data.current).toBe(3)
        expect(data.total).toBe(10)
        expect(typeof data.updatedAt).toBe("number")
      }),
    )

    it.effect("recordProgress does not modify the task row (ephemeral, no DB write)", () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
        })
        const before = yield* tasks.get(sessionID)
        yield* tasks.recordProgress({
          sessionID,
          taskID: task.id,
          phase: "tool",
          progress: 0.3,
        })
        const after = yield* tasks.get(sessionID)
        // The task row is unchanged - progress is ephemeral.
        expect(after).toEqual(before)
      }),
    )

    it.effect("recordProgress works without optional progress fields (phase-only)", () =>
      Effect.gen(function* () {
        yield* setup
        const events = yield* Bus.Service
        const tasks = yield* SessionTask.Service
        const published = new Array<Event.Payload>()
        const unsubscribe = yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === SessionTask.Event.Progress.type) published.push(event)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        const [task] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "audit", status: "in_progress", priority: "medium" }],
        })
        yield* tasks.recordProgress({
          sessionID,
          taskID: task.id,
          phase: "thinking",
        })

        const data = Schema.decodeUnknownSync(SessionTask.Event.Progress.data)(published[0].data)
        expect(data.phase).toBe("thinking")
        expect(data.progress).toBeUndefined()
        expect(data.current).toBeUndefined()
        expect(data.total).toBeUndefined()
      }),
    )
  })
})

describe("SessionTask.Event.StepResumed (M1.5 work resume telemetry)", () => {
  test("defines the work.step_resumed event with a sessionID payload", () => {
    const payload = Schema.decodeUnknownSync(SessionTask.Event.StepResumed.data)({
      sessionID: Session.ID.make("ses_123"),
    })
    expect(payload.sessionID).toBe(Session.ID.make("ses_123"))
    expect(SessionTask.Event.StepResumed.type).toBe("work.step_resumed")
  })
})

for (const operation of ["update", "replaceLegacy"] as const) {
  it.effect(`${operation} retains a fixed timezone through cancellation and rescheduling`, () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const database = yield* Database.Service
      const [task] = yield* tasks.append({
        sessionID,
        tasks: [
          {
            content: "fixed timezone",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "0 9 * * *", timezone: "America/New_York", enabled: true },
          },
        ],
      })
      if (!task) throw new Error("Expected fixed timezone Task")
      const cancelled = yield* tasks[operation]({
        sessionID,
        tasks: [
          {
            id: task.id,
            content: task.content,
            status: "cancelled",
            priority: task.priority,
            recurrence: { cron: "0 10 * * *", enabled: false },
          },
        ],
      })
      expect(cancelled[0]?.recurrence).toEqual({ cron: "0 10 * * *", timezone: "America/New_York", enabled: false })
      const resumed = yield* tasks[operation]({
        sessionID,
        tasks: [
          {
            id: task.id,
            content: task.content,
            status: "scheduled",
            priority: task.priority,
            recurrence: { cron: "0 10 * * *", enabled: true },
          },
        ],
      })
      const recurrence = resumed[0]?.recurrence
      if (!recurrence) throw new Error("Expected persisted recurrence")
      expect(recurrence).toEqual({ cron: "0 10 * * *", timezone: "America/New_York", enabled: true })
      expect((yield* tasks.get(sessionID))[0]?.recurrence).toEqual(recurrence)
      const rows = yield* database.db.select().from(TaskTable).where(eq(TaskTable.id, task.id)).all().pipe(Effect.orDie)
      expect(rows[0]?.recurrence).toEqual(recurrence)
    }),
  )
}

describe("Task schedule write boundaries", () => {
  scheduleIt.effect("MP05 ordinary updateTask rolls back its Task write when the linked Schedule write fails", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const schedules = yield* ScheduleService.Service
      const database = yield* Database.Service
      const now = (yield* DateTime.nowAsDate).getTime()
      const dueAt = now + 60_000
      const [task] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "original task", status: "scheduled", priority: "medium", scheduledAt: dueAt }],
      })
      yield* database.db
        .transaction(() => ScheduleTask.sync(database.db, { sessionID, now, previous: [] }))
        .pipe(Effect.orDie)
      const rule = yield* schedules.getRule(ScheduleTask.idFor(task.id))
      if (!rule) return yield* Effect.die(new Error("Expected the existing Task schedule"))
      const before = yield* tasks.get(sessionID)
      const scheduleBefore = yield* schedules.getRule(rule.id)
      const published = yield* listenUpdates
      yield* database.db
        .run(
          sql`
      CREATE TEMP TRIGGER reject_task_schedule_update BEFORE UPDATE OF content ON schedule
      WHEN NEW.content = 'reject linked schedule'
      BEGIN SELECT RAISE(ABORT, 'Schedule sync rejected'); END
    `,
        )
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        database.db.run(sql`DROP TRIGGER IF EXISTS reject_task_schedule_update`).pipe(Effect.orDie),
      )
      const failed = yield* tasks
        .updateTask({ sessionID, id: task.id, content: "reject linked schedule" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Schedule sync rejected")
      expect(yield* tasks.get(sessionID)).toEqual(before)
      expect(yield* schedules.getRule(rule.id)).toEqual(scheduleBefore)
      expect(published).toEqual([])
      return undefined
    }),
  )

  scheduleIt.effect(
    "MP05 full write append legacy replacement reorder and deletion keep one Schedule per Task and retain run history",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const schedules = yield* ScheduleService.Service
        const now = (yield* DateTime.nowAsDate).getTime()
        const [first] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "first payload", status: "scheduled", priority: "medium", scheduledAt: now + 60_000 }],
        })
        const firstRule = yield* schedules.getRule(ScheduleTask.idFor(first.id))
        expect(firstRule?.nextDueAt).toBe(now + 60_000)
        yield* tasks.update({
          sessionID,
          tasks: [
            {
              id: first.id,
              content: "edited payload",
              status: "scheduled",
              priority: "high",
              scheduledAt: now + 120_000,
            },
          ],
        })
        expect(yield* schedules.getRule(ScheduleTask.idFor(first.id))).toMatchObject({
          content: "edited payload",
          nextDueAt: now + 120_000,
        })
        const appended = yield* tasks.append({
          sessionID,
          tasks: [
            {
              id: "tsk_schedule_second",
              content: "second payload",
              status: "scheduled",
              priority: "low",
              scheduledAt: now + 180_000,
            },
          ],
        })
        const second = appended.find((task) => task.id !== first.id)
        if (!second) return yield* Effect.die(new Error("Expected the appended Task"))
        const replaced = yield* tasks.replaceLegacy({
          sessionID,
          tasks: [
            { content: "legacy first", status: "scheduled", priority: "high" },
            { content: "legacy second", status: "scheduled", priority: "low" },
          ],
        })
        expect(replaced.map((task) => task.id)).toEqual([first.id, second.id])
        const rules = yield* schedules.listRules(sessionID)
        expect(rules.map((rule) => rule.taskID).sort()).toEqual([first.id, second.id].sort())
        expect(rules.find((rule) => rule.taskID === first.id)).toMatchObject({
          content: "legacy first",
          nextDueAt: now + 120_000,
        })
        const reordered = yield* tasks.reorder({ sessionID, ids: [second.id, first.id] })
        expect(reordered.map((task) => [task.id, task.nextRun])).toEqual([
          [second.id, now + 180_000],
          [first.id, now + 120_000],
        ])
        expect(yield* schedules.listRules(sessionID)).toEqual(rules)
        const current = yield* schedules.getRule(ScheduleTask.idFor(first.id))
        if (!current?.nextDueAt) return yield* Effect.die(new Error("Expected the linked Task schedule"))
        yield* TestClock.setTime(current.nextDueAt)
        const run = yield* schedules.claimOccurrence(current.id, current.nextDueAt, "task-history")
        if (!run) return yield* Effect.die(new Error("Expected one recorded run"))
        yield* tasks.removeTask({ sessionID, id: first.id })
        expect((yield* schedules.getRule(current.id))?.status).toBe("cancelled")
        expect(yield* schedules.runs(current.id)).toEqual([run])
        expect((yield* tasks.get(sessionID)).map((task) => task.id)).toEqual([second.id])
        yield* tasks.delete(sessionID)
        expect(yield* tasks.get(sessionID)).toEqual([])
        expect((yield* schedules.getRule(ScheduleTask.idFor(second.id)))?.status).toBe("cancelled")
        expect(yield* schedules.runs(current.id)).toEqual([run])
        return undefined
      }),
  )

  scheduleIt.effect(
    "MP05 get and listAll read canonical nextDue for terminal anchors and suppress the Task fallback for a paused rule",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const schedules = yield* ScheduleService.Service
        const database = yield* Database.Service
        const [task] = yield* tasks.append({
          sessionID,
          tasks: [
            {
              content: "recurring anchor",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
            },
          ],
        })
        yield* tasks.patch({ sessionID, id: task.id, status: "completed" })
        const canonicalNext = (yield* DateTime.nowAsDate).getTime() + 420_123
        yield* database.db
          .update(ScheduleTable)
          .set({ next_due_at: canonicalNext })
          .where(eq(ScheduleTable.task_id, task.id))
          .run()
          .pipe(Effect.orDie)
        expect((yield* tasks.get(sessionID))[0]).toMatchObject({ status: "completed", nextRun: canonicalNext })
        expect((yield* tasks.listAll()).find((row) => row.id === task.id)?.nextRun).toBe(canonicalNext)
        expect((yield* tasks.patch({ sessionID, id: task.id, status: "failed" }))?.nextRun).toBe(canonicalNext)
        yield* tasks.patch({ sessionID, id: task.id, status: "scheduled" })
        const rule = yield* schedules.getRule(ScheduleTask.idFor(task.id))
        if (!rule) return yield* Effect.die(new Error("Expected the canonical rule"))
        yield* schedules.pauseRule(rule.id, rule.revision)
        expect((yield* tasks.get(sessionID))[0]?.status).toBe("scheduled")
        expect((yield* tasks.get(sessionID))[0]?.nextRun).toBeUndefined()
        expect((yield* tasks.listAll()).find((row) => row.id === task.id)?.nextRun).toBeUndefined()
        return undefined
      }),
  )
})

describe("Task operation reservations", () => {
  const request = (id: string, change: Partial<SessionTask.OperationRequest> = {}) =>
    new SessionTask.OperationRequest({
      operationID: SessionTask.OperationID.make(`top_${id}`),
      inputID: SessionMessage.ID.make(`msg_operation_${id}`),
      target: new SessionTask.OperationNewRootTarget({ type: "new_root", mode: ProductMode.ID.make("chat") }),
      prompt: "complete this fixed request",
      delivery: "queue",
      resume: false,
      ...change,
    })
  const source = new SessionTask.OperationUserSource({
    type: "user_coordination",
    sessionID,
    agent: Agent.ID.make("meta"),
  })
  const reservation = (input: SessionTask.OperationRequest) => ({
    sessionID,
    request: input,
    source,
    selection: new SessionTask.OperationSelection({ agent: source.agent, seq: Event.Seq.make(0) }),
    sourceLocation: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
    sourceMode: ProductMode.ID.make("coding"),
  })

  it.effect("reserves without a Task and returns the saved blocked operation to a later exact retry", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const input = request("before_permission")
      const first = yield* tasks.reserveOperation(reservation(input))
      expect(first.created).toBe(true)
      expect(first.operation.phase).toBe("reserved")
      expect(first.operation.taskID).toBeUndefined()
      expect(first.operation.targetSessionID).toBeDefined()
      expect(yield* tasks.get(sessionID)).toEqual([])
      const blocked = yield* tasks.advanceOperation({
        sessionID,
        operationID: input.operationID,
        change: new SessionTask.OperationChange({
          phase: "blocked",
          error: new SessionTask.OperationError({
            code: "permission_denied",
            message: "denied before creating a target",
          }),
        }),
      })
      const retry = yield* tasks.reserveOperation({
        ...reservation(input),
        source: new SessionTask.OperationUserSource({
          type: "user_coordination",
          sessionID,
          agent: Agent.ID.make("build"),
        }),
      })
      expect(retry.created).toBe(false)
      expect(retry.operation).toEqual(blocked)
      expect(yield* tasks.get(sessionID)).toEqual([])
      const conflict = yield* tasks
        .reserveOperation(reservation(request("before_permission", { prompt: "changed request" })))
        .pipe(Effect.result)
      expect(Result.isFailure(conflict)).toBe(true)
      if (Result.isFailure(conflict)) expect(conflict.failure).toMatchObject({ reason: "request_changed" })
      expect((yield* tasks.operations({ sessionID })).length).toBe(1)
    }),
  )

  it.effect("matches immutable request before a Task revision check and retains history after Task deletion", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [seed] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "task anchor", status: "pending", priority: "medium" }],
      })
      const input = request("task_history", { taskID: seed.id, expectedRevision: seed.revision })
      const admitted = yield* tasks.reserveOperation(reservation(input))
      expect(admitted.operation.taskRevision).toBe(seed.revision + 1)
      expect((yield* tasks.get(sessionID))[0]?.operationRef?.operationID).toBe(input.operationID)
      const edited = yield* tasks.updateTask({
        sessionID,
        id: seed.id,
        content: "a user edit while the result is held",
      })
      if (!edited) return yield* Effect.die(new Error("The source Task edit was not saved"))
      const failed = yield* tasks.advanceOperation({
        sessionID,
        operationID: input.operationID,
        change: new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "prepare_failed", message: "no provider work" }),
        }),
      })
      expect(failed.sourceSettlement).toBe("conflict")
      expect((yield* tasks.get(sessionID))[0]).toEqual(edited)
      expect((yield* tasks.reserveOperation(reservation(input))).operation).toEqual(failed)
      yield* tasks.removeTask({ sessionID, id: seed.id })
      expect(yield* tasks.get(sessionID)).toEqual([])
      expect(yield* tasks.operations({ sessionID, taskID: seed.id })).toEqual([failed])
      return undefined
    }),
  )

  it.effect(
    "keeps a followup waiting under the original claim and cancelling it leaves its predecessor unchanged",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "one task with two operations", status: "pending", priority: "medium" }],
        })
        const a = yield* tasks.reserveOperation(
          reservation(request("followup_a", { taskID: seed.id, expectedRevision: seed.revision })),
        )
        const b = yield* tasks.reserveOperation(
          reservation(request("followup_b", { taskID: seed.id, expectedRevision: a.operation.taskRevision })),
        )
        expect(b.operation.phase).toBe("waiting")
        expect(b.operation.predecessorID).toBe(a.operation.operationID)
        expect(b.operation.taskRevision).toBeUndefined()
        const claim = yield* database.db
          .select()
          .from(KVTable)
          .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
          .get()
          .pipe(Effect.orDie)
        expect(claim?.value).toMatchObject({ operationID: a.operation.operationID })
        const cancelled = yield* tasks.advanceOperation({
          sessionID,
          operationID: b.operation.operationID,
          change: new SessionTask.OperationChange({ cancelIntent: true, phase: "cancelled" }),
        })
        expect(cancelled.phase).toBe("cancelled")
        expect(yield* tasks.operation({ sessionID, operationID: a.operation.operationID })).toEqual(a.operation)
        const remaining = yield* database.db
          .select()
          .from(KVTable)
          .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
          .get()
          .pipe(Effect.orDie)
        expect(remaining?.value).toEqual(claim?.value)
      }),
  )

  it.effect("protects operation claims from management and creates an optional Task only once", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const created = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
          { content: "c", status: "pending", priority: "medium" },
          { content: "d", status: "pending", priority: "medium" },
        ],
      })
      yield* tasks.removeTask({ sessionID, id: created[0].id })
      yield* tasks.removeTask({ sessionID, id: created[1].id })
      expect((yield* tasks.get(sessionID)).map((task) => task.id)).toEqual([created[2].id, created[3].id])
      const input = request("attach_once")
      yield* tasks.reserveOperation(reservation(input))
      yield* tasks.advanceOperation({
        sessionID,
        operationID: input.operationID,
        change: new SessionTask.OperationChange({ phase: "permission_pending" }),
      })
      const attached = yield* tasks.attachOperationTask({ sessionID, operationID: input.operationID })
      expect(attached.taskID).toBeDefined()
      expect((yield* tasks.attachOperationTask({ sessionID, operationID: input.operationID })).taskID).toBe(
        attached.taskID,
      )
      if (!attached.taskID) throw new Error("Expected the permitted operation's Task")
      const visible = yield* tasks.get(sessionID)
      expect(visible.length).toBe(3)
      expect(visible.map((task) => task.id)).toEqual([created[2].id, created[3].id, attached.taskID])
      const removal = yield* tasks
        .removeTask(
          { sessionID, id: attached.taskID },
          { management: { type: "tool", messageID: "msg_management", id: "call-management" } },
        )
        .pipe(Effect.result)
      expect(Result.isFailure(removal)).toBe(true)
      if (Result.isFailure(removal)) expect(removal.failure.reason).toBe("execution_owned")
    }),
  )

  it.effect("rejects input reuse and a different trusted origin before reserving another operation", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const first = request("input_owner")
      yield* tasks.reserveOperation(reservation(first))
      const second = request("different_owner", { inputID: first.inputID })
      const inputConflict = yield* tasks.reserveOperation(reservation(second)).pipe(Effect.result)
      expect(Result.isFailure(inputConflict)).toBe(true)
      if (Result.isFailure(inputConflict)) expect(inputConflict.failure).toMatchObject({ reason: "input_owned" })
      const sourceConflict = yield* tasks
        .reserveOperation({
          ...reservation(first),
          source: new SessionTask.OperationToolSource({
            type: "model_tool",
            sessionID,
            agent: Agent.ID.make("meta"),
            messageID: SessionMessage.ID.make("msg_other_source"),
            id: "call-other-source",
          }),
        })
        .pipe(Effect.result)
      expect(Result.isFailure(sourceConflict)).toBe(true)
      if (Result.isFailure(sourceConflict)) expect(sourceConflict.failure).toMatchObject({ reason: "source_changed" })
      expect((yield* tasks.operations({ sessionID })).length).toBe(1)
    }),
  )

  it.effect("MP05 preserves a trusted new target and always retains an existing target from the original request", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const targetSessionID = Session.ID.make("ses_preallocated_operation")
      const created = yield* tasks.reserveOperation({ ...reservation(request("preallocated_target")), targetSessionID })
      expect(created.operation.targetSessionID).toBe(targetSessionID)
      const existingID = Session.ID.make("ses_existing_operation")
      const existing = yield* tasks.reserveOperation({
        ...reservation(
          request("existing_target", {
            target: new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: existingID }),
          }),
        ),
        targetSessionID,
      })
      expect(existing.operation.targetSessionID).toBe(existingID)
    }),
  )

  it.effect(
    "MP05 an exact Task CAS settles a restored pending source marker and a later user edit cannot change that first settlement",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "source anchor", status: "pending", priority: "medium" }],
        })
        const reserved = yield* tasks.reserveOperation(
          reservation(request("source_marker", { taskID: seed.id, expectedRevision: seed.revision })),
        )
        yield* database.db
          .update(TaskOperationTable)
          .set({
            data: {
              ...Schema.encodeSync(SessionTask.OperationInfo)(reserved.operation),
              sourceSettlement: "pending",
            },
          })
          .where(
            and(
              eq(TaskOperationTable.source_session_id, sessionID),
              eq(TaskOperationTable.operation_id, reserved.operation.operationID),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        const change = new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "worker_failed", message: "original result" }),
        })
        const settled = yield* tasks.advanceOperation({
          sessionID,
          operationID: reserved.operation.operationID,
          change,
        })
        expect(settled.sourceSettlement).toBe("settled")
        expect((yield* tasks.get(sessionID))[0]).toMatchObject({
          status: "failed",
          revision: seed.revision + 2,
          outputDigest: "original result",
        })
        expect(
          yield* database.db
            .select()
            .from(KVTable)
            .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
        const edited = yield* tasks.updateTask({ sessionID, id: seed.id, content: "later user edit" })
        if (!edited) return yield* Effect.die(new Error("The later source Task edit was not saved"))
        const retried = yield* tasks.advanceOperation({
          sessionID,
          operationID: reserved.operation.operationID,
          change,
        })
        expect(retried.sourceSettlement).toBe("settled")
        expect((yield* tasks.get(sessionID))[0]).toEqual(edited)
        return undefined
      }),
  )

  it.effect("MP05 an old operation cannot settle or release another operation's current claim", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const database = yield* Database.Service
      const [seed] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "shared source", status: "pending", priority: "medium" }],
      })
      const first = yield* tasks.reserveOperation(
        reservation(request("old_claim", { taskID: seed.id, expectedRevision: seed.revision })),
      )
      const oldClaim = yield* database.db
        .select()
        .from(KVTable)
        .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
        .get()
        .pipe(Effect.orDie)
      if (!oldClaim || first.operation.taskRevision === undefined)
        return yield* Effect.die(new Error("Expected the first operation claim"))
      const permission = { type: "operation" as const, sessionID, operationID: first.operation.operationID }
      yield* tasks.releaseClaim({ sessionID, id: seed.id, revision: first.operation.taskRevision, source: permission })
      const [released] = yield* tasks.get(sessionID)
      const next = yield* tasks.reserveOperation(
        reservation(request("new_claim", { taskID: seed.id, expectedRevision: released.revision })),
      )
      const before = yield* tasks.get(sessionID)
      const currentClaim = yield* database.db
        .select()
        .from(KVTable)
        .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
        .get()
        .pipe(Effect.orDie)
      const failed = yield* tasks.advanceOperation({
        sessionID,
        operationID: first.operation.operationID,
        change: new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "late_result", message: "late old result" }),
        }),
      })
      expect(failed.sourceSettlement).toBe("conflict")
      expect(yield* tasks.get(sessionID)).toEqual(before)
      expect(yield* tasks.operation({ sessionID, operationID: next.operation.operationID })).toEqual(next.operation)
      expect(
        yield* database.db
          .select()
          .from(KVTable)
          .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
          .get()
          .pipe(Effect.orDie),
      ).toEqual(currentClaim)
      return undefined
    }),
  )

  it.effect("MP05 waiting operations retain reservation order when the predecessor releases its claim", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const database = yield* Database.Service
      const [seed] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "ordered source", status: "pending", priority: "medium" }],
      })
      const first = yield* tasks.reserveOperation(
        reservation(request("ordered_a", { taskID: seed.id, expectedRevision: seed.revision })),
      )
      const second = yield* tasks.reserveOperation(
        reservation(request("ordered_b", { taskID: seed.id, expectedRevision: first.operation.taskRevision })),
      )
      const third = yield* tasks.reserveOperation(
        reservation(request("ordered_c", { taskID: seed.id, expectedRevision: first.operation.taskRevision })),
      )
      expect(second.operation.predecessorID).toBe(first.operation.operationID)
      expect(third.operation.predecessorID).toBe(second.operation.operationID)
      expect((yield* tasks.claimWaitingOperation({ sessionID, operationID: third.operation.operationID })).phase).toBe(
        "waiting",
      )
      yield* tasks.advanceOperation({
        sessionID,
        operationID: first.operation.operationID,
        change: new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "first_done", message: "first finished" }),
        }),
      })
      const [afterFirst] = yield* tasks.get(sessionID)
      const fourth = yield* tasks.reserveOperation(
        reservation(request("ordered_d", { taskID: seed.id, expectedRevision: afterFirst.revision })),
      )
      expect(fourth.operation.phase).toBe("waiting")
      expect(fourth.operation.predecessorID).toBe(third.operation.operationID)
      const claimedSecond = yield* tasks.claimWaitingOperation({ sessionID, operationID: second.operation.operationID })
      expect(claimedSecond.phase).toBe("reserved")
      expect(claimedSecond.taskRevision).toBe(afterFirst.revision + 1)
      expect((yield* tasks.claimWaitingOperation({ sessionID, operationID: third.operation.operationID })).phase).toBe(
        "waiting",
      )
      yield* tasks.advanceOperation({
        sessionID,
        operationID: second.operation.operationID,
        change: new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "second_done", message: "second finished" }),
        }),
      })
      const claimedThird = yield* tasks.claimWaitingOperation({ sessionID, operationID: third.operation.operationID })
      expect(claimedThird.phase).toBe("reserved")
      const claim = yield* database.db
        .select()
        .from(KVTable)
        .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
        .get()
        .pipe(Effect.orDie)
      expect(claim?.value).toMatchObject({
        operationID: third.operation.operationID,
        parentTaskRevision: claimedThird.taskRevision,
      })
      yield* tasks.advanceOperation({
        sessionID,
        operationID: third.operation.operationID,
        change: new SessionTask.OperationChange({
          phase: "failed",
          error: new SessionTask.OperationError({ code: "third_done", message: "third finished" }),
        }),
      })
      expect((yield* tasks.claimWaitingOperation({ sessionID, operationID: fourth.operation.operationID })).phase).toBe(
        "reserved",
      )
    }),
  )

  it.effect(
    "MP05 a waiting operation claims the current revision and its later result preserves a newer user edit",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [{ content: "editable source", status: "pending", priority: "medium" }],
        })
        const first = yield* tasks.reserveOperation(
          reservation(request("edit_a", { taskID: seed.id, expectedRevision: seed.revision })),
        )
        const waiting = yield* tasks.reserveOperation(
          reservation(request("edit_b", { taskID: seed.id, expectedRevision: first.operation.taskRevision })),
        )
        yield* tasks.advanceOperation({
          sessionID,
          operationID: first.operation.operationID,
          change: new SessionTask.OperationChange({
            phase: "failed",
            error: new SessionTask.OperationError({ code: "source_done", message: "source finished" }),
          }),
        })
        const edited = yield* tasks.updateTask({ sessionID, id: seed.id, content: "authoritative user revision" })
        if (!edited) return yield* Effect.die(new Error("Expected the user field edit"))
        const claimed = yield* tasks.claimWaitingOperation({ sessionID, operationID: waiting.operation.operationID })
        expect(claimed.phase).toBe("reserved")
        expect(claimed.taskRevision).toBe(edited.revision + 1)
        expect((yield* tasks.get(sessionID))[0]?.content).toBe(edited.content)
        const later = yield* tasks.updateTask({ sessionID, id: seed.id, content: "newer user revision" })
        if (!later) return yield* Effect.die(new Error("The newer source Task revision was not saved"))
        const failed = yield* tasks.advanceOperation({
          sessionID,
          operationID: waiting.operation.operationID,
          change: new SessionTask.OperationChange({
            phase: "failed",
            error: new SessionTask.OperationError({ code: "late_result", message: "late waiting result" }),
          }),
        })
        expect(failed.sourceSettlement).toBe("conflict")
        expect((yield* tasks.get(sessionID))[0]).toEqual(later)
        expect(
          yield* database.db
            .select()
            .from(KVTable)
            .where(eq(KVTable.key, `task:claim:${sessionID}:${seed.id}`))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
        return undefined
      }),
  )

  scheduleIt.effect(
    "MP05 execution cancellation retains recurrence while an explicit Task pause disables future admission",
    () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const schedules = yield* ScheduleService.Service
        const [seed] = yield* tasks.append({
          sessionID,
          tasks: [
            {
              content: "recurring worker",
              status: "scheduled",
              priority: "medium",
              recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
            },
          ],
        })
        const reserved = yield* tasks.reserveOperation(
          reservation(request("cancel_execution", { taskID: seed.id, expectedRevision: seed.revision })),
        )
        const cancelled = yield* tasks.advanceOperation({
          sessionID,
          operationID: reserved.operation.operationID,
          change: new SessionTask.OperationChange({ phase: "cancelled", cancelIntent: true }),
        })
        expect(cancelled.sourceSettlement).toBe("settled")
        const rule = yield* schedules.getRule(ScheduleTask.idFor(seed.id))
        expect(rule).toMatchObject({ status: "pending", recurrence: { enabled: true } })
        expect((yield* tasks.get(sessionID))[0]).toMatchObject({ status: "cancelled", nextRun: rule?.nextDueAt })
        yield* tasks.patch({ sessionID, id: seed.id, status: "scheduled" })
        yield* tasks.patch({ sessionID, id: seed.id, status: "cancelled" })
        expect((yield* schedules.getRule(ScheduleTask.idFor(seed.id)))?.status).toBe("paused")
        expect((yield* tasks.get(sessionID))[0]?.nextRun).toBeUndefined()
      }),
  )
})
