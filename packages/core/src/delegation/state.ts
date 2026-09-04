export * as DelegationState from "./state"

import { Effect } from "effect"
import { Delegation, type DelegationStatus, type ParticipantPhase } from "@aigcfroge/schema/delegation"
import type { ID as DelegationID } from "@aigcfroge/schema/delegation-id"

const VALID_TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  draft: ["running", "cancelled"],
  running: ["waiting_review", "completed", "cancelled"],
  waiting_review: ["approved", "running", "cancelled"],
  approved: ["completed", "waiting_review", "running", "cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: ["running"],
}

/**
 * Validates whether a delegation status transition is allowed.
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
 * Validates whether a participant roster phase transition is allowed.
 * Monotonic: provisioning -> active | failed, active -> failed.
 */
export function canAdvancePhase(from: ParticipantPhase, to: ParticipantPhase): boolean {
  if (from === "provisioning") return to === "active" || to === "failed"
  if (from === "active") return to === "failed"
  return false
}

export function isTerminalPhase(phase: ParticipantPhase): boolean {
  return phase === "failed"
}
