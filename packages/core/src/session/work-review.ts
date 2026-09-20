export * as WorkReviewMachine from "./work-review"

import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"

/**
 * Pure S9A Work review-lifecycle state machine
 * (contract: docs/plan/s9a-work-review-lifecycle-contract.md).
 *
 * No I/O, no Effect: it takes the current review (or `undefined` for none) plus an
 * event and returns either the next review or a typed rejection. The producer that
 * persists the result into session metadata is a separate, still-owed unit.
 */

export type Event =
  | { readonly kind: "submit"; readonly artifactRevision: WorkflowAsset.Revision; readonly at: number }
  | { readonly kind: "request_changes"; readonly artifactRevision: WorkflowAsset.Revision; readonly at: number }
  | { readonly kind: "respond"; readonly at: number }
  | { readonly kind: "re_review"; readonly at: number }
  | { readonly kind: "approve"; readonly artifactRevision: WorkflowAsset.Revision; readonly at: number }
  | { readonly kind: "reopen"; readonly at: number }

export type Rejection = { readonly _tag: "IllegalTransition"; readonly from: WorkReview.State | "none"; readonly event: Event["kind"] }

export type Result =
  | { readonly ok: true; readonly review: WorkReview.Review }
  | { readonly ok: false; readonly error: Rejection }

const reject = (from: WorkReview.State | "none", event: Event["kind"]): Result => ({
  ok: false,
  error: { _tag: "IllegalTransition", from, event },
})

const make = (
  state: WorkReview.State,
  artifactRevision: WorkflowAsset.Revision,
  at: number,
  reopenedFrom?: WorkReview.State,
): Result => ({
  ok: true,
  review: WorkReview.Review.make({
    contractVersion: 1,
    state,
    artifactRevision,
    ...(reopenedFrom ? { reopenedFrom } : {}),
    updatedAt: at,
  }),
})

/**
 * Apply `event` to `current` (undefined = no review yet). Illegal transitions are
 * rejected (I1); `request_changes`/`approve` bind the reviewed artifact revision (I2).
 */
export function transition(current: WorkReview.Review | undefined, event: Event): Result {
  if (current === undefined) {
    // I4: only submitting opens a review; nothing else may fabricate one.
    return event.kind === "submit" ? make("open", event.artifactRevision, event.at) : reject("none", event.kind)
  }
  switch (event.kind) {
    case "submit":
      return reject(current.state, "submit")
    case "request_changes":
      return current.state === "open"
        ? make("fix_requested", event.artifactRevision, event.at)
        : reject(current.state, "request_changes")
    case "respond":
      return current.state === "fix_requested"
        ? make("responded", current.artifactRevision, event.at)
        : reject(current.state, "respond")
    case "re_review":
      return current.state === "responded"
        ? make("open", current.artifactRevision, event.at)
        : reject(current.state, "re_review")
    case "approve":
      return current.state === "open"
        ? make("resolved", event.artifactRevision, event.at)
        : reject(current.state, "approve")
    case "reopen":
      return current.state === "resolved"
        ? make("open", current.artifactRevision, event.at, "resolved")
        : reject(current.state, "reopen")
  }
}

/**
 * I3: a review verdict is only current while the artifact is still at the revision
 * it was formed against. Once the content moves on, the verdict is stale — the
 * caller must not treat it as still binding.
 */
export function isVerdictCurrent(review: WorkReview.Review, currentArtifactRevision: WorkflowAsset.Revision): boolean {
  return review.artifactRevision === currentArtifactRevision
}
