import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { WorkReviewMachine } from "@aigcfroge/core/session/work-review"

/**
 * S9A Work review-lifecycle — implemented against the approved contract
 * (docs/plan/s9a-work-review-lifecycle-contract.md). Owner approved 2026-09-20:
 * reuse `open` + `reopenedFrom` (no 5th state), persist in session metadata JSON
 * (no migration). Assistant M2 scope deferred post-M1.
 *
 * These assert the pure state machine + the schema decode path that info.fromRow
 * uses. The single-backend E4 contract->review->artifact lifeline stays owed on
 * CI (ubuntu-latest/ext4); cross-server + failure matrix are post-MVP.
 */
const REV_A = WorkflowAsset.Revision.make("a".repeat(64))
const REV_B = WorkflowAsset.Revision.make("b".repeat(64))

const submit = () => {
  const r = WorkReviewMachine.transition(undefined, { kind: "submit", artifactRevision: REV_A, at: 1 })
  if (!r.ok) throw new Error("submit should succeed")
  return r.review
}

describe("S9A Work review lifecycle", () => {
  // ── Transitions (§3) ─────────────────────────────────────────────────────
  test("submit for review moves a Work session's artifact from none to open", () => {
    const r = WorkReviewMachine.transition(undefined, { kind: "submit", artifactRevision: REV_A, at: 1 })
    expect(r.ok && r.review.state).toBe("open")
  })

  test("reviewer requesting changes moves open → fix_requested with the reviewed artifact revision", () => {
    const r = WorkReviewMachine.transition(submit(), { kind: "request_changes", artifactRevision: REV_A, at: 2 })
    expect(r.ok && r.review.state).toBe("fix_requested")
    expect(r.ok && r.review.artifactRevision).toBe(REV_A)
  })

  test("author responding moves fix_requested → responded", () => {
    const fix = WorkReviewMachine.transition(submit(), { kind: "request_changes", artifactRevision: REV_A, at: 2 })
    const r = WorkReviewMachine.transition(fix.ok ? fix.review : undefined, { kind: "respond", at: 3 })
    expect(r.ok && r.review.state).toBe("responded")
  })

  test("re-review moves responded → open", () => {
    const fix = WorkReviewMachine.transition(submit(), { kind: "request_changes", artifactRevision: REV_A, at: 2 })
    const responded = WorkReviewMachine.transition(fix.ok ? fix.review : undefined, { kind: "respond", at: 3 })
    const r = WorkReviewMachine.transition(responded.ok ? responded.review : undefined, { kind: "re_review", at: 4 })
    expect(r.ok && r.review.state).toBe("open")
  })

  test("reviewer approval moves open → resolved", () => {
    const r = WorkReviewMachine.transition(submit(), { kind: "approve", artifactRevision: REV_A, at: 2 })
    expect(r.ok && r.review.state).toBe("resolved")
  })

  test("reopen moves resolved → open, recording reopenedFrom = resolved", () => {
    const resolved = WorkReviewMachine.transition(submit(), { kind: "approve", artifactRevision: REV_A, at: 2 })
    const r = WorkReviewMachine.transition(resolved.ok ? resolved.review : undefined, { kind: "reopen", at: 3 })
    expect(r.ok && r.review.state).toBe("open")
    expect(r.ok && r.review.reopenedFrom).toBe("resolved")
  })

  // ── Invariants (§3) ──────────────────────────────────────────────────────
  test("I1: an illegal transition (e.g. resolved → responded) is rejected, not silently applied", () => {
    const resolved = WorkReviewMachine.transition(submit(), { kind: "approve", artifactRevision: REV_A, at: 2 })
    const r = WorkReviewMachine.transition(resolved.ok ? resolved.review : undefined, { kind: "respond", at: 3 })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error._tag).toBe("IllegalTransition")
  })

  test("I2: every fix_requested / resolved carries the artifact revision it reviewed", () => {
    const fix = WorkReviewMachine.transition(submit(), { kind: "request_changes", artifactRevision: REV_B, at: 2 })
    expect(fix.ok && fix.review.artifactRevision).toBe(REV_B)
    const resolved = WorkReviewMachine.transition(submit(), { kind: "approve", artifactRevision: REV_B, at: 2 })
    expect(resolved.ok && resolved.review.artifactRevision).toBe(REV_B)
  })

  test("I3: updating artifact content does not auto-carry a prior review verdict to the new revision", () => {
    const resolved = WorkReviewMachine.transition(submit(), { kind: "approve", artifactRevision: REV_A, at: 2 })
    if (!resolved.ok) throw new Error("approve should succeed")
    // Verdict was formed against REV_A; once the artifact moves to REV_B it is no longer current.
    expect(WorkReviewMachine.isVerdictCurrent(resolved.review, REV_A)).toBe(true)
    expect(WorkReviewMachine.isVerdictCurrent(resolved.review, REV_B)).toBe(false)
  })

  test("I4: a Work session with no review record is a valid ad-hoc session (review is not forced)", () => {
    // No record = undefined; only `submit` is legal from none, and any review action
    // other than starting one is rejected rather than fabricating a state.
    const r = WorkReviewMachine.transition(undefined, { kind: "approve", artifactRevision: REV_A, at: 1 })
    expect(r.ok).toBe(false)
    // The absence itself is representable and valid on the session (optional field).
    expect(Schema.decodeUnknownOption(WorkReview.Review)(undefined)._tag).toBe("None")
  })

  // ── Persistence (§5) ─────────────────────────────────────────────────────
  test("the review state round-trips through the session metadata JSON with no migration", () => {
    const review = submit()
    const encoded = Schema.encodeUnknownSync(Schema.toCodecJson(WorkReview.Review))(review)
    const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(WorkReview.Review))(encoded)
    expect(decoded).toEqual(review)
  })

  test("an absent or undecodable review record degrades to undefined, never throws", () => {
    const decode = Schema.decodeUnknownOption(WorkReview.Review)
    expect(decode(undefined)._tag).toBe("None")
    expect(decode({ state: "not-a-state" })._tag).toBe("None")
    expect(decode("garbage")._tag).toBe("None")
  })
})
