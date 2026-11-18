import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@aigcfroge/core/provider"

describe("Provider", () => {
  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@aigcfroge/ai/providers/baseten",
      "@aigcfroge/ai/providers/cerebras",
      "@aigcfroge/ai/providers/cloudflare-ai-gateway",
      "@aigcfroge/ai/providers/cloudflare-workers-ai",
      "@aigcfroge/ai/providers/cohere",
      "@aigcfroge/ai/providers/cohere/chat",
      "@aigcfroge/ai/providers/deepinfra",
      "@aigcfroge/ai/providers/deepseek",
      "@aigcfroge/ai/providers/fireworks",
      "@aigcfroge/ai/providers/google-vertex",
      "@aigcfroge/ai/providers/google-vertex/gemini",
      "@aigcfroge/ai/providers/google-vertex/interactions",
      "@aigcfroge/ai/providers/google-vertex/chat",
      "@aigcfroge/ai/providers/google-vertex/responses",
      "@aigcfroge/ai/providers/google-vertex/messages",
      "@aigcfroge/ai/providers/groq",
      "@aigcfroge/ai/providers/mistral",
      "@aigcfroge/ai/providers/togetherai",
      "@aigcfroge/ai/providers/vercel-ai-gateway",
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
