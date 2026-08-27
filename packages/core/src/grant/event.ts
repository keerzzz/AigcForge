export * as GrantEvent from "./event"

import { Effect, Schema } from "effect"
import { EventV2 } from "../event"

export const Updated = EventV2.define({
  type: "grant.updated",
  durable: { version: 1, aggregate: "grantID" },
  schema: {
    grantID: Schema.String,
    status: Schema.Literals(["active", "consumed", "revoked"]),
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    timeUpdated: Schema.Finite,
  },
})

export type Update = EventV2.Data<typeof Updated>

export class CommitRejected extends Schema.TaggedErrorClass<CommitRejected>()("GrantEvent.CommitRejected", {
  grantID: Schema.String,
  revision: Schema.Int,
}) {
  override get message() {
    return `Scoped grant ${this.grantID} rejected revision ${this.revision}`
  }
}

/** Publishes one durable state transition whose commit writes the row (same transaction). */
export const publish = Effect.fn("GrantEvent.publish")(function* (
  events: EventV2.Interface,
  update: Update,
  commit: (tx: EventV2.Transaction) => Effect.Effect<boolean>,
) {
  return yield* events
    .publish(Updated, update, {
      commit: (seq, tx) => {
        if (seq + 1 !== update.revision) {
          return Effect.die(new CommitRejected({ grantID: update.grantID, revision: update.revision }))
        }
        return commit(tx).pipe(
          Effect.flatMap((accepted) =>
            accepted
              ? Effect.void
              : Effect.die(new CommitRejected({ grantID: update.grantID, revision: update.revision })),
          ),
        )
      },
    })
    .pipe(Effect.catchDefect((defect) => (defect instanceof CommitRejected ? Effect.fail(defect) : Effect.die(defect))))
})
