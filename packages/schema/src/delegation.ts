export * as Delegation from "./delegation"

import { Schema } from "effect"
import { ID as DelegationID, ParticipantID, TurnID } from "./delegation-id"
import { ID as SessionID } from "./session-id"

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
  file: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  severity: ReviewSeverity,
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
}).annotate({ identifier: "DelegationReviewFinding" })
export type ReviewFinding = typeof ReviewFinding.Type

export const ReviewEnvelope = Schema.Struct({
  kind: Schema.Literal("aigcfroge.review.v1"),
  reviewed_revision_digest: RevisionDigest,
  verdict: ReviewVerdict,
  findings: Schema.Array(ReviewFinding).check(Schema.isMaxLength(100)),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
}).annotate({ identifier: "DelegationReviewEnvelope" })
export type ReviewEnvelope = typeof ReviewEnvelope.Type

export const DeliveryOrigin = Schema.Struct({
  turnID: TurnID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
}).annotate({ identifier: "DelegationDeliveryOrigin" })
export type DeliveryOrigin = typeof DeliveryOrigin.Type

export class Info extends Schema.Class<Info>("Delegation.Info")({
  id: DelegationID,
  parentSessionID: SessionID,
  metaAgentID: Schema.optional(Schema.String),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  status: DelegationStatus,
  latestRevisionDigest: Schema.optional(RevisionDigest),
  rejectionBlocked: Schema.Boolean,
  rejectionReason: Schema.optional(Schema.String),
  rejectionParticipantID: Schema.optional(ParticipantID),
  lastActivityAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  closedAt: Schema.optional(Schema.Number),
  archivedAt: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class ParticipantInfo extends Schema.Class<ParticipantInfo>("Delegation.ParticipantInfo")({
  id: ParticipantID,
  delegationID: DelegationID,
  provider: Schema.String,
  target: Schema.String,
  role: ParticipantRole,
  context: ParticipantContext,
  phase: ParticipantPhase,
  runtimeStatus: Schema.optional(ParticipantRuntimeStatus),
  childSessionID: Schema.optional(SessionID),
  externalThreadID: Schema.optional(Schema.String),
  lastActivityAt: Schema.Number,
  closedAt: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class TurnInfo extends Schema.Class<TurnInfo>("Delegation.TurnInfo")({
  id: TurnID,
  delegationID: DelegationID,
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: TurnKind,
  status: TurnStatus,
  promptSummary: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  evidenceDigest: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  revisionDigest: Schema.optional(RevisionDigest),
  participantIDs: Schema.Array(ParticipantID),
  delivery: DeliveryIntent,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

// ── Tagged Errors ──

export class DelegationNotFoundError extends Schema.TaggedErrorClass<DelegationNotFoundError>()(
  "Delegation.DelegationNotFoundError",
  {
    delegationID: DelegationID,
  },
) {
  override get message() {
    return `Delegation not found: ${this.delegationID}`
  }
}

export class DelegationParentSessionNotFoundError extends Schema.TaggedErrorClass<DelegationParentSessionNotFoundError>()(
  "Delegation.DelegationParentSessionNotFoundError",
  {
    parentSessionID: SessionID,
  },
) {
  override get message() {
    return `Parent session not found: ${this.parentSessionID}`
  }
}

export class DelegationInvalidStateError extends Schema.TaggedErrorClass<DelegationInvalidStateError>()(
  "Delegation.DelegationInvalidStateError",
  {
    delegationID: DelegationID,
    currentStatus: Schema.String,
    attemptedTransition: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationParticipantNotFoundError extends Schema.TaggedErrorClass<DelegationParticipantNotFoundError>()(
  "Delegation.DelegationParticipantNotFoundError",
  {
    delegationID: DelegationID,
    participantID: ParticipantID,
  },
) {
  override get message() {
    return `Participant ${this.participantID} was not found in delegation ${this.delegationID}`
  }
}

export class DelegationTurnNotFoundError extends Schema.TaggedErrorClass<DelegationTurnNotFoundError>()(
  "Delegation.DelegationTurnNotFoundError",
  {
    delegationID: DelegationID,
    turnID: TurnID,
  },
) {
  override get message() {
    return `Turn ${this.turnID} was not found in delegation ${this.delegationID}`
  }
}

export class DelegationPermissionDeniedError extends Schema.TaggedErrorClass<DelegationPermissionDeniedError>()(
  "Delegation.DelegationPermissionDeniedError",
  {
    delegationID: DelegationID,
    parentSessionID: SessionID,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationRecoveryRequiredError extends Schema.TaggedErrorClass<DelegationRecoveryRequiredError>()(
  "Delegation.DelegationRecoveryRequiredError",
  {
    delegationID: DelegationID,
    participantID: Schema.optional(ParticipantID),
    turnID: Schema.optional(TurnID),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationRejectionBlockedError extends Schema.TaggedErrorClass<DelegationRejectionBlockedError>()(
  "Delegation.DelegationRejectionBlockedError",
  {
    delegationID: DelegationID,
    participantID: Schema.optional(ParticipantID),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationBarrierNotMetError extends Schema.TaggedErrorClass<DelegationBarrierNotMetError>()(
  "Delegation.DelegationBarrierNotMetError",
  {
    delegationID: DelegationID,
    missingRoles: Schema.Array(ParticipantRole),
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationCorruptedEventError extends Schema.TaggedErrorClass<DelegationCorruptedEventError>()(
  "Delegation.DelegationCorruptedEventError",
  {
    delegationID: Schema.optional(DelegationID),
    eventType: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class DelegationAggregateMismatchError extends Schema.TaggedErrorClass<DelegationAggregateMismatchError>()(
  "Delegation.DelegationAggregateMismatchError",
  {
    expectedDelegationID: DelegationID,
    actualDelegationID: Schema.String,
  },
) {
  override get message() {
    return `Delegation aggregate mismatch: expected ${this.expectedDelegationID}, got ${this.actualDelegationID}`
  }
}

export class DelegationSequenceError extends Schema.TaggedErrorClass<DelegationSequenceError>()(
  "Delegation.DelegationSequenceError",
  {
    delegationID: DelegationID,
    expectedSeq: Schema.Number,
    actualSeq: Schema.Number,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}
