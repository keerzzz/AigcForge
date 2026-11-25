export * as ProviderQuota from "./quota.js"

import { Option, Schema } from "effect"
import { optional } from "@omnixa/schema/schema"

const decodeNumber = Schema.decodeUnknownOption(
  Schema.Union([Schema.Finite, Schema.NumberFromString.check(Schema.isFinite())]),
)
const decodeChatGPT = Schema.decodeUnknownOption(
  Schema.Struct({
    plan_type: Schema.String.pipe(optional),
    rate_limit: Schema.Struct({
      allowed: Schema.Boolean.pipe(optional),
      primary_window: Schema.Unknown.pipe(optional),
      secondary_window: Schema.Unknown.pipe(optional),
    }).pipe(optional),
    credits: Schema.Struct({
      has_credits: Schema.Boolean.pipe(optional),
      unlimited: Schema.Boolean.pipe(optional),
      balance: Schema.Unknown.pipe(optional),
    }).pipe(optional),
  }),
)
const decodeChatGPTWindow = Schema.decodeUnknownOption(
  Schema.Struct({
    used_percent: Schema.Unknown.pipe(optional),
    limit_window_seconds: Schema.Unknown.pipe(optional),
    reset_at: Schema.Unknown.pipe(optional),
    reset_after_seconds: Schema.Unknown.pipe(optional),
  }),
)
const decodeCopilot = Schema.decodeUnknownOption(
  Schema.Struct({
    copilot_plan: Schema.String.pipe(optional),
    quota_reset_date_utc: Schema.String.pipe(optional),
    quota_reset_date: Schema.String.pipe(optional),
    token_based_billing: Schema.Boolean.pipe(optional),
    quota_snapshots: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  }),
)
const decodeCopilotWindow = Schema.decodeUnknownOption(
  Schema.Struct({
    unlimited: Schema.Boolean.pipe(optional),
    has_quota: Schema.Boolean.pipe(optional),
    entitlement: Schema.Unknown.pipe(optional),
    quota_remaining: Schema.Unknown.pipe(optional),
    percent_remaining: Schema.Unknown.pipe(optional),
    quota_reset_at: Schema.Unknown.pipe(optional),
    overage_permitted: Schema.Boolean.pipe(optional),
    token_based_billing: Schema.Boolean.pipe(optional),
  }),
)
const decodeOpenRouter = Schema.decodeUnknownOption(
  Schema.Struct({
    data: Schema.Struct({
      limit: Schema.NullOr(Schema.Unknown).pipe(optional),
      limit_remaining: Schema.NullOr(Schema.Unknown).pipe(optional),
      limit_reset: Schema.NullOr(Schema.String).pipe(optional),
      is_free_tier: Schema.Boolean.pipe(optional),
    }),
  }),
)

/** Reads the subscription API's observations; eligibility remains the routing owner's decision. */
export function chatgpt(input: unknown, observedAt: number) {
  const reply = Option.getOrUndefined(decodeChatGPT(input))
  const windows = [
    { id: "primary", value: reply?.rate_limit?.primary_window },
    { id: "secondary", value: reply?.rate_limit?.secondary_window },
  ].flatMap((item) => {
    const value = Option.getOrUndefined(decodeChatGPTWindow(item.value))
    const used = number(value?.used_percent)
    if (used === undefined) return []
    const reset = number(value?.reset_at)
    const after = number(value?.reset_after_seconds)
    const span = number(value?.limit_window_seconds)
    return [
      {
        id: item.id,
        unit: "chatgpt-share",
        usedRatio: used / 100,
        resetAt:
          reset !== undefined && reset > 0
            ? reset * 1000
            : after !== undefined && after >= 0
              ? observedAt + after * 1000
              : undefined,
        spanMs: span !== undefined && span > 0 ? span * 1000 : undefined,
      },
    ]
  })
  return {
    source: "chatgpt" as const,
    observedAt,
    known: windows.length > 0,
    plan: reply?.plan_type,
    allowed: reply?.rate_limit?.allowed,
    hasCredits: reply?.credits?.has_credits,
    unlimitedCredits: reply?.credits?.unlimited,
    balance: number(reply?.credits?.balance),
    windows,
  }
}

/** Each quota ID keeps its own counter unit; token and request billing never share a balance. */
export function copilot(input: unknown, observedAt: number) {
  const reply = Option.getOrUndefined(decodeCopilot(input))
  const resetDate = reply?.quota_reset_date_utc ?? reply?.quota_reset_date
  const resetTime = resetDate === undefined ? undefined : Date.parse(resetDate)
  const windows = ["chat", "completions", "premium_interactions"].flatMap((id) => {
    const value = Option.getOrUndefined(decodeCopilotWindow(reply?.quota_snapshots?.[id]))
    if (value === undefined) return []
    const total = number(value.entitlement)
    const remaining = number(value.quota_remaining)
    const percent = number(value.percent_remaining)
    // An exhausted pooled premium allowance can still be reported as unlimited.
    const exhausted = id === "premium_interactions" && value.unlimited === true && value.has_quota === false
    const unlimited = value.unlimited === true && !exhausted
    const usedRatio = exhausted
      ? 1
      : total !== undefined && total > 0 && remaining !== undefined
        ? Math.max(0, (total - remaining) / total)
        : percent === undefined
          ? undefined
          : (100 - percent) / 100
    if (!unlimited && usedRatio === undefined) return []
    const reset = number(value.quota_reset_at)
    return [
      {
        id,
        unit: `copilot-${id}-${(value.token_based_billing ?? reply?.token_based_billing) === true ? "token" : "request"}`,
        usedRatio: unlimited ? undefined : usedRatio,
        total,
        remaining,
        unlimited,
        hasQuota: value.has_quota,
        overagePermitted: value.overage_permitted,
        resetAt:
          reset !== undefined && reset > 0
            ? reset * 1000
            : resetTime !== undefined && Number.isFinite(resetTime)
              ? resetTime
              : undefined,
      },
    ]
  })
  return {
    source: "github-copilot" as const,
    observedAt,
    known: windows.length > 0,
    plan: reply?.copilot_plan,
    managed: reply?.copilot_plan === "business" || reply?.copilot_plan === "enterprise",
    windows,
  }
}

const openrouterResetMs: Readonly<Record<string, number>> = {
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_592_000_000,
}

/** Reads OpenRouter `/api/v1/key` limits and balance; missing fields stay unknown without fabrication. */
export function openrouter(input: unknown, observedAt: number) {
  const data = Option.getOrUndefined(decodeOpenRouter(input))?.data
  const limit = number(data?.limit)
  const remaining = number(data?.limit_remaining)
  const freePlan = data?.is_free_tier
  const reset =
    data?.limit_reset === "daily" || data?.limit_reset === "weekly" || data?.limit_reset === "monthly"
      ? data.limit_reset
      : undefined
  const spanMs = reset === undefined ? undefined : openrouterResetMs[reset]
  const windows =
    limit !== undefined && limit >= 0 && remaining !== undefined
      ? [
          {
            id: reset ?? "limit",
            unit: "openrouter-usd",
            usedRatio: limit <= 0 || remaining <= 0 ? 1 : Math.max(0, (limit - remaining) / limit),
            total: limit,
            remaining,
            unlimited: false,
            spanMs,
          },
        ]
      : []
  const allowed = remaining !== undefined ? remaining > 0 : limit !== undefined && limit <= 0 ? false : undefined
  return {
    source: "openrouter" as const,
    observedAt,
    known: windows.length > 0 || remaining !== undefined || freePlan !== undefined,
    freePlan,
    allowed,
    balance: remaining,
    windows,
  }
}

function number(input: unknown) {
  return Option.getOrUndefined(decodeNumber(input))
}
