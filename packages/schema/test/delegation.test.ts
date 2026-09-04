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

    // Invalid prefix throws or fails decode
    expect(() => Schema.decodeUnknownSync(DelegationID.ID)("ses_not_delegation")).toThrow()
    expect(() => Schema.decodeUnknownSync(ParticipantID)("dlg_not_participant")).toThrow()
    expect(() => Schema.decodeUnknownSync(TurnID)("par_not_turn")).toThrow()
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
    const validEnvelope = {
      reviewedRevisionDigest: "rev_sha256_abcdef",
      verdict: "approved",
      findings: [
        {
          file: "src/index.ts",
          line: 42,
          severity: "info",
          message: "Looks good",
        },
      ],
      summary: "Review completed with approval",
    }

    const decoded = Schema.decodeUnknownSync(Delegation.ReviewEnvelope)(validEnvelope)
    expect(decoded.verdict).toBe("approved")
    expect(decoded.reviewedRevisionDigest).toBe("rev_sha256_abcdef")
    expect(decoded.findings.length).toBe(1)

    // Unknown verdict rejected
    expect(() =>
      Schema.decodeUnknownSync(Delegation.ReviewEnvelope)({
        ...validEnvelope,
        verdict: "looks_legit",
      }),
    ).toThrow()
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
