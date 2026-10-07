import { absurd } from "effect/Function"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"

/**
 * Pure Work review lifecycle. The producer supplies the verified current artifact
 * binding and checks expectedReviewRevision before applying and persisting an event.
 */
export type Event =
  | {
      readonly kind: "submit"
      readonly artifactID: string
      readonly artifactRevision: WorkflowAsset.Revision
      readonly at: number
    }
  | {
      readonly kind: "request_changes"
      readonly artifactID: string
      readonly artifactRevision: WorkflowAsset.Revision
      readonly at: number
    }
  | { readonly kind: "respond"; readonly at: number }
  | {
      readonly kind: "re_review"
      readonly artifactID: string
      readonly artifactRevision: WorkflowAsset.Revision
      readonly at: number
    }
  | {
      readonly kind: "approve"
      readonly artifactID: string
      readonly artifactRevision: WorkflowAsset.Revision
      readonly at: number
    }
  | {
      readonly kind: "reopen"
      readonly artifactID: string
      readonly artifactRevision: WorkflowAsset.Revision
      readonly at: number
    }

export type Rejection = {
  readonly _tag: "IllegalTransition"
  readonly from: WorkReview.State | "none"
  readonly event: Event["kind"]
  readonly reason: "invalid_state" | "artifact_mismatch" | "review_not_stale"
}

export type Result =
  | { readonly ok: true; readonly review: WorkReview.Review }
  | { readonly ok: false; readonly error: Rejection }

/** Apply one event without mutating the current review or advancing a rejected command. */
export function transition(current: WorkReview.Review | undefined, event: Event): Result {
  if (current === undefined) {
    return event.kind === "submit" ? make(current, "open", event, event.at) : reject("none", event.kind)
  }
  switch (event.kind) {
    case "submit":
      return reject(current.state, event.kind)
    case "request_changes":
    case "approve":
      if (current.state !== "open") return reject(current.state, event.kind)
      if (!isVerdictCurrent(current, event)) return reject(current.state, event.kind, "artifact_mismatch")
      return make(current, event.kind === "approve" ? "resolved" : "fix_requested", event, event.at)
    case "respond":
      if (current.state !== "fix_requested") return reject(current.state, event.kind)
      return make(current, "responded", current, event.at)
    case "re_review":
      if (current.state !== "responded" && current.state !== "open") return reject(current.state, event.kind)
      if (current.state === "open" && isVerdictCurrent(current, event)) {
        return reject(current.state, event.kind, "review_not_stale")
      }
      return make(current, "open", event, event.at)
    case "reopen":
      if (current.state !== "resolved") return reject(current.state, event.kind)
      return make(current, "open", event, event.at, "resolved")
    default:
      return absurd(event)
  }
}

/** Also detects stale open reviews: a matching hash alone cannot transfer a verdict to another artifact. */
export function isVerdictCurrent(review: WorkReview.Review, artifact: WorkReview.Binding): boolean {
  return review.artifactID === artifact.artifactID && review.artifactRevision === artifact.artifactRevision
}

function reject(
  from: WorkReview.State | "none",
  event: Event["kind"],
  reason: Rejection["reason"] = "invalid_state",
): Result {
  return { ok: false, error: { _tag: "IllegalTransition", from, event, reason } }
}

function make(
  current: WorkReview.Review | undefined,
  state: WorkReview.State,
  binding: WorkReview.Binding,
  at: number,
  reopenedFrom?: WorkReview.State,
): Result {
  return {
    ok: true,
    review: new WorkReview.Review({
      contractVersion: 1,
      state,
      artifactID: binding.artifactID,
      artifactRevision: binding.artifactRevision,
      revision: current === undefined ? 1 : current.revision + 1,
      ...(reopenedFrom ? { reopenedFrom } : {}),
      updatedAt: at,
    }),
  }
}

export * as WorkReviewMachine from "./work-review"
