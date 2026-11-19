export * as Delegation from "./delegation.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { DelegationID, ParticipantID, TurnID } from "./delegation-id.js"
import { SessionID } from "./session-id.js"
import { MetaAgent } from "./meta-agent.js"
import { SessionMessage } from "./session-message.js"
import { Permission } from "./permission.js"

export class Receipt extends Schema.Class<Receipt>("Delegation.Receipt")({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String,
  senderParticipantID: ParticipantID,
  attempt: Schema.Int,
  childSessionID: SessionID,
  inputID: SessionMessage.ID,
}) {}

export const DelegationStatus = Schema.Literals([
  "draft",
  "running",
  "waiting_review",
  "changes_requested",
  "approved",
  "failed",
  "recovery_required",
  "closing",
  "completed",
  "archived",
  "cancelled",
]).annotate({ identifier: "DelegationStatus" })
export type DelegationStatus = typeof DelegationStatus.Type

export const ParticipantRole = Schema.Literals(["implementer", "reviewer", "approver", "observer"]).annotate({
  identifier: "ParticipantRole",
})
export type ParticipantRole = typeof ParticipantRole.Type

export const ParticipantPhase = Schema.Literals(["provisioning", "active", "failed", "closed"]).annotate({
  identifier: "ParticipantPhase",
})
export type ParticipantPhase = typeof ParticipantPhase.Type

export const ParticipantRuntimeStatus = Schema.Literals(["running", "idle", "inactive"]).annotate({
  identifier: "ParticipantRuntimeStatus",
})
export type ParticipantRuntimeStatus = typeof ParticipantRuntimeStatus.Type

export const ParticipantContext = Schema.Literals(["fresh", "fork"]).annotate({
  identifier: "ParticipantContext",
})
export type ParticipantContext = typeof ParticipantContext.Type

export const TurnStatus = Schema.Literals([
  "admitted",
  "queued",
  "running",
  "partially_completed",
  "completed",
  "failed",
  "cancelled",
  "recovery_required",
]).annotate({
  identifier: "TurnStatus",
})
export type TurnStatus = typeof TurnStatus.Type

export const TurnKind = Schema.Literals(["task", "evidence", "review", "repair", "close"]).annotate({
  identifier: "TurnKind",
})
export type TurnKind = typeof TurnKind.Type

export const DeliveryIntent = Schema.Literals(["steer", "queue"]).annotate({
  identifier: "DeliveryIntent",
})
export type DeliveryIntent = typeof DeliveryIntent.Type

export const DeliveryStatus = Schema.Literals([
  "admitted",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "recovery_required",
]).annotate({ identifier: "DeliveryStatus" })
export type DeliveryStatus = typeof DeliveryStatus.Type

export const ReviewVerdict = Schema.Literals(["approved", "changes_requested", "rejected"]).annotate({
  identifier: "ReviewVerdict",
})
export type ReviewVerdict = typeof ReviewVerdict.Type

export const ReviewSeverity = Schema.Literals(["blocking", "major", "minor", "note"]).annotate({
  identifier: "ReviewSeverity",
})
export type ReviewSeverity = typeof ReviewSeverity.Type

export const RevisionDigest = Schema.String.check(Schema.isPattern(/^rev_[a-f0-9]{64}$/)).annotate({
  identifier: "RevisionDigest",
})
export type RevisionDigest = typeof RevisionDigest.Type

export const ChangeKind = Schema.Literals(["no_change", "no_code_change", "formatting_only", "rework"]).annotate({
  identifier: "ChangeKind",
})
export type ChangeKind = typeof ChangeKind.Type

export const ReviewFinding = Schema.Struct({
  file: optional(Schema.String.check(Schema.isMaxLength(1024))),
  line: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  severity: ReviewSeverity,
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  message: optional(Schema.String.check(Schema.isMaxLength(4096))),
}).annotate({ identifier: "DelegationReviewFinding" })
export type ReviewFinding = typeof ReviewFinding.Type

export const ReviewEnvelope = Schema.Struct({
  kind: Schema.Literal("aigcfroge.review.v1"),
  reviewed_revision_digest: RevisionDigest,
  verdict: ReviewVerdict,
  findings: Schema.Array(ReviewFinding).check(Schema.isMaxLength(100)),
  summary: optional(Schema.String.check(Schema.isMaxLength(4096))),
}).annotate({ identifier: "DelegationReviewEnvelope" })
export type ReviewEnvelope = typeof ReviewEnvelope.Type

export const DeliveryOrigin = Schema.Struct({
  turnID: TurnID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
}).annotate({ identifier: "DelegationDeliveryOrigin" })
export type DeliveryOrigin = typeof DeliveryOrigin.Type

export class Info extends Schema.Class<Info>("Delegation.Info")(
  Schema.Struct({
    id: DelegationID.ID,
    parentSessionID: SessionID,
    metaAgentID: optional(Schema.String),
    title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
    status: DelegationStatus,
    latestRevisionDigest: optional(RevisionDigest),
    rejectionBlocked: Schema.Boolean,
    rejectionReason: optional(Schema.String),
    rejectionParticipantID: optional(ParticipantID),
    lastActivityAt: Schema.Number,
    completedAt: optional(Schema.Number),
    closedAt: optional(Schema.Number),
    archivedAt: optional(Schema.Number),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }).annotate({ identifier: "Delegation.Info" }),
) {}

export class ParticipantInfo extends Schema.Class<ParticipantInfo>("Delegation.ParticipantInfo")(
  Schema.Struct({
    id: ParticipantID,
    delegationID: DelegationID.ID,
    provider: Schema.String,
    target: Schema.String,
    role: ParticipantRole,
    context: ParticipantContext,
    phase: ParticipantPhase,
    runtimeStatus: optional(ParticipantRuntimeStatus),
    childSessionID: optional(SessionID),
    executor: optional(MetaAgent.ExecutorBinding),
    externalThreadID: optional(Schema.String),
    lastActivityAt: Schema.Number,
    closedAt: optional(Schema.Number),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }).annotate({ identifier: "Delegation.ParticipantInfo" }),
) {}

export class TurnInfo extends Schema.Class<TurnInfo>("Delegation.TurnInfo")(
  Schema.Struct({
    id: TurnID,
    delegationID: DelegationID.ID,
    seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    kind: TurnKind,
    status: TurnStatus,
    promptSummary: optional(Schema.String.check(Schema.isMaxLength(1024))),
    evidenceDigest: optional(Schema.String.check(Schema.isMaxLength(1024))),
    revisionDigest: optional(RevisionDigest),
    participantIDs: Schema.Array(ParticipantID),
    delivery: DeliveryIntent,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }).annotate({ identifier: "Delegation.TurnInfo" }),
) {}

export class DeliveryInfo extends Schema.Class<DeliveryInfo>("Delegation.DeliveryInfo")({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String,
  senderParticipantID: ParticipantID,
  attempt: Schema.Int,
  provider: Schema.String,
  status: DeliveryStatus,
  current: Schema.Boolean,
  updatedAt: Schema.Number,
  summary: optional(Schema.String),
  errorCode: optional(Schema.String),
  receipt: optional(Receipt),
  source: optional(Permission.Source),
  parentTaskID: optional(Schema.String),
  externalThreadID: optional(Schema.String),
  externalTurnID: optional(Schema.String),
}) {}

export class Result extends Schema.Class<Result>("Delegation.Result")({
  delivery: DeliveryInfo,
  available: Schema.Boolean,
  text: optional(Schema.String),
}) {}

export class ReviewRecord extends Schema.Class<ReviewRecord>("Delegation.ReviewRecord")({
  participantID: ParticipantID,
  reviewedRevisionDigest: RevisionDigest,
  verdict: ReviewVerdict,
  findings: Schema.Array(ReviewFinding),
  summary: optional(Schema.String),
}) {}

export class RevisionRecord extends Schema.Class<RevisionRecord>("Delegation.RevisionRecord")({
  revisionDigest: RevisionDigest,
  changeKind: ChangeKind,
}) {}

export class Barrier extends Schema.Class<Barrier>("Delegation.Barrier")({
  passed: Schema.Boolean,
  reason: optional(Schema.String),
  missingRoles: optional(Schema.Array(ParticipantRole)),
  completionEligible: Schema.Boolean,
}) {}

// ── Tagged Errors ──

export class DelegationNotFoundError extends Schema.TaggedError<DelegationNotFoundError>()(
  "Delegation.DelegationNotFoundError",
  {
    delegationID: DelegationID.ID,
  },
) {
  override get message() {
    return `Delegation not found: ${this.delegationID}`
  }
}

export class DelegationParentSessionNotFoundError extends Schema.TaggedError<DelegationParentSessionNotFoundError>()(
  "Delegation.DelegationParentSessionNotFoundError",
  {
    parentSessionID: SessionID,
  },
) {
  override get message() {
    return `Parent session not found: ${this.parentSessionID}`
  }
}

export class DelegationInvalidStateError extends Schema.TaggedError<DelegationInvalidStateError>()(
  "Delegation.DelegationInvalidStateError",
  {
    delegationID: DelegationID.ID,
    currentStatus: Schema.String,
    attemptedTransition: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationParticipantNotFoundError extends Schema.TaggedError<DelegationParticipantNotFoundError>()(
  "Delegation.DelegationParticipantNotFoundError",
  {
    delegationID: DelegationID.ID,
    participantID: ParticipantID,
  },
) {
  override get message() {
    return `Participant ${this.participantID} was not found in delegation ${this.delegationID}`
  }
}

export class DelegationTurnNotFoundError extends Schema.TaggedError<DelegationTurnNotFoundError>()(
  "Delegation.DelegationTurnNotFoundError",
  {
    delegationID: DelegationID.ID,
    turnID: TurnID,
  },
) {
  override get message() {
    return `Turn ${this.turnID} was not found in delegation ${this.delegationID}`
  }
}

export class DelegationPermissionDeniedError extends Schema.TaggedError<DelegationPermissionDeniedError>()(
  "Delegation.DelegationPermissionDeniedError",
  {
    delegationID: DelegationID.ID,
    parentSessionID: SessionID,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationRecoveryRequiredError extends Schema.TaggedError<DelegationRecoveryRequiredError>()(
  "Delegation.DelegationRecoveryRequiredError",
  {
    delegationID: DelegationID.ID,
    participantID: optional(ParticipantID),
    turnID: optional(TurnID),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationRejectionBlockedError extends Schema.TaggedError<DelegationRejectionBlockedError>()(
  "Delegation.DelegationRejectionBlockedError",
  {
    delegationID: DelegationID.ID,
    participantID: optional(ParticipantID),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationBarrierNotMetError extends Schema.TaggedError<DelegationBarrierNotMetError>()(
  "Delegation.DelegationBarrierNotMetError",
  {
    delegationID: DelegationID.ID,
    missingRoles: Schema.Array(ParticipantRole),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationCorruptedEventError extends Schema.TaggedError<DelegationCorruptedEventError>()(
  "Delegation.DelegationCorruptedEventError",
  {
    delegationID: optional(DelegationID.ID),
    eventType: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationAggregateMismatchError extends Schema.TaggedError<DelegationAggregateMismatchError>()(
  "Delegation.DelegationAggregateMismatchError",
  {
    expectedDelegationID: DelegationID.ID,
    actualDelegationID: Schema.String,
  },
) {
  override get message() {
    return `Delegation aggregate mismatch: expected ${this.expectedDelegationID}, got ${this.actualDelegationID}`
  }
}

export class DelegationSequenceError extends Schema.TaggedError<DelegationSequenceError>()(
  "Delegation.DelegationSequenceError",
  {
    delegationID: DelegationID.ID,
    expectedSeq: Schema.Number,
    actualSeq: Schema.Number,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}
