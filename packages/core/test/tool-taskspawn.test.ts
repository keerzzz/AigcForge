import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskSpawnTool } from "@aigcfroge/core/tool/taskspawn"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolIdentity, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_taskspawn_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    effectiveRules: () => Effect.succeed([]),
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const tool = TaskSpawnTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(permission),
  Layer.provide(SessionTask.defaultLayer),
)
const it = testEffect(
  Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionTask.defaultLayer, permission, registry, tool),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
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
      slug: "taskspawn",
      directory: "/project",
      title: "taskspawn",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (tasks: ReadonlyArray<Record<string, unknown>>, id = "call-taskspawn") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TaskSpawnTool.name, input: { tasks } },
})

describe("task_spawn tool", () => {
  it.effect("registers the task_spawn tool in the registry", () =>
    Effect.gen(function* () {
      const reg = yield* ToolRegistry.Service
      expect((yield* toolDefinitions(reg)).map((tool) => tool.name)).toEqual([TaskSpawnTool.name])
    }),
  )

  it.effect("asserts permission and records spawnedFrom = assistantMessageID on the spawned task", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service

      const settlement = yield* settleTool(
        reg,
        call([{ content: "restock analysis", priority: "high", dependsOn: ["tsk_pred_a"], agentID: "auditor" }]),
      )
      expect(settlement.result.type).toBe("text")
      // The permission assertion carries the tool's action/resource/save plus the
      // calling session, agent, and the tool call source for auditability.
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: TaskSpawnTool.name,
          resources: ["*"],
          save: ["*"],
          agent: toolIdentity.agent,
          source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call-taskspawn" },
        },
      ])

      const persisted = yield* tasks.get(sessionID)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({
        content: "restock analysis",
        status: "pending",
        priority: "high",
        spawnedFrom: toolIdentity.assistantMessageID,
        dependsOn: ["tsk_pred_a"],
        agentID: "auditor",
      })
    }),
  )

  it.effect("maps a TaskWriteError to a ToolFailure carrying the TaskWriteError message", () =>
    Effect.gen(function* () {
      yield* setup
      const reg = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const { db } = yield* Database.Service
      const [a, b] = yield* tasks.append({
        sessionID,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
        ],
      })
      // Inject a cycle directly (bypassing the service guard) so the tool's
      // append hits the defensive depends_on_cycle rejection — proving the
      // TaskWriteError surfaces as a ToolFailure instead of an untyped defect.
      yield* db.update(TaskTable).set({ depends_on: [b.id] }).where(eq(TaskTable.id, a.id)).run()
      yield* db.update(TaskTable).set({ depends_on: [a.id] }).where(eq(TaskTable.id, b.id)).run()

      const result = yield* executeTool(reg, call([{ content: "c" }]))
      expect(result.type).toBe("error")
      if (result.type !== "error") return
      expect(result.value).toContain("introduces a dependency cycle")
    }),
  )
})
