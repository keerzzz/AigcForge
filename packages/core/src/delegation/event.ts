export * as DelegationEvent from "./event"

import { Schema } from "effect"
import { EventV2 } from "../event"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import {
  DelegationStatus,
  ParticipantRole,
  ParticipantContext,
  ParticipantPhase,
  TurnKind,
  DeliveryIntent,
  ReviewFinding,
  ChangeKind,
  RevisionDigest,
} from "@aigcfroge/schema/delegation"

const options = {
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
} as const

export const CreatedData = Schema.Struct({
  delegationID: DelegationID.ID,
  parentSessionID: SessionID,
  metaAgentID: Schema.optional(Schema.String),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  status: DelegationStatus,
  timestamp: Schema.Number,
})
export type CreatedData = typeof CreatedData.Type
export const Created = EventV2.define({
  type: "delegation.created",
  ...options,
  schema: CreatedData.fields,
})

export const ParticipantAddedData = Schema.Struct({
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  provider: Schema.String.check(Schema.isMinLength(1)),
  target: Schema.String.check(Schema.isMinLength(1)),
  role: ParticipantRole,
  context: ParticipantContext,
  phase: ParticipantPhase,
  childSessionID: Schema.optional(SessionID),
  externalThreadID: Schema.optional(Schema.String),
  timestamp: Schema.Number,
})
export type ParticipantAddedData = typeof ParticipantAddedData.Type
export const ParticipantAdded = EventV2.define({
  type: "delegation.participant_added",
  ...options,
  schema: ParticipantAddedData.fields,
})

export const ParticipantBoundData = Schema.Struct({
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  childSessionID: Schema.optional(SessionID),
  externalThreadID: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  timestamp: Schema.Number,
})
export type ParticipantBoundData = typeof ParticipantBoundData.Type
export const ParticipantBound = EventV2.define({
  type: "delegation.participant_bound",
  ...options,
  schema: ParticipantBoundData.fields,
})

export const ParticipantInterruptedData = Schema.Struct({
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type ParticipantInterruptedData = typeof ParticipantInterruptedData.Type
export const ParticipantInterrupted = EventV2.define({
  type: "delegation.participant_interrupted",
  ...options,
  schema: ParticipantInterruptedData.fields,
})

export const ParticipantClosedData = Schema.Struct({
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type ParticipantClosedData = typeof ParticipantClosedData.Type
export const ParticipantClosed = EventV2.define({
  type: "delegation.participant_closed",
  ...options,
  schema: ParticipantClosedData.fields,
})

export const TurnAdmittedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: TurnKind,
  promptSummary: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  evidenceDigest: Schema.optional(Schema.String),
  revisionDigest: Schema.optional(RevisionDigest),
  participantIDs: Schema.Array(ParticipantID),
  delivery: DeliveryIntent,
  timestamp: Schema.Number,
})
export type TurnAdmittedData = typeof TurnAdmittedData.Type
export const TurnAdmitted = EventV2.define({
  type: "delegation.turn_admitted",
  ...options,
  schema: TurnAdmittedData.fields,
})

export const TurnAppendedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: TurnKind,
  promptSummary: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  evidenceDigest: Schema.optional(Schema.String),
  revisionDigest: Schema.optional(RevisionDigest),
  participantIDs: Schema.Array(ParticipantID),
  delivery: DeliveryIntent,
  timestamp: Schema.Number,
})
export type TurnAppendedData = typeof TurnAppendedData.Type
export const TurnAppended = EventV2.define({
  type: "delegation.turn_appended",
  ...options,
  schema: TurnAppendedData.fields,
})

export const DeliveryAdmittedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.Literals(["admitted", "queued"]),
  timestamp: Schema.Number,
})
export type DeliveryAdmittedData = typeof DeliveryAdmittedData.Type
export const DeliveryAdmitted = EventV2.define({
  type: "delegation.delivery_admitted",
  ...options,
  schema: DeliveryAdmittedData.fields,
})

export const DeliveryStartedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  timestamp: Schema.Number,
})
export type DeliveryStartedData = typeof DeliveryStartedData.Type
export const DeliveryStarted = EventV2.define({
  type: "delegation.delivery_started",
  ...options,
  schema: DeliveryStartedData.fields,
})

export const DeliveryCompletedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  externalTurnID: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type DeliveryCompletedData = typeof DeliveryCompletedData.Type
export const DeliveryCompleted = EventV2.define({
  type: "delegation.delivery_completed",
  ...options,
  schema: DeliveryCompletedData.fields,
})

export const DeliveryFailedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  errorCode: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type DeliveryFailedData = typeof DeliveryFailedData.Type
export const DeliveryFailed = EventV2.define({
  type: "delegation.delivery_failed",
  ...options,
  schema: DeliveryFailedData.fields,
})

export const DeliveryCancelledData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type DeliveryCancelledData = typeof DeliveryCancelledData.Type
export const DeliveryCancelled = EventV2.define({
  type: "delegation.delivery_cancelled",
  ...options,
  schema: DeliveryCancelledData.fields,
})

export const DeliveryRecoveryRequiredData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  senderParticipantID: ParticipantID,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  errorCode: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type DeliveryRecoveryRequiredData = typeof DeliveryRecoveryRequiredData.Type
export const DeliveryRecoveryRequired = EventV2.define({
  type: "delegation.delivery_recovery_required",
  ...options,
  schema: DeliveryRecoveryRequiredData.fields,
})

export const RevisionRecordedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  commitSha: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  revisionDigest: RevisionDigest,
  changeKind: ChangeKind,
  diffSummary: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type RevisionRecordedData = typeof RevisionRecordedData.Type
export const RevisionRecorded = EventV2.define({
  type: "delegation.revision_recorded",
  ...options,
  schema: RevisionRecordedData.fields,
})

export const ReviewApprovedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  reviewedRevisionDigest: RevisionDigest,
  findings: Schema.Array(ReviewFinding).check(Schema.isMaxLength(100)),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type ReviewApprovedData = typeof ReviewApprovedData.Type
export const ReviewApproved = EventV2.define({
  type: "delegation.review_approved",
  ...options,
  schema: ReviewApprovedData.fields,
})

export const ReviewChangesRequestedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  reviewedRevisionDigest: RevisionDigest,
  findings: Schema.Array(ReviewFinding).check(Schema.isMaxLength(100)),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type ReviewChangesRequestedData = typeof ReviewChangesRequestedData.Type
export const ReviewChangesRequested = EventV2.define({
  type: "delegation.review_changes_requested",
  ...options,
  schema: ReviewChangesRequestedData.fields,
})

export const ReviewRejectedData = Schema.Struct({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  reviewedRevisionDigest: RevisionDigest,
  findings: Schema.Array(ReviewFinding).check(Schema.isMaxLength(100)),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type ReviewRejectedData = typeof ReviewRejectedData.Type
export const ReviewRejected = EventV2.define({
  type: "delegation.review_rejected",
  ...options,
  schema: ReviewRejectedData.fields,
})

export const RejectionRetractedData = Schema.Struct({
  delegationID: DelegationID.ID,
  participantID: Schema.optional(ParticipantID),
  reason: Schema.String.check(Schema.isMaxLength(1000)),
  timestamp: Schema.Number,
})
export type RejectionRetractedData = typeof RejectionRetractedData.Type
export const RejectionRetracted = EventV2.define({
  type: "delegation.rejection_retracted",
  ...options,
  schema: RejectionRetractedData.fields,
})

export const ClosingData = Schema.Struct({
  delegationID: DelegationID.ID,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type ClosingData = typeof ClosingData.Type
export const Closing = EventV2.define({
  type: "delegation.closing",
  ...options,
  schema: ClosingData.fields,
})

export const CompletedData = Schema.Struct({
  delegationID: DelegationID.ID,
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  timestamp: Schema.Number,
})
export type CompletedData = typeof CompletedData.Type
export const Completed = EventV2.define({
  type: "delegation.completed",
  ...options,
  schema: CompletedData.fields,
})

export const CancelledData = Schema.Struct({
  delegationID: DelegationID.ID,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type CancelledData = typeof CancelledData.Type
export const Cancelled = EventV2.define({
  type: "delegation.cancelled",
  ...options,
  schema: CancelledData.fields,
})

export const ArchivedData = Schema.Struct({
  delegationID: DelegationID.ID,
  timestamp: Schema.Number,
})
export type ArchivedData = typeof ArchivedData.Type
export const Archived = EventV2.define({
  type: "delegation.archived",
  ...options,
  schema: ArchivedData.fields,
})

export const ForkedData = Schema.Struct({
  delegationID: DelegationID.ID,
  forkedDelegationID: DelegationID.ID,
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  timestamp: Schema.Number,
})
export type ForkedData = typeof ForkedData.Type
export const Forked = EventV2.define({
  type: "delegation.forked",
  ...options,
  schema: ForkedData.fields,
})
