import { Schema } from "effect"
import { Agent } from "./agent.js"
import { DelegationID } from "./delegation-id.js"
import { ascending } from "./identifier.js"
import { optional, PositiveInt, statics } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionGoalID } from "./session-goal-id.js"
import { SessionMessage } from "./session-message.js"
import { OperationReadonlyRef } from "./session-task-operation-id.js"

export const ID = Schema.String.check(Schema.isPattern(/^com_[A-Za-z0-9_-]+$/)).pipe(
  Schema.brand("SessionCommunication.ID"),
  Schema.annotate({ identifier: "SessionCommunication.ID" }),
  statics((schema) => ({ create: () => schema.make("com_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("SessionCommunication.Digest"),
  Schema.annotate({ identifier: "SessionCommunication.Digest" }),
)
export type Digest = typeof Digest.Type

export class UserActor extends Schema.Class<UserActor>("SessionCommunication.UserActor")({
  type: Schema.Literal("user"),
  sessionID: SessionID,
}) {}

export class ToolActor extends Schema.Class<ToolActor>("SessionCommunication.ToolActor")({
  type: Schema.Literal("tool"),
  sessionID: SessionID,
  agent: Agent.ID,
  messageID: SessionMessage.ID,
  id: Schema.String,
}) {}

export class TaskOrigin extends Schema.Class<TaskOrigin>("SessionCommunication.TaskOrigin")({
  type: Schema.Literal("task_operation"),
  operation: OperationReadonlyRef,
}) {}

export class GoalOrigin extends Schema.Class<GoalOrigin>("SessionCommunication.GoalOrigin")({
  type: Schema.Literal("goal_round"),
  round: SessionGoalID.RoundRef,
}) {}

export class DelegationOrigin extends Schema.Class<DelegationOrigin>("SessionCommunication.DelegationOrigin")({
  type: Schema.Literal("delegation_delivery"),
  delegationID: DelegationID.ID,
  participantID: DelegationID.ParticipantID,
  turnID: DelegationID.TurnID,
  deliveryOrigin: Schema.String,
  senderParticipantID: DelegationID.ParticipantID,
  attempt: PositiveInt,
}) {}

export const SystemOrigin = Schema.Union([TaskOrigin, GoalOrigin, DelegationOrigin]).annotate({
  identifier: "SessionCommunication.SystemOrigin",
})
export type SystemOrigin = typeof SystemOrigin.Type

/** Constructed by the owning return callback; public send/reply payloads omit actor and origin. */
export class SystemActor extends Schema.Class<SystemActor>("SessionCommunication.SystemActor")({
  type: Schema.Literal("system"),
  sessionID: SessionID,
  origin: SystemOrigin,
}) {}

export const Actor = Schema.Union([UserActor, ToolActor, SystemActor]).annotate({ identifier: "SessionCommunication.Actor" })
export type Actor = typeof Actor.Type

export class ResultSource extends Schema.Class<ResultSource>("SessionCommunication.ResultSource")({
  messageID: SessionMessage.ID,
  id: Schema.String,
}) {}

export class ContentSource extends Schema.Class<ContentSource>("SessionCommunication.ContentSource")({
  sessionID: SessionID,
  scope: Schema.Literals(["text", "reference", "output", "full", "result"]),
  result_source: ResultSource.pipe(optional),
  basis: Schema.Literals(["summary", "summary_partial", "original"]).pipe(optional),
}) {}

/** The immutable body is retained with this original Inbox carrier, including after promotion or cancellation. */
export class BodyRef extends Schema.Class<BodyRef>("SessionCommunication.BodyRef")({
  sessionID: SessionID,
  inputID: SessionMessage.ID,
  digest: Digest,
}) {}

export class Record extends Schema.Class<Record>("SessionCommunication.Record")({
  id: ID,
  actor: Actor,
  contentSource: ContentSource,
  targetSessionID: SessionID,
  replyTo: ID.pipe(optional),
  body: BodyRef,
  requestDigest: Digest,
  delivery: Schema.Literals(["queue", "steer"]),
  trigger: Schema.Boolean,
  createdAt: Schema.Finite,
}) {}

export const State = Schema.Literals(["pending", "visible", "cancelled", "removed", "unavailable"]).annotate({
  identifier: "SessionCommunication.State",
})
export type State = typeof State.Type

export class Message extends Schema.Class<Message>("SessionCommunication.Message")({
  ...Record.fields,
  text: Schema.String,
  state: State,
}) {}

export class Receipt extends Schema.Class<Receipt>("SessionCommunication.Receipt")({
  ...Message.fields,
  admission: Schema.Literals(["admitted", "retained", "suppressed"]),
  wake: Schema.Literals(["requested", "not_requested", "suppressed"]),
}) {}

export class TextContent extends Schema.Class<TextContent>("SessionCommunication.TextContent")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export class SessionContent extends Schema.Class<SessionContent>("SessionCommunication.SessionContent")({
  type: Schema.Literal("session"),
  sessionID: SessionID,
  scope: Schema.Literals(["reference", "output", "full"]),
}) {}

export const Content = Schema.Union([TextContent, SessionContent]).annotate({ identifier: "SessionCommunication.Content" })
export type Content = typeof Content.Type

export class Send extends Schema.Class<Send>("SessionCommunication.Send")({
  id: ID,
  targetSessionID: SessionID,
  content: Content,
  delivery: Schema.Literals(["queue", "steer"]).pipe(optional),
  trigger: Schema.Boolean.pipe(optional),
}) {}

export class Reply extends Schema.Class<Reply>("SessionCommunication.Reply")({
  id: ID,
  content: Content,
  delivery: Schema.Literals(["queue", "steer"]).pipe(optional),
  trigger: Schema.Boolean.pipe(optional),
}) {}

export class Capability extends Schema.Class<Capability>("SessionCommunication.Capability")({
  read: Schema.Boolean,
  list: Schema.Boolean,
  send: Schema.Boolean,
  reply: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
}) {}

export class ListInput extends Schema.Class<ListInput>("SessionCommunication.ListInput")({
  cursor: Schema.String.pipe(optional),
  limit: PositiveInt.pipe(optional),
}) {}

export class Page extends Schema.Class<Page>("SessionCommunication.Page")({
  items: Schema.Array(Message),
  next: Schema.String.pipe(optional),
  capability: Capability,
}) {}

export class Error extends Schema.TaggedError<Error>()("SessionCommunication.Error", {
  sessionID: SessionID,
  communicationID: ID.pipe(optional),
  reason: Schema.Literals(["unavailable", "conflicting_retry", "not_participant", "invalid_reply", "invalid_content", "invalid_carrier"]),
  message: Schema.String,
}) {}

export * as SessionCommunication from "./session-communication.js"
