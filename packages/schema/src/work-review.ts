export * as WorkReview from "./work-review"

import { Schema } from "effect"
import { WorkContract } from "./work-contract"
import { WorkflowAsset } from "./workflow-asset"

/**
 * S9A Work review lifecycle (contract: docs/plan/s9a-work-review-lifecycle-contract.md).
 * A review verdict is always bound to the artifact revision it reviewed (I2), so a
 * later content change never silently carries the verdict forward (I3, enforced by
 * `WorkReviewMachine.isVerdictCurrent`). Review is optional on a Work session — an
 * absent record is a valid ad-hoc session (I4).
 */
export const State = Schema.Literals(["open", "fix_requested", "responded", "resolved"]).annotate({
  identifier: "WorkReview.State",
})
export type State = typeof State.Type

export const Review = Schema.Struct({
  contractVersion: WorkContract.ContractVersion,
  state: State,
  /** The artifact revision this review verdict was formed against (I2). */
  artifactRevision: WorkflowAsset.Revision,
  /** Set only when the current `open` state was reached by reopening a `resolved` review. */
  reopenedFrom: Schema.optional(State),
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkReview.Review" })
export type Review = typeof Review.Type
