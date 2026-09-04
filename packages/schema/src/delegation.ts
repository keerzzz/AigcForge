export * as Delegation from "./delegation"

import { Schema } from "effect"
import { ID as DelegationID, ParticipantID, TurnID } from "./delegation-id"
import { ID as SessionID } from "./session-id"

export const DelegationStatus = Schema.Literals([
  "draft",
  "running",
  "waiting_review",
  "approved",
  "completed",
  "cancelled",
  "archived",
]).annotate({ identifier: "DelegationStatus" })
export type DelegationStatus = typeof DelegationStatus.Type

export const ParticipantRole = Schema.Literals(["implementer", "reviewer", "approver", "observer"]).annotate({
  identifier: "ParticipantRole",
})
export type ParticipantRole = typeof ParticipantRole.Type

export const ParticipantPhase = Schema.Literals(["provisioning", "active", "failed"]).annotate({
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

export const TurnStatus = Schema.Literals(["admitted", "running", "settled", "failed", "cancelled"]).annotate({
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
  "dispatching",
  "running",
  "settled",
  "failed",
  "recovery_required",
  "cancelled",
]).annotate({ identifier: "DeliveryStatus" })
export type DeliveryStatus = typeof DeliveryStatus.Type

export const ReviewVerdict = Schema.Literals(["approved", "changes_requested", "rejected"]).annotate({
  identifier: "ReviewVerdict",
})
export type ReviewVerdict = typeof ReviewVerdict.Type

export const ChangeKind = Schema.Literals(["no_change", "no_code_change", "formatting_only", "rework"]).annotate({
  identifier: "ChangeKind",
})
export type ChangeKind = typeof ChangeKind.Type

export const ReviewFinding = Schema.Struct({
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  severity: Schema.Literals(["info", "warning", "error"]),
  message: Schema.String,
}).annotate({ identifier: "DelegationReviewFinding" })
export type ReviewFinding = typeof ReviewFinding.Type

export const ReviewEnvelope = Schema.Struct({
  reviewedRevisionDigest: Schema.String,
  verdict: ReviewVerdict,
  findings: Schema.Array(ReviewFinding),
  summary: Schema.optional(Schema.String),
}).annotate({ identifier: "DelegationReviewEnvelope" })
export type ReviewEnvelope = typeof ReviewEnvelope.Type

export const DeliveryOrigin = Schema.Struct({
  turnID: TurnID,
  deliveryOrigin: Schema.String,
  senderParticipantID: Schema.optional(ParticipantID),
}).annotate({ identifier: "DelegationDeliveryOrigin" })
export type DeliveryOrigin = typeof DeliveryOrigin.Type

export class Info extends Schema.Class<Info>("Delegation.Info")({
  id: DelegationID,
  parentSessionID: SessionID,
  metaAgentID: Schema.optional(Schema.String),
  title: Schema.String.check(Schema.isMinLength(1)),
  status: DelegationStatus,
  activeTurnID: Schema.optional(TurnID),
  latestRevisionDigest: Schema.optional(Schema.String),
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
  runtimeStatus: ParticipantRuntimeStatus,
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
  seq: Schema.Number,
  kind: TurnKind,
  status: TurnStatus,
  prompt: Schema.optional(Schema.String),
  evidenceDigest: Schema.optional(Schema.String),
  revisionDigest: Schema.optional(Schema.String),
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
) {}

export class DelegationInvalidStateError extends Schema.TaggedErrorClass<DelegationInvalidStateError>()(
  "Delegation.DelegationInvalidStateError",
  {
    delegationID: DelegationID,
    currentStatus: Schema.String,
    attemptedTransition: Schema.String,
    reason: Schema.String,
  },
) {}

export class DelegationParticipantNotFoundError extends Schema.TaggedErrorClass<DelegationParticipantNotFoundError>()(
  "Delegation.DelegationParticipantNotFoundError",
  {
    delegationID: DelegationID,
    participantID: ParticipantID,
  },
) {}

export class DelegationTurnNotFoundError extends Schema.TaggedErrorClass<DelegationTurnNotFoundError>()(
  "Delegation.DelegationTurnNotFoundError",
  {
    delegationID: DelegationID,
    turnID: TurnID,
  },
) {}

export class DelegationPermissionDeniedError extends Schema.TaggedErrorClass<DelegationPermissionDeniedError>()(
  "Delegation.DelegationPermissionDeniedError",
  {
    delegationID: DelegationID,
    parentSessionID: SessionID,
    reason: Schema.String,
  },
) {}

export class DelegationRecoveryRequiredError extends Schema.TaggedErrorClass<DelegationRecoveryRequiredError>()(
  "Delegation.DelegationRecoveryRequiredError",
  {
    delegationID: DelegationID,
    participantID: Schema.optional(ParticipantID),
    turnID: Schema.optional(TurnID),
    reason: Schema.String,
  },
) {}

export class DelegationRejectionBlockedError extends Schema.TaggedErrorClass<DelegationRejectionBlockedError>()(
  "Delegation.DelegationRejectionBlockedError",
  {
    delegationID: DelegationID,
    participantID: Schema.optional(ParticipantID),
    reason: Schema.String,
  },
) {}

export class DelegationBarrierNotMetError extends Schema.TaggedErrorClass<DelegationBarrierNotMetError>()(
  "Delegation.DelegationBarrierNotMetError",
  {
    delegationID: DelegationID,
    missingRoles: Schema.Array(ParticipantRole),
    reason: Schema.String,
  },
) {}
