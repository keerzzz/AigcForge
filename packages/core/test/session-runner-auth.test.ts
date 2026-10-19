import { afterEach, expect } from "bun:test"
import { DateTime, Effect, Layer, Stream } from "effect"
import { FetchHttpClient, Headers } from "effect/unstable/http"
import { LLM } from "@aigcfroge/llm"
import { LLMClient, RequestExecutor } from "@aigcfroge/llm/route"
import { Catalog } from "../src/catalog"
import { Credential } from "../src/credential"
import { EventV2 } from "../src/event"
import { Integration } from "../src/integration"
import { Location } from "../src/location"
import { ModelV2 } from "../src/model"
import { ProjectV2 } from "../src/project"
import { ProviderV2 } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionRunnerAuth } from "../src/session/runner/auth-seam"
import { SessionRunnerModel } from "../src/session/runner/model"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  SessionRunnerModel.locationLayer.pipe(
    Layer.provideMerge(
      Catalog.locationLayer.pipe(
        Layer.provideMerge(EventV2.defaultLayer),
        Layer.provideMerge(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make("/auth-test") }))),
        Layer.provideMerge(Credential.defaultLayer),
      ),
    ),
  ),
)

afterEach(() => SessionRunnerAuth.register(() => Effect.succeed(undefined)))

const setup = Effect.fnUntraced(function* (name: string) {
  const providerID = ProviderV2.ID.make(name)
  const modelID = ModelV2.ID.make("model")
  const catalog = yield* Catalog.Service
  yield* (yield* Integration.Service).transform((draft) => draft.update(Integration.ID.make(name), () => {}))
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.integrationID = Integration.ID.make(name)
      provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://transport.invalid/v1" }
    })
    draft.model.update(providerID, modelID, (model) => {
      model.enabled = true
      model.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", id: modelID }
    })
  })
  return SessionV2.Info.make({
    id: SessionV2.ID.make(`ses_${name}`),
    slug: name,
    version: "test",
    title: name,
    projectID: ProjectV2.ID.global,
    mode: "assistant",
    model: { providerID, id: modelID },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make("/auth-test") },
  })
})

it.effect("uses an application credential for a selected model excluded by Core credential availability", () =>
  Effect.gen(function* () {
    const session = yield* setup("external-key")
    const catalog = yield* Catalog.Service
    expect(yield* catalog.model.available()).toEqual([])
    SessionRunnerAuth.register(() =>
      Effect.succeed({ credential: Credential.Key.make({ type: "key", key: "external-secret" }) }),
    )
    const model = yield* (yield* SessionRunnerModel.Service).resolve(session)
    const headers = yield* model.route.auth.apply({
      request: LLM.request({ model, prompt: "test" }),
      method: "POST",
      url: "https://transport.invalid/v1/chat/completions",
      body: "{}",
      headers: Headers.empty,
    })
    expect(headers.authorization).toBe("Bearer external-secret")
    expect(yield* catalog.model.available()).toEqual([])
  }),
)

it.effect("application credentials cannot enable disabled models or providers", () =>
  Effect.gen(function* () {
    const session = yield* setup("external-disabled")
    const catalog = yield* Catalog.Service
    SessionRunnerAuth.register(() => Effect.die("disabled selections must not load application credentials"))
    yield* catalog.transform((draft) =>
      draft.model.update(ProviderV2.ID.make("external-disabled"), ModelV2.ID.make("model"), (model) => {
        model.enabled = false
      }),
    )
    const models = yield* SessionRunnerModel.Service
    expect((yield* models.resolve(session).pipe(Effect.flip))._tag).toBe("SessionRunnerModel.ModelUnavailableError")
    yield* catalog.transform((draft) => {
      draft.model.update(ProviderV2.ID.make("external-disabled"), ModelV2.ID.make("model"), (model) => {
        model.enabled = true
      })
      draft.provider.update(ProviderV2.ID.make("external-disabled"), (provider) => {
        provider.disabled = true
      })
    })
    expect((yield* models.resolve(session).pipe(Effect.flip))._tag).toBe("SessionRunnerModel.ModelUnavailableError")
  }),
)

it.effect("Core credentials take priority without loading application authentication", () =>
  Effect.gen(function* () {
    const session = yield* setup("core-key")
    yield* (yield* Credential.Service).create({
      integrationID: Integration.ID.make("core-key"),
      value: Credential.Key.make({ type: "key", key: "core-secret" }),
    })
    SessionRunnerAuth.register(() => Effect.die("Core credentials must win"))
    const model = yield* (yield* SessionRunnerModel.Service).resolve(session)
    const headers = yield* model.route.auth.apply({
      request: LLM.request({ model, prompt: "test" }),
      method: "POST",
      url: "https://transport.invalid/v1/chat/completions",
      body: "{}",
      headers: Headers.empty,
    })
    expect(headers.authorization).toBe("Bearer core-secret")
  }),
)

it.live("the selected model uses its Location's application transport through the native client", () =>
  Effect.gen(function* () {
    const session = yield* setup("oauth-transport")
    const calls: string[] = []
    SessionRunnerAuth.register((providerID, ref) =>
      Effect.succeed({
        // The native client uses only the standard Fetch call signature.
        fetch: async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
          calls.push(`${providerID}:${ref?.directory}:${String(input)}`)
          expect(init?.signal).toBeDefined()
          return new Response(
            'data: {"id":"test","choices":[{"delta":{"content":"transport works"}}]}\n\ndata: {"id":"test","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      }),
    )
    const model = yield* (yield* SessionRunnerModel.Service).resolve(session)
    const events = yield* LLMClient.stream(LLM.request({ model, prompt: "test" })).pipe(
      Stream.runCollect,
      Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.provide(FetchHttpClient.layer))),
    )
    expect(calls).toEqual(["oauth-transport:/auth-test:https://transport.invalid/v1/chat/completions"])
    expect(JSON.stringify(events)).toContain("transport works")
  }),
)
