import { describe, expect } from "bun:test"
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
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { Tool } from "@aigcfroge/core/tool"
import { TodoWriteTool } from "@aigcfroge/core/tool/todowrite"
import { Bus } from "@aigcfroge/core/bus"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const assertions: Permission.AssertInput[] = []
let deny = false

const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(
        deny
          ? Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }))
          : Effect.void,
      ),
    ),
})

const harness = Layer.mergeAll(
  AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node, SessionTodo.node, SessionTask.node, Database.node, Bus.node]), [
    Image.node.replace(Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) })),
  ]),
  permission,
)

const it = testEffect(harness)

// Every test uses its own session: SessionTodo's optimistic-concurrency
// baseline is process-level (keyed by sessionID) and shared across the fresh
// per-test databases in this file.
const setup = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    assertions.length = 0
    deny = false
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
        slug: "todowrite",
        directory: "/project",
        title: "todowrite",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
  })

const call = (sessionID: Session.ID, todos: ReadonlyArray<unknown>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input: { todos } },
})

describe("TodoWriteTool", () => {
  it.effect("registers, approves the wildcard resource, persists todos, and returns typed output", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_todowrite_tool_basic")
      yield* setup(sessionID)
      yield* registerToolPlugin(TodoWriteTool.Plugin)
      const registry = yield* Tool.Service
      const service = yield* SessionTodo.Service
      const todoList = [{ content: "Implement slice", status: "in_progress", priority: "high" }] as const

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(TodoWriteTool.name)
      const result = yield* executeTool(registry, call(sessionID, [...todoList]))
      expect(result.status).toBe("completed")
      expect(result.output).toEqual({ todos: [...todoList] })
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify([...todoList], null, 2) }])
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
      expect(yield* service.get(sessionID)).toEqual([...todoList])
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_todowrite_tool_denied")
      yield* setup(sessionID)
      const service = yield* SessionTodo.Service
      yield* service.update({ sessionID, todos: [{ content: "keep", status: "pending", priority: "low" }] })
      deny = true
      yield* registerToolPlugin(TodoWriteTool.Plugin)
      const registry = yield* Tool.Service

      const result = yield* executeTool(
        registry,
        call(sessionID, [{ content: "blocked", status: "completed", priority: "high" }]),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("Permission denied: todowrite")
      expect(yield* service.get(sessionID)).toEqual([{ content: "keep", status: "pending", priority: "low" }])
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
    }),
  )

  it.effect("rejects an invalid status at the input schema boundary", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_todowrite_tool_schema")
      yield* setup(sessionID)
      yield* registerToolPlugin(TodoWriteTool.Plugin)
      const registry = yield* Tool.Service
      const service = yield* SessionTodo.Service

      // 类型负测试：绕过 WriteItem 类型模拟模型发出坏值，验证 schema 边界拒绝。
      const result = yield* executeTool(
        registry,
        call(sessionID, [{ content: "x", status: "bogus", priority: "high" }]),
      )
      expect(result.status).toBe("error")
      expect(yield* service.get(sessionID)).toEqual([])
    }),
  )

  it.effect("a stale write fails with the current server list and the merged retry succeeds", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_todowrite_tool_stale")
      yield* setup(sessionID)
      yield* registerToolPlugin(TodoWriteTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const service = yield* SessionTodo.Service

      // First write establishes the baseline.
      const first = yield* executeTool(registry, call(sessionID, [{ content: "a", status: "pending", priority: "low" }]))
      expect(first.status).toBe("completed")
      // Another write path appends a row the model's list doesn't know about.
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "server", status: "in_progress", priority: "high" }],
      })

      // The stale full-list replace is rejected; the error carries the current
      // server-side list so the model can merge and retry.
      const stale = yield* executeTool(
        registry,
        call(sessionID, [{ content: "a", status: "completed", priority: "low" }]),
      )
      expect(stale.status).toBe("error")
      expect(stale.error?.message).toContain("changed since the caller last read it")
      expect(stale.error?.message).toContain("Current server-side todo list")
      expect(stale.error?.message).toContain("server")
      expect((yield* service.get(sessionID)).map((todo) => todo.content)).toEqual(["a", "server"])

      // The merged retry lands and the output is the reconciled server state
      // (the appended row keeps its position and content).
      const merged = [
        { content: "a", status: "completed", priority: "low" },
        { content: "server", status: "in_progress", priority: "high" },
      ] as const
      const retry = yield* executeTool(registry, call(sessionID, [...merged], "call-todowrite-retry"))
      expect(retry.status).toBe("completed")
      expect(retry.output).toEqual({ todos: [...merged] })
      expect(yield* service.get(sessionID)).toEqual([...merged])
    }),
  )
})
