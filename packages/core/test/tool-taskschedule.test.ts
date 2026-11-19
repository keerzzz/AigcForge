import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Database } from "@aigcfroge/core/database/database"
import { Image } from "@aigcfroge/core/image"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Tool } from "@aigcfroge/core/tool"
import { TaskScheduleTool } from "@aigcfroge/core/tool/taskschedule"
import { Bus } from "@aigcfroge/core/bus"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_taskschedule_tool_test")

const permission = permissionLayer({ assert: () => Effect.void })

const harness = Layer.mergeAll(
  AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node, SessionTask.node, Database.node, Bus.node]), [
    Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
  ]),
  permission,
)

const it = testEffect(harness)

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
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const definitions = yield* toolDefinitions(registry)
      expect(definitions.some((definition) => definition.name === TaskScheduleTool.name)).toBe(true)
    }),
  )

  it.effect("schedule persists content, scheduledAt, recurrence, and agentID on the created task", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const result = yield* executeTool(
        registry,
        call([
          {
            content: "nightly audit",
            scheduledAt: 1_780_000_000_000,
            recurrence: { cron: "0 3 * * *", enabled: true },
            agentID: "auditor",
          },
        ]),
      )
      expect(result.status).toBe("completed")

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

  it.effect("multi-entry schedule resolves only the newly created tasks (no full-list duplication)", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "pre-existing", status: "pending", priority: "medium" }],
      })

      const result = yield* executeTool(
        registry,
        call([
          { content: "first job", scheduledAt: 1_780_000_000_000 },
          { content: "second job", scheduledAt: 1_780_000_100_000 },
        ]),
      )
      expect(result.status).toBe("completed")
      // append resolves the full session list; the tool output must contain
      // only the two rows this call created, not 2x (or 3x) the full list.
      const output = result.output?.tasks as ReadonlyArray<{ id: string; content: string }>
      expect(output).toHaveLength(2)
      expect(output.map((task) => task.content)).toEqual(["first job", "second job"])

      const persisted = yield* tasks.get(sessionID)
      expect(persisted).toHaveLength(3)
      expect(output.every((task) => persisted.some((row) => row.id === task.id))).toBe(true)
    }),
  )

  it.effect("pause settles a scheduled task to cancelled and resume returns it to scheduled", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [created] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 }],
      })

      yield* executeTool(registry, call([{ id: created.id, action: "pause" }]))
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("cancelled")

      yield* executeTool(registry, call([{ id: created.id, action: "resume" }]))
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("scheduled")
    }),
  )

  it.effect("remove drops only the target id", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [keep, drop] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "keep", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
          { content: "drop", status: "scheduled", priority: "medium", scheduledAt: 1_780_000_000_000 },
        ],
      })

      yield* executeTool(registry, call([{ id: drop.id, action: "remove" }]))

      const remaining = yield* tasks.get(sessionID)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(keep.id)
    }),
  )

  it.effect("remove does not drop a concurrently appended task (re-review HIGH-1)", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
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
          executeTool(registry, call([{ id: drop.id, action: "remove" }])).pipe(Effect.asVoid),
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
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const missing = yield* executeTool(registry, call([{ scheduledAt: 1_780_000_000_000 }]))
      expect(missing.status).toBe("error")
      expect(missing.error?.message).toBe("task_schedule: schedule requires a non-empty content prompt")
      const blank = yield* executeTool(registry, call([{ content: "   ", scheduledAt: 1_780_000_000_000 }]))
      expect(blank.status).toBe("error")
      expect(blank.error?.message).toBe("task_schedule: schedule requires a non-empty content prompt")
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a schedule entry without scheduledAt or recurrence (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const result = yield* executeTool(registry, call([{ content: "never runs" }]))
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe(
        "task_schedule: schedule requires scheduledAt (one-shot) or recurrence (cron); a job without a trigger can never run",
      )
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects an enabled recurrence whose cron is invalid or never matches (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const badHour = yield* executeTool(
        registry,
        call([{ content: "bad hour", recurrence: { cron: "0 25 * * *", enabled: true } }]),
      )
      expect(badHour.status).toBe("error")
      expect(badHour.error?.message).toBe(
        'task_schedule: recurrence cron "0 25 * * *" is invalid or has no future run; refusing to persist a dead job',
      )
      // A parseable cron with no real-world match (30th of February) is dead too.
      const feb30 = yield* executeTool(
        registry,
        call([{ content: "feb 30", recurrence: { cron: "0 9 30 2 *", enabled: true } }]),
      )
      expect(feb30.status).toBe("error")
      expect(feb30.error?.message).toBe(
        'task_schedule: recurrence cron "0 9 30 2 *" is invalid or has no future run; refusing to persist a dead job',
      )
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a disabled recurrence without a scheduledAt fallback (dead job)", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const result = yield* executeTool(
        registry,
        call([{ content: "never runs", recurrence: { cron: "0 3 * * *", enabled: false } }]),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe(
        "task_schedule: recurrence is disabled and scheduledAt is unset; a job without a trigger can never run",
      )
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects pause/resume/remove without an existing task id", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskScheduleTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const pause = yield* executeTool(registry, call([{ action: "pause" }]))
      expect(pause.error?.message).toBe("task_schedule: pause requires the id of an existing task")
      const resume = yield* executeTool(registry, call([{ action: "resume" }]))
      expect(resume.error?.message).toBe("task_schedule: resume requires the id of an existing task")
      const remove = yield* executeTool(registry, call([{ action: "remove" }]))
      expect(remove.error?.message).toBe("task_schedule: remove requires the id of an existing task")
      expect(yield* tasks.get(sessionID)).toHaveLength(0)
    }),
  )
})
