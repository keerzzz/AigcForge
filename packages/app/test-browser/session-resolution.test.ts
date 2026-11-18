import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createClientConnection, createData } from "@aigcfroge/client/solid"
import { Match } from "effect"
import type { AigcForgeEvent, SessionInfo } from "@aigcfroge/client/promise"
import { createSessionResolution } from "@/session/session-resolution"
import { createAigcForgeEventSource, createServerTransport } from "@/runtime/server/client"

type Session = { id: string; directory: string }

const sessionOf = (id: string): Session => ({ id, directory: `/dir/${id}` })

// Fake session store: get reads a reactive cache, sync returns a
// deferred promise the test settles or fails explicitly. The session memo is
// live (read below), so it recomputes eagerly on cache/status writes — throws
// surface at the write site, which is also where the enclosing ErrorBoundary
// would see them in the app. Assertions wrap write + read to cover both.
function createFixture(initial: Record<string, Session> = {}) {
  const [cache, setCache] = createSignal(initial)
  const deferred = new Map<string, PromiseWithResolvers<unknown>>()
  const resolves: string[] = []

  const messages: PromiseWithResolvers<unknown> & { syncs: string[] } = {
    syncs: [],
    ...Promise.withResolvers<unknown>(),
  }

  const pending = { syncs: Array<string>() }

  return {
    resolves,
    messages,
    pending,
    sessions: {
      get: (id: string) => cache()[id],
      sync: (id: string) => {
        resolves.push(id)
        const entry = deferred.get(id) ?? Promise.withResolvers<unknown>()
        deferred.set(id, entry)

        return entry.promise
      },
      message: {
        sync: (id: string) => {
          messages.syncs.push(id)

          return messages.promise
        },
      },
      pending: {
        sync: (id: string) => {
          pending.syncs.push(id)

          return Promise.resolve()
        },
      },
    },
    settle(id: string, directory = `/dir/${id}`) {
      setCache({ ...cache(), [id]: { id, directory } })
      deferred.get(id)?.resolve(undefined)
      deferred.delete(id)
    },
    fail(id: string, error: Error) {
      deferred.get(id)?.reject(error)
      // The real store does not cache failures: the inflight request entry is
      // dropped on rejection so the next resolve retries.
      deferred.delete(id)
    },
    remove(id: string) {
      const next = { ...cache() }
      delete next[id]
      setCache(next)
    },
  }
}

// Two microtask ticks: one for the resolve promise handed back by the fixture,
// one for the .then/.catch chain inside createSessionResolution.
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("four session resolutions share server Data and a stream through reconnect and partial release", async () => {
  const ids = ["ses_main", "ses_root_b", "ses_root_c", "ses_child"]
  const resources = ["info", "message", "inbox"] as const

  function server(origin: string) {
    return createRoot((dispose) => {
      const reads = new Map<string, { started: PromiseWithResolvers<void>; response: PromiseWithResolvers<Response> }>()

      const opened = Array.from({ length: 3 }, () =>
        Promise.withResolvers<{
          send: (event: AigcForgeEvent) => void
          connected: PromiseWithResolvers<void>
          aborted: boolean
        }>(),
      )

      const requests: string[] = []
      const streams: Awaited<(typeof opened)[0]["promise"]>[] = []
      const observed = { subscriptions: 0, reductions: 0 }
      const errors: unknown[] = []

      function read(round: number, id: string, resource: (typeof resources)[number]) {
        const key = `${round}:${id}:${resource}`
        const existing = reads.get(key)

        if (existing) return existing
        const entry = { started: Promise.withResolvers<void>(), response: Promise.withResolvers<Response>() }
        reads.set(key, entry)

        return entry
      }

      const transport = createServerTransport({
        http: { url: origin },
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname

          if (path === "/api/event") {
            let controller!: ReadableStreamDefaultController<Uint8Array>

            const entry = {
              send: (event: AigcForgeEvent) =>
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
              connected: Promise.withResolvers<void>(),
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

            request.signal.addEventListener(
              "abort",
              () => {
                entry.aborted = true
                controller.error(request.signal.reason)
              },
              { once: true },
            )
            const round = streams.push(entry) - 1
            opened[round]!.resolve(entry)

            return new Response(body, { headers: { "content-type": "text/event-stream" } })
          }

          const match = /^\/api\/session\/(ses_main|ses_root_b|ses_root_c|ses_child)(?:\/(message|inbox))?$/.exec(path)

          if (match) {
            const resource = Match.value(match[2]).pipe(
              Match.when("message", () => resources[1]),
              Match.when("inbox", () => resources[2]),
              Match.orElse(() => resources[0]),
            )

            requests.push(`${streams.length - 1}:${match[1]}:${resource}`)
            const entry = read(streams.length - 1, match[1]!, resource)
            entry.started.resolve()

            // Hold the body after headers so the real request queue can admit all four targets.
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  void entry.response.promise.then(
                    async (response) => {
                      controller.enqueue(new Uint8Array(await response.arrayBuffer()))
                      controller.close()
                    },
                    (error) => controller.error(error),
                  )
                },
              }),
              { headers: { "content-type": "application/json" } },
            )
          }

          if (path === "/api/session/active") return Response.json({ data: {} })

          if (path === "/api/project") return Response.json([])

          if (path === "/api/location") return Response.json({ directory: "/project" })

          if (path === "/api/vcs")
            return Response.json({ location: { directory: "/project" }, data: { branch: "main" } })
          throw new Error(`Unexpected fixture request: ${request.url}`)
        },
      })

      const events = createAigcForgeEventSource()

      const connection = createClientConnection(transport.api, {
        flushInterval: 0,
        onEvent(event) {
          events.publish(event)

          if (event.type === "server.connected") streams[Number(event.id?.split("_").at(-1))]!.connected.resolve()
        },
      })

      const data = createData({
        api: () => transport.api,
        directory: "/project",
        connection,
        event: {
          on: events.event.on,
          listen(handler) {
            observed.subscriptions++

            const unsubscribe = events.event.listen((details) => {
              observed.reductions++
              handler({ name: details.type, details })
            })

            return () => {
              observed.subscriptions--
              unsubscribe()
            }
          },
        },
        onError: (error) => errors.push(error),
      })

      return {
        data,
        connection,
        event: events.event,
        requests,
        streams,
        opened,
        observed,
        errors,
        reads,
        read,
        dispose,
      }
    })
  }

  const shared = server("http://shared.local")
  const isolated = server("http://isolated.local")

  const views = ids.map((id) =>
    createRoot((dispose) => ({
      current: createSessionResolution(
        () => id,
        () => shared.data.session,
        { connected: () => shared.connection.status() === "connected" },
      ),
      dispose,
    })),
  )

  const other = createRoot((dispose) => ({
    current: createSessionResolution(
      () => ids[0],
      () => isolated.data.session,
      { connected: () => isolated.connection.status() === "connected" },
    ),
    dispose,
  }))

  async function hydrate(fixture: ReturnType<typeof server>, round: number, active: string[]) {
    const stream = await fixture.opened[round]!.promise
    stream.send({ id: `evt_connected_${round}`, type: "server.connected", data: {} })
    await stream.connected.promise
    await Promise.all(
      active.flatMap((id) => resources.map((resource) => fixture.read(round, id, resource).started.promise)),
    )
    active.forEach((id) => {
      const info: SessionInfo = {
        id,
        projectID: "project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        location: { directory: `${fixture === shared ? "/shared" : "/isolated"}/${id}/${round}` },
        time: { created: 0, updated: round },
      }

      if (id === "ses_child") info.parentID = ids[0]

      fixture.read(round, id, "info").response.resolve(Response.json({ data: info }))
      fixture.read(round, id, "message").response.resolve(
        Response.json({
          data: [{ id: `msg_${id}`, type: "user", text: info.location.directory, time: { created: 0 } }],
          cursor: {},
        }),
      )
      fixture.read(round, id, "inbox").response.resolve(Response.json({ data: [] }))
    })
    await Promise.all(
      active.flatMap((id) => [
        fixture.data.session.sync(id),
        fixture.data.session.message.sync(id),
        fixture.data.session.pending.sync(id),
      ]),
    )
    await flush()
    expect(fixture.requests.filter((request) => request.startsWith(`${round}:`))).toEqual(
      expect.arrayContaining(active.flatMap((id) => resources.map((resource) => `${round}:${id}:${resource}`))),
    )
    expect(fixture.requests.filter((request) => request.startsWith(`${round}:`))).toHaveLength(active.length * 3)
  }

  try {
    await hydrate(shared, 0, ids)
    await hydrate(isolated, 0, [ids[0]!])
    expect(shared.streams).toHaveLength(1)
    expect(shared.observed.subscriptions).toBe(1)
    expect(isolated.streams).toHaveLength(1)
    expect(isolated.observed.subscriptions).toBe(1)
    expect(views.map((view) => view.current()?.id)).toEqual(ids)
    expect(views[3]!.current()?.parentID).toBe(ids[0])
    expect(other.current()?.location.directory).toBe(`/isolated/${ids[0]}/0`)

    shared.connection.internal.resync("SC01 fixture reconnect")
    await shared.opened[1]!.promise
    expect(views.map((view) => view.current()?.location.directory)).toEqual(ids.map((id) => `/shared/${id}/0`))
    await hydrate(shared, 1, ids)
    expect(views.map((view) => view.current()?.location.directory)).toEqual(ids.map((id) => `/shared/${id}/1`))
    expect(shared.streams.filter((stream) => !stream.aborted)).toHaveLength(1)

    views[1]!.dispose()
    expect(shared.observed.subscriptions).toBe(1)
    expect(shared.streams[1]!.aborted).toBe(false)
    shared.connection.internal.resync("SC01 remaining targets reconnect")
    await hydrate(
      shared,
      2,
      ids.filter((id) => id !== "ses_root_b"),
    )
    expect(shared.requests.filter((request) => request.startsWith("2:ses_root_b:"))).toEqual([])
    expect(
      [views[0]!.current(), views[2]!.current(), views[3]!.current()].map((info) => info?.location.directory),
    ).toEqual([ids[0], ids[2], ids[3]].map((id) => `/shared/${id}/2`))

    const late = createRoot((dispose) => ({
      current: createSessionResolution(
        () => ids[3],
        () => shared.data.session,
        { connected: () => shared.connection.status() === "connected" },
      ),
      dispose,
    }))

    expect(late.current()?.id).toBe("ses_child")
    expect(shared.requests.filter((request) => request.startsWith("2:"))).toHaveLength(9)
    late.dispose()
    expect(shared.streams.filter((stream) => !stream.aborted)).toHaveLength(1)
    const received = Promise.withResolvers<void>()
    const unsubscribe = shared.event.on("session.synthetic", () => received.resolve())
    const reductions = shared.observed.reductions
    shared.streams[2]!.send({
      id: "evt_once",
      type: "session.synthetic",
      created: 6,
      durable: { aggregateID: "ses_child", seq: 6, version: 1 },
      data: { sessionID: "ses_child", text: "One shared reduction" },
    })
    await received.promise
    unsubscribe()
    expect(shared.observed.reductions - reductions).toBe(1)
    expect(shared.data.session.message.get("ses_child", "msg_once")).toMatchObject({ text: "One shared reduction" })
    expect(isolated.data.session.message.get("ses_child", "msg_once")).toBeUndefined()
    expect(isolated.requests).toHaveLength(3)
    expect(isolated.streams[0]!.aborted).toBe(false)
    expect(other.current()?.location.directory).toBe(`/isolated/${ids[0]}/0`)
    expect(shared.errors).toEqual([])
    expect(isolated.errors).toEqual([])
  } finally {
    views.forEach((view) => view.dispose())
    other.dispose()
    shared.dispose()
    isolated.dispose()
    shared.reads.forEach((entry) => entry.response.resolve(Response.json({ data: [], cursor: {} })))
    isolated.reads.forEach((entry) => entry.response.resolve(Response.json({ data: [], cursor: {} })))
  }
})

test("refreshes the current session on reconnect while keeping cached content visible", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [connection, setConnection] = createStore({ connected: false })

    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
      { connected: () => connection.connected },
    )

    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual([])
    await flush()
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a"])
    fixture.settle("ses_a")
    await flush()

    setConnection("connected", false)
    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual(["ses_a"])
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a", "ses_a"])
    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_a"])
    expect(fixture.pending.syncs).toEqual(["ses_a", "ses_a"])
    fixture.settle("ses_a", "/worktrees/moved")
    await flush()
    expect(current()?.directory).toBe("/worktrees/moved")
    dispose()
  })
})

test("starts metadata and messages in parallel once the route has a session ID", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal<string>()
    const current = createSessionResolution(id, () => fixture.sessions)

    expect(current()).toBeUndefined()
    await flush()
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual([])

    setId("ses_a")
    expect(fixture.resolves).toEqual(["ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a"])

    fixture.messages.resolve(undefined)
    await flush()
    expect(current()).toBeUndefined()

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

test("message failure does not fail metadata resolution", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()

    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
    )

    await flush()
    fixture.messages.reject(new Error("message sync failed"))
    await flush()
    expect(current()).toBeUndefined()

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// Session tabs on the same server share one route instance, so navigating to
// another session changes the id in place; resolution must follow it instead
// of reporting the new session as missing.
test("re-resolves when navigating to an uncached session without a remount", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    expect(current()?.id).toBe("ses_a")
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual(["ses_a"])

    expect(() => {
      setId("ses_b")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_b"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b"])

    fixture.settle("ses_b")
    await flush()
    expect(current()?.id).toBe("ses_b")

    dispose()
  })
})

// A late failure from a session the user already navigated away from must not
// poison the currently viewed session.
test("ignores a stale resolution failure after the target changes", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("Session not found: ses_a"))
    await flush()

    expect(() => current()).not.toThrow()
    fixture.settle("ses_b")
    await flush()
    expect(current()?.id).toBe("ses_b")

    dispose()
  })
})

test("returning to a pruned session re-resolves instead of throwing not found", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    fixture.settle("ses_a")
    await flush()

    setId("ses_b")
    fixture.settle("ses_b")
    await flush()

    fixture.remove("ses_a")
    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// A resolution that fails while its session is unfocused must not leave a
// poisoned status behind: revisiting that session retries cleanly instead of
// rethrowing the stale failure before the retry can start.
test("revisiting a session whose resolution failed while unfocused retries cleanly", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// The session accessor is reactive: replacing the data store (for example after
// the server context is rebuilt) must gate out the old store's status and
// re-resolve against the new one instead of fabricating a not-found.
test("re-resolves against a replaced session store", async () => {
  await createRoot(async (dispose) => {
    const first = createFixture()
    const second = createFixture()
    const [store, setStore] = createSignal(first.sessions)
    const current = createSessionResolution(() => "ses_a", store)

    await flush()
    first.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    expect(() => {
      setStore(second.sessions)
      current()
    }).not.toThrow()
    await flush()
    expect(second.resolves).toEqual(["ses_a"])
    expect(first.messages.syncs).toEqual(["ses_a"])
    expect(second.messages.syncs).toEqual(["ses_a"])

    second.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// The viewed session is pinned in the cache, so disappearing after settlement
// means it was deleted; the boundary must show the not found fallback.
test("throws not found when the settled session is deleted", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()

    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
    )

    await flush()
    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    expect(() => {
      fixture.remove("ses_a")
      current()
    }).toThrow("Session not found: ses_a")

    dispose()
  })
})
