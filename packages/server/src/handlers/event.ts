import { EventV2 } from "@aigcfroge/core/event"
import { Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Api } from "../api"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
        // Complete custom-session membership set, captured once per connection.
        const sessionModes = yield* SessionStore.sessionModes()
        const isEventSupported = ProductModePolicy.eventFilter(capabilitiesHeader, sessionModes)
        // ADR-20 §2.7: this connection can answer approval prompts, so it
        // counts as a responder while attached. Both SSE surfaces must bind —
        // a client attached only here would otherwise leave the responder count
        // at zero and every `ask` would be rejected instead of prompting.
        yield* (yield* ApprovalPresence.Service).bindResponder()

        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        }
        return HttpServerResponse.stream(
          Stream.make(connected).pipe(
            Stream.concat(events.all().pipe(Stream.filter((event) => isEventSupported(event.data)))),
            Stream.map(eventData),
            Stream.pipeThroughChannel(Sse.encode()),
            Stream.encodeText,
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
      }),
    )
  }),
)
