export * as WorkflowEvent from "./event"

import { Effect, Schema } from "effect"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Updated } from "@aigcfroge/schema/workflow-event"
import { Bus } from "../bus"
import { Event } from "@aigcfroge/schema/event"

export { Updated } from "@aigcfroge/schema/workflow-event"

export type Update = Event.Data<typeof Updated>

export class CommitRejected extends Schema.TaggedError<CommitRejected>()("WorkflowEvent.CommitRejected", {
  runID: WorkflowAsset.WorkflowRunID,
  revision: Schema.Int,
}) {
  override get message() {
    return `Workflow run ${this.runID} rejected revision ${this.revision}`
  }
}

export const publish = Effect.fn("WorkflowEvent.publish")(function* (
  events: Bus.Interface,
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
            accepted ? Effect.void : Effect.die(new CommitRejected({ runID: update.runID, revision: update.revision })),
          ),
        )
      },
    })
    .pipe(Effect.catchDefect((defect) => (defect instanceof CommitRejected ? Effect.fail(defect) : Effect.die(defect))))
})
