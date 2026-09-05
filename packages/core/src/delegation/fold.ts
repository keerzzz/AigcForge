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
  type RevisionDigest,
  type ReviewFinding,
  DelegationCorruptedEventError,
  DelegationAggregateMismatchError,
  DelegationSequenceError,
} from "@aigcfroge/schema/delegation"
import { DelegationID, type ParticipantID, type TurnID } from "@aigcfroge/schema/delegation-id"
import { canComplete, type RevisionRecord } from "./review"
import { canAdvancePhase, canTransition } from "./state"

export interface DeliveryState {
  turnID: TurnID
  participantID: ParticipantID
  deliveryOrigin: string
  senderParticipantID: ParticipantID
  attempt: number
  status: DeliveryStatus
  externalTurnID?: string
  summary?: string
  errorCode?: string
  updatedAt: number
}

export interface FoldedReviewRecord {
  participantID: ParticipantID
  reviewedRevisionDigest: RevisionDigest
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
  revisions: RevisionRecord[]
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

function corrupted(delegationID: DelegationID.ID | undefined, eventType: string, reason: string): never {
  throw new DelegationCorruptedEventError({ delegationID, eventType, reason })
}

function requireDelegation(
  delegation: DelegationInfo | undefined,
  delegationID: DelegationID.ID,
  eventType: string,
): DelegationInfo {
  if (delegation === undefined) corrupted(delegationID, eventType, "Delegation event precedes delegation.created")
  return delegation
}

function requireParticipant(
  participants: Map<ParticipantID, ParticipantInfo>,
  participantID: ParticipantID,
  delegationID: DelegationID.ID,
  eventType: string,
): ParticipantInfo {
  const participant = participants.get(participantID)
  if (participant === undefined) corrupted(delegationID, eventType, `Unknown participant: ${participantID}`)
  return participant
}

function requireTurn(
  turns: Map<TurnID, TurnInfo>,
  turnID: TurnID,
  delegationID: DelegationID.ID,
  eventType: string,
): TurnInfo {
  const turn = turns.get(turnID)
  if (turn === undefined) corrupted(delegationID, eventType, `Unknown turn: ${turnID}`)
  return turn
}

function requireTransition(delegation: DelegationInfo, to: DelegationInfo["status"], eventType: string): void {
  if (!canTransition(delegation.status, to)) {
    corrupted(delegation.id, eventType, `Invalid delegation transition from ${delegation.status} to ${to}`)
  }
}

function requireTurnParticipant(
  turn: TurnInfo,
  participantID: ParticipantID,
  delegationID: DelegationID.ID,
  eventType: string,
): void {
  if (!turn.participantIDs.includes(participantID)) {
    corrupted(delegationID, eventType, `Participant ${participantID} is not admitted for turn ${turn.id}`)
  }
}

function requireUniqueParticipants(
  participantIDs: readonly ParticipantID[],
  delegationID: DelegationID.ID,
  eventType: string,
): void {
  if (participantIDs.length === 0 || new Set(participantIDs).size !== participantIDs.length) {
    corrupted(delegationID, eventType, "Turn must contain at least one unique participant")
  }
}

function requireDeliveryAttempt(
  deliveries: Map<string, DeliveryState>,
  key: string,
  attempt: number,
  status: DeliveryStatus,
  delegationID: DelegationID.ID,
  eventType: string,
): void {
  const previous = deliveries.get(key)
  if (previous === undefined) return
  if (attempt < previous.attempt) {
    corrupted(delegationID, eventType, `Delivery attempt regressed from ${previous.attempt} to ${attempt}`)
  }
  if (attempt === previous.attempt) {
    if (previous.status === status) return
    const allowedNextStatuses: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
      admitted: ["running", "completed", "failed", "cancelled", "recovery_required"],
      queued: ["running", "completed", "failed", "cancelled", "recovery_required"],
      running: ["completed", "failed", "cancelled", "recovery_required"],
      completed: [],
      failed: [],
      cancelled: [],
      recovery_required: [],
    }
    if (!allowedNextStatuses[previous.status].includes(status)) {
      corrupted(delegationID, eventType, `Invalid delivery status transition from ${previous.status} to ${status}`)
    }
    return
  }
  if (!["failed", "cancelled", "recovery_required"].includes(previous.status)) {
    corrupted(delegationID, eventType, `Delivery attempt ${previous.attempt} is not retryable from ${previous.status}`)
  }
  if (!["admitted", "queued", "running"].includes(status)) {
    corrupted(delegationID, eventType, `Retry attempt ${attempt} must begin in an admitted or running state`)
  }
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

function deliveryKey(turnID: TurnID, participantID: ParticipantID, origin: string, senderParticipantID: ParticipantID) {
  return JSON.stringify([turnID, participantID, origin, senderParticipantID])
}

function latestDeliveryForParticipant(
  deliveries: readonly DeliveryState[],
  turnID: TurnID,
  participantID: ParticipantID,
): DeliveryState | undefined {
  return deliveries
    .filter((delivery) => delivery.turnID === turnID && delivery.participantID === participantID)
    .sort((left, right) => right.attempt - left.attempt || right.updatedAt - left.updatedAt)[0]
}

function refreshTurnStatus(turn: TurnInfo, deliveries: Iterable<DeliveryState>): TurnInfo {
  const allDeliveries = [...deliveries]
  const current = turn.participantIDs.map((participantID) =>
    latestDeliveryForParticipant(allDeliveries, turn.id, participantID),
  )
  const updatedAt = Math.max(
    turn.updatedAt,
    ...current
      .filter((delivery): delivery is DeliveryState => delivery !== undefined)
      .map((delivery) => delivery.updatedAt),
  )
  const withStatus = (status: TurnInfo["status"]) => new Delegation.TurnInfo({ ...turn, status, updatedAt })

  if (current.some((delivery) => delivery?.status === "recovery_required")) return withStatus("recovery_required")
  if (current.some((delivery) => delivery?.status === "failed")) return withStatus("failed")
  if (current.some((delivery) => delivery?.status === "cancelled")) return withStatus("cancelled")
  if (current.length > 0 && current.every((delivery) => delivery?.status === "completed"))
    return withStatus("completed")
  if (current.some((delivery) => delivery?.status === "completed")) return withStatus("partially_completed")
  if (current.some((delivery) => delivery?.status === "running")) return withStatus("running")
  return turn
}

function deriveApprovalStatus(
  delegation: DelegationInfo,
  participants: Map<ParticipantID, ParticipantInfo>,
  turns: Map<TurnID, TurnInfo>,
  deliveries: Map<string, DeliveryState>,
  reviews: readonly FoldedReviewRecord[],
  revisions: readonly RevisionRecord[],
): DelegationInfo {
  if (["closing", "completed", "cancelled", "archived"].includes(delegation.status)) return delegation

  const barrier = canComplete({
    participants: [...participants.values()],
    reviews,
    latestRevisionDigest: delegation.latestRevisionDigest,
    revisions,
    rejectionBlocked: delegation.rejectionBlocked,
    deliveries: [...deliveries.values()],
    turns: [...turns.values()],
  })
  if (barrier) {
    if (delegation.status !== "approved" && !canTransition(delegation.status, "approved")) return delegation
    return new Delegation.Info({ ...delegation, status: "approved" })
  }
  if (delegation.status === "approved") {
    const nextStatus = delegation.latestRevisionDigest ? "waiting_review" : "running"
    if (!canTransition(delegation.status, nextStatus)) return delegation
    return new Delegation.Info({
      ...delegation,
      status: nextStatus,
    })
  }
  return delegation
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
  const revisions: RevisionRecord[] = []

  for (const event of events) {
    const type = event.type
    if (!type.startsWith("delegation.")) continue

    if (!event.durable) {
      throw new DelegationCorruptedEventError({
        delegationID: expectedDelegationID,
        eventType: type,
        reason: "Delegation event is missing its durable envelope",
      })
    }
    if (event.durable.version !== 1) {
      throw new DelegationCorruptedEventError({
        delegationID: expectedDelegationID,
        eventType: type,
        reason: `Unsupported durable event version: ${event.durable.version}`,
      })
    }

    const aggregate = Schema.decodeUnknownOption(DelegationID.ID)(event.durable.aggregateID)
    if (Option.isNone(aggregate)) {
      throw new DelegationCorruptedEventError({
        delegationID: expectedDelegationID,
        eventType: type,
        reason: "Durable aggregate ID is not a valid DelegationID",
      })
    }
    if (expectedDelegationID === undefined) {
      expectedDelegationID = aggregate.value
    } else if (aggregate.value !== expectedDelegationID) {
      throw new DelegationAggregateMismatchError({
        expectedDelegationID,
        actualDelegationID: aggregate.value,
      })
    }

    const expectedSeq = lastSeq + 1
    if (!Number.isSafeInteger(event.durable.seq) || event.durable.seq < 0 || event.durable.seq !== expectedSeq) {
      throw new DelegationSequenceError({
        delegationID: expectedDelegationID,
        expectedSeq,
        actualSeq: event.durable.seq,
        reason: "Sequence must be a strictly increasing non-negative integer",
      })
    }
    lastSeq = event.durable.seq

    if (delegation === undefined && type !== DelegationEvent.Created.type) {
      corrupted(expectedDelegationID, type, "Delegation event precedes delegation.created")
    }
    if (delegation !== undefined && type === DelegationEvent.Created.type) {
      corrupted(expectedDelegationID, type, "Delegation stream contains more than one creation event")
    }

    if (type === DelegationEvent.Created.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CreatedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      if (data.status !== "draft") {
        corrupted(expectedDelegationID, type, `Creation event must start in draft, got ${data.status}`)
      }
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
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      if (["closing", "completed", "cancelled", "archived"].includes(currentDelegation.status)) {
        corrupted(
          expectedDelegationID,
          type,
          `Cannot add a participant while delegation is ${currentDelegation.status}`,
        )
      }
      if (participants.has(data.participantID)) {
        corrupted(expectedDelegationID, type, `Participant already exists: ${data.participantID}`)
      }
      if (data.phase === "closed") {
        corrupted(expectedDelegationID, type, "A participant cannot be added directly in closed phase")
      }
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
      const p = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (p.phase === "closed") corrupted(expectedDelegationID, type, "A closed participant cannot be interrupted")
      participants.set(
        data.participantID,
        new Delegation.ParticipantInfo({
          ...p,
          lastActivityAt: data.timestamp,
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
    } else if (type === DelegationEvent.ParticipantClosed.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ParticipantClosedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const p = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (p.phase === "closed") corrupted(expectedDelegationID, type, "Participant is already closed")
      if (!canAdvancePhase(p.phase, "closed")) {
        corrupted(expectedDelegationID, type, `Invalid participant phase transition from ${p.phase} to closed`)
      }
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
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      if (["closing", "completed", "cancelled", "archived"].includes(currentDelegation.status)) {
        corrupted(expectedDelegationID, type, `Cannot admit a turn while delegation is ${currentDelegation.status}`)
      }
      if (turns.has(data.turnID)) corrupted(expectedDelegationID, type, `Turn already exists: ${data.turnID}`)
      requireUniqueParticipants(data.participantIDs, expectedDelegationID, type)
      for (const participantID of data.participantIDs) {
        requireParticipant(participants, participantID, expectedDelegationID, type)
      }
      const latestTurnSeq = Math.max(0, ...[...turns.values()].map((turn) => turn.seq))
      if (data.seq !== latestTurnSeq + 1) {
        corrupted(expectedDelegationID, type, `Turn sequence must be ${latestTurnSeq + 1}, got ${data.seq}`)
      }
      turns.set(
        data.turnID,
        new Delegation.TurnInfo({
          id: data.turnID,
          delegationID: data.delegationID,
          seq: data.seq,
          kind: data.kind,
          status: data.delivery === "queue" ? "queued" : "admitted",
          promptSummary: data.promptSummary,
          evidenceDigest: data.evidenceDigest,
          revisionDigest: data.revisionDigest,
          participantIDs: data.participantIDs,
          delivery: data.delivery,
          createdAt: data.timestamp,
          updatedAt: data.timestamp,
        }),
      )
      if (delegation) {
        const nextStatus =
          delegation.status === "draft" || delegation.status === "changes_requested" ? "running" : delegation.status
        delegation = new Delegation.Info({
          ...delegation,
          status: nextStatus,
          lastActivityAt: Math.max(delegation.lastActivityAt, data.timestamp),
          updatedAt: data.timestamp,
        })
      }
    } else if (type === DelegationEvent.DeliveryAdmitted.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.DeliveryAdmittedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      requireParticipant(participants, data.senderParticipantID, expectedDelegationID, type)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin, data.senderParticipantID)
      requireDeliveryAttempt(deliveries, key, data.attempt, data.status, expectedDelegationID, type)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: data.status,
        updatedAt: data.timestamp,
      })
      turns.set(data.turnID, refreshTurnStatus(turn, deliveries.values()))
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      requireParticipant(participants, data.senderParticipantID, expectedDelegationID, type)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin, data.senderParticipantID)
      requireDeliveryAttempt(deliveries, key, data.attempt, "running", expectedDelegationID, type)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: "running",
        updatedAt: data.timestamp,
      })
      turns.set(data.turnID, refreshTurnStatus(turn, deliveries.values()))
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      requireParticipant(participants, data.senderParticipantID, expectedDelegationID, type)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin, data.senderParticipantID)
      requireDeliveryAttempt(deliveries, key, data.attempt, "completed", expectedDelegationID, type)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: "completed",
        externalTurnID: data.externalTurnID,
        summary: data.summary,
        updatedAt: data.timestamp,
      })
      turns.set(data.turnID, refreshTurnStatus(turn, deliveries.values()))
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      requireParticipant(participants, data.senderParticipantID, expectedDelegationID, type)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin, data.senderParticipantID)
      requireDeliveryAttempt(deliveries, key, data.attempt, "failed", expectedDelegationID, type)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: "failed",
        errorCode: data.errorCode,
        summary: data.summary,
        updatedAt: data.timestamp,
      })
      turns.set(data.turnID, refreshTurnStatus(turn, deliveries.values()))
      const failedParticipant = participants.get(data.participantID)
      if (failedParticipant && failedParticipant.phase !== "closed" && failedParticipant.phase !== "failed") {
        if (canAdvancePhase(failedParticipant.phase, "failed")) {
          participants.set(
            data.participantID,
            new Delegation.ParticipantInfo({
              ...failedParticipant,
              phase: "failed",
              lastActivityAt: data.timestamp,
              updatedAt: data.timestamp,
            }),
          )
        }
      }
      if (delegation) {
        if (["completed", "cancelled", "archived"].includes(delegation.status)) {
          corrupted(expectedDelegationID, type, `Cannot fail a delegation while it is ${delegation.status}`)
        }
        if (delegation.status !== "failed") requireTransition(delegation, "failed", type)
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      requireParticipant(participants, data.senderParticipantID, expectedDelegationID, type)
      const key = deliveryKey(data.turnID, data.participantID, data.deliveryOrigin, data.senderParticipantID)
      requireDeliveryAttempt(deliveries, key, data.attempt, "recovery_required", expectedDelegationID, type)
      deliveries.set(key, {
        turnID: data.turnID,
        participantID: data.participantID,
        deliveryOrigin: data.deliveryOrigin,
        senderParticipantID: data.senderParticipantID,
        attempt: data.attempt,
        status: "recovery_required",
        errorCode: data.errorCode,
        summary: data.summary,
        updatedAt: data.timestamp,
      })
      turns.set(data.turnID, refreshTurnStatus(turn, deliveries.values()))
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
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      if (["closing", "completed", "cancelled", "archived"].includes(currentDelegation.status)) {
        corrupted(
          expectedDelegationID,
          type,
          `Cannot record a revision while delegation is ${currentDelegation.status}`,
        )
      }
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      const participant = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (participant.role !== "implementer") {
        corrupted(expectedDelegationID, type, "Only an implementer can record a revision")
      }
      if (revisions.some((revision) => revision.revisionDigest === data.revisionDigest)) {
        corrupted(expectedDelegationID, type, `Revision already exists: ${data.revisionDigest}`)
      }
      revisions.push({ revisionDigest: data.revisionDigest, changeKind: data.changeKind })
      let nextStatus = currentDelegation.status
      if (currentDelegation.status === "approved" && !["no_change", "no_code_change"].includes(data.changeKind)) {
        requireTransition(currentDelegation, "waiting_review", type)
        nextStatus = "waiting_review"
      }
      if (currentDelegation.status === "changes_requested") {
        requireTransition(currentDelegation, "running", type)
        nextStatus = "running"
      }
      delegation = new Delegation.Info({
        ...currentDelegation,
        status: nextStatus,
        latestRevisionDigest: data.revisionDigest,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
      turns.set(
        data.turnID,
        new Delegation.TurnInfo({
          ...turn,
          revisionDigest: data.revisionDigest,
          updatedAt: data.timestamp,
        }),
      )
    } else if (type === DelegationEvent.ReviewApproved.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ReviewApprovedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      const reviewer = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (reviewer.role !== "reviewer" && reviewer.role !== "approver") {
        corrupted(expectedDelegationID, type, "Only a reviewer or approver can record a review")
      }
      reviews.push({
        participantID: data.participantID,
        reviewedRevisionDigest: data.reviewedRevisionDigest,
        verdict: "approved",
        findings: data.findings,
        summary: data.summary,
      })
      if (delegation) {
        delegation = new Delegation.Info({
          ...delegation,
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      const reviewer = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (reviewer.role !== "reviewer" && reviewer.role !== "approver") {
        corrupted(expectedDelegationID, type, "Only a reviewer or approver can record a review")
      }
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
      const turn = requireTurn(turns, data.turnID, expectedDelegationID, type)
      requireTurnParticipant(turn, data.participantID, expectedDelegationID, type)
      const reviewer = requireParticipant(participants, data.participantID, expectedDelegationID, type)
      if (reviewer.role !== "reviewer" && reviewer.role !== "approver") {
        corrupted(expectedDelegationID, type, "Only a reviewer or approver can record a review")
      }
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
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      if (
        data.participantID !== undefined &&
        currentDelegation.rejectionParticipantID !== undefined &&
        data.participantID !== currentDelegation.rejectionParticipantID
      ) {
        corrupted(expectedDelegationID, type, "Rejection retraction participant does not match the active blocker")
      }
      delegation = new Delegation.Info({
        ...currentDelegation,
        rejectionBlocked: false,
        rejectionReason: undefined,
        rejectionParticipantID: undefined,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.Closing.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ClosingData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      requireTransition(currentDelegation, "closing", type)
      delegation = new Delegation.Info({
        ...currentDelegation,
        status: "closing",
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.Completed.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CompletedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      requireTransition(currentDelegation, "completed", type)
      if (
        !canComplete({
          participants: [...participants.values()],
          reviews,
          latestRevisionDigest: currentDelegation.latestRevisionDigest,
          revisions,
          rejectionBlocked: currentDelegation.rejectionBlocked,
          deliveries: [...deliveries.values()],
          turns: [...turns.values()],
        })
      ) {
        corrupted(expectedDelegationID, type, "Delegation completion barrier is not satisfied")
      }
      delegation = new Delegation.Info({
        ...currentDelegation,
        status: "completed",
        completedAt: data.timestamp,
        closedAt: data.timestamp,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.Cancelled.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.CancelledData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      requireTransition(currentDelegation, "cancelled", type)
      delegation = new Delegation.Info({
        ...currentDelegation,
        status: "cancelled",
        closedAt: data.timestamp,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.Archived.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ArchivedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      requireTransition(currentDelegation, "archived", type)
      delegation = new Delegation.Info({
        ...currentDelegation,
        status: "archived",
        archivedAt: data.timestamp,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else if (type === DelegationEvent.Forked.type) {
      const data = parseEvent(
        Schema.decodeUnknownOption(DelegationEvent.ForkedData),
        event.data,
        type,
        expectedDelegationID,
      )
      expectedDelegationID = checkDataDelegationID(data.delegationID, expectedDelegationID)
      const currentDelegation = requireDelegation(delegation, expectedDelegationID, type)
      if (data.forkedDelegationID === expectedDelegationID) {
        corrupted(expectedDelegationID, type, "A delegation cannot fork itself")
      }
      delegation = new Delegation.Info({
        ...currentDelegation,
        lastActivityAt: Math.max(currentDelegation.lastActivityAt, data.timestamp),
        updatedAt: data.timestamp,
      })
    } else {
      throw new DelegationCorruptedEventError({
        delegationID: expectedDelegationID,
        eventType: type,
        reason: `Unknown delegation event type: ${type}`,
      })
    }

    if (delegation) delegation = deriveApprovalStatus(delegation, participants, turns, deliveries, reviews, revisions)
  }

  if (!delegation) return undefined

  delegation = deriveApprovalStatus(delegation, participants, turns, deliveries, reviews, revisions)

  return {
    delegation,
    participants,
    turns,
    deliveries,
    reviews,
    revisions,
  }
}
