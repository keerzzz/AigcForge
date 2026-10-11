export * as SessionStatus from "./status"

import { Schema } from "effect"
import { EventV2 } from "../event"
import { NonNegativeInt } from "../schema"
import { SessionSchema } from "./schema"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Status: EventV2.define({
    type: "session.status",
    schema: {
      sessionID: SessionSchema.ID,
      status: Info,
    },
  }),
  // deprecated
  Idle: EventV2.define({
    type: "session.idle",
    schema: {
      sessionID: SessionSchema.ID,
    },
  }),
}
