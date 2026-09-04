export * as DelegationState from "./state"

import { Effect } from "effect"
import { Delegation, type DelegationStatus, type ParticipantPhase } from "@aigcfroge/schema/delegation"
import type { ID as DelegationID } from "@aigcfroge/schema/delegation-id"

const VALID_TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  draft: ["running", "cancelled"],
  running: ["waiting_review", "changes_requested", "approved", "failed", "closing", "cancelled"],
  waiting_review: ["changes_requested", "approved", "failed", "closing"],
  changes_requested: ["running", "closing", "cancelled"],
  approved: ["waiting_review", "closing"],
  failed: ["running", "recovery_required", "closing"],
  recovery_required: ["running", "failed", "closing"],
  closing: ["completed", "cancelled", "failed"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: ["completed"],
}

/**
 * Validates whether a delegation status transition is allowed per ADR-22 §4.1.
 */
export function canTransition(from: DelegationStatus, to: DelegationStatus): boolean {
  if (!VALID_TRANSITIONS[from]) return false
  return VALID_TRANSITIONS[from].includes(to)
}

export function assertTransition(
  delegationID: DelegationID,
  from: DelegationStatus,
  to: DelegationStatus,
): Effect.Effect<void, Delegation.DelegationInvalidStateError> {
  if (!canTransition(from, to)) {
    return Effect.fail(
      new Delegation.DelegationInvalidStateError({
        delegationID,
        currentStatus: from,
        attemptedTransition: to,
        reason: `Invalid transition from ${from} to ${to}`,
      }),
    )
  }
  return Effect.void
}

/**
 * Validates whether a participant roster phase transition is allowed per ADR-22 §4.2.
 * Monotonic: provisioning -> active | failed; active -> failed | closed; failed -> active | closed.
 */
export function canAdvancePhase(from: ParticipantPhase, to: ParticipantPhase): boolean {
  if (from === "provisioning") return to === "active" || to === "failed"
  if (from === "active") return to === "failed" || to === "closed"
  if (from === "failed") return to === "active" || to === "closed"
  return false
}

export function isTerminalPhase(phase: ParticipantPhase): boolean {
  return phase === "closed"
}
