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
  DelegationCorruptedEventError,
  DelegationAggregateMismatchError,
  DelegationSequenceError,
} from "@aigcfroge/schema/delegation"
import { DelegationID, type ParticipantID, type TurnID } from "@aigcfroge/schema/delegation-id"

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

function parseEvent<A>(
  decoder: (raw: unknown) => Option.Option<A>,
  raw: unknown,
  eventType: string,
  delegationID?: DelegationID.ID,
): A {
  const decoded = decoder(raw)
  if (Option.isNone(decoded)) {
    throw new DelegationCorruptedEventError({
      delegationID,
      eventType,
      reason: `Malformed event payload for: ${eventType}`,
    })
  }
  return decoded.value
}

function checkDataDelegationID(
  payloadDelegationID: DelegationID.ID,
  currentExpected: DelegationID.ID | undefined,
): DelegationID.ID {
  if (currentExpected === undefined) return payloadDelegationID
  if (payloadDelegationID !== currentExpected) {
    throw new DelegationAggregateMismatchError({
      expectedDelegationID: currentExpected,
      actualDelegationID: payloadDelegationID,
    })
  }
  return currentExpected
}

/**
 * Folds a sequence of durable delegation events into aggregated state (G1/G4/G5).
 * Replay is fully deterministic: event timestamps are used; no Date.now() calls.
 * Fails closed on aggregate mismatch, non-monotonic sequence, or malformed known events.
 */
export function foldDelegation(events: readonly EventV2.Payload[]): DelegationFoldState | undefined {
  if (!events || events.length === 0) return undefined

  let expectedDelegationID: DelegationID.ID | undefined
  let lastSeq = -1

  let delegation: DelegationInfo | undefined
  const participants = new Map<ParticipantID, ParticipantInfo>()
  const turns = new Map<TurnID, TurnInfo>()
  const deliveries = new Map<string, DeliveryState>()
  const reviews: FoldedReviewRecord[] = []

  const deliveryKey = (turnID: TurnID, participantID: ParticipantID, origin: string) =>
    `${turnID}:${participantID}:${origin}`

  for (const event of events) {
    // 1. Validate aggregate & monotonic sequence if durable header is present
    if (event.durable) {
      const aggId = DelegationID.ID.make(event.durable.aggregateID)
      if (expectedDelegationID === undefined) {
        expectedDelegationID = aggId
      } else if (aggId !== expectedDelegationID) {
        throw new DelegationAggregateMismatchError({
          expectedDelegationID,
          actualDelegationID: aggId,
        })
      }

      if (event.durable.seq <= lastSeq) {
        throw new DelegationSequenceError({
          delegationID: expectedDelegationID,
          expectedSeq: lastSeq + 1,
          actualSeq: event.durable.seq,
          reason: "Sequence must be strictly monotonic",
        })
      }
      lastSeq = event.durable.seq
    }

    const type = event.type

    // Ignore non-delegation events
    if (!type.startsWith("delegation.")) continue

    if (type === DelegationEvent.Created.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CreatedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      delegation = new Delegation.Info({
        id: data.delegationID,
        parentSessionID: data.parentSessionID,
        metaAgentID: data.metaAgentID,
        title: data.title,
        status: data.status,
        rejectionBlocked: false,
        lastActivityAt: data.timestamp,
        createdAt: data.timestamp,
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.ParticipantAdded.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ParticipantAddedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      participants.set(
        data.participantID,
        new Delegation.ParticipantInfo({
          id: data.participantID,
          delegationID: data.delegationID,
          provider: data.provider,
          target: data.target,
          role: data.role,
          context: data.context,
          phase: data.phase,
          runtimeStatus: undefined,
          childSessionID: data.childSessionID,
          externalThreadID: data.externalThreadID,
          lastActivityAt: data.timestamp,
          createdAt: data.timestamp,
          updatedAt: data.timestamp,
        }),
      )
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.ParticipantInterrupted.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ParticipantInterruptedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const p = participants.get(data.participantID)
      if (p) {
        participants.set(
          data.participantID,
          new Delegation.ParticipantInfo({
            ...p,
            phase: "failed",
            lastActivityAt: data.timestamp,
            updatedAt: data.timestamp,
          }),
        )
      }
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.ParticipantClosed.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ParticipantClosedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const p = participants.get(data.participantID)
      if (p) {
        participants.set(
          data.participantID,
          new Delegation.ParticipantInfo({
            ...p,
            phase: "closed",
            closedAt: data.timestamp,
            lastActivityAt: data.timestamp,
            updatedAt: data.timestamp,
          }),
        )
      }
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.TurnAdmitted.type || type === DelegationEvent.TurnAppended.type) {
      const decoder =
        type === DelegationEvent.TurnAdmitted.type
          ? Schema.decodeUnknownOption(DelegationEvent.TurnAdmittedData)
          : Schema.decodeUnknownOption(DelegationEvent.TurnAppendedData)
      const data = parseEvent(decoder, event.data, type, expectedDelegationID)
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      turns.set(
        data.turnID,
        new Delegation.TurnInfo({
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
          createdAt: data.timestamp,
          updatedAt: data.timestamp,
        }),
      )
      if (delegation) {
        const nextStatus = delegation.status === "draft" ? "running" : delegation.status
        delegation = new Delegation.Info({
          ...delegation,
          status: nextStatus,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.DeliveryStarted.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.DeliveryStartedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: "running",
      })
      const turn = turns.get(data.turnID)
      if (turn && turn.status === "admitted") {
        turns.set(
          data.turnID,
          new Delegation.TurnInfo({
            ...turn,
            status: "running",
            updatedAt: data.timestamp,
          }),
        )
      }
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.DeliveryCompleted.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.DeliveryCompletedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        attempt: data.attempt,
        status: "completed",
        externalTurnID: data.externalTurnID,
        summary: data.summary,
      })
      const turn = turns.get(data.turnID)
      if (turn) {
        turns.set(
          data.turnID,
          new Delegation.TurnInfo({
            ...turn,
            status: "completed",
            updatedAt: data.timestamp,
          }),
        )
      }
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.DeliveryFailed.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.DeliveryFailedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        attempt: data.attempt,
        status: "failed",
        errorCode: data.errorCode,
        summary: data.summary,
      })
      const turn = turns.get(data.turnID)
      if (turn) {
        turns.set(
          data.turnID,
          new Delegation.TurnInfo({
            ...turn,
            status: "failed",
            updatedAt: data.timestamp,
          }),
        )
      }
      if (delegation && delegation.status !== "failed" && delegation.status !== "archived") {
        delegation = new Delegation.Info({
          ...delegation,
          status: "failed",
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.DeliveryRecoveryRequired.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.DeliveryRecoveryRequiredData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        attempt: data.attempt,
        status: "recovery_required",
        errorCode: data.errorCode,
        summary: data.summary,
      })
      if (delegation && delegation.status !== "archived") {
        delegation = new Delegation.Info({
          ...delegation,
          status: "recovery_required",
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.RevisionRecorded.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.RevisionRecordedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          latestRevisionDigest: data.revisionDigest,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
      const turn = turns.get(data.turnID)
      if (turn) {
        turns.set(
          data.turnID,
          new Delegation.TurnInfo({
            ...turn,
            revisionDigest: data.revisionDigest,
            updatedAt: data.timestamp,
          }),
        )
      }
    } else if (type === DelegationEvent.ReviewApproved.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ReviewApprovedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      reviews.push({
        participantID: data.participantID,
        reviewedRevisionDigest: data.reviewedRevisionDigest,
        verdict: "approved",
        findings: data.findings,
        summary: data.summary,
      })
      if (
        delegation &&
        (delegation.status === "running" ||
          delegation.status === "waiting_review" ||
          delegation.status === "changes_requested")
      ) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "approved",
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.ReviewChangesRequested.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ReviewChangesRequestedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      reviews.push({
        participantID: data.participantID,
        reviewedRevisionDigest: data.reviewedRevisionDigest,
        verdict: "changes_requested",
        findings: data.findings,
        summary: data.summary,
      })
      if (delegation && (delegation.status === "running" || delegation.status === "waiting_review")) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "changes_requested",
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.ReviewRejected.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ReviewRejectedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      reviews.push({
        participantID: data.participantID,
        reviewedRevisionDigest: data.reviewedRevisionDigest,
        verdict: "rejected",
        findings: data.findings,
        summary: data.summary,
      })
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          rejectionBlocked: true,
          rejectionReason: data.summary ?? "Review rejected",
          rejectionParticipantID: data.participantID,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.RejectionRetracted.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.RejectionRetractedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          rejectionBlocked: false,
          rejectionReason: undefined,
          rejectionParticipantID: undefined,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.Closing.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ClosingData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "closing",
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.Completed.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CompletedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "completed",
          completedAt: data.timestamp,
          closedAt: data.timestamp,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.Cancelled.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CancelledData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "cancelled",
          closedAt: data.timestamp,
          lastActivityAt: data.timestamp,
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.Archived.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ArchivedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          status: "archived",
          archivedAt: data.timestamp,
          lastActivityAt: data.timestamp,
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.Forked.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ForkedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else {
      throw new DelegationCorruptedEventError({
        delegationID: expectedDelegationID,
        eventType: type,
        reason: `Unknown delegation event type: ${type}`,
      })
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
