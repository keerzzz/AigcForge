import { describe, expect, test } from "bun:test"
import { createTimelineSseTransport } from "../timeline/session-timeline-sse"

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string) {
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes(marker)) {
    const next = await reader.read()
    if (next.done) throw new Error("SSE closed before the expected event")
    text += decoder.decode(next.value, { stream: true })
  }
  return text
}

describe("timeline benchmark persistent SSE", () => {
  test("delivers paced events on one open HTTP response, including pre-connection events", async () => {
    const transport = await createTimelineSseTransport<{ index: number }>({ batch: 1, intervalMs: 1 })
    const abort = new AbortController()
    try {
      transport.enqueue({ index: 1 })
      const response = await fetch(transport.url, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
      })
      expect(response.headers.get("content-type")).toBe("text/event-stream")
      if (!response.body) throw new Error("Missing SSE body")
      const reader = response.body.getReader()
      const first = await readUntil(reader, '"index":1')
      expect(first).toContain("server.connected")
      transport.enqueue([{ index: 2 }, { index: 3 }])
      const rest = await readUntil(reader, '"index":3')
      expect(rest).toContain('"index":2')
      expect(rest.indexOf('"index":2')).toBeLessThan(rest.indexOf('"index":3'))
      expect(transport.pendingCount()).toBe(0)
      expect(transport.connectionCount()).toBe(1)
      abort.abort()
      reader.releaseLock()
    } finally {
      abort.abort()
      await transport.close()
    }
  })

  test("cleanup is idempotent and rejects enqueue after closing", async () => {
    const transport = await createTimelineSseTransport({ batch: 1, intervalMs: 1 })
    await transport.close()
    await transport.close()
    expect(() => transport.enqueue({ index: 1 })).toThrow("closed")
  })

  test("invalid pacing cannot create an unbounded or stalled transport", async () => {
    await expect(createTimelineSseTransport({ batch: 0, intervalMs: 16 })).rejects.toThrow("batch")
    await expect(createTimelineSseTransport({ batch: 1, intervalMs: 0 })).rejects.toThrow("interval")
  })
})
