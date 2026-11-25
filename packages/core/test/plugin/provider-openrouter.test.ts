import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { Credential } from "@omnixa/core/credential"
import { Integration } from "@omnixa/core/integration"
import { Model } from "@omnixa/core/model"
import { Plugin } from "@omnixa/core/plugin"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { PluginHost } from "@omnixa/core/plugin/host"
import { ProviderPlugins } from "@omnixa/core/plugin/provider"
import { OpenRouterPlugin } from "@omnixa/core/plugin/provider/openrouter"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, OpenRouterPlugin.id)
  const effect = OpenRouterPlugin.effect(host)
  yield* http ? effect.pipe(Effect.provideService(HttpClient.HttpClient, http)) : effect
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("OpenRouterPlugin", () => {
  test("is registered so legacy OpenRouter behavior can be applied", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain("omnixa.provider.openrouter")
  })

  it.effect("applies legacy referer headers only to openrouter", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@omnixa/ai/providers/openrouter"
          provider.headers = { Existing: "value" }
        })
        catalog.update(Provider.ID.make("nvidia"), () => {})
      })
      yield* addPlugin()

      expect((yield* catalog.get(Provider.ID.openrouter))?.headers).toEqual({
        Existing: "value",
        "HTTP-Referer": "https://omnixa.ai/",
        "X-Title": "omnixa",
      })
      expect((yield* catalog.get(Provider.ID.make("nvidia")))?.headers).toBeUndefined()
    }),
  )

  it.effect("filters OpenRouter's gpt-5 chat alias", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@omnixa/ai/providers/openrouter"
        })
        catalog.update(Provider.ID.openai, () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat"), () => {})
        catalog.models.update(Provider.ID.openrouter, Model.ID.make("openai/gpt-5"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat"), () => {})
      })
      yield* addPlugin()

      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(false)
      expect((yield* models.get(Provider.ID.openrouter, Model.ID.make("openai/gpt-5")))?.enabled).toBe(true)
      expect((yield* models.get(Provider.ID.openai, Model.ID.make("openai/gpt-5-chat")))?.enabled).toBe(true)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenRouter providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.make("custom-openrouter"), () => {})
        catalog.models.update(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        (yield* models.get(Provider.ID.make("custom-openrouter"), Model.ID.make("gpt-5-chat-latest")))?.enabled,
      ).toBe(true)
    }),
  )

  it.effect("reads and caches per-connection OpenRouter quota and falls back across expired and auth errors", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const hooks = yield* PluginHooks.Service
      const id = Model.ID.make("openai/gpt-5")
      yield* integrations.transform((editor) => {
        editor.method.update({ integrationID: Integration.ID.make("openrouter"), method: { type: "key" } })
      })
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@omnixa/ai/providers/openrouter"
        })
        editor.models.update(Provider.ID.openrouter, id, () => {})
      })

      const accountA = yield* credentials.create({
        integrationID: Integration.ID.make("openrouter"),
        value: Credential.Key.make({ type: "key", key: "sk-or-a" }),
      })
      const accountB = yield* credentials.create({
        integrationID: Integration.ID.make("openrouter"),
        activate: false,
        value: Credential.Key.make({ type: "key", key: "sk-or-b" }),
      })
      const connectionA = { type: "credential" as const, id: accountA.id }
      const connectionB = { type: "credential" as const, id: accountB.id }

      const reads: Array<{ url: string; authorization?: string }> = []
      let status = 200
      let failTransport = false
      let payload: unknown = {
        data: {
          limit: 40,
          limit_remaining: 10,
          limit_reset: "monthly",
          is_free_tier: false,
        },
      }
      const http = HttpClient.make((request) => {
        if (failTransport) {
          const failure = new Error("connect ECONNREFUSED")
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause: failure, description: failure.message }),
            }),
          )
        }
        return Effect.sync(() => {
          reads.push({ url: request.url, authorization: request.headers.authorization })
          return HttpClientResponse.fromWeb(
            request,
            typeof payload === "string" ? new Response(payload, { status }) : Response.json(payload, { status }),
          )
        })
      })
      yield* addPlugin(http)
      // Simulate a later ConfigProviderPlugin transform overriding baseURL after OpenRouterPlugin registration.
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.openrouter, (provider) => {
          provider.settings = { baseURL: "https://proxy.openrouter.example/api/v1" }
        })
      })

      const inputB = {
        sessionID: Session.ID.make("ses_openrouter"),
        model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
        connection: connectionB,
      }
      const concurrent = yield* Effect.all(
        [hooks.trigger("session", "model.quota", inputB), hooks.trigger("session", "model.quota", { ...inputB })],
        { concurrency: "unbounded" },
      )
      expect(reads).toEqual([{ url: "https://proxy.openrouter.example/api/v1/key", authorization: "Bearer sk-or-b" }])
      expect(concurrent[0].quota).toMatchObject({
        status: "known",
        source: "openrouter",
        connection: connectionB,
        observedAt: 0,
        freshUntil: 300_000,
        freePlan: false,
        allowed: true,
        credits: { balance: 10, unlimited: false },
      })
      expect(concurrent[0].quota?.windows).toEqual([
        {
          id: "monthly",
          unit: "openrouter-usd",
          scope: "account",
          usedRatio: 0.75,
          total: 40,
          remaining: 10,
          unlimited: false,
          spanMs: 2_592_000_000,
        },
      ])
      expect(concurrent[1].quota).toEqual(concurrent[0].quota)
      expect(required(yield* models.get(Provider.ID.openrouter, id, connectionB)).metadata?.quota).toEqual(
        concurrent[0].quota,
      )
      expect(required(yield* models.get(Provider.ID.openrouter, id, connectionA)).metadata?.quota).toBeUndefined()

      yield* TestClock.adjust(300_001)
      status = 429
      payload = { error: { code: 429, message: "Too Many Requests" } }
      const rateLimited = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(2)
      expect(rateLimited.quota).toMatchObject({
        status: "unknown",
        source: "openrouter",
        connection: connectionB,
        observedAt: 0,
        freshUntil: 300_000,
        reason: "rate-limit",
        windows: [{ usedRatio: 0.75, remaining: 10 }],
      })

      yield* TestClock.adjust(300_001)
      status = 503
      payload = { error: { code: 503, message: "Upstream unavailable" } }
      const unavailable = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(3)
      expect(unavailable.quota).toMatchObject({
        status: "unknown",
        source: "openrouter",
        connection: connectionB,
        reason: "transport",
        windows: [{ usedRatio: 0.75, remaining: 10 }],
      })

      yield* TestClock.adjust(300_001)
      failTransport = true
      const networkError = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(3)
      expect(networkError.quota).toMatchObject({
        status: "unknown",
        source: "openrouter",
        connection: connectionB,
        reason: "transport",
        windows: [{ usedRatio: 0.75, remaining: 10 }],
      })
      failTransport = false

      yield* TestClock.adjust(300_001)
      status = 200
      payload = "{broken-json"
      const invalidOutput = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(4)
      expect(invalidOutput.quota).toMatchObject({
        status: "unknown",
        source: "openrouter",
        connection: connectionB,
        reason: "invalid-output",
        windows: [{ usedRatio: 0.75, remaining: 10 }],
      })

      yield* TestClock.adjust(300_001)
      status = 401
      payload = { error: { code: 401, message: "Invalid key" } }
      const unauthorized = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(5)
      expect(unauthorized.quota).toEqual({
        status: "error",
        source: "openrouter",
        connection: connectionB,
        observedAt: 1_500_005,
        freshUntil: 1_800_005,
        reason: "authentication",
        windows: [],
      })

      yield* TestClock.adjust(300_001)
      status = 403
      payload = { error: { code: 403, message: "Key disabled" } }
      const forbidden = yield* hooks.trigger("session", "model.quota", { ...inputB })
      expect(reads).toHaveLength(6)
      expect(forbidden.quota).toEqual({
        status: "error",
        source: "openrouter",
        connection: connectionB,
        observedAt: 1_800_006,
        freshUntil: 2_100_006,
        reason: "authentication",
        windows: [],
      })

      status = 200
      payload = {
        data: {
          limit: 10,
          limit_remaining: 2.5,
          limit_reset: "daily",
          is_free_tier: false,
        },
      }
      const switched = yield* hooks.trigger("session", "model.quota", {
        sessionID: Session.ID.make("ses_openrouter"),
        model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
        connection: connectionA,
      })
      expect(reads[6]).toEqual({
        url: "https://proxy.openrouter.example/api/v1/key",
        authorization: "Bearer sk-or-a",
      })
      expect(switched.quota).toMatchObject({
        status: "known",
        connection: connectionA,
        credits: { balance: 2.5, unlimited: false },
        windows: [{ id: "daily", usedRatio: 0.75, spanMs: 86_400_000 }],
      })
      expect(required(yield* models.get(Provider.ID.openrouter, id, connectionA)).metadata?.quota).toEqual(
        switched.quota,
      )
    }),
  )

  it.effect("supports env connections, rejects unset env keys with authentication, and refreshes rotated keys", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const hooks = yield* PluginHooks.Service
      const id = Model.ID.make("openai/gpt-5")
      yield* integrations.transform((editor) => {
        editor.method.update({
          integrationID: Integration.ID.make("openrouter"),
          method: { type: "env", names: ["OPENROUTER_API_KEY"] },
        })
      })
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.openrouter, (provider) => {
          provider.package = "@omnixa/ai/providers/openrouter"
        })
        editor.models.update(Provider.ID.openrouter, id, () => {})
      })

      const previousEnv = process.env.OPENROUTER_API_KEY
      try {
        process.env.OPENROUTER_API_KEY = "sk-or-env-1"
        const reads: string[] = []
        const http = HttpClient.make((request) =>
          Effect.sync(() => {
            reads.push(request.headers.authorization ?? "")
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  data: {
                    limit: 100,
                    limit_remaining: request.headers.authorization === "Bearer sk-or-env-2" ? 80 : 50,
                    limit_reset: "weekly",
                    is_free_tier: false,
                  },
                },
                { status: 200 },
              ),
            )
          }),
        )
        yield* addPlugin(http)

        const envConnection = { type: "env" as const, name: "OPENROUTER_API_KEY" }
        const first = yield* hooks.trigger("session", "model.quota", {
          sessionID: Session.ID.make("ses_openrouter_env"),
          model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
          connection: envConnection,
        })
        expect(first.quota).toMatchObject({
          status: "known",
          connection: envConnection,
          credits: { balance: 50, unlimited: false },
          windows: [{ id: "weekly", usedRatio: 0.5, spanMs: 604_800_000 }],
        })

        process.env.OPENROUTER_API_KEY = "sk-or-env-2"
        const rotated = yield* hooks.trigger("session", "model.quota", {
          sessionID: Session.ID.make("ses_openrouter_env"),
          model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
          connection: envConnection,
        })
        expect(rotated.quota).toMatchObject({
          status: "known",
          connection: envConnection,
          credits: { balance: 80, unlimited: false },
          windows: [{ id: "weekly", usedRatio: 0.2, spanMs: 604_800_000 }],
        })
        expect(reads).toEqual(["Bearer sk-or-env-1", "Bearer sk-or-env-2"])

        delete process.env.OPENROUTER_API_KEY
        const missing = yield* hooks.trigger("session", "model.quota", {
          sessionID: Session.ID.make("ses_openrouter_env"),
          model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
          connection: envConnection,
        })
        expect(missing.quota).toMatchObject({
          status: "error",
          reason: "authentication",
          connection: envConnection,
          windows: [],
        })

        const cred = yield* credentials.create({
          integrationID: Integration.ID.make("openrouter"),
          value: Credential.Key.make({ type: "key", key: "sk-or-cred-1" }),
        })
        const activeFallback = yield* hooks.trigger("session", "model.quota", {
          sessionID: Session.ID.make("ses_openrouter_active"),
          model: Model.Ref.make({ providerID: Provider.ID.openrouter, id }),
        })
        expect(activeFallback.quota).toMatchObject({
          status: "known",
          connection: { type: "credential", id: cred.id },
        })
      } finally {
        if (previousEnv === undefined) delete process.env.OPENROUTER_API_KEY
        else process.env.OPENROUTER_API_KEY = previousEnv
      }
    }),
  )
})
