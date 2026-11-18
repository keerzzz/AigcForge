export * as SessionErrors from "./error.js"

import { Schema } from "effect"
import { Agent } from "@aigcfroge/schema/agent"
import { Skill } from "@aigcfroge/schema/skill"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionError } from "@aigcfroge/schema/session-error"
import { Model } from "@aigcfroge/schema/model"

export class ControllerConflictError extends Schema.TaggedError<ControllerConflictError>()(
  "Session.ControllerConflictError",
  { sessionID: SessionSchema.ID, field: Schema.String, kind: Schema.String, message: Schema.String },
) {}

/** Catalog default and omitted variant retain the existing effective selection semantics. */
export function sameModel(left: Model.Selection | undefined, right: Model.Selection | undefined) {
  if (!left || !right) return left === right
  if (Model.Selection.isGroup(left)) return Model.Selection.isGroup(right) && left.groupID === right.groupID
  if (Model.Selection.isGroup(right)) return false
  return (
    left.id === right.id &&
    left.providerID === right.providerID &&
    (left.variant ?? "default") === (right.variant ?? "default")
  )
}

export function sameExecutor(left: SessionSchema.ExecutorBinding, right: SessionSchema.ExecutorBinding) {
  return (
    left.agent === right.agent &&
    sameModel(left.model, right.model) &&
    (!Model.Selection.isGroup(left.model) ||
      (left.groupBehavior?.groupID === right.groupBehavior?.groupID &&
        left.groupBehavior?.behaviorDigest === right.groupBehavior?.behaviorDigest))
  )
}

export function bindingMatches(session: SessionSchema.Info) {
  if (session.controller?.kind !== "child") return true
  return (
    session.agent === session.controller.executor.agent &&
    sameModel(session.model, session.controller.executor.model) &&
    (!Model.Selection.isGroup(session.controller.executor.model) ||
      session.controller.executor.groupBehavior?.groupID === session.controller.executor.model.groupID)
  )
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class MessageNotFoundError extends Schema.TaggedError<MessageNotFoundError>()("Session.MessageNotFoundError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class ForkEmptyError extends Schema.TaggedError<ForkEmptyError>()("Session.ForkEmptyError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return `Cannot fork empty session: ${this.sessionID}`
  }
}

export class ForkConflictError extends Schema.TaggedError<ForkConflictError>()("Session.ForkConflictError", {
  sessionID: SessionSchema.ID,
  parentID: SessionSchema.ID,
}) {
  override get message() {
    return `Session ${this.sessionID} is not the requested fork of ${this.parentID}`
  }
}

export class MessageDecodeError extends Schema.TaggedError<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()("Session.AgentNotFoundError", {
  sessionID: SessionSchema.ID,
  agent: Agent.ID,
}) {
  override get message() {
    return `Agent not found: "${this.agent}"`
  }
}

export class StepFailedError extends Schema.TaggedError<StepFailedError>()("Session.StepFailedError", {
  error: SessionError.Error,
}) {
  override get message() {
    return this.error.message
  }
}

export class PromptConflictError extends Schema.TaggedError<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class SyntheticConflictError extends Schema.TaggedError<SyntheticConflictError>()(
  "Session.SyntheticConflictError",
  {
    sessionID: SessionSchema.ID,
    inputID: SessionMessage.ID,
  },
) {}

export class AttachmentError extends Schema.TaggedError<AttachmentError>()("Session.AttachmentError", {
  uri: Schema.String,
  message: Schema.String,
}) {}

export class CompactionConflictError extends Schema.TaggedError<CompactionConflictError>()(
  "Session.CompactionConflictError",
  {
    sessionID: SessionSchema.ID,
    inputID: SessionMessage.ID,
  },
) {}

export class BusyError extends Schema.TaggedError<BusyError>()("Session.BusyError", {
  sessionID: SessionSchema.ID,
}) {}

export class InboxConflictError extends Schema.TaggedError<InboxConflictError>()("Session.InboxConflictError", {
  sessionID: SessionSchema.ID,
  inboxID: SessionMessage.ID,
}) {}

export class SkillNotFoundError extends Schema.TaggedError<SkillNotFoundError>()("Session.SkillNotFoundError", {
  skill: Skill.ID,
}) {}

/** Fork-retained (System Context): context snapshot decode failure. */
export class ContextSnapshotDecodeError extends Schema.TaggedError<ContextSnapshotDecodeError>()(
  "Session.ContextSnapshotDecodeError",
  {
    sessionID: SessionSchema.ID,
    details: Schema.String,
  },
) {
  override get message() {
    return `Failed to decode context snapshot for session ${this.sessionID}: ${this.details}`
  }
}
