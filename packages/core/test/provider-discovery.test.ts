import { describe, expect, test } from "bun:test"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect"
import { SqlError, ConnectionError } from "effect/sql/SqlError"
import { FetchHttpClient, HttpClient } from "effect/http"
import { AIClient, LLM, ModelID } from "@aigcfroge/ai"
import { Config } from "@aigcfroge/core/config"
import { Bus } from "@aigcfroge/core/bus"
import { ConfigProviderPlugin } from "@aigcfroge/core/config/plugin/provider"
import { ConfigPolicyPlugin } from "@aigcfroge/core/config/plugin/policy"
import { Credential } from "@aigcfroge/core/credential"
import { Integration } from "@aigcfroge/core/integration"
import { KV } from "@aigcfroge/core/kv"
import { ManagedPolicy } from "@aigcfroge/core/managed-policy"
import { Model } from "@aigcfroge/core/model"
import { ModelResolver } from "@aigcfroge/core/model-resolver"
import { ModelsDev } from "@aigcfroge/core/models-dev"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHost } from "@aigcfroge/core/plugin/host"
import { Provider } from "@aigcfroge/core/provider"
import { ProviderDiscovery } from "@aigcfroge/core/provider/discovery"
import { ProviderDiscoveryHTTP } from "@aigcfroge/core/provider/discovery-http"
import { SessionUsage } from "@aigcfroge/core/session/usage"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { Document, Info } from "@aigcfroge/schema/config"
import { Money } from "@aigcfroge/schema/money"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { makePluginTestLayerWith } from "./plugin/fixture"

const http = testEffect(FetchHttpClient.layer)
const it = testEffect(
  ModelResolver.layer.pipe(
    Layer.provideMerge(
      ProviderDiscovery.layer.pipe(
        Layer.provideMerge(makePluginTestLayerWith(ModelsDev.configured({ fetch: false, snapshot: false }))),
      ),
    ),
    Layer.provideMerge(AIClient.layer),
  ),
)
const providerID = Provider.ID.make("directory-fixture")
const modelID = Model.ID.make("managed")
const integrationID = Integration.ID.make(providerID)

const server = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (running) => Effect.promise(() => running.stop(true)),
  )

const definition = (baseURL: string, extra: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(ConfigProvider.Info)({
    package: "@aigcfroge/ai/providers/openai-compatible",
    settings: { baseURL },
    models: { managed: { modelID: "api-model" } },
    ...extra,
  })

const configure = Effect.fnUntraced(function* (value: ConfigProvider.Info) {
  yield* (yield* Config.Test).setEntries([
    new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({ providers: { [providerID]: value } }) }),
  ])
  yield* (yield* ProviderDiscovery.Service).sync()
})

const setup = Effect.fnUntraced(function* (value: ConfigProvider.Info) {
  yield* configure(value)
  const host = yield* PluginHost.make(yield* Plugin.Service)
  yield* ConfigProviderPlugin.Plugin.effect(host)
  const credential = yield* (yield* Credential.Service).create({
    integrationID,
    value: Credential.Key.make({ type: "key", key: "account-a" }),
  })
  const discovery = yield* ProviderDiscovery.Service
  yield* discovery.start()
  yield* (yield* Model.Service).reload()
  return { discovery, credential }
})

describe("ProviderDiscovery metadata", () => {
  test("merges each observed field in user/live/public/seed order and keeps false", () => {
    const costs = [
      {
        input: Money.USDPerMillionTokens.make(1),
        output: Money.USDPerMillionTokens.make(2),
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      },
    ]
    const result = ProviderDiscovery.resolveMetadata({
      runtime: Model.Info.default(providerID, modelID),
      user: Schema.decodeUnknownSync(ConfigProvider.Model)({
        name: "Personal",
        capabilities: { tools: false },
        compatibility: { requireReasoning: false },
        limit: { output: 100 },
      }),
      live: {
        name: "Live",
        compatibility: { supportsEffortUpdates: false },
        capabilities: { tools: true, input: ["audio"] },
        limit: { context: 20_000 },
        quote: { status: "unknown" },
      },
      public: {
        name: "Public",
        family: Model.Family.make("public-family"),
        capabilities: { output: ["audio"] },
        quote: { status: "known", prices: costs },
      },
      seed: { limit: { context: 40_000, input: 10_000, output: 2_000 } },
    })
    expect(result.metadata).toMatchObject({
      name: "Personal",
      family: "public-family",
      compatibility: { requireReasoning: false, supportsEffortUpdates: false },
      capabilities: { tools: false, input: ["audio"], output: ["audio"] },
      limit: { context: 20_000, input: 10_000, output: 100 },
      quote: { status: "known", prices: costs },
    })
    expect(result.origins).toEqual({
      name: "user",
      family: "public",
      compatibility: { requireReasoning: "user", supportsEffortUpdates: "live" },
      capabilities: { tools: "user", input: "live", output: "public" },
      limit: { context: "live", input: "seed", output: "user" },
      quote: "public",
    })
    const unknown = ProviderDiscovery.resolveMetadata({ runtime: Model.Info.default(providerID, modelID) })
    expect(unknown.metadata.quote).toEqual({ status: "unknown" })
    expect(unknown.origins.limit.context).toBe("runtime-default")
    const free = ProviderDiscovery.resolveMetadata({
      runtime: Model.Info.default(providerID, modelID),
      user: Schema.decodeUnknownSync(ConfigProvider.Model)({ cost: { input: 0, output: 0 } }),
    })
    expect(free.metadata.quote.status).toBe("free")
    expect(free.origins.quote).toBe("user")
    const timed = { status: "known" as const, prices: costs, validFrom: 100, validUntil: 200, source: "contract" }
    const quota = {
      status: "known" as const,
      source: "copilot",
      observedAt: 100,
      freshUntil: 200,
      windows: [{ id: "premium", unit: "requests", scope: "model" as const, modelIDs: ["one"], usedRatio: 0.2 }],
    }
    const authored = ProviderDiscovery.resolveMetadata({
      runtime: Model.Info.default(providerID, modelID),
      user: Schema.decodeUnknownSync(ConfigProvider.Model)({ quote: timed }),
      live: { quote: { status: "free", prices: [] }, quota },
    })
    expect(authored.metadata.quote).toEqual(timed)
    expect(authored.metadata.quota).toEqual(quota)
    expect(authored.origins.quote).toBe("user")
    expect(SessionUsage.currentQuote(timed, 99)).toEqual({ status: "unknown" })
    expect(SessionUsage.currentQuote(timed, 100)).toEqual(timed)
    expect(SessionUsage.currentQuote(timed, 199)).toEqual(timed)
    expect(SessionUsage.currentQuote(timed, 200)).toEqual({ status: "unknown" })
    expect(
      SessionUsage.quotedCost(SessionUsage.currentQuote(timed, 200), {
        input: 1,
        output: 1,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ).toBeUndefined()
    expect(
      ProviderDiscovery.resolveMetadata({
        runtime: Model.Info.default(providerID, modelID),
        user: Schema.decodeUnknownSync(ConfigProvider.Model)({ cost: [] }),
        public: { quote: timed },
      }).metadata.quote,
    ).toEqual({ status: "unknown" })
    expect(
      ProviderDiscovery.resolveMetadata({
        runtime: Model.Info.default(providerID, modelID),
        user: Schema.decodeUnknownSync(ConfigProvider.Model)({ quote: { status: "unknown" } }),
        public: { quote: timed },
      }).metadata.quote,
    ).toEqual({ status: "unknown" })
  })
})

describe("ProviderDiscovery HTTP adapters", () => {
  http.live("reads OpenAI IDs without inventing capabilities, detects partial and invalid listings", () =>
    Effect.gen(function* () {
      let response: unknown = { data: [{ id: "api-model" }, { id: "api-model" }] }
      const requests: { url: string; headers: Headers }[] = []
      const running = yield* server((request) => {
        requests.push({ url: request.url, headers: new Headers(request.headers) })
        return Response.json(response)
      })
      const input = { url: `${running.url}prefix/v1/models`, headers: { authorization: "Bearer fixture-key" } }
      const result = yield* ProviderDiscoveryHTTP.openai(input)
      expect(result).toEqual({ complete: true, models: [{ id: Model.ID.make("api-model"), metadata: {} }] })
      expect(new URL(requests[0].url).pathname).toBe("/prefix/v1/models")
      expect(requests[0].headers.get("authorization")).toBe("Bearer fixture-key")
      response = { data: [], has_more: true }
      expect((yield* ProviderDiscoveryHTTP.openai(input)).complete).toBe(false)
      response = { data: [{ id: 7 }] }
      expect((yield* ProviderDiscoveryHTTP.openai(input).pipe(Effect.flip)).kind).toBe("invalid")
      response = { data: [] }
      expect(yield* ProviderDiscoveryHTTP.openai(input)).toEqual({ complete: true, models: [] })
      expect((yield* ProviderDiscoveryHTTP.openai({ ...input, maxBytes: 1 }).pipe(Effect.flip)).kind).toBe("incomplete")
    }),
  )

  http.live("follows Anthropic after_id and refuses nonadvancing or excessive pagination", () =>
    Effect.gen(function* () {
      let repeat = false
      const requests: { url: string; headers: Headers }[] = []
      const running = yield* server((request) => {
        requests.push({ url: request.url, headers: new Headers(request.headers) })
        const after = new URL(request.url).searchParams.get("after_id")
        return Response.json(
          after && !repeat
            ? {
                data: [{ id: "second", display_name: "Second", max_input_tokens: 12_000, max_tokens: 2_000 }],
                has_more: false,
                last_id: "second",
              }
            : {
                data: [
                  {
                    id: "first",
                    capabilities: { image_input: { supported: false }, pdf_input: { supported: true } },
                    metadata: { capabilities: { tools: false } },
                  },
                ],
                has_more: true,
                last_id: "first",
              },
        )
      })
      const input = {
        url: `${running.url}gateway/v1/models`,
        headers: { "x-api-key": "fixture-key", "anthropic-version": "2023-06-01" },
      }
      const result = yield* ProviderDiscoveryHTTP.anthropic(input)
      expect(result.complete).toBe(true)
      expect(result.models.map((model) => model.id)).toEqual([Model.ID.make("first"), Model.ID.make("second")])
      expect(result.models[0].metadata.capabilities).toEqual({ input: ["text", "pdf"], tools: false })
      expect(result.models[1].metadata.limit).toEqual({ context: 12_000, input: 12_000, output: 2_000 })
      expect(new URL(requests[1].url).pathname).toBe("/gateway/v1/models")
      expect(new URL(requests[1].url).searchParams.get("after_id")).toBe("first")
      expect(requests[1].headers.get("x-api-key")).toBe("fixture-key")
      repeat = true
      expect((yield* ProviderDiscoveryHTTP.anthropic(input)).error?.kind).toBe("incomplete")
      expect((yield* ProviderDiscoveryHTTP.anthropic({ ...input, maxPages: 1 })).complete).toBe(false)
      expect((yield* ProviderDiscoveryHTTP.anthropic({ ...input, maxBytes: 2 }).pipe(Effect.flip)).kind).toBe(
        "incomplete",
      )
    }),
  )

  http.live("times out a stalled external request at its declared boundary", () =>
    Effect.gen(function* () {
      const release = Promise.withResolvers<Response>()
      const running = yield* server(() => release.promise)
      const error = yield* ProviderDiscoveryHTTP.openai({
        url: `${running.url}models`,
        headers: {},
        timeoutMs: 30,
      }).pipe(Effect.flip)
      release.resolve(Response.json({ data: [] }))
      expect(error.kind).toBe("timeout")
    }),
  )
})

describe("ProviderDiscovery connection ownership", () => {
  it.live(
    "routes concurrent explicit account views through their own catalogs and credentials without switching active",
    () =>
      Effect.gen(function* () {
        const requests: { path: string; authorization: string | null; body?: unknown }[] = []
        const running = yield* server(async (request) => {
          const path = new URL(request.url).pathname
          const alternate = path.startsWith("/alternate/")
          const authorization = request.headers.get("authorization")
          if (path.endsWith("/models")) {
            requests.push({ path, authorization })
            return Response.json({
              data: [
                {
                  id: alternate ? "account-b-model" : "api-model",
                  metadata: {
                    name: alternate ? "Live B" : "Live A",
                    capabilities: { tools: alternate, input: alternate ? ["text", "image"] : ["text"] },
                    limit: { context: alternate ? 500_000 : 128_000 },
                  },
                },
              ],
            })
          }
          requests.push({ path, authorization, body: await request.json() })
          return new Response(
            [
              {
                id: "chatcmpl_fixture",
                choices: [{ delta: { role: "assistant", content: "OK" }, finish_reason: null }],
                usage: null,
              },
              { id: "chatcmpl_fixture", choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
              {
                id: "chatcmpl_fixture",
                choices: [],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              },
            ]
              .map((value) => `data: ${JSON.stringify(value)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          )
        })
        const ctx = yield* setup(
          definition(`${running.url}prefix/v1`, {
            models: {
              managed: { modelID: "api-model", limit: { output: 100 } },
              alternate: { modelID: "account-b-model", name: "User B", limit: { output: 200 } },
            },
          }),
        )
        const credentials = yield* Credential.Service
        const alternate = yield* credentials.create({
          integrationID,
          activate: false,
          value: Credential.Key.make({
            type: "key",
            key: "account-b",
            configuration: { baseURL: `${running.url}alternate/v1` },
          }),
        })
        const connectionA = { type: "credential" as const, id: ctx.credential.id }
        const connectionB = { type: "credential" as const, id: alternate.id }
        const integrations = yield* Integration.Service
        expect(yield* integrations.connection.active(integrationID)).toMatchObject(connectionA)
        const catalogs = yield* Effect.all(
          {
            a: ctx.discovery.refresh({ providerID, connection: connectionA }),
            b: ctx.discovery.refresh({ providerID, connection: connectionB }),
          },
          { concurrency: "unbounded" },
        )
        expect(catalogs.a.inventory?.models.map((model) => model.id)).toEqual([Model.ID.make("api-model")])
        expect(catalogs.b.inventory?.models.map((model) => model.id)).toEqual([Model.ID.make("account-b-model")])
        const models = yield* Model.Service
        const selected = yield* Effect.all(
          {
            a: models.get(providerID, modelID, connectionA),
            b: models.get(providerID, Model.ID.make("alternate"), connectionB),
            stale: models.get(providerID, Model.ID.make("alternate")),
          },
          { concurrency: "unbounded" },
        )
        expect(selected.a).toMatchObject({
          name: "Live A",
          capabilities: { tools: false, input: ["text"] },
          limit: { context: 128_000, output: 100 },
        })
        expect(selected.b).toMatchObject({
          name: "User B",
          capabilities: { tools: true, input: ["text", "image"] },
          limit: { context: 500_000, output: 200 },
        })
        expect(selected.stale?.limit.context).not.toBe(500_000)
        if (!selected.stale) throw new Error("The configured alternate model must exist in the active fixture")
        const resolver = yield* ModelResolver.Service
        const resolved = yield* Effect.all(
          {
            a: resolver.resolve(Model.Ref.make({ providerID, id: modelID }), connectionA),
            b: resolver.resolveModel(selected.stale, undefined, connectionB),
          },
          { concurrency: "unbounded" },
        )
        if (!resolved.a) throw new Error("The active fixture model must resolve")
        expect(resolved.a).toMatchObject({
          ref: { providerID, id: modelID },
          connection: connectionA,
          capabilities: { tools: false },
          limit: { context: 128_000, output: 100 },
        })
        expect(resolved.b).toMatchObject({
          ref: { providerID, id: "alternate" },
          connection: connectionB,
          capabilities: { input: ["text", "image"] },
          limit: { context: 500_000, output: 200 },
        })
        expect(String(resolved.a.model.id)).toBe("api-model")
        expect(String(resolved.b.model.id)).toBe("account-b-model")
        expect(resolved.a.model.route.endpoint.baseURL).toBe(`${running.url}prefix/v1`)
        expect(resolved.b.model.route.endpoint.baseURL).toBe(`${running.url}alternate/v1`)
        const responses = yield* Effect.all(
          [
            LLM.generate({ model: resolved.a.model, prompt: "Account A" }),
            LLM.generate({ model: resolved.b.model, prompt: "Account B" }),
          ],
          { concurrency: "unbounded" },
        )
        expect(responses).toHaveLength(2)
        expect(
          requests.filter((request) => request.body !== undefined).sort((a, b) => a.path.localeCompare(b.path)),
        ).toEqual([
          {
            path: "/alternate/v1/chat/completions",
            authorization: "Bearer account-b",
            body: expect.objectContaining({ model: "account-b-model" }),
          },
          {
            path: "/prefix/v1/chat/completions",
            authorization: "Bearer account-a",
            body: expect.objectContaining({ model: "api-model" }),
          },
        ])
        expect(
          requests.filter((request) => request.body === undefined).sort((a, b) => a.path.localeCompare(b.path)),
        ).toEqual([
          { path: "/alternate/v1/models", authorization: "Bearer account-b" },
          { path: "/prefix/v1/models", authorization: "Bearer account-a" },
        ])
        expect(yield* integrations.connection.active(integrationID)).toMatchObject(connectionA)
        expect((yield* models.get(providerID, modelID))?.capabilities.tools).toBe(false)
      }),
  )

  it.live("isolates account inventories and preserves last complete success on failure and partial", () =>
    Effect.gen(function* () {
      const requests: { url: string; headers: Headers }[] = []
      let phase: "ready" | "failed" | "partial" | "empty" = "ready"
      const running = yield* server((request) => {
        requests.push({ url: request.url, headers: new Headers(request.headers) })
        if (phase === "failed") return Response.json({ error: "Do not expose fixture-secret" }, { status: 401 })
        if (phase === "partial") return Response.json({ data: [{ id: "partial-model" }], has_more: true })
        if (phase === "empty") return Response.json({ data: [] })
        return Response.json({
          data: [
            {
              id: request.headers.get("authorization") === "Bearer account-a" ? "api-model" : "account-b-model",
              metadata: { capabilities: { tools: false }, limit: { context: 500_000 } },
            },
          ],
        })
      })
      const ctx = yield* setup(definition(`${running.url}prefix/v1`))
      const alternate = yield* (yield* Credential.Service).create({
        integrationID,
        activate: false,
        value: Credential.Key.make({ type: "key", key: "account-b" }),
      })
      expect((yield* ctx.discovery.get({ providerID })).status.phase).toBe("idle")
      expect(requests).toHaveLength(0)
      const first = yield* ctx.discovery.refresh({ providerID })
      expect(first.inventory?.models[0].id).toBe(Model.ID.make("api-model"))
      expect(first.status.cachePersisted).toBe(true)
      const second = yield* ctx.discovery.refresh({ providerID, connection: { type: "credential", id: alternate.id } })
      expect(second.inventory?.models[0].id).toBe(Model.ID.make("account-b-model"))
      expect((yield* ctx.discovery.get({ providerID })).inventory?.models[0].id).toBe(Model.ID.make("api-model"))
      const runtime = yield* (yield* Model.Service).get(providerID, modelID)
      expect(runtime?.capabilities.tools).toBe(false)
      expect(runtime?.origins?.limit?.context).toBe("live")
      phase = "failed"
      const failed = yield* ctx.discovery.refresh({ providerID })
      expect(failed.status.phase).toBe("failed")
      expect(failed.inventory?.digest).toBe(first.inventory?.digest)
      expect(JSON.stringify(failed)).not.toContain("fixture-secret")
      phase = "partial"
      const partial = yield* ctx.discovery.refresh({ providerID })
      expect(partial.inventory?.digest).toBe(first.inventory?.digest)
      expect(partial.managed[0].membership).toBe("present")
      const partialPreview = yield* ctx.discovery.preview({
        providerID,
        definition: {
          type: "new",
          definition: definition(`${running.url}prefix/v1`, {
            models: { managed: { modelID: "api-model" }, partial: { modelID: "partial-model" } },
          }),
        },
        credential: { type: "key", key: "account-a" },
      })
      expect(partialPreview.status.phase).toBe("partial")
      expect(partialPreview.inventory?.complete).toBe(false)
      expect(partialPreview.managed.map((member) => [member.modelID, member.membership])).toEqual([
        [Model.ID.make("api-model"), "unknown"],
        [Model.ID.make("partial-model"), "present"],
      ])
      expect(partialPreview.candidates[0].membership).toBe("present")
      phase = "empty"
      const empty = yield* ctx.discovery.refresh({ providerID })
      expect(empty.inventory?.models).toEqual([])
      expect(empty.managed[0].membership).toBe("absent")
      expect(yield* (yield* Model.Service).get(providerID, modelID)).toBeDefined()
      phase = "ready"
      for (const packageName of [
        "@aigcfroge/ai/providers/openai-compatible/responses",
        "@aigcfroge/ai/providers/openai-compatible-responses",
      ]) {
        const preview = yield* ctx.discovery.preview({
          providerID,
          definition: { type: "new", definition: definition(`${running.url}prefix/v1`, { package: packageName }) },
          credential: { type: "key", key: "account-a" },
        })
        expect(preview.status.identity?.protocol).toBe("openai")
        expect(preview.status.phase).toBe("ready")
        yield* configure(definition(`${running.url}prefix/v1`, { package: packageName }))
        expect((yield* ctx.discovery.refresh({ providerID })).status.phase).toBe("ready")
      }
    }),
  )

  it.live("shares a simultaneous listing but rejects a late result from an older auth generation", () =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<Response>()
      const requests: { url: string; headers: Headers }[] = []
      let hold = true
      const running = yield* server((request) => {
        requests.push({ url: request.url, headers: new Headers(request.headers) })
        if (hold && request.headers.get("authorization") === "Bearer account-a") {
          entered.resolve()
          return release.promise
        }
        return Response.json({ data: [{ id: "renewed-model" }] })
      })
      const ctx = yield* setup(definition(`${running.url}v1`))
      const secondEntered = yield* Deferred.make<void>()
      let attempts = 0
      yield* (yield* Bus.Service).subscribe(ProviderDiscovery.Event.Updated).pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            if ((yield* ctx.discovery.get({ providerID })).status.phase !== "fetching") return
            attempts++
            if (attempts >= 2) yield* Deferred.succeed(secondEntered, undefined)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      const first = yield* ctx.discovery.refresh({ providerID }).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "Initial directory request did not start",
      )
      const second = yield* ctx.discovery.refresh({ providerID }).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(secondEntered), "Concurrent request did not enter")
      expect(requests).toHaveLength(1)
      hold = false
      yield* (yield* Credential.Service).update(ctx.credential.id, {
        value: Credential.Key.make({ type: "key", key: "renewed-key" }),
      })
      const renewed = yield* ctx.discovery.refresh({ providerID })
      expect(renewed.inventory?.models[0].id).toBe(Model.ID.make("renewed-model"))
      release.resolve(Response.json({ data: [{ id: "old-model" }] }))
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(requests).toHaveLength(2)
      expect((yield* ctx.discovery.get({ providerID })).inventory?.models[0].id).toBe(Model.ID.make("renewed-model"))
      const cold = Context.get(yield* Layer.build(Layer.fresh(ProviderDiscovery.layer)), ProviderDiscovery.Service)
      expect((yield* cold.get({ providerID })).inventory?.models[0].id).toBe(Model.ID.make("renewed-model"))
    }),
  )

  it.live("separates routing header identities and cold cache from historical import seeds", () =>
    Effect.gen(function* () {
      const tenants: string[] = []
      const recorded: { url: string; headers: Headers }[] = []
      const running = yield* server((request) => {
        recorded.push({ url: request.url, headers: new Headers(request.headers) })
        const tenant = request.headers.get("x-tenant") ?? "missing"
        tenants.push(tenant)
        return Response.json({
          data: [
            {
              id: "api-model",
              metadata: { name: tenant, limit: { context: tenant === "tenant-a" ? 700_000 : 900_000 } },
            },
          ],
        })
      })
      const ctx = yield* setup(definition(`${running.url}gateway/v1`, { headers: { "X-Tenant": "tenant-a" } }))
      const first = yield* ctx.discovery.refresh({ providerID })
      const inventory = first.inventory!
      const seed = {
        identity: inventory.identity,
        inventoryDigest: inventory.digest,
        observedAt: inventory.observedAt,
        metadata: inventory.models[0].metadata,
      }
      yield* configure(
        definition(`${running.url}gateway/v1`, {
          headers: { "X-Tenant": "tenant-b" },
          models: { managed: { modelID: "api-model", seed } },
        }),
      )
      const cold = Context.get(yield* Layer.build(Layer.fresh(ProviderDiscovery.layer)), ProviderDiscovery.Service)
      const before = yield* cold.get({ providerID })
      expect(before.inventory).toBeUndefined()
      expect(before.managed[0].origins.limit?.context).toBe("runtime-default")
      const second = yield* cold.refresh({ providerID })
      expect(second.inventory?.identity.configurationDigest).not.toBe(inventory.identity.configurationDigest)
      expect(second.managed[0].origins.limit?.context).toBe("live")
      expect(second.managed[0].metadata.limit?.context).toBe(900_000)
      expect(tenants).toEqual(["tenant-a", "tenant-b"])
      expect(JSON.stringify(second.status.identity)).not.toContain("account-a")
      yield* configure(
        definition(`${running.url}gateway/v1`, {
          package: "@aigcfroge/ai/providers/openai/chat",
          settings: {
            baseURL: `${running.url}gateway/v1`,
            organization: "org-default",
            project: "project-a",
            queryParams: { region: "west", limit: "10" },
          },
          headers: { "OpenAI-Organization": "org-explicit" },
        }),
      )
      const native = yield* ctx.discovery.refresh({ providerID })
      expect(recorded[2].headers.get("openai-organization")).toBe("org-explicit")
      expect(recorded[2].headers.get("openai-project")).toBe("project-a")
      expect(new URL(recorded[2].url).searchParams.get("region")).toBe("west")
      expect(new URL(native.status.identity!.listURL).searchParams.get("limit")).toBe("10")
      yield* configure(
        definition(`${running.url}gateway/v1`, {
          package: "@aigcfroge/ai/providers/openai/chat",
          settings: {
            baseURL: `${running.url}gateway/v1`,
            organization: "org-default",
            project: "project-b",
            queryParams: { region: "east", limit: "10" },
          },
          headers: { "OpenAI-Organization": "org-explicit" },
        }),
      )
      const changed = Context.get(yield* Layer.build(Layer.fresh(ProviderDiscovery.layer)), ProviderDiscovery.Service)
      const miss = yield* changed.get({ providerID })
      expect(miss.inventory).toBeUndefined()
      expect(miss.status.identity?.configurationDigest).not.toBe(native.status.identity?.configurationDigest)
      const updated = yield* changed.refresh({ providerID })
      expect(recorded[3].headers.get("openai-project")).toBe("project-b")
      expect(new URL(recorded[3].url).searchParams.get("region")).toBe("east")
      expect(updated.status.phase).toBe("ready")
    }),
  )

  it.live("withdraws live contributions on source off while a matching seed and user choice remain", () =>
    Effect.gen(function* () {
      const running = yield* server(() =>
        Response.json({
          data: [
            {
              id: "api-model",
              metadata: { name: "Live", capabilities: { tools: false }, limit: { context: 600_000 } },
            },
          ],
        }),
      )
      const ctx = yield* setup(definition(`${running.url}v1`))
      const inventory = (yield* ctx.discovery.refresh({ providerID })).inventory!
      const seed = {
        identity: inventory.identity,
        inventoryDigest: inventory.digest,
        observedAt: inventory.observedAt,
        metadata: { name: "Seed", limit: { context: 400_000 }, capabilities: { tools: false } },
      }
      yield* configure(
        definition(`${running.url}v1`, {
          discovery: { enabled: false },
          models: { managed: { modelID: "api-model", seed, name: "Personal" } },
        }),
      )
      yield* (yield* Model.Service).reload()
      const disabled = yield* ctx.discovery.get({ providerID })
      expect(disabled.status.phase).toBe("disabled")
      expect(disabled.inventory?.digest).toBe(inventory.digest)
      expect(disabled.managed[0].metadata.name).toBe("Personal")
      expect(disabled.managed[0].origins.name).toBe("user")
      expect(disabled.managed[0].metadata.limit?.context).toBe(400_000)
      expect(disabled.managed[0].origins.limit?.context).toBe("seed")
      expect((yield* (yield* Model.Service).get(providerID, modelID))?.name).toBe("Personal")
      yield* configure(
        definition(`${running.url}v1`, {
          discovery: { enabled: true },
          models: { managed: { modelID: "api-model", seed } },
        }),
      )
      yield* (yield* Model.Service).reload()
      expect((yield* ctx.discovery.get({ providerID })).managed[0].metadata.limit?.context).toBe(600_000)
      expect((yield* (yield* Model.Service).get(providerID, modelID))?.name).toBe("Live")
      yield* ConfigPolicyPlugin.Plugin.effect(yield* PluginHost.make(yield* Plugin.Service))
      yield* (yield* ManagedPolicy.Service).set({
        statements: [{ action: "provider.use", effect: "deny", resource: providerID }],
      })
      yield* ctx.discovery.sync()
      yield* ctx.discovery.refresh({ providerID })
      expect(yield* (yield* Provider.Service).get(providerID)).toBeUndefined()
      expect(yield* (yield* Model.Service).get(providerID, modelID)).toBeUndefined()
    }),
  )

  it.live("cancels an automatic fetch when auto sync is switched off", () =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>()
      const aborted = yield* Deferred.make<void>()
      const release = Promise.withResolvers<Response>()
      const running = yield* server(() => {
        entered.resolve()
        return release.promise
      })
      yield* setup(definition(`${running.url}v1`))
      const client = yield* HttpClient.HttpClient
      const observed = HttpClient.transform(client, (response) =>
        response.pipe(Effect.onInterrupt(() => Deferred.succeed(aborted, undefined))),
      )
      const automatic = Context.get(
        yield* Layer.build(
          Layer.fresh(ProviderDiscovery.layer).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, observed))),
        ),
        ProviderDiscovery.Service,
      )
      yield* (yield* Config.Test).setEntries([
        new Document({
          type: "document",
          info: Schema.decodeUnknownSync(Info)({
            providers: {
              [providerID]: definition(`${running.url}v1`, {
                discovery: { enabled: true, autoSync: true, intervalMs: 60_000 },
              }),
            },
          }),
        }),
      ])
      yield* automatic.start()
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "Automatic fetch did not start",
      )
      yield* (yield* Config.Test).setEntries([
        new Document({
          type: "document",
          info: Schema.decodeUnknownSync(Info)({
            providers: {
              [providerID]: definition(`${running.url}v1`, { discovery: { enabled: true, autoSync: false } }),
            },
          }),
        }),
      ])
      yield* automatic.sync()
      yield* awaitWithTimeout(Deferred.await(aborted), "Automatic request was not cancelled")
      release.resolve(Response.json({ data: [{ id: "late-model" }] }))
      expect((yield* automatic.get({ providerID })).inventory).toBeUndefined()
    }),
  )

  it.live("downgrades only a declared SqlError at the KV write boundary", () =>
    Effect.gen(function* () {
      const running = yield* server(() => Response.json({ data: [{ id: "api-model" }] }))
      yield* setup(definition(`${running.url}v1`))
      const kv = yield* KV.Service
      const sqlite = new SqlError({ reason: new ConnectionError({ cause: new Error("fixture storage failure") }) })
      const unavailable = Context.get(
        yield* Layer.build(
          Layer.fresh(ProviderDiscovery.layer).pipe(
            Layer.provide(Layer.mock(KV.Service)({ ...kv, set: () => Effect.die(sqlite) })),
          ),
        ),
        ProviderDiscovery.Service,
      )
      const read = yield* unavailable.refresh({ providerID })
      expect(read.status.phase).toBe("ready")
      expect(read.status.cachePersisted).toBe(false)
      expect(read.status.error?.kind).toBe("cache")
      expect(read.inventory?.models[0].id).toBe(Model.ID.make("api-model"))
      const sentinel = new Error("undeclared cache defect")
      const broken = Context.get(
        yield* Layer.build(
          Layer.fresh(ProviderDiscovery.layer).pipe(
            Layer.provide(Layer.mock(KV.Service)({ ...kv, set: () => Effect.die(sentinel) })),
          ),
        ),
        ProviderDiscovery.Service,
      )
      const unknown = yield* broken.refresh({ providerID }).pipe(Effect.exit)
      expect(
        Exit.isFailure(unknown) &&
          unknown.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === sentinel),
      ).toBe(true)
      const interrupted = Context.get(
        yield* Layer.build(
          Layer.fresh(ProviderDiscovery.layer).pipe(
            Layer.provide(Layer.mock(KV.Service)({ ...kv, set: () => Effect.interrupt })),
          ),
        ),
        ProviderDiscovery.Service,
      )
      const cancelled = yield* interrupted.refresh({ providerID }).pipe(Effect.exit)
      expect(Exit.isFailure(cancelled) && Cause.hasInterrupts(cancelled.cause)).toBe(true)
    }),
  )

  it.live("suspends all pending adoption layers before using a new endpoint and resumes with its new key", () =>
    Effect.gen(function* () {
      const initial = Promise.withResolvers<void>()
      const resumed = Promise.withResolvers<void>()
      const oldKeys: (string | null)[] = []
      const newKeys: (string | null)[] = []
      const previous = yield* server((request) => {
        oldKeys.push(request.headers.get("authorization"))
        initial.resolve()
        return Response.json({ data: [{ id: "api-model", metadata: { limit: { context: 700_000 } } }] })
      })
      const next = yield* server((request) => {
        newKeys.push(request.headers.get("authorization"))
        resumed.resolve()
        return Response.json({ data: [{ id: "api-model", metadata: { limit: { context: 800_000 } } }] })
      })
      const ctx = yield* setup(definition(`${previous.url}v1`, { discovery: { autoSync: true, intervalMs: 60_000 } }))
      yield* awaitWithTimeout(
        Effect.promise(() => initial.promise),
        "Initial automatic listing did not start",
      )
      const adoption = {
        phase: "applying",
        submissionID: "pending-switch",
        targetDefinitionDigest: "fixture-digest",
        stage: "credential",
        credentialAction: "create",
        credentialID: Credential.ID.create(),
        activate: true,
        addedModelIDs: [],
      } as const
      const pending = definition(`${next.url}v1`, { discovery: { autoSync: true, intervalMs: 60_000 }, adoption })
      const higher = Schema.decodeUnknownSync(ConfigProvider.Info)({
        adoption: { ...adoption, phase: "ready", stage: "complete" },
        name: "Higher ready layer",
      })
      const document = (value: ConfigProvider.Info) =>
        new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({ providers: { [providerID]: value } }) })
      yield* (yield* Config.Test).setEntries([document(pending), document(higher)])
      yield* ctx.discovery.sync()
      expect((yield* ctx.discovery.refresh({ providerID })).status.phase).toBe("disabled")
      expect(newKeys).toEqual([])
      expect(oldKeys).toEqual(["Bearer account-a"])
      yield* (yield* Model.Service).reload()
      expect((yield* (yield* Model.Service).get(providerID, modelID))?.origins?.limit?.context).not.toBe("live")
      yield* (yield* Credential.Service).create({
        id: adoption.credentialID,
        integrationID,
        value: Credential.Key.make({ type: "key", key: "new-endpoint-key" }),
      })
      yield* (yield* Config.Test).setEntries([
        document(
          definition(`${next.url}v1`, {
            discovery: { autoSync: true, intervalMs: 60_000 },
            adoption: { ...adoption, phase: "ready", stage: "complete" },
          }),
        ),
        document(higher),
      ])
      yield* ctx.discovery.sync()
      yield* awaitWithTimeout(
        Effect.promise(() => resumed.promise),
        "Ready adoption did not resume automatic listing",
      )
      expect(newKeys).toEqual(["Bearer new-endpoint-key"])
    }),
  )

  it.live("cancels the complete saved refresh when source off happens during OAuth renewal", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const running = yield* server((request) => {
        requests.push(request.url)
        return Response.json({ data: [{ id: "api-model" }] })
      })
      const ctx = yield* setup(definition(`${running.url}v1`))
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const methodID = Integration.MethodID.make("source-renewal-fixture")
      const original = Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "original-oauth",
        refresh: "original-refresh",
        expires: 0,
      })
      yield* (yield* Integration.Service).transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Local renewal fixture" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: running.url.href,
              instructions: "Local fixture",
              callback: Effect.succeed(original),
            }),
          refresh: (credential) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return Credential.OAuth.make({
                ...credential,
                access: "renewed-oauth",
                expires: (yield* DateTime.nowAsDate).getTime() + 3_600_000,
              })
            }).pipe(Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined))),
        }),
      )
      const account = yield* (yield* Credential.Service).create({ integrationID, value: original })
      yield* ctx.discovery.sync()
      const work = yield* ctx.discovery
        .refresh({ providerID, connection: { type: "credential", id: account.id } })
        .pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(started), "OAuth renewal did not start")
      yield* configure(definition(`${running.url}v1`, { discovery: { enabled: false } }))
      yield* awaitWithTimeout(Deferred.await(cancelled), "Source off did not cancel its OAuth renewal")
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.await(work)
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true)
      expect(requests).toEqual([])
      expect((yield* (yield* Credential.Service).get(account.id))?.value).toEqual(original)
      expect((yield* ctx.discovery.get({ providerID })).status.phase).toBe("disabled")
    }),
  )
})

describe("P5 Magpie standard protocols", () => {
  const cases = [
    {
      name: "Chat",
      package: "openai-compatible",
      path: "/chat/completions",
      frames: [
        {
          id: "chat_1",
          model: "upstream/final",
          choices: [{ delta: { role: "assistant", content: "OK" }, finish_reason: null }],
        },
        { id: "chat_1", choices: [{ delta: {}, finish_reason: "stop" }] },
        { id: "chat_1", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ],
    },
    {
      name: "Responses",
      package: "openai-compatible-responses",
      path: "/responses",
      frames: [
        { type: "response.created", response: { id: "resp_1", model: "upstream/final" } },
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "OK" },
        {
          type: "response.output_item.done",
          item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "OK" }] },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
          },
        },
      ],
    },
    {
      name: "Messages",
      package: "anthropic-compatible",
      path: "/messages",
      frames: [
        { type: "message_start", message: { id: "msg_1", model: "upstream/final", usage: { input_tokens: 3 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ],
    },
  ]
  cases.forEach((item) =>
    it.live(`preserves Magpie catalog and group IDs through ${item.name}, standard usage and errors`, () =>
      Effect.gen(function* () {
        let fail = false
        const requests: { path: string; model: unknown }[] = []
        const running = yield* server(async (request) => {
          const path = new URL(request.url).pathname
          if (path.endsWith("/models")) return Response.json({ data: [{ id: "openai/test" }, { id: "group/fast" }] })
          const body = (await request.json()) as { model: unknown }
          requests.push({ path, model: body.model })
          if (fail)
            return Response.json(
              { error: { type: "rate_limit_error", code: "rate_limit_exceeded", message: "Fixture rate limit" } },
              { status: 429 },
            )
          return new Response(
            item.frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
              (item.name === "Chat" ? "data: [DONE]\n\n" : ""),
            {
              headers: {
                "content-type": "text/event-stream",
                "x-magpie-provider": "upstream",
                "x-magpie-model": "early-candidate",
              },
            },
          )
        })
        const ctx = yield* setup(
          definition(`${running.url}v1`, {
            package: `@aigcfroge/ai/providers/${item.package}`,
            discovery: { list: { protocol: "openai", url: `${running.url}v1/models` } },
            models: { managed: { modelID: "group/fast", limit: { output: 100 } } },
          }),
        )
        expect((yield* ctx.discovery.refresh({ providerID })).inventory?.models.map((model) => model.id)).toEqual([
          Model.ID.make("openai/test"),
          Model.ID.make("group/fast"),
        ])
        const resolved = yield* (yield* ModelResolver.Service).resolve(Model.Ref.make({ providerID, id: modelID }))
        if (!resolved) throw new Error("Expected the saved Magpie group model")
        expect(resolved.ref).toEqual(Model.Ref.make({ providerID, id: modelID }))
        expect(resolved.model.id).toBe(ModelID.make("group/fast"))
        const response = yield* LLM.generate({ model: resolved.model, prompt: "Protocol fixture" })
        expect(response.text).toBe("OK")
        expect(response.usage).toMatchObject({ nonCachedInputTokens: 3, visibleOutputTokens: 2 })
        fail = true
        const rejected = yield* LLM.generate({ model: resolved.model, prompt: "Rejected fixture" }).pipe(Effect.exit)
        expect(Option.getOrUndefined(Exit.findErrorOption(rejected))).toMatchObject({ reason: { _tag: "RateLimit" } })
        expect(requests).toEqual([
          { path: `/v1${item.path}`, model: "group/fast" },
          { path: `/v1${item.path}`, model: "group/fast" },
        ])
      }),
    ),
  )
})
