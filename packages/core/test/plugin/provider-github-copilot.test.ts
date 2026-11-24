import { AISDK } from "@omnixa/core/aisdk"
import { App } from "@omnixa/core/app"
import { Agent } from "@omnixa/schema/agent"
import { Session } from "@omnixa/core/session"
import { Location } from "@omnixa/core/location"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Model } from "@omnixa/core/model"
import { ModelResolver } from "@omnixa/core/model-resolver"
import { Plugin } from "@omnixa/core/plugin"
import { PluginHost } from "@omnixa/core/plugin/host"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import {
  copilotBaseURL,
  copilotEntitlementError,
  copilotFetch,
  GithubCopilotPlugin,
  utilityTitle,
} from "@omnixa/core/plugin/provider/github-copilot"
import { LLM, Message, SystemPart } from "@omnixa/ai"
import { compileRequest } from "@omnixa/ai/route/client"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Provider } from "@omnixa/core/provider"
import { Integration } from "@omnixa/core/integration"
import { Credential } from "@omnixa/core/credential"
import { isRecord } from "@omnixa/core/util/record"
import type { SessionRequestKind } from "@omnixa/plugin/effect/session"
import { fakeSelectorSdk } from "../fixture/selector"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (http?: HttpClient.HttpClient) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const effect = GithubCopilotPlugin.effect(host)
  yield* http ? effect.pipe(Effect.provideService(HttpClient.HttpClient, http)) : effect
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const sessions = Effect.fn(function* () {
  const service = yield* Session.Service
  const location = yield* Location.Service
  const parent = yield* service.create({ location: { directory: location.directory } })
  const child = yield* service.create({ parentID: parent.id })
  return { parent: parent.id, child: child.id }
})

const modelRequest = Effect.fn(function* (sessionID: Session.ID, kind: SessionRequestKind, agent = "build") {
  const hooks = yield* PluginHooks.Service
  return yield* hooks.trigger("session", "model.request", {
    sessionID,
    agent: Agent.ID.make(agent),
    model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("gpt-5.4") }),
    kind,
    headers: {},
  })
})

describe("GithubCopilotPlugin", () => {
  test("prefers the account-specific Copilot API endpoint", () => {
    expect(
      copilotBaseURL({
        enterpriseUrl: "company.ghe.com",
        apiEndpoint: "https://api.business.githubcopilot.com",
      }),
    ).toBe("https://api.business.githubcopilot.com")
  })

  test("rejects accounts without Copilot chat access", () => {
    expect(copilotEntitlementError({ chat_enabled: false, can_signup_for_limited: true })).toContain("Copilot Free")
    expect(copilotEntitlementError({ chat_enabled: false, can_signup_for_limited: false })).toContain(
      "subscription or a seat",
    )
    expect(copilotEntitlementError({ chat_enabled: false })).toContain("subscription or a seat")
  })

  test("only blocks on an explicit entitlement denial", () => {
    expect(copilotEntitlementError({ chat_enabled: true })).toBeUndefined()
    expect(copilotEntitlementError({ chat_enabled: true, can_signup_for_limited: true })).toBeUndefined()
    expect(copilotEntitlementError({})).toBeUndefined()
  })

  it.live("keeps inactive Copilot catalogs, API IDs, endpoints, and utility titles bound to their own connection", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const resolver = yield* ModelResolver.Service
      const hooks = yield* PluginHooks.Service
      const directoryRequests: Array<{ path: string; authorization: string | null }> = []
      const titleRequests: Array<{ path: string; authorization: string | null; model: unknown }> = []
      const running = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (request) => {
              const path = new URL(request.url).pathname
              const account = path.startsWith("/account-a/") ? "a" : "b"
              if (path.endsWith("/models")) {
                directoryRequests.push({ path, authorization: request.headers.get("authorization") })
                return Response.json({
                  data: [
                    {
                      id: `claude-${account}`,
                      name: `Account ${account} Claude`,
                      version: "2026-11-15",
                      model_picker_enabled: true,
                      supported_endpoints: ["/v1/messages"],
                      capabilities: {
                        family: "claude",
                        limits: {
                          max_context_window_tokens: account === "a" ? 12_000 : 22_000,
                          max_prompt_tokens: 10_000,
                          max_output_tokens: 2_000,
                        },
                        supports: { tool_calls: account === "a", vision: account === "a" },
                      },
                    },
                    {
                      id: "gpt-4o-mini",
                      name: "Utility",
                      version: "2026-11-15",
                      model_picker_enabled: true,
                      supported_endpoints: ["/chat/completions"],
                      capabilities: {
                        family: "gpt",
                        limits: {
                          max_context_window_tokens: 12_000,
                          max_prompt_tokens: 10_000,
                          max_output_tokens: 2_000,
                        },
                        supports: { tool_calls: true },
                      },
                    },
                  ],
                })
              }
              if (path.endsWith("/chat/completions")) {
                const body = await request.json()
                if (!isRecord(body)) throw new TypeError("Expected model request object")
                titleRequests.push({ path, authorization: request.headers.get("authorization"), model: body.model })
                return Response.json({ choices: [{ message: { content: `Account ${account} title` } }] })
              }
              return new Response(null, { status: 404 })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const baseURL = `http://127.0.0.1:${running.port}`
      const pickerA = Model.ID.make("picker-a")
      const pickerB = Model.ID.make("picker-b")
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, () => {})
        editor.models.update(Provider.ID.githubCopilot, pickerA, (model) => {
          model.modelID = Model.ID.make("claude-a")
        })
        editor.models.update(Provider.ID.githubCopilot, pickerB, (model) => {
          model.modelID = Model.ID.make("claude-b")
        })
      })
      const accountA = yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "copilot-a",
          refresh: "copilot-a",
          expires: 0,
          metadata: { apiEndpoint: `${baseURL}/account-a` },
        }),
      })
      const accountB = yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        activate: false,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "copilot-b",
          refresh: "copilot-b",
          expires: 0,
          metadata: { apiEndpoint: `${baseURL}/account-b` },
        }),
      })
      const connectionA = { type: "credential" as const, id: accountA.id }
      const connectionB = { type: "credential" as const, id: accountB.id }
      yield* addPlugin()
      const modelB = yield* pollWithTimeout(
        models
          .get(Provider.ID.githubCopilot, pickerB, connectionB)
          .pipe(Effect.map((model) => (model?.settings?.baseURL === `${baseURL}/account-b/v1` ? model : undefined))),
        "Inactive Copilot account did not publish its own model directory",
      )
      const modelA = required(yield* models.get(Provider.ID.githubCopilot, pickerA, connectionA))
      expect(yield* integrations.connection.active(Integration.ID.make("github-copilot"))).toMatchObject(connectionA)
      expect(directoryRequests.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
        { path: "/account-a/models", authorization: "Bearer copilot-a" },
        { path: "/account-b/models", authorization: "Bearer copilot-b" },
      ])
      expect(yield* models.get(Provider.ID.githubCopilot, pickerA, connectionB)).toBeUndefined()
      expect(yield* models.get(Provider.ID.githubCopilot, pickerB, connectionA)).toBeUndefined()
      expect(modelA.capabilities.tools).toBe(true)
      expect(modelB.capabilities.tools).toBe(false)
      expect(modelB.limit.context).toBe(22_000)
      expect(
        (yield* providers.snapshot({ providerID: Provider.ID.githubCopilot, connection: connectionB })).available.find(
          (source) => source.provider.id === Provider.ID.githubCopilot,
        )?.sourceConnection,
      ).toMatchObject(connectionB)
      yield* models.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, pickerB, (model) => {
          model.name = "Curated Copilot B"
        })
      })
      for (const [model, connection, account] of [
        [modelA, connectionA, "a"],
        [modelB, connectionB, "b"],
      ] as const) {
        const resolved = yield* resolver.resolveModel(model, undefined, connection)
        expect(resolved.connection).toEqual(connection)
        expect(resolved.model.route.endpoint.baseURL).toBe(`${baseURL}/account-${account}/v1`)
        const request = LLM.request({ model: resolved.model, messages: [Message.user("fixture")] })
        const compiled = yield* compileRequest(request)
        expect(compiled.body).toMatchObject({ model: `claude-${account}` })
        const url = `${baseURL}/account-${account}/v1/messages`
        const authentication = yield* resolved.model.route.auth.apply({
          request,
          method: "POST",
          url,
          body: JSON.stringify(compiled.body),
          headers: HttpClientRequest.post(url).headers,
        })
        const event = yield* hooks.trigger("session", "http.request", {
          sessionID: Session.ID.make(`ses_copilot_${account}`),
          agent: Agent.ID.make("build"),
          model: resolved.ref,
          kind: "primary",
          request: new Request(url, { method: "POST", headers: authentication, body: JSON.stringify(compiled.body) }),
        })
        expect(event.request.headers.get("authorization")).toBe(`Bearer copilot-${account}`)
        expect(event.request.headers.has("x-api-key")).toBe(false)
      }
      const title = yield* hooks.trigger("session", "title", {
        sessionID: Session.ID.make("ses_copilot_title"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: pickerB }),
        connection: connectionB,
        system: [],
        messages: [Message.user("fixture title")],
        options: {},
      })
      expect(title.result).toBe("Account b title")
      expect(titleRequests).toEqual([
        { path: "/account-b/chat/completions", authorization: "Bearer copilot-b", model: "gpt-4o-mini" },
      ])
      expect(required(yield* models.get(Provider.ID.githubCopilot, pickerB, connectionB)).name).toBe(
        "Curated Copilot B",
      )
      expect(yield* integrations.connection.active(Integration.ID.make("github-copilot"))).toMatchObject(connectionA)
    }).pipe(Effect.provide(ModelResolver.layer)),
  )

  it.live("reads Copilot quota only on demand from the OAuth user API and scopes premium facts to the API model", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const hooks = yield* PluginHooks.Service
      const running = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () =>
              Response.json({
                data: [
                  ...[
                    ["premium-api", 1],
                    ["free-api", 0],
                  ].map(([id, multiplier]) => ({
                    id,
                    name: String(id),
                    version: "2026-11-15",
                    model_picker_enabled: true,
                    supported_endpoints: ["/v1/messages"],
                    billing: { multiplier },
                    capabilities: {
                      family: "claude",
                      limits: {
                        max_context_window_tokens: 20_000,
                        max_prompt_tokens: 18_000,
                        max_output_tokens: 2_000,
                      },
                      supports: { tool_calls: true },
                    },
                  })),
                  {
                    id: "unknown-api",
                    name: "Unknown billing",
                    version: "2026-11-15",
                    model_picker_enabled: true,
                    supported_endpoints: ["/v1/messages"],
                    capabilities: {
                      family: "claude",
                      limits: {
                        max_context_window_tokens: 20_000,
                        max_prompt_tokens: 18_000,
                        max_output_tokens: 2_000,
                      },
                      supports: { tool_calls: true },
                    },
                  },
                ],
              }),
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const baseURL = `http://127.0.0.1:${running.port}`
      const premiumID = Model.ID.make("premium-picker")
      const freeID = Model.ID.make("free-picker")
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, () => {})
        editor.models.update(Provider.ID.githubCopilot, premiumID, (model) => {
          model.modelID = Model.ID.make("premium-api")
        })
        editor.models.update(Provider.ID.githubCopilot, freeID, (model) => {
          model.modelID = Model.ID.make("free-api")
        })
      })
      const accountA = yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "copilot-a",
          refresh: "copilot-a",
          expires: 0,
          metadata: { apiEndpoint: baseURL },
        }),
      })
      const accountB = yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        activate: false,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "copilot-b",
          refresh: "copilot-b",
          expires: 0,
          metadata: { apiEndpoint: baseURL, enterpriseUrl: "company.ghe.com" },
        }),
      })
      const connectionA = { type: "credential" as const, id: accountA.id }
      const connectionB = { type: "credential" as const, id: accountB.id }
      const reads: Array<{ url: string; authorization?: string; version?: string }> = []
      yield* addPlugin(
        HttpClient.make((request) =>
          Effect.sync(() => {
            reads.push({
              url: request.url,
              authorization: request.headers.authorization,
              version: request.headers["x-github-api-version"],
            })
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                copilot_plan: "business",
                chat_enabled: true,
                token_based_billing: false,
                quota_reset_date_utc: "2026-12-01T00:00:00.000Z",
                quota_snapshots: {
                  chat: { unlimited: true },
                  completions: { entitlement: 100, quota_remaining: 90 },
                  premium_interactions: { entitlement: 100, quota_remaining: 0, has_quota: false, unlimited: false },
                },
              }),
            )
          }),
        ),
      )
      const model = yield* pollWithTimeout(
        models
          .get(Provider.ID.githubCopilot, premiumID, connectionB)
          .pipe(Effect.map((model) => (model?.settings?.baseURL === `${baseURL}/v1` ? model : undefined))),
        "Copilot catalog did not finish before the quota read",
      )
      expect(model.metadata?.quota).toMatchObject({ status: "unknown", connection: connectionB })
      expect(model.metadata?.quota?.freeModel).toBeUndefined()
      yield* modelRequest(Session.ID.make("ses_copilot_plain"), "primary")
      expect(reads).toEqual([])
      const observed = yield* hooks.trigger("session", "model.quota", {
        sessionID: Session.ID.make("ses_copilot_quota"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: premiumID }),
        connection: connectionB,
      })
      expect(reads).toEqual([
        {
          url: "https://api.company.ghe.com/copilot_internal/user",
          authorization: "Bearer copilot-b",
          version: "2025-04-01",
        },
      ])
      expect(observed.quota).toMatchObject({
        status: "known",
        source: "github-copilot",
        connection: connectionB,
        plan: "business",
        allowed: true,
        freePlan: false,
        freeModel: false,
      })
      expect(observed.quota?.windows.find((window) => window.id === "premium_interactions")).toMatchObject({
        scope: "model",
        modelIDs: ["premium-api"],
        usedRatio: 1,
        remaining: 0,
        resetAt: Date.parse("2026-12-01T00:00:00.000Z"),
      })
      expect(observed.quota?.windows.find((window) => window.id === "completions")).toMatchObject({
        scope: "model",
        modelIDs: [],
      })
      expect(required(yield* models.get(Provider.ID.githubCopilot, premiumID, connectionB)).metadata?.quota).toEqual(
        observed.quota,
      )
      const free = yield* hooks.trigger("session", "model.quota", {
        sessionID: Session.ID.make("ses_copilot_quota"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: freeID }),
        connection: connectionB,
      })
      expect(free.quota).toMatchObject({ status: "known", freeModel: true })
      expect(free.quota?.windows.find((window) => window.id === "premium_interactions")?.modelIDs).toEqual([])
      const unknown = yield* hooks.trigger("session", "model.quota", {
        sessionID: Session.ID.make("ses_copilot_quota"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("unknown-api") }),
        connection: connectionB,
      })
      expect(unknown.quota).toMatchObject({
        status: "unknown",
        source: "github-copilot",
        connection: connectionB,
        allowed: true,
      })
      expect(unknown.quota?.freeModel).toBeUndefined()
      expect(unknown.quota?.windows.find((window) => window.id === "premium_interactions")).toMatchObject({
        scope: "account",
        usedRatio: 1,
        remaining: 0,
        unlimited: false,
      })
      expect(unknown.quota?.windows.find((window) => window.id === "premium_interactions")?.modelIDs).toBeUndefined()
      expect(unknown.quota?.windows.find((window) => window.id === "chat")).toMatchObject({
        scope: "account",
        unlimited: true,
      })
      expect(
        required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("unknown-api"), connectionB)).metadata
          ?.quota,
      ).toEqual(unknown.quota)
      expect(reads).toHaveLength(1)
      expect(
        required(yield* models.get(Provider.ID.githubCopilot, premiumID, connectionA)).metadata?.quota?.status,
      ).toBe("unknown")
      expect(yield* integrations.connection.active(Integration.ID.make("github-copilot"))).toMatchObject(connectionA)
    }),
  )

  it.effect("registers GitHub Copilot device OAuth", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("github-copilot")))?.methods).toContainEqual({
        id: Integration.MethodID.make("device"),
        type: "oauth",
        label: "Login with GitHub Copilot",
        form: expect.any(Array),
      })
    }),
  )

  it.effect("removes the generic key method", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        editor.method.update({
          integrationID: Integration.ID.make("github-copilot"),
          method: { type: "key" },
        })
        editor.method.update({
          integrationID: Integration.ID.make("github-copilot"),
          method: { type: "env", names: ["GITHUB_TOKEN"] },
        })
      })
      yield* addPlugin()
      expect((yield* integrations.get(Integration.ID.make("github-copilot")))?.methods).toEqual([
        { type: "env", names: ["GITHUB_TOKEN"] },
        {
          id: Integration.MethodID.make("device"),
          type: "oauth",
          label: "Login with GitHub Copilot",
          form: expect.any(Array),
        },
      ])
    }),
  )

  it.live("adds Copilot authentication and request metadata headers", () =>
    Effect.gen(function* () {
      const requests: Headers[] = []
      const send = copilotFetch(
        "token",
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requests.push(new Headers(init?.headers))
          return Response.json({ ok: true })
        },
        App.make({ name: "test", version: "1.2.3", channel: "beta" }),
      )
      yield* Effect.promise(() =>
        send("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { "x-api-key": "old" },
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png" } }] }],
          }),
        }),
      )
      expect(requests[0]?.get("authorization")).toBe("Bearer token")
      expect(requests[0]?.has("x-api-key")).toBe(false)
      expect(requests[0]?.get("x-initiator")).toBe("user")
      expect(requests[0]?.get("copilot-vision-request")).toBe("true")
      expect(requests[0]?.get("x-github-api-version")).toBe("2026-08-01")
      expect(requests[0]?.get("user-agent")).toBe("omnixa/beta/1.2.3/test")
    }),
  )

  it.effect("adds Copilot authentication to native Anthropic requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "http.request", {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("claude-sonnet-4.5") }),
        kind: "primary",
        request: new Request("https://api.githubcopilot.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": "token" },
          body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
        }),
      })
      expect(event.request.headers.get("authorization")).toBe("Bearer token")
      expect(event.request.headers.has("x-api-key")).toBe(false)
      expect(event.request.headers.get("x-initiator")).toBe("user")
      expect(event.request.headers.get("anthropic-beta")).toBe("interleaved-thinking-2025-05-14")
      expect(event.request.headers.get("x-github-api-version")).toBe("2026-08-01")
    }),
  )

  it.effect("classifies main-loop steps as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
    }),
  )

  it.effect("classifies child-session steps as subagent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const ids = yield* sessions()
      const event = yield* modelRequest(ids.child, "primary")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-subagent",
        "X-Interaction-Id": ids.parent,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("classifies title generation as a background interaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "title")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-background",
        "X-Interaction-Id": event.sessionID,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("classifies compaction requests by kind rather than agent", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const ids = yield* sessions()
      const event = yield* modelRequest(ids.child, "compaction", "build")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-compaction",
        "X-Interaction-Id": ids.parent,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("does not classify by agent name", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary", "compaction")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
    }),
  )

  it.effect("ignores other providers' model requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "model.request", {
        sessionID: (yield* sessions()).parent,
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5.4") }),
        kind: "primary",
        headers: {},
      })
      expect(event.headers).toEqual({})
    }),
  )

  const titleRequest = {
    sessionID: Session.ID.make("ses_title"),
    system: [SystemPart.make("You are a title generator.")],
    messages: [Message.user("how do I make my python script faster")],
    options: { maxTokens: 32 },
  }
  const utilityInput = (send: (init?: RequestInit) => Response | Promise<Response>) => ({
    baseURL: "https://api.individual.githubcopilot.com",
    token: "token",
    model: "gpt-4o-mini",
    app: App.make({ name: "test", version: "1.2.3", channel: "beta" }),
    fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => send(init),
  })

  it.live("names sessions with the utility model as a free background request", () =>
    Effect.gen(function* () {
      const seen: Array<{ url?: string; init?: RequestInit }> = []
      const title = yield* utilityTitle(
        {
          ...utilityInput(() => Response.json({ choices: [{ message: { content: "  Speed Up Python Script\n" } }] })),
          fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            seen.push({ url: String(input), init })
            return Response.json({ choices: [{ message: { content: "  Speed Up Python Script\n" } }] })
          },
        },
        titleRequest,
      )
      expect(title).toBe("Speed Up Python Script")
      expect(seen[0]?.url).toBe("https://api.individual.githubcopilot.com/chat/completions")
      const headers = new Headers(seen[0]?.init?.headers)
      expect(headers.get("authorization")).toBe("Bearer token")
      expect(headers.get("x-interaction-type")).toBe("agent-session-name-generation")
      expect(headers.get("x-interaction-id")).toBe("ses_title")
      expect(headers.get("x-initiator")).toBe("agent")
      expect(headers.get("x-github-api-version")).toBe("2026-08-01")
      expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
        model: "gpt-4o-mini",
        stream: false,
        max_tokens: 32,
        messages: [
          { role: "system", content: "You are a title generator." },
          { role: "user", content: "how do I make my python script faster" },
        ],
      })
    }),
  )

  it.live("fails the utility title on rate limits so the billable path can run", () =>
    Effect.gen(function* () {
      const error = yield* utilityTitle(
        utilityInput(() => new Response("slow down", { status: 429 })),
        titleRequest,
      ).pipe(Effect.flip)
      expect(String(error)).toContain("429")
    }),
  )

  it.live("fails the utility title on an empty completion", () =>
    Effect.gen(function* () {
      const error = yield* utilityTitle(
        utilityInput(() => Response.json({ choices: [{ message: { content: null } }] })),
        titleRequest,
      ).pipe(Effect.flip)
      expect(String(error)).toContain("empty")
    }),
  )

  it.live("keeps a declared agent initiator when the body looks user-initiated", () =>
    Effect.gen(function* () {
      const requests: Headers[] = []
      const send = copilotFetch(
        "token",
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requests.push(new Headers(init?.headers))
          return Response.json({ ok: true })
        },
        App.make({ name: "test", version: "1.2.3", channel: "beta" }),
      )
      yield* Effect.promise(() =>
        send("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { "x-initiator": "agent" },
          body: JSON.stringify({ messages: [{ role: "user", content: "summarize" }] }),
        }),
      )
      expect(requests[0]?.get("x-initiator")).toBe("agent")
    }),
  )

  it.effect("classifies session generation requests as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "generate")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
    }),
  )

  it.effect("creates the bundled Copilot SDK for the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const ignored = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "github-copilot" },
      })
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/github-copilot",
        options: { name: "github-copilot" },
      })
      expect(ignored.sdk).toBeUndefined()
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("rewrites models.dev fallback models to the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const aisdk = yield* AISDK.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, (provider) => {
          provider.activation = "enabled"
        })
        editor.models.update(Provider.ID.githubCopilot, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* addPlugin()
      const fallback = required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5.6-sol")))
      expect(fallback.package).toBe(Provider.aisdk("@ai-sdk/github-copilot"))

      const resolved = yield* ModelResolver.fromCatalogModel(fallback, undefined, {
        loadPackage: () => Effect.die("Copilot must not load a native provider package"),
        loadAISDK: (model) => aisdk.model(model),
      })
      expect(resolved.route.id).toBe("ai-sdk:@ai-sdk/github-copilot")
      expect(resolved.route.providerMetadataKey).toBe("copilot")
    }),
  )

  it.effect("selects languageModel when responses and chat are absent", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("claude-sonnet-4")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("selects languageModel with the API model ID when responses and chat are absent", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("alias")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("uses responses for gpt-5 models except gpt-5-mini", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5.1-codex")),
          modelID: Model.ID.make("gpt-5.1-codex"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-4o")),
          modelID: Model.ID.make("gpt-4o"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-mini")),
          modelID: Model.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-mini-2025-08-07")),
          modelID: Model.ID.make("gpt-5-mini-2025-08-07"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([
        "responses:gpt-5",
        "responses:gpt-5.1-codex",
        "chat:gpt-4o",
        "chat:gpt-5-mini",
        "chat:gpt-5-mini-2025-08-07",
      ])
    }),
  )

  it.effect("uses responses for Grok and MAI Code models and chat for Gemini", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("grok-4.5")),
          modelID: Model.ID.make("grok-4.5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("grok-4.6")),
          modelID: Model.ID.make("grok-4.6"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gemini-3.8-flash")),
          modelID: Model.ID.make("gemini-3.8-flash"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("mai-code-1.1-flash")),
          modelID: Model.ID.make("mai-code-1.1-flash"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-4o")),
          modelID: Model.ID.make("gpt-4o"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([
        "responses:grok-4.5",
        "responses:grok-4.6",
        "chat:gemini-3.8-flash",
        "responses:mai-code-1.1-flash",
        "chat:gpt-4o",
      ])
    }),
  )

  it.effect("uses advertised Copilot endpoint metadata before model ID fallbacks", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("mai-code-1-flash-picker")),
          modelID: Model.ID.make("mai-code-1-flash-picker"),
          package: "aisdk:test-provider",
          settings: { endpoint: "responses" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { endpoint: "responses" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
          settings: { endpoint: "chat" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { endpoint: "chat" },
      })
      expect(calls).toEqual(["responses:mai-code-1-flash-picker", "chat:gpt-5"])
    }),
  )

  it.effect("uses the API model ID when selecting responses or chat", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("default")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("small")),
          modelID: Model.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("sonnet")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:gpt-5", "chat:gpt-5-mini", "chat:claude-sonnet-4"])
    }),
  )

  it.effect("disables gpt-5-chat-latest before Copilot language selection", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, (provider) => {
          provider.activation = "enabled"
        })
        editor.models.update(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"))).enabled).toBe(
        false,
      )
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-Copilot providers", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.make("custom-copilot"), () => {})
        editor.models.update(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* models.get(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(true)
    }),
  )

  it.effect("ignores non-Copilot providers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
