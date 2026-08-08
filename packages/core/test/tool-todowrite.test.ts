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
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { TodoWriteTool } from "@aigcfroge/core/tool/todowrite"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const tool = TodoWriteTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(permission),
  Layer.provide(SessionTodo.defaultLayer),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionTask.defaultLayer,
    SessionTodo.defaultLayer,
    permission,
    registry,
    tool,
  ),
)

// Every test uses its own session: SessionTodo's optimistic-concurrency
// baseline is process-level (keyed by sessionID) and shared across the fresh
// per-test databases in this file.
const setup = (sessionID: SessionV2.ID) =>
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

const call = (sessionID: SessionV2.ID, todos: ReadonlyArray<SessionTodo.WriteItem>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input: { todos } },
})

describe("TodoWriteTool", () => {
  it.effect("registers, approves the wildcard resource, persists todos, and returns typed output", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_todowrite_tool_basic")
      yield* setup(sessionID)
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList = [{ content: "Implement slice", status: "in_progress", priority: "high" }] as const

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TodoWriteTool.name])
      expect(yield* settleTool(registry, call(sessionID, [...todoList]))).toEqual({
        result: { type: "text", value: JSON.stringify(todoList, null, 2) },
        output: {
          structured: { todos: [...todoList] },
          content: [{ type: "text", text: JSON.stringify(todoList, null, 2) }],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
      expect(yield* service.get(sessionID)).toEqual([...todoList])
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_todowrite_tool_denied")
      yield* setup(sessionID)
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      yield* service.update({ sessionID, todos: [{ content: "keep", status: "pending", priority: "low" }] })
      deny = true

      const result = yield* executeTool(
        registry,
        call(sessionID, [{ content: "blocked", status: "completed", priority: "high" }]),
      )
      expect(result.type).toBe("error")
      // The permission denial keeps its own message instead of degrading to
      // the generic tool failure.
      expect(result.type === "error" && result.value).toContain("PermissionV2.DeniedError")
      expect(yield* service.get(sessionID)).toEqual([{ content: "keep", status: "pending", priority: "low" }])
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
    }),
  )

  it.effect("rejects an invalid status at the input schema boundary", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_todowrite_tool_schema")
      yield* setup(sessionID)
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service

      const result = yield* executeTool(
        registry,
        // 类型负测试：绕过 WriteItem 类型模拟模型发出坏值，验证 schema 边界拒绝。
        // oxlint-disable-next-line no-unsafe-type-assertion -- documented negative test per AGENTS.md
        call(sessionID, [{ content: "x", status: "bogus", priority: "high" }] as unknown as SessionTodo.WriteItem[]),
      )
      expect(result.type).toBe("error")
      expect(result.type === "error" && result.value).toContain("Invalid tool input")
      expect(yield* service.get(sessionID)).toEqual([])
    }),
  )

  it.effect("a stale write fails with the current server list and the merged retry succeeds", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_todowrite_tool_stale")
      yield* setup(sessionID)
      const registry = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const service = yield* SessionTodo.Service

      // First write establishes the baseline.
      expect(
        (yield* executeTool(registry, call(sessionID, [{ content: "a", status: "pending", priority: "low" }]))).type,
      ).toBe("text")
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
      expect(stale.type).toBe("error")
      if (stale.type !== "error") throw new Error("expected a tool error")
      expect(stale.value).toContain("stale")
      expect(stale.value).toContain("server")
      expect((yield* service.get(sessionID)).map((todo) => todo.content)).toEqual(["a", "server"])

      // The merged retry lands and the output is the reconciled server state
      // (the appended row keeps its position and content).
      const merged = [
        { content: "a", status: "completed", priority: "low" },
        { content: "server", status: "in_progress", priority: "high" },
      ] as const
      const retry = yield* settleTool(registry, call(sessionID, [...merged]))
      expect(retry.result).toEqual({ type: "text", value: JSON.stringify([...merged], null, 2) })
      expect(retry.output?.structured).toEqual({ todos: [...merged] })
      expect(yield* service.get(sessionID)).toEqual([...merged])
    }),
  )
})
