import { expect, test } from "bun:test"
import { ProviderQuota } from "../src/provider/quota.js"

test("ChatGPT quota retains each reported window, credits and the actual observation time", () => {
  const value = ProviderQuota.chatgpt(
    {
      plan_type: "pro",
      rate_limit: {
        allowed: false,
        primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: 200, reset_after_seconds: 10 },
        secondary_window: { used_percent: 35, limit_window_seconds: 604800, reset_after_seconds: 72 * 3600 },
      },
      credits: { has_credits: true, unlimited: false, balance: "2.4" },
    },
    100000,
  )
  expect(value).toMatchObject({
    source: "chatgpt",
    known: true,
    observedAt: 100000,
    allowed: false,
    hasCredits: true,
    balance: 2.4,
  })
  expect(value.windows).toEqual([
    { id: "primary", unit: "chatgpt-share", usedRatio: 1, resetAt: 200000, spanMs: 18000000 },
    { id: "secondary", unit: "chatgpt-share", usedRatio: 0.35, resetAt: 259300000, spanMs: 604800000 },
  ])
})

test("ChatGPT missing or malformed windows remain unknown while other valid windows survive", () => {
  expect(ProviderQuota.chatgpt({}, 100).known).toBe(false)
  expect(ProviderQuota.chatgpt({ rate_limit: { primary_window: { used_percent: "invalid" } } }, 100).windows).toEqual(
    [],
  )
  expect(ProviderQuota.chatgpt({ rate_limit: { primary_window: { used_percent: "Infinity" } } }, 100).known).toBe(false)
  expect(
    ProviderQuota.chatgpt(
      {
        rate_limit: {
          primary_window: { used_percent: "invalid" },
          secondary_window: { used_percent: 25 },
        },
      },
      100,
    ).windows,
  ).toEqual([{ id: "secondary", unit: "chatgpt-share", usedRatio: 0.25, resetAt: undefined, spanMs: undefined }])
})

test("Copilot numeric strings retain per-quota units and never turn has_quota false into unlimited", () => {
  const value = ProviderQuota.copilot(
    {
      copilot_plan: "business",
      token_based_billing: true,
      quota_reset_date_utc: "2026-12-01T00:00:00.000Z",
      quota_snapshots: {
        chat: { unlimited: true, has_quota: false, entitlement: "0" },
        premium_interactions: { unlimited: false, has_quota: false, entitlement: "1000", quota_remaining: "750" },
      },
    },
    100,
  )
  expect(value).toMatchObject({ known: true, managed: true, observedAt: 100 })
  expect(value.windows[0]).toMatchObject({
    id: "chat",
    unit: "copilot-chat-token",
    unlimited: true,
    usedRatio: undefined,
  })
  expect(value.windows[1]).toMatchObject({
    id: "premium_interactions",
    unit: "copilot-premium_interactions-token",
    unlimited: false,
    usedRatio: 0.25,
    total: 1000,
    remaining: 750,
    resetAt: Date.parse("2026-12-01T00:00:00.000Z"),
  })
  expect(
    ProviderQuota.copilot({ quota_snapshots: { premium_interactions: { unlimited: true, has_quota: false } } }, 100)
      .windows[0],
  ).toMatchObject({ unlimited: false, usedRatio: 1, hasQuota: false })
})

test("Copilot preserves unknown data, percent-only readings and separate request billing", () => {
  expect(ProviderQuota.copilot({}, 100).known).toBe(false)
  expect(
    ProviderQuota.copilot(
      { quota_snapshots: { premium_interactions: { entitlement: "invalid", quota_remaining: null } } },
      100,
    ).known,
  ).toBe(false)
  const value = ProviderQuota.copilot(
    {
      quota_reset_date: "2026-12-01",
      quota_snapshots: {
        premium_interactions: { entitlement: "invalid", percent_remaining: 5.5 },
      },
    },
    100,
  )
  expect(value.windows[0]).toMatchObject({
    unit: "copilot-premium_interactions-request",
    usedRatio: 0.945,
    resetAt: Date.parse("2026-12-01"),
  })
  expect(value.windows[0]?.total).toBeUndefined()
  expect(value.windows[0]?.remaining).toBeUndefined()
})
