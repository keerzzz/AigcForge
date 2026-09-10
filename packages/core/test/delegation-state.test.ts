import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { DelegationStatus } from "@aigcfroge/schema/delegation"
import { canTransition, assertTransition, canAdvancePhase, isTerminalPhase } from "../src/delegation/state"

describe("Delegation State Machine (Phase 1)", () => {
  test("validates happy path and recovery transitions per ADR-22", () => {
    // Forward progression: draft -> running -> waiting_review -> approved -> closing -> completed -> archived
    expect(canTransition("draft", "running")).toBe(true)
    expect(canTransition("running", "waiting_review")).toBe(true)
    expect(canTransition("waiting_review", "approved")).toBe(true)
    expect(canTransition("approved", "closing")).toBe(true)
    expect(canTransition("closing", "completed")).toBe(true)
    expect(canTransition("completed", "archived")).toBe(true)

    // Unarchive: archived -> completed
    expect(canTransition("archived", "completed")).toBe(true)

    // Review feedback and changes requested cycles
    expect(canTransition("running", "changes_requested")).toBe(true)
    expect(canTransition("waiting_review", "changes_requested")).toBe(true)
    expect(canTransition("changes_requested", "running")).toBe(true)
    expect(canTransition("approved", "waiting_review")).toBe(true) // new revision submitted

    // Failure and recovery
    expect(canTransition("running", "failed")).toBe(true)
    expect(canTransition("failed", "recovery_required")).toBe(true)
    expect(canTransition("failed", "running")).toBe(true) // explicit retry
    expect(canTransition("recovery_required", "running")).toBe(true) // after reconciliation

    // Cancellation & closing
    expect(canTransition("draft", "cancelled")).toBe(true)
    expect(canTransition("running", "cancelled")).toBe(true)
    expect(canTransition("closing", "cancelled")).toBe(true)
    expect(canTransition("cancelled", "archived")).toBe(true)
  })

  test("rejects invalid status transitions and deleted pseudo-status", () => {
    // Skipping mandatory stages: approved CANNOT jump directly to completed!
    expect(canTransition("approved", "completed")).toBe(false)
    expect(canTransition("draft", "completed")).toBe(false)
    expect(canTransition("draft", "waiting_review")).toBe(false)
    expect(canTransition("draft", "approved")).toBe(false)

    // Invalid backwards jumps: archived cannot jump directly to running
    expect(canTransition("archived", "running")).toBe(false)
    expect(canTransition("cancelled", "approved")).toBe(false)
    expect(canTransition("completed", "running")).toBe(false)

    // "deleted" is a purge command, not a status in the union
    expect(Schema.is(DelegationStatus)("deleted")).toBe(false)
  })

  test("assertTransition returns typed DelegationInvalidStateError upon illegal transition", () => {
    const dlgId = DelegationID.ID.make("dlg_state_test")
    const successExit = Effect.runSync(assertTransition(dlgId, "draft", "running").pipe(Effect.exit))
    expect(Exit.isSuccess(successExit)).toBe(true)

    const failExit = Effect.runSync(assertTransition(dlgId, "draft", "completed").pipe(Effect.exit))
    expect(Exit.isFailure(failExit)).toBe(true)
    if (Exit.isFailure(failExit)) {
      const err = failExit.cause
      expect(String(err)).toContain("DelegationInvalidStateError")
    }
  })

  test("enforces monotonic roster phase progression and reconciliation", () => {
    // Valid forward transitions
    expect(canAdvancePhase("provisioning", "active")).toBe(true)
    expect(canAdvancePhase("provisioning", "failed")).toBe(true)
    expect(canAdvancePhase("active", "failed")).toBe(true)
    expect(canAdvancePhase("active", "closed")).toBe(true)
    // Reconciliation allows failed -> active (explicit retry) and failed -> closed
    expect(canAdvancePhase("failed", "active")).toBe(true)
    expect(canAdvancePhase("failed", "closed")).toBe(true)

    // Invalid regressions and terminal locks
    expect(canAdvancePhase("active", "provisioning")).toBe(false)
    expect(canAdvancePhase("closed", "active")).toBe(false)
    expect(canAdvancePhase("closed", "provisioning")).toBe(false)
    expect(canAdvancePhase("closed", "failed")).toBe(false)

    // Terminal phase check
    expect(isTerminalPhase("closed")).toBe(true)
    expect(isTerminalPhase("active")).toBe(false)
    expect(isTerminalPhase("provisioning")).toBe(false)
  })
})
