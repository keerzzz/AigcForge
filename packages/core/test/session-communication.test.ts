import { describe, expect } from "bun:test"
import { Context, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionStore } from "@omnixa/core/session/store"
import { MetaAgentService } from "@omnixa/core/meta-agent/service"
import { KV } from "@omnixa/core/kv"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { CommunicationRecord } from "@omnixa/core/session/communication-record"
import { SessionShareV2 } from "@omnixa/core/session/share-v2"
import { SessionMessage } from "@omnixa/core/session/message"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { SessionTask } from "@omnixa/schema/session-task"
import { Money } from "@omnixa/schema/money"
import { Agent } from "@omnixa/core/agent"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Hash } from "@omnixa/util/hash"
import { KVTable } from "@omnixa/core/kv/sql"
import { like } from "drizzle-orm"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const graph = LayerNode.group([
  SessionShareV2.node,
  Session.node,
  Bus.node,
  Database.node,
  LocationServiceMap.node,
  SessionInbox.node,
  SessionStore.node,
  SessionExecution.node,
  MetaAgentService.node,
  KV.node,
])
const layer = AppNodeBuilder.build(graph, [
  Global.node.replace(tempGlobalLayer),
  Bus.node.replace(Bus.configured({ persist: true })),
  offlineModels,
])
const it = testEffect(layer)
const volatileIt = testEffect(
  AppNodeBuilder.build(graph, [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: false })),
    offlineModels,
  ]),
)
const model = Model.Ref.make({ id: Model.ID.make("communication"), providerID: Provider.ID.make("test") })

const setup = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const location = Location.Ref.make({ directory: AbsolutePath.make((yield* tmpdirScoped()).path) })
  const local = (yield* LocationServiceMap.Service).get(location)
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provide(local))
  const first = yield* sessions.create({
    location,
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const second = yield* sessions.create({
    location,
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const content = yield* sessions.create({ location, agent: Agent.defaultID, model })
  yield* Effect.forEach([first, second, content], (session) =>
    Effect.gen(function* () {
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID: session.id,
        text: "Keep communication in the original Inbox",
      })
      const boundary = (yield* sessions.context(session.id)).find((message) => message.type === "synthetic")
      if (!boundary) return yield* Effect.die(new Error("Communication boundary missing"))
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: session.id,
        revert: { messageID: boundary.id, files: [] },
      })
      return undefined
    }),
  )
  return {
    sessions,
    bus,
    first,
    second,
    content,
    share: yield* SessionShareV2.Service,
    db: (yield* Database.Service).db,
    inbox: yield* SessionInbox.Service,
    execution: yield* SessionExecution.Service,
  }
})

const output = Effect.fnUntraced(function* (sessionID: Session.ID, text: string) {
  const bus = yield* Bus.Service
  const assistantMessageID = SessionMessage.ID.create()
  yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.defaultID,
    model,
    started: 0,
  })
  yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
  yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal: 0, text })
  yield* bus.publish(SessionEvent.Step.Ended, {
    sessionID,
    assistantMessageID,
    finish: "stop",
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
})

describe("Session communication through original Share and Inbox", () => {
  it.live("freezes the first source output and indexes the same communication for the actual actor and receiver", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* output(fixture.content.id, "First evidence 🚀")
      const request = {
        sessionID: fixture.first.id,
        id: SessionCommunication.ID.create(),
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.SessionContent({
          type: "session",
          sessionID: fixture.content.id,
          scope: "output",
        }),
        trigger: false,
      }
      const first = yield* fixture.share.send(request)
      expect(first).toMatchObject({
        actor: { type: "user", sessionID: fixture.first.id },
        contentSource: { sessionID: fixture.content.id },
        targetSessionID: fixture.second.id,
        state: "pending",
        admission: "admitted",
        wake: "not_requested",
        delivery: "queue",
      })
      expect(first.text).toContain("First evidence 🚀")
      yield* output(fixture.content.id, "Later source edit")
      const before = yield* fixture.bus.log({ aggregateID: fixture.second.id }).pipe(Stream.runCollect)
      expect((yield* fixture.share.send(request)).text).toBe(first.text)
      expect(yield* fixture.bus.log({ aggregateID: fixture.second.id }).pipe(Stream.runCollect)).toEqual(before)
      expect((yield* fixture.share.list({ sessionID: fixture.first.id })).items.map((item) => item.id)).toEqual([
        first.id,
      ])
      expect((yield* fixture.share.list({ sessionID: fixture.second.id })).items.map((item) => item.id)).toEqual([
        first.id,
      ])
      expect((yield* fixture.share.list({ sessionID: fixture.content.id })).items).toHaveLength(0)
      expect((yield* fixture.share.read({ sessionID: fixture.first.id, communicationID: first.id }))?.body.digest).toBe(
        SessionCommunication.Digest.make(Hash.sha256(first.text)),
      )
      const decoded = before.flatMap((event) => {
        if (Bus.isSynced(event)) return []
        if (event.type !== SessionEvent.InboxEnqueued.type) return []
        return [Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)(event.data)]
      })[0]
      expect(decoded?.communication?.id).toBe(first.id)
      expect(decoded?.inboxID).toBe(first.body.inputID)
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(1)
      expect(yield* fixture.execution.isActive(fixture.second.id)).toBe(false)
    }),
  )

  it.live("rejects changed requests and permits replies only from the exact receiving Session", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const request = {
        sessionID: fixture.first.id,
        id: SessionCommunication.ID.create(),
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.TextContent({ type: "text", text: "Original message" }),
        trigger: false,
      }
      const first = yield* fixture.share.send(request)
      expect(
        yield* fixture.share
          .send({
            ...request,
            content: new SessionCommunication.TextContent({ type: "text", text: "Changed message" }),
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "conflicting_retry" })
      expect(
        yield* fixture.share
          .reply({
            sessionID: fixture.first.id,
            communicationID: first.id,
            id: SessionCommunication.ID.create(),
            content: new SessionCommunication.TextContent({ type: "text", text: "Wrong receiver" }),
            trigger: false,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid_reply" })
      const reply = yield* fixture.share.reply({
        sessionID: fixture.second.id,
        communicationID: first.id,
        id: SessionCommunication.ID.create(),
        content: new SessionCommunication.TextContent({ type: "text", text: "Actual reply" }),
        trigger: false,
      })
      expect(reply).toMatchObject({
        replyTo: first.id,
        actor: { sessionID: fixture.second.id },
        targetSessionID: fixture.first.id,
      })
      const next = yield* fixture.share.reply({
        sessionID: fixture.first.id,
        communicationID: reply.id,
        id: SessionCommunication.ID.create(),
        content: new SessionCommunication.TextContent({ type: "text", text: "Third link" }),
        trigger: false,
      })
      expect(next.replyTo).toBe(reply.id)
      expect(
        yield* fixture.share.read({ sessionID: fixture.content.id, communicationID: first.id }).pipe(Effect.flip),
      ).toMatchObject({ reason: "not_participant" })
      expect((yield* fixture.share.list({ sessionID: fixture.first.id })).items).toHaveLength(3)
    }),
  )

  it.live("coalesces concurrent exact sends and freezes state after original Inbox promotion", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const id = SessionCommunication.ID.create()
      const request = {
        sessionID: fixture.first.id,
        id,
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.TextContent({ type: "text", text: "Concurrent immutable body" }),
        trigger: false,
      }
      const receipts = yield* Effect.all(
        [
          fixture.share.send(request),
          fixture.share.send({
            ...request,
            content: new SessionCommunication.TextContent({ text: "Concurrent immutable body", type: "text" }),
          }),
        ],
        { concurrency: "unbounded" },
      )
      expect(receipts.map((receipt) => receipt.body.inputID)).toEqual([
        receipts[0]?.body.inputID,
        receipts[0]?.body.inputID,
      ])
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(1)
      yield* SessionInbox.promote(fixture.db, fixture.bus, fixture.second.id, "input")
      expect((yield* fixture.share.read({ sessionID: fixture.first.id, communicationID: id }))?.state).toBe("visible")
      expect(yield* fixture.share.send(request)).toMatchObject({
        state: "visible",
        admission: "retained",
        wake: "not_requested",
      })
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(0)
    }),
  )

  it.live("rebuilds a trusted reply aggregate before its parent communication aggregate", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const first = yield* fixture.share.send({
        sessionID: fixture.first.id,
        id: SessionCommunication.ID.create(),
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.TextContent({ type: "text", text: "Parent durable body" }),
        trigger: false,
      })
      const reply = yield* fixture.share.reply({
        sessionID: fixture.second.id,
        communicationID: first.id,
        id: SessionCommunication.ID.create(),
        content: new SessionCommunication.TextContent({ type: "text", text: "Reply durable body" }),
        trigger: false,
      })
      const events = yield* fixture.bus.log({ aggregateID: fixture.first.id }).pipe(Stream.runCollect)
      const replyEvent = events
        .flatMap((event) =>
          Bus.isSynced(event) || event.type !== SessionEvent.InboxEnqueued.type
            ? []
            : [Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)(event.data)],
        )
        .find((event) => event.communication?.id === reply.id)
      const parentEvents = yield* fixture.bus.log({ aggregateID: fixture.second.id }).pipe(Stream.runCollect)
      const parentEvent = parentEvents
        .flatMap((event) =>
          Bus.isSynced(event) || event.type !== SessionEvent.InboxEnqueued.type
            ? []
            : [Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)(event.data)],
        )
        .find((event) => event.communication?.id === first.id)
      if (
        !replyEvent?.communication ||
        !parentEvent?.communication ||
        replyEvent.item.type !== "synthetic" ||
        parentEvent.item.type !== "synthetic"
      )
        return yield* Effect.die(new Error("Expected exact durable parent and reply records"))
      const replyProjection = {
        record: replyEvent.communication,
        text: replyEvent.item.payload.text,
        inputID: replyEvent.inboxID,
        sessionID: replyEvent.sessionID,
      }
      const parentProjection = {
        record: parentEvent.communication,
        text: parentEvent.item.payload.text,
        inputID: parentEvent.inboxID,
        sessionID: parentEvent.sessionID,
      }
      yield* fixture.db
        .delete(KVTable)
        .where(like(KVTable.key, "session_share:communication:%"))
        .run()
        .pipe(Effect.orDie)
      yield* fixture.db
        .transaction((tx) => CommunicationRecord.project(tx, replyProjection).pipe(Effect.orDie))
        .pipe(Effect.orDie)
      expect((yield* fixture.share.read({ sessionID: fixture.first.id, communicationID: reply.id }))?.replyTo).toBe(
        first.id,
      )
      yield* fixture.db
        .transaction((tx) => CommunicationRecord.project(tx, parentProjection).pipe(Effect.orDie))
        .pipe(Effect.orDie)
      expect((yield* fixture.share.list({ sessionID: fixture.first.id })).items.map((item) => item.id)).toEqual([
        first.id,
        reply.id,
      ])
      expect((yield* fixture.share.list({ sessionID: fixture.second.id })).items.map((item) => item.id)).toEqual([
        first.id,
        reply.id,
      ])
      return undefined
    }),
  )

  it.live("retains a cancelled body and never readmits or wakes its original carrier on retry", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const request = {
        sessionID: fixture.first.id,
        id: SessionCommunication.ID.create(),
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.TextContent({ type: "text", text: "Retained cancelled text" }),
      }
      const first = yield* fixture.share.send(request)
      yield* fixture.inbox.cancel({ sessionID: fixture.second.id, id: first.body.inputID })
      const retry = yield* fixture.share.send(request)
      expect(retry).toMatchObject({ state: "cancelled", admission: "suppressed", wake: "suppressed", text: first.text })
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(0)
      expect(yield* fixture.execution.isActive(fixture.second.id)).toBe(false)
      expect((yield* fixture.share.read({ sessionID: fixture.first.id, communicationID: first.id }))?.text).toBe(
        first.text,
      )
    }),
  )

  it.live("rolls back the original Inbox, record, indexes and event when a commit hook fails", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const id = SessionCommunication.ID.create()
      const inputID = SessionMessage.ID.create()
      const text = "Atomic communication"
      const record = new SessionCommunication.Record({
        id,
        actor: new SessionCommunication.UserActor({ type: "user", sessionID: fixture.first.id }),
        contentSource: new SessionCommunication.ContentSource({ sessionID: fixture.first.id, scope: "text" }),
        targetSessionID: fixture.second.id,
        body: new SessionCommunication.BodyRef({
          sessionID: fixture.second.id,
          inputID,
          digest: SessionCommunication.Digest.make(Hash.sha256(text)),
        }),
        requestDigest: SessionCommunication.Digest.make(Hash.sha256("request")),
        delivery: "queue",
        trigger: false,
        createdAt: 123,
      })
      const before = yield* fixture.bus.log({ aggregateID: fixture.second.id }).pipe(Stream.runCollect)
      const failure = yield* fixture.inbox
        .admit({
          id: inputID,
          sessionID: fixture.second.id,
          communication: record,
          item: { type: "synthetic", payload: SessionInbox.SyntheticPayload.make({ text }), delivery: "queue" },
          beforeCommit: Effect.die(new Error("rollback-communication")),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(failure)).toBe(true)
      expect(yield* CommunicationRecord.get(fixture.db, id)).toBeUndefined()
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(0)
      expect((yield* fixture.share.list({ sessionID: fixture.first.id })).items).toHaveLength(0)
      expect(yield* fixture.bus.log({ aggregateID: fixture.second.id }).pipe(Stream.runCollect)).toEqual(before)
    }),
  )

  it.live("reads the retained first payload after rebuilding the Share layer", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const request = {
        sessionID: fixture.first.id,
        id: SessionCommunication.ID.create(),
        targetSessionID: fixture.second.id,
        content: new SessionCommunication.TextContent({ type: "text", text: "Cold retry" }),
        trigger: false,
      }
      const first = yield* fixture.share.send(request)
      const context = yield* Effect.context<Layer.Success<typeof layer>>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const reopened = yield* Layer.buildWithScope(
        Layer.fresh(SessionShareV2.layer).pipe(Layer.provide(Layer.succeedContext(context))),
        scope,
      )
      const share = Context.get(reopened, SessionShareV2.Service)
      expect((yield* share.send(request)).body).toEqual(first.body)
      expect((yield* share.read({ sessionID: fixture.second.id, communicationID: first.id }))?.text).toBe(first.text)
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(1)
    }),
  )

  it.live("requires actual Meta for new user sends while exposing retained reads on Build", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      expect(
        yield* fixture.share
          .send({
            sessionID: fixture.content.id,
            id: SessionCommunication.ID.create(),
            targetSessionID: fixture.second.id,
            content: new SessionCommunication.TextContent({ type: "text", text: "Build active send" }),
            trigger: false,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ kind: "meta-not-selected" })
      expect(yield* fixture.share.capability(fixture.content.id)).toMatchObject({
        read: true,
        list: true,
        send: false,
        reply: false,
      })
    }),
  )

  it.live("projects a trusted system return from the original synthetic admission and keeps its first text", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const inputID = SessionMessage.ID.create()
      const actor = new SessionCommunication.SystemActor({
        type: "system",
        sessionID: fixture.content.id,
        origin: new SessionCommunication.TaskOrigin({
          type: "task_operation",
          operation: new SessionTask.OperationReadonlyRef({
            sourceSessionID: fixture.first.id,
            operationID: SessionTask.OperationID.create(),
          }),
        }),
      })
      const prepared = yield* CommunicationRecord.prepareSystem(fixture.db, {
        inputID,
        targetSessionID: fixture.first.id,
        text: "Original system return",
        actor,
        contentSource: new SessionCommunication.ContentSource({ sessionID: fixture.content.id, scope: "result" }),
        delivery: "steer",
        trigger: true,
        createdAt: 123,
      })
      yield* fixture.sessions.synthetic(
        { id: inputID, sessionID: fixture.first.id, text: prepared.text, resume: false },
        { communication: prepared.record },
      )
      const retained = yield* CommunicationRecord.prepareSystem(fixture.db, {
        inputID,
        targetSessionID: fixture.first.id,
        text: "Later changed return",
        actor,
        contentSource: prepared.record.contentSource,
        delivery: "steer",
        trigger: true,
        createdAt: 456,
      })
      expect(retained.text).toBe("Original system return")
      expect(retained.record.createdAt).toBe(123)
      expect(
        (yield* fixture.share.read({ sessionID: fixture.first.id, communicationID: prepared.record.id }))?.text,
      ).toBe(prepared.text)
      expect((yield* fixture.share.list({ sessionID: fixture.content.id })).items[0]?.id).toBe(prepared.record.id)
      const ordinary = SessionMessage.ID.create()
      const fake = yield* CommunicationRecord.prepareSystem(fixture.db, {
        inputID: ordinary,
        targetSessionID: fixture.second.id,
        text: "Metadata cannot grant trusted origin",
        actor,
        contentSource: prepared.record.contentSource,
        delivery: "steer",
        trigger: false,
        createdAt: 789,
      })
      yield* fixture.sessions.synthetic({
        id: ordinary,
        sessionID: fixture.second.id,
        text: fake.text,
        resume: false,
        metadata: { communication: Schema.encodeSync(SessionCommunication.Record)(fake.record) },
      })
      expect(
        yield* fixture.share.read({ sessionID: fixture.second.id, communicationID: fake.record.id }),
      ).toBeUndefined()
    }),
  )

  volatileIt.live("reports unavailable communication when retained lifecycle events are disabled", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const result = yield* fixture.share
        .send({
          sessionID: fixture.first.id,
          id: SessionCommunication.ID.create(),
          targetSessionID: fixture.second.id,
          content: new SessionCommunication.TextContent({ type: "text", text: "Volatile" }),
          trigger: false,
        })
        .pipe(Effect.flip)
      expect(result).toMatchObject({ reason: "unavailable" })
      expect(yield* fixture.share.capability(fixture.first.id)).toMatchObject({
        read: false,
        list: false,
        send: false,
        reply: false,
      })
      expect(yield* fixture.share.list({ sessionID: fixture.first.id })).toMatchObject({
        items: [],
        capability: { read: false, list: false, send: false, reply: false, reasons: ["retained-events-required"] },
      })
      expect(yield* fixture.sessions.inbox(fixture.second.id)).toHaveLength(0)
    }),
  )
})
