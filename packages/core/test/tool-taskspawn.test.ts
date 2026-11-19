import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Database } from "@aigcfroge/core/database/database"
import { Image } from "@aigcfroge/core/image"
import { Permission } from "@aigcfroge/core/permission"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Tool } from "@aigcfroge/core/tool"
import { TaskSpawnTool } from "@aigcfroge/core/tool/taskspawn"
import { Bus } from "@aigcfroge/core/bus"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_taskspawn_tool_test")
const assertions: Permission.AssertInput[] = []

const permission = permissionLayer({
  assert: (input) => Effect.sync(() => assertions.push(input)),
})

const harness = Layer.mergeAll(
  AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node, SessionTask.node, Database.node, Bus.node]), [
    Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
  ]),
  permission,
)

const it = testEffect(harness)

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
      yield* registerToolPlugin(TaskSpawnTool.Plugin)
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(TaskSpawnTool.name)
    }),
  )

  it.effect("asserts permission and records spawnedFrom = messageID on the spawned task", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskSpawnTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service

      const result = yield* executeTool(
        registry,
        call([{ content: "restock analysis", priority: "high", dependsOn: ["tsk_pred_a"], agentID: "auditor" }]),
      )
      expect(result.status).toBe("completed")
      // The permission assertion carries the tool's action/resource/save plus the
      // calling session, agent, and the tool call source for auditability.
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: TaskSpawnTool.name,
          resources: ["*"],
          save: ["*"],
          agent: toolIdentity.agent,
          source: { type: "tool", messageID: toolIdentity.messageID, id: "call-taskspawn" },
        },
      ])

      const persisted = yield* tasks.get(sessionID)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({
        content: "restock analysis",
        status: "pending",
        priority: "high",
        spawnedFrom: toolIdentity.messageID,
        dependsOn: ["tsk_pred_a"],
        agentID: "auditor",
      })
    }),
  )

  it.effect("maps a TaskWriteError to a ToolFailure carrying the TaskWriteError message", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskSpawnTool.Plugin)
      const registry = yield* Tool.Service
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

      const result = yield* executeTool(registry, call([{ content: "c" }]))
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("introduces a dependency cycle")
    }),
  )
})
