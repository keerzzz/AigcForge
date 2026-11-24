import type { SessionMessageAssistant, SessionMessageInfo } from "@omnixa/client/promise"
import { TokenUsage } from "@omnixa/schema/token-usage"

/** The latest physical request's context, independent of a Step's accumulated billing receipts. */
export function sessionContextUsage(messages: readonly SessionMessageInfo[]) {
  const message = messages.findLast(
    (item): item is SessionMessageAssistant =>
      item.type === "assistant" && (item.attempts !== undefined || item.tokens !== undefined),
  )

  if (!message) return
  const attempt = message.attempts?.at(-1)
  // Historical messages have no attempt receipts. A recorded request without usage stays unknown.
  const tokens = message.attempts === undefined ? message.tokens : attempt?.terminal?.usage

  return {
    message,
    model: attempt?.model ?? message.model,
    tokens,
    total: tokens ? TokenUsage.total(tokens) : undefined,
  }
}

export * as ContextUsage from "./usage"
