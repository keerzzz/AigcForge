export * as SessionUsage from "./usage.js"

import type { Usage } from "@omnixa/ai"
import { Money } from "@omnixa/schema/money"
import type { TokenUsage } from "@omnixa/schema/token-usage"
import type { Model } from "@omnixa/schema/model"
import type { ModelSource } from "@omnixa/schema/model-source"
import type { SessionAttempt } from "@omnixa/schema/session-attempt"

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
  if (
    (quote.validFrom !== undefined && time < quote.validFrom) ||
    (quote.validUntil !== undefined && time >= quote.validUntil)
  )
    return { status: "unknown" }
  return quote
}

const unknownQuote = (quote: ModelSource.Quote | undefined, usage: TokenUsage.Info | undefined) =>
  quote === undefined ||
  quote.status === "unknown" ||
  (quote.status === "known" && usage !== undefined && price(quote.prices, usage) === undefined)

export function summarizeGatewayAttempts(
  gatewayAttempts: readonly SessionAttempt.GatewayAttempt[],
  fallbackUsage: TokenUsage.Info | undefined,
) {
  let cost = 0
  let hasCost = false
  let hasUsage = false
  let tokensSum = tokens(undefined)
  let unknownPriceAttempts = 0
  let missingUsageAttempts = 0
  for (const attempt of gatewayAttempts) {
    if (attempt.cost !== undefined) {
      cost += attempt.cost
      hasCost = true
    }
    if (attempt.usage === undefined) missingUsageAttempts += 1
    if (attempt.usage !== undefined) {
      hasUsage = true
      tokensSum = add(
        { tokens: tokensSum, cost: Money.USD.zero },
        { tokens: attempt.usage, cost: Money.USD.zero },
      ).tokens
    }
    if (unknownQuote(attempt.quote, attempt.usage)) unknownPriceAttempts += 1
  }
  return {
    cost: hasCost ? Money.USD.make(cost) : undefined,
    tokens: hasUsage ? tokensSum : (fallbackUsage ?? tokens(undefined)),
    unknownPriceAttempts,
    missingUsageAttempts,
  }
}

/** A logical Step sums its durable receipts, each already priced at its own deployment. */
export const aggregate = (attempts: readonly SessionAttempt.Info[]) =>
  attempts.reduce(
    (sum, attempt) => {
      const terminal = attempt.terminal
      if (!terminal) return sum
      if (terminal.gatewayAttempts && terminal.gatewayAttempts.length > 0) {
        const gateway = summarizeGatewayAttempts(terminal.gatewayAttempts, terminal.usage)
        return {
          ...add(sum, { tokens: gateway.tokens, cost: gateway.cost ?? Money.USD.zero }),
          unknownPriceAttempts: sum.unknownPriceAttempts + gateway.unknownPriceAttempts,
          missingUsageAttempts: sum.missingUsageAttempts + gateway.missingUsageAttempts,
        }
      }
      const usage = terminal.usage ?? tokens(undefined)
      return {
        ...add(sum, { tokens: usage, cost: terminal.cost ?? Money.USD.zero }),
        unknownPriceAttempts: sum.unknownPriceAttempts + Number(unknownQuote(attempt.quote, terminal.usage)),
        missingUsageAttempts: sum.missingUsageAttempts + Number(terminal.usage === undefined),
      }
    },
    { cost: Money.USD.zero, tokens: tokens(undefined), unknownPriceAttempts: 0, missingUsageAttempts: 0 },
  )

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
