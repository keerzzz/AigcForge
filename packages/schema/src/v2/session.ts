export * as Session from "./session.js"

import { Effect, Schema } from "effect"
import { Agent } from "../agent.js"
import { Location } from "../location.js"
import { Model } from "../model.js"
import { PermissionTier } from "../permission-tier.js"
import { ProductMode } from "../product-mode.js"
import { Project } from "../project.js"
import { DateTimeUtcFromMillis, optional, RelativePath } from "../schema.js"
import { SessionID } from "../session-id.js"
import { SessionMessageID } from "../session-message-id.js"
import { WorkContract } from "../work-contract.js"
import { WorkPreset } from "../work-preset.js"

export const ID = SessionID
export type ID = SessionID

export const Revert = Schema.Struct({
  messageID: SessionMessageID.ID,
  snapshot: Schema.String.pipe(optional),
  diff: Schema.String.pipe(optional),
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
  presetCategoryId: WorkPreset.Category.pipe(optional),
  workContract: WorkContract.Snapshot.pipe(optional),
  slug: Schema.String,
  version: Schema.String,
  parentID: ID.pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
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
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  attended: Schema.Boolean.pipe(optional),
  permissionTier: PermissionTier.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
    Schema.withConstructorDefault(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
  ),
  revert: Revert.pipe(optional),
  summary: Summary.pipe(optional),
}).annotate({ identifier: "SessionV2.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListAnchor = typeof ListAnchor.Type
