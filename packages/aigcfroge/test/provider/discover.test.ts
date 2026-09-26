import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ProviderDiscover } from "@/provider/discover"
import { testEffect } from "../lib/effect"

let lastUrl = ""
let lastAuth: string | undefined
let lastApiKey: string | undefined

function mockHttp(handler: (url: string) => Response) {
  const client = HttpClient.make((request) => {
    lastUrl = request.url
    lastAuth = request.headers["authorization"]
    lastApiKey = request.headers["x-api-key"]
    return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url)))
  })
  return Layer.succeed(HttpClient.HttpClient, client)
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const it = testEffect(Layer.empty)

describe("discoverModelsFromEndpoint", () => {
  it.live("lists models from an OpenAI-compatible endpoint", () =>
    Effect.gen(function* () {
      const models = yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/v1",
        api: "@ai-sdk/openai-compatible",
        apiKey: "sk-test",
      }).pipe(Effect.provide(mockHttp(() => json({ data: [{ id: "model-a" }, { id: "model-b" }] }))))

      expect(models).toEqual([{ id: "model-a" }, { id: "model-b" }])
      expect(lastUrl).toBe("https://api.example.com/v1/models")
      expect(lastAuth).toBe("Bearer sk-test")
    }),
  )

  it.live("reads Anthropic display names from the /v1/models path", () =>
    Effect.gen(function* () {
      const models = yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/anthropic/v1",
        api: "@ai-sdk/anthropic",
        apiKey: "sk-ant",
      }).pipe(Effect.provide(mockHttp(() => json({ data: [{ id: "claude-x", display_name: "Claude X" }] }))))

      expect(models).toEqual([{ id: "claude-x", name: "Claude X" }])
      expect(lastUrl).toBe("https://api.example.com/anthropic/v1/models")
      expect(lastApiKey).toBe("sk-ant")
    }),
  )

  it.live("uses the configured Anthropic base verbatim", () =>
    Effect.gen(function* () {
      yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/anthropic",
        api: "@ai-sdk/anthropic",
      }).pipe(Effect.provide(mockHttp(() => json({ data: [] }))))

      // The SDK posts to `${baseURL}/messages`, so the probe must not insert a
      // `/v1` the model call would not use.
      expect(lastUrl).toBe("https://api.example.com/anthropic/models")
    }),
  )

  it.live("follows Anthropic pagination cursors", () =>
    Effect.gen(function* () {
      const urls: string[] = []
      const models = yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/v1",
        api: "@ai-sdk/anthropic",
        apiKey: "sk-ant",
      }).pipe(
        Effect.provide(
          mockHttp((url) => {
            urls.push(url)
            if (url.endsWith("after_id=model-a"))
              return json({ data: [{ id: "model-b" }], has_more: false, last_id: "model-b" })
            return json({ data: [{ id: "model-a" }], has_more: true, last_id: "model-a" })
          }),
        ),
      )

      expect(models).toEqual([{ id: "model-a" }, { id: "model-b" }])
      expect(urls).toEqual(["https://api.example.com/v1/models", "https://api.example.com/v1/models?after_id=model-a"])
    }),
  )

  it.live("maps a 401 response to an auth error", () =>
    Effect.gen(function* () {
      const error = yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/v1",
        api: "@ai-sdk/openai-compatible",
        apiKey: "bad",
      }).pipe(Effect.provide(mockHttp(() => json({ error: "unauthorized" }, 401))), Effect.flip)

      expect(error._tag).toBe("ProviderDiscoverAuthError")
    }),
  )

  it.live("maps a malformed body to a parse error", () =>
    Effect.gen(function* () {
      const error = yield* ProviderDiscover.discoverModelsFromEndpoint({
        baseURL: "https://api.example.com/v1",
        api: "@ai-sdk/openai-compatible",
        apiKey: "sk-test",
      }).pipe(Effect.provide(mockHttp(() => json({ unexpected: true }))), Effect.flip)

      expect(error._tag).toBe("ProviderDiscoverParseError")
    }),
  )
})
