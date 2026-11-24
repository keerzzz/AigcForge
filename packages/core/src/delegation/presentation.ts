export * as DelegationPresentation from "./presentation"

import type { DelegationFoldState } from "./fold"
import { Delegation } from "@omnixa/schema/delegation"
import { evaluateReviewBarrier, canComplete } from "./review"

export const DEFAULT_SOFT_EXPIRY_DAYS = 7

export function softExpiryMs(value = process.env.OMNIXA_DELEGATION_SOFT_EXPIRY_DAYS) {
  const days = Number(value ?? DEFAULT_SOFT_EXPIRY_DAYS)
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_SOFT_EXPIRY_DAYS) * 86_400_000
}

export function isSoftExpired(state: DelegationFoldState, now = Date.now(), threshold = softExpiryMs()) {
  return (
    !["completed", "archived", "cancelled"].includes(state.delegation.status) &&
    now - state.delegation.lastActivityAt >= threshold
  )
}

export function view(state: DelegationFoldState, now = Date.now(), threshold = softExpiryMs()) {
  const basis = {
    participants: [...state.participants.values()],
    reviews: state.reviews,
    revisions: state.revisions,
    latestRevisionDigest: state.delegation.latestRevisionDigest,
    rejectionBlocked: state.delegation.rejectionBlocked,
  }
  return {
    delegation: state.delegation,
    participants: [...state.participants.values()],
    turns: [...state.turns.values()].sort((left, right) => left.seq - right.seq),
    softExpired: isSoftExpired(state, now, threshold),
    reviews: state.reviews.map((review) => new Delegation.ReviewRecord(review)),
    revisions: state.revisions.map((revision) => new Delegation.RevisionRecord(revision)),
    archivedFrom: state.archivedFrom,
    barrier: new Delegation.Barrier({
      ...evaluateReviewBarrier(basis),
      completionEligible: canComplete({
        ...basis,
        deliveries: [...state.deliveries.values()],
        turns: [...state.turns.values()],
      }),
    }),
  }
}
