import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createClientConnection } from "../src/solid"
import { AigcForge, type AigcForgeEvent } from "../src/promise"

const connected = { id: "evt_connected", created: 1, type: "server.connected", data: {} }

// One fake server whose event streams stay open until the test writes to them or the client aborts.
function server(onStart?: () => void) {
  const encoder = new TextEncoder()
  const streams: {
    headers: Headers
    write: (text: string) => void
    close: () => void
    error: (reason: Error) => void
    aborted: boolean
  }[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const entry = {
        headers: request.headers,
        write: (text: string) => controller.enqueue(encoder.encode(text)),
        close: () => controller.close(),
        error: (reason: Error) => controller.error(reason),
        aborted: false,
      }
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
        },
        cancel() {
          entry.aborted = true
        },
      })
      request.signal.addEventListener("abort", () => {
        entry.aborted = true
        controller.error(request.signal.reason)
      })
      streams.push(entry)
      onStart?.()
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { api, streams }
}

function setup(input: ReturnType<typeof server>, idleTimeout: number) {
  const events: AigcForgeEvent[] = []
  return createRoot((dispose) => ({
    events,
    dispose,
    connection: createClientConnection(input.api, {
      idleTimeout,
      flushInterval: 0,
      onEvent: (event) => events.push(event),
    }),
  }))
}

async function until(check: () => boolean, timeout = 2_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test("a stream that goes silent past the idle timeout is replaced", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    await until(() => fake.streams.length === 2)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Event stream stalled",
    })

    fake.streams[1].write(`data: ${JSON.stringify({ ...connected, id: "evt_connected_2" })}\n\n`)
    await until(() => ctx.connection.status() === "connected" && ctx.events.length === 2)
    expect(ctx.connection.error()).toBeUndefined()
  } finally {
    ctx.dispose()
  }
})

test("keepalive comments hold a quiet stream open", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const heartbeat = setInterval(() => fake.streams[0].write(": heartbeat\n\n"), 20)
    await new Promise((resolve) => setTimeout(resolve, 250))
    clearInterval(heartbeat)

    expect(fake.streams).toHaveLength(1)
    expect(fake.streams[0].aborted).toBe(false)
    expect(ctx.connection.status()).toBe("connected")
    expect(ctx.events).toHaveLength(1)
  } finally {
    ctx.dispose()
  }
})

test("a forced resync replaces the stream immediately and only while connected", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    ctx.connection.internal.resync("too early")
    await until(() => fake.streams.length === 1)
    expect(fake.streams[0].aborted).toBe(false)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const started = Date.now()
    ctx.connection.internal.resync("Network connection restored")
    await until(() => fake.streams.length === 2)
    expect(Date.now() - started).toBeLessThan(500)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Network connection restored",
    })
    fake.streams[1].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")
  } finally {
    ctx.dispose()
  }
})

test.each([
  ["closes", (stream: ReturnType<typeof server>["streams"][number]) => stream.close(), "Event stream disconnected"],
  [
    "fails",
    (stream: ReturnType<typeof server>["streams"][number]) => stream.error(new Error("contract failure")),
    "Transport: contract failure",
  ],
])("a stream the server %s reconnects and reports the disconnect", async (_name, end, message) => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    end(fake.streams[0])
    await until(() => ctx.connection.status() === "reconnecting")
    expect(ctx.connection.error()).toBe(message)
    await until(() => fake.streams.length === 2)
  } finally {
    ctx.dispose()
  }
})

test("a reconnect does not ask the volatile event stream to replay", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    fake.streams[0].write(`id: timeline-event-7\ndata: ${JSON.stringify({ ...connected, id: "evt_2" })}\n\n`)
    await until(() => ctx.events.length === 2)

    fake.streams[0].error(new Error("retry with event id"))
    await until(() => fake.streams.length === 2)
    expect(fake.streams[1].headers.get("last-event-id")).toBeNull()
  } finally {
    ctx.dispose()
  }
})

test.each(["managed", "explicit"] as const)(
  "MC09 %s API replacement revokes the previous stream and buffered events",
  async (mode) => {
    const firstStarted = Promise.withResolvers<void>()
    const nextStarted = Promise.withResolvers<void>()
    const firstConnected = Promise.withResolvers<void>()
    const buffered = Promise.withResolvers<void>()
    const delivered = Promise.withResolvers<void>()
    const first = server(() => firstStarted.resolve())
    const next = server(() => nextStarted.resolve())
    const events: AigcForgeEvent[] = []
    const ctx = createRoot((dispose) => ({
      dispose,
      connection: createClientConnection(first.api, {
        flushInterval: 0,
        reconnect: mode === "managed" ? async () => next.api : undefined,
        onEvent(event) {
          events.push(event)
          if (event.id === "evt_next_owner") delivered.resolve()
        },
        log: {
          info(message) {
            if (message === "event stream connected") firstConnected.resolve()
          },
          debug(message, data) {
            if (message === "event" && data?.aggregateID === "ses_shared") buffered.resolve()
          },
        },
      }),
    }))
    try {
      await firstStarted.promise
      first.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
      await firstConnected.promise
      const old: Extract<AigcForgeEvent, { type: "task.updated" }> = {
        id: "evt_previous_owner",
        created: 2,
        type: "task.updated",
        durable: { aggregateID: "ses_shared", seq: 1, version: 1 },
        data: { sessionID: "ses_shared", tasks: [] },
      }
      first.streams[0].write(`data: ${JSON.stringify(old)}\n\n`)
      await buffered.promise
      if (mode === "managed") first.streams[0].error(new Error("Switch managed server"))
      if (mode === "explicit") ctx.connection.internal.replaceApi(next.api)
      await nextStarted.promise
      next.streams[0].write(`data: ${JSON.stringify({ ...connected, id: "evt_next_connected" })}\n\n`)
      next.streams[0].write(`data: ${JSON.stringify({ ...old, id: "evt_next_owner" })}\n\n`)
      await delivered.promise
      expect(events.map((event) => event.id)).not.toContain("evt_previous_owner")
      expect(events.map((event) => event.id)).toContain("evt_next_owner")
      expect(first.streams[0].aborted).toBe(true)
      expect(ctx.connection.status()).toBe("connected")
      expect(next.streams[0].headers.get("last-event-id")).toBeNull()
    } finally {
      ctx.dispose()
    }
  },
)
