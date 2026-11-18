import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Delegation, RevisionDigest } from "@aigcfroge/schema/delegation"
import { TurnID } from "@aigcfroge/schema/delegation-id"
import { canComplete, copyable, evaluateReviewBarrier, retractRejection } from "../src/delegation/review"

describe("Delegation Review Barrier and Copyability (Phase 1)", () => {
  test("copyable implements Gerrit sticky approval truth table (G3)", () => {
    // Approved verdict
    expect(copyable("no_change", "approved")).toBe(true)
    expect(copyable("no_code_change", "approved")).toBe(true)
    expect(copyable("formatting_only", "approved")).toBe(false) // Conservative downgrade
    expect(copyable("rework", "approved")).toBe(false)

    // Changes requested verdict: never copyable
    expect(copyable("no_change", "changes_requested")).toBe(false)
    expect(copyable("no_code_change", "changes_requested")).toBe(false)
    expect(copyable("formatting_only", "changes_requested")).toBe(false)
    expect(copyable("rework", "changes_requested")).toBe(false)

    // Rejected verdict: never copyable
    expect(copyable("no_change", "rejected")).toBe(false)
    expect(copyable("no_code_change", "rejected")).toBe(false)
    expect(copyable("formatting_only", "rejected")).toBe(false)
    expect(copyable("rework", "rejected")).toBe(false)
  })

  test("evaluateReviewBarrier passes when no reviewer exists (G6 compatibility)", () => {
    const buildParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_build_1",
      delegationID: "dlg_01",
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const result = evaluateReviewBarrier({
      participants: [buildParticipant],
      reviews: [],
      latestRevisionDigest: "rev_digest_1",
      rejectionBlocked: false,
    })

    expect(result.passed).toBe(true)
  })

  test("evaluateReviewBarrier evaluates reviewers and rejects on mismatch, missing review, or rejection (G4/G6)", () => {
    const buildParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_build_1",
      delegationID: "dlg_01",
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const reviewerParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_codex_1",
      delegationID: "dlg_01",
      provider: "codex",
      target: "codex-reviewer",
      role: "reviewer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const participants = [buildParticipant, reviewerParticipant]

    // 1. Missing review -> fails
    const missingResult = evaluateReviewBarrier({
      participants,
      reviews: [],
      latestRevisionDigest: "rev_digest_1",
      rejectionBlocked: false,
    })
    expect(missingResult.passed).toBe(false)

    // 2. Matching approved review -> passes
    const approvedResult = evaluateReviewBarrier({
      participants,
      reviews: [
        {
          participantID: reviewerParticipant.id,
          reviewedRevisionDigest: "rev_digest_1",
          verdict: "approved",
        },
      ],
      latestRevisionDigest: "rev_digest_1",
      rejectionBlocked: false,
    })
    expect(approvedResult.passed).toBe(true)

    // 3. Stale revision digest -> fails
    const staleResult = evaluateReviewBarrier({
      participants,
      reviews: [
        {
          participantID: reviewerParticipant.id,
          reviewedRevisionDigest: "rev_digest_old",
          verdict: "approved",
        },
      ],
      latestRevisionDigest: "rev_digest_new",
      rejectionBlocked: false,
    })
    expect(staleResult.passed).toBe(false)

    // 4. Sticky rejection blocked -> fails even with matching digest
    const blockedResult = evaluateReviewBarrier({
      participants,
      reviews: [
        {
          participantID: reviewerParticipant.id,
          reviewedRevisionDigest: "rev_digest_1",
          verdict: "approved",
        },
      ],
      latestRevisionDigest: "rev_digest_1",
      rejectionBlocked: true,
    })
    expect(blockedResult.passed).toBe(false)
  })

  test("requires the latest effective receipt from every reviewer or approver", () => {
    const participant = (id: string, role: "reviewer" | "approver") =>
      Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
        id,
        delegationID: "dlg_01",
        provider: "codex",
        target: role,
        role,
        context: "fresh",
        phase: "active",
        runtimeStatus: "idle",
        lastActivityAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      })
    const reviewerA = participant("par_reviewer_a", "reviewer")
    const reviewerB = participant("par_reviewer_b", "approver")
    const digest = "rev_" + "a".repeat(64)

    expect(
      evaluateReviewBarrier({
        participants: [reviewerA, reviewerB],
        reviews: [{ participantID: reviewerA.id, reviewedRevisionDigest: digest, verdict: "approved" }],
        latestRevisionDigest: digest,
        rejectionBlocked: false,
      }).passed,
    ).toBe(false)

    expect(
      evaluateReviewBarrier({
        participants: [reviewerA, reviewerB],
        reviews: [
          { participantID: reviewerA.id, reviewedRevisionDigest: digest, verdict: "rejected" },
          { participantID: reviewerA.id, reviewedRevisionDigest: digest, verdict: "approved" },
          { participantID: reviewerB.id, reviewedRevisionDigest: digest, verdict: "approved" },
        ],
        latestRevisionDigest: digest,
        rejectionBlocked: false,
      }).passed,
    ).toBe(true)
  })

  test("retractRejection unblocks sticky blocker (G4)", () => {
    const delegation = Schema.decodeUnknownSync(Delegation.Info)({
      id: "dlg_01",
      parentSessionID: "ses_parent",
      title: "Test delegation",
      status: "waiting_review",
      rejectionBlocked: true,
      rejectionReason: "Codex found severe vulnerability",
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const unblocked = retractRejection(delegation, "Vulnerability confirmed false positive by security team")
    expect(unblocked.rejectionBlocked).toBe(false)
    expect(unblocked.rejectionReason).toBeUndefined()
  })

  test("evaluateReviewBarrier passes when historical rejection was followed by approved review after retraction (G4)", () => {
    const reviewerParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_codex_1",
      delegationID: "dlg_01",
      provider: "codex",
      target: "codex-reviewer",
      role: "reviewer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    })

    const implementerParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_build_1",
      delegationID: "dlg_01",
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    })

    // Review history: initial rejection, then subsequent approval on the same revision
    const reviews = [
      {
        participantID: reviewerParticipant.id,
        reviewedRevisionDigest: "rev_digest_1",
        verdict: "rejected" as const,
      },
      {
        participantID: reviewerParticipant.id,
        reviewedRevisionDigest: "rev_digest_1",
        verdict: "approved" as const,
      },
      // Implementer submitting a rejected record must NOT block the review barrier
      {
        participantID: implementerParticipant.id,
        reviewedRevisionDigest: "rev_digest_1",
        verdict: "rejected" as const,
      },
    ]

    // When rejectionBlocked is false (e.g. retracted or superseded by approved), barrier MUST pass!
    const result = evaluateReviewBarrier({
      participants: [implementerParticipant, reviewerParticipant],
      reviews,
      latestRevisionDigest: "rev_digest_1",
      rejectionBlocked: false,
    })

    expect(result.passed).toBe(true)
  })

  test("completion barrier rejects a failed reviewer delivery even when a receipt exists", () => {
    const participant = (id: string, role: "implementer" | "reviewer") =>
      Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
        id,
        delegationID: "dlg_01",
        provider: role === "implementer" ? "internal" : "codex",
        target: role,
        role,
        context: "fresh",
        phase: "active",
        runtimeStatus: "idle",
        lastActivityAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      })
    const implementer = participant("par_impl_failed_reviewer", "implementer")
    const reviewer = participant("par_reviewer_failed_delivery", "reviewer")
    const revision = RevisionDigest.make(`rev_${"f".repeat(64)}`)

    const result = canComplete({
      participants: [implementer, reviewer],
      reviews: [{ participantID: reviewer.id, reviewedRevisionDigest: revision, verdict: "approved" }],
      latestRevisionDigest: revision,
      revisions: [{ revisionDigest: revision, changeKind: "rework" }],
      rejectionBlocked: false,
      turns: [
        {
          id: TurnID.make("trn_failed_reviewer"),
          seq: 1,
          status: "completed",
          participantIDs: [implementer.id, reviewer.id],
        },
      ],
      deliveries: [
        {
          turnID: TurnID.make("trn_failed_reviewer"),
          participantID: implementer.id,
          status: "completed",
          attempt: 1,
          updatedAt: 1,
        },
        {
          turnID: TurnID.make("trn_failed_reviewer"),
          participantID: reviewer.id,
          status: "failed",
          attempt: 1,
          updatedAt: 2,
        },
      ],
    })

    expect(result).toBe(false)
  })

  test("completion barrier uses the latest turn delivery, not an older completed attempt", () => {
    const implementer = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      id: "par_impl_latest_turn",
      delegationID: "dlg_01",
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "active",
      runtimeStatus: "idle",
      lastActivityAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    })
    const oldTurn = TurnID.make("trn_old_turn")
    const latestTurn = TurnID.make("trn_latest_turn")
    const result = canComplete({
      participants: [implementer],
      reviews: [],
      rejectionBlocked: false,
      turns: [
        { id: oldTurn, seq: 1, status: "completed", participantIDs: [implementer.id] },
        { id: latestTurn, seq: 2, status: "failed", participantIDs: [implementer.id] },
      ],
      deliveries: [
        { turnID: oldTurn, participantID: implementer.id, status: "completed", attempt: 1, updatedAt: 1 },
        { turnID: latestTurn, participantID: implementer.id, status: "failed", attempt: 1, updatedAt: 2 },
      ],
    })

    expect(result).toBe(false)
  })
})
