import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionID } from "@aigcfroge/schema/session-id"
import { foldDelegation } from "../src/delegation/fold"
import { DelegationEvent } from "../src/delegation/event"
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
          senderParticipantID: partBuildId,
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
          senderParticipantID: partBuildId,
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
    expect(state!.turns.get(turn1Id)?.status).toBe("partially_completed")
  })

  test("deterministic replay produces identical output (no Date.now)", () => {
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

  test("fails closed when event sequence is non-monotonic, gapped, or duplicated", () => {
    const created = makeEvent(
      DelegationEvent.Created,
      {
        delegationID: dlgId,
        parentSessionID: parentSesId,
        title: "Test",
        status: "draft",
        timestamp: 1000,
      },
      0,
    )
    const participant = makeEvent(
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
    )

    expect(() => foldDelegation([created, { ...participant, durable: { ...participant.durable!, seq: 2 } }])).toThrow(
      DelegationSequenceError,
    )
    expect(() =>
      foldDelegation([created, { ...participant, durable: { ...participant.durable!, seq: 1 } }]),
    ).not.toThrow()
    expect(() =>
      foldDelegation([created, { ...participant, durable: { ...participant.durable!, seq: 1 } }, participant]),
    ).toThrow(DelegationSequenceError)
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
          status: "draft",
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
          timestamp: baseTime + 15,
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
          timestamp: baseTime + 16,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha_initial",
          revisionDigest: validDigest,
          changeKind: "rework",
          timestamp: baseTime + 17,
        },
        4,
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
        5,
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
        6,
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
        7,
      ),
    ]

    const stateAfterRetraction = foldDelegation(eventsWithRetraction)
    expect(stateAfterRetraction?.delegation.rejectionBlocked).toBe(false)
  })

  test("durable turn events retain only bounded prompt summaries", () => {
    const decoded = Schema.decodeUnknownSync(DelegationEvent.TurnAdmittedData)({
      delegationID: dlgId,
      turnID: turn1Id,
      seq: 1,
      kind: "task",
      prompt: "raw prompt must not be persisted",
      promptSummary: "safe summary",
      participantIDs: [partBuildId],
      delivery: "steer",
      timestamp: 1000,
    })

    expect(decoded.promptSummary).toBe("safe summary")
    expect("prompt" in decoded).toBe(false)
    expect(() =>
      Schema.decodeUnknownSync(DelegationEvent.TurnAdmittedData)({
        delegationID: dlgId,
        turnID: turn1Id,
        seq: 1,
        kind: "task",
        promptSummary: "x".repeat(1025),
        participantIDs: [partBuildId],
        delivery: "steer",
        timestamp: 1000,
      }),
    ).toThrow()
  })

  test("rejects a known delegation event without its durable envelope", () => {
    const event: EventV2.Payload<typeof DelegationEvent.Created> = {
      id: EventV2.ID.create(),
      type: DelegationEvent.Created.type,
      data: {
        delegationID: dlgId,
        parentSessionID: parentSesId,
        title: "Missing durable header",
        status: "draft",
        timestamp: 1000,
      },
    }

    expect(() => foldDelegation([event])).toThrow(DelegationCorruptedEventError)
  })

  test("fails closed when the stream has no creation boundary or skips a lifecycle transition", () => {
    const turnOnly = makeEvent(
      DelegationEvent.TurnAdmitted,
      {
        delegationID: dlgId,
        turnID: turn1Id,
        seq: 1,
        kind: "task",
        participantIDs: [partBuildId],
        delivery: "steer",
        timestamp: 1000,
      },
      0,
    )
    expect(() => foldDelegation([turnOnly])).toThrow(DelegationCorruptedEventError)

    const created = makeEvent(
      DelegationEvent.Created,
      {
        delegationID: dlgId,
        parentSessionID: parentSesId,
        title: "Lifecycle boundary",
        status: "draft",
        timestamp: 1000,
      },
      0,
    )
    const closing = makeEvent(
      DelegationEvent.Closing,
      {
        delegationID: dlgId,
        reason: "cannot close a draft directly",
        timestamp: 1001,
      },
      1,
    )
    expect(() => foldDelegation([created, closing])).toThrow(DelegationCorruptedEventError)
  })

  test("preserves senderParticipantID in delivery identity", () => {
    const senderA = ParticipantID.make("par_sender_a")
    const senderB = ParticipantID.make("par_sender_b")
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Delivery identity",
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
          timestamp: 1001,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: senderA,
          provider: "internal",
          target: "sender-a",
          role: "observer",
          context: "fresh",
          phase: "active",
          timestamp: 1001,
        },
        2,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: senderB,
          provider: "internal",
          target: "sender-b",
          role: "observer",
          context: "fresh",
          phase: "active",
          timestamp: 1001,
        },
        3,
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
          timestamp: 1002,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.DeliveryStarted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "same-origin",
          senderParticipantID: senderA,
          attempt: 1,
          timestamp: 1003,
        },
        5,
      ),
      makeEvent(
        DelegationEvent.DeliveryStarted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "same-origin",
          senderParticipantID: senderB,
          attempt: 1,
          timestamp: 1004,
        },
        6,
      ),
    ]

    const state = foldDelegation(events)
    expect(state?.deliveries.size).toBe(2)
    expect([...state!.deliveries.values()].map((delivery) => delivery.senderParticipantID)).toEqual([senderA, senderB])
  })

  test("does not complete a turn while one of its participant deliveries is pending", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Partial delivery",
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
          timestamp: 1001,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "review",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          timestamp: 1002,
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
          timestamp: 1003,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "build",
          senderParticipantID: partBuildId,
          attempt: 1,
          timestamp: 1004,
        },
        4,
      ),
    ]

    const state = foldDelegation(events)
    expect(state?.turns.get(turn1Id)?.status).toBe("partially_completed")
  })

  test("persists participant failure without allowing a late runtime event to revive the phase", () => {
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Participant failure",
          status: "draft",
          timestamp: 2000,
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
          timestamp: 2001,
        },
        1,
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
          timestamp: 2002,
        },
        2,
      ),
      makeEvent(
        DelegationEvent.DeliveryFailed,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "build",
          senderParticipantID: partBuildId,
          attempt: 1,
          errorCode: "transport_failed",
          timestamp: 2003,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.ParticipantInterrupted,
        {
          delegationID: dlgId,
          participantID: partBuildId,
          timestamp: 2004,
        },
        4,
      ),
    ]

    const state = foldDelegation(events)
    expect(state?.participants.get(partBuildId)?.phase).toBe("failed")
  })

  test("does not mark a stale or incomplete review set as aggregate approved", () => {
    const digestA = RevisionDigest.make(`rev_${"a".repeat(64)}`)
    const digestB = RevisionDigest.make(`rev_${"b".repeat(64)}`)
    const reviewerTwo = ParticipantID.make("par_reviewer_2")
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Review barrier",
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
          timestamp: 1001,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "review-1",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          timestamp: 1002,
        },
        2,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: reviewerTwo,
          provider: "codex",
          target: "review-2",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          timestamp: 1003,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.TurnAdmitted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          seq: 1,
          kind: "task",
          participantIDs: [partBuildId, partCodexId, reviewerTwo],
          delivery: "steer",
          timestamp: 1004,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "build",
          senderParticipantID: partBuildId,
          attempt: 1,
          timestamp: 1005,
        },
        5,
      ),
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha-a",
          revisionDigest: digestA,
          changeKind: "rework",
          timestamp: 1006,
        },
        6,
      ),
      makeEvent(
        DelegationEvent.ReviewApproved,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          reviewedRevisionDigest: digestB,
          findings: [],
          timestamp: 1007,
        },
        7,
      ),
    ]

    const state = foldDelegation(events)
    expect(state?.delegation.status).not.toBe("approved")
  })

  test("a substantive revision invalidates a previously approved aggregate", () => {
    const digestA = RevisionDigest.make(`rev_${"a".repeat(64)}`)
    const digestB = RevisionDigest.make(`rev_${"b".repeat(64)}`)
    const events: EventV2.Payload[] = [
      makeEvent(
        DelegationEvent.Created,
        {
          delegationID: dlgId,
          parentSessionID: parentSesId,
          title: "Revision invalidation",
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
          timestamp: 1001,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "review",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          timestamp: 1002,
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
          timestamp: 1003,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "build",
          senderParticipantID: partBuildId,
          attempt: 1,
          timestamp: 1004,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          deliveryOrigin: "review",
          senderParticipantID: partCodexId,
          attempt: 1,
          timestamp: 1005,
        },
        5,
      ),
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha-a",
          revisionDigest: digestA,
          changeKind: "rework",
          timestamp: 1005,
        },
        6,
      ),
      makeEvent(
        DelegationEvent.ReviewApproved,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          reviewedRevisionDigest: digestA,
          findings: [],
          timestamp: 1006,
        },
        7,
      ),
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha-b",
          revisionDigest: digestB,
          changeKind: "rework",
          timestamp: 1007,
        },
        8,
      ),
    ]

    const state = foldDelegation(events)
    expect(state?.delegation.status).toBe("waiting_review")
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
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partBuildId,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "active",
          timestamp: baseTime + 5,
        },
        1,
      ),
      makeEvent(
        DelegationEvent.ParticipantAdded,
        {
          delegationID: dlgId,
          participantID: partCodexId,
          provider: "codex",
          target: "review",
          role: "reviewer",
          context: "fresh",
          phase: "active",
          timestamp: baseTime + 6,
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
          timestamp: baseTime + 10,
        },
        3,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          deliveryOrigin: "build",
          senderParticipantID: partBuildId,
          attempt: 1,
          timestamp: baseTime + 11,
        },
        4,
      ),
      makeEvent(
        DelegationEvent.DeliveryCompleted,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partCodexId,
          deliveryOrigin: "review",
          senderParticipantID: partBuildId,
          attempt: 1,
          timestamp: baseTime + 12,
        },
        5,
      ),
      makeEvent(
        DelegationEvent.RevisionRecorded,
        {
          delegationID: dlgId,
          turnID: turn1Id,
          participantID: partBuildId,
          commitSha: "sha_lifecycle",
          revisionDigest: validDigest,
          changeKind: "rework",
          timestamp: baseTime + 13,
        },
        6,
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
          timestamp: baseTime + 14,
        },
        7,
      ),
      makeEvent(
        DelegationEvent.Closing,
        {
          delegationID: dlgId,
          reason: "Ready to wrap up",
          timestamp: baseTime + 30,
        },
        8,
      ),
      makeEvent(
        DelegationEvent.Completed,
        {
          delegationID: dlgId,
          summary: "All work completed",
          timestamp: baseTime + 40,
        },
        9,
      ),
      makeEvent(
        DelegationEvent.Archived,
        {
          delegationID: dlgId,
          timestamp: baseTime + 50,
        },
        10,
      ),
    ]

    const state = foldDelegation(events)
    expect(state!.delegation.status).toBe("archived")
    expect(state!.delegation.completedAt).toBe(baseTime + 40)
    expect(state!.delegation.closedAt).toBe(baseTime + 40)
    expect(state!.delegation.archivedAt).toBe(baseTime + 50)
  })
})
