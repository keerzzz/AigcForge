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
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { Image } from "@omnixa/core/image"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionTable, TaskTable } from "@omnixa/core/session/sql"
import { SessionTask } from "@omnixa/core/session/task"
import { Tool } from "@omnixa/core/tool"
import { TaskUpdateTool } from "@omnixa/core/tool/task-update"
import { TaskDeleteTool } from "@omnixa/core/tool/task-delete"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import type { Event } from "@omnixa/schema/event"

const sessionID = Session.ID.make("ses_task_update_tool_test")

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
  yield* tasks.update({
    sessionID,
    tasks: [{ content: "seed", status: "pending", priority: "medium" }],
  })
})

const listen = Effect.gen(function* () {
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

const eventData = (published: ReadonlyArray<Event.Payload>, index = -1) => {
  const event = published.filter((entry) => entry.type === SessionTask.Event.Updated.type).at(index)
  return event === undefined ? undefined : Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(event.data)
}

const executeUpdate = (registry: Tool.Interface, options: { id: string; input: Record<string, unknown> }) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call" as const, id: options.id, name: TaskUpdateTool.name, input: options.input },
  })

describe("TaskUpdateTool", () => {
  it.effect("rejects completing a report while its declared worker is unfinished without partial edits", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [worker] = yield* tasks.get(sessionID)
      const report = (yield* tasks.append({
        sessionID,
        tasks: [{ content: "collect results", status: "in_progress", priority: "medium", dependsOn: [worker.id] }],
      })).at(-1)
      if (!report) throw new Error("Expected report task")
      const before = yield* tasks.get(sessionID)
      const published = yield* listen
      const result = yield* executeUpdate(registry, {
        id: "call-premature-report",
        input: { id: report.id, status: "completed", outputDigest: "all done", expectedRevision: report.revision },
      })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain(worker.id)
      expect(yield* tasks.get(sessionID)).toEqual(before)
      expect(published).toEqual([])
      yield* tasks.patch({ sessionID, id: worker.id, status: "failed" })
      const finished = yield* executeUpdate(registry, {
        id: "call-terminal-report",
        input: { id: report.id, status: "completed", expectedRevision: report.revision },
      })
      expect(finished.status).toBe("completed")
    }),
  )

  for (const mutation of ["update", "replaceLegacy", "patch"] as const) {
    it.effect(`checks declared cross-session dependencies through ${mutation}`, () =>
      Effect.gen(function* () {
        yield* setup
        const tasks = yield* SessionTask.Service
        const database = yield* Database.Service
        const externalSessionID = Session.ID.make("ses_task_dependency_external")
        yield* database.db
          .insert(SessionTable)
          .values({
            id: externalSessionID,
            project_id: Project.ID.global,
            slug: "dependency-worker",
            directory: "/project",
            title: "dependency-worker",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        const [worker] = yield* tasks.append({
          sessionID: externalSessionID,
          tasks: [{ content: "external worker", status: "in_progress", priority: "medium" }],
        })
        const [report] = yield* tasks.update({
          sessionID,
          tasks: [{ content: "report", status: "pending", priority: "medium", dependsOn: [worker.id] }],
        })
        const complete =
          mutation === "patch"
            ? tasks.patch({ sessionID, id: report.id, status: "completed" }).pipe(Effect.asVoid)
            : tasks[mutation]({ sessionID, tasks: [{ ...report, status: "completed" }] }).pipe(Effect.asVoid)
        const published = yield* listen
        const rejected = yield* complete.pipe(Effect.flip)
        expect(rejected.message).toContain(worker.id)
        expect(yield* tasks.get(sessionID)).toEqual([report])
        expect(published).toEqual([])
        yield* tasks.patch({ sessionID: externalSessionID, id: worker.id, status: "cancelled" })
        yield* complete
        expect((yield* tasks.get(sessionID))[0].status).toBe("completed")
      }),
    )
  }

  it.effect("rejects a batch that completes a dependency chain ahead of its last worker", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [worker] = yield* tasks.get(sessionID)
      const middle = (yield* tasks.append({
        sessionID,
        tasks: [{ content: "middle", status: "pending", priority: "medium", dependsOn: [worker.id] }],
      })).at(-1)
      if (!middle) throw new Error("Expected middle task")
      const before = yield* tasks.append({
        sessionID,
        tasks: [{ content: "report", status: "pending", priority: "medium", dependsOn: [middle.id] }],
      })
      const error = yield* tasks
        .update({
          sessionID,
          tasks: before.map((task) => ({ ...task, status: task.id === worker.id ? task.status : "completed" })),
        })
        .pipe(Effect.flip)
      expect(error.message).toContain(worker.id)
      expect(yield* tasks.get(sessionID)).toEqual(before)
      yield* tasks.update({ sessionID, tasks: before.map((task) => ({ ...task, status: "completed" })) })
      expect((yield* tasks.get(sessionID)).every((task) => task.status === "completed")).toBe(true)
    }),
  )

  it.effect("checks new dependencies added to a completed task and preserves ordinary history edits", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const [worker] = yield* tasks.get(sessionID)
      const before = yield* tasks.append({
        sessionID,
        tasks: [{ content: "completed report", status: "completed", priority: "medium" }],
      })
      const report = before[1]
      const rejected = yield* tasks
        .update({
          sessionID,
          tasks: [worker, { ...report, dependsOn: [worker.id] }],
        })
        .pipe(Effect.flip)
      expect(rejected.message).toContain(worker.id)
      expect(yield* tasks.get(sessionID)).toEqual(before)
      yield* tasks.patch({ sessionID, id: worker.id, status: "completed" })
      const admitted = yield* tasks.update({
        sessionID,
        tasks: [
          { ...worker, status: "completed" },
          { ...report, dependsOn: [worker.id] },
        ],
      })
      yield* tasks.patch({ sessionID, id: worker.id, status: "pending" })
      yield* tasks.update({ sessionID, tasks: [worker, { ...admitted[1], content: "edit historical report" }] })
      expect((yield* tasks.get(sessionID))[1].content).toBe("edit historical report")
    }),
  )

  it.effect("automatic update and delete return the owned execution conflict through the real registry", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      yield* registerToolPlugin(TaskDeleteTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)
      const claimed = yield* tasks.patch(
        { sessionID, id: task.id, status: "in_progress", expectedRevision: task.revision },
        {
          claim: { type: "tool", messageID: toolIdentity.messageID, id: "call-real-worker" },
        },
      )
      if (!claimed) return yield* Effect.die(new Error("Expected the running Task claim to land"))
      const published = yield* listen
      const update = yield* executeUpdate(registry, {
        id: "call-automatic-update",
        input: { id: task.id, content: "overwrite running worker", status: "completed" },
      })
      expect(update.status).toBe("error")
      expect(update.error?.message).toContain("owned by unsettled execution")
      const deleted = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-automatic-delete", name: TaskDeleteTool.name, input: { id: task.id } },
      })
      expect(deleted.status).toBe("error")
      expect(deleted.error?.message).toContain("owned by unsettled execution")
      expect(yield* tasks.get(sessionID)).toEqual([claimed])
      expect(published).toEqual([])
    }),
  )

  it.effect("updates status and fields atomically with one revision and one pair of events", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)
      const published = yield* listen

      const result = yield* executeUpdate(registry, {
        id: "call-task-update-combined",
        input: {
          id: task.id,
          status: "completed",
          content: "reviewed",
          priority: "high",
          outputDigest: "audit passed",
          expectedRevision: task.revision,
        },
      })
      expect(result.status).toBe("completed")
      const output = Schema.decodeUnknownSync(TaskUpdateTool.Output)(result.output)
      expect(output.task).toMatchObject({
        id: task.id,
        status: "completed",
        content: "reviewed",
        priority: "high",
        outputDigest: "audit passed",
        revision: task.revision + 1,
      })
      expect(yield* tasks.get(sessionID)).toEqual([output.task])
      const row = yield* database.db.select().from(TaskTable).where(eq(TaskTable.id, task.id)).get().pipe(Effect.orDie)
      expect(row).toMatchObject({
        id: task.id,
        status: "completed",
        content: "reviewed",
        priority: "high",
        output_digest: "audit passed",
        revision: task.revision + 1,
      })
      expect(published.map((event) => event.type)).toEqual([
        SessionTask.Event.Updated.type,
        SessionTask.Event.TodoUpdated.type,
      ])
      expect(eventData(published)).toEqual({ sessionID, tasks: [output.task] })
      expect(Schema.decodeUnknownSync(SessionTask.Event.TodoUpdated.data)(published[1]?.data)).toEqual({
        sessionID,
        todos: [{ content: "reviewed", status: "completed", priority: "high" }],
      })
    }),
  )

  it.effect("an invalid scheduled combination returns a tool error without partial writes or events", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [seed] = yield* tasks.get(sessionID)
      yield* tasks.patch({ sessionID, id: seed.id, status: "in_progress", outputDigest: "saved audit" })
      const before = yield* tasks.get(sessionID)
      const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
      const published = yield* listen

      const result = yield* executeUpdate(registry, {
        id: "call-task-update-invalid-schedule",
        input: {
          id: seed.id,
          status: "scheduled",
          content: "must not land",
          priority: "high",
          outputDigest: "must not replace saved audit",
          expectedRevision: before[0]?.revision,
        },
      })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("must have a scheduledAt or an enabled recurrence")
      expect(yield* tasks.get(sessionID)).toEqual(before)
      expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
      expect(published).toEqual([])
    }),
  )

  it.effect("a stale status and fields combination returns a tool error without writes or events", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [seed] = yield* tasks.get(sessionID)
      yield* tasks.patch({ sessionID, id: seed.id, status: "in_progress", outputDigest: "current audit" })
      const before = yield* tasks.get(sessionID)
      const rows = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
      const published = yield* listen

      const result = yield* executeUpdate(registry, {
        id: "call-task-update-stale-combination",
        input: {
          id: seed.id,
          status: "completed",
          content: "stale rename",
          priority: "high",
          outputDigest: "stale audit",
          expectedRevision: seed.revision,
        },
      })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("revision is stale")
      expect(yield* tasks.get(sessionID)).toEqual(before)
      expect(yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)).toEqual(rows)
      expect(published).toEqual([])
    }),
  )

  it.effect("persists outputDigest to the output_digest column and rides the task.updated event", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const published = yield* listen
      const registry = yield* Tool.Service
      const { db } = yield* Database.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      const result = yield* executeUpdate(registry, {
        id: "call-task-update",
        input: { id: task.id, content: "clarify", outputDigest: "已确认主题/时长/平台" },
      })
      expect(result.status).toBe("completed")

      const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, task.id)).get().pipe(Effect.orDie)
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
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      yield* executeUpdate(registry, {
        id: "call-task-update-1",
        input: { id: task.id, status: "completed", outputDigest: "step done" },
      })
      // The status and digest share one write; the next edit observes revision 2.
      const [mid] = yield* tasks.get(sessionID)
      expect(mid?.revision).toBe(task.revision + 1)
      expect(mid?.status).toBe("completed")
      yield* executeUpdate(registry, {
        id: "call-task-update-2",
        input: { id: task.id, content: "renamed", expectedRevision: mid?.revision },
      })

      const [after] = yield* tasks.get(sessionID)
      expect(after?.content).toBe("renamed")
      expect(after?.outputDigest).toBe("step done")
      expect(after?.revision).toBe(task.revision + 2)
    }),
  )

  it.effect("outputDigest alone counts as a field update and writes without status", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerToolPlugin(TaskUpdateTool.Plugin)
      const registry = yield* Tool.Service
      const tasks = yield* SessionTask.Service
      const [task] = yield* tasks.get(sessionID)

      const result = yield* executeUpdate(registry, {
        id: "call-task-update-3",
        input: { id: task.id, outputDigest: "5 个分镜场景" },
      })
      expect(result.status).toBe("completed")

      const [after] = yield* tasks.get(sessionID)
      expect(after?.outputDigest).toBe("5 个分镜场景")
      expect(after?.status).toBe("pending")
    }),
  )
})
