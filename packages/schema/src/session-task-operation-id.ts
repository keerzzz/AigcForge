import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"
import { SessionID } from "./session-id.js"

export const OperationID = Schema.String.check(Schema.isPattern(/^top_[A-Za-z0-9_-]+$/)).pipe(
  Schema.brand("SessionTask.OperationID"),
  Schema.annotate({ identifier: "SessionTask.OperationID" }),
  statics((schema) => ({ create: () => schema.make("top_" + ascending()) })),
)
export type OperationID = typeof OperationID.Type

// Session events need this reference before the full Task contract can initialize.
export class OperationReadonlyRef extends Schema.Class<OperationReadonlyRef>("SessionTask.OperationReadonlyRef")({
  sourceSessionID: SessionID,
  operationID: OperationID,
}) {}

/** A server-projected Task notice identifies its saved operation and actual actor and target. */
export class TaskCoordination extends Schema.Class<TaskCoordination>("SessionTask.TaskCoordination")({
  kind: Schema.Literal("task"),
  operationRef: OperationReadonlyRef,
  actorSessionID: SessionID,
  actorAgent: Schema.String,
  targetSessionID: SessionID,
}) {}
