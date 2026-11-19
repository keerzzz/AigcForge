export * as SessionReference from "./session-reference.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { SessionID } from "./session-id.js"

/** A reference grants no history read or dispatch; range scopes identify an explicitly selected boundary. */
export const Scope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("identity") }),
  Schema.Struct({
    kind: Schema.Literal("through"),
    messageID: Schema.String.check(Schema.isStartingWith("msg_")),
  }),
  Schema.Struct({
    kind: Schema.Literal("before"),
    messageID: Schema.String.check(Schema.isStartingWith("msg_")),
  }),
]).annotate({ identifier: "SessionReference.Scope" })
export type Scope = typeof Scope.Type

/** Server identity and Session ID decide execution identity. Title is a display snapshot. */
export class Ref extends Schema.Class<Ref>("SessionReference.Ref")({
  serverID: Schema.NonEmptyString,
  sessionID: SessionID,
  title: Schema.String,
  scope: Scope,
}) {}
export type RefEncoded = typeof Ref.Encoded

/** The exact visible mention in a saved user prompt, used to restore the same reference chip. */
export class Mention extends Schema.Class<Mention>("SessionReference.Mention")({
  reference: Ref,
  start: Schema.Int,
  end: Schema.Int,
  content: Schema.String,
}) {}
export type MentionEncoded = typeof Mention.Encoded

/** Optional user-message presentation data; messages from other clients can omit it. */
export interface Presentation extends Schema.Schema.Type<typeof Presentation> {}
export const Presentation = Schema.Struct({
  sessionReferences: Schema.Array(Mention).pipe(optional),
}).annotate({ identifier: "SessionReference.Presentation" })
