import { expect } from "bun:test"
import { LanguageModel, LLMClient } from "@omnixa/ai"
import { RequestExecutor } from "@omnixa/ai/route"
import { OpenAIChat } from "@omnixa/ai/protocols"
import { TestLLM } from "@omnixa/ai/testing"
import { AISDK } from "@omnixa/core/aisdk"
import { Generate } from "@omnixa/core/generate"
import { Integration } from "@omnixa/core/integration"
import { ModelResolver } from "@omnixa/core/model-resolver"
import { ID, Info, Model, Ref } from "@omnixa/core/model"
import { ModelGroup } from "@omnixa/core/model-group"
import { Provider } from "@omnixa/core/provider"
import { Npm } from "@omnixa/util/npm"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/perplexity"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const providers = Layer.mock(Provider.Service, {
  get: () => Effect.undefined,
})
const models = Layer.mock(Model.Service, {
  get: () => Effect.succeed(selected),
})
const integrations = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.undefined,
    get: () => Effect.die("unused"),
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    external: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const client = TestLLM.testLayer({ fallback: TestLLM.text("OK", "generate") })

const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(providers, models, integrations, npm, aisdk)))
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)

const unavailableGroup = ModelResolver.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      providers,
      integrations,
      npm,
      aisdk,
      Layer.mock(Model.Service, {
        default: () =>
          new ModelGroup.UnavailableError({ groupID: Model.GroupID.make("default-group"), reason: "no-candidates" }),
      }),
    ),
  ),
)
testEffect(Generate.layer.pipe(Layer.provideMerge(client), Layer.provide(unavailableGroup))).effect(
  "reports an unavailable Group default without issuing an auxiliary completion",
  () =>
    Effect.gen(function* () {
      const generate = yield* Generate.Service
      const error = yield* generate.text({ prompt: "Generate a short summary" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Generate.UnavailableError)
      expect(error.message).toContain('Model group "default-group" is unavailable: no-candidates')
      expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
    }),
)

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
      quote: { status: "unknown" },
      quoteOrigin: undefined,
      quota: undefined,
      connection: undefined,
      limit: selected.limit,
      compaction: undefined,
      transport: undefined,
      chunkTimeout: undefined,
    })
  }),
)

testEffect(Layer.empty).effect("attributes each stateless completion without creating a stored session", () =>
  Effect.gen(function* () {
    const sessions: string[] = []
    const http = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          const session = request.headers["x-omnixa-session"]
          if (!session)
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  error: { type: "MissingSessionID", message: "Session ID is required" },
                },
                { status: 400 },
              ),
            )
          sessions.push(session)
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              `data: ${JSON.stringify({
                id: "completion",
                object: "chat.completion.chunk",
                created: 1,
                model: "gemini",
                choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
              })}\n\ndata: [DONE]\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            ),
          )
        }),
      ),
    )
    const native = LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(http))))
    yield* Effect.gen(function* () {
      const generate = yield* Generate.Service
      for (let index = 0; index < 2; index++) {
        expect(
          yield* generate.text({
            prompt: "Return exactly OK",
            model: Ref.make({ providerID: selected.providerID, id: selected.id }),
          }),
        ).toBe("OK")
      }
    }).pipe(Effect.provide(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, native)))))
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toStartWith("ses_")
    expect(sessions[1]).not.toBe(sessions[0])
  }),
)
