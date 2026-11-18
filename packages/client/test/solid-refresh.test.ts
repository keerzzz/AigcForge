import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createData, settleMs, type CreateDataInput } from "../src/solid"
import { AigcForge, type AigcForgeEvent, type SessionInfo, type SessionTaskInfo } from "../src/promise"

test("config and authored-provider reads refresh only after an owner loads them", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  let model = "provider/first"
  let definitionDigest = "first"
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/config") return Response.json([{ type: "document", info: { model } }])
      if (url.pathname === "/api/provider/definition")
        return Response.json({
          location,
          data: {
            targets: [
              { scope: "global", path: "/config/aigcfroge.jsonc", digest: definitionDigest, preferred: true, writable: true },
            ],
            definitions: [],
          },
        })
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const event: AigcForgeEvent = { id: "evt_config", created: 1, type: "config.updated", location, data: {} }
  try {
    await setup.data.location.sync()
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(requests).not.toContain("/api/config")
    expect(requests).not.toContain("/api/provider/definition")

    await setup.data.location.config.sync()
    await setup.data.location.provider.definition.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(1)
    expect(requests.filter((path) => path === "/api/provider/definition")).toHaveLength(1)
    model = "provider/second"
    definitionDigest = "second"
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.location.config.sync()
    await setup.data.location.provider.definition.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(2)
    expect(setup.data.location.config.list()).toEqual([{ type: "document", info: { model } }])
    expect(requests.filter((path) => path === "/api/provider/definition")).toHaveLength(2)
    expect(setup.data.location.provider.definition.list()?.targets[0]?.digest).toBe("second")

    definitionDigest = "third"
    const credential: AigcForgeEvent = { id: "evt_credential", created: 2, type: "credential.updated", data: {} }
    listeners.forEach((listener) => listener({ name: credential.type, details: credential }))
    await setup.data.location.provider.definition.sync()
    expect(requests.filter((path) => path === "/api/provider/definition")).toHaveLength(3)
    expect(setup.data.location.provider.definition.list()?.targets[0]?.digest).toBe("third")
  } finally {
    setup.dispose()
  }
})

test("event refreshes report failures, remain retryable, and preserve explicit read errors", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const reported = Promise.withResolvers<unknown>()
  const errors: unknown[] = []
  const state = { offline: true, requests: 0 }
  const session: SessionInfo = {
    id: "ses_refresh_failure",
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0, idle: 2 },
    location: { directory: "/project" },
  }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async () => {
      state.requests++
      if (state.offline) throw new TypeError("Failed to fetch")
      return Response.json({ data: { ...session, title: "Recovered" } })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      onError(error) {
        errors.push(error)
        reported.resolve(error)
      },
    }),
    dispose,
  }))
  const event: AigcForgeEvent = {
    id: "evt_refresh_failure",
    created: 2,
    type: "session.viewed",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: { sessionID: session.id, idle: 2 },
  }
  try {
    setup.data.session.remember(session)
    setup.data.session.invalidate(session.id)
    await expect(setup.data.session.sync(session.id)).rejects.toThrow("Transport")
    expect(errors).toEqual([])
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(String(await reported.promise)).toContain("Transport")
    expect(errors).toHaveLength(1)
    expect(setup.data.session.get(session.id)?.title).toBeUndefined()
    state.offline = false
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.session.sync(session.id)
    expect(setup.data.session.get(session.id)?.title).toBe("Recovered")
    expect(state.requests).toBe(3)
  } finally {
    setup.dispose()
  }
})

test.each(["reconnecting", "disposed"] as const)("background reads respect %s owners", async (mode) => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const pending = Promise.withResolvers<Response>()
  const errors: unknown[] = []
  const state = { requests: 0 }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: () => {
      state.requests++
      return pending.promise
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status: () => (mode === "reconnecting" ? "reconnecting" : "connected") },
      onError: (error) => errors.push(error),
    }),
    dispose,
  }))
  const event: AigcForgeEvent = {
    id: "evt_refresh_owner",
    type: "command.updated",
    location: { directory: "/project" },
    data: {},
  }
  listeners.forEach((listener) => listener({ name: event.type, details: event }))
  if (mode === "reconnecting") {
    expect(state.requests).toBe(0)
    setup.dispose()
    return
  }
  const joined = setup.data.location.command.sync()
  setup.dispose()
  pending.reject(new TypeError("Failed to fetch"))
  await expect(joined).rejects.toThrow("Transport")
  expect(state.requests).toBe(1)
  expect(errors).toEqual([])
})

test("a burst of mcp.status.changed events refetches the server list once it settles", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(new URL(request.url).pathname)
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  try {
    await setup.data.location.mcp.server.sync()
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(1)
    for (const server of ["a", "b", "c", "d", "e"]) {
      const event: AigcForgeEvent = {
        id: `evt_${server}`,
        created: 1,
        type: "mcp.status.changed",
        location,
        data: { server },
      }
      listeners.forEach((listener) => listener({ name: event.type, details: event }))
    }
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, settleMs * 2))
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(2)
  } finally {
    setup.dispose()
  }
})

test("invalidations that land before a queued reload starts are absorbed by it", async () => {
  const pending: Array<PromiseWithResolvers<Response>> = []
  const location = { directory: "/project" }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: () => {
      const deferred = Promise.withResolvers<Response>()
      pending.push(deferred)
      return deferred.promise
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    const first = setup.data.location.agent.sync()
    expect(pending).toHaveLength(1)
    setup.data.location.agent.invalidate()
    const second = setup.data.location.agent.sync()
    setup.data.location.agent.invalidate()
    const third = setup.data.location.agent.sync()
    setup.data.location.agent.invalidate()
    expect(pending).toHaveLength(1)
    pending[0].resolve(Response.json({ location, data: [] }))
    await first
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    pending[1].resolve(Response.json({ location, data: [{ name: "reviewer" }] }))
    await Promise.all([second, third])
    expect(pending).toHaveLength(2)
    await setup.data.location.agent.sync()
    expect(pending).toHaveLength(2)
  } finally {
    setup.dispose()
  }
})

test("Task invalidations reject an older GET and serialize the active view's replacement read", async () => {
  const firstStarted = Promise.withResolvers<void>()
  const secondStarted = Promise.withResolvers<void>()
  const reads: PromiseWithResolvers<Response>[] = []
  const setup = taskRefreshFixture(() => {
    const read = Promise.withResolvers<Response>()
    reads.push(read)
    if (reads.length === 1) firstStarted.resolve()
    if (reads.length === 2) secondStarted.resolve()
    return read.promise
  })
  try {
    const first = setup.data.session.task.sync("ses_task_refresh")
    await firstStarted.promise
    setup.emit(taskUpdated(2))
    const second = setup.data.session.task.sync("ses_task_refresh")
    setup.emit(taskUpdated(3))
    const third = setup.data.session.task.sync("ses_task_refresh")
    expect(reads).toHaveLength(1)
    reads[0]?.resolve(Response.json([taskSnapshot(1)]))
    await first
    await secondStarted.promise
    expect(reads).toHaveLength(2)
    expect(setup.data.session.task.list("ses_task_refresh")).toBeUndefined()
    reads[1]?.resolve(Response.json([taskSnapshot(3)]))
    await Promise.all([second, third])
    expect(setup.data.session.task.list("ses_task_refresh")).toEqual([taskSnapshot(3)])
    await setup.data.session.task.sync("ses_task_refresh")
    expect(reads).toHaveLength(2)
  } finally {
    reads.forEach((read) => read.resolve(Response.json([])))
    setup.dispose()
  }
})

test("Task events leave unread and idle cached Sessions dormant across reconnection", async () => {
  const [connection, setConnection] = createStore<{ status: "connected" | "reconnecting" }>({ status: "connected" })
  const state = { revision: 1 }
  const setup = taskRefreshFixture(() => Response.json([taskSnapshot(state.revision)]), {
    status: () => connection.status,
  })
  try {
    setup.emit(taskUpdated(1))
    expect(setup.requests).toEqual([])
    expect(setup.data.session.task.list("ses_task_refresh")).toBeUndefined()
    await setup.data.session.task.sync("ses_task_refresh")
    state.revision = 2
    setup.emit(taskUpdated(20))
    await Promise.resolve()
    expect(setup.requests).toHaveLength(1)
    expect(setup.data.session.task.list("ses_task_refresh")).toEqual([taskSnapshot(1)])
    setConnection("status", "reconnecting")
    setup.emit(taskUpdated(21))
    setConnection("status", "connected")
    await Promise.resolve()
    expect(setup.requests).toHaveLength(1)
    // The expanded view requests this read; event delivery and reconnection only invalidated the cache.
    await setup.data.session.task.sync("ses_task_refresh")
    expect(setup.requests).toHaveLength(2)
    expect(setup.data.session.task.list("ses_task_refresh")).toEqual([taskSnapshot(2)])
    setup.emit({ ...taskUpdated(22), data: { sessionID: "ses_task_unread", tasks: [] } })
    expect(setup.data.session.task.list("ses_task_unread")).toBeUndefined()
    expect(setup.requests).toHaveLength(2)
  } finally {
    setup.dispose()
  }
})

test.each(["deleted", "disposed"] as const)(
  "Task read ownership stays revoked after the Session is %s",
  async (action) => {
    const requested = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<Response>()
    const state = { reads: 0 }
    const setup = taskRefreshFixture(() => {
      state.reads++
      if (state.reads === 1) return Response.json([taskSnapshot(1)])
      requested.resolve()
      return pending.promise
    })
    try {
      await setup.data.session.task.sync("ses_task_refresh")
      setup.data.session.task.invalidate("ses_task_refresh")
      const old = setup.data.session.task.sync("ses_task_refresh")
      await requested.promise
      setup.emit(taskUpdated(2))
      const queued = setup.data.session.task.sync("ses_task_refresh")
      if (action === "deleted")
        setup.emit({
          id: "evt_task_owner_deleted",
          created: 2,
          type: "session.deleted",
          durable: { aggregateID: "ses_task_refresh", seq: 1, version: 1 },
          data: { sessionID: "ses_task_refresh" },
        })
      if (action === "disposed") setup.dispose()
      pending.resolve(Response.json([taskSnapshot(2)]))
      await Promise.all([old, queued])
      expect(setup.data.session.task.list("ses_task_refresh")).toEqual(
        action === "deleted" ? undefined : [taskSnapshot(1)],
      )
      expect(setup.requests).toHaveLength(2)
    } finally {
      pending.resolve(Response.json([]))
      setup.dispose()
    }
  },
)

function taskSnapshot(revision: number): SessionTaskInfo {
  return {
    id: "tsk_refresh",
    sessionID: "ses_task_refresh",
    content: `Task ${revision}`,
    status: "pending",
    priority: "medium",
    revision,
    createdAt: 1,
    updatedAt: revision,
  }
}

function taskUpdated(revision: number): AigcForgeEvent {
  return {
    id: `evt_tasks_${revision}`,
    created: revision,
    type: "task.updated",
    data: { sessionID: "ses_task_refresh", tasks: [taskSnapshot(revision)] },
  }
}

function taskRefreshFixture(
  read: (request: Request) => Response | Promise<Response>,
  connection?: CreateDataInput["connection"],
) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: Request[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())
      return Promise.resolve(read(request))
    },
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      connection,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    requests,
    emit: (details: AigcForgeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    dispose,
  }))
}

test("an old API's session read resolves without projecting into its replacement", async () => {
  const response = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  const requests: string[] = []
  const initial: SessionInfo = {
    id: "ses_api_owner",
    projectID: "project",
    agent: "meta",
    controller: { kind: "root", metaAgentID: "meta_owner", rootSessionID: "ses_api_owner" },
    model: { id: "cpu", providerID: "provider" },
    executorPreference: { agent: "build" },
    location: { directory: "/project" },
    time: { created: 1, updated: 1 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const replacementSnapshot: SessionInfo = {
    ...initial,
    model: { id: "replacement", providerID: "provider", variant: "default" },
    executorPreference: { agent: "explore" },
    time: { created: 1, updated: 3 },
  }
  const owner = AigcForge.make({
    baseUrl: "http://owner.local",
    fetch: (input, init) => {
      requests.push((input instanceof Request ? input : new Request(input, init)).url)
      started.resolve()
      return response.promise
    },
  })
  const replacement = AigcForge.make({
    baseUrl: "http://replacement.local",
    fetch: async (input, init) => {
      requests.push((input instanceof Request ? input : new Request(input, init)).url)
      return Response.json({ data: replacementSnapshot })
    },
  })
  const api = { current: owner }
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api.current,
      directory: "/project",
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    setup.data.session.remember(initial)
    setup.data.session.invalidate(initial.id)
    const reading = setup.data.session.sync(initial.id)
    await started.promise
    api.current = replacement
    response.resolve(Response.json({ data: { ...initial, title: "Old API", time: { created: 1, updated: 2 } } }))
    await reading
    expect(setup.data.session.get(initial.id)).toMatchObject(initial)
    expect(setup.data.session.get(initial.id)?.title).toBeUndefined()
    setup.data.session.invalidate(initial.id)
    await setup.data.session.sync(initial.id)
    expect(setup.data.session.get(initial.id)).toMatchObject(replacementSnapshot)
    expect(requests).toEqual([
      "http://owner.local/api/session/ses_api_owner",
      "http://replacement.local/api/session/ses_api_owner",
    ])
  } finally {
    response.resolve(Response.json({ data: initial }))
    setup.dispose()
  }
})
