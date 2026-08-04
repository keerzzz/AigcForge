import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskScheduleTool } from "@aigcfroge/core/tool/taskschedule"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_taskschedule_tool_test")

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const tool = TaskScheduleTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(permission),
  Layer.provide(SessionTask.defaultLayer),
)
const it = testEffect(
  Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionTask.defaultLayer, permission, registry, tool),
)

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
      slug: "taskschedule",
      directory: "/project",
      title: "taskschedule",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (tasks: ReadonlyArray<Record<string, unknown>>, id = "call-taskschedule") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TaskScheduleTool.name, input: { tasks } },
})

describe("task_schedule tool", () => {
  it.effect("registers the task_schedule tool in the registry", () =>
    Effect.gen(function* () {
      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize([
        { action: TaskScheduleTool.name, resource: "*", effect: "allow" },
      ])
      expect(materialized.definitions.some((definition) => definition.name === TaskScheduleTool.name)).toBe(true)
    }),
  )

  it.effect("schedule persists content, scheduledAt, recurrence, and agentID on the created task", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      const settlement = yield* settleTool(
        reg,
        call([
          {
            content: "nightly audit",
            scheduledAt: 1_780_000_000_000,
            recurrence: { cron: "0 3 * * *", enabled: true },
            agentID: "auditor",
          },
        ]),
      )
      expect(settlement.result.type).toBe("text")

      const persisted = yield* tasks.get(sessionID)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({
        content: "nightly audit",
        status: "scheduled",
        scheduledAt: 1_780_000_000_000,
        recurrence: { cron: "0 3 * * *", enabled: true },
        agentID: "auditor",
      })
    }),
  )

  it.effect("pause settles a scheduled task to cancelled and resume returns it to scheduled", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const [created] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 }],
      })

      yield* executeTool(reg, call([{ id: created.id, action: "pause" }]))
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("cancelled")

      yield* executeTool(reg, call([{ id: created.id, action: "resume" }]))
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("scheduled")
    }),
  )

  it.effect("remove drops only the target id", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const [keep, drop] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "keep", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
          { content: "drop", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
        ],
      })

      yield* executeTool(reg, call([{ id: drop.id, action: "remove" }]))

      const remaining = yield* tasks.get(sessionID)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(keep.id)
    }),
  )

  it.effect("remove does not drop a concurrently appended task (re-review HIGH-1)", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const [drop, keep] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "drop", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
          { content: "keep", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
        ],
      })

      yield* Effect.all(
        [
          executeTool(reg, call([{ id: drop.id, action: "remove" }])).pipe(Effect.asVoid),
          tasks.append({
            sessionID,
            tasks: [{ content: "concurrent", status: "pending", priority: "medium" }],
          }),
        ],
        { concurrency: "unbounded" },
      )

      const remaining = yield* tasks.get(sessionID)
      expect(remaining.some((task) => task.content === "concurrent")).toBe(true)
      expect(remaining.some((task) => task.id === drop.id)).toBe(false)
      expect(remaining.some((task) => task.id === keep.id)).toBe(true)
    }),
  )

  it.effect("rejects a schedule entry with missing or empty content", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      expect(yield* executeTool(reg, call([{ scheduledAt: 1_780_000_000_000 }]))).toEqual({
        type: "error",
        value: "task_schedule: schedule requires a non-empty content prompt",
      })
      expect(yield* executeTool(reg, call([{ content: "   ", scheduledAt: 1_780_000_000_000 }]))).toEqual({
        type: "error",
        value: "task_schedule: schedule requires a non-empty content prompt",
      })
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a schedule entry without scheduledAt or recurrence (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      expect(yield* executeTool(reg, call([{ content: "never runs" }]))).toEqual({
        type: "error",
        value:
          "task_schedule: schedule requires scheduledAt (one-shot) or recurrence (cron); a job without a trigger can never run",
      })
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects an enabled recurrence whose cron is invalid or never matches (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      expect(
        yield* executeTool(reg, call([{ content: "bad hour", recurrence: { cron: "0 25 * * *", enabled: true } }])),
      ).toEqual({
        type: "error",
        value:
          'task_schedule: recurrence cron "0 25 * * *" is invalid or has no future run; refusing to persist a dead job',
      })
      // A parseable cron with no real-world match (30th of February) is dead too.
      expect(
        yield* executeTool(reg, call([{ content: "feb 30", recurrence: { cron: "0 9 30 2 *", enabled: true } }])),
      ).toEqual({
        type: "error",
        value:
          'task_schedule: recurrence cron "0 9 30 2 *" is invalid or has no future run; refusing to persist a dead job',
      })
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a disabled recurrence without a scheduledAt fallback (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      expect(
        yield* executeTool(reg, call([{ content: "never runs", recurrence: { cron: "0 3 * * *", enabled: false } }])),
      ).toEqual({
        type: "error",
        value:
          "task_schedule: recurrence is disabled and scheduledAt is unset; a job without a trigger can never run",
      })
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects pause/resume/remove without an existing task id", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      expect(yield* executeTool(reg, call([{ action: "pause" }]))).toEqual({
        type: "error",
        value: "task_schedule: pause requires the id of an existing task",
      })
      expect(yield* executeTool(reg, call([{ action: "resume" }]))).toEqual({
        type: "error",
        value: "task_schedule: resume requires the id of an existing task",
      })
      expect(yield* executeTool(reg, call([{ action: "remove" }]))).toEqual({
        type: "error",
        value: "task_schedule: remove requires the id of an existing task",
      })
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )
})
