import { createServer, type ServerResponse } from "node:http"

/** A paced, persistent stream: producer cadence is workload, not an assertion delay. */
export async function createTimelineSseTransport<T>(options: { batch: number; intervalMs: number }) {
  if (!Number.isInteger(options.batch) || options.batch < 1) throw new Error("SSE batch must be a positive integer")
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) throw new Error("SSE interval must be positive")

  const queue: string[] = []
  const clients = new Set<ServerResponse>()
  let connections = 0
  let sequence = 0
  let closing: Promise<void> | undefined
  const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
  const signal = (type: "server.connected" | "server.heartbeat") =>
    frame({ directory: "global", payload: { id: `evt_benchmark_${++sequence}`, type, properties: {} } })
  const server = createServer((request, response) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,OPTIONS",
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers).end()
      return
    }
    if (request.method !== "GET" || request.url !== "/events" || closing) {
      response.writeHead(404, headers).end()
      return
    }
    response.writeHead(200, {
      ...headers,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    })
    response.flushHeaders()
    connections += 1
    clients.add(response)
    response.on("close", () => clients.delete(response))
    response.on("error", () => clients.delete(response))
    response.write(signal("server.connected"))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing SSE server address")

  const pump = setInterval(() => {
    if (!clients.size || !queue.length) return
    if ([...clients].some((client) => client.writableNeedDrain)) return
    const data = queue.splice(0, options.batch).join("")
    for (const client of clients) client.write(data)
  }, options.intervalMs)
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.writableNeedDrain) continue
      client.write(signal("server.heartbeat"))
    }
  }, 10_000)
  pump.unref()
  heartbeat.unref()

  return {
    url: `http://127.0.0.1:${address.port}/events`,
    enqueue(events: T | T[]) {
      if (closing) throw new Error("SSE transport is closed")
      queue.push(...(Array.isArray(events) ? events : [events]).map(frame))
    },
    pendingCount: () => queue.length,
    connectionCount: () => connections,
    async close() {
      if (closing) return closing
      clearInterval(pump)
      clearInterval(heartbeat)
      for (const client of clients) client.end()
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
      return closing
    },
  }
}
