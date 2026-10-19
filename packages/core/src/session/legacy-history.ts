import { and, asc, eq, notInArray } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { FileAttachment, Prompt } from "@aigcfroge/schema/prompt"
import { ProviderMetadata } from "@aigcfroge/schema/llm"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { EventTable } from "../event/sql"
import { SessionV1 } from "../v1/session"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionMessageTable } from "./sql"

type LegacyPart =
  | SessionV1.TextPartInput
  | SessionV1.FilePartInput
  | SessionV1.AgentPartInput
  | SessionV1.SubtaskPartInput

const isTextPart = (part: LegacyPart): part is SessionV1.TextPartInput => part.type === "text"
const isFilePart = (part: LegacyPart): part is SessionV1.FilePartInput => part.type === "file"
const isAgentPart = (part: LegacyPart): part is SessionV1.AgentPartInput => part.type === "agent"

/**
 * The single mapping from legacy prompt parts to the canonical Core Prompt
 * (`@aigcfroge/schema/prompt`). File parts carry their raw URI here; the caller
 * materializes them at an effect boundary before the prompt reaches a provider.
 */
export function canonicalPromptFromParts(parts: readonly LegacyPart[]): Prompt {
  const text = parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n")
  const files = parts.filter(isFilePart).map((part) =>
    FileAttachment.create({
      uri: part.url,
      mime: part.mime,
      ...(part.filename ? { name: part.filename } : {}),
      ...(canonicalSource(part.source) ? { source: canonicalSource(part.source) } : {}),
    }),
  )
  const agents = parts
    .filter(isAgentPart)
    .map((part) =>
      part.source
        ? { name: part.name, source: { start: part.source.start, end: part.source.end, text: part.source.value } }
        : { name: part.name },
    )
  return Prompt.make({
    text,
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  })
}

// Legacy file sources are `{ type, text: { value, start, end }, ... }`; the canonical
// `Prompt.Source` is a flat `{ start, end, text }`.
const canonicalSource = (
  source: SessionV1.FilePartInput["source"],
): { start: number; end: number; text: string } | undefined =>
  source?.text ? { start: source.text.start, end: source.text.end, text: source.text.value } : undefined

export class ImportError extends Schema.TaggedErrorClass<ImportError>()("SessionHistory.ImportError", {
  sessionID: SessionSchema.ID,
  reason: Schema.String,
}) {
  override get message() {
    return `Cannot adopt legacy history for ${this.sessionID}: ${this.reason}`
  }
}

/**
 * Read-time adoption freezes one complete V1 transcript into the canonical event
 * stream. The batch is the marker: one imported event means the entire snapshot
 * committed. Stable event IDs make a concurrent first-reader race recognizable.
 * Legacy rows remain available for inspection, but stop being runtime history.
 */
export const adopt = Effect.fn("SessionLegacyHistory.adopt")(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const imported = () =>
    db
      .select({ id: EventTable.id })
      .from(EventTable)
      .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, `${SessionEvent.HistoryImported.type}.1`)))
      .limit(1)
      .get()
      .pipe(Effect.orDie)
  if (yield* imported()) return
  const rows = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
    .all()
    .pipe(Effect.orDie)
  if (rows.length === 0) return
  // Legacy selection already emitted V2 switch rows. Those carry no provider
  // content and are safe to retain before the imported transcript.
  const canonical = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        notInArray(SessionMessageTable.type, ["agent-switched", "model-switched"]),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (canonical) {
    if (yield* imported()) return
    yield* Effect.die(
      new ImportError({
        sessionID,
        reason: "legacy and canonical conversation messages both exist; their order needs explicit reconciliation",
      }),
    )
  }
  const parts = yield* db
    .select()
    .from(PartTable)
    .where(eq(PartTable.session_id, sessionID))
    .orderBy(asc(PartTable.id))
    .all()
    .pipe(Effect.orDie)
  const grouped = Map.groupBy(parts, (part) => part.message_id)
  const history = rows.map((row) => ({
    info: Schema.decodeUnknownSync(SessionV1.Info)({ ...row.data, id: row.id, sessionID }),
    parts: (grouped.get(row.id) ?? []).map((part) =>
      Schema.decodeUnknownSync(SessionV1.Part)({ ...part.data, id: part.id, messageID: row.id, sessionID }),
    ),
  }))
  const entries = history.map((entry) => {
    const parentID = entry.info.role === "assistant" ? entry.info.parentID : undefined
    const compaction = history
      .find((message) => message.info.id === parentID)
      ?.parts.find((part) => part.type === "compaction")
    const message = canonicalMessage(entry.info, entry.parts, compaction)
    return EventV2.batchEntry(
      SessionEvent.HistoryImported,
      {
        sessionID,
        timestamp: message.time.created,
        message,
      },
      `evt_legacy_history_${sessionID}_${entry.info.id}`,
    )
  })
  yield* events.publishBatch(entries).pipe(
    Effect.catchDefect((defect) => {
      if (!(defect instanceof EventV2.InvalidDurableEventError)) return Effect.die(defect)
      return imported().pipe(Effect.flatMap((recorded) => (recorded ? Effect.void : Effect.die(defect))))
    }),
  )
})

function canonicalMessage(
  info: typeof SessionV1.Info.Type,
  parts: readonly (typeof SessionV1.Part.Type)[],
  compaction: typeof SessionV1.CompactionPart.Type | undefined,
): SessionMessage.Message {
  const id = SessionMessage.ID.make(info.id)
  const created = DateTime.makeUnsafe(info.time.created)
  if (info.role === "user") {
    // V1 reads text files/directories into synthetic text parts before persisting.
    // Keep that text and omit only their non-provider file references, as V1 did.
    if (info.system)
      throw new ImportError({
        sessionID: info.sessionID,
        reason: "legacy per-prompt system instructions need explicit reconciliation",
      })
    const prompt = canonicalPromptFromParts(
      parts.flatMap((part): LegacyPart[] => {
        if (part.type === "text") return part.ignored ? [] : [part]
        if (part.type === "file") {
          if (part.mime === "text/plain" || part.mime === "application/x-directory") return []
          // The runner's AttachmentResolver owns confined file:// reads.
          if (!part.url.startsWith("file:")) requireMaterialized(info.sessionID, part.url)
          return [part]
        }
        if (part.type === "agent") return [part]
        if (part.type === "compaction") return [{ type: "text", text: "What did we do so far?" }]
        if (part.type === "subtask") return [{ type: "text", text: "The following tool was executed by the user" }]
        return []
      }),
    )
    return SessionMessage.User.make({
      id,
      type: "user",
      ...prompt,
      delegationOrigin: info.delegationOrigin,
      time: { created },
    })
  }
  // Match V1 filterCompacted: only a successful summary of a compaction prompt
  // replaces prior history. Failed/incomplete summaries remain ordinary turns.
  if (info.summary && info.finish && !info.error && compaction) {
    if (compaction.tail_start_id)
      throw new ImportError({
        sessionID: info.sessionID,
        reason: "legacy compaction retains a reordered tail that needs explicit reconciliation",
      })
    return SessionMessage.Compaction.make({
      id,
      type: "compaction",
      reason: compaction.auto ? "auto" : "manual",
      summary: parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      recent: "",
      time: { created },
    })
  }
  const signed = parts.some((part) => part.type === "reasoning" && part.metadata?.anthropic?.signature != null)
  return SessionMessage.Assistant.make({
    id,
    type: "assistant",
    agent: info.agent,
    model: {
      id: info.modelID,
      providerID: info.providerID,
      ...(info.variant ? { variant: ModelV2.VariantID.make(info.variant) } : {}),
    },
    time: { created, completed: DateTime.makeUnsafe(info.time.completed ?? info.time.created) },
    finish: info.finish ?? (info.error ? "error" : "stop"),
    cost: info.cost,
    tokens: info.tokens,
    ...(info.error
      ? {
          error: SessionV1.AbortedError.isInstance(info.error)
            ? new SessionMessage.InterruptedError({ type: "interrupted", message: info.error.data.message })
            : {
                type: "unknown",
                message: "message" in info.error.data ? info.error.data.message : info.error.name,
              },
        }
      : {}),
    content: parts.flatMap((part): SessionMessage.AssistantContent[] => {
      if (part.type === "text")
        return [{ type: "text", id: part.id, text: part.text === "" && signed ? " " : part.text }]
      if (part.type === "reasoning")
        return [
          {
            type: "reasoning",
            id: part.id,
            text: part.text,
            ...(part.metadata ? { providerMetadata: Schema.decodeUnknownSync(ProviderMetadata)(part.metadata) } : {}),
          },
        ]
      if (part.type !== "tool") return []
      const state = part.state
      const metadata =
        part.metadata === undefined
          ? undefined
          : Object.fromEntries(Object.entries(part.metadata).filter(([key]) => key !== "providerExecuted"))
      const provider = {
        executed: part.metadata?.providerExecuted === true,
        ...(metadata ? { metadata: Schema.decodeUnknownSync(ProviderMetadata)(metadata) } : {}),
      }
      const base = {
        type: "tool" as const,
        id: part.callID,
        name: part.tool,
        provider,
        time: {
          created,
          ...("time" in state ? { ran: DateTime.makeUnsafe(state.time.start) } : {}),
          completed: DateTime.makeUnsafe(
            "time" in state && "end" in state.time ? state.time.end : (info.time.completed ?? info.time.created),
          ),
        },
      }
      if (state.status === "completed") {
        const attachments = state.time.compacted ? [] : (state.attachments ?? [])
        attachments.forEach((attachment) => requireMaterialized(info.sessionID, attachment.url))
        return [
          {
            ...base,
            state: {
              status: "completed",
              input: state.input,
              structured: {},
              content: [
                { type: "text", text: state.time.compacted ? "[Old tool result content cleared]" : state.output },
                ...attachments.map((attachment) => ({
                  type: "file" as const,
                  uri: attachment.url,
                  mime: attachment.mime,
                  name: attachment.filename,
                })),
              ],
            },
          },
        ]
      }
      if (
        state.status === "error" &&
        state.metadata?.interrupted === true &&
        typeof state.metadata.output === "string"
      ) {
        return [
          {
            ...base,
            state: {
              status: "completed",
              input: state.input,
              structured: {},
              content: [{ type: "text", text: state.metadata.output }],
            },
          },
        ]
      }
      return [
        {
          ...base,
          state: {
            status: "error",
            input: state.input,
            structured: {},
            content: [],
            error: {
              type: "unknown",
              message: state.status === "error" ? state.error : "[Tool execution was interrupted]",
            },
          },
        },
      ]
    }),
  })
}

function requireMaterialized(sessionID: SessionSchema.ID, uri: string) {
  if (!uri.startsWith("data:"))
    throw new ImportError({ sessionID, reason: "legacy media must be materialized before history adoption" })
}

export * as SessionLegacyHistory from "./legacy-history"
