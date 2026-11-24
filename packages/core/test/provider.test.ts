import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@omnixa/core/provider"

describe("Provider", () => {
  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@omnixa/ai/providers/baseten",
      "@omnixa/ai/providers/cerebras",
      "@omnixa/ai/providers/cloudflare-ai-gateway",
      "@omnixa/ai/providers/cloudflare-workers-ai",
      "@omnixa/ai/providers/cohere",
      "@omnixa/ai/providers/cohere/chat",
      "@omnixa/ai/providers/deepinfra",
      "@omnixa/ai/providers/deepseek",
      "@omnixa/ai/providers/fireworks",
      "@omnixa/ai/providers/google-vertex",
      "@omnixa/ai/providers/google-vertex/gemini",
      "@omnixa/ai/providers/google-vertex/interactions",
      "@omnixa/ai/providers/google-vertex/chat",
      "@omnixa/ai/providers/google-vertex/responses",
      "@omnixa/ai/providers/google-vertex/messages",
      "@omnixa/ai/providers/groq",
      "@omnixa/ai/providers/mistral",
      "@omnixa/ai/providers/togetherai",
      "@omnixa/ai/providers/vercel-ai-gateway",
    ]

    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
        transport: "websocket",
      }),
    ).toEqual({
      apiKey: "secret",
      reasoningEffort: "high",
    })
  })

  test("inherits shared and loose settings without provider-only policies", () => {
    expect(
      Provider.modelSettings({
        timeout: 60_000,
        chunkTimeout: 30_000,
        transport: "websocket",
        compaction: { type: "native" },
        reasoningEffort: "high",
      }),
    ).toEqual({
      compaction: { type: "native" },
      reasoningEffort: "high",
    })
  })
})
