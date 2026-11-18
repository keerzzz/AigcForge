export * as DelegationReview from "./review"

import {
  Delegation,
  type ChangeKind,
  type ParticipantInfo,
  type ParticipantRole,
  type ReviewVerdict,
  type TurnStatus,
  type DeliveryStatus,
  type Info as DelegationInfo,
  type RevisionDigest,
} from "@aigcfroge/schema/delegation"
import type { ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"

/**
 * Gerrit-style sticky approval copyability matrix (G3).
 * formatting_only is conservatively downgraded to rework in this phase.
 */
export function copyable(changeKind: ChangeKind, verdict: ReviewVerdict): boolean {
  if (verdict !== "approved") return false
  return changeKind === "no_change" || changeKind === "no_code_change"
}

export interface ReviewRecord {
  participantID: ParticipantID
  reviewedRevisionDigest: RevisionDigest
  verdict: ReviewVerdict
}

export interface RevisionRecord {
  revisionDigest: RevisionDigest
  changeKind: ChangeKind
}

export interface ReviewDeliveryState {
  turnID: TurnID
  participantID: ParticipantID
  status: DeliveryStatus
  attempt: number
  updatedAt: number
}

export interface ReviewTurnState {
  id: TurnID
  seq: number
  status: TurnStatus
  participantIDs: readonly ParticipantID[]
}

export interface ReviewBarrierParams {
  participants: readonly ParticipantInfo[]
  reviews: readonly ReviewRecord[]
  latestRevisionDigest?: RevisionDigest
  revisions?: readonly RevisionRecord[]
  rejectionBlocked: boolean
}

export interface ReviewBarrierResult {
  passed: boolean
  reason?: string
  missingRoles?: ParticipantRole[]
}

export interface CompletionBarrierParams extends ReviewBarrierParams {
  deliveries: readonly ReviewDeliveryState[]
  turns: readonly ReviewTurnState[]
}

/**
 * Evaluates the review portion of the completion barrier.
 *
 * Reviews are receipts, not a history-wide veto: the latest receipt for each
 * reviewer/approver is the effective one. A rejected receipt still blocks when
 * the aggregate sticky blocker is active; explicit retraction clears that
 * aggregate blocker while retaining the old receipt for audit/replay.
 */
export function evaluateReviewBarrier(params: ReviewBarrierParams): ReviewBarrierResult {
  if (params.rejectionBlocked) {
    return {
      passed: false,
      reason: "Rejection blocker is active",
    }
  }

  const reviewers = params.participants.filter(
    (participant) => participant.role === "reviewer" || participant.role === "approver",
  )

  if (reviewers.length === 0) return { passed: true }

  if (!params.latestRevisionDigest) {
    return {
      passed: false,
      reason: "No revision digest available for review evaluation",
    }
  }

  const effectiveReviews = new Map<ParticipantID, ReviewRecord>()
  for (const review of params.reviews) effectiveReviews.set(review.participantID, review)

  for (const reviewer of reviewers) {
    const latestReview = effectiveReviews.get(reviewer.id)
    if (!latestReview) {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} has not reviewed revision ${params.latestRevisionDigest}`,
        missingRoles: [reviewer.role],
      }
    }

    if (latestReview.verdict === "rejected") {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} rejected revision`,
        missingRoles: [reviewer.role],
      }
    }

    if (latestReview.verdict === "changes_requested") {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} requested changes`,
        missingRoles: [reviewer.role],
      }
    }

    if (!isReviewEffectiveForRevision(latestReview, params.latestRevisionDigest, params.revisions)) {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} has not approved revision ${params.latestRevisionDigest}`,
        missingRoles: [reviewer.role],
      }
    }
  }

  return { passed: true }
}

/**
 * Evaluates the complete aggregate barrier. This stays pure and consumes only
 * folded state; it never reaches into Database or an EventV2 service.
 */
export function canComplete(params: CompletionBarrierParams): boolean {
  if (!evaluateReviewBarrier(params).passed) return false

  const implementers = params.participants.filter((participant) => participant.role === "implementer")
  if (implementers.length === 0 || params.turns.length === 0) return false

  if (
    params.turns.some((turn) =>
      ["admitted", "queued", "running", "partially_completed", "failed", "cancelled", "recovery_required"].includes(
        turn.status,
      ),
    )
  )
    return false

  if (
    params.deliveries.some((delivery) =>
      ["admitted", "queued", "running", "recovery_required"].includes(delivery.status),
    )
  )
    return false

  const latestDeliveries = latestDeliveriesByParticipant(params.deliveries, params.turns)
  if (!implementers.every((participant) => latestDeliveries.get(participant.id)?.status === "completed")) return false

  const reviewers = params.participants.filter(
    (participant) => participant.role === "reviewer" || participant.role === "approver",
  )
  return reviewers.every((participant) => latestDeliveries.get(participant.id)?.status === "completed")
}

/**
 * Retracts an active rejection blocker upon explicit authorization or review retraction (G4).
 */
export function retractRejection(delegation: DelegationInfo, _reason: string, timestamp?: number): DelegationInfo {
  const ts = timestamp ?? delegation.updatedAt
  return new Delegation.Info({
    ...delegation,
    rejectionBlocked: false,
    rejectionReason: undefined,
    rejectionParticipantID: undefined,
    lastActivityAt: ts,
    updatedAt: ts,
  })
}

function isReviewEffectiveForRevision(
  review: ReviewRecord,
  latestRevisionDigest: RevisionDigest,
  revisions: readonly RevisionRecord[] | undefined,
): boolean {
  if (review.verdict !== "approved") return false
  if (review.reviewedRevisionDigest === latestRevisionDigest) return true
  if (!revisions) return false

  const reviewedIndex = revisions.findIndex((revision) => revision.revisionDigest === review.reviewedRevisionDigest)
  const latestIndex = revisions.findIndex((revision) => revision.revisionDigest === latestRevisionDigest)
  if (reviewedIndex < 0 || latestIndex < 0 || reviewedIndex >= latestIndex) return false

  return revisions
    .slice(reviewedIndex + 1, latestIndex + 1)
    .every((revision) => copyable(revision.changeKind, review.verdict))
}

function latestDeliveriesByParticipant(deliveries: readonly ReviewDeliveryState[], turns: readonly ReviewTurnState[]) {
  const turnSequences = new Map(turns.map((turn) => [turn.id, turn.seq]))
  const latest = new Map<ParticipantID, ReviewDeliveryState>()
  for (const delivery of deliveries) {
    const previous = latest.get(delivery.participantID)
    const deliverySeq = turnSequences.get(delivery.turnID) ?? -1
    const previousSeq = previous === undefined ? -1 : (turnSequences.get(previous.turnID) ?? -1)
    if (
      previous === undefined ||
      deliverySeq > previousSeq ||
      (deliverySeq === previousSeq &&
        (delivery.attempt > previous.attempt ||
          (delivery.attempt === previous.attempt && delivery.updatedAt >= previous.updatedAt)))
    )
      latest.set(delivery.participantID, delivery)
  }
  return latest
}
