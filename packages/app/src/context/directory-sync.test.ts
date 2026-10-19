import { describe, expect, test } from "bun:test"
import { createStore, produce, reconcile } from "solid-js/store"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import { createTaskReadback, pickTarget } from "./directory-sync"
import { createAigcfrogeClient, type Event, type Session, type SessionMessage } from "@aigcfroge/sdk/v2/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createComponent, untrack } from "solid-js"
import { render } from "solid-js/web"
import { ServerScope } from "@/utils/server-scope"
import { LanguageProvider } from "./language"
import { PlatformProvider } from "./platform"
import type { ServerSDK } from "./server-sdk"
import { createServerSyncContextInner } from "./server-sync"
import { createDirSyncContext } from "./directory-sync"
import { ServerConnection } from "./server"

describe("pickTarget", () => {
  test("returns requested directory when it differs from own", () => {
    expect(pickTarget("/tmp/project", "/tmp/worktree")).toBe("/tmp/worktree")
  })

  test("returns own directory when requested is undefined or same", () => {
    expect(pickTarget("/tmp/project", undefined)).toBe("/tmp/project")
    expect(pickTarget("/tmp/project", "/tmp/project")).toBe("/tmp/project")
  })
})

describe("Task full-list readback", () => {
  for (const empty of [false, true]) {
    test(`later ${empty ? "empty" : "populated"} success replaces the earlier rendered read`, async () => {
      const fixture = taskReadbackFixture()
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const second = await fixture.next()
      first.reply.resolve([taskRow(90)])
      await a
      expect(fixture.store.ses_a).toEqual([taskRow(90)])
      // A full list can have lower row revisions, or no rows at all.
      second.reply.resolve(empty ? [] : [taskRow(1)])
      await b
      expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
    })

    test(`earlier read cannot replace the newer ${empty ? "clear" : "data"} response`, async () => {
      const fixture = taskReadbackFixture()
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const second = await fixture.next()
      second.reply.resolve(empty ? [] : [taskRow(1)])
      await b
      first.reply.resolve([taskRow(90)])
      await a
      expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
    })

    for (const allFirst of [false, true]) {
      test(`Hub and Session share read order: allFirst=${allFirst}, empty=${empty}`, async () => {
        const fixture = taskReadbackFixture()
        const a = allFirst
          ? fixture.owner.loadAll({ directory: "/a" })
          : fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
        const first = await fixture.next()
        const b = allFirst
          ? fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
          : fixture.owner.loadAll({ directory: "/a" })
        const second = await fixture.next()
        second.reply.resolve(empty ? [] : [taskRow(1)])
        await b
        first.reply.resolve([taskRow(90)])
        await a
        expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
      })
    }
  }

  test("an empty Hub snapshot excludes previously unseen rows from an older Hub request", async () => {
    const fixture = taskReadbackFixture()
    const a = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    const b = fixture.owner.loadAll({ directory: "/a" })
    const second = await fixture.next()
    second.reply.resolve([])
    await b
    first.reply.resolve([taskRow(90, "ses_unseen")])
    await a
    expect(fixture.store.ses_unseen).toBeUndefined()
    const c = fixture.owner.load({ directory: "/a", sessionID: "ses_unseen" })
    const third = await fixture.next()
    third.reply.resolve([taskRow(1, "ses_unseen")])
    await c
    expect(fixture.store.ses_unseen).toEqual([taskRow(1, "ses_unseen")])
  })

  test("a failed newer GET preserves the rendered list and the next GET recovers", async () => {
    const fixture = taskReadbackFixture()
    const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const first = await fixture.next()
    const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const second = await fixture.next()
    first.reply.resolve([taskRow(1)])
    await a
    const failed = b.catch((error: unknown) => error)
    second.reply.reject(new Error("read failed"))
    expect(await failed).toEqual(new Error("read failed"))
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    const recovery = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const third = await fixture.next()
    third.reply.resolve([taskRow(2)])
    await recovery
    expect(fixture.store.ses_a).toEqual([taskRow(2)])
  })

  for (const value of [undefined, []]) {
    test(`explicit ${value ? "clear" : "eviction"} invalidates both Session and Hub reads`, async () => {
      const fixture = taskReadbackFixture()
      fixture.owner.set("ses_a", [taskRow(1)])
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.loadAll({ directory: "/a" })
      const second = await fixture.next()
      fixture.owner.set("ses_a", value)
      first.reply.resolve([taskRow(2)])
      second.reply.resolve([taskRow(3)])
      await Promise.all([a, b])
      expect(fixture.store.ses_a).toEqual(value)
    })
  }

  test("event invalidations coalesce, invalidate held reads, and reload after another event", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    const stale = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    const refresh = fixture.owner.refresh("/a", "ses_a")
    expect(fixture.owner.refresh("/a/", "ses_a")).toBe(refresh)
    const second = await fixture.next()
    expect(fixture.calls).toHaveLength(2)
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(refresh)
    second.reply.resolve([taskRow(2)])
    const third = await fixture.next()
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    third.reply.resolve([])
    await refresh
    first.reply.resolve([taskRow(90)])
    await stale
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.calls).toHaveLength(3)
  })

  test("a refresh error does not poison the next event, including an already queued event", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    const a = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    const failed = a.catch((error: unknown) => error)
    first.reply.reject(new Error("read failed"))
    expect(await failed).toEqual(new Error("read failed"))
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    const b = fixture.owner.refresh("/a", "ses_a")
    const second = await fixture.next()
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(b)
    second.reply.reject(new Error("superseded failure"))
    const third = await fixture.next()
    third.reply.resolve([taskRow(3)])
    await b
    expect(fixture.store.ses_a).toEqual([taskRow(3)])
  })

  test("explicit clear cancels an event refresh without automatically reviving its tasks", async () => {
    const fixture = taskReadbackFixture()
    const pending = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    fixture.owner.refresh("/a", "ses_a")
    fixture.owner.set("ses_a", [])
    first.reply.resolve([taskRow(1)])
    await pending
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.calls).toHaveLength(1)
  })

  test("Hub clears absent sessions but cannot overwrite a session invalidated after its start", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    fixture.owner.set("ses_b", [taskRow(1, "ses_b")])
    const pending = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    fixture.owner.set("ses_b", [])
    first.reply.resolve([taskRow(3, "ses_b"), taskRow(1, "ses_c")])
    await pending
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.store.ses_b).toEqual([])
    expect(fixture.store.ses_c).toEqual([taskRow(1, "ses_c")])
  })

  test("component abort, directory disposal and reconnect reject their old read generations", async () => {
    const fixture = taskReadbackFixture()
    const controller = new AbortController()
    const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a", signal: controller.signal })
    const first = await fixture.next()
    controller.abort()
    first.reply.resolve([taskRow(1)])
    await a
    expect(fixture.store.ses_a).toBeUndefined()
    const b = fixture.owner.loadAll({ directory: "/a" })
    const second = await fixture.next()
    fixture.owner.disposeDirectory("/a/")
    const c = fixture.owner.loadAll({ directory: "/b" })
    const third = await fixture.next()
    fixture.owner.reset()
    const d = fixture.owner.load({ directory: "/b", sessionID: "ses_a" })
    const fourth = await fixture.next()
    fourth.reply.resolve([])
    await d
    second.reply.resolve([taskRow(2)])
    third.reply.resolve([taskRow(3)])
    await Promise.all([b, c])
    expect(fixture.store.ses_a).toEqual([])
  })

  test("disposal cannot delete a newer coalesced refresh or leak into another server owner", async () => {
    const fixture = taskReadbackFixture()
    const other = taskReadbackFixture()
    other.owner.set("ses_a", [taskRow(4)])
    const a = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    fixture.owner.disposeDirectory("/a")
    const b = fixture.owner.refresh("/a", "ses_a")
    const second = await fixture.next()
    first.reply.resolve([taskRow(1)])
    await a
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(b)
    second.reply.resolve([taskRow(2)])
    const third = await fixture.next()
    fixture.owner.dispose()
    third.reply.resolve([taskRow(3)])
    await b
    await fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    expect(fixture.store.ses_a).toBeUndefined()
    expect(other.store.ses_a).toEqual([taskRow(4)])
    expect(fixture.calls).toHaveLength(3)
  })
})

function taskRow(revision: number, sessionID = "ses_a"): SessionTaskInfo {
  return {
    id: `tsk_${sessionID}`,
    sessionID,
    content: `revision ${revision}`,
    status: "pending",
    priority: "medium",
    revision,
    createdAt: 1,
    updatedAt: 1,
  }
}

function taskReadbackFixture() {
  type Source = { directory: string; sessionID?: string; signal?: AbortSignal }
  type Read = { source: Source; reply: ReturnType<typeof Promise.withResolvers<SessionTaskInfo[]>> }
  const calls: Read[] = []
  const queued: Read[] = []
  const waiters: Array<(read: Read) => void> = []
  const [store, setStore] = createStore<Record<string, SessionTaskInfo[] | undefined>>({})
  const read = (source: Source) => {
    const request: Read = { source, reply: Promise.withResolvers<SessionTaskInfo[]>() }
    calls.push(request)
    const waiter = waiters.shift()
    if (waiter) waiter(request)
    if (!waiter) queued.push(request)
    return request.reply.promise
  }
  const owner = createTaskReadback({
    get: read,
    list: read,
    keys: () => Object.keys(store),
    write(sessionID, tasks) {
      if (tasks === undefined) {
        setStore(
          produce((draft) => {
            delete draft[sessionID]
          }),
        )
        return
      }
      setStore(sessionID, reconcile(tasks, { key: "id" }))
    },
  })
  return {
    owner,
    store,
    calls,
    next() {
      const request = queued.shift()
      if (request) return Promise.resolve(request)
      return new Promise<Read>((resolve) => waiters.push(resolve))
    },
  }
}

describe("canonical message readback", () => {
  test("a historical session without a mode follows the server's coding history policy", async () => {
    const fixture = canonicalReadbackFixture("text", 2, { mode: undefined, canonicalSessionModes: ["coding"] })
    try {
      await fixture.directory.session.sync("ses_canonical")
      expect(fixture.reads).toEqual({ capabilities: 1, legacy: 0, canonical: 1 })
    } finally {
      fixture.dispose()
    }
  })

  test("coding waits for the server's first capability response before reading either history API", async () => {
    const fixture = canonicalReadbackFixture("text", 2, { mode: "coding", canonicalSessionModes: ["coding"] })
    try {
      const held = fixture.holdCapabilities()
      const initial = fixture.directory.session.sync("ses_canonical")
      await held.started.promise
      expect(fixture.reads).toEqual({ capabilities: 1, legacy: 0, canonical: 0 })
      held.release.resolve()
      await initial
      await fixture.directory.session.sync("ses_canonical", { force: true })
      expect(fixture.reads).toEqual({ capabilities: 1, legacy: 0, canonical: 2 })
    } finally {
      fixture.dispose()
    }
  })

  test("coding reads legacy history only when the server's capability excludes it", async () => {
    const fixture = canonicalReadbackFixture("text", 2, { mode: "coding" })
    try {
      await fixture.directory.session.sync("ses_canonical")
      expect(fixture.reads).toEqual({ capabilities: 1, legacy: 1, canonical: 0 })
    } finally {
      fixture.dispose()
    }
  })

  for (const failure of ["missing", "malformed", "unavailable"] as const) {
    test(`${failure} capabilities cannot select legacy history or erase a cached canonical conversation`, async () => {
      const fixture = canonicalReadbackFixture("text", 2, { mode: "coding", canonicalSessionModes: ["coding"] })
      const body = failure === "malformed" ? { canonicalSessionModes: ["unknown"] } : {}
      const status = failure === "unavailable" ? 503 : 200
      try {
        fixture.setCapabilities(body, status)
        await expect(fixture.directory.session.sync("ses_canonical")).rejects.toBeInstanceOf(Error)
        expect(fixture.reads).toEqual({ capabilities: 1, legacy: 0, canonical: 0 })
        expect(fixture.directory.data.message.ses_canonical).toBeUndefined()

        fixture.setCapabilities({ canonicalSessionModes: ["coding"] })
        fixture.setText("retained conversation")
        await fixture.directory.session.sync("ses_canonical")
        const messages = fixture.directory.data.message.ses_canonical?.map((message) => message.id)
        fixture.setCapabilities(body, status)
        fixture.reconnect()
        await expect(fixture.directory.session.sync("ses_canonical", { force: true })).rejects.toBeInstanceOf(Error)
        expect(fixture.reads).toEqual({ capabilities: 3, legacy: 0, canonical: 1 })
        expect(fixture.directory.data.message.ses_canonical?.map((message) => message.id)).toEqual(messages)
        expect(fixture.text()).toBe("retained conversation")
      } finally {
        fixture.dispose()
      }
    })
  }

  test("reconnect cancels a capability refetch without resolving readers with the previous cached policy", async () => {
    const fixture = canonicalReadbackFixture("text", 2, { mode: "coding", canonicalSessionModes: ["coding"] })
    try {
      await fixture.directory.session.sync("ses_canonical")
      fixture.reconnect()
      const held = fixture.holdCapabilities()
      const refresh = fixture.directory.session.sync("ses_canonical", { force: true })
      const signal = await held.started.promise
      fixture.setCapabilities({ canonicalSessionModes: ["assistant", "custom"] })
      fixture.reconnect()
      await refresh
      expect(signal.aborted).toBe(true)
      expect(fixture.reads).toEqual({ capabilities: 3, legacy: 1, canonical: 1 })
      held.release.resolve()
      await held.finished.promise
      await fixture.directory.session.sync("ses_canonical", { force: true })
      expect(fixture.reads).toEqual({ capabilities: 3, legacy: 2, canonical: 1 })
    } finally {
      fixture.dispose()
    }
  })

  test("servers sharing a query cache keep separate history policies for the same Session ID", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const legacy = canonicalReadbackFixture("text", 2, { mode: "coding", queryClient })
    const canonical = canonicalReadbackFixture("text", 2, {
      mode: "coding",
      canonicalSessionModes: ["coding"],
      scope: ServerScope.fromServerKey(ServerConnection.Key.make("http://canonical-peer.test")),
      queryClient,
    })
    try {
      await Promise.all([
        legacy.directory.session.sync("ses_canonical"),
        canonical.directory.session.sync("ses_canonical"),
      ])
      expect(legacy.reads).toEqual({ capabilities: 1, legacy: 1, canonical: 0 })
      expect(canonical.reads).toEqual({ capabilities: 1, legacy: 0, canonical: 1 })
    } finally {
      legacy.dispose()
      canonical.dispose()
      queryClient.clear()
    }
  })

  for (const type of ["text", "reasoning"] as const) {
    test(`${type} deltas before the initial snapshot remain visible across refresh and end at the full value`, async () => {
      const fixture = canonicalReadbackFixture(type)
      try {
        const held = fixture.hold()
        const initial = fixture.directory.session.sync("ses_canonical")
        await held.started.promise
        fixture.emit("delta", "A")
        fixture.emit("delta", "B")
        held.release.resolve()
        await initial
        expect(fixture.text()).toBe("AB")
        await fixture.directory.session.sync("ses_canonical", { force: true })
        expect(fixture.text()).toBe("AB")

        const stale = fixture.hold()
        const refresh = fixture.directory.session.sync("ses_canonical", { force: true })
        await stale.started.promise
        fixture.setText("ABC")
        fixture.emit("ended", "ABC")
        expect(fixture.text()).toBe("ABC")
        stale.release.resolve()
        await refresh
        expect(fixture.text()).toBe("ABC")
      } finally {
        fixture.dispose()
      }
    })

    test(`${type} deltas queued behind an already completed snapshot are not counted twice`, async () => {
      const fixture = canonicalReadbackFixture(type)
      try {
        fixture.setText("AB")
        await fixture.directory.session.sync("ses_canonical")
        fixture.emit("delta", "B")
        expect(fixture.text()).toBe("AB")
      } finally {
        fixture.dispose()
      }
    })
  }

  test("events during history pagination are read afterward without discarding the loaded history", async () => {
    const fixture = canonicalReadbackFixture("text", 600)
    try {
      await fixture.directory.session.sync("ses_canonical")
      const held = fixture.hold()
      const history = fixture.directory.session.history.loadMore("ses_canonical", 150)
      await held.started.promise
      fixture.setText("finished during pagination")
      fixture.emit("ended", "finished during pagination")
      held.release.resolve()
      await history
      await fixture.directory.session.sync("ses_canonical")
      expect(fixture.text()).toBe("finished during pagination")
      expect(fixture.directory.data.message.ses_canonical?.length).toBeGreaterThanOrEqual(200)
      const oldest = fixture.directory.data.message.ses_canonical?.[0]?.id
      fixture.append(50)
      await fixture.directory.session.sync("ses_canonical", { force: true })
      expect(fixture.directory.data.message.ses_canonical?.some((message) => message.id === oldest)).toBe(true)
    } finally {
      fixture.dispose()
    }
  })
})

function canonicalReadbackFixture(
  type: "text" | "reasoning",
  count = 2,
  options?: {
    mode?: Session["mode"]
    canonicalSessionModes?: Session["mode"][]
    scope?: ServerScope
    queryClient?: QueryClient
  },
) {
  const session: Session = {
    id: "ses_canonical",
    slug: "canonical",
    title: "Canonical",
    projectID: "project",
    directory: "/canonical",
    version: "test",
    mode: options && "mode" in options ? options.mode : "assistant",
    agent: "assistant-orchestrator",
    model: { providerID: "test", id: "model" },
    time: { created: 1, updated: 1 },
  }
  const rows: SessionMessage[] = []
  const append = (count: number) => {
    const offset = rows.length
    rows.push(
      ...Array.from({ length: count }, (_, index): SessionMessage => {
        const position = offset + index
        const id = `msg_${String(position).padStart(4, "0")}`
        if (position % 2 === 0) return { id, type: "user", text: id, time: { created: position } }
        return {
          id,
          type: "assistant",
          agent: "assistant-orchestrator",
          model: { providerID: "test", id: "model" },
          time: { created: position },
          content: [{ id: "content", type, text: "" }],
        }
      }),
    )
  }
  append(count)
  const messageID = rows.at(-1)?.id
  if (!messageID) throw new Error("Assistant fixture is empty")
  const reads = { capabilities: 0, legacy: 0, canonical: 0 }
  const capabilities: { body: unknown; status: number } = {
    body: { canonicalSessionModes: options?.canonicalSessionModes ?? ["assistant", "custom"] },
    status: 200,
  }
  type PendingRead = {
    started: ReturnType<typeof Promise.withResolvers<AbortSignal>>
    release: ReturnType<typeof Promise.withResolvers<void>>
    finished: ReturnType<typeof Promise.withResolvers<void>>
  }
  const held: PendingRead[] = []
  const heldCapabilities: PendingRead[] = []
  const pendingReads = new Set<PendingRead>()
  const hold = (queue: PendingRead[]) => {
    const pending = {
      started: Promise.withResolvers<AbortSignal>(),
      release: Promise.withResolvers<void>(),
      finished: Promise.withResolvers<void>(),
    }
    queue.push(pending)
    pendingReads.add(pending)
    return pending
  }
  const fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      if (url.pathname === `/session/${session.id}`) return Response.json(session)
      if (url.pathname === "/session") return Response.json([session])
      if (url.pathname === "/experimental/capabilities") {
        reads.capabilities++
        const response = Response.json(capabilities.body, { status: capabilities.status })
        const pending = heldCapabilities.shift()
        pending?.started.resolve(request.signal)
        if (pending) await pending.release.promise
        pending?.finished.resolve()
        if (pending) pendingReads.delete(pending)
        return response
      }
      if (url.pathname === `/session/${session.id}/message`) {
        reads.legacy++
        return Response.json([])
      }
      if (url.pathname === `/api/session/${session.id}/message`) {
        reads.canonical++
        const start = Number(url.searchParams.get("cursor") ?? 0)
        const end = Math.min(rows.length, start + Number(url.searchParams.get("limit")))
        const response = Response.json({
          data: rows.toReversed().slice(start, end),
          cursor: { next: end < rows.length ? String(end) : undefined },
        })
        const pending = held.shift()
        pending?.started.resolve(request.signal)
        if (pending) await pending.release.promise
        pending?.finished.resolve()
        if (pending) pendingReads.delete(pending)
        return response
      }
      if (url.pathname === "/global/config" || url.pathname === "/mcp") return Response.json({})
      if (url.pathname === "/path")
        return Response.json({ state: "", config: "", worktree: "/canonical", directory: "/canonical", home: "/home" })
      if (url.pathname === "/provider") return Response.json({ all: [], connected: [], default: {} })
      if (["/project", "/lsp", "/command", "/agent", "/permission", "/question", "/api/task"].includes(url.pathname))
        return Response.json([])
      throw new Error(`Unexpected request: ${url.pathname}`)
    },
    { preconnect() {} },
  )
  const emitter = createGlobalEmitter<Record<string, Event>>()
  const createClient: ServerSDK["createClient"] = (options) =>
    createAigcfrogeClient({ baseUrl: "http://canonical-sync.test", fetch, ...options })
  const sdk: ServerSDK = {
    scope: options?.scope ?? ServerScope.local,
    url: "http://canonical-sync.test",
    client: createClient({ throwOnError: true }),
    createClient,
    event: { on: emitter.on.bind(emitter), listen: emitter.listen.bind(emitter), start: async () => {} },
    ensureDirSdkContext: (directory) => ({
      scope: options?.scope ?? ServerScope.local,
      directory,
      url: "http://canonical-sync.test",
      createClient,
      client: createClient({ directory, throwOnError: true }),
      event: createGlobalEmitter<{ [Kind in Event["type"]]: Extract<Event, { type: Kind }> }>(),
    }),
  }
  const queryClient = options?.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let directory: ReturnType<typeof createDirSyncContext> | undefined
  const container = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client: queryClient,
        get children() {
          return createComponent(PlatformProvider, {
            value: {
              platform: "web",
              openLink() {},
              restart: async () => {},
              back() {},
              forward() {},
              notify: async () => {},
            },
            get children() {
              return createComponent(LanguageProvider, {
                locale: "en",
                get children() {
                  return untrack(() => {
                    const server = createServerSyncContextInner(sdk)
                    const [, setStore] = server.child(session.directory, { bootstrap: false })
                    setStore("status", "complete")
                    setStore("session", [session])
                    directory = createDirSyncContext(session.directory, server, sdk)
                    return null
                  })
                },
              })
            },
          })
        },
      }),
    container,
  )
  if (!directory) throw new Error("Directory context did not mount")
  const owner = directory
  return {
    directory: owner,
    append,
    reads,
    hold: () => hold(held),
    holdCapabilities: () => hold(heldCapabilities),
    setCapabilities(body: unknown, status = 200) {
      capabilities.body = body
      capabilities.status = status
    },
    reconnect() {
      emitter.emit("global", { id: "evt_connected", type: "server.connected", properties: {} })
    },
    text: () => {
      const part = owner.data.part[messageID]?.find((part) => part.type === type)
      return part && (part.type === "text" || part.type === "reasoning") ? part.text : undefined
    },
    setText(text: string) {
      const row = rows.find((row) => row.id === messageID)
      if (row?.type !== "assistant") throw new Error("Assistant row missing")
      row.content = [{ type, id: "content", text }]
    },
    emit(phase: "delta" | "ended", text: string) {
      const properties = { sessionID: session.id, assistantMessageID: messageID, timestamp: 1 }
      if (type === "text" && phase === "delta")
        emitter.emit(session.directory, {
          id: "evt_text.delta",
          type: "session.next.text.delta",
          properties: { ...properties, textID: "content", delta: text },
        })
      if (type === "text" && phase === "ended")
        emitter.emit(session.directory, {
          id: "evt_text.ended",
          type: "session.next.text.ended",
          properties: { ...properties, textID: "content", text },
        })
      if (type === "reasoning" && phase === "delta")
        emitter.emit(session.directory, {
          id: "evt_reasoning.delta",
          type: "session.next.reasoning.delta",
          properties: { ...properties, reasoningID: "content", delta: text },
        })
      if (type === "reasoning" && phase === "ended")
        emitter.emit(session.directory, {
          id: "evt_reasoning.ended",
          type: "session.next.reasoning.ended",
          properties: { ...properties, reasoningID: "content", text },
        })
    },
    dispose() {
      dispose()
      pendingReads.forEach((pending) => pending.release.resolve())
      if (!options?.queryClient) queryClient.clear()
      container.remove()
    },
  }
}
