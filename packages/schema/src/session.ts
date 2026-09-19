export * as Session from "./session"

import { Effect, Schema } from "effect"
import { Agent } from "./agent"
import { Location } from "./location"
import { Model } from "./model"
import { PermissionTier } from "./permission-tier"
import { ProductMode } from "./product-mode"
import { Project } from "./project"
import { DateTimeUtcFromMillis, optionalOmitUndefined, RelativePath } from "./schema"
import { SessionID } from "./session-id"
import { SessionMessageID } from "./session-message-id"
import { WorkPreset } from "./work-preset"

export const ID = SessionID.ID
export type ID = SessionID.ID

export const Revert = Schema.Struct({
  messageID: SessionMessageID.ID,
  snapshot: Schema.String.pipe(optionalOmitUndefined),
  diff: Schema.String.pipe(optionalOmitUndefined),
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
  presetCategoryId: WorkPreset.Category.pipe(optionalOmitUndefined),
  slug: Schema.String,
  version: Schema.String,
  parentID: ID.pipe(optionalOmitUndefined),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optionalOmitUndefined),
  model: Model.Ref.pipe(optionalOmitUndefined),
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
    archived: DateTimeUtcFromMillis.pipe(optionalOmitUndefined),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(optionalOmitUndefined),
  attended: Schema.Boolean.pipe(optionalOmitUndefined),
  permissionTier: PermissionTier.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
    Schema.withConstructorDefault(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
  ),
  revert: Revert.pipe(optionalOmitUndefined),
  summary: Summary.pipe(optionalOmitUndefined),
}).annotate({ identifier: "SessionV2.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListAnchor = typeof ListAnchor.Type
