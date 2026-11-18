export * as SessionUsage from "./usage.js"

import type { Usage } from "@aigcfroge/ai"
import { Money } from "@aigcfroge/schema/money"
import type { TokenUsage } from "@aigcfroge/schema/token-usage"
import type { Model } from "@aigcfroge/schema/model"
import type { ModelSource } from "@aigcfroge/schema/model-source"
import type { SessionAttempt } from "@aigcfroge/schema/session-attempt"

const finite = (value: number) => (Number.isFinite(value) ? value : 0)
const safe = (value: number | undefined) => Math.max(0, finite(value ?? 0))

export const tokens = (usage: Usage | undefined): TokenUsage.Info => ({
  input: safe(usage?.nonCachedInputTokens),
  output: safe(usage?.visibleOutputTokens),
  reasoning: safe(usage?.reasoningTokens),
  cache: {
    read: safe(usage?.cacheReadInputTokens),
    write: safe(usage?.cacheWriteInputTokens),
  },
})

// TODO(#35765): Use Copilot's reported billed amount once billing has a dedicated typed runtime contract.
export function price(costs: Model.Info["cost"], usage: TokenUsage.Info) {
  const context = usage.input + usage.cache.read + usage.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  return tier ?? costs.find((cost) => cost.tier === undefined)
}

export function calculateCost(costs: Model.Info["cost"], usage: TokenUsage.Info) {
  const cost = price(costs, usage)
  if (!cost) return Money.USD.zero
  return Money.USD.make(
    (usage.input * finite(cost.input) +
      (usage.output + usage.reasoning) * finite(cost.output) +
      usage.cache.read * finite(cost.cache.read) +
      usage.cache.write * finite(cost.cache.write)) /
      1_000_000,
  )
}

export function quotedCost(quote: ModelSource.Quote, usage: TokenUsage.Info | undefined) {
  if (usage === undefined || quote.status === "unknown") return
  if (quote.status === "known" && price(quote.prices, usage) === undefined) return
  return calculateCost(quote.prices, usage)
}

/** Quotes are valid at the physical request boundary; an elapsed quote has no current price. */
export function currentQuote(quote: ModelSource.Quote, time: number): ModelSource.Quote {
  if (quote.status === "unknown") return quote
  if ((quote.validFrom !== undefined && time < quote.validFrom) ||
    (quote.validUntil !== undefined && time >= quote.validUntil)) return { status: "unknown" }
  return quote
}

/** A logical Step sums its durable receipts, each already priced at its own deployment. */
export const aggregate = (attempts: readonly SessionAttempt.Info[]) => attempts.reduce((sum, attempt) => {
  const terminal = attempt.terminal
  if (!terminal) return sum
  const usage = terminal.usage ?? tokens(undefined)
  return {
    ...add(sum, { tokens: usage, cost: terminal.cost ?? Money.USD.zero }),
    unknownPriceAttempts: sum.unknownPriceAttempts + Number(attempt.quote.status === "unknown" ||
      (attempt.quote.status === "known" && terminal.usage !== undefined && price(attempt.quote.prices, terminal.usage) === undefined)),
    missingUsageAttempts: sum.missingUsageAttempts + Number(terminal.usage === undefined),
  }
}, { cost: Money.USD.zero, tokens: tokens(undefined), unknownPriceAttempts: 0, missingUsageAttempts: 0 })

export type Recorded = { readonly tokens: TokenUsage.Info; readonly cost: Money.USD }

export const record = (usage: Usage | undefined, costs: Model.Info["cost"]): Recorded => {
  const normalized = tokens(usage)
  return { tokens: normalized, cost: calculateCost(costs, normalized) }
}

export const add = (a: Recorded, b: Recorded): Recorded => ({
  cost: Money.USD.make(a.cost + b.cost),
  tokens: {
    input: a.tokens.input + b.tokens.input,
    output: a.tokens.output + b.tokens.output,
    reasoning: a.tokens.reasoning + b.tokens.reasoning,
    cache: {
      read: a.tokens.cache.read + b.tokens.cache.read,
      write: a.tokens.cache.write + b.tokens.cache.write,
    },
  },
})
