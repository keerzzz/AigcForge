import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { WorkReviewMachine } from "@aigcfroge/core/session/work-review"

const REV_A = WorkflowAsset.Revision.make("a".repeat(64))
const REV_B = WorkflowAsset.Revision.make("b".repeat(64))
const A = { artifactID: "artifact-a", artifactRevision: REV_A }
const B = { artifactID: "artifact-b", artifactRevision: REV_B }

function apply(current: WorkReview.Review | undefined, event: WorkReviewMachine.Event) {
  const result = WorkReviewMachine.transition(current, event)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Unexpected rejection for ${event.kind}`)
  return result.review
}

function submit() {
  return apply(undefined, { kind: "submit", ...A, at: 1 })
}

describe("S9A Work review lifecycle — canonical B4 fixtures", () => {
  test("submit moves none to open", () => {
    expect(submit().state).toBe("open")
  })

  test("request_changes moves open to fix_requested with the reviewed binding", () => {
    expect(apply(submit(), { kind: "request_changes", ...A, at: 2 })).toMatchObject({
      state: "fix_requested",
      ...A,
    })
  })

  test("respond moves fix_requested to responded", () => {
    const fix = apply(submit(), { kind: "request_changes", ...A, at: 2 })
    expect(apply(fix, { kind: "respond", at: 3 }).state).toBe("responded")
  })

  test("re_review moves responded to open", () => {
    const fix = apply(submit(), { kind: "request_changes", ...A, at: 2 })
    const responded = apply(fix, { kind: "respond", at: 3 })
    expect(apply(responded, { kind: "re_review", ...B, at: 4 }).state).toBe("open")
  })

  test("approve moves open to resolved", () => {
    expect(apply(submit(), { kind: "approve", ...A, at: 2 }).state).toBe("resolved")
  })

  test("reopen moves resolved to open and records reopenedFrom", () => {
    const resolved = apply(submit(), { kind: "approve", ...A, at: 2 })
    expect(apply(resolved, { kind: "reopen", ...B, at: 3 })).toMatchObject({
      state: "open",
      reopenedFrom: "resolved",
    })
  })

  test("I1: resolved to responded is rejected", () => {
    const resolved = apply(submit(), { kind: "approve", ...A, at: 2 })
    const result = WorkReviewMachine.transition(resolved, { kind: "respond", at: 3 })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error._tag).toBe("IllegalTransition")
  })

  test("I2: fix_requested and resolved retain the artifact they reviewed", () => {
    expect(apply(submit(), { kind: "request_changes", ...A, at: 2 })).toMatchObject(A)
    expect(apply(submit(), { kind: "approve", ...A, at: 2 })).toMatchObject(A)
  })

  test("I3: changed artifact content does not inherit a verdict", () => {
    const resolved = apply(submit(), { kind: "approve", ...A, at: 2 })
    expect(WorkReviewMachine.isVerdictCurrent(resolved, A)).toBe(true)
    expect(WorkReviewMachine.isVerdictCurrent(resolved, { ...A, artifactRevision: REV_B })).toBe(false)
  })

  test("I4: absence does not fabricate a review", () => {
    expect(WorkReviewMachine.transition(undefined, { kind: "approve", ...A, at: 1 }).ok).toBe(false)
    expect(Schema.decodeUnknownOption(WorkReview.Review)(undefined)._tag).toBe("None")
  })

  test("canonical review round-trips through metadata JSON", () => {
    const review = submit()
    const codec = Schema.toCodecJson(WorkReview.Review)
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(review))).toEqual(review)
  })

  test("optional decoding rejects missing and malformed records without inventing defaults", () => {
    const decode = Schema.decodeUnknownOption(WorkReview.Review)
    expect(decode(undefined)._tag).toBe("None")
    expect(decode({ state: "not-a-state" })._tag).toBe("None")
    expect(decode("garbage")._tag).toBe("None")
  })
})

describe("AI-TDD-S06 machine invariants", () => {
  test("R13: submit creates revision 1 and the explicit artifact identity", () => {
    expect(submit()).toMatchObject({
      contractVersion: 1,
      state: "open",
      ...A,
      revision: 1,
      updatedAt: 1,
    })
  })

  test("R13: every successful action increments revision even when timestamps are equal", () => {
    const open = apply(undefined, { kind: "submit", ...A, at: 1 })
    const fix = apply(open, { kind: "request_changes", ...A, at: 1 })
    const responded = apply(fix, { kind: "respond", at: 1 })
    const reviewed = apply(responded, { kind: "re_review", ...B, at: 1 })
    const resolved = apply(reviewed, { kind: "approve", ...B, at: 1 })
    const reopened = apply(resolved, { kind: "reopen", ...A, at: 1 })
    expect([open, fix, responded, reviewed, resolved, reopened].map((review) => review.revision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    expect(responded).toMatchObject(A)
    expect(reviewed).toMatchObject(B)
    expect(reopened).toMatchObject({ ...A, reopenedFrom: "resolved" })
    expect(apply(reopened, { kind: "request_changes", ...A, at: 2 }).reopenedFrom).toBeUndefined()
  })

  const transitions = [
    { state: "open", allowed: { request_changes: "fix_requested", approve: "resolved" } },
    { state: "fix_requested", allowed: { respond: "responded" } },
    { state: "responded", allowed: { re_review: "open" } },
    { state: "resolved", allowed: { reopen: "open" } },
  ] as const
  const actions = ["submit", "request_changes", "respond", "re_review", "approve", "reopen"] as const

  transitions.forEach((row) => {
    test.each([...actions])(`R02: ${row.state} + %s follows the four-state contract`, (kind) => {
      const current = Object.freeze(
        Schema.decodeUnknownSync(WorkReview.Review)({
          contractVersion: 1,
          state: row.state,
          ...A,
          revision: 7,
          updatedAt: 1,
        }),
      )
      const snapshot = { ...current }
      const event = kind === "respond" ? { kind, at: 2 } : { kind, ...A, at: 2 }
      const result = WorkReviewMachine.transition(current, Object.freeze(event))
      const next = Object.entries(row.allowed).find((entry) => entry[0] === kind)?.[1]
      expect({ ...current }).toEqual(snapshot)
      if (next) {
        expect(result).toMatchObject({ ok: true, review: { state: next, ...A, revision: 8, updatedAt: 2 } })
        return
      }
      expect(result).toEqual({
        ok: false,
        error: {
          _tag: "IllegalTransition",
          from: row.state,
          event: kind,
          reason: row.state === "open" && kind === "re_review" ? "review_not_stale" : "invalid_state",
        },
      })
    })
  })

  test.each(["request_changes", "respond", "re_review", "approve", "reopen"] as const)(
    "R02: none + %s cannot fabricate a review",
    (kind) => {
      const event = kind === "respond" ? { kind, at: 1 } : { kind, ...A, at: 1 }
      expect(WorkReviewMachine.transition(undefined, event)).toEqual({
        ok: false,
        error: { _tag: "IllegalTransition", from: "none", event: kind, reason: "invalid_state" },
      })
    },
  )

  const stale = [
    { name: "content changed", binding: { ...A, artifactRevision: REV_B } },
    { name: "same hash on a different artifact", binding: { ...B, artifactRevision: REV_A } },
    { name: "identity and content changed", binding: B },
  ]

  stale.forEach((row) => {
    test.each(["approve", "request_changes"] as const)(`R14: %s rejects ${row.name}`, (kind) => {
      const current = Object.freeze(submit())
      const snapshot = { ...current }
      expect(WorkReviewMachine.transition(current, { kind, ...row.binding, at: 2 })).toEqual({
        ok: false,
        error: { _tag: "IllegalTransition", from: "open", event: kind, reason: "artifact_mismatch" },
      })
      expect({ ...current }).toEqual(snapshot)
    })

    test(`R17: stale open can explicitly re_review when ${row.name}`, () => {
      const current = Object.freeze(submit())
      const reviewed = apply(current, { kind: "re_review", ...row.binding, at: 2 })
      expect(reviewed).toMatchObject({ state: "open", ...row.binding, revision: 2, updatedAt: 2 })
      expect(reviewed.reopenedFrom).toBeUndefined()
      expect(WorkReviewMachine.isVerdictCurrent(current, row.binding)).toBe(false)
      expect(WorkReviewMachine.isVerdictCurrent(reviewed, row.binding)).toBe(true)
      expect(WorkReviewMachine.transition(reviewed, { kind: "approve", ...A, at: 3 }).ok).toBe(false)
      expect(apply(reviewed, { kind: "approve", ...row.binding, at: 3 })).toMatchObject({
        state: "resolved",
        ...row.binding,
        revision: 3,
      })
      expect(current).toMatchObject({ state: "open", ...A, revision: 1 })
    })
  })

  test("R14: reopening rebinds identity even when the new artifact has the same hash", () => {
    const resolved = apply(submit(), { kind: "approve", ...A, at: 2 })
    const sameHash = { ...B, artifactRevision: REV_A }
    expect(WorkReviewMachine.isVerdictCurrent(resolved, sameHash)).toBe(false)
    const reopened = apply(resolved, { kind: "reopen", ...sameHash, at: 3 })
    expect(reopened).toMatchObject({ state: "open", ...sameHash, revision: 3, reopenedFrom: "resolved" })
    expect(WorkReviewMachine.transition(reopened, { kind: "approve", ...A, at: 4 }).ok).toBe(false)
    expect(apply(reopened, { kind: "approve", ...sameHash, at: 4 })).toMatchObject({
      state: "resolved",
      ...sameHash,
      revision: 4,
    })
  })

  test.each(["open", "fix_requested", "responded", "resolved"] as const)(
    "R14: the sole binding predicate compares identity and revision for %s",
    (state) => {
      const review = Schema.decodeUnknownSync(WorkReview.Review)({
        contractVersion: 1,
        state,
        ...A,
        revision: 4,
        updatedAt: 1,
      })
      expect(WorkReviewMachine.isVerdictCurrent(review, A)).toBe(true)
      expect(WorkReviewMachine.isVerdictCurrent(review, { ...A, artifactRevision: REV_B })).toBe(false)
      expect(WorkReviewMachine.isVerdictCurrent(review, { ...B, artifactRevision: REV_A })).toBe(false)
      expect(WorkReviewMachine.isVerdictCurrent(review, B)).toBe(false)
    },
  )
})
