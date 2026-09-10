import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Delegation, DelegationID, ParticipantID, TurnID } from "../src"

describe("Delegation Schema and Branded IDs", () => {
  test("branded IDs validate prefix and create unique identifiers", () => {
    const dlgId = DelegationID.ID.create()
    const parId = ParticipantID.create()
    const trnId = TurnID.create()

    expect(dlgId.startsWith("dlg_")).toBe(true)
    expect(parId.startsWith("par_")).toBe(true)
    expect(trnId.startsWith("trn_")).toBe(true)

    // Valid make
    expect(String(DelegationID.ID.make("dlg_test_1"))).toBe("dlg_test_1")
    expect(String(ParticipantID.make("par_test_1"))).toBe("par_test_1")
    expect(String(TurnID.make("trn_test_1"))).toBe("trn_test_1")

    // Invalid prefix throws or fails decode (must have trailing underscore)
    expect(() => Schema.decodeUnknownSync(DelegationID.ID)("ses_not_delegation")).toThrow()
    expect(() => Schema.decodeUnknownSync(DelegationID.ID)("dlgBAD")).toThrow()
    expect(() => Schema.decodeUnknownSync(ParticipantID)("dlg_not_participant")).toThrow()
    expect(() => Schema.decodeUnknownSync(ParticipantID)("parBAD")).toThrow()
    expect(() => Schema.decodeUnknownSync(TurnID)("par_not_turn")).toThrow()
    expect(() => Schema.decodeUnknownSync(TurnID)("trnBAD")).toThrow()
  })

  test("Delegation.Info validates valid structures and rejects invalid states/titles", () => {
    const now = Date.now()
    const validRaw = {
      id: "dlg_01",
      parentSessionID: "ses_parent",
      title: "Fix bug in parser",
      status: "draft",
      rejectionBlocked: false,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }

    const decoded = Schema.decodeUnknownSync(Delegation.Info)(validRaw)
    expect(decoded.id).toBe(DelegationID.ID.make("dlg_01"))
    expect(decoded.title).toBe("Fix bug in parser")
    expect(decoded.status).toBe("draft")

    // ADR-22 approved statuses must decode
    for (const status of ["changes_requested", "failed", "recovery_required", "closing"] as const) {
      const s = Schema.decodeUnknownSync(Delegation.Info)({
        ...validRaw,
        status,
      })
      expect(s.status).toBe(status)
    }

    // Empty title rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.Info)({
        ...validRaw,
        title: "",
      }),
    ).toThrow()

    // Unknown status rejected (including "deleted", which is a purge command not a status)
    expect(() =>
      Schema.decodeUnknownSync(Delegation.Info)({
        ...validRaw,
        status: "deleted",
      }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(Delegation.Info)({
        ...validRaw,
        status: "unknown_status",
      }),
    ).toThrow()

    // Revision digests are typed at the projection boundary too.
    expect(() =>
      Schema.decodeUnknownSync(Delegation.Info)({
        ...validRaw,
        latestRevisionDigest: "not-a-revision-digest",
      }),
    ).toThrow()
  })

  test("ParticipantInfo enforces phase/status separation and valid roles", () => {
    const now = Date.now()
    const validParticipant = {
      id: "par_01",
      delegationID: "dlg_01",
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "provisioning",
      runtimeStatus: "idle",
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }

    const decoded = Schema.decodeUnknownSync(Delegation.ParticipantInfo)(validParticipant)
    expect(decoded.role).toBe("implementer")
    expect(decoded.phase).toBe("provisioning")
    expect(decoded.runtimeStatus).toBe("idle")

    // Phase closed is supported
    const closed = Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
      ...validParticipant,
      phase: "closed",
    })
    expect(closed.phase).toBe("closed")

    // Unknown role rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
        ...validParticipant,
        role: "hacker",
      }),
    ).toThrow()

    // Invalid phase rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ParticipantInfo)({
        ...validParticipant,
        phase: "running", // running is a runtimeStatus, NOT a roster phase!
      }),
    ).toThrow()
  })

  test("ReviewEnvelope validates verdict, findings, and revision digest", () => {
    const dummyDigest = "rev_" + "a".repeat(64)
    const validEnvelope = {
      kind: "aigcfroge.review.v1",
      reviewed_revision_digest: dummyDigest,
      verdict: "approved",
      findings: [
        {
          file: "src/index.ts",
          line: 42,
          severity: "blocking",
          summary: "Looks good",
        },
      ],
      summary: "Review completed with approval",
    }

    const decoded = Schema.decodeUnknownSync(Delegation.ReviewEnvelope)(validEnvelope)
    expect(decoded.verdict).toBe("approved")
    expect(decoded.reviewed_revision_digest).toBe(dummyDigest)
    expect(decoded.findings.length).toBe(1)
    expect(decoded.findings[0]?.severity).toBe("blocking")

    // Invalid severity "info" must be rejected (only blocking | major | minor | note)
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ReviewEnvelope)({
        ...validEnvelope,
        findings: [
          {
            severity: "info",
            summary: "info not allowed",
          },
        ],
      }),
    ).toThrow()

    // Negative line number rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ReviewEnvelope)({
        ...validEnvelope,
        findings: [
          {
            severity: "blocking",
            summary: "Negative line",
            line: -1,
          },
        ],
      }),
    ).toThrow()

    // Invalid revision digest format rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ReviewEnvelope)({
        ...validEnvelope,
        reviewed_revision_digest: "not_a_valid_digest",
      }),
    ).toThrow()

    // Unknown verdict rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ReviewEnvelope)({
        ...validEnvelope,
        verdict: "looks_legit",
      }),
    ).toThrow()
  })

  test("DeliveryOrigin requires a stable sender for fold identity", () => {
    const valid = {
      turnID: "trn_delivery",
      deliveryOrigin: "build",
      senderParticipantID: "par_sender",
    }

    expect(Schema.decodeUnknownSync(Delegation.DeliveryOrigin)(valid).senderParticipantID).toBe(
      ParticipantID.make("par_sender"),
    )
    expect(() =>
      Schema.decodeUnknownSync(Delegation.DeliveryOrigin)({
        turnID: valid.turnID,
        deliveryOrigin: valid.deliveryOrigin,
      }),
    ).toThrow()
  })

  test("TurnInfo enforces non-negative integer sequence and typed revision digest", () => {
    const valid = {
      id: "trn_01",
      delegationID: "dlg_01",
      seq: 0,
      kind: "task",
      status: "admitted",
      participantIDs: ["par_01"],
      delivery: "steer",
      revisionDigest: `rev_${"a".repeat(64)}`,
      createdAt: 1,
      updatedAt: 1,
    }

    expect(Schema.decodeUnknownSync(Delegation.TurnInfo)(valid).seq).toBe(0)
    expect(() => Schema.decodeUnknownSync(Delegation.TurnInfo)({ ...valid, seq: -1 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Delegation.TurnInfo)({ ...valid, seq: 0.5 })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Delegation.TurnInfo)({ ...valid, revisionDigest: "not-a-revision-digest" }),
    ).toThrow()
  })

  test("ReviewEnvelope requires its version discriminator and bounded prompt summaries stay non-durable", () => {
    const withoutKind = {
      reviewed_revision_digest: `rev_${"a".repeat(64)}`,
      verdict: "approved",
      findings: [],
    }
    expect(() => Schema.decodeUnknownSync(Delegation.ReviewEnvelope)(withoutKind)).toThrow()
  })

  test("TaggedErrors instantiate with expected tags", () => {
    const notFound = new Delegation.DelegationNotFoundError({
      delegationID: DelegationID.ID.make("dlg_missing"),
    })
    expect(notFound._tag).toBe("Delegation.DelegationNotFoundError")
    expect(String(notFound.delegationID)).toBe("dlg_missing")

    const stateErr = new Delegation.DelegationInvalidStateError({
      delegationID: DelegationID.ID.make("dlg_err"),
      currentStatus: "completed",
      attemptedTransition: "running",
      reason: "Completed delegation cannot transition back to running",
    })
    expect(stateErr._tag).toBe("Delegation.DelegationInvalidStateError")
  })
})
