export * as Session from "./session.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { Location } from "./location.js"
import { Model } from "./model.js"
import { PermissionTier } from "./permission-tier.js"
import { ProductMode } from "./product-mode.js"
import { WorkContract } from "./work-contract.js"
import { WorkPreset } from "./work-preset.js"
import { Project } from "./project.js"
import { DateTimeUtcFromMillis, optional, RelativePath } from "./schema.js"
import { SessionEvent } from "./session-event.js"
import { SessionID } from "./session-id.js"
import { SessionMetadata } from "./session-metadata.js"
import { Money } from "./money.js"
import { Permission } from "./permission.js"
import { TokenUsage } from "./token-usage.js"
import { Revert } from "./session-revert.js"
import { SessionFork } from "./session-fork.js"
import { MetaAgent } from "./meta-agent.js"
import { SessionAttempt } from "./session-attempt.js"

export {
  ExecutorPreference,
  ExecutorBinding,
  TaskControllerSource,
  SubagentControllerSource,
  WorkflowControllerSource,
  ControllerSource,
  RootController,
  ChildController,
  Controller,
} from "./meta-agent.js"

export const ID = SessionID
export type ID = SessionID

export const Metadata = SessionMetadata
export type Metadata = SessionMetadata

export const Event = SessionEvent

export { Revert }
export const ForkBoundary = SessionFork.Boundary
export type ForkBoundary = SessionFork.Boundary

export class ForkExpectedSource extends Schema.Class<ForkExpectedSource>("Session.ForkExpectedSource")(
  Schema.Struct({
    sourceSessionID: ID,
    mode: ProductMode.ID,
    agent: Agent.ID.pipe(optional),
    controller: MetaAgent.Controller.pipe(optional),
    model: Model.Selection.pipe(optional),
    compositionDigest: Schema.String.pipe(optional),
  }).annotate({ identifier: "Session.ForkExpectedSource" }),
) {}

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  fork: Schema.Struct({
    sessionID: ID,
    boundary: ForkBoundary,
  }).pipe(optional),
  projectID: Project.ID,
  mode: ProductMode.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(ProductMode.Default as ProductMode.ID)),
    Schema.withConstructorDefault(Effect.succeed(ProductMode.Default as ProductMode.ID)),
  ),
  attended: Schema.Boolean.pipe(optional),
  permissionTier: PermissionTier.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
    Schema.withConstructorDefault(Effect.succeed(PermissionTier.Default as PermissionTier.ID)),
  ),
  presetCategoryId: WorkPreset.Category.pipe(optional),
  workContract: WorkContract.Snapshot.pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Selection.pipe(optional),
  controller: MetaAgent.Controller.pipe(optional),
  executorPreference: MetaAgent.ExecutorPreference.pipe(optional),
  cost: Money.USD,
  tokens: TokenUsage.Info,
  ...SessionAttempt.Accounting.fields,
  /** Outcome of the last completed execution, recorded at `time.idle`. Absent until a run reaches a terminal transition. */
  outcome: Schema.Literals(["succeeded", "failed", "interrupted"]).pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    /** Latest projected user or assistant message creation time, or session creation time when empty. */
    message: DateTimeUtcFromMillis.pipe(optional),
    idle: DateTimeUtcFromMillis.pipe(optional),
    viewed: DateTimeUtcFromMillis.pipe(optional),
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String.pipe(optional),
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  metadata: Metadata.pipe(optional),
  /** Evaluated after the agent's rules; the last matching rule wins. */
  permissions: Permission.Ruleset.pipe(optional),
  revert: Revert.pipe(optional),
}).annotate({ identifier: "Session.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}
