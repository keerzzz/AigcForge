import { describe, expect, test } from "bun:test"
import { Schema, SchemaAST } from "effect"
import { DurableEventManifest } from "../src/durable-event-manifest.js"
import { EventManifest } from "../src/event-manifest.js"
import { Event } from "../src/event.js"
import { SessionID } from "../src/session-id.js"
import { SessionTask } from "../src/session-task.js"
import { SessionTaskEvent } from "../src/session-task-event.js"

const task = {
  id: "tsk_contract",
  sessionID: "ses_contract",
  content: "Review the implementation",
  status: "completed" as const,
  priority: "high" as const,
  parentID: "tsk_parent",
  outputDigest: "结果记录 🧪",
  agentID: "reviewer",
  scheduledAt: 42,
  recurrence: { cron: "0 9 * * *", timezone: "Asia/Shanghai", enabled: true },
  nextRun: 43,
  spawnedFrom: "msg_contract",
  dependsOn: ["tsk_previous"],
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
}

describe("Session Task event contract", () => {
  test("registers the current Task events and transitional todo projection once, without durable replay", () => {
    const definitions = [SessionTaskEvent.Updated, SessionTaskEvent.TodoUpdated, SessionTaskEvent.Progress]
    expect(SessionTaskEvent.Definitions.filter((definition) => definition.durability === "ephemeral")).toEqual(
      definitions,
    )
    definitions.forEach((definition) => {
      expect(definition.durability).toBe("ephemeral")
      expect(definition.durable).toBeUndefined()
      expect(EventManifest.ServerDefinitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Definitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Server.get(definition.type)).toBe(definition)
      expect(EventManifest.Latest.get(definition.type)).toBe(definition)
      expect(EventManifest.isServer({ type: definition.type })).toBe(true)
      expect(Array.from(DurableEventManifest.Durable.values()).some((item) => item.type === definition.type)).toBe(
        false,
      )
      expect(SchemaAST.resolveIdentifier(definition.ast)).toBe(definition.type)
      expect(SchemaAST.resolveIdentifier(Schema.toEncoded(definition).ast)).toBe(definition.type)
    })
    expect(EventManifest.Server.has("work.step_resumed")).toBe(false)
  })

  test("registers operation reservations and changes as canonical durable Session events", () => {
    const definitions = [SessionTaskEvent.OperationReserved, SessionTaskEvent.OperationChanged] as const
    expect(SessionTaskEvent.DurableDefinitions).toEqual(definitions)
    expect(SessionTaskEvent.Definitions).toEqual([
      SessionTaskEvent.Updated,
      SessionTaskEvent.TodoUpdated,
      SessionTaskEvent.Progress,
      ...definitions,
    ])
    definitions.forEach((definition) => {
      expect(definition.durability).toBe("durable")
      expect(definition.durable).toEqual({ version: 1, aggregate: "sessionID" })
      expect(EventManifest.ServerDefinitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Definitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Server.get(definition.type)).toBe(definition)
      expect(EventManifest.Latest.get(definition.type)).toBe(definition)
      expect(EventManifest.Durable.get(Event.versionedType(definition.type, definition.durable.version))).toBe(
        definition,
      )
      expect(DurableEventManifest.Durable.get(Event.versionedType(definition.type, definition.durable.version))).toBe(
        definition,
      )
      expect(EventManifest.isServer({ type: definition.type })).toBe(true)
    })
    expect(SessionTaskEvent.OperationReserved.data.fields.request).toBe(SessionTask.OperationRequest)
    expect(SessionTaskEvent.OperationReserved.data.fields.source).toBe(SessionTask.OperationSource)
    expect(SessionTaskEvent.OperationReserved.data.fields.selection).toBe(SessionTask.OperationSelection)
    expect(SessionTaskEvent.OperationChanged.data.fields.change).toBe(SessionTask.OperationChange)
  })

  test("uses the canonical Task row and Session scope schemas", () => {
    expect(SessionTaskEvent.Updated.data.fields.tasks.value).toBe(SessionTask.Info)
    expect(SessionTaskEvent.TodoUpdated.data.fields.todos.value).toBe(SessionTaskEvent.TodoProjection)
    expect(SessionTaskEvent.Updated.data.fields.sessionID).toBe(SessionID)
    expect(SessionTaskEvent.TodoUpdated.data.fields.sessionID).toBe(SessionID)
    expect(SessionTaskEvent.Progress.data.fields.sessionID).toBe(SessionID)
    expect(SessionTaskEvent.Progress.data.fields.phase).toBe(SessionTaskEvent.TaskExecutionPhase)
  })

  test("round-trips every persisted Task field in the original snapshot envelope", () => {
    const envelope = {
      id: "evt_task_contract",
      type: SessionTaskEvent.Updated.type,
      created: 1,
      data: { sessionID: task.sessionID, tasks: [task] },
    }
    const decoded = Schema.decodeUnknownSync(SessionTaskEvent.Updated)(envelope)
    expect(decoded.data.tasks[0]).toBeInstanceOf(SessionTask.Info)
    expect(Schema.encodeSync(SessionTaskEvent.Updated)(decoded)).toEqual(envelope)
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTaskEvent.Updated))(decoded)).toEqual(envelope)
    expect(decoded).not.toHaveProperty("durable")
    const empty = { ...envelope, data: { sessionID: task.sessionID, tasks: [] } }
    expect(
      Schema.encodeSync(SessionTaskEvent.Updated)(Schema.decodeUnknownSync(SessionTaskEvent.Updated)(empty)),
    ).toEqual(empty)
  })

  test("omits undefined progress and envelope fields while retaining determinate progress", () => {
    const codec: Schema.Codec<unknown> = SessionTaskEvent.Progress
    const envelope = {
      id: "evt_progress_contract",
      type: "task.progress",
      created: 1,
      data: { sessionID: task.sessionID, taskID: task.id, phase: "waiting", updatedAt: 2 },
    }
    const decoded = Schema.decodeUnknownSync(Schema.toType(codec))({
      ...envelope,
      metadata: undefined,
      location: undefined,
      data: { ...envelope.data, progress: undefined, current: undefined, total: undefined },
    })
    expect(Schema.encodeSync(codec)(decoded)).toEqual(envelope)
    const defined = { ...envelope, data: { ...envelope.data, phase: "tool", progress: 0.5, current: 3, total: 6 } }
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(defined))).toEqual(defined)
    expect(Schema.encodeSync(Schema.toCodecJson(codec))(Schema.decodeUnknownSync(codec)(defined))).toEqual(defined)
  })

  test("retains the legacy three-field todo shape and its existing string vocabulary", () => {
    const data = {
      sessionID: task.sessionID,
      todos: [{ content: task.content, status: "legacy-status", priority: "legacy-priority" }],
    }
    const decoded = Schema.decodeUnknownSync(SessionTaskEvent.TodoUpdated.data)(data)
    expect(decoded.todos[0]).toBeInstanceOf(SessionTaskEvent.TodoProjection)
    expect(Schema.encodeSync(SessionTaskEvent.TodoUpdated.data)(decoded)).toEqual(data)
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTaskEvent.TodoUpdated.data))(decoded)).toEqual(data)
  })

  test("preserves Task field constraints and the runtime phase vocabulary", () => {
    ;[
      { ...task, status: "unknown" },
      { ...task, priority: "unknown" },
      { ...task, content: 1 },
      { ...task, revision: "3" },
    ].forEach((invalid) => {
      expect(() =>
        Schema.decodeUnknownSync(SessionTaskEvent.Updated.data)({ sessionID: task.sessionID, tasks: [invalid] }),
      ).toThrow()
    })
    expect(() =>
      Schema.decodeUnknownSync(SessionTaskEvent.Progress.data)({
        sessionID: task.sessionID,
        taskID: task.id,
        phase: "completed",
        updatedAt: 2,
      }),
    ).toThrow()
    ;(["thinking", "streaming", "tool", "waiting"] as const).forEach((phase) => {
      expect(Schema.decodeUnknownSync(SessionTaskEvent.TaskExecutionPhase)(phase)).toBe(phase)
    })
  })
})
