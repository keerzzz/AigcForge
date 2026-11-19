export * as SessionMessageID from "./session-message-id.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

// Goal refs and physical attempt records share the identity without importing the message payload graph.
export const ID = Schema.String.check(Schema.isStartingWith("msg_")).pipe(
  Schema.brand("Session.Message.ID"),
  Schema.annotate({ identifier: "Session.Message.ID" }),
  statics((schema) => ({
    create: () => schema.make("msg_" + ascending()),
    fromEvent: (eventID: Event.ID) => schema.make(eventID.replace(/^evt_/, "msg_")),
  })),
)
export type ID = typeof ID.Type
