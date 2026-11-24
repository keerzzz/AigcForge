import { describe, expect } from "bun:test"
import path from "node:path"
import { asc, eq } from "drizzle-orm"
import { Message, ToolResultPart } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { EventTable } from "@omnixa/core/event/sql"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionMessage } from "@omnixa/core/session/message"
import { SessionNotification } from "@omnixa/core/session/notification"
import { SessionProjector } from "@omnixa/core/session/projector"
import { SessionStore } from "@omnixa/core/session/store"
import { SessionTask } from "@omnixa/core/session/task"
import { TaskOperation } from "@omnixa/core/session/task-operation"
import { TaskOperationTable } from "@omnixa/core/session/sql"
import { TaskTool } from "@omnixa/core/tool/plugin/task"
import { ReadTool } from "@omnixa/core/tool/plugin/read"
import { Event } from "@omnixa/schema/event"
import { SessionTaskEvent } from "@omnixa/schema/session-task-event"
import { Agent } from "@omnixa/schema/agent"
import { Model } from "@omnixa/schema/model"
import { Provider } from "@omnixa/schema/provider"
import { FSUtil } from "@omnixa/util/fs-util"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionInbox.node,
      SessionProjector.node,
      SessionStore.node,
      SessionTask.node,
      FSUtil.node,
    ]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const setup = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  const store = yield* SessionStore.Service
  const input = { sessionID: Session.ID.make("ses_notification"), inboxID: SessionMessage.ID.make("msg_notification") }
  const directory = AbsolutePath.make("/project")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* bus.publish(SessionEvent.Created, {
    sessionID: input.sessionID,
    projectID: Project.ID.global,
    location: { directory },
    slug: "notification",
    version: "test",
  })
  const inspect = () => SessionNotification.inspect(database.db, bus, store, input)
  const admit = () =>
    inbox.admit({
      id: input.inboxID,
      sessionID: input.sessionID,
      item: {
        type: "synthetic",
        payload: SessionInbox.SyntheticPayload.make({ text: "Notification", metadata: { source: "test" } }),
        delivery: SessionInbox.Delivery.make("steer"),
      },
    })
  return { database, bus, inbox, store, input, inspect, admit }
})

const operationFixture = Effect.fnUntraced(function* (seed: Effect.Success<ReturnType<typeof setup>>) {
  const tasks = yield* SessionTask.Service
  const fs = yield* FSUtil.Service
  const sourceMessageID = SessionMessage.ID.create()
  const inputID = SessionMessage.ID.create()
  const operationID = SessionTask.OperationID.create()
  const targetSessionID = Session.ID.create()
  const model = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
  const source = SessionTask.OperationToolSource.make({
    type: "model_tool",
    sessionID: seed.input.sessionID,
    agent: Agent.ID.make("meta"),
    messageID: sourceMessageID,
    id: "task_call",
  })
  yield* seed.bus.publish(SessionEvent.Step.Started, {
    sessionID: seed.input.sessionID,
    assistantMessageID: sourceMessageID,
    agent: Agent.ID.make("meta"),
    model,
    started: 1,
  })
  yield* seed.bus.publish(SessionEvent.Tool.Input.Started, {
    sessionID: seed.input.sessionID,
    assistantMessageID: sourceMessageID,
    id: source.id,
    name: "task",
  })
  yield* seed.bus.publish(SessionEvent.Tool.Input.Ended, {
    sessionID: seed.input.sessionID,
    assistantMessageID: sourceMessageID,
    id: source.id,
    text: "{}",
  })
  yield* seed.bus.publish(SessionEvent.Tool.Called, {
    sessionID: seed.input.sessionID,
    assistantMessageID: sourceMessageID,
    id: source.id,
    input: {},
    executed: false,
  })
  yield* seed.bus.publish(SessionTaskEvent.OperationReserved, {
    sessionID: seed.input.sessionID,
    source,
    sourceLocation: { directory: AbsolutePath.make("/project") },
    sourceMode: "coding",
    targetSessionID,
    selection: SessionTask.OperationSelection.make({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }),
    request: SessionTask.OperationRequest.make({
      operationID,
      inputID,
      target: { type: "existing_root", sessionID: targetSessionID },
      prompt: "worker",
      delivery: "queue",
      resume: false,
      files: undefined,
      background: false,
    }),
  })
  const ref = { sessionID: seed.input.sessionID, operationID }
  yield* tasks.advanceOperation({
    ...ref,
    change: SessionTask.OperationChange.make({
      phase: "settled",
      result: SessionTask.OperationResultRef.make({
        sessionID: targetSessionID,
        inputID,
        text: "complete worker result",
        digest: SessionTask.OperationDigest.make("a".repeat(64)),
      }),
    }),
  })
  const operation = yield* tasks.operation(ref)
  if (!operation) return yield* Effect.die(new Error("missing operation"))
  const text = JSON.stringify(
    Schema.encodeSync(TaskTool.OperationOutput)({
      kind: "operation",
      operation,
      operationRef: SessionTask.OperationReadonlyRef.make({ sourceSessionID: ref.sessionID, operationID }),
      status: operation.phase,
      output: operation.result?.text ?? "",
    }),
  )
  const started = Effect.fnUntraced(function* (time: number, assistantMessageID = SessionMessage.ID.create()) {
    const event = yield* seed.bus.publish(SessionEvent.Step.Started, {
      sessionID: seed.input.sessionID,
      assistantMessageID,
      agent: Agent.ID.make("meta"),
      model,
      started: time,
    })
    return { event, assistantMessageID, started: time }
  })
  const observe = (consumer: Effect.Success<ReturnType<typeof started>>, messages: ReadonlyArray<Message>) =>
    SessionNotification.observeConsumption(seed.database.db, tasks, fs, {
      sessionID: seed.input.sessionID,
      assistantMessageID: consumer.assistantMessageID,
      started: consumer.started,
      messages,
    })
  const produce = (content: string, metadata: Record<string, unknown> = {}) =>
    seed.bus.publish(SessionEvent.Tool.Success, {
      sessionID: seed.input.sessionID,
      assistantMessageID: sourceMessageID,
      id: source.id,
      executed: false,
      content: [{ type: "text", text: content }],
      metadata: { operationRef: { sourceSessionID: ref.sessionID, operationID }, ...metadata },
    })
  const resultDigest = operation.result?.digest
  if (resultDigest === undefined) return yield* Effect.die(new Error("The fixture result has no digest"))
  return { tasks, fs, ref, operation, resultDigest, text, started, observe, produce, source, model }
})

describe("Session notification lifecycle", () => {
  it.effect("admits a missing marker and preserves the wake of its durable pending input", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      expect(yield* seed.inspect()).toEqual({ admit: true, wake: true })
      yield* seed.admit()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: true })
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: true })
      expect(yield* SessionInbox.list(seed.database.db, seed.input.sessionID)).toHaveLength(1)
    }),
  )

  it.effect("keeps a promoted notification from being admitted or woken again", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.admit()
      yield* seed.bus.publish(SessionEvent.InboxDelivered, seed.input)
      expect(yield* seed.store.message(seed.input.inboxID)).toBeDefined()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
    }),
  )

  it.effect("does not resurrect a notification that was explicitly cancelled", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.admit()
      yield* seed.inbox.cancel({ sessionID: seed.input.sessionID, id: seed.input.inboxID })
      expect(yield* SessionInbox.find(seed.database.db, seed.input.inboxID)).toBeUndefined()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
    }),
  )

  it.effect("scopes failure blocking to the notification's admission", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.bus.publish(SessionEvent.Execution.Failed, {
        sessionID: seed.input.sessionID,
        error: { type: "aborted", message: "Earlier execution failure" },
      })
      expect(yield* seed.inspect()).toEqual({ admit: true, wake: true })
      yield* seed.admit()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: true })
      yield* seed.bus.publish(SessionEvent.Execution.Failed, {
        sessionID: seed.input.sessionID,
        error: { type: "aborted", message: "Failure after notification admission" },
      })
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
      expect(yield* SessionInbox.find(seed.database.db, seed.input.inboxID)).toBeDefined()
    }),
  )

  it.effect("preserves a wake across shutdown and blocks it after deliberate interruption", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.admit()
      yield* seed.bus.publish(SessionEvent.Execution.Interrupted, {
        sessionID: seed.input.sessionID,
        reason: "shutdown",
      })
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: true })
      yield* seed.bus.publish(SessionEvent.Execution.Interrupted, { sessionID: seed.input.sessionID, reason: "user" })
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
    }),
  )

  it.effect("holds a notification behind staged revert and preserves its removal after commit", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.bus.publish(SessionEvent.Synthetic, { sessionID: seed.input.sessionID, text: "Revert boundary" })
      const boundary = (yield* seed.store.context(seed.input.sessionID)).find((message) => message.type === "synthetic")
      if (boundary === undefined) return yield* Effect.die(new Error("Revert boundary missing"))
      yield* seed.bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: seed.input.sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      expect(yield* seed.inspect()).toEqual({ admit: true, wake: false })
      yield* seed.admit()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
      yield* seed.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID: seed.input.sessionID, to: boundary.id })
      expect(yield* SessionInbox.find(seed.database.db, seed.input.inboxID)).toBeUndefined()
      expect(yield* seed.inspect()).toEqual({ admit: false, wake: false })
    }),
  )

  it.live("MP04 records exact foreground consumption once and rebuilds it from the original operation events", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const fixture = yield* operationFixture(seed)
      yield* fixture.produce(fixture.text, { truncated: false })
      const consumer = yield* fixture.started(2)
      const output = Message.tool(
        ToolResultPart.make({ id: fixture.source.id, name: "task", result: { type: "text", value: fixture.text } }),
      )
      yield* fixture.observe(consumer, [])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      yield* fixture.observe(consumer, [
        Message.tool(
          ToolResultPart.make({
            id: fixture.source.id,
            name: "task",
            result: { type: "text", value: "admission acknowledgement" },
          }),
        ),
      ])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      yield* fixture.observe(consumer, [output])
      yield* fixture.observe(consumer, [output])
      const saved = yield* fixture.tasks.operation(fixture.ref)
      if (!saved?.consumers?.[0]) return yield* Effect.die(new Error("The complete result was not consumed"))
      expect(saved.phase).toBe("settled")
      expect(saved?.consumers).toEqual([
        {
          consumerSessionID: seed.input.sessionID,
          assistantMessageID: consumer.assistantMessageID,
          eventID: consumer.event.id,
          resultDigest: fixture.resultDigest,
        },
      ])
      const next = yield* fixture.started(3, consumer.assistantMessageID)
      yield* fixture.observe(next, [output])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toHaveLength(2)
      const events = yield* seed.database.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, seed.input.sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* seed.database.db
        .delete(TaskOperationTable)
        .where(eq(TaskOperationTable.source_session_id, seed.input.sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        events,
        (event) => {
          if (
            event.type ===
            Event.versionedType(
              SessionTaskEvent.OperationReserved.type,
              SessionTaskEvent.OperationReserved.durable.version,
            )
          )
            return TaskOperation.projectReserved(
              seed.database.db,
              Schema.decodeUnknownSync(SessionTaskEvent.OperationReserved.data)(event.data),
              event.created,
              event.seq,
            )
          if (
            event.type ===
            Event.versionedType(
              SessionTaskEvent.OperationChanged.type,
              SessionTaskEvent.OperationChanged.durable.version,
            )
          )
            return TaskOperation.projectChanged(
              seed.database.db,
              Schema.decodeUnknownSync(SessionTaskEvent.OperationChanged.data)(event.data),
              event.created,
              event.seq,
            )
          return Effect.void
        },
        { discard: true },
      )
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toEqual([
        saved.consumers[0],
        {
          consumerSessionID: seed.input.sessionID,
          assistantMessageID: next.assistantMessageID,
          eventID: next.event.id,
          resultDigest: fixture.resultDigest,
        },
      ])
      return undefined
    }),
  )

  it.live("MP04 distinguishes notification admission and promotion from exact model consumption", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const fixture = yield* operationFixture(seed)
      const noticeID = TaskOperation.notificationID(fixture.ref)
      const text = `<task operation="${fixture.operation.operationID}" state="${fixture.operation.phase}">\n${fixture.operation.result?.text}\n</task>`
      yield* seed.inbox.admit({
        id: noticeID,
        sessionID: seed.input.sessionID,
        item: { type: "synthetic", delivery: "queue", payload: { text } },
      })
      const pending = yield* fixture.started(2)
      const notice = Message.make({ id: noticeID, role: "user", content: text })
      yield* fixture.observe(pending, [notice])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      yield* SessionInbox.promote(seed.database.db, seed.bus, seed.input.sessionID, "input", undefined, {
        anchorInputID: noticeID,
      })
      yield* fixture.observe(pending, [notice])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      const promoted = yield* fixture.started(3)
      yield* fixture.observe(promoted, [])
      yield* fixture.observe(promoted, [Message.make({ id: noticeID, role: "user", content: "result summary" })])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      yield* fixture.observe(promoted, [notice])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toEqual([
        {
          consumerSessionID: seed.input.sessionID,
          assistantMessageID: promoted.assistantMessageID,
          eventID: promoted.event.id,
          resultDigest: fixture.resultDigest,
        },
      ])
      expect(
        yield* SessionNotification.inspect(seed.database.db, seed.bus, seed.store, {
          sessionID: seed.input.sessionID,
          inboxID: noticeID,
        }),
      ).toEqual({ admit: false, wake: false })
    }),
  )

  it.live("MP04 requires every exact output line in consumed Read results for a truncated task", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const fixture = yield* operationFixture(seed)
      const outputPath = path.join((yield* tmpdirScoped()).path, "operation.json")
      const text = JSON.stringify(JSON.parse(fixture.text), undefined, 2)
      yield* fixture.fs.writeFileString(outputPath, text)
      yield* fixture.produce("[showing 0 lines; full output saved]", { truncated: true, outputPath })
      const marker = yield* fixture.started(2)
      yield* fixture.observe(marker, [
        Message.tool(
          ToolResultPart.make({
            id: fixture.source.id,
            name: "task",
            result: { type: "text", value: "[showing 0 lines; full output saved]" },
          }),
        ),
      ])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      const readMessageID = SessionMessage.ID.create()
      yield* seed.bus.publish(SessionEvent.Step.Started, {
        sessionID: seed.input.sessionID,
        assistantMessageID: readMessageID,
        agent: Agent.ID.make("meta"),
        model: fixture.model,
        started: 3,
      })
      const lines = text.split("\n")
      const read = Effect.fnUntraced(function* (id: string, offset: number, count: number) {
        const content = ReadTool.toModelContent(outputPath, offset, {
          type: "text-page",
          content: lines.slice(offset - 1, offset - 1 + count).join("\n"),
          mime: "application/json",
          offset,
          truncated: offset - 1 + count < lines.length,
          next: offset - 1 + count < lines.length ? offset + count : undefined,
        })
        const output = typeof content === "string" ? content : ""
        yield* seed.bus.publish(SessionEvent.Tool.Input.Started, {
          sessionID: seed.input.sessionID,
          assistantMessageID: readMessageID,
          id,
          name: "read",
        })
        yield* seed.bus.publish(SessionEvent.Tool.Called, {
          sessionID: seed.input.sessionID,
          assistantMessageID: readMessageID,
          id,
          executed: false,
          input: { path: outputPath, offset, limit: count },
        })
        yield* seed.bus.publish(SessionEvent.Tool.Success, {
          sessionID: seed.input.sessionID,
          assistantMessageID: readMessageID,
          id,
          executed: false,
          content: [{ type: "text", text: output }],
        })
        return Message.tool(ToolResultPart.make({ id, name: "read", result: { type: "text", value: output } }))
      })
      const first = yield* read("read_first", 1, 2)
      const partial = yield* fixture.started(4)
      yield* fixture.observe(partial, [first])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toBeUndefined()
      const rest = yield* read("read_rest", 3, lines.length - 2)
      const full = yield* fixture.started(5)
      yield* fixture.observe(full, [first, rest])
      yield* fixture.observe(full, [first, rest])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toEqual([
        {
          consumerSessionID: seed.input.sessionID,
          assistantMessageID: full.assistantMessageID,
          eventID: full.event.id,
          resultDigest: fixture.resultDigest,
        },
      ])
      yield* fixture.fs.remove(outputPath)
      const deleted = yield* fixture.started(6)
      yield* fixture.observe(deleted, [first, rest])
      expect((yield* fixture.tasks.operation(fixture.ref))?.consumers).toHaveLength(1)
    }),
  )
})
