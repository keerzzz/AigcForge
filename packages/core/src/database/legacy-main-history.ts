export * as LegacyMainHistory from "./legacy-main-history.js"

import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Model } from "@aigcfroge/schema/model"
import { Prompt } from "@aigcfroge/schema/prompt"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionInbox } from "@aigcfroge/schema/session-inbox"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionError } from "@aigcfroge/schema/session-error"
import { Tool } from "@aigcfroge/schema/tool"
import { TokenUsage } from "@aigcfroge/schema/token-usage"
import { FinishReason } from "@aigcfroge/schema/llm"
import { SessionTable } from "../session/sql.js"
import type { DatabaseMigration } from "./migration.js"
import type { V1Migration } from "./v1-migration.js"

type Transaction = Parameters<DatabaseMigration.Migration["up"]>[0]

export class RecoveryError extends Schema.TaggedError<RecoveryError>()("LegacyMainRecoveryError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

const Base = { sessionID: SessionID, timestamp: Schema.Finite }

class AgentEvent extends Schema.Class<AgentEvent>("LegacyMain.AgentEvent")({
  ...Base,
  type: Schema.Literal("session.next.agent.switched.1"),
  messageID: SessionMessage.ID,
  agent: Schema.String,
}) {}

class ModelEvent extends Schema.Class<ModelEvent>("LegacyMain.ModelEvent")({
  ...Base,
  type: Schema.Literal("session.next.model.switched.1"),
  messageID: SessionMessage.ID,
  model: Schema.toEncoded(Model.Ref),
}) {}

const PromptFields = {
  ...Base,
  messageID: SessionMessage.ID,
  prompt: Prompt,
  delivery: SessionInbox.Delivery,
}

class AdmittedEvent extends Schema.Class<AdmittedEvent>("LegacyMain.AdmittedEvent")({
  ...PromptFields,
  type: Schema.Literal("session.next.prompt.admitted.1"),
}) {}

class PromptedEvent extends Schema.Class<PromptedEvent>("LegacyMain.PromptedEvent")({
  ...PromptFields,
  type: Schema.Literal("session.next.prompted.1"),
}) {}

class StartedEvent extends Schema.Class<StartedEvent>("LegacyMain.StartedEvent")({
  ...Base,
  type: Schema.Literal("session.next.step.started.1"),
  assistantMessageID: SessionMessage.ID,
  agent: Schema.String,
  model: Schema.toEncoded(Model.Ref),
  snapshot: Schema.optional(Schema.String),
}) {}

class TextStartedEvent extends Schema.Class<TextStartedEvent>("LegacyMain.TextStartedEvent")({
  ...Base,
  type: Schema.Literal("session.next.text.started.1"),
  assistantMessageID: SessionMessage.ID,
  textID: Schema.String,
}) {}

class TextEndedEvent extends Schema.Class<TextEndedEvent>("LegacyMain.TextEndedEvent")({
  ...Base,
  type: Schema.Literal("session.next.text.ended.1"),
  assistantMessageID: SessionMessage.ID,
  textID: Schema.String,
  text: Schema.String,
}) {}

class EndedEvent extends Schema.Class<EndedEvent>("LegacyMain.EndedEvent")({
  ...Base,
  type: Schema.Literal("session.next.step.ended.2"),
  assistantMessageID: SessionMessage.ID,
  finish: Schema.String,
  cost: Schema.Finite,
  tokens: Schema.toEncoded(TokenUsage.Info),
  snapshot: Schema.optional(Schema.String),
}) {}

class FailedEvent extends Schema.Class<FailedEvent>("LegacyMain.FailedEvent")({
  ...Base,
  type: Schema.Literal("session.next.step.failed.2"),
  assistantMessageID: SessionMessage.ID,
  error: SessionError.Error,
}) {}

class SyntheticEvent extends Schema.Class<SyntheticEvent>("LegacyMain.SyntheticEvent")({
  ...Base,
  type: Schema.Literal("session.next.synthetic.1"),
  messageID: SessionMessage.ID,
  text: Schema.String,
}) {}

const ReasoningFields = {
  ...Base,
  assistantMessageID: SessionMessage.ID,
  reasoningID: Schema.String,
  providerMetadata: Schema.optional(SessionMessage.ProviderState),
}

class ReasoningStartedEvent extends Schema.Class<ReasoningStartedEvent>("LegacyMain.ReasoningStartedEvent")({
  ...ReasoningFields,
  type: Schema.Literal("session.next.reasoning.started.1"),
}) {}

class ReasoningEndedEvent extends Schema.Class<ReasoningEndedEvent>("LegacyMain.ReasoningEndedEvent")({
  ...ReasoningFields,
  type: Schema.Literal("session.next.reasoning.ended.1"),
  text: Schema.String,
}) {}

const ToolFields = {
  ...Base,
  assistantMessageID: SessionMessage.ID,
  callID: Schema.String,
}

class ToolProvider extends Schema.Class<ToolProvider>("LegacyMain.ToolProvider")({
  executed: Schema.Boolean,
  metadata: Schema.optional(SessionMessage.ProviderState),
}) {}

class ToolInputStartedEvent extends Schema.Class<ToolInputStartedEvent>("LegacyMain.ToolInputStartedEvent")({
  ...ToolFields,
  type: Schema.Literal("session.next.tool.input.started.1"),
  name: Schema.String,
}) {}

class ToolInputEndedEvent extends Schema.Class<ToolInputEndedEvent>("LegacyMain.ToolInputEndedEvent")({
  ...ToolFields,
  type: Schema.Literal("session.next.tool.input.ended.1"),
  text: Schema.String,
}) {}

class ToolCalledEvent extends Schema.Class<ToolCalledEvent>("LegacyMain.ToolCalledEvent")({
  ...ToolFields,
  type: Schema.Literal("session.next.tool.called.1"),
  tool: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
  provider: ToolProvider,
}) {}

class ToolSuccessEvent extends Schema.Class<ToolSuccessEvent>("LegacyMain.ToolSuccessEvent")({
  ...ToolFields,
  type: Schema.Literal("session.next.tool.success.1"),
  structured: Schema.Record(Schema.String, Schema.Json),
  content: Schema.Array(Tool.Content),
  outputPaths: Schema.optional(Schema.Array(Schema.String)),
  result: Schema.optional(Schema.Json),
  provider: ToolProvider,
}) {}

class ToolFailedEvent extends Schema.Class<ToolFailedEvent>("LegacyMain.ToolFailedEvent")({
  ...ToolFields,
  type: Schema.Literal("session.next.tool.failed.1"),
  error: SessionError.Error,
  result: Schema.optional(Schema.Json),
  provider: ToolProvider,
}) {}

class RetryError extends Schema.Class<RetryError>("LegacyMain.RetryError")({
  message: Schema.String,
  statusCode: Schema.optional(Schema.Finite),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

class RetriedEvent extends Schema.Class<RetriedEvent>("LegacyMain.RetriedEvent")({
  ...Base,
  type: Schema.Literal("session.next.retried.1"),
  attempt: Schema.Finite,
  error: RetryError,
}) {}

const NextEvent = Schema.Union([
  AgentEvent,
  ModelEvent,
  AdmittedEvent,
  PromptedEvent,
  StartedEvent,
  TextStartedEvent,
  TextEndedEvent,
  EndedEvent,
  FailedEvent,
  SyntheticEvent,
  ReasoningStartedEvent,
  ReasoningEndedEvent,
  ToolInputStartedEvent,
  ToolInputEndedEvent,
  ToolCalledEvent,
  ToolSuccessEvent,
  ToolFailedEvent,
  RetriedEvent,
])
const EncodedMessage = Schema.toEncoded(SessionMessage.Info)
const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const sourceTypes = new Set([
  "session.created.1",
  "session.updated.1",
  "message.updated.1",
  "message.removed.1",
  "message.part.updated.1",
])

type StoredEvent = { aggregate_id: string; seq: number; type: string; data: string }
type StoredMessage = {
  id: string
  type: SessionMessage.Type
  seq: number
  time_created: number
  time_updated: number
  data: Record<string, unknown>
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, reason: string) {
  const value = Schema.decodeUnknownOption(schema)(input)
  if (Option.isNone(value)) throw new RecoveryError({ reason })
  return value.value
}

function projectNext(events: StoredEvent[]) {
  const messages = new Map<string, typeof EncodedMessage.Type>()
  const admitted = new Map<string, AdmittedEvent>()
  const textIndexes = new Map<string, number>()
  const reasoningIndexes = new Map<string, number>()
  const toolIndexes = new Map<string, number>()
  const toolInputs = new Map<string, string>()
  const assistantIDs: SessionMessage.ID[] = []
  const pendingRetries: RetriedEvent[] = []
  const sequence = new Map<string, number>()
  const append = (value: unknown, seq: number) => {
    const message = decode(EncodedMessage, value, "Invalid recovered legacy message")
    if (messages.has(message.id)) throw new RecoveryError({ reason: "Duplicate legacy message identity" })
    messages.set(message.id, message)
    sequence.set(message.id, seq)
  }
  const retry = (event: RetriedEvent) => ({
    attempt: event.attempt,
    at: event.timestamp,
    error: {
      type: "unknown",
      message: event.error.message,
      ...(event.error.statusCode === undefined ? {} : { status: event.error.statusCode }),
      ...(event.error.responseBody === undefined ? {} : { response: { body: event.error.responseBody } }),
    },
  })

  for (const row of events) {
    // These facts have their final state in the preserved Session/message/part tables.
    if (sourceTypes.has(row.type)) continue
    const event = decode(
      NextEvent,
      { ...decode(JsonObject, row.data, "Invalid legacy event JSON"), type: row.type },
      `Unsupported legacy event format: ${row.type}`,
    )
    if (event.sessionID !== row.aggregate_id)
      throw new RecoveryError({ reason: "Legacy event belongs to a different Session" })

    if (event.type === "session.next.retried.1") {
      const assistantID = assistantIDs.at(-1)
      const current = assistantID === undefined ? undefined : messages.get(assistantID)
      if (current?.type === "assistant" && current.time.completed === undefined) {
        messages.set(current.id, decode(EncodedMessage, { ...current, retry: retry(event) }, "Invalid legacy retry"))
        continue
      }
      pendingRetries.push(event)
      continue
    }

    if (event.type === "session.next.synthetic.1") {
      append({ id: event.messageID, type: "synthetic", text: event.text, time: { created: event.timestamp } }, row.seq)
      continue
    }

    if (event.type === "session.next.agent.switched.1" || event.type === "session.next.model.switched.1") {
      append(
        {
          id: event.messageID,
          type: event.type === "session.next.agent.switched.1" ? "agent-switched" : "model-switched",
          ...(event.type === "session.next.agent.switched.1" ? { agent: event.agent } : { model: event.model }),
          time: { created: event.timestamp },
        },
        row.seq,
      )
      continue
    }
    if (event.type === "session.next.prompt.admitted.1") {
      if (admitted.has(event.messageID) || messages.has(event.messageID))
        throw new RecoveryError({ reason: "Duplicate legacy prompt admission" })
      admitted.set(event.messageID, event)
      continue
    }
    if (event.type === "session.next.prompted.1") {
      const pending = admitted.get(event.messageID)
      if (pending && (!Prompt.equivalence(pending.prompt, event.prompt) || pending.delivery !== event.delivery))
        throw new RecoveryError({ reason: "Legacy prompt delivery conflicts with its admission" })
      admitted.delete(event.messageID)
      append({ id: event.messageID, type: "user", ...event.prompt, time: { created: event.timestamp } }, row.seq)
      continue
    }
    if (event.type === "session.next.step.started.1") {
      const previousID = assistantIDs.at(-1)
      const previous = previousID === undefined ? undefined : messages.get(previousID)
      if (previous?.type === "assistant" && previous.time.completed === undefined)
        messages.set(previous.id, { ...previous, time: { ...previous.time, completed: event.timestamp } })
      const pending = pendingRetries.splice(0).at(-1)
      append(
        {
          id: event.assistantMessageID,
          type: "assistant",
          agent: event.agent,
          model: event.model,
          content: [],
          ...(event.snapshot ? { snapshot: { start: event.snapshot } } : {}),
          ...(pending ? { retry: retry(pending) } : {}),
          time: { created: event.timestamp },
        },
        row.seq,
      )
      assistantIDs.push(event.assistantMessageID)
      continue
    }

    const assistant = messages.get(event.assistantMessageID)
    if (assistant?.type !== "assistant")
      throw new RecoveryError({ reason: "Legacy step update has no assistant message" })
    if (event.type === "session.next.step.failed.2") {
      messages.set(assistant.id, {
        ...assistant,
        finish: "error",
        error: event.error,
        time: { ...assistant.time, completed: event.timestamp },
      })
      continue
    }
    if (event.type === "session.next.step.ended.2") {
      messages.set(
        assistant.id,
        decode(
          EncodedMessage,
          {
            ...assistant,
            finish: Option.getOrElse(Schema.decodeUnknownOption(FinishReason)(event.finish), () => "unknown"),
            rawFinish: event.finish,
            cost: event.cost,
            tokens: event.tokens,
            ...(event.snapshot ? { snapshot: { ...assistant.snapshot, end: event.snapshot } } : {}),
            time: { ...assistant.time, completed: event.timestamp },
          },
          "Invalid recovered legacy step settlement",
        ),
      )
      continue
    }

    if (event.type === "session.next.reasoning.started.1" || event.type === "session.next.reasoning.ended.1") {
      const key = JSON.stringify([event.assistantMessageID, event.reasoningID])
      if (event.type === "session.next.reasoning.started.1") {
        reasoningIndexes.set(key, assistant.content.length)
        messages.set(assistant.id, {
          ...assistant,
          content: [...assistant.content, {
            type: "reasoning",
            text: "",
            ...(event.providerMetadata === undefined ? {} : { state: event.providerMetadata }),
            time: { created: event.timestamp },
          }],
        })
        continue
      }
      const index = reasoningIndexes.get(key)
      if (index === undefined) throw new RecoveryError({ reason: "Legacy reasoning settlement has no started block" })
      messages.set(assistant.id, {
        ...assistant,
        content: assistant.content.map((block, position) =>
          position === index && block.type === "reasoning"
            ? {
                ...block,
                text: event.text,
                ...(event.providerMetadata === undefined ? {} : { state: event.providerMetadata }),
                time: { created: block.time?.created ?? event.timestamp, completed: event.timestamp },
              }
            : block,
        ),
      })
      continue
    }

    if ("callID" in event) {
      const key = JSON.stringify([event.assistantMessageID, event.callID])
      if (event.type === "session.next.tool.input.started.1") {
        toolIndexes.set(key, assistant.content.length)
        toolInputs.set(key, "")
        messages.set(assistant.id, {
          ...assistant,
          content: [...assistant.content, {
            type: "tool",
            id: event.callID,
            name: event.name,
            time: { created: event.timestamp },
            state: { status: "streaming", input: "" },
          }],
        })
        continue
      }
      const index = toolIndexes.get(key)
      const tool = index === undefined ? undefined : assistant.content[index]
      if (tool?.type !== "tool") throw new RecoveryError({ reason: "Legacy tool update has no started block" })
      if (event.type === "session.next.tool.input.ended.1") {
        toolInputs.set(key, event.text)
        messages.set(assistant.id, {
          ...assistant,
          content: assistant.content.map((block, position) =>
            position === index ? { ...tool, state: { status: "streaming", input: event.text } } : block,
          ),
        })
        continue
      }
      const legacy = {
        rawInput: toolInputs.get(key) ?? "",
        ...("result" in event && event.result !== undefined ? { result: event.result } : {}),
        ...("outputPaths" in event && event.outputPaths !== undefined ? { outputPaths: event.outputPaths } : {}),
      }
      const next = event.type === "session.next.tool.called.1"
        ? {
            ...tool,
            executed: event.provider.executed,
            ...(event.provider.metadata === undefined ? {} : { providerState: event.provider.metadata }),
            time: { ...tool.time, ran: event.timestamp },
            state: { status: "running", input: event.input, metadata: { legacy } },
          }
        : {
            ...tool,
            executed: event.provider.executed || tool.executed === true,
            ...(event.provider.metadata === undefined ? {} : { providerResultState: event.provider.metadata }),
            time: { ...tool.time, completed: event.timestamp },
            state: event.type === "session.next.tool.success.1"
              ? {
                  status: "completed",
                  input: tool.state.status === "streaming" ? {} : tool.state.input,
                  content: event.content.length ? event.content : [{ type: "text", text: "" }],
                  metadata: { ...event.structured, legacy },
                }
              : {
                  status: "error",
                  input: tool.state.status === "streaming" ? {} : tool.state.input,
                  error: event.error,
                  metadata: { ...(tool.state.status === "streaming" ? {} : tool.state.metadata), legacy },
                },
          }
      messages.set(assistant.id, decode(EncodedMessage, {
        ...assistant,
        content: assistant.content.map((block, position) => position === index ? next : block),
      }, "Invalid recovered legacy tool settlement"))
      continue
    }

    const key = JSON.stringify([event.assistantMessageID, event.textID])
    if (event.type === "session.next.text.started.1") {
      textIndexes.set(key, assistant.content.length)
      messages.set(assistant.id, { ...assistant, content: [...assistant.content, { type: "text", text: "" }] })
      continue
    }
    const index = textIndexes.get(key)
    if (index === undefined) throw new RecoveryError({ reason: "Legacy text settlement has no started block" })
    messages.set(assistant.id, {
      ...assistant,
      content: assistant.content.map((block, position) =>
        position === index ? { type: "text", text: event.text } : block,
      ),
    })
  }

  return {
    messages: Array.from(messages.values()).map((message): StoredMessage => {
      const { id, type, ...data } = message
      return {
        id,
        type,
        seq: sequence.get(id) ?? 0,
        time_created: message.time.created,
        time_updated:
          "completed" in message.time ? (message.time.completed ?? message.time.created) : message.time.created,
        data,
      }
    }),
    pending: Array.from(admitted.values()),
  }
}

export const restore = Effect.fn("LegacyMainHistory.restore")(function* (tx: Transaction) {
  const { V1Migration } = yield* Effect.promise(() => import("./v1-migration.js"))
  if (typeof V1Migration.transformSession !== "function")
    return yield* new RecoveryError({ reason: "Legacy main history recovery requires the Bun migration runtime" })

  const sessions = yield* tx.select().from(SessionTable).all()
  const orphan = yield* tx.get(sql`
    SELECT 1 FROM _legacy_main_event e
    WHERE NOT EXISTS (SELECT 1 FROM session_v2 s WHERE s.id = e.aggregate_id)
    LIMIT 1
  `)
  if (orphan) return yield* new RecoveryError({ reason: "Legacy events contain an unmapped Session" })

  for (const session of sessions) {
    const legacy = V1Migration.transformSession({
      session,
      messages: yield* tx.all<V1Migration.SourceMessage>(sql`
        SELECT id, session_id, time_created, time_updated, data FROM _legacy_main_message
        WHERE session_id = ${session.id}
      `),
      parts: yield* tx.all<V1Migration.SourcePart>(sql`
        SELECT id, message_id, session_id, time_created, time_updated, data FROM _legacy_main_part
        WHERE session_id = ${session.id}
      `),
    })
    if (legacy.warnings.length)
      return yield* new RecoveryError({ reason: `Legacy V1 conversion rejected ${legacy.warnings.length} source rows` })
    const next = projectNext(
      yield* tx.all<StoredEvent>(sql`
        SELECT aggregate_id, seq, type, data FROM _legacy_main_event
        WHERE aggregate_id = ${session.id} ORDER BY seq
      `),
    )
    const messages = [...legacy.messages, ...next.messages].sort(
      (a, b) => a.time_created - b.time_created || a.seq - b.seq || a.id.localeCompare(b.id),
    )
    if (new Set(messages.map((message) => message.id)).size !== messages.length)
      return yield* new RecoveryError({ reason: "Legacy V1 and event histories reuse a message identity" })

    for (const [seq, message] of messages.entries()) {
      decode(EncodedMessage, { ...message.data, id: message.id, type: message.type }, "Invalid recovered message")
      yield* tx.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (${message.id}, ${session.id}, ${message.type}, ${seq}, ${message.time_created},
          ${message.time_updated}, ${JSON.stringify(message.data)})
      `)
    }
    for (const [offset, pending] of next.pending.entries()) {
      yield* tx.run(sql`
        INSERT INTO session_inbox (id, session_id, type, payload, delivery, enqueued_seq, time_created)
        VALUES (${pending.messageID}, ${session.id}, 'user', ${JSON.stringify(pending.prompt)},
          ${pending.delivery}, ${messages.length + offset}, ${pending.timestamp})
      `)
    }
    yield* tx.run(sql`
      INSERT INTO event_sequence (aggregate_id, seq)
      VALUES (${session.id}, ${messages.length + next.pending.length - 1})
    `)
  }
})
