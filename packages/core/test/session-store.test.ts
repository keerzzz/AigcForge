import { describe, expect } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionProjector } from "@omnixa/core/session/projector"
import { SessionStore } from "@omnixa/core/session/store"
import { fromRow } from "@omnixa/core/session/info"
import { SessionTable } from "@omnixa/core/session/sql"
import { eq } from "drizzle-orm"
import { Agent } from "@omnixa/schema/agent"
import { Event } from "@omnixa/schema/event"
import { Model } from "@omnixa/schema/model"
import { Project } from "@omnixa/schema/project"
import { ProductMode } from "@omnixa/schema/product-mode"
import { Provider } from "@omnixa/schema/provider"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { SessionEvent } from "@omnixa/schema/session-event"
import { SessionMessage } from "@omnixa/schema/session-message"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

const seedSessions = (rows: { id: string; updated: number; mode?: ProductMode.ID }[]) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const directory = AbsolutePath.make("/project")
    yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
    yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make(row.id)
        yield* bus.publish(SessionEvent.Created, {
          sessionID,
          projectID: Project.ID.global,
          mode: row.mode,
          location: { directory },
          slug: "store-test",
          version: "test",
        })
        yield* bus.replay({
          id: Event.ID.create(),
          created: row.updated,
          aggregateID: sessionID,
          seq: 1,
          type: Bus.versionedType(SessionEvent.Renamed.type, 1),
          data: { sessionID, title: row.id },
        })
      }),
    )
    return bus
  })

describe("SessionStore", () => {
  it.effect("projects the latest conversation message time independently of metadata and views", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_message_activity")
      const foreignID = Session.ID.make("ses_message_activity_foreign")
      const bus = yield* seedSessions([
        { id: sessionID, updated: 0 },
        { id: foreignID, updated: 0 },
      ])
      const store = yield* SessionStore.Service
      const empty = yield* store.get(sessionID)

      if (!empty) return yield* Effect.die(new Error("Expected seeded session"))

      expect(empty.time.message).toEqual(empty.time.created)
      expect(Schema.encodeSync(Session.Info)(empty).time.message).toBe(DateTime.toEpochMillis(empty.time.created))
      expect((yield* store.list()).find((session) => session.id === sessionID)?.time.message).toEqual(
        empty.time.created,
      )

      yield* bus.publish(SessionEvent.Synthetic, { sessionID: foreignID, text: "system bookkeeping only" })
      const syntheticOnly = yield* store.get(foreignID)

      expect(syntheticOnly?.time.message).toEqual(syntheticOnly?.time.created)

      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID: SessionMessage.ID.make("msg_message_activity_user"),
        item: { type: "user", payload: { text: "first" }, delivery: "steer" },
      })
      yield* bus.replay({
        id: Event.ID.create(),
        created: 200,
        aggregateID: sessionID,
        seq: 3,
        type: Bus.versionedType(SessionEvent.InboxDelivered.type, 1),
        data: { sessionID, inboxID: SessionMessage.ID.make("msg_message_activity_user") },
      })

      expect((yield* store.get(sessionID))?.time.message).toEqual(DateTime.makeUnsafe(200))
      expect((yield* store.list()).find((session) => session.id === sessionID)?.time.message).toEqual(
        DateTime.makeUnsafe(200),
      )

      yield* bus.replay({
        id: Event.ID.create(),
        created: 400,
        aggregateID: sessionID,
        seq: 4,
        type: Bus.versionedType(SessionEvent.Step.Started.type, 1),
        data: {
          sessionID,
          assistantMessageID: SessionMessage.ID.make("msg_message_activity_assistant"),
          agent: Agent.ID.make("build"),
          model: { id: Model.ID.make("test"), providerID: Provider.ID.make("test") },
          started: 350,
        },
      })

      expect((yield* store.get(sessionID))?.time.message).toEqual(DateTime.makeUnsafe(350))

      yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: "system bookkeeping" })
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: foreignID,
        assistantMessageID: SessionMessage.ID.make("msg_message_activity_foreign_assistant"),
        agent: Agent.ID.make("build"),
        model: { id: Model.ID.make("test"), providerID: Provider.ID.make("test") },
        started: 900,
      })
      yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "renamed" })
      yield* bus.publish(SessionEvent.Viewed, { sessionID, idle: 1_000 })

      const updated = yield* store.get(sessionID)

      expect(updated?.title).toBe("renamed")
      expect(updated?.time.viewed).toEqual(DateTime.makeUnsafe(1_000))
      expect(updated?.time.message).toEqual(DateTime.makeUnsafe(350))
      expect((yield* store.list()).find((session) => session.id === sessionID)?.time.message).toEqual(
        DateTime.makeUnsafe(350),
      )
      expect((yield* store.get(foreignID))?.time.message).toEqual(DateTime.makeUnsafe(900))

      const database = yield* Database.Service
      const raw = yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()

      if (!raw) return yield* Effect.die(new Error("Expected stored session"))

      expect(fromRow(raw).time.message).toBeUndefined()
      expect(Schema.encodeSync(Session.Info)(fromRow(raw)).time).not.toHaveProperty("message")
    }),
  )

  it.effect("lists by updated time and ID with exclusive two-item pages in either direction", () =>
    Effect.gen(function* () {
      yield* seedSessions([
        { id: "ses_d", updated: 20 },
        { id: "ses_z", updated: 10 },
        { id: "ses_a", updated: 30 },
        { id: "ses_c", updated: 20 },
        { id: "ses_y", updated: 10 },
        { id: "ses_e", updated: 30 },
        { id: "ses_b", updated: 20 },
      ])
      const store = yield* SessionStore.Service
      expect((yield* store.list()).map((session) => String(session.id))).toEqual([
        "ses_e",
        "ses_a",
        "ses_d",
        "ses_c",
        "ses_b",
        "ses_z",
        "ses_y",
      ])
      expect((yield* store.list({ order: "asc" })).map((session) => String(session.id))).toEqual([
        "ses_y",
        "ses_z",
        "ses_b",
        "ses_c",
        "ses_d",
        "ses_a",
        "ses_e",
      ])
      const pages: { order: "asc" | "desc"; direction: "next" | "previous"; ids: string[] }[] = [
        { order: "asc", direction: "next", ids: ["ses_d", "ses_a"] },
        { order: "asc", direction: "previous", ids: ["ses_z", "ses_b"] },
        { order: "desc", direction: "next", ids: ["ses_b", "ses_z"] },
        { order: "desc", direction: "previous", ids: ["ses_a", "ses_d"] },
      ]
      yield* Effect.forEach(pages, (page) =>
        Effect.gen(function* () {
          const sessions = yield* store.list({
            order: page.order,
            limit: 2,
            anchor: { id: Session.ID.make("ses_c"), time: 20, direction: page.direction },
          })
          expect(sessions.map((session) => String(session.id))).toEqual(page.ids)
        }),
      )
    }),
  )

  it.effect("filters mixed product modes within ordered two-item cursor pages", () =>
    Effect.gen(function* () {
      yield* seedSessions([
        { id: "ses_z_coding", updated: 50, mode: "coding" },
        { id: "ses_e_work", updated: 30, mode: "work" },
        { id: "ses_a_work", updated: 30, mode: "work" },
        { id: "ses_d_assistant", updated: 20, mode: "assistant" },
        { id: "ses_c_work", updated: 20, mode: "work" },
        { id: "ses_b_work", updated: 20, mode: "work" },
        { id: "ses_x_chat", updated: 15, mode: "chat" },
        { id: "ses_custom", updated: 10, mode: "custom" },
        { id: "ses_y_work", updated: 10, mode: "work" },
      ])
      const store = yield* SessionStore.Service

      expect((yield* store.list()).map((session) => String(session.id))).toEqual([
        "ses_z_coding",
        "ses_e_work",
        "ses_a_work",
        "ses_d_assistant",
        "ses_c_work",
        "ses_b_work",
        "ses_x_chat",
        "ses_y_work",
        "ses_custom",
      ])
      expect((yield* store.list({ mode: "work", limit: 2 })).map((session) => String(session.id))).toEqual([
        "ses_e_work",
        "ses_a_work",
      ])
      expect((yield* store.list({ mode: "custom" })).map((session) => String(session.id))).toEqual(["ses_custom"])
      expect((yield* store.get(Session.ID.make("ses_custom")))?.mode).toBe("custom")
      expect(
        (yield* store.list({
          mode: "work",
          directory: AbsolutePath.make("/project"),
          parentID: null,
          search: "ses_a_work",
          limit: 2,
        })).map((session) => String(session.id)),
      ).toEqual(["ses_a_work"])
      expect(
        (yield* store.list({
          mode: "work",
          project: Project.ID.global,
          parentID: null,
          search: "ses_a_work",
          limit: 2,
        })).map((session) => String(session.id)),
      ).toEqual(["ses_a_work"])

      const pages = [
        { order: "asc", direction: "next", ids: ["ses_a_work", "ses_e_work"] },
        { order: "asc", direction: "previous", ids: ["ses_y_work", "ses_b_work"] },
        { order: "desc", direction: "next", ids: ["ses_b_work", "ses_y_work"] },
        { order: "desc", direction: "previous", ids: ["ses_e_work", "ses_a_work"] },
      ] satisfies { order: "asc" | "desc"; direction: "next" | "previous"; ids: string[] }[]

      yield* Effect.forEach(pages, (page) =>
        Effect.gen(function* () {
          const sessions = yield* store.list({
            mode: "work",
            order: page.order,
            limit: 2,
            anchor: { id: Session.ID.make("ses_c_work"), time: 20, direction: page.direction },
          })

          expect(sessions.map((session) => String(session.id))).toEqual(page.ids)
        }),
      )
    }),
  )

  it.effect("pages messages by durable sequence, not timestamp or ID, and scopes cursor lookup", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_messages")
      const foreignID = Session.ID.make("ses_foreign")
      const bus = yield* seedSessions([
        { id: sessionID, updated: 0 },
        { id: foreignID, updated: 0 },
      ])
      const store = yield* SessionStore.Service
      yield* Effect.forEach(
        [
          { id: "evt_z", created: 300 },
          { id: "evt_b", created: 700 },
          { id: "evt_x", created: 100 },
          { id: "evt_c", created: 400 },
          { id: "evt_w", created: 200 },
          { id: "evt_a", created: 600 },
          { id: "evt_y", created: 500 },
        ],
        (event, index) =>
          bus.replay({
            id: Event.ID.make(event.id),
            created: event.created,
            aggregateID: sessionID,
            seq: index + 2,
            type: Bus.versionedType(SessionEvent.Synthetic.type, 1),
            data: { sessionID, text: event.id },
          }),
      )
      yield* bus.publish(
        SessionEvent.Synthetic,
        { sessionID: foreignID, text: "foreign" },
        {
          id: Event.ID.make("evt_foreign"),
        },
      )
      expect((yield* store.messages({ sessionID })).map((message) => String(message.id))).toEqual([
        "msg_y",
        "msg_a",
        "msg_w",
        "msg_c",
        "msg_x",
        "msg_b",
        "msg_z",
      ])
      expect((yield* store.messages({ sessionID, order: "asc" })).map((message) => String(message.id))).toEqual([
        "msg_z",
        "msg_b",
        "msg_x",
        "msg_c",
        "msg_w",
        "msg_a",
        "msg_y",
      ])
      const pages: { order: "asc" | "desc"; direction: "next" | "previous"; ids: string[] }[] = [
        { order: "asc", direction: "next", ids: ["msg_w", "msg_a"] },
        { order: "asc", direction: "previous", ids: ["msg_b", "msg_x"] },
        { order: "desc", direction: "next", ids: ["msg_x", "msg_b"] },
        { order: "desc", direction: "previous", ids: ["msg_a", "msg_w"] },
      ]
      yield* Effect.forEach(pages, (page) =>
        Effect.gen(function* () {
          const messages = yield* store.messages({
            sessionID,
            order: page.order,
            limit: 2,
            cursor: { id: SessionMessage.ID.make("msg_c"), direction: page.direction },
          })
          expect(messages.map((message) => String(message.id))).toEqual(page.ids)
        }),
      )
      expect(yield* store.messages({ sessionID: Session.ID.make("ses_missing") })).toEqual([])
      expect(
        yield* store.messages({
          sessionID,
          cursor: { id: SessionMessage.ID.make("msg_missing"), direction: "next" },
        }),
      ).toEqual([])
      expect(
        yield* store.messages({
          sessionID,
          order: "asc",
          cursor: { id: SessionMessage.ID.make("msg_foreign"), direction: "next" },
        }),
      ).toEqual([])
    }),
  )
})
