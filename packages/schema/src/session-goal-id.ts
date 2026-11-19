export * as SessionGoalID from "./session-goal-id.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionMessageID } from "./session-message-id.js"

const IDSchema = Schema.String.check(Schema.isStartingWith("gol_")).pipe(
  Schema.brand("SessionGoal.ID"),
  Schema.annotate({ identifier: "SessionGoal.ID" }),
)
export const ID = IDSchema.pipe(statics((schema) => ({ create: () => schema.make("gol_" + Identifier.ascending()) })))
export type ID = typeof ID.Type

/** A saved round is provenance. Tool callers retain their separate model_tool actor. */
export const RoundRef = Schema.Struct({
  goalID: ID,
  sessionID: SessionID,
  revision: PositiveInt,
  roundID: Schema.String,
  inputID: SessionMessageID.ID,
}).annotate({ identifier: "SessionGoal.RoundRef" })
export interface RoundRef extends Schema.Schema.Type<typeof RoundRef> {}

export const AttemptRef = Schema.Struct({ goalID: ID, sessionID: SessionID, attemptID: Schema.String }).annotate({
  identifier: "SessionGoal.AttemptRef",
})
export interface AttemptRef extends Schema.Schema.Type<typeof AttemptRef> {}
