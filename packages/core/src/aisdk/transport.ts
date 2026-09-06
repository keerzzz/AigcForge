export * as AISDKTransport from "./transport"

import type { Provider } from "@aigcfroge/schema/provider"

/**
 * The three provider transport deadlines, applied to one fetch.
 *
 * Split out of `aisdk.ts` so the behaviour can be driven with a fake fetch instead of a real
 * provider: every case below is a timing decision, and timing decisions are the ones worth
 * asserting rather than reasoning about.
 *
 * The three cover different silences, which is why one of them cannot stand in for the others:
 *
 *   headerTimeout  nothing came back at all — the request never got a response head
 *   chunkTimeout   the head arrived and then the stream went quiet mid-answer
 *   timeout        the whole exchange took too long, however busy it looked
 *
 * A total timeout alone would kill a legitimately long turn, and a chunk timeout alone never
 * fires when the provider accepts the connection and then says nothing.
 */
/**
 * The call signature only. `typeof fetch` carries Bun's `preconnect` property, which nothing
 * here uses and which would force every caller and every test double to fake it.
 */
export type Fetch = (resource: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>

export type Deadlines = {
  readonly timeout?: Provider.Deadline
  readonly headerTimeout?: Provider.Deadline
  readonly chunkTimeout?: Provider.Deadline
}

/** `false` is the explicit off switch; omitted means the same. `0` is not a value. */
const active = (value: Provider.Deadline | undefined) => (typeof value === "number" && value > 0 ? value : undefined)

export function pick(settings: Record<string, unknown> | undefined): Deadlines {
  if (!settings) return {}
  const read = (key: "timeout" | "headerTimeout" | "chunkTimeout") => {
    const value = settings[key]
    if (value === false) return false
    if (typeof value === "number") return value
    return undefined
  }
  return { timeout: read("timeout"), headerTimeout: read("headerTimeout"), chunkTimeout: read("chunkTimeout") }
}

/**
 * The values V1 has shipped in production, reused rather than re-derived.
 *
 * V1 applies the chunk deadline to every provider and the header deadline only to the OpenAI
 * package, and those are the two facts being mirrored — not the constants themselves, which
 * stay on the retiring side.
 */
export const DEFAULT_CHUNK_TIMEOUT = 60_000
export const DEFAULT_HEADER_TIMEOUT = 10_000

/**
 * Fill in the deadlines nobody declared.
 *
 * `false` is a decision, so it is never overwritten — only an absent field takes a fallback.
 * Without this, V2 shipped every deadline off by default and a provider that went quiet was
 * bounded on the client alone.
 */
export function withFallbacks(
  deadlines: Deadlines,
  fallbacks: { readonly header?: number; readonly chunk?: number; readonly total?: number },
): Deadlines {
  return {
    timeout: deadlines.timeout ?? fallbacks.total,
    headerTimeout: deadlines.headerTimeout ?? fallbacks.header,
    chunkTimeout: deadlines.chunkTimeout ?? fallbacks.chunk,
  }
}

/**
 * Guard the stream so a provider that stops mid-answer aborts instead of hanging.
 *
 * Only SSE bodies are watched: a non-streaming response is already complete when it arrives,
 * so a gap between reads means nothing there.
 */
function watchChunks(response: Response, ms: number, controller: AbortController) {
  if (!response.body) return response
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response

  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(target) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new Error(`No stream chunk for ${ms}ms`)
          controller.abort(error)
          void reader.cancel(error)
          reject(error)
        }, ms)
        reader.read().then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
      if (part.done) {
        target.close()
        return
      }
      target.enqueue(part.value)
    },
    async cancel(reason) {
      controller.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  })
}

/**
 * Wrap a fetch so the three deadlines apply to it.
 *
 * `headerTimeout` and `timeout` are separate signals rather than one: the header deadline is
 * cleared the moment a response head arrives, so a slow-but-alive stream is not killed by the
 * budget that only existed to catch a provider that never answered.
 */
export function withDeadlines(input: { readonly deadlines: Deadlines; readonly fetch: Fetch }): Fetch {
  const timeout = active(input.deadlines.timeout)
  const headerTimeout = active(input.deadlines.headerTimeout)
  const chunkTimeout = active(input.deadlines.chunkTimeout)

  return async (resource, init) => {
    const options = { ...init }
    const chunkController = chunkTimeout === undefined ? undefined : new AbortController()
    const headerController = headerTimeout === undefined ? undefined : new AbortController()
    const headerTimer =
      headerTimeout === undefined
        ? undefined
        : setTimeout(() => headerController?.abort(new Error(`No response head for ${headerTimeout}ms`)), headerTimeout)

    const signals = [
      options.signal ?? undefined,
      chunkController?.signal,
      headerController?.signal,
      timeout === undefined ? undefined : AbortSignal.timeout(timeout),
    ].filter((value): value is AbortSignal => Boolean(value))
    if (signals.length === 1) options.signal = signals[0]
    if (signals.length > 1) options.signal = AbortSignal.any(signals)

    try {
      const response = await input.fetch(resource, options)
      // The head is here, so the header deadline has done its job. Leaving it armed would
      // abort a stream that is answering normally, just slowly.
      if (headerTimer !== undefined) clearTimeout(headerTimer)
      if (chunkTimeout === undefined || !chunkController) return response
      return watchChunks(response, chunkTimeout, chunkController)
    } catch (error) {
      if (headerTimer !== undefined) clearTimeout(headerTimer)
      throw error
    }
  }
}
