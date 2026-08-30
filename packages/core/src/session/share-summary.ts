import { Effect } from "effect"
import { LLM, LLMClient, Message, SystemPart } from "@aigcfroge/llm"
import { Catalog } from "../catalog"
import { fromCatalogModel } from "../session/runner/model"
import { SessionMessage } from "../session/message"
import { formatMessages } from "./share-v2"

const SUMMARY_SYSTEM_PROMPT = `You are a context summarizer for an AI coding agent.
Your task: compress the following conversation into a 200-500 token summary for a subagent to continue the work.

Focus on:
- What the user asked for and what they are trying to accomplish
- Key decisions made and constraints discovered
- Files or code that were modified or investigated
- The current state of work (what is done, what remains)
- Any errors or blockers encountered

Exclude:
- Boilerplate greetings and acknowledgments
- Internal tool execution details (unless they affected the outcome)
- Repetitive back-and-forth

Output only the summary, no preamble.`

/**
 * Generate a 200-500 token summary of session messages using a cheap model.
 * Falls back to returning the raw last N messages if the LLM call fails or
 * no cheap model is available. Uses `serviceOption` for LLMClient/Catalog so
 * missing services degrade to fallback instead of defecting - this lets the
 * summary run in any Effect context that provides the services, and safely
 * no-ops (via fallback) in contexts that don't (e.g. tests).
 */
export const generateSummary = Effect.fn("SessionShare.generateSummary")(function* (
  messages: ReadonlyArray<SessionMessage.Message>,
  input?: { maxTokens?: number },
) {
  const llmOpt = yield* Effect.serviceOption(LLMClient.Service)
  const catalogOpt = yield* Effect.serviceOption(Catalog.Service)
  if (llmOpt._tag === "None" || catalogOpt._tag === "None") {
    yield* Effect.logDebug("SessionShare.generateSummary: LLM or Catalog unavailable, using truncation fallback")
    return simpleTruncate(messages, 5)
  }
  const llm = llmOpt.value
  const catalog = catalogOpt.value

  // Find the first provider with a cheap model available.
  const cheapModel = yield* findCheapModel(catalog)
  if (!cheapModel) {
    yield* Effect.logDebug("SessionShare.generateSummary: no cheap model found, using truncation fallback")
    return simpleTruncate(messages, 5)
  }

  yield* Effect.logInfo(
    `SessionShare.generateSummary: using ${cheapModel.providerID}/${cheapModel.id}, ${messages.length} input messages`,
  )

  const model = yield* fromCatalogModel(cheapModel).pipe(
    Effect.catch(() => Effect.succeed(undefined as unknown as never)),
  )
  if (!(model as unknown)) {
    yield* Effect.logWarning("SessionShare.generateSummary: model resolution failed, using truncation fallback")
    return simpleTruncate(messages, 5)
  }

  const formatted = formatMessages(messages as SessionMessage.Message[])
  const maxTokens = input?.maxTokens ?? 500

  const request = LLM.request({
    model: model as unknown as Parameters<typeof LLM.request>[0]["model"],
    system: [SystemPart.make(SUMMARY_SYSTEM_PROMPT)],
    messages: [Message.user(formatted)],
    generation: { maxTokens, temperature: 0.3 },
  })

  const response = yield* llm.generate(request).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!(response as unknown)) {
    yield* Effect.logWarning("SessionShare.generateSummary: LLM generate failed, using truncation fallback")
    return simpleTruncate(messages, 5)
  }

  const text = (response as unknown as { text: string }).text.trim()
  if (text.length < 10) {
    yield* Effect.logDebug("SessionShare.generateSummary: generated summary too short, using truncation fallback")
    return simpleTruncate(messages, 5)
  }

  yield* Effect.logDebug(`SessionShare.generateSummary: success, ${text.length} chars`)
  return ["<session_summary>", text, "</session_summary>"].join("\n")
})

/** Try each provider's small model and return the first one found. */
const findCheapModel = Effect.fn("SessionShare.findCheapModel")(function* (catalog: Catalog.Interface) {
  const providers = yield* catalog.provider.all()
  for (const provider of providers) {
    const model = yield* catalog.model.small(provider.id)
    if (model) return model
  }
  return undefined
})

function simpleTruncate(messages: ReadonlyArray<SessionMessage.Message>, n: number): string {
  const tail = messages.slice(-n)
  const formatted = formatMessages(tail)
  return [
    "<session_summary>",
    `Recent context (last ${n} messages, no compression available):`,
    formatted.slice(0, 2000),
    "</session_summary>",
  ].join("\n")
}
