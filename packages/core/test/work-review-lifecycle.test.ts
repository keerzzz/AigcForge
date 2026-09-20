import { describe, test } from "bun:test"

/**
 * S9A Work review-lifecycle — RED spec (PENDING Owner approval).
 *
 * Contract draft: docs/plan/s9a-work-review-lifecycle-contract.md
 * Manifest entry: coverage-manifest.json → deferred["work-review-lifecycle"]
 *
 * These are `test.todo` on purpose. The review-lifecycle states
 * (open → fix_requested → responded → resolved/reopened) are NOT in the PRD;
 * they are a proposal awaiting Owner sign-off on §3 (states/transitions),
 * §4 (schema home), and §5 (persistence). Until approved there is no
 * production owner to assert against, so writing real assertions would
 * encode an unapproved contract. Once approved, each todo below becomes an
 * expect() against the implemented WorkReview state machine — no assertion is
 * weakened, and no owner is faked in the meantime.
 */
describe("S9A Work review lifecycle (RED — awaiting contract approval)", () => {
  // ── Transitions (§3) ─────────────────────────────────────────────────────
  test.todo("submit for review moves a Work session's artifact from none to open")
  test.todo("reviewer requesting changes moves open → fix_requested with the reviewed artifact revision")
  test.todo("author responding moves fix_requested → responded")
  test.todo("re-review moves responded → open")
  test.todo("reviewer approval moves open → resolved")
  test.todo("reopen moves resolved → open, recording reopenedFrom = resolved")

  // ── Invariants (§3) ──────────────────────────────────────────────────────
  test.todo("I1: an illegal transition (e.g. resolved → responded) is rejected, not silently applied")
  test.todo("I2: every fix_requested / resolved carries the artifact revision it reviewed")
  test.todo("I3: updating artifact content does not auto-carry a prior review verdict to the new revision")
  test.todo("I4: a Work session with no review record is a valid ad-hoc session (review is not forced)")

  // ── Persistence (§5) ─────────────────────────────────────────────────────
  test.todo("the review state round-trips through the session metadata JSON with no migration")
  test.todo("an absent or undecodable review record degrades to undefined, never throws")
})
