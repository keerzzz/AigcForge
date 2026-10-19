import { asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventTable } from "@aigcfroge/core/event/sql"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { MessageTable, PartTable, SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { ConfigV1 } from "@aigcfroge/core/v1/config/config"
import { MessageID, PartID, SessionV1 } from "@aigcfroge/core/v1/session"

export const providerID = ProviderV2.ID.make("history-http")
export const modelID = ModelV2.ID.make("history-model")
export const historicalUsage = {
  cost: 2,
  tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
}
class WireFunction extends Schema.Class<WireFunction>("LegacyHistory.WireFunction")({
  name: Schema.String,
  arguments: Schema.String,
}) {}

class WireToolCall extends Schema.Class<WireToolCall>("LegacyHistory.WireToolCall")({
  id: Schema.String,
  type: Schema.String,
  function: WireFunction,
}) {}

class WireMessage extends Schema.Class<WireMessage>("LegacyHistory.WireMessage")({
  role: Schema.String,
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tool_call_id: Schema.optional(Schema.String),
  tool_calls: Schema.optional(Schema.Array(WireToolCall)),
}) {}

export function decodeMessages(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Provider request must contain a messages array")
  // Remove privileged context before parsing so decoder failures cannot print it.
  return Schema.decodeUnknownSync(Schema.Array(WireMessage))(
    value.filter(
      (message) =>
        !(
          typeof message === "object" &&
          message !== null &&
          "role" in message &&
          (message.role === "system" || message.role === "developer")
        ),
    ),
  )
}

export function digest(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex")
}

export function providerConfig(url: string) {
  return {
    model: `${providerID}/${modelID}`,
    provider: {
      [providerID]: {
        name: "History HTTP fixture",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: url, apiKey: "synthetic-history-key" },
        models: {
          [modelID]: {
            name: "History fixture model",
            tool_call: true,
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
          },
        },
      },
    },
  } satisfies Partial<ConfigV1.Info>
}

// Seed durable V1 rows directly so the canonical reader, rather than a test converter, adopts them.
export const seedLegacyTranscript = Effect.fnUntraced(function* (directory: string, suffix = "") {
  const db = (yield* Database.Service).db
  const sessionID = SessionV2.ID.make(`ses_history_http${suffix}`)
  const user = MessageID.make(`msg_history_http_old_user${suffix}`)
  const assistant = MessageID.make(`msg_history_http_old_assistant${suffix}`)
  const completedInput = { filePath: `${directory}/completed-replay.txt`, content: "Unexpected historical replay." }
  const pendingInput = { filePath: `${directory}/pending-replay.txt`, content: "Unexpected pending replay." }
  yield* db
    .insert(ProjectTable)
    .values({
      id: Project.ID.global,
      worktree: AbsolutePath.make(directory),
      sandboxes: [],
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      mode: "assistant",
      slug: "history-http",
      directory: AbsolutePath.make(directory),
      title: "Existing Assistant history",
      version: "test",
      time_created: 1,
      time_updated: 3,
      agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
      model: { id: modelID, providerID },
      cost: historicalUsage.cost,
      tokens_input: historicalUsage.tokens.input,
      tokens_output: historicalUsage.tokens.output,
    })
    .run()
    .pipe(Effect.orDie)
  // Insert out of order: the importer owns chronology, not fixture insertion order or lexical IDs.
  yield* db
    .insert(MessageTable)
    .values([
      {
        id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            role: "assistant",
            parentID: user,
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            mode: "assistant",
            providerID,
            modelID,
            path: { cwd: directory, root: directory },
            time: { created: 2, completed: 3 },
            ...historicalUsage,
            finish: "stop",
          } satisfies Omit<SessionV1.Assistant, "id" | "sessionID">),
        },
      },
      {
        id: user,
        session_id: sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({
            role: "user",
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            model: { providerID, modelID },
            time: { created: 1 },
          } satisfies Omit<SessionV1.User, "id" | "sessionID">),
        },
      },
    ])
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values([
      {
        id: PartID.make(`prt_history_http_1${suffix}`),
        message_id: user,
        session_id: sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({ type: "text", text: "Historical question." } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
      {
        id: PartID.make(`prt_history_http_2${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({ type: "text", text: "Historical answer." } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
      {
        id: PartID.make(`prt_history_http_3${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            type: "tool",
            callID: "history-completed-call",
            tool: "write",
            state: {
              status: "completed",
              input: completedInput,
              output: "Historical tool output.",
              title: "Historical write",
              metadata: { title: "private-tool-metadata" },
              time: { start: 2, end: 3 },
            },
          } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
        },
      },
      {
        id: PartID.make(`prt_history_http_4${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            type: "tool",
            callID: "history-pending-call",
            tool: "write",
            state: { status: "pending", input: pendingInput, raw: JSON.stringify(pendingInput) },
          } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
        },
      },
    ])
    .run()
    .pipe(Effect.orDie)
  return { sessionID, user, assistant, completedInput, pendingInput }
})

export const persistedState = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
  const db = (yield* Database.Service).db
  const messages = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .orderBy(asc(MessageTable.id))
    .all()
    .pipe(Effect.orDie)
  const parts = yield* db
    .select()
    .from(PartTable)
    .where(eq(PartTable.session_id, sessionID))
    .orderBy(asc(PartTable.id))
    .all()
    .pipe(Effect.orDie)
  const usage = yield* db
    .select({
      cost: SessionTable.cost,
      input: SessionTable.tokens_input,
      output: SessionTable.tokens_output,
      reasoning: SessionTable.tokens_reasoning,
      cacheRead: SessionTable.tokens_cache_read,
      cacheWrite: SessionTable.tokens_cache_write,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  const events = yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
  const inputs = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.session_id, sessionID))
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return { source: { messages, parts }, usage, events, inputs }
})

export * as LegacyHistory from "./legacy-history"
