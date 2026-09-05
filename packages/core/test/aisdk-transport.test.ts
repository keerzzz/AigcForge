import { describe, expect, test } from "bun:test"
import { AISDK } from "@aigcfroge/core/aisdk"
import { AISDKTransport } from "@aigcfroge/core/aisdk/transport"

/**
 * S3b — the three provider deadlines, driven with a fake fetch.
 *
 * These are timing decisions, so they are asserted rather than reasoned about. Each case is a
 * different silence, and the point of having three knobs is that none of them covers another:
 * a total timeout kills a legitimately long turn, and a chunk timeout never fires when the
 * provider accepts the connection and then says nothing at all.
 */
const sse = (chunks: ReadableStream<Uint8Array>) =>
  new Response(chunks, { headers: { "content-type": "text/event-stream" } })

const drain = async (response: Response) => {
  const reader = response.body!.getReader()
  const seen: string[] = []
  for (;;) {
    const part = await reader.read()
    if (part.done) return seen
    seen.push(new TextDecoder().decode(part.value))
  }
}

describe("headerTimeout", () => {
  test("aborts when no response head ever arrives", async () => {
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { headerTimeout: 30 },
      fetch: (_resource, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")))
        }),
    })
    await expect(wrapped("https://provider.test/v1/messages")).rejects.toThrow(/No response head for 30ms/)
  })

  test("does not fire once the head has arrived, however slow the body is", async () => {
    // The regression this guards: arming the header deadline for the whole exchange would kill
    // a stream that is answering normally but slowly.
    let release: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode("data: late\n\n"))
          controller.close()
        }
      },
    })
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { headerTimeout: 20 },
      fetch: async () => sse(stream),
    })
    const response = await wrapped("https://provider.test/v1/messages")
    await new Promise((resolve) => setTimeout(resolve, 60))
    release?.()
    expect(await drain(response)).toEqual(["data: late\n\n"])
  })

  test("is off when set to false", async () => {
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { headerTimeout: false },
      fetch: async () => new Response("ok"),
    })
    expect(await (await wrapped("https://provider.test/v1/messages")).text()).toBe("ok")
  })
})

describe("chunkTimeout", () => {
  test("aborts when the stream goes quiet mid-answer", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"))
      },
    })
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { chunkTimeout: 30 },
      fetch: async () => sse(stream),
    })
    const response = await wrapped("https://provider.test/v1/messages")
    await expect(drain(response)).rejects.toThrow(/No stream chunk for 30ms/)
  })

  test("leaves a stream that keeps producing alone", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a"))
        controller.enqueue(new TextEncoder().encode("b"))
        controller.close()
      },
    })
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { chunkTimeout: 50 },
      fetch: async () => sse(stream),
    })
    expect(await drain(await wrapped("https://provider.test/v1/messages"))).toEqual(["a", "b"])
  })

  test("does not watch a non-streaming response", async () => {
    // A complete body has already arrived, so a gap between reads means nothing.
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { chunkTimeout: 10 },
      fetch: async () => new Response("plain", { headers: { "content-type": "application/json" } }),
    })
    const response = await wrapped("https://provider.test/v1/messages")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await response.text()).toBe("plain")
  })
})

describe("timeout", () => {
  test("aborts the whole exchange", async () => {
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { timeout: 30 },
      fetch: (_resource, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted by signal")))
        }),
    })
    await expect(wrapped("https://provider.test/v1/messages")).rejects.toThrow(/aborted/)
  })

  test("is off when omitted", async () => {
    const wrapped = AISDKTransport.withDeadlines({ deadlines: {}, fetch: async () => new Response("ok") })
    expect(await (await wrapped("https://provider.test/v1/messages")).text()).toBe("ok")
  })

  test("keeps a caller's own abort signal working alongside the deadlines", async () => {
    const controller = new AbortController()
    const wrapped = AISDKTransport.withDeadlines({
      deadlines: { timeout: 5_000 },
      fetch: (_resource, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted by caller")))
        }),
    })
    const pending = wrapped("https://provider.test/v1/messages", { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted by caller/)
  })
})

describe("pick", () => {
  test("reads the three deadlines and ignores everything else", () => {
    expect(
      AISDKTransport.pick({ timeout: 1, headerTimeout: false, chunkTimeout: 3, apiKey: "sk", region: "us" }),
    ).toEqual({ timeout: 1, headerTimeout: false, chunkTimeout: 3 })
  })

  test("treats absent settings as no deadlines", () => {
    expect(AISDKTransport.pick(undefined)).toEqual({})
  })

  test("ignores values that are neither a number nor false", () => {
    // The schema rejects these, but the adapter also sees settings merged from a catalog, so it
    // must not act on something it cannot interpret.
    expect(AISDKTransport.pick({ timeout: "5s", headerTimeout: null, chunkTimeout: true })).toEqual({
      timeout: undefined,
      headerTimeout: undefined,
      chunkTimeout: undefined,
    })
  })
})

describe("deadline precedence in prepareOptions", () => {
  const model = (settings: Record<string, unknown>, body: Record<string, unknown> = {}) => ({
    providerID: "openai",
    api: { type: "aisdk" as const, settings },
    request: { body },
  })

  test("a request body cannot change a provider transport deadline", () => {
    // The body is spread over the settings when building the option bag, so reading the
    // deadlines from the body's source would let a model-level field silently retune the
    // transport for the whole provider. The deadlines are read from settings first.
    const options = AISDK.prepareOptions(model({ timeout: 120_000 }, { timeout: 1 }), "@ai-sdk/openai")
    // Consumed by us either way, so the bag must not carry it onward.
    expect(options.timeout).toBeUndefined()
    expect(typeof options.fetch).toBe("function")
  })

  test("a body deadline does not shorten the one the provider settings declared", async () => {
    // The observable form of the same rule. The fake fetch only settles when its signal
    // aborts, so a 1ms deadline would reject almost immediately and a 5s one will not. The
    // window is the assertion — it measures that nothing fired — which is why it waits rather
    // than polling for a signal.
    const hang: AISDKTransport.Fetch = (_resource, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    const options = AISDK.prepareOptions(model({ timeout: 5_000, fetch: hang }, { timeout: 1 }), "@ai-sdk/openai")
    const pending = options.fetch("https://provider.test/v1/messages")
    const outcome = await Promise.race([
      pending.then(() => "resolved" as const).catch(() => "aborted" as const),
      new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 60)),
    ])
    expect(outcome).toBe("still-open")
  })

  test("none of the three deadlines are forwarded to the provider package", () => {
    const options = AISDK.prepareOptions(
      model({ timeout: 1_000, headerTimeout: 2_000, chunkTimeout: 3_000, apiKey: "sk-test" }),
      "@ai-sdk/openai",
    )
    expect(options).not.toHaveProperty("timeout")
    expect(options).not.toHaveProperty("headerTimeout")
    expect(options).not.toHaveProperty("chunkTimeout")
    // Everything else still reaches the package untouched.
    expect(options.apiKey).toBe("sk-test")
    expect(options.name).toBe("openai")
  })

  test("model request body options still reach the provider package", () => {
    const options = AISDK.prepareOptions(model({ apiKey: "sk" }, { reasoningEffort: "high" }), "@ai-sdk/openai")
    expect(options.reasoningEffort).toBe("high")
  })
})
