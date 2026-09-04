export * as DelegationReview from "./review"

import {
  Delegation,
  type ChangeKind,
  type ReviewVerdict,
  type ParticipantRole,
  type ParticipantInfo,
  type Info as DelegationInfo,
} from "@aigcfroge/schema/delegation"
import type { ParticipantID } from "@aigcfroge/schema/delegation-id"

/**
 * Gerrit-style sticky approval copyability matrix (G3).
 * formatting_only is conservatively downgraded to rework in this phase.
 */
export function copyable(changeKind: ChangeKind, verdict: ReviewVerdict): boolean {
  if (verdict !== "approved") return false
  if (changeKind === "no_change" || changeKind === "no_code_change") return true
  return false
}

export interface ReviewRecord {
  participantID: ParticipantID
  reviewedRevisionDigest: string
  verdict: ReviewVerdict
}

export interface ReviewBarrierParams {
  participants: readonly ParticipantInfo[]
  reviews: readonly ReviewRecord[]
  latestRevisionDigest?: string
  rejectionBlocked: boolean
}

export interface ReviewBarrierResult {
  passed: boolean
  reason?: string
  missingRoles?: ParticipantRole[]
}

/**
 * Evaluates completion review barrier for a delegation based on participant roles (G6).
 * No-reviewer delegations pass without deadlock.
 */
export function evaluateReviewBarrier(params: ReviewBarrierParams): ReviewBarrierResult {
  if (params.rejectionBlocked) {
    return {
      passed: false,
      reason: "Rejection blocker is active",
    }
  }

  const reviewers = params.participants.filter((p) => p.role === "reviewer" || p.role === "approver")

  // G6: Compatibility path for delegations without reviewers does not deadlock
  if (reviewers.length === 0) {
    return { passed: true }
  }

  if (!params.latestRevisionDigest) {
    return {
      passed: false,
      reason: "No revision digest available for review evaluation",
    }
  }

  // Each reviewer/approver must have their latest effective review approved on the latest revision
  for (const reviewer of reviewers) {
    const reviewerReviews = params.reviews.filter((r) => r.participantID === reviewer.id)
    if (reviewerReviews.length === 0) {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} has not reviewed revision ${params.latestRevisionDigest}`,
        missingRoles: [reviewer.role],
      }
    }

    const latestReview = reviewerReviews[reviewerReviews.length - 1]
    if (!latestReview) {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} has no valid review`,
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

    if (latestReview.verdict !== "approved") {
      return {
        passed: false,
        reason: `Reviewer ${reviewer.id} has not approved revision`,
        missingRoles: [reviewer.role],
      }
    }

    if (latestReview.reviewedRevisionDigest !== params.latestRevisionDigest) {
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
