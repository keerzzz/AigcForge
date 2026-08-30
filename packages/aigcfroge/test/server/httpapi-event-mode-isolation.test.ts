import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Queue, Ref, Schema, Stream } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { eq } from "drizzle-orm"
import { GlobalBus } from "../../src/bus/global"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "../../src/session/session"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { Database } from "@aigcfroge/core/database/database"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { httpApiLayer, request, requestInDirectory } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, EventV2Bridge.defaultLayer, httpApiLayer),
)

const CAPABLE = { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 }

const InstanceEventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

const GlobalEventData = Schema.Struct({
  directory: Schema.String,
  payload: Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.String,
    properties: Schema.Record(Schema.String, Schema.Any),
  }),
})

const V2EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Any),
})

// SSE chunks are not guaranteed to align with event frames, so buffer the
// stream text and split on frame boundaries instead of decoding whole chunks.
const openStream = <A, E, R>(
  response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
  schema: Schema.Decoder<A>,
) =>
  Effect.gen(function* () {
    const res = yield* response
    const queue = yield* Queue.unbounded<Uint8Array>()
    yield* res.stream.pipe(
      Stream.runForEach((value) => Queue.offer(queue, value)),
      Effect.forkScoped,
    )
    const buffer = yield* Ref.make("")
    const decoder = new TextDecoder()
    const read = Effect.gen(function* () {
      while (true) {
        const text = yield* Ref.get(buffer)
        const end = text.indexOf("\n\n")
        if (end >= 0) {
          const frame = text.slice(0, end)
          yield* Ref.set(buffer, text.slice(end + 2))
          const line = frame.split("\n").find((entry) => entry.startsWith("data: "))
          if (line === undefined) continue
          return Schema.decodeUnknownSync(schema)(JSON.parse(line.replace(/^data: /, "")))
        }
        const chunk = yield* Queue.take(queue).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.fail(new Error("timed out waiting for event")),
          }),
        )
        yield* Ref.update(buffer, (current) => current + decoder.decode(chunk, { stream: true }))
      }
    })
    return { response: res, read }
  })

// Reads until `predicate` matches, collecting everything seen along the way so
// tests can assert which events were filtered out before the match.
const readUntil = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  predicate: (event: A) => boolean,
  message: string,
  max = 10,
) =>
  Effect.gen(function* () {
    const seen: A[] = []
    for (let index = 0; index < max; index++) {
      const event = yield* read
      seen.push(event)
      if (predicate(event)) return { matched: event, seen }
    }
    return yield* Effect.fail(new Error(message))
  })

const openInstanceStream = (directory: string, headers?: Record<string, string>) =>
  openStream(requestInDirectory(EventPaths.event, directory, headers ? { headers } : {}), InstanceEventData)

const openGlobalStream = (headers?: Record<string, string>) =>
  openStream(request(GlobalPaths.event, headers ? { headers } : {}), GlobalEventData)

const openV2Stream = (headers?: Record<string, string>) =>
  openStream(request("/api/event", headers ? { headers } : {}), V2EventData)

// mode-less session event: the payload carries a sessionID but no mode field,
// so the stream filter must classify it through the connection's session map.
const publishMessageRemoved = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    return yield* events.publish(SessionV1.Event.MessageRemoved, {
      sessionID,
      messageID: SessionV1.MessageID.ascending(),
    })
  })

const publishSessionUpdated = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const info = yield* Session.use.get(sessionID)
    return yield* events.publish(SessionV1.Event.Updated, { sessionID, info })
  })

const emitGlobalBusEvent = (sessionID: string, marker: string) =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: "session.updated",
      properties: { sessionID, marker },
    },
  })

const makeSessions = Effect.gen(function* () {
  const regular = yield* Session.use.create({ title: "Regular Session" })
  const custom = yield* Session.use.create({ title: "Custom Session" })
  const { db } = yield* Database.Service
  yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, custom.id))
  return { regular, custom }
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("event stream product-mode isolation", () => {
  it.instance(
    "instance stream hides mode-less custom session events from legacy clients",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const sessions = yield* makeSessions

        const legacy = yield* openInstanceStream(directory)
        expect(yield* legacy.read).toMatchObject({ type: "server.connected" })

        // The custom session event must be filtered; the regular event right
        // behind it proves the stream is alive (FIFO per connection).
        yield* publishMessageRemoved(sessions.custom.id)
        yield* publishMessageRemoved(sessions.regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: sessions.regular.id },
        })

        const capable = yield* openInstanceStream(directory, CAPABLE)
        expect(yield* capable.read).toMatchObject({ type: "server.connected" })
        yield* publishMessageRemoved(sessions.custom.id)
        expect(yield* capable.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: sessions.custom.id },
        })

        // The legacy connection stayed silent for that second custom event.
        yield* publishMessageRemoved(sessions.regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: sessions.regular.id },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "instance stream fails closed for mode-less events with unknown session IDs",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const regular = yield* Session.use.create({ title: "Regular Session" })

        const legacy = yield* openInstanceStream(directory)
        expect(yield* legacy.read).toMatchObject({ type: "server.connected" })

        // A ses_* ID that was never persisted: unknown membership must not be
        // treated as a non-custom session.
        const unknown = SessionSchema.ID.create()
        yield* publishMessageRemoved(unknown)
        yield* publishMessageRemoved(regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: regular.id },
        })

        // Capable clients opt into every payload, including unknown sessions.
        const capable = yield* openInstanceStream(directory, CAPABLE)
        expect(yield* capable.read).toMatchObject({ type: "server.connected" })
        yield* publishMessageRemoved(unknown)
        expect(yield* capable.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: unknown },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "global stream isolates mode-less custom session events on both event sources",
    () =>
      Effect.gen(function* () {
        const sessions = yield* makeSessions

        const baseline = GlobalBus.listenerCount("event")
        const legacy = yield* openGlobalStream()
        expect(yield* legacy.read).toMatchObject({ directory: "global", payload: { type: "server.connected" } })
        // The GlobalBus subscription starts with the response body stream, so
        // wait until the handler has actually registered its listener.
        yield* pollWithTimeout(
          Effect.sync(() => (GlobalBus.listenerCount("event") > baseline ? (true as const) : undefined)),
          "global stream did not subscribe to GlobalBus",
        )

        // EventV2-sourced events: custom filtered, regular delivered.
        yield* publishMessageRemoved(sessions.custom.id)
        yield* publishMessageRemoved(sessions.regular.id)
        const v2 = yield* readUntil(
          legacy.read,
          (event) =>
            event.payload.type === "message.removed" && event.payload.properties.sessionID === sessions.regular.id,
          "regular session event never reached the global stream",
        )
        expect(v2.seen.some((event) => event.payload.properties.sessionID === sessions.custom.id)).toBe(false)

        // Legacy GlobalBus events (e.g. workspace-forwarded session events):
        // same isolation for mode-less payloads carrying a sessionID.
        emitGlobalBusEvent(sessions.custom.id, "custom-marker")
        emitGlobalBusEvent(sessions.regular.id, "regular-marker")
        const bus = yield* readUntil(
          legacy.read,
          (event) => event.payload.properties.marker === "regular-marker",
          "regular GlobalBus event never reached the global stream",
        )
        expect(bus.seen.some((event) => event.payload.properties.sessionID === sessions.custom.id)).toBe(false)

        const capable = yield* openGlobalStream(CAPABLE)
        expect(yield* capable.read).toMatchObject({ directory: "global", payload: { type: "server.connected" } })
        yield* publishMessageRemoved(sessions.custom.id)
        const capableResult = yield* readUntil(
          capable.read,
          (event) =>
            event.payload.type === "message.removed" && event.payload.properties.sessionID === sessions.custom.id,
          "custom session event never reached the capable global stream",
        )
        expect(capableResult.matched.payload.properties.sessionID).toBe(sessions.custom.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "v2 event stream isolates mode-less custom session events",
    () =>
      Effect.gen(function* () {
        const sessions = yield* makeSessions

        const legacy = yield* openV2Stream()
        expect(yield* legacy.read).toMatchObject({ type: "server.connected" })
        // events.all() subscribes when the response body starts, after
        // server.connected; a warm-up event proves the subscription is live.
        yield* publishMessageRemoved(sessions.regular.id)
        yield* readUntil(
          legacy.read,
          (event) => event.type === "message.removed" && event.data.sessionID === sessions.regular.id,
          "v2 stream never delivered the warm-up event",
        )

        yield* publishMessageRemoved(sessions.custom.id)
        yield* publishMessageRemoved(sessions.regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          data: { sessionID: sessions.regular.id },
        })

        const capable = yield* openV2Stream(CAPABLE)
        expect(yield* capable.read).toMatchObject({ type: "server.connected" })
        yield* publishMessageRemoved(sessions.regular.id)
        yield* readUntil(
          capable.read,
          (event) => event.type === "message.removed" && event.data.sessionID === sessions.regular.id,
          "capable v2 stream never delivered the warm-up event",
        )
        yield* publishMessageRemoved(sessions.custom.id)
        expect(yield* capable.read).toMatchObject({
          type: "message.removed",
          data: { sessionID: sessions.custom.id },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "sessions persisted after connect fail closed until a mode-carrying event reclassifies them",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const regular = yield* Session.use.create({ title: "Regular Session" })
        const { db } = yield* Database.Service

        const legacy = yield* openInstanceStream(directory)
        expect(yield* legacy.read).toMatchObject({ type: "server.connected" })
        const capable = yield* openInstanceStream(directory, CAPABLE)
        expect(yield* capable.read).toMatchObject({ type: "server.connected" })

        // Persisted without any event after the connection snapshot was taken,
        // so the legacy filter has no membership entry for either session.
        const lateCustom = SessionSchema.ID.create()
        const lateRegular = SessionSchema.ID.create()
        yield* db.insert(SessionTable).values({
          id: lateCustom,
          project_id: regular.projectID,
          mode: "custom",
          slug: "late-custom",
          directory,
          title: "Late Custom",
          version: "0.0.0-test",
        })
        yield* db.insert(SessionTable).values({
          id: lateRegular,
          project_id: regular.projectID,
          slug: "late-regular",
          directory,
          title: "Late Regular",
          version: "0.0.0-test",
        })

        // (a) mode-less events fail closed for the legacy client even though
        // the rows exist; the capable client receives them in publish order.
        yield* publishMessageRemoved(lateCustom)
        yield* publishMessageRemoved(lateRegular)
        yield* publishMessageRemoved(regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: regular.id },
        })
        expect(yield* capable.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: lateCustom },
        })
        expect(yield* capable.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: lateRegular },
        })

        // (b) a payload carrying its own mode rewrites the connection's
        // membership map: custom stays hidden, regular becomes visible.
        yield* publishSessionUpdated(lateCustom)
        yield* publishSessionUpdated(lateRegular)
        yield* publishMessageRemoved(lateCustom)
        yield* publishMessageRemoved(lateRegular)
        yield* publishMessageRemoved(regular.id)
        expect(yield* legacy.read).toMatchObject({
          type: "session.updated",
          properties: { sessionID: lateRegular },
        })
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: lateRegular },
        })
        expect(yield* legacy.read).toMatchObject({
          type: "message.removed",
          properties: { sessionID: regular.id },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
