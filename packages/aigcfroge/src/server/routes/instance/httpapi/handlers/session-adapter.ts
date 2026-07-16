import { DateTime } from "effect"
import { SessionV1, type MessageID } from "@aigcfroge/core/v1/session"
import type { SessionSchema } from "@aigcfroge/core/session/schema"

// V2 -> V1 session info adapter. Lives at the handler boundary per
// ARCHITECTURE.md §6 / httpapi/AGENTS.md ("translate expected domain errors
// at the handler boundary"). The API schema (Session.Info = SessionV1.SessionInfo)
// predates V2; V2 SessionSchema.Info uses location (directory+workspaceID) instead
// of flat directory/workspaceID, drops slug/version from the schema (though the
// SessionTable stores them), and uses DateTime instead of epoch-millis. This
// adapter bridges the two so V2 handler paths can return V1-shaped responses
// without changing the public API contract.
//
// The single `as unknown as` below is a brand escape: V2 schema brands
// (Agent.ID, Model.ID, Provider.ID, Project.ID, SessionMessageID.ID) carry
// different brand names than V1's (ModelV2.ID, ProviderV2.ID, ProjectV2.ID,
// MessageID) even though the underlying string format is identical. Per
// CLAUDE.md No Cheating, this is a documented third-party-type escape, not a
// logic bypass.
export function v2InfoToV1(info: SessionSchema.Info): SessionV1.SessionInfo {
  return {
    id: info.id,
    mode: info.mode,
    slug: info.slug,
    version: info.version,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID,
    summary: info.summary
      ? { additions: info.summary.additions, deletions: info.summary.deletions, files: info.summary.files }
      : undefined,
    cost: info.cost,
    tokens: info.tokens,
    share: undefined,
    title: info.title,
    agent: info.agent,
    model: info.model
      ? { id: info.model.id, providerID: info.model.providerID, variant: info.model.variant }
      : undefined,
    metadata: undefined,
    time: {
      created: DateTime.toEpochMillis(info.time.created),
      updated: DateTime.toEpochMillis(info.time.updated),
      archived: info.time.archived ? DateTime.toEpochMillis(info.time.archived) : undefined,
    },
    permission: undefined,
    attended: info.attended,
    revert: info.revert
      ? {
          // brand escape: V2 SessionMessageID.ID (Brand<"Session.Message.ID">) vs V1 MessageID (Brand<"MessageID">) - same "msg_..." string format, different brand name
          // oxlint-disable-next-line no-unsafe-type-assertion - documented brand escape per CLAUDE.md No Cheating
          messageID: info.revert.messageID as unknown as MessageID,
          snapshot: info.revert.snapshot,
          diff: info.revert.diff,
        }
      : undefined,
  }
}
