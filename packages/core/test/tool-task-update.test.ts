/**
 * `task_update` tool contract (M1.5 D3): the incremental single-task update
 * tool must carry `outputDigest` through to the `output_digest` column (Work
 * ProgressLedger step summaries) without breaking callers that omit it.
 *
 * @see packages/core/src/tool/task-update.ts
 * @see packages/core/src/session/task.ts (updateTask)
 */

import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { TaskUpdateTool } from "@aigcfroge/core/tool/task-update"
import { testEffect } from "./lib/effect"
import { settleTool, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_task_update_tool_test")

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    effectiveRules: () => Effect.succeed([]),
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const registry = ToolRegistry.defaultLayer
const tool = TaskUpdateTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(SessionTask.defaultLayer),
  Layer.provide(permission),
)

const it = testEffect(
  Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionTask.defaultLayer, registry, tool, permission),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "task-update-tool",
      directory: "/project",
      title: "task-update-tool",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const tasks = yield* SessionTask.Service
  const [task] = yield* tasks.update({
    sessionID,
    tasks: [{ content: "seed", status: "pending", priority: "medium" }],
  })
  return task
})

const listen = Effect.gen(function* () {
  const events = yield* EventV2.Service
  const published = new Array<EventV2.Payload>()
  const unsubscribe = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === SessionTask.Event.Updated.type) published.push(event)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return published
})

const eventData = (published: EventV2.Payload[], index = -1) => {
  const event = index === -1 ? published.at(-1) : published[index]
  return event === undefined ? undefined : Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(event.data)
}

describe("TaskUpdateTool", () => {
  it.effect("persists outputDigest to the output_digest column and rides the task.updated event", () =>
    Effect.gen(function* () {
      yield* setup
      const published = yield* listen
      const registry = yield* ToolRegistry.Service
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-task-update",
          name: "task_update",
          input: { id: task.id, content: "clarify", outputDigest: "已确认主题/时长/平台" },
        },
      })
      expect(result.result.type).toBe("text")

      const row = yield* db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.id, task.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.output_digest).toBe("已确认主题/时长/平台")

      const latest = yield* tasks.get(sessionID)
      expect(latest[0]?.outputDigest).toBe("已确认主题/时长/平台")
      expect(latest[0]?.content).toBe("clarify")

      const data = eventData(published)
      expect(data?.tasks[0]?.outputDigest).toBe("已确认主题/时长/平台")
    }),
  )

  it.effect("omitting outputDigest leaves the existing digest untouched (backward compatible)", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-task-update-1",
          name: "task_update",
          input: { id: task.id, status: "completed", outputDigest: "step done" },
        },
      })
      // The status+outputDigest pair runs updateTask then patch, so the task
      // already advanced two revisions; re-read before the next update.
      const [mid] = yield* tasks.get(sessionID)
      yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-task-update-2",
          name: "task_update",
          input: { id: task.id, content: "renamed", expectedRevision: mid?.revision },
        },
      })

      const [after] = yield* tasks.get(sessionID)
      expect(after?.content).toBe("renamed")
      expect(after?.outputDigest).toBe("step done")
    }),
  )

  it.effect("outputDigest alone counts as a field update and writes without status", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-task-update-3",
          name: "task_update",
          input: { id: task.id, outputDigest: "5 个分镜场景" },
        },
      })
      expect(result.result.type).toBe("text")

      const [after] = yield* tasks.get(sessionID)
      expect(after?.outputDigest).toBe("5 个分镜场景")
      expect(after?.status).toBe("pending")
    }),
  )
})
