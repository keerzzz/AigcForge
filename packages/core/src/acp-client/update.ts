export * as AcpUpdate from "./update"

import type { SessionNotification, SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk"

/**
 * A tool-call progress entry extracted from a `session/update` notification.
 *
 * The task-card upgrade correlates an external CLI's tool call with the AigcForge
 * task card that spawned it through `_meta.parentToolUseId` (the task tool-use id
 * in the parent session). The agent may omit `_meta`, in which case the entry is
 * still captured so the child session's expand view can render the external
 * tool progress even without a parent link.
 */
export interface ToolCallProgress {
  /** Task tool-use id in the parent session, from `_meta.parentToolUseId`. */
  parentToolUseId?: string
  toolCallId: string
  title?: string
  kind?: string
  status?: ToolCallStatus
}

const parentToolUseId = (update: SessionUpdate): string | undefined => {
  const meta = update._meta
  if (!meta || typeof meta !== "object") return undefined
  const value = meta["parentToolUseId"]
  return typeof value === "string" ? value : undefined
}

/**
 * Extract a tool-call progress entry from a `session/update`. Returns undefined
 * for message chunks, plans, and capability updates.
 */
export function toolCallProgress(update: SessionUpdate): ToolCallProgress | undefined {
  if (update.sessionUpdate === "tool_call") {
    return {
      parentToolUseId: parentToolUseId(update),
      toolCallId: update.toolCallId,
      title: update.title,
      kind: update.kind,
      status: update.status,
    }
  }
  if (update.sessionUpdate === "tool_call_update") {
    return {
      parentToolUseId: parentToolUseId(update),
      toolCallId: update.toolCallId,
      title: update.title ?? undefined,
      kind: update.kind ?? undefined,
      status: update.status ?? undefined,
    }
  }
  return undefined
}

/**
 * Accumulate the text of an assistant/user message chunk. Returns the chunk text
 * for `agent_message_chunk`/`user_message_chunk` updates whose content is a text
 * block, undefined otherwise.
 */
export function textChunk(update: SessionUpdate): string | undefined {
  if (update.sessionUpdate !== "agent_message_chunk" && update.sessionUpdate !== "user_message_chunk") return undefined
  const content = update.content
  if (!content || typeof content !== "object" || content.type !== "text") return undefined
  return content.text
}

/** Narrow a raw notification to its `SessionUpdate` payload. */
export const updateOf = (notification: SessionNotification): SessionUpdate => notification.update
