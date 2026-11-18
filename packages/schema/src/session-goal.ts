export * as SessionGoal from "./session-goal.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { Event } from "./event.js"
import { MetaAgent } from "./meta-agent.js"
import { NonNegativeInt, optional, PositiveInt } from "./schema.js"
import { ID, RoundRef } from "./session-goal-id.js"
import { SessionID } from "./session-id.js"
import { SessionIdentity } from "./session-identity.js"
import { SessionMessage } from "./session-message.js"
import { OperationReadonlyRef } from "./session-task-operation-id.js"
import { Shell } from "./shell.js"
import { Snapshot } from "./snapshot.js"
import { TokenUsage } from "./token-usage.js"
import { WorkflowAsset } from "./workflow-asset.js"

export { ID, RoundRef, AttemptRef } from "./session-goal-id.js"

export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("SessionGoal.Digest"),
  Schema.annotate({ identifier: "SessionGoal.Digest" }),
)
export type Digest = typeof Digest.Type

export const Status = Schema.Literals(["active", "paused", "completed", "cancelled"]).annotate({
  identifier: "SessionGoal.Status",
})
export type Status = typeof Status.Type

export const PauseReason = Schema.Literals(["user", "budget", "blocked", "recovery_required"]).annotate({
  identifier: "SessionGoal.PauseReason",
})
export type PauseReason = typeof PauseReason.Type

const ConditionBase = {
  id: Schema.NonEmptyString,
  operation: optional(OperationReadonlyRef),
}

export const CommandCondition = Schema.Struct({
  ...ConditionBase,
  kind: Schema.Literal("command_result"),
  command: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  exit: Schema.Int,
  outputIncludes: Schema.Array(Schema.NonEmptyString),
  producer: optional(
    Schema.Struct({ sessionID: SessionID, assistantMessageID: SessionMessage.ID, toolCallID: Schema.String }),
  ),
  sourceSnapshot: optional(Snapshot.ID),
}).annotate({ identifier: "SessionGoal.CommandCondition" })
export interface CommandCondition extends Schema.Schema.Type<typeof CommandCondition> {}

export const ArtifactCondition = Schema.Struct({
  ...ConditionBase,
  kind: Schema.Literal("artifact"),
  sessionID: SessionID,
  artifactID: Schema.NonEmptyString,
  revision: WorkflowAsset.Revision,
  relativePath: Schema.NonEmptyString,
}).annotate({ identifier: "SessionGoal.ArtifactCondition" })
export interface ArtifactCondition extends Schema.Schema.Type<typeof ArtifactCondition> {}

export const HumanCondition = Schema.Struct({
  ...ConditionBase,
  kind: Schema.Literal("human_acceptance"),
  description: Schema.NonEmptyString,
}).annotate({ identifier: "SessionGoal.HumanCondition" })
export interface HumanCondition extends Schema.Schema.Type<typeof HumanCondition> {}

export const Condition = Schema.Union([CommandCondition, ArtifactCondition, HumanCondition]).pipe(
  Schema.toTaggedUnion("kind"),
  Schema.annotate({ identifier: "SessionGoal.Condition" }),
)
export type Condition = typeof Condition.Type

export const Budget = Schema.Struct({
  rounds: optional(PositiveInt),
  steps: optional(PositiveInt),
  attempts: optional(PositiveInt),
  tokens: optional(PositiveInt),
  activeMilliseconds: optional(PositiveInt),
}).annotate({ identifier: "SessionGoal.Budget" })
export interface Budget extends Schema.Schema.Type<typeof Budget> {}

export const AttemptKind = Schema.Literals(["coordinator", "worker", "compaction", "auxiliary"]).annotate({
  identifier: "SessionGoal.AttemptKind",
})
export type AttemptKind = typeof AttemptKind.Type

export const Attempt = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  assistantMessageID: optional(SessionMessage.ID),
  kind: AttemptKind,
  rounds: Schema.NonEmptyArray(RoundRef),
  operation: optional(OperationReadonlyRef),
  operations: optional(Schema.Array(OperationReadonlyRef)),
  dispatchedAt: NonNegativeInt,
  settledAt: optional(NonNegativeInt),
  usage: optional(TokenUsage.Info),
}).annotate({ identifier: "SessionGoal.Attempt" })
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

export const Round = Schema.Struct({
  ...RoundRef.fields,
  selection: SessionIdentity.CoordinationSelection,
  trigger: Schema.String,
  createdAt: NonNegativeInt,
  /** The first terminal observation of the original input projection. */
  settledAt: optional(NonNegativeInt),
  outcome: optional(Schema.Literals(["completed", "failed", "interrupted", "unverified"])),
}).annotate({ identifier: "SessionGoal.Round" })
export interface Round extends Schema.Schema.Type<typeof Round> {}

const EvidenceBase = {
  id: Schema.String,
  conditionID: Schema.String,
  revision: PositiveInt,
  acceptedRevisions: Schema.Array(PositiveInt),
  operation: optional(OperationReadonlyRef),
  operations: optional(Schema.Array(OperationReadonlyRef)),
  recordedAt: NonNegativeInt,
}

export const CommandEvidence = Schema.Struct({
  ...EvidenceBase,
  kind: Schema.Literal("command_result"),
  producer: Schema.Struct({
    eventID: Event.ID,
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    toolCallID: Schema.String,
    sourceSnapshot: optional(Snapshot.ID),
  }),
  result: Shell.CommandResult,
  outputIncludes: Schema.Array(Schema.String),
}).annotate({ identifier: "SessionGoal.CommandEvidence" })
export interface CommandEvidence extends Schema.Schema.Type<typeof CommandEvidence> {}

export const ArtifactEvidence = Schema.Struct({
  ...EvidenceBase,
  kind: Schema.Literal("artifact"),
  producer: Schema.Struct({
    sessionID: SessionID,
    artifactID: Schema.String,
    revision: WorkflowAsset.Revision,
    relativePath: Schema.String,
  }),
}).annotate({ identifier: "SessionGoal.ArtifactEvidence" })
export interface ArtifactEvidence extends Schema.Schema.Type<typeof ArtifactEvidence> {}

export const HumanEvidence = Schema.Struct({
  ...EvidenceBase,
  kind: Schema.Literal("human_acceptance"),
  evidenceSetDigest: Digest,
  evidenceIDs: Schema.Array(Schema.String),
  /** Submitted at the authenticated API boundary, never inferred from model text. */
  source: Schema.Literal("authenticated_user"),
}).annotate({ identifier: "SessionGoal.HumanEvidence" })
export interface HumanEvidence extends Schema.Schema.Type<typeof HumanEvidence> {}

export const Evidence = Schema.Union([CommandEvidence, ArtifactEvidence, HumanEvidence]).pipe(
  Schema.toTaggedUnion("kind"),
  Schema.annotate({ identifier: "SessionGoal.Evidence" }),
)
export type Evidence = typeof Evidence.Type

export const Count = Schema.Struct({
  steps: NonNegativeInt,
  attempts: NonNegativeInt,
  recordedTokens: NonNegativeInt,
  sharedTokens: NonNegativeInt,
  unknownAttempts: NonNegativeInt,
  pendingAttempts: NonNegativeInt,
}).annotate({ identifier: "SessionGoal.Count" })
export interface Count extends Schema.Schema.Type<typeof Count> {}

export const Accounting = Schema.Struct({
  rounds: NonNegativeInt,
  activeMilliseconds: NonNegativeInt,
  coordinator: Count,
  worker: Count,
  compaction: Count,
  auxiliary: Count,
}).annotate({ identifier: "SessionGoal.Accounting" })
export interface Accounting extends Schema.Schema.Type<typeof Accounting> {}

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  metaAgentID: MetaAgent.ID,
  agent: Agent.ID,
  selection: SessionIdentity.CoordinationSelection,
  objective: Schema.NonEmptyString,
  conditions: Schema.NonEmptyArray(Condition),
  taskRefs: Schema.Array(OperationReadonlyRef),
  revision: PositiveInt,
  status: Status,
  revisionCreatedAt: NonNegativeInt,
  pauseReason: optional(PauseReason),
  pauseCode: optional(Schema.String),
  pauseVersion: NonNegativeInt,
  budget: Budget,
  rounds: Schema.Array(Round),
  attempts: Schema.Array(Attempt),
  evidence: Schema.Array(Evidence),
  currentEvidenceIDs: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  evidenceSetDigest: Digest,
  satisfiedConditionIDs: Schema.Array(Schema.String),
  lastRoundInputID: optional(SessionMessage.ID),
  activeSince: optional(NonNegativeInt),
  activeMilliseconds: NonNegativeInt,
  accounting: Accounting,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "SessionGoal.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Ref = Schema.Struct({ sessionID: SessionID, goalID: ID }).annotate({ identifier: "SessionGoal.Ref" })
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

export const CreateInput = Schema.Struct({
  goalID: optional(ID),
  objective: Schema.NonEmptyString,
  conditions: Schema.NonEmptyArray(Condition),
  budget: Budget,
}).annotate({ identifier: "SessionGoal.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const EditInput = Schema.Struct({
  expectedRevision: PositiveInt,
  objective: optional(Schema.NonEmptyString),
  conditions: optional(Schema.NonEmptyArray(Condition)),
  budget: optional(Budget),
}).annotate({ identifier: "SessionGoal.EditInput" })
export interface EditInput extends Schema.Schema.Type<typeof EditInput> {}

export const RevisionInput = Schema.Struct({ expectedRevision: PositiveInt }).annotate({
  identifier: "SessionGoal.RevisionInput",
})
export interface RevisionInput extends Schema.Schema.Type<typeof RevisionInput> {}

export const ConfirmInput = Schema.Struct({
  expectedRevision: PositiveInt,
  evidenceIDs: Schema.Array(Schema.String),
  evidenceSetDigest: Digest,
}).annotate({ identifier: "SessionGoal.ConfirmInput" })
export interface ConfirmInput extends Schema.Schema.Type<typeof ConfirmInput> {}

const Updated = Event.ephemeral({ type: "session.goal.updated", schema: { sessionID: SessionID, goal: Info } })
export const Events = { Updated, Definitions: Event.inventory(Updated) }
