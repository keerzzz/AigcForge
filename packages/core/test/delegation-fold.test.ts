import { describe, expect, test } from "bun:test"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionID } from "@aigcfroge/schema/session-id"
import { foldDelegation } from "../src/delegation/fold"
import * as DelegationEvent from "../src/delegation/event"
import { EventV2 } from "../src/event"

function makeEvent<D extends EventV2.Definition>(def: D, data: EventV2.Data<D>, seq = 0): EventV2.Payload<D> {
  const aggId =
    typeof data === "object" && data !== null && "delegationID" in data
      ? String((data as { delegationID: unknown }).delegationID)
      : ""
  return {
    id: EventV2.ID.create(),
    type: def.type,
    data,
    durable: {
      aggregateID: aggId,
      seq,
      version: 1,
    },
  }
}

describe("Delegation Event Fold (Phase 1)", () => {
  const dlgId = DelegationID.ID.make("dlg_fold_01")
  const parentSesId = SessionID.ID.make("ses_parent_01")
  const partBuildId = ParticipantID.make("par_build_01")
  const partCodexId = ParticipantID.make("par_codex_01")
  const turn1Id = TurnID.make("trn_01")

  test("folds creation, participants, turn admission, and deliveries into aggregated state", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Build and review feature",
          status: "draft",
        },
        0,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partBuildId,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "provisioning",
          runtimeStatus: "idle",
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "codex",
          role: "reviewer",
          context: "fresh",
          phase: "provisioning",
          runtimeStatus: "idle",
        },
        2,
      ),
      makeEvent(
        DelegationEvent.TurnAdmitted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          seq: 1,
          kind: "task",
          participantIDs: [partBuildId, partCodexId],
          delivery: "steer",
        },
        3,
      ),
      makeEvent(
        DelegationEvent.DeliveryAdmitted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "turn_1_steer",
          attempt: 1,
          status: "admitted",
        },
        4,
      ),
    ]

    const state = foldDelegation(events)
    expect(state).toBeDefined()
    expect(state!.delegation.id).toBe(dlgId)
    expect(state!.delegation.title).toBe("Build and review feature")
    expect(state!.participants.size).toBe(2)
    expect(state!.participants.get(partBuildId)?.role).toBe("implementer")
    expect(state!.participants.get(partCodexId)?.role).toBe("reviewer")
    expect(state!.turns.size).toBe(1)
    expect(state!.turns.get(turn1Id)?.seq).toBe(1)
  })

  test("late heartbeat cannot overwrite failed terminal roster phase (G5)", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "running",
        },
        0,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partBuildId,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "active",
          runtimeStatus: "running",
        },
        1,
      ),
      // Participant delivery failed
      makeEvent(
        DelegationEvent.DeliveryUpdated,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "turn_1_steer",
          attempt: 1,
          status: "failed",
          errorCode: "PROCESS_CRASHED",
        },
        2,
      ),
      // Late heartbeat claims running runtime status
      makeEvent(
        DelegationEvent.DeliveryUpdated,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "turn_1_steer",
          attempt: 1,
          status: "failed",
          runtimeStatus: "running",
        },
        3,
      ),
    ]

    const state = foldDelegation(events)
    expect(state).toBeDefined()
    const buildParticipant = state!.participants.get(partBuildId)
    expect(buildParticipant?.phase).toBe("failed")
  })

  test("rejected verdict establishes sticky blocker that survives subsequent revisions until retracted (G4)", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "waiting_review",
        },
        0,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "codex",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          runtimeStatus: "idle",
        },
        1,
      ),
      // Codex issues rejection
      makeEvent(
        DelegationEvent.ReviewRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          reviewedRevisionDigest: "rev_v1",
          verdict: "rejected",
          findings: [{ severity: "error", message: "SQL injection vulnerability" }],
          summary: "Rejected due to security flaw",
        },
        2,
      ),
    ]

    const stateAfterReject = foldDelegation(events)
    expect(stateAfterReject?.delegation.rejectionBlocked).toBe(true)
    expect(stateAfterReject?.delegation.rejectionReason).toContain("SQL injection vulnerability")

    // New revision is recorded: rejectionBlocked must STAY true!
    const eventsWithNewRevision = [
      ...events,
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha_new",
          normalizedDiff: "+diff",
          revisionDigest: "rev_v2",
          changeKind: "rework",
        },
        3,
      ),
    ]

    const stateAfterRevision = foldDelegation(eventsWithNewRevision)
    expect(stateAfterRevision?.delegation.rejectionBlocked).toBe(true)

    // Explicit retraction clears blocker
    const eventsWithRetraction = [
      ...eventsWithNewRevision,
      makeEvent(
        DelegationEvent.RejectionRetracted,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          reason: "Fixed in v2",
        },
        4,
      ),
    ]

    const stateAfterRetraction = foldDelegation(eventsWithRetraction)
    expect(stateAfterRetraction?.delegation.rejectionBlocked).toBe(false)
  })
})
