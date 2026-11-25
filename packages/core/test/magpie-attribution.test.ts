import { describe, expect, it } from "bun:test"
import { Model } from "@omnixa/schema/model"
import { Money } from "@omnixa/schema/money"
import { Provider } from "@omnixa/schema/provider"
import { SessionMagpie } from "@omnixa/core/session/magpie"
import { SessionUsage } from "@omnixa/core/session/usage"
import { Effect } from "effect"

describe("SessionMagpie P5-D attribution", () => {
  it("detects Magpie targets and injects non-clobbering session and attempt correlation headers", () => {
    expect(SessionMagpie.isGatewayTarget({ providerID: "magpie", baseURL: "https://example.com/v1" })).toBe(true)
    expect(SessionMagpie.isGatewayTarget({ providerID: "openai", baseURL: "http://127.0.0.1:3425/v1" })).toBe(true)
    expect(SessionMagpie.isGatewayTarget({ providerID: "openai", baseURL: "https://api.openai.com/v1" })).toBe(false)

    const headers = SessionMagpie.correlateHeaders({
      sessionID: "ses_1",
      attemptID: "gatt_1",
      headers: { "content-type": "application/json" },
    })
    expect(headers).toEqual({
      "content-type": "application/json",
      "x-magpie-session": "ses_1",
      "x-magpie-attempt": "gatt_1",
    })

    const preserved = SessionMagpie.correlateHeaders({
      sessionID: "ses_1",
      attemptID: "gatt_1",
      headers: { "X-Magpie-Session": "custom-session" },
    })
    expect(preserved).toEqual({
      "X-Magpie-Session": "custom-session",
      "x-magpie-attempt": "gatt_1",
    })
  })

  it("attributes hidden gateway attempts with per-candidate quotes, cache accounts, and unknown-price counts", () => {
    const started = 1_700_000_000_000
    const catalog: readonly Pick<Model.Info, "providerID" | "id" | "cost">[] = [
      {
        id: Model.ID.make("claude-sonnet-4"),
        providerID: Provider.ID.make("anthropic"),
        cost: [
          {
            input: Money.USDPerMillionTokens.make(3),
            output: Money.USDPerMillionTokens.make(15),
            cache: {
              read: Money.USDPerMillionTokens.make(0.3),
              write: Money.USDPerMillionTokens.make(3.75),
            },
          },
        ],
      },
    ]

    const attributed = SessionMagpie.attributeAttempts({
      started,
      rawAttempts: [
        {
          ordinal: 0,
          correlationID: "gatt_1",
          provider: "anthropic",
          model: "claude-sonnet-4",
          providerAccount: "acct-cache-a",
          host: "api.anthropic.com",
          status: 429,
          attempt_ms: 120,
          in: 1_000,
          out: 0,
          cache_read: 2_000,
          err: "rate_limit",
        },
        {
          ordinal: 1,
          correlationID: "gatt_1",
          provider: "unknown-upstream",
          model: "mystery-model",
          providerAccount: "acct-cache-b",
          host: "upstream.example.com",
          status: 200,
          attempt_ms: 240,
          in: 500,
          out: 100,
          cache_write: 50,
        },
      ],
      resolveQuote: (provider, model) => SessionMagpie.resolveCatalogQuote(catalog, provider, model),
    })

    expect(attributed).toHaveLength(2)
    expect(attributed[0]).toMatchObject({
      ordinal: 0,
      provider: "anthropic",
      model: "claude-sonnet-4",
      account: "acct-cache-a",
      status: 429,
      durationMs: 120,
      error: "rate_limit",
      quote: { status: "known" },
    })
    // 1000 * 3 / 1e6 + 2000 * 0.3 / 1e6 = 0.003 + 0.0006 = 0.0036
    expect(attributed[0]?.cost).toBeCloseTo(0.0036, 8)
    expect(attributed[1]).toMatchObject({
      ordinal: 1,
      provider: "unknown-upstream",
      model: "mystery-model",
      account: "acct-cache-b",
      status: 200,
      quote: { status: "unknown" },
      cost: undefined,
    })

    const summary = SessionUsage.summarizeGatewayAttempts(attributed, undefined)
    expect(summary.cost).toBeCloseTo(0.0036, 8)
    expect(summary.unknownPriceAttempts).toBe(1)
    expect(summary.missingUsageAttempts).toBe(0)
    expect(summary.tokens).toEqual({
      input: 1_500,
      output: 100,
      reasoning: 0,
      cache: { read: 2_000, write: 50 },
    })
  })

  it("correlates concurrent gateway route traces by attemptID and rejects mismatched traces", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch(request) {
                  const url = new URL(request.url)
                  const id = url.searchParams.get("id")
                  if (id === "route-1")
                    return Response.json({
                      id: "route-1",
                      session: "ses_a",
                      attempt: "gatt_a",
                      attempts: [
                        {
                          provider: "openai",
                          model: "gpt-4o-mini",
                          providerAccount: "acct-a",
                          status: 200,
                          in: 10,
                          out: 5,
                        },
                      ],
                    })
                  if (id === "route-mismatch")
                    return Response.json({
                      id: "route-mismatch",
                      session: "ses_a",
                      attempt: "gatt_other",
                      attempts: [{ provider: "openai", model: "gpt-4o-mini", status: 200, in: 999, out: 999 }],
                    })
                  return new Response(null, { status: 404 })
                },
              }),
            ),
            (running) => Effect.promise(() => running.stop(true)),
          )

          const matched = yield* SessionMagpie.fetchRouteTrace({
            baseURL: `${server.url}v1`,
            routeID: "route-1",
            attemptID: "gatt_a",
            sessionID: "ses_a",
            started: 1_700_000_000_000,
          })
          expect(matched).toHaveLength(1)
          expect(matched?.[0]).toMatchObject({ providerAccount: "acct-a", in: 10, out: 5 })

          const mismatched = yield* SessionMagpie.fetchRouteTrace({
            baseURL: `${server.url}v1`,
            routeID: "route-mismatch",
            attemptID: "gatt_a",
            sessionID: "ses_a",
            started: 1_700_000_000_000,
          })
          expect(mismatched).toBeUndefined()
        }),
      ),
    ))
})
