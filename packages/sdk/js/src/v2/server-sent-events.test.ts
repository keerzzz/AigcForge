import { describe, expect, test } from "bun:test"
import { createSseClient } from "./gen/core/serverSentEvents.gen.js"

describe("SSE transport cancellation", () => {
  test("aborts a native request before response headers without retrying", async () => {
    const received = Promise.withResolvers<void>()
    const headers = Promise.withResolvers<Response>()
    const requests: Request[] = []
    await withServer(
      (request) => {
        requests.push(request)
        received.resolve()
        return headers.promise
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const sleeps: number[] = []
        const errors: unknown[] = []
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          onSseError: (error) => errors.push(error),
          sseSleepFn: async (ms) => {
            sleeps.push(ms)
          },
        })
        const next = events.stream.next()
        try {
          await within(received.promise, "native server did not receive the pending request")
          controller.abort()
          // Headers remain withheld: completion requires cancellation of the native request.
          expect(await within(next, "pending native request did not stop after abort")).toEqual({
            done: true,
            value: undefined,
          })
          expect(requests).toHaveLength(1)
          expect(sleeps).toEqual([])
          expect(errors).toEqual([])
        } finally {
          controller.abort()
          headers.resolve(new Response(null, { status: 204 }))
          await dispose(events.stream)
        }
      },
    )
  })

  test("aborts a pending native body read and cancels the server response", async () => {
    const cancelled = Promise.withResolvers<void>()
    const requests: Request[] = []
    await withServer(
      (request) => {
        requests.push(request)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(source) {
              source.enqueue(new TextEncoder().encode("data: 1\n\n"))
            },
            cancel() {
              cancelled.resolve()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const sleeps: number[] = []
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          sseSleepFn: async (ms) => {
            sleeps.push(ms)
          },
        })
        try {
          expect(await within(events.stream.next(), "first native SSE event was not received")).toEqual({
            done: false,
            value: 1,
          })
          // The first event establishes the reader; the open body has no second event.
          const next = events.stream.next()
          controller.abort()
          expect(await within(next, "pending native body read did not stop after abort")).toEqual({
            done: true,
            value: undefined,
          })
          await within(cancelled.promise, "native server response body was not cancelled")
          expect(requests).toHaveLength(1)
          expect(sleeps).toEqual([])
        } finally {
          controller.abort()
          await dispose(events.stream)
        }
      },
    )
  })

  test("stops waiting for a held retry delay after a real HTTP failure", async () => {
    const requests: Request[] = []
    await withServer(
      (request) => {
        requests.push(request)
        return new Response(null, { status: 503 })
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const sleeping = Promise.withResolvers<number>()
        const releaseSleep = Promise.withResolvers<void>()
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          sseSleepFn: (ms) => {
            sleeping.resolve(ms)
            return releaseSleep.promise
          },
        })
        const next = events.stream.next()
        try {
          expect(await within(sleeping.promise, "real HTTP 503 did not enter retry backoff")).toBe(3000)
          controller.abort()
          // The custom sleep remains unresolved until cleanup; it does not replace native fetch.
          expect(await within(next, "abort kept waiting for the held retry delay")).toEqual({
            done: true,
            value: undefined,
          })
          expect(requests).toHaveLength(1)
        } finally {
          controller.abort()
          releaseSleep.resolve()
          await dispose(events.stream)
        }
      },
    )
  })

  test("cancels an open native HTTP error response before continuing retry backoff", async () => {
    const cancelled = Promise.withResolvers<void>()
    const requests: Request[] = []
    await withServer(
      (request) => {
        requests.push(request)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(source) {
              source.enqueue(new TextEncoder().encode("temporarily unavailable\n"))
            },
            cancel() {
              cancelled.resolve()
            },
          }),
          { status: 503 },
        )
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const sleeping = Promise.withResolvers<number>()
        const releaseSleep = Promise.withResolvers<void>()
        const errors: unknown[] = []
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          onSseError: (error) => errors.push(error),
          sseSleepFn: (ms) => {
            sleeping.resolve(ms)
            return releaseSleep.promise
          },
        })
        const next = events.stream.next()
        try {
          expect(await within(sleeping.promise, "open HTTP 503 did not enter retry backoff")).toBe(3000)
          // Hold retry while the server observes cancellation; no abort can cause this cleanup yet.
          await within(cancelled.promise, "HTTP error response remained open during retry backoff")
          expect(errors).toHaveLength(1)
          expect(String(errors[0])).toContain("SSE failed: 503")
          expect(requests).toHaveLength(1)
          controller.abort()
          expect(await within(next, "abort did not stop backoff after disposing the error response")).toEqual({
            done: true,
            value: undefined,
          })
          expect(requests).toHaveLength(1)
        } finally {
          controller.abort()
          releaseSleep.resolve()
          await dispose(events.stream)
        }
      },
    )
  })

  test("stops during the default retry timer after a real HTTP failure", async () => {
    const requests: Request[] = []
    await withServer(
      (request) => {
        requests.push(request)
        return new Response(null, { status: 503 })
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const failed = Promise.withResolvers<void>()
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          onSseError: () => failed.resolve(),
        })
        const next = events.stream.next()
        try {
          // The callback is synchronous; the transport enters its default sleep before this continuation.
          await within(failed.promise, "real HTTP 503 was not observed")
          controller.abort()
          expect(await within(next, "abort waited for the default 3000 ms retry timer")).toEqual({
            done: true,
            value: undefined,
          })
          expect(requests).toHaveLength(1)
        } finally {
          controller.abort()
          await dispose(events.stream)
        }
      },
    )
  }, 10_000)

  test("does not yield a decoded native event after its callback cancels the stream", async () => {
    const cancelled = Promise.withResolvers<void>()
    await withServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(source) {
              source.enqueue(new TextEncoder().encode("data: 1\n\ndata: 2\n\n"))
            },
            cancel() {
              cancelled.resolve()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      async (url, dispose) => {
        const controller = new AbortController()
        const observed: unknown[] = []
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          onSseEvent: (event) => {
            observed.push(event.data)
            controller.abort()
          },
        })
        try {
          // Cancellation occurs after parsing but before yield; this does not assume TCP chunk boundaries.
          expect(await within(events.stream.next(), "decoded event did not stop at the abort boundary")).toEqual({
            done: true,
            value: undefined,
          })
          expect(observed).toEqual([1])
          await within(cancelled.promise, "native server response was not cancelled after the callback")
        } finally {
          controller.abort()
          await dispose(events.stream)
        }
      },
    )
  })
  test("does not start a transformer after cancellation while validating a native event", async () => {
    const cancelled = Promise.withResolvers<void>()
    const validating = Promise.withResolvers<void>()
    const releaseValidation = Promise.withResolvers<void>()
    await withServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(source) {
              source.enqueue(new TextEncoder().encode("data: 1\n\n"))
            },
            cancel() {
              cancelled.resolve()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      async (url, dispose) => {
        const controller = new AbortController()
        const transformed: unknown[] = []
        const observed: unknown[] = []
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          responseValidator: async () => {
            validating.resolve()
            await releaseValidation.promise
          },
          responseTransformer: async (data) => {
            transformed.push(data)
            return data
          },
          onSseEvent: (event) => observed.push(event.data),
        })
        const next = events.stream.next()
        try {
          await within(validating.promise, "native event did not enter the held validator")
          controller.abort()
          // Allow the already-running callback to finish; the next callback must not start.
          releaseValidation.resolve()
          expect(await within(next, "cancelled validation started another callback or event")).toEqual({
            done: true,
            value: undefined,
          })
          expect(transformed).toEqual([])
          expect(observed).toEqual([])
          await within(cancelled.promise, "native response was not cancelled while validation was pending")
        } finally {
          controller.abort()
          releaseValidation.resolve()
          await dispose(events.stream)
        }
      },
    )
  })

  test("handles a rejected custom response cancellation without retrying", async () => {
    const cancelled = Promise.withResolvers<void>()
    const cancellations: unknown[] = []
    const requests: Request[] = []
    const sleeps: number[] = []
    const errors: unknown[] = []
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(new TextEncoder().encode("data: 1\n\n"))
      },
      cancel(reason) {
        cancellations.push(reason)
        cancelled.resolve()
        return Promise.reject(new Error("fixture custom response cancellation failure"))
      },
    })
    const events = createSseClient<number>({
      url: "http://sse.test/event",
      signal: controller.signal,
      fetch: (request) => {
        requests.push(request)
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } })
      },
      onSseError: (error) => errors.push(error),
      sseSleepFn: async (ms) => {
        sleeps.push(ms)
      },
    })
    try {
      expect(await within(events.stream.next(), "custom response did not deliver its first SSE event")).toEqual({
        done: false,
        value: 1,
      })
      const next = events.stream.next()
      controller.abort()
      await within(cancelled.promise, "custom response cancellation callback was not entered")
      expect(await within(next, "rejected response cancellation did not finish the pending read")).toEqual({
        done: true,
        value: undefined,
      })
      expect(cancellations).toHaveLength(1)
      expect(requests).toHaveLength(1)
      expect(sleeps).toEqual([])
      expect(errors).toEqual([])
      expect(
        await within(events.stream.return(), "custom SSE iterator did not return after rejected cancellation"),
      ).toEqual({
        done: true,
        value: undefined,
      })
    } finally {
      controller.abort()
      await within(events.stream.return(), "custom SSE iterator cleanup did not finish", 4000)
    }
  })

  test("retains normal retry and Last-Event-ID when the signal stays active", async () => {
    const lastEventIDs: Array<string | null> = []
    const cancelled = Promise.withResolvers<void>()
    await withServer(
      (request) => {
        lastEventIDs.push(request.headers.get("Last-Event-ID"))
        if (lastEventIDs.length > 1) {
          return new Response("data: 3\n\n", { headers: { "Content-Type": "text/event-stream" } })
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(source) {
              source.enqueue(new TextEncoder().encode("id: evt-first\ndata: 1\n\ndata: 2\n\n"))
            },
            cancel() {
              cancelled.resolve()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      },
      async (url, dispose) => {
        const controller = new AbortController()
        const sleeping = Promise.withResolvers<number>()
        const releaseSleep = Promise.withResolvers<void>()
        const events = createSseClient<number>({
          url,
          signal: controller.signal,
          responseValidator: async (data) => {
            if (data === 2) throw new Error("fixture SSE validation failure")
          },
          sseSleepFn: (ms) => {
            sleeping.resolve(ms)
            return releaseSleep.promise
          },
        })
        try {
          expect(await within(events.stream.next(), "first retry fixture event was not received")).toEqual({
            done: false,
            value: 1,
          })
          const next = events.stream.next()
          expect(await within(sleeping.promise, "validation failure did not enter retry backoff")).toBe(3000)
          await within(cancelled.promise, "failed SSE attempt retained its open native response during retry backoff")
          expect(lastEventIDs).toEqual([null])
          releaseSleep.resolve()
          expect(await within(next, "native retry did not deliver its event")).toEqual({ done: false, value: 3 })
          expect(await within(events.stream.next(), "retried response did not finish")).toEqual({
            done: true,
            value: undefined,
          })
          expect(lastEventIDs).toEqual([null, "evt-first"])
        } finally {
          controller.abort()
          releaseSleep.resolve()
          await dispose(events.stream)
        }
      },
    )
  })
})

async function withServer(
  fetch: (request: Request) => Response | Promise<Response>,
  run: (url: string, dispose: (stream: AsyncGenerator<unknown, void, unknown>) => Promise<void>) => Promise<void>,
) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  let stopping: Promise<void> | undefined
  const stop = () => (stopping ??= server.stop(true))
  try {
    await run(new URL("/event", server.url).toString(), async (stream) => {
      await within(stop(), "native SSE fixture server did not stop")
      // Bound cleanup independently of the cancellation assertion; old backoff may still be running.
      await within(stream.return(), "SSE generator did not drain after the native server stopped", 4000)
    })
  } finally {
    await within(stop(), "native SSE fixture server did not stop")
  }
}

// This is a failure bound, never a readiness delay. Gates and received events establish readiness.
async function within<T>(pending: Promise<T>, message: string, ms = 1000): Promise<T> {
  const expired = Promise.withResolvers<never>()
  const timer = setTimeout(() => expired.reject(new Error(message)), ms)
  try {
    return await Promise.race([pending, expired.promise])
  } finally {
    clearTimeout(timer)
  }
}
