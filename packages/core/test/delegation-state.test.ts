import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { DelegationStatus } from "@aigcfroge/schema/delegation"
import { canTransition, assertTransition, canAdvancePhase, isTerminalPhase } from "../src/delegation/state"

describe("Delegation State Machine (Phase 1)", () => {
  test("validates happy path and recovery transitions", () => {
    // Forward progression
    expect(canTransition("draft", "running")).toBe(true)
    expect(canTransition("running", "waiting_review")).toBe(true)
    expect(canTransition("waiting_review", "approved")).toBe(true)
    expect(canTransition("approved", "completed")).toBe(true)
    expect(canTransition("completed", "archived")).toBe(true)

    // Append / review / repair cycles
    expect(canTransition("waiting_review", "running")).toBe(true) // rework requested
    expect(canTransition("approved", "waiting_review")).toBe(true) // new revision submitted
    expect(canTransition("approved", "running")).toBe(true) // further append

    // Cancellation & archiving
    expect(canTransition("draft", "cancelled")).toBe(true)
    expect(canTransition("running", "cancelled")).toBe(true)
    expect(canTransition("waiting_review", "cancelled")).toBe(true)
    expect(canTransition("cancelled", "archived")).toBe(true)
  })

  test("rejects invalid status transitions and deleted pseudo-status", () => {
    // Skipping mandatory stages
    expect(canTransition("draft", "completed")).toBe(false)
    expect(canTransition("draft", "waiting_review")).toBe(false)
    expect(canTransition("draft", "approved")).toBe(false)

    // Invalid backwards jumps
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

  test("enforces monotonic roster phase progression", () => {
    // Valid forward transitions
    expect(canAdvancePhase("provisioning", "active")).toBe(true)
    expect(canAdvancePhase("provisioning", "failed")).toBe(true)
    expect(canAdvancePhase("active", "failed")).toBe(true)

    // Invalid regressions and terminal locks
    expect(canAdvancePhase("active", "provisioning")).toBe(false)
    expect(canAdvancePhase("failed", "active")).toBe(false)
    expect(canAdvancePhase("failed", "provisioning")).toBe(false)

    // Terminal phase check
    expect(isTerminalPhase("failed")).toBe(true)
    expect(isTerminalPhase("active")).toBe(false)
    expect(isTerminalPhase("provisioning")).toBe(false)
  })
})
