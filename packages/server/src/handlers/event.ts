import { Event } from "@omnixa/schema/event"
import { ApprovalPresence } from "@omnixa/core/permission/approval-presence"
import { ProductModePolicy } from "@omnixa/core/product-mode-policy"
import { Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    const presence = yield* ApprovalPresence.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const connected = {
          id: Event.ID.create(),
          type: "server.connected",
          data: {},
        } as const
        const output = Stream.unwrap(
          Effect.gen(function* () {
            const live = yield* feed.subscribe
            // This endpoint observes every Location; bind only while its stream is consumed.
            yield* presence.bindResponder({
              custom: ProductModePolicy.isCustomCapable(request.headers[ProductModePolicy.CAPABILITIES_HEADER]),
            })
            return Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(live))
          }),
        )
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
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
