import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { MoveSession } from "@aigcfroge/core/control-plane/move-session"
import { EventV2 } from "@aigcfroge/core/event"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Event } from "../../src/server/event"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Mirrors the production graph (httpapi/server.ts:163). The global event
    // stream binds itself as an approval responder, so leaving this out makes
    // every stream request 500 while the two non-streaming routes still pass.
    Layer.provide(ApprovalPresence.defaultLayer),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.layer({ password: Option.none(), username: "aigcfroge" })),
)
const it = testEffect(apiLayer)

const GlobalEventData = Schema.Struct({
  directory: Schema.String,
  payload: Schema.Struct({
    id: EventV2.ID,
    type: Schema.String,
    properties: Schema.Record(Schema.String, Schema.Any),
  }),
})

const readGlobalEvent = (reader: Queue.Dequeue<Uint8Array>) =>
  Effect.gen(function* () {
    const value = yield* Queue.take(reader).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for global event")),
      }),
    )
    return Schema.decodeUnknownSync(GlobalEventData)(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "")))
  })

const openGlobalEventStream = Effect.gen(function* () {
  const response = yield* HttpClient.get(GlobalPaths.event)
  const reader = yield* Queue.unbounded<Uint8Array>()
  yield* response.stream.pipe(
    Stream.runForEach((value) => Queue.offer(reader, value)),
    Effect.forkScoped,
  )
  return { response, reader }
})

describe("global HttpApi", () => {
  it.live("upgrades to latest when the request body is omitted", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.post(GlobalPaths.upgrade)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ success: true, version: "9.9.9" })
    }),
  )

  it.live("rejects malformed upgrade payloads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.setBody(HttpBody.text("{", "application/json")),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
      expect(yield* response.json).toEqual({ success: false, error: "Invalid request body" })
    }),
  )

  it.live("forwards located EventV2 events over the global stream", () =>
    Effect.gen(function* () {
      const { response, reader } = yield* openGlobalEventStream

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toContain("text/event-stream")
      expect(yield* readGlobalEvent(reader)).toMatchObject({
        directory: "global",
        payload: { type: "server.connected", properties: {} },
      })

      const events = yield* EventV2.Service
      yield* events.publish(Event.Connected, {}, { location: { directory: AbsolutePath.make("/tmp/global-event") } })

      expect(yield* readGlobalEvent(reader)).toMatchObject({
        directory: "/tmp/global-event",
        payload: { type: "server.connected", properties: {} },
      })
    }),
  )
})
