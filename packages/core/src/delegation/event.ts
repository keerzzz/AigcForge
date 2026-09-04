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
  ParticipantRuntimeStatus,
  TurnKind,
  DeliveryIntent,
  DeliveryStatus,
  ReviewVerdict,
  ReviewFinding,
  ChangeKind,
} from "@aigcfroge/schema/delegation"

export const Created = EventV2.define({
  type: "delegation.created",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    parentSessionID: SessionID,
    metaAgentID: Schema.optional(Schema.String),
    title: Schema.String,
    status: DelegationStatus,
  },
})

export const ParticipantAdded = EventV2.define({
  type: "delegation.participant_added",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    participantID: ParticipantID,
    provider: Schema.String,
    target: Schema.String,
    role: ParticipantRole,
    context: ParticipantContext,
    phase: ParticipantPhase,
    runtimeStatus: ParticipantRuntimeStatus,
    childSessionID: Schema.optional(SessionID),
    externalThreadID: Schema.optional(Schema.String),
  },
})

export const TurnAdmitted = EventV2.define({
  type: "delegation.turn_admitted",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    turnID: TurnID,
    seq: Schema.Number,
    kind: TurnKind,
    prompt: Schema.optional(Schema.String),
    evidenceDigest: Schema.optional(Schema.String),
    revisionDigest: Schema.optional(Schema.String),
    participantIDs: Schema.Array(ParticipantID),
    delivery: DeliveryIntent,
  },
})

export const DeliveryAdmitted = EventV2.define({
  type: "delegation.delivery_admitted",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    turnID: TurnID,
    participantID: ParticipantID,
    deliveryOrigin: Schema.String,
    senderParticipantID: Schema.optional(ParticipantID),
    attempt: Schema.Number,
    status: DeliveryStatus,
  },
})

export const DeliveryUpdated = EventV2.define({
  type: "delegation.delivery_updated",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    turnID: TurnID,
    participantID: ParticipantID,
    deliveryOrigin: Schema.String,
    attempt: Schema.Number,
    status: DeliveryStatus,
    externalTurnID: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    errorCode: Schema.optional(Schema.String),
    runtimeStatus: Schema.optional(ParticipantRuntimeStatus),
  },
})

export const RevisionRecorded = EventV2.define({
  type: "delegation.revision_recorded",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    turnID: TurnID,
    participantID: ParticipantID,
    commitSha: Schema.String,
    normalizedDiff: Schema.String,
    revisionDigest: Schema.String,
    changeKind: ChangeKind,
  },
})

export const ReviewRecorded = EventV2.define({
  type: "delegation.review_recorded",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    turnID: TurnID,
    participantID: ParticipantID,
    reviewedRevisionDigest: Schema.String,
    verdict: ReviewVerdict,
    findings: Schema.Array(ReviewFinding),
    summary: Schema.optional(Schema.String),
  },
})

export const RejectionRetracted = EventV2.define({
  type: "delegation.rejection_retracted",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    participantID: Schema.optional(ParticipantID),
    reason: Schema.String,
  },
})

export const Completed = EventV2.define({
  type: "delegation.completed",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    summary: Schema.optional(Schema.String),
  },
})

export const Closed = EventV2.define({
  type: "delegation.closed",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
    reason: Schema.optional(Schema.String),
  },
})

export const Archived = EventV2.define({
  type: "delegation.archived",
  durable: {
    version: 1,
    aggregate: "delegationID",
  },
  schema: {
    delegationID: DelegationID.ID,
  },
})
