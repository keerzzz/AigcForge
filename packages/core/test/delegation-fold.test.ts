import { describe, expect, test } from "bun:test"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionID } from "@aigcfroge/schema/session-id"
import { foldDelegation } from "../src/delegation/fold"
import * as DelegationEvent from "../src/delegation/event"
import { EventV2 } from "../src/event"
import {
  DelegationAggregateMismatchError,
  DelegationCorruptedEventError,
  DelegationSequenceError,
  RevisionDigest,
} from "@aigcfroge/schema/delegation"

function makeEvent<D extends EventV2.Definition>(
  def: D,
  data: EventV2.Data<D>,
  seq = 0,
  overrideAggregateID?: string,
): EventV2.Payload<D> {
  const aggId =
    overrideAggregateID ??
    (typeof data === "object" && data !== null && "delegationID" in data
      ? String((data as { delegationID: unknown }).delegationID)
      : "")
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

describe("Delegation Event Fold (Phase 1 Remediation)", () => {
  const dlgId = DelegationID.ID.make("dlg_fold_01")
  const parentSesId = SessionID.ID.make("ses_parent_01")
  const partBuildId = ParticipantID.make("par_build_01")
  const partCodexId = ParticipantID.make("par_codex_01")
  const turn1Id = TurnID.make("trn_01")
  const validDigest = RevisionDigest.make(`rev_${"a".repeat(64)}`)
  const validDigest2 = RevisionDigest.make(`rev_${"b".repeat(64)}`)

  test("folds creation, participants, turn admission, and deliveries into aggregated state", () => {
    const baseTime = 1700000000000
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Build and review feature",
          status: "draft",
          timestamp: baseTime,
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
          timestamp: baseTime + 10,
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
          timestamp: baseTime + 20,
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
          timestamp: baseTime + 30,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.DeliveryStarted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "turn_1_steer",
          attempt: 1,
          timestamp: baseTime + 40,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "turn_1_steer",
          attempt: 1,
          summary: "Build succeeded",
          timestamp: baseTime + 50,
        },
        5,
      ),
    ]

    const state = foldDelegation(events)
    expect(state).toBeDefined()
    expect(state!.delegation.id).toBe(dlgId)
    expect(state!.delegation.title).toBe("Build and review feature")
    expect(state!.delegation.status).toBe("running")
    expect(state!.delegation.createdAt).toBe(baseTime)
    expect(state!.delegation.updatedAt).toBe(baseTime + 50)
    expect(state!.participants.size).toBe(2)
    expect(state!.participants.get(partBuildId)?.role).toBe("implementer")
    expect(state!.participants.get(partCodexId)?.role).toBe("reviewer")
    expect(state!.turns.size).toBe(1)
    expect(state!.turns.get(turn1Id)?.seq).toBe(1)
    expect(state!.turns.get(turn1Id)?.status).toBe("completed")
  })

  test("deterministic replay: folding after delay produces identical output (no Date.now)", async () => {
    const baseTime = 1700000000000
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Deterministic Replay Test",
          status: "draft",
          timestamp: baseTime,
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
          timestamp: baseTime + 100,
        },
        1,
      ),
    ]

    const state1 = foldDelegation(events)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const state2 = foldDelegation(events)

    expect(state1!.delegation.createdAt).toBe(state2!.delegation.createdAt)
    expect(state1!.delegation.updatedAt).toBe(state2!.delegation.updatedAt)
    expect(state1!.delegation.lastActivityAt).toBe(state2!.delegation.lastActivityAt)
    expect(state1!.participants.get(partBuildId)?.createdAt).toBe(state2!.participants.get(partBuildId)?.createdAt)
  })

  test("fails closed when aggregate ID does not match expected delegation ID", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "draft",
          timestamp: 1000,
        },
        0,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: DelegationID.ID.make("dlg_other_99"),
          participantID: partBuildId,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "active",
          timestamp: 1010,
        },
        1,
      ),
    ]

    expect(() => foldDelegation(events)).toThrow(DelegationAggregateMismatchError)
  })

  test("fails closed when durable aggregate header does not match delegation ID", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "draft",
          timestamp: 1000,
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
          timestamp: 1010,
        },
        1,
        "dlg_spoofed_aggregate",
      ),
    ]

    expect(() => foldDelegation(events)).toThrow(DelegationAggregateMismatchError)
  })

  test("fails closed when event sequence is non-monotonic or duplicated", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "draft",
          timestamp: 1000,
        },
        1,
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
          timestamp: 1010,
        },
        1, // duplicate seq 1!
      ),
    ]

    expect(() => foldDelegation(events)).toThrow(DelegationSequenceError)
  })

  test("fails closed on malformed known delegation event", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "draft",
          timestamp: 1000,
        },
        0,
      ),
      {
        id: EventV2.ID.create(),
        type: DelegationEvent.ParticipantAdded.type,
        data: {
          delegationID: dlgId,
          // Missing required fields like participantID, provider, etc.
        },
        durable: {
          aggregateID: dlgId,
          seq: 1,
          version: 1,
        },
      },
    ]

    expect(() => foldDelegation(events)).toThrow(DelegationCorruptedEventError)
  })

  test("rejected verdict establishes sticky blocker that survives subsequent revisions until retracted (G4)", () => {
    const baseTime = 1700000000000
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Test",
          status: "waiting_review",
          timestamp: baseTime,
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
          timestamp: baseTime + 10,
        },
        1,
      ),
      // Codex issues rejection
      makeEvent(
        DelegationEvent.ReviewRejected,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          reviewedRevisionDigest: validDigest,
          findings: [{ severity: "blocking", summary: "SQL injection vulnerability" }],
          summary: "Rejected due to security flaw",
          timestamp: baseTime + 20,
        },
        2,
      ),
    ]

    const stateAfterReject = foldDelegation(events)
    expect(stateAfterReject?.delegation.rejectionBlocked).toBe(true)
    expect(stateAfterReject?.delegation.rejectionReason).toContain("Rejected due to security flaw")

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
          revisionDigest: validDigest2,
          changeKind: "rework",
          diffSummary: "Fixed security flaw",
          timestamp: baseTime + 30,
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
          timestamp: baseTime + 40,
        },
        4,
      ),
    ]

    const stateAfterRetraction = foldDelegation(eventsWithRetraction)
    expect(stateAfterRetraction?.delegation.rejectionBlocked).toBe(false)
  })

  test("folds full lifecycle transitions: draft -> running -> approved -> closing -> completed -> archived", () => {
    const baseTime = 1700000000000
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Lifecycle Test",
          status: "draft",
          timestamp: baseTime,
        },
        0,
      ),
      makeEvent(
        DelegationEvent.TurnAdmitted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          seq: 1,
          kind: "task",
          participantIDs: [partBuildId],
          delivery: "steer",
          timestamp: baseTime + 10,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ReviewApproved,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          reviewedRevisionDigest: validDigest,
          findings: [],
          summary: "Approved by reviewer",
          timestamp: baseTime + 20,
        },
        2,
      ),
      makeEvent(
        DelegationEvent.Closing,
        {
          delegationID: dlgId,
          reason: "Ready to wrap up",
          timestamp: baseTime + 30,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.Completed,
        {
          delegationID: dlgId,
          summary: "All work completed",
          timestamp: baseTime + 40,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.Archived,
        {
          delegationID: dlgId,
          timestamp: baseTime + 50,
        },
        5,
      ),
    ]

    const state = foldDelegation(events)
    expect(state!.delegation.status).toBe("archived")
    expect(state!.delegation.completedAt).toBe(baseTime + 40)
    expect(state!.delegation.closedAt).toBe(baseTime + 40)
    expect(state!.delegation.archivedAt).toBe(baseTime + 50)
  })
})
