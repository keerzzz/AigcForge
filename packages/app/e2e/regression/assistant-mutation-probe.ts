import { expect, type Page, type Request } from "@playwright/test"

type AssistantMutationReply = { status: number; json: unknown }
type AssistantHeldMutation = {
  request: Request
  origin: string
  path: string
  body: unknown
  reply: ReturnType<typeof Promise.withResolvers<AssistantMutationReply | undefined>>
  done: ReturnType<typeof Promise.withResolvers<void>>
  status?: number
  finished?: boolean
  aborted?: boolean
}

export async function track(
  page: Page,
  replies: Map<string, unknown>,
  mutationPaths: string[],
  options?: { origin: string },
) {
  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const origins = new Set(
    options
      ? [new URL(options.origin).origin]
      : [
          `http://127.0.0.1:${apiPort}`,
          `http://localhost:${apiPort}`,
          new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`)
            .origin,
        ],
  )
  const writes = new Set(mutationPaths)
  const matches = (url: URL) => origins.has(url.origin) && (replies.has(url.pathname) || writes.has(url.pathname))
  const reads = new Map<
    Request,
    { origin: string; path: string; status?: number; finished?: boolean; failure?: string }
  >()
  const mutations: AssistantHeldMutation[] = []
  const observations: Array<{ phase: string; counts: Record<string, number>; mutations: number }> = []
  const count = (path: string) => [...reads.values()].filter((read) => read.path === path).length
  const frames = () =>
    page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
  let closing = false

  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "GET" && matches(url) && replies.has(url.pathname)) {
      reads.set(request, { origin: url.origin, path: url.pathname })
    }
  })
  page.on("response", (response) => {
    const read = reads.get(response.request())
    if (!read) return
    read.status = response.status()
    void response.finished().then(
      (failure) => {
        read.finished = true
        if (failure) read.failure = failure.message
      },
      (failure: unknown) => {
        read.finished = true
        read.failure = String(failure)
      },
    )
  })
  page.on("requestfailed", (request) => {
    const read = reads.get(request)
    if (!read) return
    read.finished = true
    read.failure = request.failure()?.errorText ?? "request failed"
  })
  await page.route(matches, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET" && replies.has(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(replies.get(path)),
      })
    }
    if (request.method() !== "POST" || !writes.has(path)) return route.fallback()
    const mutation: AssistantHeldMutation = {
      request,
      origin: new URL(request.url()).origin,
      path,
      body: request.postData() === null ? null : request.postDataJSON(),
      reply: Promise.withResolvers<AssistantMutationReply | undefined>(),
      done: Promise.withResolvers<void>(),
    }
    mutations.push(mutation)
    if (closing) mutation.reply.resolve(undefined)
    try {
      const reply = await mutation.reply.promise
      if (!reply) {
        mutation.aborted = true
        return await route.abort("aborted")
      }
      mutation.status = reply.status
      await route.fulfill({
        status: reply.status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(reply.json),
      })
    } finally {
      mutation.done.resolve()
    }
  })

  return {
    mutations,
    count,
    async settle(phase: string) {
      // Finish actual response bodies around two render barriers; SSE is not a readiness signal.
      await frames()
      await expect.poll(() => [...reads.values()].every((read) => read.finished)).toBe(true)
      await frames()
      await expect.poll(() => [...reads.values()].every((read) => read.finished)).toBe(true)
      reads.forEach((read) => {
        expect(read.status, `${phase}: ${read.path}`).toBe(200)
        expect(read.failure, `${phase}: ${read.path}`).toBeUndefined()
      })
      observations.push({
        phase,
        counts: Object.fromEntries([...replies.keys()].map((path) => [path, count(path)])),
        mutations: mutations.length,
      })
    },
    async complete(index: number, reply: AssistantMutationReply) {
      const mutation = mutations[index]
      if (!mutation) throw new Error(`No held Assistant mutation at index ${index}`)
      mutation.reply.resolve(reply)
      const response = await mutation.request.response()
      if (!response) throw new Error(`Assistant mutation failed before its response: ${mutation.path}`)
      expect(response.status()).toBe(reply.status)
      expect(await response.finished()).toBeNull()
      mutation.finished = true
    },
    async close() {
      // A failed RED assertion must release every duplicate, including requests arriving during cleanup.
      closing = true
      mutations.forEach((mutation) => mutation.reply.resolve(undefined))
      await Promise.all(mutations.map((mutation) => mutation.done.promise))
    },
    receipt: () => ({
      observations,
      reads: [...reads.values()],
      mutations: mutations.map((mutation) => ({
        origin: mutation.origin,
        path: mutation.path,
        body: mutation.body,
        status: mutation.status,
        finished: mutation.finished,
        aborted: mutation.aborted,
      })),
    }),
  }
}

export * as AssistantMutationProbe from "./assistant-mutation-probe"
