export * as SessionMagpie from "./magpie.js"

import type { Model } from "@omnixa/schema/model"
import type { ModelSource } from "@omnixa/schema/model-source"
import { SessionAttempt } from "@omnixa/schema/session-attempt"
import type { TokenUsage } from "@omnixa/schema/token-usage"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { SessionUsage } from "./usage.js"

const TRACE_TIMEOUT_MS = 1_500

const RawGatewayAttempt = Schema.Struct({
  ordinal: Schema.optional(Schema.Number),
  correlationID: Schema.optional(Schema.String),
  attempt: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  providerAccount: Schema.optional(Schema.String),
  account: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  endpoint: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
  attempt_ms: Schema.optional(Schema.Number),
  ms: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  in: Schema.optional(Schema.Number),
  out: Schema.optional(Schema.Number),
  reasoning: Schema.optional(Schema.Number),
  cache_read: Schema.optional(Schema.Number),
  cache_write: Schema.optional(Schema.Number),
  err: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

const RawRouteTrace = Schema.Struct({
  id: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  attempt: Schema.optional(Schema.String),
  attempts: Schema.optional(Schema.Array(RawGatewayAttempt)),
})

const nonEmpty = (value: string | undefined) => (value !== undefined && value.length > 0 ? value : undefined)

const nonNegInt = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined

const httpStatus = (value: number | undefined) =>
  value !== undefined && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined

const formatUTCDate = (time: number) => {
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function isGatewayTarget(input: {
  readonly providerID: string
  readonly baseURL?: string
  readonly headers?: Readonly<Record<string, string>>
}): boolean {
  if (input.headers) {
    for (const key of Object.keys(input.headers)) {
      const lower = key.toLowerCase()
      if (lower === "x-magpie-session" || lower === "x-magpie-attempt" || lower === "x-magpie-route-id") return true
    }
  }
  if (input.providerID.toLowerCase().includes("magpie")) return true
  if (!input.baseURL) return false
  if (input.baseURL.toLowerCase().includes("magpie")) return true
  const parsed = URL.canParse(input.baseURL) ? new URL(input.baseURL) : undefined
  return (
    parsed !== undefined &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
    parsed.port === "3425"
  )
}

export function correlateHeaders(input: {
  readonly sessionID: string
  readonly attemptID?: string
  readonly headers: Readonly<Record<string, string>>
}): Record<string, string> {
  const next = { ...input.headers }
  const hasHeader = (name: string) => Object.keys(next).some((key) => key.toLowerCase() === name)
  if (!hasHeader("x-magpie-session")) next["x-magpie-session"] = input.sessionID
  if (input.attemptID && !hasHeader("x-magpie-attempt")) next["x-magpie-attempt"] = input.attemptID
  return next
}

export function parseResponseHeaders(headers: Readonly<Record<string, string>>) {
  const provider = nonEmpty(headers["x-magpie-provider"])
  const model = nonEmpty(headers["x-magpie-model"])
  const session = nonEmpty(headers["x-magpie-session"])
  const attempt = nonEmpty(headers["x-magpie-attempt"])
  const routeID = nonEmpty(headers["x-magpie-route-id"])
  if (!provider && !model && !session && !attempt && !routeID) return undefined
  return {
    source: "response-headers" as const,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(session ? { session } : {}),
    ...(attempt ? { attempt } : {}),
    ...(routeID ? { routeID } : {}),
  }
}

function toUsage(raw: Schema.Schema.Type<typeof RawGatewayAttempt>): TokenUsage.Info | undefined {
  if (
    raw.in === undefined &&
    raw.out === undefined &&
    raw.reasoning === undefined &&
    raw.cache_read === undefined &&
    raw.cache_write === undefined
  )
    return undefined
  return {
    input: Math.max(0, Number.isFinite(raw.in) ? (raw.in ?? 0) : 0),
    output: Math.max(0, Number.isFinite(raw.out) ? (raw.out ?? 0) : 0),
    reasoning: Math.max(0, Number.isFinite(raw.reasoning) ? (raw.reasoning ?? 0) : 0),
    cache: {
      read: Math.max(0, Number.isFinite(raw.cache_read) ? (raw.cache_read ?? 0) : 0),
      write: Math.max(0, Number.isFinite(raw.cache_write) ? (raw.cache_write ?? 0) : 0),
    },
  }
}

export function attributeAttempts(input: {
  readonly rawAttempts: ReadonlyArray<Schema.Schema.Type<typeof RawGatewayAttempt>>
  readonly started: number
  readonly resolveQuote: (provider: string | undefined, model: string | undefined) => ModelSource.Quote
}): SessionAttempt.GatewayAttempt[] {
  return input.rawAttempts.map((raw, index) => {
    const provider = nonEmpty(raw.provider)
    const model = nonEmpty(raw.model)
    const usage = toUsage(raw)
    const quote = SessionUsage.currentQuote(input.resolveQuote(provider, model), input.started)
    const cost = SessionUsage.quotedCost(quote, usage)
    return new SessionAttempt.GatewayAttempt({
      ordinal: nonNegInt(raw.ordinal) ?? index,
      correlationID: nonEmpty(raw.correlationID ?? raw.attempt),
      provider,
      model,
      account: nonEmpty(raw.providerAccount ?? raw.account),
      endpoint: nonEmpty(raw.endpoint ?? raw.host),
      status: httpStatus(raw.status),
      durationMs: nonNegInt(raw.durationMs ?? raw.attempt_ms ?? raw.ms),
      usage,
      quote,
      cost,
      error: nonEmpty(raw.error ?? raw.err),
    })
  })
}

export const resolveCatalogQuote = (
  models: readonly Pick<Model.Info, "providerID" | "id" | "cost">[],
  providerID: string | undefined,
  modelID: string | undefined,
): ModelSource.Quote => {
  if (!providerID || !modelID) return { status: "unknown" }
  const normalizedID = modelID.startsWith(`${providerID}/`) ? modelID.slice(providerID.length + 1) : modelID
  const found = models.find(
    (item) => item.providerID === providerID && (item.id === modelID || item.id === normalizedID),
  )
  if (!found || found.cost.length === 0) return { status: "unknown" }
  return {
    status: found.cost.every(
      (cost) => cost.input === 0 && cost.output === 0 && cost.cache.read === 0 && cost.cache.write === 0,
    )
      ? "free"
      : "known",
    prices: [...found.cost],
    source: "provider-catalog",
  }
}

export const fetchRouteTrace = Effect.fn("SessionMagpie.fetchRouteTrace")(function* (input: {
  readonly baseURL: string
  readonly routeID?: string
  readonly attemptID: string
  readonly sessionID: string
  readonly started: number
}): Effect.fn.Return<readonly Schema.Schema.Type<typeof RawGatewayAttempt>[] | undefined> {
  if (!URL.canParse(input.baseURL)) return undefined
  const origin = new URL(input.baseURL).origin
  const url = input.routeID
    ? `${origin}/api/gateway/route?id=${encodeURIComponent(input.routeID)}&day=${formatUTCDate(input.started)}`
    : `${origin}/v1/magpie/route?session=${encodeURIComponent(input.sessionID)}&attempt=${encodeURIComponent(input.attemptID)}`
  const clientOption = yield* Effect.serviceOption(HttpClient.HttpClient)
  const requestEffect = Option.isSome(clientOption)
    ? clientOption.value.execute(HttpClientRequest.get(url)).pipe(
        Effect.flatMap((res) => (res.status >= 200 && res.status < 300 ? res.json : Effect.succeed(undefined))),
        Effect.orElseSucceed(() => undefined),
      )
    : Effect.tryPromise(() =>
        fetch(url, { signal: AbortSignal.timeout(TRACE_TIMEOUT_MS) }).then((r) => (r.ok ? r.json() : undefined)),
      ).pipe(Effect.orElseSucceed(() => undefined))
  const response = yield* requestEffect.pipe(Effect.timeoutOption(TRACE_TIMEOUT_MS))
  if (Option.isNone(response) || response.value === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(RawRouteTrace)(response.value)
  if (Option.isNone(decoded)) return undefined
  const trace = decoded.value
  // Reject mismatched correlation so concurrent requests never cross-attribute hidden attempts.
  if (trace.attempt !== undefined && trace.attempt !== input.attemptID) return undefined
  if (trace.session !== undefined && trace.session !== input.sessionID) return undefined
  return trace.attempts
})
