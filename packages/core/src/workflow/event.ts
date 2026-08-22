export * as WorkflowEvent from "./event"

import { Effect, Schema } from "effect"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { EventV2 } from "../event"

export const Updated = EventV2.define({
  type: "workflow.run.updated",
  durable: { version: 1, aggregate: "runID" },
  schema: {
    runID: WorkflowAsset.WorkflowRunID,
    sessionID: Schema.String,
    status: WorkflowAsset.WorkflowRunStatus,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    currentStepId: Schema.optional(Schema.String),
    errorCategory: Schema.optional(WorkflowAsset.ErrorCategory),
    timeUpdated: Schema.Finite,
  },
})

export type Update = EventV2.Data<typeof Updated>

export class CommitRejected extends Schema.TaggedErrorClass<CommitRejected>()(
  "WorkflowEvent.CommitRejected",
  {
    runID: WorkflowAsset.WorkflowRunID,
    revision: Schema.Int,
  },
) {
  override get message() {
    return `Workflow run ${this.runID} rejected revision ${this.revision}`
  }
}

export const publish = Effect.fn("WorkflowEvent.publish")(function* (
  events: EventV2.Interface,
  update: Update,
  commit: (seq: number) => Effect.Effect<boolean>,
) {
  return yield* events
    .publish(Updated, update, {
      commit: (seq) => {
        if (seq + 1 !== update.revision) {
          return Effect.die(new CommitRejected({ runID: update.runID, revision: update.revision }))
        }
        return commit(seq).pipe(
          Effect.flatMap((accepted) =>
            accepted
              ? Effect.void
              : Effect.die(new CommitRejected({ runID: update.runID, revision: update.revision })),
          ),
        )
      },
    })
    .pipe(
      Effect.catchDefect((defect) =>
        defect instanceof CommitRejected ? Effect.fail(defect) : Effect.die(defect),
      ),
    )
})
