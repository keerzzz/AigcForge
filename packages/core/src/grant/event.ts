export * as GrantEvent from "./event"

import { Effect, Schema } from "effect"
import { Bus } from "../bus"
import { Event } from "@omnixa/schema/event"

export const Updated = Bus.durable({
  type: "grant.updated",
  durable: { version: 1, aggregate: "grantID" },
  schema: {
    grantID: Schema.String,
    status: Schema.Literals(["active", "consumed", "revoked"]),
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    timeUpdated: Schema.Finite,
  },
})

export type Update = Event.Data<typeof Updated>

export class CommitRejected extends Schema.TaggedError<CommitRejected>()("GrantEvent.CommitRejected", {
  grantID: Schema.String,
  revision: Schema.Int,
}) {
  override get message() {
    return `Scoped grant ${this.grantID} rejected revision ${this.revision}`
  }
}

/** Publishes one durable state transition whose commit writes the row (same transaction). */
export const publish = Effect.fn("GrantEvent.publish")(function* (
  events: Bus.Interface,
  update: Update,
  commit: (seq: number) => Effect.Effect<boolean>,
) {
  return yield* events
    .publish(Updated, update, {
      commit: (seq) => {
        if (seq + 1 !== update.revision) {
          return Effect.die(new CommitRejected({ grantID: update.grantID, revision: update.revision }))
        }
        return commit(seq).pipe(
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
