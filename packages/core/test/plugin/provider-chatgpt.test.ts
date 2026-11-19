import { Money } from "@aigcfroge/schema/money"
import { Agent } from "@aigcfroge/schema/agent"
import { Session } from "@aigcfroge/core/session"
import { OpenAIResponses } from "@aigcfroge/ai/protocols/openai-responses"
import { AIError, HttpContext, LLM, Message, RateLimitError } from "@aigcfroge/ai"
import { classifyProviderFailure } from "@aigcfroge/ai/provider-error"
import { compileRequest } from "@aigcfroge/ai/route/client"
import { describe, expect } from "bun:test"
// import { DateTime, Deferred, Effect, Schedule } from "effect"
import { DateTime, Effect, Schedule } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { App } from "@aigcfroge/core/app"
import { Credential } from "@aigcfroge/core/credential"
import { Integration } from "@aigcfroge/core/integration"
import { KV } from "@aigcfroge/core/kv"
import { Location } from "@aigcfroge/core/location"
import { Model } from "@aigcfroge/core/model"
import { ModelResolver } from "@aigcfroge/core/model-resolver"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHost } from "@aigcfroge/core/plugin/host"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { GithubCopilotPlugin } from "@aigcfroge/core/plugin/provider/github-copilot"
import { ChatGPTPlugin, fetchModels, verifyIDToken } from "@aigcfroge/core/plugin/provider/chatgpt"
import { OpenAIPlugin } from "@aigcfroge/core/plugin/provider/openai"
import { Project } from "@aigcfroge/core/project"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionModelRequest } from "@aigcfroge/core/session/model-request"
import { SessionModelTransport } from "@aigcfroge/core/session/model-transport"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionRunnerRetry } from "@aigcfroge/core/session/runner/retry"
import { toSessionError } from "@aigcfroge/core/session/to-session-error"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const unavailableModels = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}, { status: 503 }))),
)

const addPlugin = Effect.fn(function* (http = unavailableModels) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, ChatGPTPlugin.id)
  yield* ChatGPTPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
})

const addLegacyPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, OpenAIPlugin.id)
  const effect = OpenAIPlugin.effect(host)
  yield* http ? effect.pipe(Effect.provideService(HttpClient.HttpClient, http)) : effect
})

const addGithubCopilotPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const authorize = Effect.fn(function* () {
  const integrations = yield* Integration.Service
  const integrationID = Integration.ID.make("openai")
  const attempt = yield* integrations.oauth.connect({
    integrationID,
    methodID: Integration.MethodID.make("chatgpt-token-sharing"),
  })
  yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
  return new URL(attempt.url)
})

const request = Effect.fn(function* (
  providerID: Provider.ID,
  baseURL: string,
  sessionID = Session.ID.make("ses_test"),
) {
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("session", "model.request", {
    sessionID,
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID, id: Model.ID.make("gpt-5.5") }),
    kind: "primary",
    baseURL,
    headers: {},
  })
  return {
    baseURL: event.baseURL,
    headers: event.headers,
    hasHttpHooks:
      (yield* hooks.has("session", "http.request", providerID)) ||
      (yield* hooks.has("session", "http.response", providerID)),
  }
})

describe("ChatGPTPlugin", () => {
  it.live("loads only visible API-supported ChatGPT models", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: (request) => {
              if (new URL(request.url).pathname === "/error/models") return new Response(null, { status: 503 })
              if (new URL(request.url).pathname === "/empty/models") return Response.json({ models: [] })
              expect(request.headers.get("authorization")).toBe("Bearer test-token")
              expect(request.headers.has("x-openai-chatpass-test")).toBe(false)
              return Response.json({
                models: [
                  {
                    slug: "gpt-5.6-sol",
                    display_name: "GPT-5.6-Sol",
                    visibility: "list",
                    supported_in_api: true,
                    context_window: 272_000,
                    input_modalities: ["text", "image"],
                    supported_reasoning_levels: [{ effort: "low" }],
                    model_messages: { base_instructions: "not retained" },
                  },
                  {
                    slug: "gpt-reserve",
                    display_name: "GPT-Reserve",
                    visibility: "hide",
                    supported_in_api: true,
                    context_window: 272_000,
                    input_modalities: ["text"],
                  },
                  {
                    slug: "not-in-api",
                    display_name: "Not in API",
                    visibility: "list",
                    supported_in_api: false,
                    context_window: 272_000,
                    input_modalities: ["text"],
                  },
                ],
              })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop()),
      )
      const baseURL = `http://localhost:${server.port}`
      expect(yield* fetchModels("test-token", App.make(), baseURL)).toEqual([
        {
          slug: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          visibility: "list",
          supported_in_api: true,
          context_window: 272_000,
          input_modalities: ["text", "image"],
          supported_reasoning_levels: [{ effort: "low" }],
        },
      ])
      expect(yield* Effect.flip(fetchModels("test-token", App.make(), `${baseURL}/empty`))).toBeInstanceOf(Error)
      expect(yield* Effect.flip(fetchModels("test-token", App.make(), `${baseURL}/error`))).toBeInstanceOf(Error)
    }),
  )

  it.live("verifies a signed ID token against OpenAI's issuer, client ID, expiry, and sign-in nonce", () =>
    Effect.gen(function* () {
      const keys = yield* Effect.promise(() => generateKeyPair("RS256"))
      const publicKey = yield* Effect.promise(() => exportJWK(keys.publicKey))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: () => Response.json({ keys: [{ ...publicKey, kid: "sign-in", alg: "RS256", use: "sig" }] }),
          }),
        ),
        (server) => Effect.sync(() => server.stop()),
      )
      const jwksURL = new URL(`http://localhost:${server.port}/jwks`)
      const sign = (nonce: string, audience: string, expires: number, key = keys.privateKey) =>
        new SignJWT({ nonce })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience(audience)
          .setSubject("user_123")
          .setExpirationTime(expires)
          .sign(key)
      const expires = Math.floor(Date.now() / 1000) + 60
      const valid = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires))
      yield* verifyIDToken(valid, "oaiapp_issued", "expected", jwksURL)
      const missingSubject = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(missingSubject, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(
        Error,
      )
      const blankSubject = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setSubject(" ")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(blankSubject, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(
        Error,
      )
      expect(yield* Effect.flip(verifyIDToken(valid, "oaiapp_issued", "wrong", jwksURL))).toBeInstanceOf(Error)
      expect(yield* Effect.flip(verifyIDToken(valid, "wrong-client", "expected", jwksURL))).toBeInstanceOf(Error)
      const wrongIssuer = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://someone-else.example")
          .setAudience("oaiapp_issued")
          .setSubject("user_123")
          .setExpirationTime(expires)
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(wrongIssuer, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const noExpiry = yield* Effect.promise(() =>
        new SignJWT({ nonce: "expected" })
          .setProtectedHeader({ alg: "RS256", kid: "sign-in" })
          .setIssuer("https://auth.openai.com")
          .setAudience("oaiapp_issued")
          .setSubject("user_123")
          .sign(keys.privateKey),
      )
      expect(yield* Effect.flip(verifyIDToken(noExpiry, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const expired = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires - 120))
      expect(yield* Effect.flip(verifyIDToken(expired, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
      const other = yield* Effect.promise(() => generateKeyPair("RS256"))
      const forged = yield* Effect.promise(() => sign("expected", "oaiapp_issued", expires, other.privateKey))
      expect(yield* Effect.flip(verifyIDToken(forged, "oaiapp_issued", "expected", jwksURL))).toBeInstanceOf(Error)
    }),
  )

  it.effect("registers the ChatGPT OAuth method", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-token-sharing"),
          type: "oauth",
          label: "Sign in with ChatGPT",
        },
      ])
    }),
  )

  it.effect("keeps the Codex browser and headless methods alongside token sharing", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      yield* addLegacyPlugin()
      const integrations = yield* Integration.Service
      expect(
        (yield* integrations.get(Integration.ID.make("openai")))?.methods.map(
          (method) => method.type === "oauth" && method.id,
        ),
      ).toEqual([
        Integration.MethodID.make("chatgpt-token-sharing"),
        Integration.MethodID.make("chatgpt-browser"),
        Integration.MethodID.make("chatgpt-headless"),
      ])
    }),
  )

  for (const source of ["http", "stream"] as const) {
    it.effect(`stops retries for ChatGPT usage limits from ${source} failures`, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-token-sharing"),
            access: "chatgpt-token",
            refresh: "refresh",
            expires: Date.now() + 60 * 60_000,
            metadata: { clientID: "oaiapp_issued" },
          }),
        })
        yield* addPlugin()
        const hooks = yield* PluginHooks.Service
        const body =
          source === "http"
            ? JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } })
            : JSON.stringify({
                type: "response.failed",
                response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
              })
        const cause = new AIError({
          reason: new RateLimitError({
            message: "Rate limit exceeded",
            body,
            ...(source === "http"
              ? { http: new HttpContext({ url: "https://api.openai.com/v1/responses", status: 429, headers: {} }) }
              : {}),
          }),
        })
        const decide = yield* SessionRunnerRetry.policy(Session.ID.make("ses_usage_limit"))
        const input = {
          cause,
          error: toSessionError(cause),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          hook: (event: PluginHooks.Domains["session"]["retry"]) =>
            hooks.trigger("session", "retry", event).pipe(Effect.asVoid),
          retry: SessionRunnerRetry.isRetryable(cause),
        }
        expect(input.error.response?.body).toBe(body)
        expect(input.retry).toBe(true)
        expect(yield* decide(input)).toEqual({ retry: false, reason: "declined" })

        const other = new AIError({ reason: new RateLimitError({ message: "Rate limit exceeded", body: "{}" }) })
        expect(yield* decide({ ...input, cause: other, error: toSessionError(other) })).toMatchObject({ retry: true })
      }),
    )
  }

  it.effect("leaves API-key OpenAI retries alone", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "retry", {
        sessionID: Session.ID.make("ses_api_key_retry"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
        error: {
          type: "provider.rate-limit",
          message: "Rate limit exceeded",
          status: 429,
          response: { body: '{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}' },
        },
        attempt: 2,
        decision: { retry: true, delay: 1000 },
      })
      expect(event.decision).toEqual({ retry: true, delay: 1000 })
    }),
  )

  it.effect("stops deterministic ChatGPT stream failures while retrying temporary unavailability", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const decide = yield* SessionRunnerRetry.policy(Session.ID.make("ses_sharing_errors"))
      const cases = [
        ["subscription_sharing_user_not_eligible", false],
        ["subscription_sharing_unsupported_capability", false],
        ["subscription_sharing_route_not_supported", false],
        ["subscription_sharing_invalid_user", false],
        ["chatpass_v2_scope_not_authorized", false],
        ["chatpass_v2_invalid_authorization_context", false],
        ["subscription_sharing_usage_unavailable", true],
        ["subscription_sharing_user_unavailable", true],
      ] as const
      for (const [code, retry] of cases) {
        const cause = new AIError({
          reason: classifyProviderFailure({
            message: "Request failed",
            rawBody: JSON.stringify({ type: "response.failed", response: { error: { code } } }),
          }),
        })
        expect(SessionRunnerRetry.isRetryable(cause)).toBe(true)
        const decision = yield* decide({
          cause,
          error: toSessionError(cause),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
          hook: (event) => hooks.trigger("session", "retry", event).pipe(Effect.asVoid),
          retry: true,
        })
        expect(decision.retry).toBe(retry)
      }
    }),
  )

  it.effect("registers a new ChatGPT agent on first sign-in with a loopback callback", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const url = yield* authorize()
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      expect(`${url.origin}${url.pathname}`).toBe("https://auth.openai.com/api/accounts/authorize")
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: "dynamic_agent_client",
        agent_name_hint: "AigcForge",
        response_type: "code",
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        resource: "https://api.openai.com/v1",
        code_challenge_method: "S256",
      })
      expect(url.searchParams.get("state")).toBeTruthy()
      expect(url.searchParams.get("nonce")).toBeTruthy()
      expect(url.searchParams.get("code_challenge")).toBeTruthy()
      const hostID = url.searchParams.get("ext_agent_host_id")
      expect(hostID).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      const kv = yield* KV.Service
      const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
      expect(yield* storage.get("chatgpt-agent-host-id")).toBe(hostID)
      expect((yield* authorize()).searchParams.get("ext_agent_host_id")).toBe(hostID)
      expect(redirect.hostname).toBe("127.0.0.1")
      expect(redirect.pathname).toBe("/auth/callback")
      expect(Number(redirect.port)).toBeGreaterThan(0)
    }),
  )

  it.live("waits to show browser success until the sign-in callback succeeds", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-token-sharing"),
      })
      const authorization = new URL(attempt.url)
      const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("code", "test-code")
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "")
      const response = yield* Effect.promise(() => fetch(callback))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("did not return a client ID")
    }),
  )

  it.effect("reauthorizes with the client ID issued to an existing ChatGPT connection", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const hostID = "urn:uuid:00000000-0000-4000-8000-000000000000"
      yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("chatgpt-agent-host-id", hostID)
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const url = yield* authorize()
      expect(url.searchParams.get("client_id")).toBe("oaiapp_issued")
      expect(url.searchParams.has("agent_name_hint")).toBe(false)
      expect(url.searchParams.get("ext_agent_host_id")).toBe(hostID)
      expect(new URL(url.searchParams.get("redirect_uri") ?? "").hostname).toBe("127.0.0.1")
    }),
  )

  it.live("rejects a reauthorization callback that returns a different client ID", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.oauth.connect({
        integrationID: Integration.ID.make("openai"),
        methodID: Integration.MethodID.make("chatgpt-token-sharing"),
      })
      const authorization = new URL(attempt.url)
      expect(authorization.searchParams.get("client_id")).toBe("oaiapp_issued")
      const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("code", "test-code")
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "")
      callback.searchParams.set("client_id", "oaiapp_other")
      const response = yield* Effect.promise(() => fetch(callback))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("different client")
      expect(yield* credentials.list(Integration.ID.make("openai"))).toHaveLength(1)
    }),
  )

  it.effect("moves only token-sharing credentials to the new method ID and caches their saved models", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const legacy = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "codex-token",
          refresh: "codex-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      const snapshot = [
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          visibility: "list",
          supported_in_api: true,
          context_window: 272_000,
          input_modalities: ["text"],
        },
      ]
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued", models: snapshot },
        }),
      })

      yield* addPlugin()
      expect((yield* credentials.get(legacy.id))?.value).toMatchObject({ methodID: "chatgpt-browser" })
      expect((yield* credentials.get(sharing.id))?.value).toMatchObject({
        methodID: "chatgpt-token-sharing",
        access: "sharing-token",
        metadata: { clientID: "oaiapp_issued" },
      })
      expect(yield* PluginHost.storage(kv, ChatGPTPlugin.id).get("models:oaiapp_issued")).toEqual(snapshot)
    }),
  )

  // it.effect("merges account models with catalog metadata and leaves input budgeting to compaction", () =>
  //   Effect.gen(function* () {
  //     const catalog = yield* Provider.Service
  //     const models = yield* Model.Service
  //     const credentials = yield* Credential.Service
  //     const kv = yield* KV.Service
  //     yield* catalog.transform((editor) => {
  //       editor.update(Provider.ID.openai, (provider) => {
  //         provider.package = "@aigcfroge/ai/providers/openai"
  //       })
  //       editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6-sol"), (model) => {
  //         model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
  //         model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
  //         model.variants = [
  //           { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
  //           { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
  //         ]
  //       })
  //       editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
  //     })
  //     yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("models:oaiapp_issued", [
  //       {
  //         slug: "gpt-5.6-sol",
  //         display_name: "GPT-5.6-Sol",
  //         visibility: "list",
  //         supported_in_api: true,
  //         context_window: 272_000,
  //         input_modalities: ["text", "image"],
  //         supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
  //       },
  //       {
  //         slug: "gpt-6-future",
  //         display_name: "GPT-6-Future",
  //         visibility: "list",
  //         supported_in_api: true,
  //         context_window: 272_000,
  //         input_modalities: ["text"],
  //         supported_reasoning_levels: [],
  //       },
  //     ])
  //     yield* credentials.create({
  //       integrationID: Integration.ID.make("openai"),
  //       value: Credential.OAuth.make({
  //         type: "oauth",
  //         methodID: Integration.MethodID.make("chatgpt-token-sharing"),
  //         access: "chatgpt-token",
  //         refresh: "refresh",
  //         expires: Date.now() + 60 * 60_000,
  //         metadata: { clientID: "oaiapp_issued" },
  //       }),
  //     })
  //     yield* addPlugin()
  //
  //     const available = (yield* models.available()).filter((model) => model.providerID === Provider.ID.openai)
  //     expect(available.map((model) => model.id).sort()).toEqual([
  //       Model.ID.make("gpt-5.6-sol"),
  //       Model.ID.make("gpt-6-future"),
  //     ])
  //     const sol = required(available.find((model) => model.id === "gpt-5.6-sol"))
  //     expect(sol.name).toBe("GPT-5.6-Sol")
  //     expect(sol.capabilities.input).toEqual(["text", "image"])
  //     expect(sol.variants.map((variant) => variant.id)).toEqual([
  //       Model.VariantID.make("low"),
  //       Model.VariantID.make("ultra"),
  //     ])
  //     expect(sol.limit).toEqual({ context: 272_000, output: 128_000 })
  //     expect(sol.cost).toEqual([])
  //     expect(sol.settings?.compaction).toEqual({ type: "summary" })
  //     const future = required(available.find((model) => model.id === "gpt-6-future"))
  //     expect(future.name).toBe("GPT-6-Future")
  //     expect(future.package).toBe("@aigcfroge/ai/providers/openai")
  //     expect(future.limit).toEqual({ context: 272_000, output: 32_000 })
  //   }),
  // )
  //
  // it.live("shows catalog models while account models refresh in the background and saves them to KV", () =>
  //   Effect.gen(function* () {
  //     const catalog = yield* Provider.Service
  //     const models = yield* Model.Service
  //     const credentials = yield* Credential.Service
  //     const kv = yield* KV.Service
  //     yield* catalog.transform((editor) => {
  //       editor.update(Provider.ID.openai, (provider) => {
  //         provider.package = "@aigcfroge/ai/providers/openai"
  //       })
  //       for (const id of ["gpt-5.5", "gpt-6-astra", "gpt-6-sol"])
  //         editor.models.update(Provider.ID.openai, Model.ID.make(id), () => {})
  //     })
  //     const requested = yield* Deferred.make<void>()
  //     const release = yield* Deferred.make<void>()
  //     const remote = [
  //       {
  //         slug: "gpt-6-future",
  //         display_name: "GPT-6-Future",
  //         visibility: "list",
  //         supported_in_api: true,
  //         context_window: 272_000,
  //         input_modalities: ["text"],
  //       },
  //     ]
  //     const http = HttpClient.make((request) =>
  //       Effect.gen(function* () {
  //         expect(request.url).toBe("https://api.openai.com/v1/models")
  //         expect(request.headers.authorization).toBe("Bearer chatgpt-token")
  //         yield* Deferred.succeed(requested, undefined)
  //         yield* Deferred.await(release)
  //         return HttpClientResponse.fromWeb(request, Response.json({ models: remote }))
  //       }),
  //     )
  //     yield* addPlugin(http)
  //     yield* credentials.create({
  //       integrationID: Integration.ID.make("openai"),
  //       value: Credential.OAuth.make({
  //         type: "oauth",
  //         methodID: Integration.MethodID.make("chatgpt-token-sharing"),
  //         access: "chatgpt-token",
  //         refresh: "refresh",
  //         expires: Date.now() + 60 * 60_000,
  //         metadata: { clientID: "oaiapp_issued" },
  //       }),
  //     })
  //     yield* Deferred.await(requested).pipe(Effect.timeout("2 seconds"))
  //     expect((yield* models.available()).filter((model) => model.providerID === Provider.ID.openai).map((model) => model.id)).toEqual([
  //       Model.ID.make("gpt-5.5"),
  //       Model.ID.make("gpt-6-astra"),
  //     ])
  //     const storage = PluginHost.storage(kv, ChatGPTPlugin.id)
  //     expect(yield* storage.get("models:oaiapp_issued")).toBeUndefined()
  //
  //     yield* Deferred.succeed(release, undefined)
  //     const available = yield* models.available().pipe(
  //       Effect.repeat({
  //         until: (current) => current.some((model) => model.providerID === Provider.ID.openai && model.id === "gpt-6-future"),
  //         schedule: Schedule.spaced("10 millis"),
  //       }),
  //       Effect.timeout("2 seconds"),
  //     )
  //     expect(available.filter((model) => model.providerID === Provider.ID.openai).map((model) => model.id)).toEqual([
  //       Model.ID.make("gpt-6-future"),
  //     ])
  //     expect(yield* storage.get("models:oaiapp_issued")).toEqual(remote)
  //   }),
  // )

  it.effect("routes ChatGPT over HTTP with only the listed catalog fallback models", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, (draft) => {
          draft.package = "@aigcfroge/ai/providers/openai"
          draft.settings = { transport: "websocket" }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: {
                read: Money.USDPerMillionTokens.make(0.1),
                write: Money.USDPerMillionTokens.zero,
              },
            },
          ]
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5-pro"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.4"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 64_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.4-pro"), (model) => {
          model.modelID = Model.ID.make("gpt-5.4")
          model.body = { reasoning: { mode: "pro" } }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.1"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-6-astra"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.10"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.04-astra"), () => {})
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.99"), () => {})
        for (const id of [
          "gpt-5.5-fast",
          "gpt-5.6-luna",
          "gpt-5.6-luna-fast",
          "gpt-5.6-sol-fast",
          "gpt-5.6-terra",
          "gpt-5.6-terra-fast",
          "gpt-6-astra-fast",
          "gpt-6-luna",
          "gpt-6-luna-fast",
          "gpt-6-sol",
          "gpt-6-sol-fast",
          "gpt-6.1-sol",
          "gpt-6.1-sol-fast",
        ])
          catalog.models.update(Provider.ID.openai, Model.ID.make(id), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
        }),
      })
      yield* addPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      expect(provider.package).toBe("@aigcfroge/ai/providers/openai")
      expect(provider.settings?.transport).toBe("http")
      expect(provider.settings?.baseURL).toBe("https://api.openai.com/v1")
      expect(provider.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.headers).toEqual({
        "session-id": "ses_test",
        "thread-id": "ses_test",
        "x-client-request-id": "ses_test",
      })
      expect(direct.hasHttpHooks).toBe(false)
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const parent = yield* sessions.create({ location: { directory: location.directory } })
      const child = yield* sessions.create({ parentID: parent.id })
      expect((yield* request(Provider.ID.openai, "https://api.openai.com/v1", child.id)).headers).toEqual({
        "session-id": parent.id,
        "thread-id": child.id,
        "x-client-request-id": child.id,
      })
      const eligible = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(eligible.package).toBe("@aigcfroge/ai/providers/openai")
      expect(eligible.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(eligible.cost).toEqual([])
      expect(eligible.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(eligible.enabled).toBe(true)
      const gpt56 = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.6-sol")))
      expect(gpt56.enabled).toBe(true)
      expect(gpt56.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-6-astra"))).enabled).toBe(true)
      for (const id of [
        "gpt-5.5-pro",
        "gpt-5.4-pro",
        "gpt-5.4",
        "gpt-5.6",
        "gpt-4.1",
        "gpt-5.10",
        "gpt-5",
        "gpt-5.04-astra",
        "gpt-4.99",
      ])
        expect(yield* models.get(Provider.ID.openai, Model.ID.make(id))).toBeUndefined()
      expect(
        (yield* models.available())
          .filter((model) => model.providerID === Provider.ID.openai)
          .map((model) => model.id)
          .sort(),
      ).toEqual(
        [
          "gpt-5.5",
          "gpt-5.5-fast",
          "gpt-5.6-luna",
          "gpt-5.6-luna-fast",
          "gpt-5.6-sol",
          "gpt-5.6-sol-fast",
          "gpt-5.6-terra",
          "gpt-5.6-terra-fast",
          "gpt-6-astra",
          "gpt-6-astra-fast",
          "gpt-6-luna",
          "gpt-6-luna-fast",
          "gpt-6-sol",
          "gpt-6-sol-fast",
          "gpt-6.1-sol",
          "gpt-6.1-sol-fast",
        ].map((id) => Model.ID.make(id)),
      )
    }),
  )

  it.effect("keeps the full OpenAI catalog under an API key connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, (draft) => {
          draft.package = "@aigcfroge/ai/providers/openai"
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.models.update(Provider.ID.openai, Model.ID.make("gpt-4.1"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      yield* addLegacyPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.get(Provider.ID.openai))
      const model = required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(model.package).toBe("@aigcfroge/ai/providers/openai")
      expect(model.enabled).toBe(true)
      expect(model.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(provider.settings?.transport).toBe("websocket")
      expect(model.settings?.transport).toBeUndefined()
      expect(direct.baseURL).toBe("https://api.openai.com/v1")
      expect(direct.headers).toEqual({})
      expect(direct.hasHttpHooks).toBe(false)
      expect(provider.headers).not.toHaveProperty("x-openai-chatpass-test")
      expect(required(yield* models.get(Provider.ID.openai, Model.ID.make("gpt-4.1"))).enabled).toBe(true)
    }),
  )

  it.live("switches between token-sharing and Codex credentials without mixing their routes", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      yield* catalog.transform((editor) => {
        editor.update(Provider.ID.openai, (provider) => {
          provider.package = "@aigcfroge/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
      })
      const legacy = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "codex-token",
          refresh: "codex-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("models:oaiapp_issued", [
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          visibility: "list",
          supported_in_api: true,
          context_window: 272_000,
          input_modalities: ["text"],
        },
      ])
      const sharing = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 60 * 60_000,
          metadata: { clientID: "oaiapp_issued" },
        }),
      })
      yield* addPlugin()
      yield* addLegacyPlugin()
      expect((yield* catalog.get(Provider.ID.openai))?.settings?.baseURL).toBe("https://api.openai.com/v1")

      yield* credentials.activate(legacy.id)
      const codex = yield* catalog.get(Provider.ID.openai).pipe(
        Effect.repeat({
          until: (item) => item?.settings?.baseURL === "https://chatgpt.com/backend-api/codex",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("2 seconds"),
      )
      expect(codex?.headers?.["chatgpt-account-id"]).toBe("acct_123")

      yield* credentials.activate(sharing.id)
      const direct = yield* catalog.get(Provider.ID.openai).pipe(
        Effect.repeat({
          until: (item) => item?.settings?.baseURL === "https://api.openai.com/v1",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("2 seconds"),
      )
      expect(direct?.settings?.transport).toBe("http")
      expect(direct?.headers?.["chatgpt-account-id"]).toBeUndefined()
    }),
  )

  it.live(
    "resolves an inactive token-sharing account through its own builtin catalog and route without switching Codex",
    () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const integrations = yield* Integration.Service
        const hooks = yield* PluginHooks.Service
        const resolver = yield* ModelResolver.Service
        const legacyID = Model.ID.make("codex-picker")
        const sharingID = Model.ID.make("sharing-picker")
        yield* catalog.transform((editor) => {
          editor.update(Provider.ID.openai, (provider) => {
            provider.package = "@aigcfroge/ai/providers/openai"
          })
          editor.models.update(Provider.ID.openai, legacyID, (model) => {
            model.modelID = Model.ID.make("gpt-5.5")
          })
          editor.models.update(Provider.ID.openai, sharingID, (model) => {
            model.modelID = Model.ID.make("gpt-6.1-sol")
          })
        })
        const codex = yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-browser"),
            access: "codex-account-a",
            refresh: "codex-refresh-a",
            expires: Date.now() + 3_600_000,
            metadata: { accountID: "account-a" },
          }),
        })
        const sharing = yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          activate: false,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-token-sharing"),
            access: "sharing-account-b",
            refresh: "sharing-refresh-b",
            expires: Date.now() + 3_600_000,
            metadata: { clientID: "client-b", scopes: ["chatgpt.tokens.use.direct"] },
          }),
        })
        const connectionA = { type: "credential" as const, id: codex.id }
        const connectionB = { type: "credential" as const, id: sharing.id }
        const directoryRequests: Array<{ url: string; authorization?: string }> = []
        const http = HttpClient.make((request) =>
          Effect.sync(() => {
            directoryRequests.push({ url: request.url, authorization: request.headers.authorization })
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                models: [
                  {
                    slug: "gpt-6.1-sol",
                    display_name: "Account B Sol",
                    visibility: "list",
                    supported_in_api: true,
                    context_window: 31_000,
                    input_modalities: ["text"],
                    supported_reasoning_levels: [{ effort: "low" }],
                  },
                ],
              }),
            )
          }),
        )
        yield* addLegacyPlugin()
        yield* addPlugin(http)
        const modelB = yield* pollWithTimeout(
          models
            .get(Provider.ID.openai, sharingID, connectionB)
            .pipe(Effect.map((model) => (model?.limit.context === 31_000 ? model : undefined))),
          "Inactive token-sharing account did not publish its own model directory",
        )
        const modelA = required(yield* models.get(Provider.ID.openai, legacyID, connectionA))
        expect(yield* integrations.connection.active(Integration.ID.make("openai"))).toMatchObject(connectionA)
        expect(directoryRequests).toEqual([
          { url: "https://api.openai.com/v1/models", authorization: "Bearer sharing-account-b" },
        ])
        expect(yield* models.get(Provider.ID.openai, legacyID, connectionB)).toBeUndefined()
        expect(String(modelB.modelID)).toBe("gpt-6.1-sol")
        expect(modelB.capabilities.input).toEqual(["text"])
        expect(modelA.limit.context).toBe(400_000)
        const sourceB = (yield* catalog.snapshot({
          providerID: Provider.ID.openai,
          connection: connectionB,
        })).available.find((source) => source.provider.id === Provider.ID.openai)
        expect(sourceB?.sourceConnection).toMatchObject(connectionB)
        yield* models.transform((editor) => {
          editor.update(Provider.ID.openai, sharingID, (model) => {
            model.name = "Curated account B"
          })
        })
        const resolvedA = yield* resolver.resolveModel(modelA, undefined, connectionA)
        const resolvedB = yield* resolver.resolveModel(modelB, undefined, connectionB)
        expect(resolvedA.model.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
        expect(resolvedB.model.route.endpoint.baseURL).toBe("https://api.openai.com/v1")
        expect(resolvedB.ref).toMatchObject({ id: sharingID, providerID: Provider.ID.openai })
        expect(resolvedB.connection).toEqual(connectionB)
        expect(required(yield* models.get(Provider.ID.openai, sharingID, connectionB)).name).toBe("Curated account B")
        for (const [resolved, token, apiID] of [
          [resolvedA, "codex-account-a", "gpt-5.5"],
          [resolvedB, "sharing-account-b", "gpt-6.1-sol"],
        ] as const) {
          const request = LLM.request({ model: resolved.model, messages: [Message.user("fixture")] })
          const compiled = yield* compileRequest(request)
          expect(compiled.body).toMatchObject({ model: apiID })
          const url = String(resolved.model.route.endpoint.baseURL)
          expect(
            (yield* resolved.model.route.auth.apply({
              request,
              method: "POST",
              url,
              body: JSON.stringify(compiled.body),
              headers: HttpClientRequest.post(url).headers,
            })).authorization,
          ).toBe(`Bearer ${token}`)
        }
        const requestA = yield* hooks.trigger("session", "model.request", {
          sessionID: Session.ID.make("ses_builtin_a"),
          agent: Agent.ID.make("build"),
          kind: "primary",
          model: resolvedA.ref,
          connection: connectionA,
          baseURL: "https://api.openai.com/v1",
          headers: {},
        })
        const requestB = yield* hooks.trigger("session", "model.request", {
          sessionID: Session.ID.make("ses_builtin_b"),
          agent: Agent.ID.make("build"),
          kind: "primary",
          model: resolvedB.ref,
          connection: connectionB,
          baseURL: "https://api.openai.com/v1",
          headers: {},
        })
        expect(requestA.baseURL).toBe("https://chatgpt.com/backend-api/codex")
        expect(requestA.headers.originator).toBe("aigcfroge")
        expect(requestB.baseURL).toBe("https://api.openai.com/v1")
        expect(requestB.headers).toEqual({
          "session-id": "ses_builtin_b",
          "thread-id": "ses_builtin_b",
          "x-client-request-id": "ses_builtin_b",
        })
        expect(yield* integrations.connection.active(Integration.ID.make("openai"))).toMatchObject(connectionA)
      }).pipe(Effect.provide(ModelResolver.layer)),
  )

  it.effect(
    "reads Codex quota only on demand for its connection and keeps expired successful facts after a failed refresh",
    () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const integrations = yield* Integration.Service
        const hooks = yield* PluginHooks.Service
        const id = Model.ID.make("gpt-5.5")
        yield* providers.transform((editor) => {
          editor.update(Provider.ID.openai, (provider) => {
            provider.package = "@aigcfroge/ai/providers/openai"
          })
          editor.models.update(Provider.ID.openai, id, () => {})
        })
        const accountA = yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-browser"),
            access: "codex-a",
            refresh: "refresh-a",
            expires: Date.now() + 3_600_000,
            metadata: { accountID: "account-a" },
          }),
        })
        const accountB = yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          activate: false,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-browser"),
            access: "codex-b",
            refresh: "refresh-b",
            expires: Date.now() + 3_600_000,
            metadata: { accountID: "account-b" },
          }),
        })
        const connectionA = { type: "credential" as const, id: accountA.id }
        const connectionB = { type: "credential" as const, id: accountB.id }
        const reads: Array<{ url: string; authorization?: string; account?: string }> = []
        let status = 200
        const http = HttpClient.make((request) =>
          Effect.sync(() => {
            reads.push({
              url: request.url,
              authorization: request.headers.authorization,
              account: request.headers["chatgpt-account-id"],
            })
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  plan_type: "free",
                  rate_limit: {
                    allowed: true,
                    primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_after_seconds: 600 },
                  },
                  credits: { balance: "3.5", unlimited: false },
                },
                { status },
              ),
            )
          }),
        )
        yield* addLegacyPlugin(http)
        yield* models.available({ providerID: Provider.ID.openai, connection: connectionB })
        yield* hooks.trigger("session", "model.request", {
          sessionID: Session.ID.make("ses_quota"),
          agent: Agent.ID.make("build"),
          kind: "primary",
          model: Model.Ref.make({ providerID: Provider.ID.openai, id }),
          connection: connectionB,
          headers: {},
        })
        expect(reads).toEqual([])
        const input = {
          sessionID: Session.ID.make("ses_quota"),
          model: Model.Ref.make({ providerID: Provider.ID.openai, id }),
          connection: connectionB,
        }
        const observed = yield* Effect.all(
          [hooks.trigger("session", "model.quota", input), hooks.trigger("session", "model.quota", { ...input })],
          { concurrency: "unbounded" },
        )
        expect(reads).toEqual([
          { url: "https://chatgpt.com/backend-api/wham/usage", authorization: "Bearer codex-b", account: "account-b" },
        ])
        expect(observed[0].quota).toMatchObject({
          status: "known",
          source: "openai-codex",
          connection: connectionB,
          observedAt: 0,
          freshUntil: 300_000,
          plan: "free",
          freePlan: true,
          allowed: true,
          credits: { balance: 3.5, unlimited: false },
        })
        expect(observed[1].quota).toEqual(observed[0].quota)
        expect(observed[0].quota?.windows).toEqual([
          {
            id: "primary",
            unit: "chatgpt-share",
            usedRatio: 0.25,
            resetAt: 600_000,
            spanMs: 18_000_000,
            scope: "account",
          },
        ])
        expect(required(yield* models.get(Provider.ID.openai, id, connectionB)).metadata?.quota).toEqual(
          observed[0].quota,
        )
        expect(required(yield* models.get(Provider.ID.openai, id, connectionA)).metadata?.quota).toBeUndefined()
        yield* TestClock.adjust(300_001)
        status = 503
        const stale = yield* hooks.trigger("session", "model.quota", { ...input })
        expect(reads).toHaveLength(2)
        expect(stale.quota).toMatchObject({
          status: "unknown",
          connection: connectionB,
          observedAt: 0,
          freshUntil: 300_000,
          reason: "transport",
          windows: [{ usedRatio: 0.25 }],
        })
        expect(required(yield* models.get(Provider.ID.openai, id, connectionB)).metadata?.quota).toEqual(stale.quota)
        expect((yield* hooks.trigger("session", "model.quota", { ...input })).quota).toEqual(stale.quota)
        expect(reads).toHaveLength(2)
        expect(yield* integrations.connection.active(Integration.ID.make("openai"))).toMatchObject(connectionA)
      }),
  )

  it.effect("keeps token-sharing quota unsupported without issuing a usage request", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const hooks = yield* PluginHooks.Service
      const id = Model.ID.make("gpt-5.5")
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.openai, (provider) => {
          provider.package = "@aigcfroge/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, id, () => {})
      })
      const entry = yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-token-sharing"),
          access: "sharing-token",
          refresh: "sharing-refresh",
          expires: Date.now() + 3_600_000,
          metadata: { clientID: "sharing-client", scopes: ["chatgpt.tokens.use.direct"] },
        }),
      })
      const connection = { type: "credential" as const, id: entry.id }
      const reads: string[] = []
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.sync(() => {
            reads.push(request.url)
            return HttpClientResponse.fromWeb(request, Response.json({}, { status: 503 }))
          }),
        ),
      )
      const observed = yield* hooks.trigger("session", "model.quota", {
        sessionID: Session.ID.make("ses_sharing_quota"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id }),
        connection,
      })
      expect(observed.quota).toEqual({
        status: "unsupported",
        source: "chatgpt-token-sharing",
        connection,
        reason: "unsupported",
        windows: [],
      })
      expect(required(yield* models.get(Provider.ID.openai, id, connection)).metadata?.quota).toEqual(observed.quota)
      expect(reads.filter((url) => !url.endsWith("/models"))).toEqual([])
    }),
  )

  it.effect("omits the default output limit from OpenAI steps and compaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      yield* addLegacyPlugin()
      const hooks = yield* PluginHooks.Service
      const maxTokens = (providerID: Provider.ID) =>
        Effect.gen(function* () {
          const draft = {
            sessionID: Session.ID.make("ses_test"),
            model: Model.Ref.make({ providerID, id: Model.ID.make("gpt-5.5") }),
            system: [],
            messages: [],
            options: { maxTokens: 128_000 },
          }
          const events = [
            yield* hooks.trigger("session", "context", { ...draft, agent: Agent.ID.make("build"), tools: {} }),
            yield* hooks.trigger("session", "compaction", { ...draft, agent: Agent.ID.make("build"), tools: {} }),
          ]
          return events.map((event) => event.options.maxTokens)
        })

      expect(yield* maxTokens(Provider.ID.openai)).toEqual([undefined, undefined])
      expect(yield* maxTokens(Provider.ID.azure)).toEqual([128_000, 128_000])
    }),
  )

  for (const connection of ["chatgpt", "key"] as const) {
    it.effect(`${connection} compaction uses plugin defaults but allows later model and variant overrides`, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const providerID = Provider.ID.openai
        const baseID = Model.ID.make("gpt-5.5")
        const modelID = Model.ID.make("gpt-5.6-sol")
        const variantID = Model.ID.make("gpt-6-astra")
        // const kv = yield* KV.Service
        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.package = "@aigcfroge/ai/providers/openai/responses"
          })
          for (const id of [baseID, modelID, variantID])
            editor.models.update(providerID, id, (model) => {
              model.modelID = baseID
            })
          editor.models.update(providerID, modelID, (model) => {
            model.settings = { compaction: { type: "native" } }
          })
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value:
            connection === "chatgpt"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("chatgpt-token-sharing"),
                  access: "chatgpt-token",
                  refresh: "refresh",
                  expires: Date.now() + 60_000,
                  metadata: { clientID: "oaiapp_issued" },
                })
              : Credential.Key.make({ type: "key", key: "sk-test" }),
        })
        // if (connection === "chatgpt")
        //   yield* PluginHost.storage(kv, ChatGPTPlugin.id).set("models:oaiapp_issued", [
        //     {
        //       slug: "gpt-5.5",
        //       display_name: "GPT-5.5",
        //       visibility: "list",
        //       supported_in_api: true,
        //       context_window: 272_000,
        //       input_modalities: ["text"],
        //     },
        //   ])
        yield* addPlugin()
        yield* addLegacyPlugin()
        const resolver = yield* ModelResolver.Service
        const resolve = (id: Model.ID, variant?: Model.VariantID) =>
          models.get(providerID, id).pipe(
            Effect.flatMap((model) => resolver.resolveModel(required(model), variant)),
            Effect.map((result) => result.compaction),
          )

        expect(yield* resolve(baseID)).toEqual(connection === "chatgpt" ? { type: "summary" } : undefined)
        expect(yield* resolve(modelID)).toEqual({ type: connection === "chatgpt" ? "summary" : "native" })

        // A later provider default does not override the ChatGPT model policy.
        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { compaction: { type: "native" } }
          })
        })
        expect(yield* resolve(baseID)).toEqual({ type: connection === "chatgpt" ? "summary" : "native" })

        yield* catalog.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { compaction: { type: "summary" } }
          })
        })
        yield* models.transform((editor) => {
          editor.update(providerID, modelID, (model) => {
            model.settings = { compaction: { type: "native" } }
          })
          editor.update(providerID, variantID, (model) => {
            model.settings = { compaction: { type: "summary" } }
            model.variants = [{ id: Model.VariantID.make("high"), settings: { compaction: { type: "native" } } }]
          })
        })
        expect(yield* resolve(baseID)).toEqual({ type: "summary" })
        expect(yield* resolve(modelID)).toEqual({ type: "native" })
        expect(yield* resolve(variantID, Model.VariantID.make("high"))).toEqual({ type: "native" })
      }).pipe(Effect.provide(ModelResolver.layer)),
    )
  }

  for (const connection of ["chatgpt", "key"] as const) {
    it.effect(`${connection} sends mid-session reasoning effort switches in a form its backend accepts`, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const models = yield* Model.Service
        const credentials = yield* Credential.Service
        const modelID = Model.ID.make("gpt-6.1-sol")
        yield* catalog.transform((editor) => {
          editor.update(Provider.ID.openai, (provider) => {
            provider.package = "@aigcfroge/ai/providers/openai"
          })
          editor.models.update(Provider.ID.openai, modelID, (model) => {
            model.variants = ["high", "max"].map((effort) => ({
              id: Model.VariantID.make(effort),
              settings: { reasoningEffort: effort },
            }))
          })
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("openai"),
          value:
            connection === "chatgpt"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("chatgpt-token-sharing"),
                  access: "chatgpt-token",
                  refresh: "refresh",
                  expires: Date.now() + 60_000,
                  metadata: { clientID: "oaiapp_issued" },
                })
              : Credential.Key.make({ type: "key", key: "sk-test" }),
        })
        yield* addPlugin()
        yield* addLegacyPlugin()
        const resolver = yield* ModelResolver.Service
        const model = required(yield* models.get(Provider.ID.openai, modelID))
        const body = (variant: string, messages: ReadonlyArray<Message>) =>
          resolver.resolveModel(model, Model.VariantID.make(variant)).pipe(
            Effect.flatMap((resolved) => compileRequest(LLM.request({ model: resolved.model, messages }))),
            Effect.map((compiled) => compiled.body),
          )
        const switched = [
          Message.user("a"),
          Message.assistant("b"),
          Message.effort({ effort: "max", previous: "high" }),
          Message.user("c"),
        ]
        const switchedBack = [
          ...switched,
          Message.assistant("d"),
          Message.effort({ effort: "high", previous: "max" }),
          Message.user("e"),
        ]
        const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] })
        const assistant = (text: string) => ({ role: "assistant", content: [{ type: "output_text", text }] })
        const update = (effort: string) => ({ type: "configuration_update", reasoning: { effort } })

        expect([yield* body("max", switched), yield* body("high", switchedBack)]).toMatchObject(
          {
            chatgpt: [
              { reasoning: { effort: "max" }, input: [user("a"), assistant("b"), user("c")] },
              {
                reasoning: { effort: "high" },
                input: [user("a"), assistant("b"), user("c"), assistant("d"), user("e")],
              },
            ],
            key: [
              { reasoning: { effort: "high" }, input: [user("a"), assistant("b"), update("max"), user("c")] },
              {
                reasoning: { effort: "high" },
                input: [user("a"), assistant("b"), update("max"), user("c"), assistant("d"), update("high"), user("e")],
              },
            ],
          }[connection],
        )
      }).pipe(Effect.provide(ModelResolver.layer)),
    )
  }

  it.effect("selects WebSocket only from explicit policy", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      yield* addGithubCopilotPlugin()
      const executor = { execute: () => Effect.die("unused WebSocket execution") }
      const transport = SessionModelTransport.Service.of({
        bind: () => executor,
        close: () => Effect.void,
        closeAll: Effect.void,
      })
      const sessionID = Session.ID.make("ses_websocket_hooks")
      const agentID = Agent.ID.make("build")
      const route = OpenAIResponses.route.with({
        id: "deployment-responses",
        provider: Provider.ID.azure,
      })
      const prepare = (preference?: Provider.Transport) =>
        Effect.gen(function* () {
          const model = SessionRunnerModel.resolved(route.model({ id: "gpt-5.5" }), {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: [],
            limit: { context: 200_000, output: 32_000 },
            transport: preference,
          })
          const requests = yield* SessionModelRequest.Service
          return yield* requests.primary({
            session: Session.Info.make({
              id: sessionID,
              projectID: Project.ID.global,
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
              location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            }),
            agent: agentID,
            model,
            tools: { definitions: [], catalog: [], execute: () => Effect.die("unused tool execution") },
            system: [],
            messages: [],
            webSocket: "session",
          })
        }).pipe(
          Effect.provide(SessionModelRequest.layer),
          Effect.provideService(SessionModelTransport.Service, transport),
        )

      const prepared = yield* prepare("websocket")
      const defaulted = yield* prepare()
      const disabled = yield* prepare("http")

      expect(prepared.options.webSocket).toBe(executor)
      expect(prepared.options.http).toBeUndefined()
      expect(defaulted.options.webSocket).toBeUndefined()
      expect(disabled.options.webSocket).toBeUndefined()
    }),
  )
})
