import { Schema } from "effect"
import { LLMError, ProviderErrorEvent } from "./schema"

const patterns = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
]

const quotaPatterns = [
  /insufficient[-_\s]?quota/i,
  /billing[-_\s]?(?:hard[-_\s]?)?limit/i,
  /(?:monthly|project|account)[-_\s]*(?:spending|spend|budget)[-_\s]*(?:cap|limit)/i,
  /(?:spending|spend|budget)[-_\s]*(?:cap|limit)[-_\s]*(?:exceeded|reached|hit)/i,
  /exceeded (?:your|the) (?:current )?quota/i,
]
const temporaryQuotaPattern =
  /(?:per|requests? per|tokens? per)[-_\s]+(?:minute|second|hour)|(?:per-minute|per-second|per-hour)|rate[-_\s]?limit/i

export const isQuotaExceeded = (message: string) =>
  !temporaryQuotaPattern.test(message) && quotaPatterns.some((pattern) => pattern.test(message))

export const isContextOverflow = (message: string) =>
  patterns.some((pattern) => pattern.test(message)) || /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"
