export * as BindingEvent from "./event"

import { Effect, Schema } from "effect"
import { EventV2 } from "../../event"

export const Updated = EventV2.define({
  type: "mcp_credential_binding.updated",
  durable: { version: 1, aggregate: "bindingID" },
  schema: {
    bindingID: Schema.String,
    status: Schema.Literals(["active", "revoked"]),
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    timeUpdated: Schema.Finite,
  },
})

export type Update = EventV2.Data<typeof Updated>

export class CommitRejected extends Schema.TaggedErrorClass<CommitRejected>()("BindingEvent.CommitRejected", {
  bindingID: Schema.String,
  revision: Schema.Int,
}) {
  override get message() {
    return `MCP credential binding ${this.bindingID} rejected revision ${this.revision}`
  }
}

/** Publishes one durable state transition whose commit writes the row (same transaction). */
export const publish = Effect.fn("BindingEvent.publish")(function* (
  events: EventV2.Interface,
  update: Update,
  commit: (tx: EventV2.Transaction) => Effect.Effect<boolean>,
) {
  return yield* events
    .publish(Updated, update, {
      commit: (seq, tx) => {
        if (seq + 1 !== update.revision) {
          return Effect.die(new CommitRejected({ bindingID: update.bindingID, revision: update.revision }))
        }
        return commit(tx).pipe(
          Effect.flatMap((accepted) =>
            accepted
              ? Effect.void
              : Effect.die(new CommitRejected({ bindingID: update.bindingID, revision: update.revision })),
          ),
        )
      },
    })
    .pipe(Effect.catchDefect((defect) => (defect instanceof CommitRejected ? Effect.fail(defect) : Effect.die(defect))))
})
