export * as DelegationFold from "./fold"

import { Option, Schema } from "effect"
import { EventV2 } from "../event"
import { DelegationEvent } from "./event"
import {
  Delegation,
  type Info as DelegationInfo,
  type ParticipantInfo,
  type TurnInfo,
  type DeliveryStatus,
  type ReviewVerdict,
  type ReviewFinding,
  type ParticipantPhase,
  type ParticipantRuntimeStatus,
} from "@aigcfroge/schema/delegation"
import type { ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"

export interface DeliveryState {
  turnID: TurnID
  participantID: ParticipantID
  deliveryOrigin: string
  senderParticipantID?: ParticipantID
  attempt: number
  status: DeliveryStatus
  externalTurnID?: string
  summary?: string
  errorCode?: string
}

export interface FoldedReviewRecord {
  participantID: ParticipantID
  reviewedRevisionDigest: string
  verdict: ReviewVerdict
  findings: readonly ReviewFinding[]
  summary?: string
}

export interface DelegationFoldState {
  delegation: DelegationInfo
  participants: Map<ParticipantID, ParticipantInfo>
  turns: Map<TurnID, TurnInfo>
  deliveries: Map<string, DeliveryState>
  reviews: FoldedReviewRecord[]
}

/**
 * Folds a sequence of durable delegation events into aggregated state (G1/G4/G5).
 */
export function foldDelegation(events: readonly EventV2.Payload[]): DelegationFoldState | undefined {
  if (!events || events.length === 0) return undefined

  let delegation: DelegationInfo | undefined
  const participants = new Map<ParticipantID, ParticipantInfo>()
  const turns = new Map<TurnID, TurnInfo>()
  const deliveries = new Map<string, DeliveryState>()
  const reviews: FoldedReviewRecord[] = []

  const deliveryKey = (turnID: TurnID, participantID: ParticipantID, origin: string) =>
    `${turnID}:${participantID}:${origin}`

  for (const event of events) {
    const type = event.type

    if (type === DelegationEvent.Created.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.Created.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      const now = Date.now()
      delegation = new Delegation.Info({
        id: data.delegationID,
        parentSessionID: data.parentSessionID,
        metaAgentID: data.metaAgentID,
        title: data.title,
        status: data.status,
        rejectionBlocked: false,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
    } else if (type === DelegationEvent.ParticipantAdded.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.ParticipantAdded.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      const now = Date.now()
      const participant = new Delegation.ParticipantInfo({
        id: data.participantID,
        delegationID: data.delegationID,
        provider: data.provider,
        target: data.target,
        role: data.role,
        context: data.context,
        phase: data.phase,
        runtimeStatus: data.runtimeStatus,
        childSessionID: data.childSessionID,
        externalThreadID: data.externalThreadID,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      participants.set(data.participantID, participant)
    } else if (type === DelegationEvent.TurnAdmitted.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.TurnAdmitted.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      const now = Date.now()
      const turn = new Delegation.TurnInfo({
        id: data.turnID,
        delegationID: data.delegationID,
        seq: data.seq,
        kind: data.kind,
        status: "admitted",
        prompt: data.prompt,
        evidenceDigest: data.evidenceDigest,
        revisionDigest: data.revisionDigest,
        participantIDs: data.participantIDs,
        delivery: data.delivery,
        createdAt: now,
        updatedAt: now,
      })
      turns.set(data.turnID, turn)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          activeTurnID: data.turnID,
          lastActivityAt: now,
          updatedAt: now,
        })
      }
    } else if (type === DelegationEvent.DeliveryAdmitted.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.DeliveryAdmitted.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: data.status,
      })
    } else if (type === DelegationEvent.DeliveryUpdated.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.DeliveryUpdated.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      const existing = deliveries.get(key)
      if (existing) {
        deliveries.set(key, {
          ...existing,
          attempt: data.attempt,
          status: data.status,
          externalTurnID: data.externalTurnID ?? existing.externalTurnID,
          summary: data.summary ?? existing.summary,
          errorCode: data.errorCode ?? existing.errorCode,
        })
      }

      // Update participant status while preserving monotonic roster phase (G5)
      const participant = participants.get(data.participantID)
      if (participant) {
        let newPhase: ParticipantPhase = participant.phase
        if (data.status === "failed") {
          newPhase = "failed"
        }
        // If participant phase is failed, late runtime heartbeat cannot overwrite it to active
        const newRuntimeStatus: ParticipantRuntimeStatus = data.runtimeStatus ?? participant.runtimeStatus

        participants.set(
          data.participantID,
          new Delegation.ParticipantInfo({
            ...participant,
            phase: newPhase,
            runtimeStatus: newRuntimeStatus,
            lastActivityAt: Date.now(),
            updatedAt: Date.now(),
          }),
        )
      }
    } else if (type === DelegationEvent.RevisionRecorded.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.RevisionRecorded.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          latestRevisionDigest: data.revisionDigest,
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
    } else if (type === DelegationEvent.ReviewRecorded.type) {
      const decoded = Schema.decodeUnknownOption(DelegationEvent.ReviewRecorded.data)(event.data)
      if (Option.isNone(decoded)) continue
      const data = decoded.value
      reviews.push({
        participantID: data.participantID,
        reviewedRevisionDigest: data.reviewedRevisionDigest,
        verdict: data.verdict,
        findings: data.findings,
        summary: data.summary,
      })

      // G4: Rejected establishes sticky blocker
      if (data.verdict === "rejected" && delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          rejectionBlocked: true,
          rejectionReason: data.findings?.[0]?.message ?? data.summary ?? "Review rejected",
          rejectionParticipantID: data.participantID,
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
    } else if (type === DelegationEvent.RejectionRetracted.type) {
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          rejectionBlocked: false,
          rejectionReason: undefined,
          rejectionParticipantID: undefined,
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
    } else if (type === DelegationEvent.Completed.type) {
      if (delegation) {
        const now = Date.now()
        delegation = new Delegation.Info({
          ...delegation,
          status: "completed",
          completedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        })
      }
    } else if (type === DelegationEvent.Closed.type) {
      if (delegation) {
        const now = Date.now()
        delegation = new Delegation.Info({
          ...delegation,
          status: "cancelled",
          closedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        })
      }
    } else if (type === DelegationEvent.Archived.type) {
      if (delegation) {
        const now = Date.now()
        delegation = new Delegation.Info({
          ...delegation,
          status: "archived",
          archivedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        })
      }
    }
  }

  if (!delegation) return undefined

  return {
    delegation,
    participants,
    turns,
    deliveries,
    reviews,
  }
}
