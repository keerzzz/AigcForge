import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optionalOmitUndefined } from "./schema"
import { WorkContract } from "./work-contract"
import { WorkflowAsset } from "./workflow-asset"

/** These keys have domain owners and cannot be replaced by generic Session metadata updates. */
export const OwnedMetadataKeys = ["workReview", "workArtifact", "workContract"] as const

/** Review availability is separate from the four-state lifecycle. */
export const State = Schema.Literals(["open", "fix_requested", "responded", "resolved"]).annotate({
  identifier: "WorkReview.State",
})
export type State = typeof State.Type

const ArtifactID = Schema.String.check(Schema.isMinLength(1))

export class Binding extends Schema.Class<Binding>("WorkReview.Binding")({
  artifactID: ArtifactID,
  artifactRevision: WorkflowAsset.Revision,
}) {}

export class Review extends Schema.Class<Review>("WorkReview.Review")({
  contractVersion: WorkContract.ContractVersion,
  state: State,
  /** Identity and content revision together identify the reviewed artifact. */
  artifactID: ArtifactID,
  artifactRevision: WorkflowAsset.Revision,
  /** The sole concurrency revision; only an absent review has expected revision 0. */
  revision: PositiveInt,
  /** Set only when this open state was reached by reopening a resolved review. */
  reopenedFrom: optionalOmitUndefined(State),
  updatedAt: Schema.Number,
}) {}

// Annotate the underlying Struct so construction and JSON decoding share the same boundary.
const commandAnnotations = { parseOptions: { onExcessProperty: "error" } } as const

export class ArtifactCommand extends Schema.Class<ArtifactCommand>("WorkReview.ArtifactCommand")(
  Schema.Struct({
    action: Schema.Literals(["submit", "request_changes", "approve", "re_review", "reopen"]),
    expectedReviewRevision: NonNegativeInt,
    artifactID: ArtifactID,
    expectedArtifactRevision: WorkflowAsset.Revision,
  }).annotate(commandAnnotations),
) {}

export class RespondCommand extends Schema.Class<RespondCommand>("WorkReview.RespondCommand")(
  Schema.Struct({
    action: Schema.Literal("respond"),
    expectedReviewRevision: NonNegativeInt,
  }).annotate(commandAnnotations),
) {}

export const Command = Schema.Union([ArtifactCommand, RespondCommand]).annotate({ identifier: "WorkReview.Command" })
export type Command = typeof Command.Type

export class None extends Schema.Class<None>("WorkReview.None")({
  status: Schema.Literal("none"),
  /** A saved artifact remains actionable before its first review, including after reload. */
  artifact: optionalOmitUndefined(Binding),
}) {}

export class Ready extends Schema.Class<Ready>("WorkReview.Ready")({
  status: Schema.Literal("ready"),
  review: Review,
  artifact: Binding,
  current: Schema.Boolean,
}) {}

export class Unavailable extends Schema.Class<Unavailable>("WorkReview.Unavailable")({
  status: Schema.Literal("unavailable"),
  reason: Schema.Literals(["corrupt_review", "artifact_missing", "artifact_unavailable"]),
  review: optionalOmitUndefined(Review),
}) {}

export const ReadResult = Schema.Union([None, Ready, Unavailable]).annotate({ identifier: "WorkReview.ReadResult" })
export type ReadResult = typeof ReadResult.Type

export * as WorkReview from "./work-review"
