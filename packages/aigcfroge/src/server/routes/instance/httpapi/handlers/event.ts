import { InstanceState } from "@/effect/instance-state"
import { EventV2 } from "@aigcfroge/core/event"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { SessionStore } from "@aigcfroge/core/session/store"
import { EventApi } from "../groups/event"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventID() {
  return EventV2.ID.create()
}

function eventResponse(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    // Complete custom-session membership set, captured once per connection.
    const sessionModes = yield* SessionStore.sessionModes()
    const isEventSupported = ProductModePolicy.eventFilter(capabilitiesHeader, sessionModes)

    // Listener registration is eager, so events published after this point cannot
    // be lost while the HTTP body fiber is starting or emitting server.connected.
    const queue = yield* Queue.unbounded<EventV2.Payload>()
    const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(queue, event)))
    yield* Effect.addFinalizer(() => unsubscribe)
    // ADR-20 §2.7: this connection can answer approval prompts, so it counts as
    // a responder for as long as it is attached. Without at least one bound
    // responder every `ask` is rejected immediately instead of prompting.
    yield* (yield* ApprovalPresence.Service).bindResponder()
    const stream = Stream.fromQueue(queue).pipe(
      Stream.filter(
        (event) =>
          event.location?.directory === instance.directory &&
          (event.location.workspaceID === undefined || event.location.workspaceID === workspaceID),
      ),
      Stream.filter((event) => isEventSupported(event.data)),
      Stream.map((event) => ({ id: event.id, type: event.type, properties: event.data })),
    )
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
    )

    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      Stream.make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
        Stream.concat(stream.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return yield* eventResponse(events)
      }),
    )
  }),
)
