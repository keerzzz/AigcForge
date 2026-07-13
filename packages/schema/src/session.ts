export * as Session from "./session"

import { Effect, Schema } from "effect"
import { Agent } from "./agent"
import { Location } from "./location"
import { Model } from "./model"
import { ProductMode } from "./product-mode"
import { Project } from "./project"
import { DateTimeUtcFromMillis, optionalOmitUndefined, RelativePath } from "./schema"
import { SessionID } from "./session-id"
import { SessionMessageID } from "./session-message-id"

export const ID = SessionID.ID
export type ID = SessionID.ID

export const Revert = Schema.Struct({
  messageID: SessionMessageID.ID,
  snapshot: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionV2.Revert" })
export type Revert = typeof Revert.Type

export const Summary = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
}).annotate({ identifier: "SessionV2.Summary" })
export type Summary = typeof Summary.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  mode: ProductMode.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(ProductMode.Default as ProductMode.ID)),
    Schema.withConstructorDefault(Effect.succeed(ProductMode.Default as ProductMode.ID)),
  ),
  slug: Schema.String,
  version: Schema.String,
  parentID: ID.pipe(optionalOmitUndefined),
  projectID: Project.ID,
  agent: Agent.ID.pipe(Schema.optional),
  model: Model.Ref.pipe(Schema.optional),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(Schema.optional),
  attended: Schema.Boolean.pipe(Schema.optional),
  revert: Schema.optional(Revert),
  summary: Schema.optional(Summary),
}).annotate({ identifier: "SessionV2.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListAnchor = typeof ListAnchor.Type
