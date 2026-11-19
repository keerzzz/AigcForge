import { expect, test } from "bun:test"
import { getEventListeners } from "node:events"
import { createComputed, createMemo, createRoot, createSignal } from "solid-js"
import { unwrap } from "solid-js/store"
import { isServer } from "solid-js/web"
import { createData, type CreateDataInput } from "../src/solid"
import {
  AigcForge,
  ClientError,
  type ModelInfo,
  type AigcForgeEvent,
  type Project,
  type SessionInfo,
  type SessionIdentityIdentity,
  type SessionInboxInfo,
  type SessionMessageInfo,
  type SessionMessageAssistantTool,
  type SessionTaskInfo,
  type SessionTaskOperationInfo,
  type SessionGoalInfo,
  type SessionCommunicationMessage,
  type SessionCommunicationReceipt,
  type ScheduleRule,
  type ScheduleOccurrence,
  type PermissionRequest,
  type DelegationLegacyState,
  type PersonalMemoryInfo,
} from "../src/promise"

const session = (viewed: number): SessionInfo => ({
  id: "ses_refresh",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  outcome: "succeeded",
  time: { created: 0, updated: 0, idle: 2, viewed },
  location: { directory: "/project" },
})

test("executor selection events preserve the CPU ref and transcript while invalidating stale reads", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const initial: SessionInfo = {
    ...session(0),
    agent: "meta",
    controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" },
    model: { providerID: "cpu", id: "cpu", variant: "high" },
    executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
  }
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<SessionInfo>()
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async () => {
      started.resolve()
      return Response.json({ data: await release.promise })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen: (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      },
    }),
    dispose,
  }))
  try {
    setup.data.session.remember(initial)
    setup.data.session.invalidate(initial.id)
    const read = setup.data.session.sync(initial.id)
    await started.promise
    const event: AigcForgeEvent = {
      id: "evt_executor",
      type: "session.executor.selected",
      created: 5,
      data: {
        sessionID: initial.id,
        executorPreference: { agent: "explore", model: { providerID: "worker", id: "other", variant: "high" } },
      },
    }
    for (const fn of listeners) fn({ name: event.type, details: event })
    release.resolve(initial)
    expect(await read).toBeUndefined()
    expect(setup.data.session.get(initial.id)).toMatchObject({
      agent: "meta",
      model: initial.model,
      controller: initial.controller,
      executorPreference: event.data.executorPreference,
      time: { updated: 5 },
    })
    expect(setup.data.session.message.list(initial.id)).toEqual([])
  } finally {
    release.resolve(initial)
    setup.dispose()
  }
})

test("uses the configured initial window and retains normal cursor page sizes", async () => {
  const requests: { limit: string | null; cursor: string | null }[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const url = new URL((input instanceof Request ? input : new Request(input, init)).url)
      const cursor = url.searchParams.get("cursor")
      requests.push({ limit: url.searchParams.get("limit"), cursor })
      return Response.json({
        data: [{ id: cursor ? "msg_1" : "msg_2", type: "user", text: "History", time: { created: cursor ? 1 : 2 } }],
        cursor: cursor ? {} : { next: "older" },
      })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      initialMessageLimit: () => 40,
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    await setup.data.session.message.sync("ses_refresh")
    await setup.data.session.message.sync("ses_refresh")
    expect(requests).toEqual([{ limit: "40", cursor: null }])
    await setup.data.session.message.loadMore("ses_refresh")
    expect(requests).toEqual([
      { limit: "40", cursor: null },
      { limit: "20", cursor: "older" },
    ])
    expect(setup.data.session.message.list("ses_refresh").map((message) => message.id)).toEqual(["msg_1", "msg_2"])
  } finally {
    setup.dispose()
  }
})

test.each(
  (["message", "pending"] as const).flatMap((resource) =>
    (
      [
        "API replaced",
        "invalidated",
        "evicted",
        "deleted",
        "disposed",
        "queued replacement",
        "disposed queued",
        "transport rejected",
      ] as const
    ).map((mode) => [resource, mode] as const),
  ),
)("hydration owner (%s / %s)", async (resource, mode) => {
  const live: SessionInboxInfo = {
    id: "msg_live",
    sessionID: "ses_refresh",
    type: "user",
    delivery: "steer",
    payload: { text: "Current input" },
    time: { created: 1 },
  }
  const canonical = { id: "msg_current", type: "user", text: "Current API", time: { created: 3 } } as const
  const response = (stale: boolean) =>
    Response.json({
      data:
        resource === "message"
          ? [stale ? { ...canonical, id: "msg_stale", text: "Stale API" } : canonical]
          : [
              {
                ...live,
                id: stale ? "msg_stale" : canonical.id,
                payload: { text: stale ? "Stale API" : canonical.text },
              },
            ],
      ...(resource === "message" ? { cursor: { next: stale ? "stale-cursor" : "current-cursor" } } : {}),
    })
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const replacementStarted = Promise.withResolvers<void>()
  const replacementRelease = Promise.withResolvers<Response>()
  const replacementRequests: Request[] = []
  const setup = taskFixture(() => {
    if (setup.requests.length > 1) return response(false)
    started.resolve()
    return release.promise
  })
  const replacement = AigcForge.make({
    baseUrl: "http://replacement.local",
    fetch: (input, init) => {
      replacementRequests.push(input instanceof Request ? input : new Request(input, init))
      replacementStarted.resolve()
      return replacementRelease.promise
    },
  })
  const reads: Promise<unknown>[] = []
  try {
    setup.data.session.remember(session(0))
    setup.emit({
      id: "evt_live",
      type: "session.inbox.enqueued",
      created: 1,
      durable: { aggregateID: live.sessionID, seq: 1, version: 1 },
      data: {
        sessionID: live.sessionID,
        inboxID: live.id,
        item: { type: live.type, delivery: live.delivery, payload: live.payload },
      },
    })
    const reading = setup.data.session[resource].sync(live.sessionID)
    reads.push(reading)
    const originalSettled = Promise.allSettled([reading])
    await Promise.race([started.promise, originalSettled])
    expect(setup.requests).toHaveLength(1)
    expect(new URL(setup.requests[0]!.url).pathname).toBe(
      `/api/session/ses_refresh/${resource === "message" ? "message" : "inbox"}`,
    )
    if (mode === "invalidated" || mode === "queued replacement" || mode === "disposed queued")
      setup.data.session[resource].invalidate(live.sessionID)
    if (mode === "queued replacement" || mode === "disposed queued")
      reads.push(setup.data.session[resource].sync(live.sessionID))
    if (mode === "API replaced" || mode === "queued replacement") setup.owner.api = replacement
    if (mode === "evicted") setup.data.session.evict(live.sessionID)
    if (mode === "deleted")
      setup.emit({
        id: "evt_deleted",
        type: "session.deleted",
        created: 2,
        durable: { aggregateID: live.sessionID, seq: 2, version: 1 },
        data: { sessionID: live.sessionID },
      })
    if (mode === "disposed" || mode === "disposed queued") setup.dispose()
    if (mode === "transport rejected") release.reject(new TypeError("Connection closed"))
    if (mode !== "transport rejected") release.resolve(response(true))
    const original = await originalSettled
    expect(original.map((entry) => entry.status)).toEqual([mode === "transport rejected" ? "rejected" : "fulfilled"])
    if (mode === "transport rejected") expect(original).toMatchObject([{ reason: { reason: "Transport" } }])
    expect(setup.data.session.message.list(live.sessionID).map((item) => item.id)).toEqual(
      mode === "evicted" || mode === "deleted" ? [] : [live.id],
    )
    expect(setup.data.session.pending.list(live.sessionID)).toEqual(
      mode === "evicted" || mode === "deleted" ? [] : [live],
    )
    expect(setup.data.session.message.get(live.sessionID, "msg_stale")).toBeUndefined()
    expect(setup.data.session.message.more(live.sessionID)).toBe(false)
    if (mode === "disposed" || mode === "disposed queued") {
      reads.push(setup.data.session[resource].sync(live.sessionID))
      await Promise.allSettled(reads)
      expect(setup.requests).toHaveLength(1)
      return
    }
    if (mode !== "API replaced" && mode !== "queued replacement" && mode !== "invalidated") return
    if (mode !== "queued replacement") reads.push(setup.data.session[resource].sync(live.sessionID))
    if (mode !== "invalidated") {
      await Promise.race([replacementStarted.promise, Promise.allSettled(reads)])
      expect(replacementRequests).toHaveLength(1)
      expect(new URL(replacementRequests[0]!.url).hostname).toBe("replacement.local")
      replacementRelease.resolve(response(false))
    }
    await Promise.all(reads)
    expect(setup.data.session.message.get(live.sessionID, canonical.id)).toMatchObject({ text: canonical.text })
    expect(setup.data.session.message.more(live.sessionID)).toBe(resource === "message")
    const count = setup.requests.length + replacementRequests.length
    await setup.data.session[resource].sync(live.sessionID)
    expect(setup.requests.length + replacementRequests.length).toBe(count)
  } finally {
    release.resolve(response(true))
    replacementRelease.resolve(response(false))
    await Promise.allSettled(reads)
    setup.dispose()
  }
})

test("a revoked inbox snapshot cannot acknowledge an optimistic admission", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const gate = Promise.withResolvers<void>()
  const setup = taskFixture(() => {
    started.resolve()
    return release.promise
  })
  const sending = setup.data.session.prompt({
    sessionID: "ses_refresh",
    id: "msg_optimistic",
    text: "Keep until ACK",
    gate: gate.promise,
  })
  const settled = Promise.allSettled([sending])
  const reading = setup.data.session.pending.sync("ses_refresh")
  try {
    await started.promise
    setup.data.session.pending.invalidate("ses_refresh")
    release.resolve(
      Response.json({
        data: [
          {
            id: "msg_optimistic",
            sessionID: "ses_refresh",
            type: "user",
            delivery: "steer",
            payload: { text: "Keep until ACK" },
            time: { created: 1 },
          },
        ],
      }),
    )
    await reading
    gate.reject(new Error("Admission cancelled before POST"))
    expect((await settled)[0]?.status).toBe("rejected")
    expect(setup.data.session.input.list("ses_refresh")).toEqual([])
    expect(setup.data.session.message.get("ses_refresh", "msg_optimistic")).toBeUndefined()
    expect(setup.requests).toHaveLength(1)
  } finally {
    gate.resolve()
    release.resolve(Response.json({ data: [] }))
    await Promise.allSettled([reading, sending])
    setup.dispose()
  }
})

test.each([
  "assistant delta",
  "terminal after missed text",
  "delivered user",
  "initial events",
  "missed tool",
  "tool progress",
  "live tool after snapshot",
  "tool metadata array",
] as const)("message hydration retains concurrent %s", async (mode) => {
  const tool: SessionMessageAssistantTool = {
    type: "tool",
    id: "call_c",
    name: "read",
    time: { created: 3, ran: 3 },
    state: {
      status: "running",
      input: { path: "c" },
      metadata: {
        phase: "before",
        ...(mode === "tool metadata array"
          ? { entries: [{ type: "tool", id: "nested_before", value: "before" }] }
          : {}),
      },
    },
  }
  const recovered: SessionMessageAssistantTool = {
    type: "tool",
    id: "call_b",
    name: "read",
    time: { created: 2, ran: 2, completed: 2 },
    state: {
      status: "completed",
      input: { path: "b" },
      metadata: {},
      content: [{ type: "text", text: "Complete recovered tool result" }],
    },
  }
  const assistant: SessionMessageInfo = {
    id: "msg_assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      { type: "text", text: "Before" },
      ...(mode === "tool progress" || mode === "tool metadata array" ? [tool] : []),
    ],
    time: { created: 1 },
  }
  const user = { id: "msg_user", type: "user", text: "History", time: { created: 0 } } as const
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const setup = taskFixture(() => {
    if (mode !== "initial events" && setup.requests.length === 1)
      return Response.json({ data: [assistant, user], cursor: {} })
    started.resolve()
    return release.promise
  })
  const reads: Promise<unknown>[] = []
  try {
    if (mode !== "initial events") {
      await setup.data.session.message.sync("ses_refresh")
      setup.data.session.message.invalidate("ses_refresh")
    }
    const reading = setup.data.session.message.sync("ses_refresh")
    reads.push(reading)
    await Promise.race([started.promise, Promise.allSettled(reads)])
    if (mode === "delivered user") {
      setup.emit({
        id: "evt_enqueued",
        type: "session.inbox.enqueued",
        created: 2,
        durable: { aggregateID: "ses_refresh", seq: 2, version: 1 },
        data: {
          sessionID: "ses_refresh",
          inboxID: "msg_delivered",
          item: { type: "user", delivery: "steer", payload: { text: "New input" } },
        },
      })
      setup.emit({
        id: "evt_delivered",
        type: "session.inbox.delivered",
        created: 3,
        durable: { aggregateID: "ses_refresh", seq: 3, version: 1 },
        data: { sessionID: "ses_refresh", inboxID: "msg_delivered" },
      })
    }
    if (mode === "initial events") {
      setup.emit({
        id: "evt_started",
        type: "session.step.started",
        created: 1,
        durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
        data: {
          sessionID: "ses_refresh",
          assistantMessageID: assistant.id,
          agent: "build",
          model: assistant.model,
          started: 1,
        },
      })
      setup.emit({
        id: "evt_text",
        type: "session.text.started",
        created: 2,
        data: { sessionID: "ses_refresh", assistantMessageID: assistant.id },
      })
    }
    if (mode === "assistant delta" || mode === "initial events" || mode === "terminal after missed text") {
      if (mode !== "terminal after missed text")
        setup.emit({
          id: "evt_delta",
          type: "session.text.delta",
          created: 3,
          data: { sessionID: "ses_refresh", assistantMessageID: assistant.id, delta: " New" },
        })
      setup.emit({
        id: "evt_ended",
        type: "session.step.ended",
        created: 4,
        durable: { aggregateID: "ses_refresh", seq: 4, version: 1 },
        data: {
          sessionID: "ses_refresh",
          assistantMessageID: assistant.id,
          finish: "stop",
          cost: 0,
          tokens: session(0).tokens,
        },
      })
      setup.emit({
        id: "evt_completed",
        type: "session.step.completed",
        created: 5,
        durable: { aggregateID: "ses_refresh", seq: 5, version: 1 },
        data: { sessionID: "ses_refresh", assistantMessageID: assistant.id },
      })
    }
    if (mode === "missed tool" || mode === "live tool after snapshot") {
      setup.emit({
        id: "evt_tool_c_started",
        type: "session.tool.input.started",
        created: 3,
        data: { sessionID: "ses_refresh", assistantMessageID: assistant.id, id: tool.id, name: tool.name },
      })
      setup.emit({
        id: "evt_tool_c_called",
        type: "session.tool.called",
        created: 3,
        durable: { aggregateID: "ses_refresh", seq: 3, version: 1 },
        data: {
          sessionID: "ses_refresh",
          assistantMessageID: assistant.id,
          id: tool.id,
          input: { path: "c" },
          executed: true,
        },
      })
    }
    if (
      mode === "missed tool" ||
      mode === "tool progress" ||
      mode === "live tool after snapshot" ||
      mode === "tool metadata array"
    )
      setup.emit({
        id: "evt_tool_c_progress",
        type: "session.tool.progress",
        created: 4,
        data: {
          sessionID: "ses_refresh",
          assistantMessageID: assistant.id,
          id: tool.id,
          metadata: {
            phase: "live",
            ...(mode === "tool metadata array"
              ? { entries: [{ type: "tool", id: "nested_live", value: "live" }] }
              : {}),
          },
        },
      })
    release.resolve(
      Response.json({
        data:
          mode === "initial events"
            ? [user]
            : [
                mode === "missed tool" ||
                mode === "tool progress" ||
                mode === "live tool after snapshot" ||
                mode === "tool metadata array"
                  ? {
                      ...assistant,
                      content: [
                        { type: "text", text: "Before Middle" },
                        recovered,
                        ...(mode === "live tool after snapshot"
                          ? []
                          : [
                              mode === "missed tool"
                                ? { ...tool, state: { status: "streaming", input: '{"path":"c"}' } }
                                : mode === "tool metadata array"
                                  ? {
                                      ...tool,
                                      state: {
                                        ...tool.state,
                                        metadata: {
                                          phase: "snapshot",
                                          entries: [
                                            { type: "tool", id: "nested_before", value: "snapshot" },
                                            { type: "tool", id: "nested_server", value: "server" },
                                          ],
                                        },
                                      },
                                    }
                                  : tool,
                            ]),
                      ],
                    }
                  : mode === "terminal after missed text"
                    ? { ...assistant, content: [{ type: "text", text: "Before Middle" }] }
                    : assistant,
                { ...user, text: "Fresh history" },
              ],
        cursor: { next: "older" },
      }),
    )
    await reading
    expect(setup.data.session.message.more("ses_refresh")).toBe(true)
    const messages = setup.data.session.message.list("ses_refresh")
    expect(new Set(messages.map((item) => item.id)).size).toBe(messages.length)
    if (mode === "assistant delta" || mode === "initial events" || mode === "terminal after missed text") {
      const current = setup.data.session.message.get("ses_refresh", assistant.id)
      expect(current?.type).toBe("assistant")
      if (current?.type !== "assistant") throw new Error("Missing live assistant")
      const text = current.content[0]
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("Missing live text")
      expect(text.text).toBe(
        mode === "terminal after missed text" ? "Before Middle" : mode === "assistant delta" ? "Before New" : " New",
      )
      expect(current.time.completed).toBe(4)
      expect(current.finish).toBe("stop")
      expect(current.completion?.id).toBe("evt_completed")
      expect(current.completion?.seq).toBe(5)
    }
    if (mode === "delivered user") {
      expect(messages.map((item) => item.id)).toEqual([user.id, assistant.id, "msg_delivered"])
      expect(setup.data.session.message.get("ses_refresh", "msg_delivered")).toMatchObject({
        text: "New input",
        time: { created: 3 },
      })
      expect(setup.data.session.input.has("ses_refresh", "msg_delivered")).toBe(false)
    }
    if (
      mode === "missed tool" ||
      mode === "tool progress" ||
      mode === "live tool after snapshot" ||
      mode === "tool metadata array"
    ) {
      const current = setup.data.session.message.get("ses_refresh", assistant.id)
      if (current?.type !== "assistant") throw new Error("Missing hydrated assistant")
      expect(current.content.map((part) => (part.type === "tool" ? part.id : part.type))).toEqual([
        "text",
        "call_b",
        "call_c",
      ])
      expect(current.content[0]).toEqual({ type: "text", text: "Before Middle" })
      expect(current.content[1]).toEqual(recovered)
      expect(current.content[2]).toMatchObject({
        id: tool.id,
        state: { status: "running", input: { path: "c" }, metadata: { phase: "live" } },
      })
      if (mode === "tool metadata array")
        expect(unwrap(current.content[2])).toMatchObject({
          state: {
            metadata: {
              entries: [
                { type: "tool", id: "nested_live", value: "live" },
                { type: "tool", id: "nested_server", value: "server" },
              ],
            },
          },
        })
    }
    if (mode === "assistant delta" || mode === "terminal after missed text" || mode === "delivered user")
      expect(setup.data.session.message.get("ses_refresh", user.id)).toMatchObject({ text: "Fresh history" })
    expect(setup.requests).toHaveLength(mode === "initial events" ? 1 : 2)
  } finally {
    release.resolve(Response.json({ data: [], cursor: {} }))
    await Promise.allSettled(reads)
    setup.dispose()
  }
})

test("reconciles a stale running tool when execution settles", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let completed = false
  let requests = 0
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async () => {
      requests++
      return Response.json({
        data: [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            time: { created: 1, ...(completed ? { completed: 2 } : {}) },
            content: [
              {
                type: "tool",
                id: "call_execute",
                name: "execute",
                time: { created: 1, ran: 1, ...(completed ? { completed: 2 } : {}) },
                state: completed
                  ? { status: "completed", input: {}, metadata: {}, content: [] }
                  : { status: "running", input: {}, metadata: {} },
              },
            ],
          },
        ],
        cursor: {},
      })
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
      connection: { status: () => "connected" },
    }),
    dispose,
  }))
  try {
    await setup.data.session.message.sync("ses_refresh")
    completed = true
    const interrupted: AigcForgeEvent = {
      id: "evt_interrupted",
      created: 3,
      type: "session.execution.interrupted",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: { sessionID: "ses_refresh", reason: "user" },
    }
    listeners.forEach((listener) => listener({ name: interrupted.type, details: interrupted }))

    await wait(
      () =>
        setup.data.session.message.get("ses_refresh", "msg_assistant")?.content[0]?.type === "tool" &&
        setup.data.session.message.get("ses_refresh", "msg_assistant")?.content[0]?.state.status === "completed",
    )
    expect(requests).toBe(2)
    expect(setup.data.session.message.get("ses_refresh", "msg_assistant")?.content[0]).toMatchObject({
      state: { status: "completed" },
    })
  } finally {
    setup.dispose()
  }
})

test("revalidates after an event overtakes an active session read", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let requests = 0
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session/ses_refresh")) throw new Error(`Unexpected request: ${request.url}`)
      requests++
      if (requests === 1) {
        await gate
        return Response.json({ data: session(1) })
      }
      return Response.json({ data: session(2) })
    },
  })
  const event: CreateDataInput["event"] = {
    on:
      <Type extends AigcForgeEvent["type"]>(
        _type: Type,
        _handler: (event: Extract<AigcForgeEvent, { type: Type }>) => void,
      ) =>
      () => {},
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    setup.data.session.remember(session(1))
    setup.data.session.invalidate("ses_refresh")
    const initial = setup.data.session.sync("ses_refresh")
    await wait(() => requests === 1)

    const viewed: AigcForgeEvent = {
      id: "evt_viewed",
      created: 2,
      type: "session.viewed",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: { sessionID: "ses_refresh", idle: 2 },
    }
    listeners.forEach((listener) => listener({ name: viewed.type, details: viewed }))
    await Bun.sleep(20)
    release()
    await initial

    await wait(() => requests === 2 && setup.data.session.get("ses_refresh")?.time.viewed === 2)
  } finally {
    setup.dispose()
  }
})

test("preserves a live session rename across concurrent session and family reads", async () => {
  const family = Promise.withResolvers<void>()
  const renamed = Promise.withResolvers<void>()
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let requests = 0
  const stale = { ...session(0), title: undefined }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith(`/api/session/${stale.id}`)) return Response.json({ data: [], cursor: {} })
      requests++
      await (requests === 1 ? family.promise : renamed.promise)
      return Response.json({ data: stale })
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
    }),
    dispose,
  }))

  try {
    const initial = setup.data.session.sync(stale.id, { children: true })
    await wait(() => requests === 1)
    const event: AigcForgeEvent = {
      id: "evt_renamed",
      created: 1,
      type: "session.renamed",
      durable: { aggregateID: stale.id, seq: 1, version: 1 },
      data: { sessionID: stale.id, title: "Generated title" },
    }
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await wait(() => requests === 2)
    renamed.resolve()
    await wait(() => setup.data.session.get(stale.id) !== undefined)
    family.resolve()
    await initial
    await Bun.sleep(0)

    expect(setup.data.session.get(stale.id)?.title).toBe("Generated title")
  } finally {
    family.resolve()
    renamed.resolve()
    setup.dispose()
  }
})

test.each([
  "adopted",
  "legacy sync",
  "equal timestamp",
  "joined",
  "cache hit",
  "older snapshot",
  "invalidated",
  "API replaced",
  "disposed",
  "transport rejected",
  "family",
  "family joined",
  "family root older",
  "family child cache hit",
] as const)("Session readback and legacy sync report the expected result for %s", async (mode) => {
  const canonical: SessionInfo = {
    ...session(1),
    agent: "meta",
    controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" },
    model: { providerID: "cpu", id: "cpu", variant: "high" },
    executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
    time: { ...session(1).time, updated: mode === "equal timestamp" ? 0 : 1 },
  }
  const cached =
    mode === "cache hit"
      ? canonical
      : {
          ...canonical,
          title: "Cached snapshot",
          time: {
            ...canonical.time,
            viewed: 0,
            updated: mode === "older snapshot" || mode === "family root older" ? 2 : 0,
          },
        }
  const child: SessionInfo = { ...session(1), id: "ses_adoption_child", parentID: canonical.id }
  const family = mode.startsWith("family")
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const replacementRequests: Request[] = []
  const replacement = AigcForge.make({
    baseUrl: "http://replacement.local",
    fetch: async (input, init) => {
      replacementRequests.push(input instanceof Request ? input : new Request(input, init))
      return Response.json({ data: canonical })
    },
  })
  const setup = taskFixture((request) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/session/" + canonical.id) {
      started.resolve()
      return release.promise
    }
    if (family && url.pathname === "/api/session" && url.searchParams.get("parentID") === canonical.id)
      return Response.json({ data: [child], cursor: {} })
    throw new Error("Unexpected request: " + request.url)
  })
  const pending: Promise<unknown>[] = []
  try {
    if (mode !== "adopted") setup.data.session.remember(cached)
    if (mode !== "cache hit") setup.data.session.invalidate(canonical.id)
    const reading =
      mode === "legacy sync"
        ? setup.data.session.sync(canonical.id)
        : setup.data.session.readback(canonical.id, family ? { children: true } : undefined)
    pending.push(reading)
    if (mode.endsWith("joined"))
      pending.push(setup.data.session.readback(canonical.id, family ? { children: true } : undefined))
    const settled = Promise.allSettled(pending)
    if (mode === "cache hit") {
      expect(await settled).toEqual([{ status: "fulfilled", value: undefined }])
      expect(setup.data.session.get(canonical.id)).toEqual(canonical)
      expect(setup.requests).toEqual([])
      return
    }
    await Promise.race([started.promise, settled])
    expect(
      setup.requests.filter((request) => new URL(request.url).pathname === "/api/session/" + canonical.id),
    ).toHaveLength(1)
    if (mode === "invalidated") setup.data.session.invalidate(canonical.id)
    if (mode === "API replaced") setup.owner.api = replacement
    if (mode === "disposed") setup.dispose()
    if (mode === "transport rejected") release.reject(new TypeError("Connection closed"))
    if (mode !== "transport rejected") release.resolve(Response.json({ data: canonical }))
    const outcome = await settled
    expect(setup.requests).toHaveLength(family ? 2 : 1)
    expect(setup.requests.every((request) => request.method === "GET")).toBe(true)
    expect(replacementRequests).toEqual([])
    if (mode === "transport rejected") {
      expect(outcome).toMatchObject([{ status: "rejected", reason: { name: "ClientError", reason: "Transport" } }])
      expect(setup.data.session.get(canonical.id)).toEqual(cached)
      return
    }
    const discarded =
      mode === "older snapshot" ||
      mode === "family root older" ||
      mode === "invalidated" ||
      mode === "API replaced" ||
      mode === "disposed"
    expect(outcome).toEqual([
      { status: "fulfilled", value: discarded || mode === "legacy sync" ? undefined : canonical },
      ...(mode.endsWith("joined") ? [{ status: "fulfilled", value: undefined }] : []),
    ])
    expect(setup.data.session.get(canonical.id)).toEqual(discarded ? cached : canonical)
    if (!family) return
    expect(setup.data.session.get(child.id)).toEqual(child)
    if (mode !== "family child cache hit") return
    expect(await setup.data.session.readback(child.id)).toBeUndefined()
    expect(setup.requests).toHaveLength(2)
  } finally {
    release.resolve(Response.json({ data: canonical }))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test("a queued Session reload captures the API when its load starts", async () => {
  const initial: SessionInfo = { ...session(0), model: { providerID: "cpu", id: "before", variant: "high" } }
  const canonical: SessionInfo = {
    ...session(1),
    model: { providerID: "cpu", id: "after", variant: "low" },
    time: { ...session(1).time, updated: 1 },
  }
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const replacementStarted = Promise.withResolvers<void>()
  const replacementRelease = Promise.withResolvers<Response>()
  const replacementRequests: Request[] = []
  const setup = taskFixture((request) => {
    if (new URL(request.url).pathname !== "/api/session/" + initial.id)
      throw new Error("Unexpected request: " + request.url)
    started.resolve()
    return release.promise
  })
  const replacement = AigcForge.make({
    baseUrl: "http://replacement.local",
    fetch: (input, init) => {
      replacementRequests.push(input instanceof Request ? input : new Request(input, init))
      replacementStarted.resolve()
      return replacementRelease.promise
    },
  })
  const pending: Promise<unknown>[] = []
  try {
    setup.data.session.remember(initial)
    setup.data.session.invalidate(initial.id)
    const original = setup.data.session.readback(initial.id)
    pending.push(original)
    const originalSettled = Promise.allSettled([original])
    await Promise.race([started.promise, originalSettled])
    expect(setup.requests).toHaveLength(1)
    setup.data.session.invalidate(initial.id)
    pending.push(setup.data.session.readback(initial.id))
    const settled = Promise.allSettled(pending)
    setup.owner.api = replacement
    release.resolve(Response.json({ data: initial }))
    await Promise.race([replacementStarted.promise, settled])
    expect(replacementRequests).toHaveLength(1)
    expect(replacementRequests[0]?.method).toBe("GET")
    expect(new URL(replacementRequests[0]!.url).pathname).toBe("/api/session/" + initial.id)
    expect(setup.requests).toHaveLength(1)
    replacementRelease.resolve(Response.json({ data: canonical }))
    expect(await settled).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: canonical },
    ])
    expect(setup.data.session.get(initial.id)).toEqual(canonical)
  } finally {
    release.resolve(Response.json({ data: initial }))
    replacementRelease.resolve(Response.json({ data: canonical }))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

// These publication observers require Solid's browser graph; SSR skips are not window coverage.
test.skipIf(isServer).each(["API replaced", "disposed", "model event", "executor event"] as const)(
  "Session readback preserves its adoption evidence during browser publication: %s",
  async (mode) => {
    const initial: SessionInfo = {
      ...session(0),
      agent: "meta",
      controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" },
      model: { providerID: "cpu", id: "cpu", variant: "high" },
      executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
    }
    const canonical: SessionInfo = { ...initial, time: { ...session(1).time, updated: 1 } }
    const selectedModel = { providerID: "cpu", id: "event_cpu", variant: "low" }
    const selectedExecutor = {
      agent: "explore",
      model: { providerID: "worker", id: "event_worker", variant: "high" },
    }
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const published = Promise.withResolvers<void>()
    const observation = { fired: false }
    const replacementRequests: Request[] = []
    const replacement = AigcForge.make({
      baseUrl: "http://replacement.local",
      fetch: async (input, init) => {
        replacementRequests.push(input instanceof Request ? input : new Request(input, init))
        return Response.json({ data: canonical })
      },
    })
    const setup = taskFixture((request) => {
      if (new URL(request.url).pathname !== "/api/session/" + canonical.id)
        throw new Error("Unexpected request: " + request.url)
      started.resolve()
      return release.promise
    })
    const observer = createRoot((dispose) => {
      createComputed(() => {
        if (setup.data.session.get(canonical.id)?.time.viewed !== 1 || observation.fired) return
        observation.fired = true
        if (mode === "API replaced") setup.owner.api = replacement
        if (mode === "disposed") setup.dispose()
        if (mode === "model event")
          setup.emit({
            id: "evt_adoption_model",
            type: "session.model.selected",
            created: 2,
            data: { sessionID: canonical.id, model: selectedModel },
          })
        if (mode === "executor event")
          setup.emit({
            id: "evt_adoption_executor",
            type: "session.executor.selected",
            created: 2,
            data: { sessionID: canonical.id, executorPreference: selectedExecutor },
          })
        published.resolve()
      })
      return dispose
    })
    const pending: Promise<unknown>[] = []
    try {
      setup.data.session.remember(initial)
      setup.data.session.invalidate(canonical.id)
      pending.push(setup.data.session.readback(canonical.id))
      const settled = Promise.allSettled(pending)
      await Promise.race([started.promise, settled])
      expect(setup.requests).toHaveLength(1)
      release.resolve(Response.json({ data: canonical }))
      await Promise.race([published.promise, settled])
      expect(observation.fired).toBe(true)
      const outcome = await settled
      expect(setup.requests).toHaveLength(1)
      expect(replacementRequests).toEqual([])
      if (mode === "API replaced" || mode === "disposed") {
        expect(outcome).toEqual([{ status: "fulfilled", value: undefined }])
        expect(setup.data.session.get(canonical.id)).toEqual(canonical)
        return
      }
      expect(outcome).toEqual([{ status: "fulfilled", value: canonical }])
      expect(setup.data.session.get(canonical.id)?.model).toEqual(
        mode === "model event" ? selectedModel : canonical.model,
      )
      expect(setup.data.session.get(canonical.id)?.executorPreference).toEqual(
        mode === "executor event" ? selectedExecutor : canonical.executorPreference,
      )
      expect(setup.data.session.get(canonical.id)?.time.updated).toBe(
        mode === "executor event" || mode === "model event" ? 2 : 1,
      )
      expect(setup.data.session.message.list(canonical.id)).toEqual([])
    } finally {
      release.resolve(Response.json({ data: canonical }))
      await Promise.allSettled(pending)
      observer()
      setup.dispose()
    }
  },
)

test.skipIf(isServer).each(["publication", "followup"] as const)(
  "executor selection preserves its canonical response during %s cache reconciliation",
  async (window) => {
    const initial: SessionInfo = {
      ...session(0),
      agent: "meta",
      controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" },
      model: { providerID: "cpu", id: "cpu", variant: "high" },
    }
    const canonical: SessionInfo = {
      ...initial,
      executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
      time: { ...session(1).time, updated: 1 },
    }
    const following: SessionInfo = {
      ...canonical,
      executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "low" } },
      time: { ...canonical.time, updated: 2 },
    }
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const observation = { fired: false }
    const setup = taskFixture((request) => {
      if (new URL(request.url).pathname !== "/api/session/" + canonical.id + "/executor")
        throw new Error("Unexpected executor response request: " + request.url)
      started.resolve()
      return response.promise
    })
    const observer = createRoot((dispose) => {
      createComputed(() => {
        if (window !== "publication" || observation.fired || setup.data.session.get(canonical.id)?.time.viewed !== 1)
          return
        observation.fired = true
        setup.data.session.remember(following)
      })
      return dispose
    })
    const pending: Promise<unknown>[] = []
    try {
      setup.data.session.remember(initial)
      pending.push(
        setup.data.session.selectExecutor({
          sessionID: canonical.id,
          executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
        }),
      )
      const settled = Promise.allSettled(pending)
      await Promise.race([started.promise, settled])
      expect(setup.requests).toHaveLength(1)
      expect(setup.requests[0]?.method).toBe("POST")
      expect(await setup.requests[0]!.json()).toEqual(canonical.executorPreference)
      response.resolve(Response.json({ data: canonical }))
      const outcomes = await settled
      if (window === "followup") setup.data.session.remember(following)
      expect(observation.fired).toBe(window === "publication")
      expect(outcomes).toEqual([{ status: "fulfilled", value: canonical }])
      expect(setup.data.session.get(canonical.id)?.executorPreference).toEqual(following.executorPreference)
      expect(setup.data.session.get(canonical.id)?.model).toEqual(initial.model)
      expect(setup.data.session.message.list(canonical.id)).toEqual([])
      expect(setup.requests).toHaveLength(1)
    } finally {
      response.resolve(Response.json({ data: canonical }))
      await Promise.allSettled(pending)
      observer()
      setup.dispose()
    }
  },
)

test.skipIf(isServer).each([
  ["model", false],
  ["model", true],
  ["agent", false],
  ["agent", true],
] as const)("selected %s event discards a held %s-family read before adoption", async (kind, family) => {
  const initial: SessionInfo = {
    ...session(0),
    agent: kind === "model" ? "meta" : "build",
    controller: kind === "model" ? { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" } : undefined,
    model: { providerID: "cpu", id: "cpu", variant: "default" },
  }
  const latest: SessionInfo = {
    ...initial,
    agent: kind === "agent" ? "plan" : initial.agent,
    model: kind === "model" ? { providerID: "cpu", id: "cpu", variant: "high" } : initial.model,
    time: { ...initial.time, updated: 3 },
  }
  const held: SessionInfo = { ...initial, time: { ...initial.time, updated: 2 } }
  const child: SessionInfo = { ...session(0), id: "ses_selection_child", parentID: initial.id, title: "Live child" }
  const heldChild: SessionInfo = { ...child, title: "Held child", time: { ...child.time, updated: 2 } }
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const state = { reads: 0 }
  const setup = taskFixture((request) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/session/" + initial.id) {
      state.reads++
      if (state.reads === 1) {
        started.resolve()
        return release.promise
      }
      return Response.json({ data: latest })
    }
    if (family && url.pathname === "/api/session" && url.searchParams.get("parentID") === initial.id)
      return Response.json({ data: [state.reads === 1 ? heldChild : child], cursor: {} })
    throw new Error("Unexpected selected-event request: " + request.url)
  })
  const pending: Promise<unknown>[] = []
  try {
    setup.data.session.remember(structuredClone(initial))
    if (family) setup.data.session.remember(structuredClone(child))
    setup.data.session.invalidate(initial.id)
    const reading = setup.data.session.readback(initial.id, family ? { children: true } : undefined)
    pending.push(reading)
    await Promise.race([started.promise, Promise.allSettled(pending)])
    expect(state.reads).toBe(1)
    if (kind === "model")
      setup.emit({
        id: "evt_held_model",
        type: "session.model.selected",
        created: 3,
        data: { sessionID: initial.id, model: latest.model! },
      })
    if (kind === "agent")
      setup.emit({
        id: "evt_held_agent",
        type: "session.agent.selected",
        created: 3,
        data: { sessionID: initial.id, agent: "plan" },
      })
    expect(setup.data.session.get(initial.id)?.model).toEqual(latest.model)
    expect(setup.data.session.get(initial.id)?.agent).toBe(latest.agent)
    expect(setup.data.session.get(initial.id)?.time.updated).toBe(3)
    release.resolve(Response.json({ data: held }))
    expect(await reading).toBeUndefined()
    expect(setup.data.session.get(initial.id)?.model).toEqual(latest.model)
    expect(setup.data.session.get(initial.id)?.agent).toBe(latest.agent)
    expect(setup.data.session.get(initial.id)?.time.updated).toBe(3)
    if (family) expect(setup.data.session.get(child.id)).toEqual(child)
    expect(setup.requests).toHaveLength(family ? 2 : 1)
    if (kind === "model") expect(setup.data.session.message.list(initial.id)).toEqual([])
    if (kind === "agent") {
      const messages = setup.data.session.message.list(initial.id)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        type: "agent-switched",
        agent: "plan",
        previous: "build",
        time: { created: 3 },
      })
    }
    const refreshed = setup.data.session.readback(initial.id, family ? { children: true } : undefined)
    pending.push(refreshed)
    expect(await refreshed).toEqual(latest)
    expect(state.reads).toBe(2)
    expect(setup.requests).toHaveLength(family ? 4 : 2)
  } finally {
    release.resolve(Response.json({ data: held }))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test.skipIf(isServer).each(["build", "plan"] as const)(
  "selected %s immediately revokes Meta identity and discards a held Meta response",
  async (agent) => {
    const initial: SessionInfo = {
      ...session(0),
      agent: "meta",
      controller: { kind: "root", metaAgentID: "meta_root", rootSessionID: "ses_refresh" },
    }
    const stale = identityInfo("meta", "evt_meta_selected")
    const fresh = identityInfo(agent, "evt_worker_selected")
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const pending: Promise<void>[] = []
    const setup = taskFixture(() => {
      if (setup.requests.length === 1) return Response.json(stale)
      if (setup.requests.length > 2) return Response.json(fresh)
      started.resolve()
      return release.promise
    })
    try {
      setup.data.session.remember(initial)
      await setup.data.session.identity.sync(initial.id)
      await setup.data.session.identity.sync(initial.id)
      expect(setup.requests).toHaveLength(1)
      expect(setup.data.session.identity.get(initial.id)?.coordination?.available).toBe(true)
      setup.data.session.identity.invalidate(initial.id)
      const held = setup.data.session.identity.sync(initial.id)
      pending.push(held)
      await started.promise
      setup.emit({
        id: "evt_worker_selected",
        type: "session.agent.selected",
        created: 3,
        data: { sessionID: initial.id, agent },
      })
      expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
      expect(setup.data.session.get(initial.id)?.controller).toEqual(initial.controller)
      release.resolve(Response.json(stale))
      await held
      expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
      await setup.data.session.identity.sync(initial.id)
      expect(setup.data.session.identity.get(initial.id)).toEqual(fresh)
      expect(
        setup.data.session.message
          .list(initial.id)
          .map((message) =>
            message.type === "agent-switched" ? { type: message.type, agent: message.agent } : { type: message.type },
          ),
      ).toEqual([{ type: "agent-switched", agent }])
    } finally {
      release.resolve(Response.json(stale))
      await Promise.allSettled(pending)
      setup.dispose()
    }
  },
)

test.skipIf(isServer)("same Meta reselection rejects identity from an older Custom selection", async () => {
  const initial: SessionInfo = { ...session(0), agent: "meta", mode: "custom" }
  const custom = (eventID: string, digest: string): SessionIdentityIdentity => ({
    ...identityInfo("meta", eventID),
    mode: "custom",
    coordination: {
      available: true,
      reasons: [],
      selection: { agent: "meta", event: { id: eventID, seq: 2 }, compositionDigest: digest },
    },
    detail: {
      status: "ready",
      detail: { source: "custom", snapshot: { digest }, policy: { health: "ready", reasons: [] } },
    },
  })
  const stale = custom("evt_old_custom", "a".repeat(64))
  const fresh = custom("evt_new_custom", "a".repeat(64))
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const pending: Promise<void>[] = []
  const setup = taskFixture(() => {
    if (setup.requests.length === 1) return Response.json(stale)
    if (setup.requests.length > 2) return Response.json(fresh)
    started.resolve()
    return release.promise
  })
  try {
    setup.data.session.remember(initial)
    await setup.data.session.identity.sync(initial.id)
    setup.data.session.identity.invalidate(initial.id)
    const held = setup.data.session.identity.sync(initial.id)
    pending.push(held)
    await started.promise
    setup.emit({
      id: "evt_new_custom",
      type: "session.agent.selected",
      created: 3,
      data: { sessionID: initial.id, agent: "meta" },
    })
    expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
    const replacing = setup.data.session.identity.sync(initial.id)
    pending.push(replacing)
    release.resolve(Response.json(stale))
    await Promise.all(pending)
    expect(setup.data.session.identity.get(initial.id)).toEqual(fresh)
    expect(setup.requests).toHaveLength(3)
  } finally {
    release.resolve(Response.json(stale))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test.each([
  "invalidated",
  "API replaced",
  "Location changed",
  "workspace changed",
  "deleted",
  "evicted",
  "disposed",
] as const)("identity owner discards a held read when %s", async (change) => {
  const initial: SessionInfo = { ...session(0), agent: "meta" }
  const stale = identityInfo()
  const fresh = {
    ...identityInfo(),
    location:
      change === "Location changed"
        ? { directory: "/canonical" }
        : { directory: "/project", ...(change === "workspace changed" ? { workspaceID: "wrk_identity" } : {}) },
    permission: { declaredTier: "full" as const, effect: "allow" as const },
  }
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const pending: Promise<void>[] = []
  const setup = taskFixture(() => {
    if (setup.requests.length > 1) return Response.json(fresh)
    started.resolve()
    return release.promise
  })
  try {
    setup.data.session.remember(initial)
    const held = setup.data.session.identity.sync(initial.id)
    pending.push(held)
    await started.promise
    if (change === "invalidated") setup.data.session.identity.invalidate(initial.id)
    if (change === "API replaced")
      setup.owner.api = AigcForge.make({ baseUrl: "http://replacement.local", fetch: async () => Response.json(fresh) })
    if (change === "Location changed")
      setup.data.session.remember({ ...initial, location: { directory: "/canonical" } })
    if (change === "workspace changed")
      setup.data.session.remember({ ...initial, location: { directory: "/project", workspaceID: "wrk_identity" } })
    if (change === "deleted")
      setup.emit({ id: "evt_deleted_identity", type: "session.deleted", created: 3, data: { sessionID: initial.id } })
    if (change === "evicted") setup.data.session.evict(initial.id)
    if (change === "disposed") setup.dispose()
    release.resolve(Response.json(stale))
    await held
    expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
    if (change === "deleted" || change === "evicted" || change === "disposed") return
    await setup.data.session.identity.sync(initial.id)
    expect(setup.data.session.identity.get(initial.id)).toEqual(fresh)
    const request = setup.requests.at(-1)
    if (!request) throw new Error("Identity request missing")
    const url = new URL(request.url)
    if (change === "Location changed") expect(url.searchParams.get("directory")).toBe("/canonical")
    if (change === "workspace changed") expect(url.searchParams.get("workspace")).toBe("wrk_identity")
  } finally {
    release.resolve(Response.json(stale))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test.skipIf(isServer).each(["session.permissions", "agent.updated", "config.updated", "plugin.updated"] as const)(
  "%s clears the displayed identity before a replacement read",
  async (type) => {
    const initial: SessionInfo = { ...session(0), agent: "meta" }
    const value = identityInfo()
    const setup = taskFixture((request) =>
      new URL(request.url).pathname.endsWith("/identity")
        ? Response.json(value)
        : Response.json({ location: initial.location, data: [], providers: [] }),
    )
    try {
      setup.data.session.remember(initial)
      await setup.data.session.identity.sync(initial.id)
      expect(setup.data.session.identity.get(initial.id)).toEqual(value)
      if (type === "session.permissions")
        setup.emit({
          id: "evt_identity_permissions",
          type,
          created: 3,
          data: { sessionID: initial.id, permissions: [] },
        })
      if (type !== "session.permissions")
        setup.emit({ id: "evt_identity_catalog", type, created: 3, location: initial.location, data: {} })
      expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
      await setup.data.session.identity.sync(initial.id)
      expect(setup.data.session.identity.get(initial.id)).toEqual(value)
    } finally {
      setup.dispose()
    }
  },
)

test.skipIf(isServer)("reconnection revokes a held identity even when the same client returns", async () => {
  const [status, setStatus] = createSignal<"connected" | "connecting" | "reconnecting">("connected")
  const initial: SessionInfo = { ...session(0), agent: "meta" }
  const stale = identityInfo()
  const fresh = { ...identityInfo(), permission: { declaredTier: "full" as const, effect: "allow" as const } }
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const setup = taskFixture(
    () => {
      if (setup.requests.length > 1) return Response.json(fresh)
      started.resolve()
      return release.promise
    },
    { status },
  )
  try {
    setup.data.session.remember(initial)
    const held = setup.data.session.identity.sync(initial.id)
    await started.promise
    setStatus("reconnecting")
    expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
    setStatus("connected")
    release.resolve(Response.json(stale))
    await held
    expect(setup.data.session.identity.get(initial.id)).toBeUndefined()
    await setup.data.session.identity.sync(initial.id)
    expect(setup.data.session.identity.get(initial.id)).toEqual(fresh)
  } finally {
    release.resolve(Response.json(stale))
    setup.dispose()
  }
})

test.skipIf(isServer)(
  "create adoption keeps its canonical CPU ACK through a later executor variant mutation",
  async () => {
    const canonical: SessionInfo = {
      ...session(0),
      agent: "meta",
      controller: { kind: "root", metaAgentID: "meta_existing", rootSessionID: "ses_refresh" },
      model: { providerID: "cpu", id: "cpu", variant: "default" },
      executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "default" } },
      time: { created: 1, updated: 1 },
    }
    const following: SessionInfo = {
      ...canonical,
      executorPreference: { agent: "build", model: { providerID: "worker", id: "worker", variant: "low" } },
      time: { ...canonical.time, updated: 2 },
    }
    const setup = taskFixture((request) => {
      const path = new URL(request.url).pathname
      if (request.method === "POST" && path === "/api/session") return Response.json({ data: canonical })
      if (request.method === "POST" && path === "/api/session/" + canonical.id + "/executor")
        return Response.json({ data: following })
      throw new Error("Unexpected create ACK request: " + request.url)
    })
    try {
      expect(setup.data.session.get(canonical.id)).toBeUndefined()
      const created = setup.data.session.create({
        id: canonical.id,
        control: "meta",
        agent: "meta",
        model: canonical.model,
        location: canonical.location,
      })
      const acknowledged = await created.request
      const snapshot = structuredClone(acknowledged)
      expect(acknowledged).toEqual(canonical)
      const selected = await setup.data.session.selectExecutor({
        sessionID: canonical.id,
        executorPreference: following.executorPreference!,
      })
      expect(selected).toEqual(following)
      expect(setup.data.session.get(canonical.id)?.executorPreference).toEqual(following.executorPreference)
      expect(acknowledged).toEqual(snapshot)
      expect(acknowledged.controller).toEqual(canonical.controller)
      expect(acknowledged.model).toEqual(canonical.model)
      expect(acknowledged.executorPreference).toEqual(canonical.executorPreference)
      expect(setup.requests).toHaveLength(2)
    } finally {
      setup.dispose()
    }
  },
)

test("updates authoritative cached project metadata from live events", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const original: Project = {
    id: "project_renamed",
    canonical: "/projects/original",
    name: "Original custom name",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  }
  const unrelated: Project = {
    id: "project_unrelated",
    canonical: "/projects/unrelated",
    name: "Unrelated project",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  }
  let requests = 0
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/project")) throw new Error(`Unexpected request: ${request.url}`)
      requests++
      return Response.json([original, unrelated])
    },
  })
  const event: CreateDataInput["event"] = {
    on: () => () => {},
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/projects/original", event }),
    dispose,
  }))

  try {
    await setup.data.project.sync()
    expect(setup.data.project.get(original.id)).toEqual(original)

    const updated: AigcForgeEvent = {
      id: "evt_project_renamed",
      created: 2,
      type: "project.updated",
      data: {
        ...original,
        canonical: "/projects/renamed",
        name: "Updated custom name",
        time: { ...original.time, updated: 2 },
      },
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))

    expect(setup.data.project.get(original.id)?.canonical).toBe("/projects/renamed")
    expect(setup.data.project.get(original.id)?.name).toBe("Updated custom name")
    expect(setup.data.project.get(unrelated.id)).toEqual(unrelated)
    expect(requests).toBe(1)

    const reset: AigcForgeEvent = {
      id: "evt_project_name_reset",
      created: 3,
      type: "project.updated",
      data: {
        id: original.id,
        canonical: "/projects/renamed-again",
        time: { ...original.time, updated: 3 },
        sandboxes: [],
      },
    }
    listeners.forEach((listener) => listener({ name: reset.type, details: reset }))

    expect(setup.data.project.get(original.id)?.canonical).toBe("/projects/renamed-again")
    expect(setup.data.project.get(original.id)?.name).toBeUndefined()
    expect(setup.data.project.get(unrelated.id)).toEqual(unrelated)
    expect(requests).toBe(1)
  } finally {
    setup.dispose()
  }
})

test("adopts cached directory-project sessions when their repository is resolved", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const refreshed: SessionInfo = {
    ...session(0),
    id: "ses_uncached",
    projectID: "repository",
    location: { directory: "/unknown-alias" },
    subpath: "app",
  }
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session/ses_uncached")) throw new Error(`Unexpected request: ${request.url}`)
      return Response.json({ data: refreshed })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/repo",
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
    const sessions: SessionInfo[] = [
      { ...session(0), id: "ses_root", projectID: "directory-root", location: { directory: "/repo" } },
      { ...session(0), id: "ses_nested", projectID: "directory-nested", location: { directory: "/repo/app" } },
      {
        ...session(0),
        id: "ses_alias",
        projectID: "directory-nested",
        location: { directory: "/repo/alias/../app" },
      },
      { ...session(0), id: "ses_symlink", projectID: "directory-nested", location: { directory: "/shortcut" } },
      { ...refreshed, projectID: "directory-uncached" },
      { ...session(0), id: "ses_global", projectID: "global", location: { directory: "/repo/legacy" } },
      { ...session(0), id: "ses_escaped", projectID: "global", location: { directory: "/repo/../other" } },
      { ...session(0), id: "ses_other", projectID: "other-repository", location: { directory: "/repo/vendor" } },
      { ...session(0), id: "ses_sibling", projectID: "global", location: { directory: "/repo-other" } },
      {
        ...session(0),
        id: "ses_remote",
        projectID: "directory-root",
        location: { directory: "/repo" },
      },
    ]
    sessions.forEach((item) => setup.data.session.remember(item))
    for (const project of [
      { id: "directory-root", canonical: "/repo" },
      { id: "directory-nested", canonical: "/repo/app" },
    ]) {
      const updated: AigcForgeEvent = {
        id: `evt_${project.id}`,
        created: 0,
        type: "project.updated",
        data: { ...project, time: { created: 0, updated: 0 }, sandboxes: [] },
      }
      listeners.forEach((listener) => listener({ name: updated.type, details: updated }))
    }

    const resolved: AigcForgeEvent = {
      id: "evt_repository_resolved",
      created: 1,
      type: "worktree.resolved",
      durable: { aggregateID: "repository", seq: 0, version: 1 },
      data: {
        projectID: "repository",
        directory: "/repo",
        previous: "global",
        adopted: ["directory-root", "directory-nested", "directory-uncached"],
      },
    }
    listeners.forEach((listener) => listener({ name: resolved.type, details: resolved }))

    expect(setup.data.session.get("ses_root")?.projectID).toBe("repository")
    expect(setup.data.session.get("ses_root")?.subpath).toBeUndefined()
    expect(setup.data.session.get("ses_nested")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_alias")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_symlink")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_global")).toMatchObject({ projectID: "repository", subpath: "legacy" })
    expect(setup.data.session.get("ses_escaped")?.projectID).toBe("global")
    expect(setup.data.session.get("ses_other")?.projectID).toBe("other-repository")
    expect(setup.data.session.get("ses_sibling")?.projectID).toBe("global")
    expect(setup.data.session.get("ses_remote")?.projectID).toBe("repository")
    await wait(() => setup.data.session.get("ses_uncached")?.projectID === "repository")
    expect(setup.data.session.get("ses_uncached")?.subpath).toBe("app")
  } finally {
    setup.dispose()
  }
})

test("refreshes global credential events across every loaded location", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: URL[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      const directory = url.searchParams.get("location[directory]") ?? "/project"
      return Response.json({
        location: {
          directory,
          project: { id: "project", directory, canonical: directory },
        },
        data: [],
      })
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
      connection: { status: () => "connected" },
    }),
    dispose,
  }))
  const locations = [{ directory: "/project" }, { directory: "/other" }]

  try {
    await Promise.all(
      locations.flatMap((location) => [
        setup.data.location.integration.sync(location),
        setup.data.location.model.sync(location),
        setup.data.location.provider.sync(location),
        setup.data.location.reference.sync(location),
      ]),
    )
    const references = locations.map((location) => setup.data.location.reference.list(location))
    requests.length = 0

    const updated: AigcForgeEvent = {
      id: "evt_credential.updated",
      created: 1,
      type: "credential.updated",
      data: {},
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))
    await wait(() => requests.length === 2)
    expect(requests.map((url) => [url.pathname, url.searchParams.get("location[directory]")])).toEqual([
      ["/api/integration", "/project"],
      ["/api/integration", "/other"],
    ])
    requests.length = 0

    for (const credentialID of ["credential", null]) {
      const switched: AigcForgeEvent = {
        id: `evt_credential.switched.${credentialID}`,
        created: 2,
        type: "credential.switched",
        data: { credentialID, integrationID: "integration" },
      }
      listeners.forEach((listener) => listener({ name: switched.type, details: switched }))
      await wait(() => requests.length === 4)
      expect(requests.map((url) => [url.pathname, url.searchParams.get("location[directory]")])).toEqual(
        expect.arrayContaining([
          ["/api/model", "/project"],
          ["/api/provider", "/project"],
          ["/api/model", "/other"],
          ["/api/provider", "/other"],
        ]),
      )
      locations.forEach((location, index) =>
        expect(setup.data.location.reference.list(location)).toBe(references[index]),
      )
      requests.length = 0
    }
  } finally {
    setup.dispose()
  }
})

for (const resource of ["provider", "model"] as const) {
  test(`refreshes ${resource} values only at the location named by ${resource}.updated`, async () => {
    const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
    const requests: URL[] = []
    const current = { name: "Before" }
    const api = AigcForge.make({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const url = new URL(request.url)
        requests.push(url)
        const directory = url.searchParams.get("location[directory]") ?? "/project"
        if (url.pathname !== "/api/provider" && url.pathname !== "/api/model")
          throw new Error(`Unexpected request: ${request.url}`)
        return Response.json({
          location: { directory, project: { id: directory, directory, canonical: directory } },
          data:
            url.pathname === "/api/provider"
              ? [{ id: "company", name: current.name, activation: "enabled", package: "aisdk:@ai-sdk/openai" }]
              : [modelInfo(current.name)],
        })
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
        connection: { status: () => "connected" },
      }),
      dispose,
    }))
    const project = { directory: "/project" }
    const other = { directory: "/other" }
    const unaffected = resource === "provider" ? "model" : "provider"

    try {
      await Promise.all(
        [project, other].flatMap((location) => [
          setup.data.location.provider.sync(location),
          setup.data.location.model.sync(location),
        ]),
      )
      const untouchedResource = setup.data.location[unaffected].list(project)
      const untouchedLocation = setup.data.location[resource].list(other)
      requests.length = 0
      current.name = "After"
      const event: AigcForgeEvent = {
        id: `evt_${resource}_updated`,
        created: 1,
        type: `${resource}.updated`,
        location: project,
        data: {},
      }
      listeners.forEach((listener) => listener({ name: event.type, details: event }))

      await wait(() => setup.data.location[resource].list(project)?.[0]?.name === "After")
      expect(requests.map((url) => [url.pathname, url.searchParams.get("location[directory]")])).toEqual([
        [`/api/${resource}`, "/project"],
      ])
      expect(setup.data.location[unaffected].list(project)).toBe(untouchedResource)
      expect(setup.data.location[resource].list(other)).toBe(untouchedLocation)
      expect(setup.data.location[unaffected].list(project)?.[0]?.name).toBe("Before")
      expect(setup.data.location[resource].list(other)?.[0]?.name).toBe("Before")
    } finally {
      setup.dispose()
    }
  })
}

test("revalidates model discovery when an update overtakes an in-flight model list", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let requests = 0
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname !== "/api/model") throw new Error(`Unexpected request: ${request.url}`)
      const initial = ++requests === 1
      if (initial) {
        started.resolve()
        await release.promise
      }
      return Response.json({
        location: { directory: "/project" },
        data: [modelInfo(initial ? "Before discovery" : "Discovered model")],
      })
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
      connection: { status: () => "connected" },
    }),
    dispose,
  }))

  try {
    const initial = setup.data.location.model.sync()
    await started.promise
    const event: AigcForgeEvent = {
      id: "evt_models_discovered",
      created: 1,
      type: "model.updated",
      location: { directory: "/project" },
      data: {},
    }
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    release.resolve()
    await initial
    await wait(() => setup.data.location.model.list()?.[0]?.name === "Discovered model")
    expect(requests).toBe(2)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("refreshes references for the location an update names", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: URL[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      const directory = url.searchParams.get("location[directory]") ?? "/project"
      return Response.json({
        location: {
          directory,
          project: { id: "project", directory, canonical: directory },
        },
        data: [],
      })
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
      connection: { status: () => "connected" },
    }),
    dispose,
  }))
  const other = { directory: "/other" }

  try {
    await Promise.all([setup.data.location.reference.sync(), setup.data.location.reference.sync(other)])
    requests.length = 0

    const updated: AigcForgeEvent = {
      id: "evt_reference.updated",
      created: 1,
      type: "reference.updated",
      location: other,
      data: {},
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))
    await wait(() => requests.length === 1)
    expect([requests[0]!.pathname, requests[0]!.searchParams.get("location[directory]")]).toEqual([
      "/api/reference",
      "/other",
    ])
  } finally {
    setup.dispose()
  }
})

test("preserves sibling catalogs through location preload, branch, shell, and websearch updates", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const location = { directory: "/project", project: { id: "project", directory: "/project", canonical: "/project" } }
  const requests: string[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const pathname = new URL((input instanceof Request ? input : new Request(input, init)).url).pathname
      requests.push(pathname)
      if (pathname === "/api/session/active") return Response.json({})
      if (pathname === "/api/project") return Response.json([])
      if (pathname === "/api/location") return Response.json(location)
      if (pathname === "/api/vcs")
        return Response.json({ location, data: { branch: { current: "main", default: "main" } } })
      if (pathname === "/api/reference")
        return Response.json({
          location,
          data: [{ name: "docs", path: "/docs", source: { type: "local", path: "/docs" } }],
        })
      if (pathname === "/api/websearch/provider")
        return Response.json({ location, data: [{ id: "search", name: "Search" }] })
      throw new Error(`Unexpected request: ${pathname}`)
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
  const emit = (details: AigcForgeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))
  const shell = {
    id: "sh_first",
    status: "running" as const,
    command: "echo hello",
    cwd: location.directory,
    shell: "/bin/sh",
    file: "/shell-output",
    metadata: {},
    time: { started: 1 },
  }

  try {
    // A live event may arrive before any location reads have populated this key.
    emit({ type: "shell.created", location, data: { info: shell } })
    expect(setup.data.shell.get(shell.id)).toMatchObject(shell)
    const first = setup.data.shell.get(shell.id)
    await Promise.all([setup.data.location.reference.sync(), setup.data.location.vcs.sync()])
    const references = setup.data.location.reference.list()
    expect(references?.map((reference) => [reference.name, reference.path])).toEqual([["docs", "/docs"]])
    expect(setup.data.shell.get(shell.id)).toBe(first)

    emit({ type: "vcs.branch.updated", location, data: { branch: "feature" } })
    expect(setup.data.location.vcs.info()?.branch).toEqual({ current: "feature", default: "main" })
    expect(setup.data.location.reference.list()).toBe(references)
    emit({ type: "shell.created", location, data: { info: { ...shell, id: "sh_second" } } })
    expect(setup.data.shell.list().map((shell) => shell.id)).toEqual(["sh_first", "sh_second"])
    expect(setup.data.location.reference.list()).toBe(references)
    emit({ type: "shell.deleted", location, data: { id: "sh_second" } })
    expect(setup.data.shell.list().map((shell) => shell.id)).toEqual(["sh_first"])
    expect(setup.data.shell.get(shell.id)).toBe(first)
    expect(setup.data.location.reference.list()).toBe(references)

    await setup.data.location.websearch.refresh()
    expect(setup.data.location.websearch.list()).toEqual([{ id: "search", name: "Search" }])
    expect(setup.data.location.reference.list()).toBe(references)
    emit({ type: "server.connected", data: {} })
    await wait(() => setup.data.location.info() !== undefined)
    expect(setup.data.location.info()).toMatchObject(location)
    expect(setup.data.location.reference.list()).toBe(references)
    expect(setup.data.shell.get(shell.id)).toBe(first)
    expect(setup.data.location.vcs.info()?.branch).toEqual({ current: "feature", default: "main" })
    expect(requests.toSorted()).toEqual([
      "/api/location",
      "/api/project",
      "/api/reference",
      "/api/session/active",
      "/api/vcs",
      "/api/websearch/provider",
    ])
  } finally {
    setup.dispose()
  }
})

test("reports optimistic sessions as creating until the request settles", async () => {
  const release = Promise.withResolvers<void>()
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session")) throw new Error(`Unexpected request: ${request.url}`)
      await release.promise
      return Response.json({ data: session(0) })
    },
  })
  const event: CreateDataInput["event"] = {
    on: () => () => {},
    listen: () => () => {},
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    const created = setup.data.session.create({ id: "ses_refresh", location: { directory: "/project" } })
    expect(setup.data.session.creating(created.id)).toBe(true)
    release.resolve()
    await created.request
    expect(setup.data.session.creating(created.id)).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("loads bounded message pages", async () => {
  const requests: URL[] = []
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      return Response.json({ data: [], cursor: requests.length === 1 ? { next: "next" } : {} })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))

  try {
    await setup.data.session.message.sync("ses_refresh")
    await setup.data.session.message.loadMore("ses_refresh")

    expect(requests).toHaveLength(2)
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ limit: "20", order: "desc" })
    expect(Object.fromEntries(requests[1].searchParams)).toEqual({ cursor: "next", limit: "20" })
  } finally {
    setup.dispose()
  }
})

test.each(["same window", "missed input before new output"] as const)(
  "message hydration orders a page requested during its read (%s)",
  async (mode) => {
    const history = ["msg_z", "msg_c", "msg_b", "msg_a"].map((id, position) => ({
      id,
      type: "user",
      text: `History ${position}`,
      time: { created: position },
    }))
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const setup = taskFixture((request) => {
      if (new URL(request.url).searchParams.get("cursor"))
        return Response.json({ data: history.slice(0, 2).toReversed(), cursor: {} })
      if (setup.requests.length === 1)
        return Response.json({ data: history.slice(2).toReversed(), cursor: { next: "recent" } })
      started.resolve()
      return release.promise
    })
    const reads: Promise<unknown>[] = []
    try {
      await setup.data.session.message.sync("ses_refresh")
      setup.data.session.message.invalidate("ses_refresh")
      const reading = setup.data.session.message.sync("ses_refresh")
      reads.push(reading)
      await Promise.race([started.promise, Promise.allSettled(reads)])
      const paging = setup.data.session.message.loadMore("ses_refresh", { all: true })
      reads.push(paging)
      expect(setup.requests).toHaveLength(2)
      expect(setup.data.session.message.list("ses_refresh").map((item) => item.id)).toEqual(
        history.slice(2).map((item) => item.id),
      )
      if (mode === "missed input before new output")
        setup.emit({
          id: "evt_latest",
          type: "session.step.started",
          created: 5,
          durable: { aggregateID: "ses_refresh", seq: 5, version: 1 },
          data: {
            sessionID: "ses_refresh",
            assistantMessageID: "msg_latest",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            started: 5,
          },
        })
      release.resolve(
        Response.json({
          data: [
            ...history.slice(2).map((item) => ({ ...item, text: `Fresh ${item.id}` })),
            ...(mode === "missed input before new output"
              ? [{ id: "msg_missed", type: "user", text: "Missed input", time: { created: 4 } }]
              : []),
          ].toReversed(),
          cursor: { next: "recent" },
        }),
      )
      await Promise.all([reading, paging])
      expect(setup.data.session.message.list("ses_refresh").map((item) => item.id)).toEqual([
        ...history.map((item) => item.id),
        ...(mode === "missed input before new output" ? ["msg_missed", "msg_latest"] : []),
      ])
      expect(setup.data.session.message.get("ses_refresh", "msg_a")).toMatchObject({ text: "Fresh msg_a" })
      expect(setup.data.session.message.get("ses_refresh", "msg_b")).toMatchObject({ text: "Fresh msg_b" })
      expect(setup.data.session.message.more("ses_refresh")).toBe(false)
      expect(setup.requests).toHaveLength(3)
    } finally {
      release.resolve(Response.json({ data: [], cursor: {} }))
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

test.each(["API replaced", "invalidated", "evicted", "deleted", "disposed", "new owner"] as const)(
  "bulk history owner (%s)",
  async (mode) => {
    const newest = { id: "msg_newest", type: "user", text: "Newest", time: { created: 3 } } as const
    const oldest = { id: "msg_oldest", type: "user", text: "Oldest", time: { created: 1 } } as const
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const newStarted = Promise.withResolvers<void>()
    const newRelease = Promise.withResolvers<Response>()
    const replacementRequests: Request[] = []
    const publications: string[] = []
    const setup = taskFixture((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor")
      if (!cursor) return Response.json({ data: [newest], cursor: { next: "recent" } })
      if (cursor === "recent" && setup.requests.length === 2) {
        started.resolve()
        return release.promise
      }
      if (mode === "new owner" && cursor === "recent") {
        newStarted.resolve()
        return newRelease.promise
      }
      return Response.json({ data: [], cursor: {} })
    })
    const replacement = AigcForge.make({
      baseUrl: "http://replacement.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        replacementRequests.push(request)
        return Response.json({ data: [], cursor: {} })
      },
    })
    const reads: Promise<unknown>[] = []
    try {
      await setup.data.session.message.sync("ses_refresh")
      const retained = setup.data.session.message.get("ses_refresh", newest.id)
      const loading = setup.data.session.message.loadMore("ses_refresh", {
        all: true,
        beforePublish: () => publications.push("old"),
      })
      reads.push(loading)
      await Promise.race([started.promise, Promise.allSettled(reads)])
      expect(setup.requests).toHaveLength(2)
      expect(setup.data.session.message.loading("ses_refresh")).toBe(true)
      if (mode === "API replaced") setup.owner.api = replacement
      if (mode === "invalidated") setup.data.session.message.invalidate("ses_refresh")
      if (mode === "evicted" || mode === "new owner") setup.data.session.evict("ses_refresh")
      if (mode === "deleted")
        setup.emit({
          id: "evt_deleted",
          type: "session.deleted",
          created: 4,
          durable: { aggregateID: "ses_refresh", seq: 4, version: 1 },
          data: { sessionID: "ses_refresh" },
        })
      if (mode === "disposed") setup.dispose()
      if (mode === "new owner") {
        await setup.data.session.message.sync("ses_refresh")
        reads.push(
          setup.data.session.message.loadMore("ses_refresh", { beforePublish: () => publications.push("new") }),
        )
        await Promise.race([newStarted.promise, Promise.allSettled(reads)])
        expect(setup.requests).toHaveLength(4)
      }
      release.resolve(Response.json({ data: [oldest], cursor: { next: "oldest-cursor" } }))
      await loading
      expect(publications).toEqual([])
      expect(replacementRequests).toEqual([])
      expect(setup.requests).toHaveLength(mode === "new owner" ? 4 : 2)
      expect(setup.data.session.message.get("ses_refresh", oldest.id)).toBeUndefined()
      expect(setup.data.session.message.loading("ses_refresh")).toBe(mode === "new owner" || mode === "disposed")
      if (mode === "new owner") {
        newRelease.resolve(Response.json({ data: [oldest], cursor: {} }))
        await Promise.all(reads)
        expect(publications).toEqual(["new"])
        expect(setup.data.session.message.loading("ses_refresh")).toBe(false)
        expect(setup.data.session.message.more("ses_refresh")).toBe(false)
        expect(setup.data.session.message.list("ses_refresh").map((item) => item.id)).toEqual([oldest.id, newest.id])
        return
      }
      if (mode === "evicted" || mode === "deleted") {
        expect(setup.data.session.message.list("ses_refresh")).toEqual([])
        expect(setup.data.session.message.more("ses_refresh")).toBe(false)
        return
      }
      expect(setup.data.session.message.get("ses_refresh", newest.id)).toBe(retained)
      expect(setup.data.session.message.more("ses_refresh")).toBe(true)
      if (mode === "disposed") {
        await setup.data.session.message.loadMore("ses_refresh", { all: true })
        expect(setup.requests).toHaveLength(2)
        return
      }
      await setup.data.session.message.loadMore("ses_refresh")
      const request = (mode === "API replaced" ? replacementRequests : setup.requests).at(-1)!
      expect(new URL(request.url).searchParams.get("cursor")).toBe("recent")
      expect(setup.data.session.message.loading("ses_refresh")).toBe(false)
      expect(setup.data.session.message.more("ses_refresh")).toBe(false)
    } finally {
      release.resolve(Response.json({ data: [], cursor: {} }))
      newRelease.resolve(Response.json({ data: [], cursor: {} }))
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

test.each(["success", "failure", "cancel", "cancel-retry", "cancel-page", "join-cancel", "join-failure"])(
  "bulk history (%s)",
  async (mode) => {
    const messages = [1, 2, 3].map((index) => ({
      id: `msg_${index}`,
      type: "user",
      text: `Message ${index}`,
      time: { created: index },
    }))
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    const requests: URL[] = []
    const publications: string[][] = []
    const api = AigcForge.make({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        requests.push(url)
        const cursor = url.searchParams.get("cursor")
        if (!cursor) return Response.json({ data: [messages[2]], cursor: { next: "recent" } })
        if (cursor === "recent") {
          if (mode.startsWith("join")) await release.promise
          if (mode === "join-failure") return Response.json({ message: "offline" }, { status: 503 })
          return Response.json({ data: [messages[2], messages[1]], cursor: { next: "oldest" } })
        }
        if (cursor === "oldest") return Response.json({ data: [messages[0]], cursor: { next: "empty" } })
        expect(init?.signal).toBe(requests.length === 4 ? controller.signal : undefined)
        await release.promise
        if (mode === "failure") return Response.json({ message: "offline" }, { status: 503 })
        return Response.json({ data: [], cursor: {} })
      },
    })
    const setup = createRoot((dispose) => {
      const data = createData({
        api: () => api,
        directory: "/project",
        event: { on: () => () => {}, listen: () => () => {} },
      })
      return { data, dispose }
    })

    try {
      await setup.data.session.message.sync("ses_refresh")
      const newest = setup.data.session.message.get("ses_refresh", "msg_3")
      const load = setup.data.session.message.loadMore(
        "ses_refresh",
        mode.startsWith("join")
          ? undefined
          : {
              all: true,
              signal: controller.signal,
              beforePublish: () => {
                publications.push(setup.data.session.message.list("ses_refresh").map((message) => message.id))
                expect(setup.data.session.message.get("ses_refresh", "msg_3")).toBe(newest)
              },
            },
      )
      const joined = setup.data.session.message.loadMore("ses_refresh", { all: true, signal: controller.signal })
      const settled = Promise.allSettled([load, joined])
      if (mode.startsWith("join")) {
        await wait(() => requests.length === 2)
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(1)
        controller.abort()
        let cancelled = false
        void joined.then(() => {
          cancelled = true
        })
        await wait(() => cancelled)
        expect(setup.data.session.message.loading("ses_refresh")).toBe(true)
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
        release.resolve()
        expect((await settled).map((result) => result.status)).toEqual(
          mode === "join-failure" ? ["rejected", "fulfilled"] : ["fulfilled", "fulfilled"],
        )
        expect(requests.at(-1)?.searchParams.get("limit")).toBe("20")
        expect(requests).toHaveLength(2)
        expect(setup.data.session.message.more("ses_refresh")).toBe(true)
        expect(setup.data.session.message.list("ses_refresh").map((message) => message.id)).toEqual(
          mode === "join-failure" ? ["msg_3"] : ["msg_2", "msg_3"],
        )
        return
      }
      await wait(() => requests.length === 4)
      expect(setup.data.session.message.loading("ses_refresh")).toBe(true)
      expect(setup.data.session.message.list("ses_refresh").map((message) => message.id)).toEqual(["msg_3"])
      expect(requests.slice(1).map((url) => url.searchParams.get("limit"))).toEqual(["200", "200", "200"])
      if (mode.startsWith("cancel")) controller.abort()
      const retry =
        mode === "cancel-retry" || mode === "cancel-page"
          ? setup.data.session.message.loadMore("ses_refresh", mode === "cancel-retry" ? { all: true } : undefined)
          : undefined
      release.resolve()
      expect((await settled).map((result) => result.status)).toEqual(
        mode === "failure" ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"],
      )
      await retry
      const success = mode === "success" || mode === "cancel-retry"
      expect(setup.data.session.message.loading("ses_refresh")).toBe(false)
      expect(setup.data.session.message.more("ses_refresh")).toBe(!success)
      expect(setup.data.session.message.list("ses_refresh").map((message) => message.id)).toEqual(
        success ? ["msg_1", "msg_2", "msg_3"] : mode === "cancel-page" ? ["msg_2", "msg_3"] : ["msg_3"],
      )
      expect(setup.data.session.message.get("ses_refresh", "msg_3")).toBe(newest)
      expect(requests).toHaveLength(mode === "cancel-retry" ? 7 : mode === "cancel-page" ? 5 : 4)
      if (mode === "cancel-page") expect(requests.at(-1)?.searchParams.get("limit")).toBe("20")
      expect(publications).toEqual(mode === "success" ? [["msg_3"]] : [])
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
    } finally {
      release.resolve()
      setup.dispose()
    }
  },
)

test.each([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.execution.started",
  "session.deleted",
] as const)("preserves %s activity when an older snapshot arrives", async (type) => {
  const release = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  const setup = activityFixture(async () => {
    requested.resolve()
    await release.promise
    return Response.json({
      data: {
        ...(type === "session.execution.started" ? {} : { ses_refresh: { type: "running" } }),
        ses_hydrated: { type: "running" },
      },
    })
  })

  try {
    if (type !== "session.execution.started") setup.data.session.setStatus("ses_refresh", "running")
    setup.emit({ type: "server.connected", data: {} })
    await requested.promise
    setup.emit({
      id: "evt_activity",
      created: 2,
      type,
      durable: { aggregateID: "ses_refresh", seq: 2, version: 1 },
      data: {
        sessionID: "ses_refresh",
        reason: "user",
        ...(type === "session.execution.failed"
          ? { error: { type: "provider.no-route", message: "Model unavailable: aigcfroge/gpt-5.2" } }
          : {}),
      },
    })
    expect(setup.data.session.status("ses_refresh")).toBe(type === "session.execution.started" ? "running" : "idle")
    if (type === "session.execution.failed") {
      expect(setup.data.session.message.list("ses_refresh").at(-1)).toEqual({
        id: "msg_activity",
        type: "idle",
        outcome: "failed",
        error: { type: "provider.no-route", message: "Model unavailable: aigcfroge/gpt-5.2" },
        time: { created: 2 },
      })
    }
    release.resolve()
    await wait(() => setup.data.session.status("ses_hydrated") === "running")
    expect(setup.data.session.status("ses_refresh")).toBe(type === "session.execution.started" ? "running" : "idle")
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("ignores activity snapshots from an older connection", async () => {
  const reads: ReturnType<typeof Promise.withResolvers<Response>>[] = []
  const setup = activityFixture(() => {
    const read = Promise.withResolvers<Response>()
    reads.push(read)
    return read.promise
  })

  try {
    setup.emit({ type: "server.connected", data: {} })
    await wait(() => reads.length === 1)
    setup.emit({ type: "server.connected", data: {} })
    await wait(() => reads.length === 2)
    reads[1]?.resolve(Response.json({ data: { ses_new: { type: "running" } } }))
    await wait(() => setup.data.session.status("ses_new") === "running")
    reads[0]?.resolve(Response.json({ data: { ses_old: { type: "running" } } }))
    await Bun.sleep(20)
    expect(setup.data.session.status("ses_new")).toBe("running")
    expect(setup.data.session.status("ses_old")).toBe("idle")
  } finally {
    reads.forEach((read) => read.resolve(Response.json({ data: {} })))
    setup.dispose()
  }
})

test.each([false, true])("projects normal Step completion identities with existing settlement %s", (settled) => {
  const setup = activityFixture(() => Response.json({ data: {} }))
  try {
    setup.emit({
      id: "evt_start",
      created: 1,
      type: "session.step.started",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: {
        sessionID: "ses_refresh",
        assistantMessageID: "msg_complete",
        agent: "build",
        model: { providerID: "provider", id: "model" },
        started: 1,
      },
    })
    if (settled)
      setup.emit({
        id: "evt_end",
        created: 2,
        type: "session.step.ended",
        durable: { aggregateID: "ses_refresh", seq: 2, version: 1 },
        data: {
          sessionID: "ses_refresh",
          assistantMessageID: "msg_complete",
          finish: "stop",
          needsContinuation: false,
          cost: 0,
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
    setup.emit({
      id: "evt_complete",
      created: 3,
      type: "session.step.completed",
      durable: { aggregateID: "ses_refresh", seq: 3, version: 1 },
      data: { sessionID: "ses_refresh", assistantMessageID: "msg_complete" },
    })
    expect(setup.data.session.message.get("ses_refresh", "msg_complete")).toMatchObject({
      completion: { id: "evt_complete", seq: 3 },
      origin: { kind: "step", sessionID: "ses_refresh", id: "evt_start", seq: 1 },
      time: { created: 1, completed: settled ? 2 : 3 },
    })
    if (settled)
      expect(setup.data.session.message.get("ses_refresh", "msg_complete")).toMatchObject({
        finish: "stop",
        needsContinuation: false,
        cost: 0,
        tokens: { input: 1, output: 2 },
      })
    setup.emit({
      id: "evt_restart",
      created: 4,
      type: "session.step.started",
      durable: { aggregateID: "ses_refresh", seq: 4, version: 1 },
      data: {
        sessionID: "ses_refresh",
        assistantMessageID: "msg_complete",
        agent: "build",
        model: { providerID: "provider", id: "model" },
        started: 4,
      },
    })
    expect(setup.data.session.message.get("ses_refresh", "msg_complete")?.completion).toBeUndefined()
    expect(setup.data.session.message.get("ses_refresh", "msg_complete")?.needsContinuation).toBeUndefined()
    setup.emit({
      id: "evt_recomplete",
      created: 5,
      type: "session.step.completed",
      durable: { aggregateID: "ses_refresh", seq: 5, version: 1 },
      data: { sessionID: "ses_refresh", assistantMessageID: "msg_complete" },
    })
    setup.emit({
      id: "evt_failed",
      created: 6,
      type: "session.step.failed",
      durable: { aggregateID: "ses_refresh", seq: 6, version: 1 },
      data: {
        sessionID: "ses_refresh",
        assistantMessageID: "msg_complete",
        error: { type: "aborted", message: "Stopped" },
      },
    })
    expect(setup.data.session.message.get("ses_refresh", "msg_complete")?.completion).toBeUndefined()
    setup.emit({
      id: "evt_final",
      created: 7,
      type: "session.step.completed",
      durable: { aggregateID: "ses_refresh", seq: 7, version: 1 },
      data: { sessionID: "ses_refresh", assistantMessageID: "msg_complete" },
    })
    setup.emit({
      id: "evt_other",
      created: 8,
      type: "session.step.started",
      durable: { aggregateID: "ses_refresh", seq: 8, version: 1 },
      data: {
        sessionID: "ses_refresh",
        assistantMessageID: "msg_other",
        agent: "plan",
        model: { providerID: "provider", id: "model" },
        started: 8,
      },
    })
    expect(setup.data.session.message.get("ses_refresh", "msg_complete")?.completion).toEqual({
      id: "evt_final",
      seq: 7,
    })
    expect(setup.data.session.message.get("ses_refresh", "msg_other")?.completion).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("projects background user shell metadata from durable shell data", () => {
  const setup = activityFixture(() => Response.json({ data: {} }))
  try {
    setup.emit({
      id: "evt_user_shell",
      created: 1,
      type: "session.shell.started",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: {
        sessionID: "ses_refresh",
        shell: {
          id: "sh_user",
          status: "running",
          command: "pwd",
          cwd: "/project",
          shell: "/bin/sh",
          file: "/project/shell.out",
          metadata: { sessionID: "ses_refresh", background: true },
          time: { started: 1 },
        },
      },
    })
    const messages = setup.data.session.message.list("ses_refresh")
    expect(messages).toHaveLength(1)
    const message = messages[0]
    if (message?.type !== "shell") throw new Error("Expected a projected shell message")
    expect({
      shellID: message.shellID,
      status: message.status,
      background: message.metadata?.background,
    }).toEqual({ shellID: "sh_user", status: "running", background: true })
  } finally {
    setup.dispose()
  }
})

test.each(["create", "patch", "remove"] as const)(
  "keeps a Task %s ACK successful when its later read fails",
  async (operation) => {
    const initial = taskInfo()
    const acknowledged =
      operation === "create"
        ? taskInfo({ id: "tsk_created", content: "Created" })
        : operation === "patch"
          ? taskInfo({ content: "Edited", revision: 2 })
          : initial
    const state = { unreadable: false, tasks: [initial] }
    const setup = taskFixture((request) => {
      if (
        new URL(request.url).pathname !== "/session/ses_tasks/task" &&
        new URL(request.url).pathname !== `/session/ses_tasks/task/${initial.id}`
      )
        throw new Error(`Unexpected Task route: ${request.url}`)
      if (request.method === "GET") {
        if (state.unreadable) throw new TypeError("Task read unavailable")
        return Response.json(state.tasks)
      }
      state.unreadable = true
      state.tasks = operation === "create" ? [initial, acknowledged] : operation === "patch" ? [acknowledged] : []
      return Response.json(acknowledged)
    })
    try {
      await setup.data.session.task.sync(initial.sessionID)
      const acknowledgment = await (operation === "create"
        ? setup.data.session.task.create({
            sessionID: initial.sessionID,
            payload: { content: "Created", status: "pending", priority: "medium" },
          })
        : operation === "patch"
          ? setup.data.session.task.patch({
              sessionID: initial.sessionID,
              taskID: initial.id,
              content: "Edited",
              expectedRevision: initial.revision,
            })
          : setup.data.session.task.remove({ sessionID: initial.sessionID, taskID: initial.id }))
      expect(acknowledgment).toEqual(acknowledged)
      expect(setup.requests.filter((request) => request.method === "GET")).toHaveLength(1)
      expect(setup.data.session.task.list(initial.sessionID)).toEqual([initial])
      await expect(setup.data.session.task.sync(initial.sessionID)).rejects.toMatchObject({ reason: "Transport" })
      state.unreadable = false
      await setup.data.session.task.sync(initial.sessionID)
      expect(setup.data.session.task.list(initial.sessionID)).toEqual(state.tasks)
      const mutations = setup.requests.filter((request) => request.method !== "GET")
      expect(mutations).toHaveLength(1)
      expect(mutations[0]?.method).toBe(operation === "create" ? "POST" : operation === "patch" ? "PATCH" : "DELETE")
      if (operation === "patch")
        expect(await mutations[0]?.json()).toEqual({ content: "Edited", expectedRevision: initial.revision })
    } finally {
      setup.dispose()
    }
  },
)

test("preserves a Task patch's stale revision error without rebasing its input or changing cache", async () => {
  const initial = taskInfo()
  const rejected = { _tag: "InvalidRequestError", message: "Task changed since revision 1", kind: "stale_revision" }
  const setup = taskFixture((request) =>
    request.method === "PATCH" ? Response.json(rejected, { status: 400 }) : Response.json([initial]),
  )
  try {
    await setup.data.session.task.sync(initial.sessionID)
    await expect(
      setup.data.session.task.patch({
        sessionID: initial.sessionID,
        taskID: initial.id,
        content: "User draft",
        expectedRevision: initial.revision,
      }),
    ).rejects.toMatchObject(rejected)
    expect(setup.data.session.task.list(initial.sessionID)).toEqual([initial])
    await setup.data.session.task.sync(initial.sessionID)
    expect(setup.requests).toHaveLength(2)
    expect(await setup.requests[1]?.json()).toEqual({ content: "User draft", expectedRevision: initial.revision })
  } finally {
    setup.dispose()
  }
})

test("routes Task operations by the owning Session and isolates another Session cache", async () => {
  const first = taskInfo({ sessionID: "ses_tasks_a" })
  const second = taskInfo({ id: "tsk_other", sessionID: "ses_tasks_b" })
  const changed = taskInfo({ sessionID: first.sessionID, content: "Changed", revision: 2 })
  const state = { first }
  const setup = taskFixture((request) => {
    const url = new URL(request.url)
    if (url.pathname === `/session/${second.sessionID}/task`) return Response.json([second])
    if (request.method === "PATCH") {
      state.first = changed
      return Response.json(changed)
    }
    return Response.json([state.first])
  })
  try {
    setup.data.session.remember({
      ...session(0),
      id: first.sessionID,
      location: { directory: "/a" },
    })
    setup.data.session.remember({
      ...session(0),
      id: second.sessionID,
      location: { directory: "/b" },
    })
    await setup.data.session.task.sync(first.sessionID)
    await setup.data.session.task.sync(second.sessionID)
    setup.emit({
      id: "evt_task_changed",
      created: 2,
      type: "task.updated",
      data: { sessionID: first.sessionID, tasks: [taskInfo({ ...changed, content: "Event payload" })] },
    })
    expect(setup.data.session.task.list(first.sessionID)).toEqual([first])
    await setup.data.session.task.sync(second.sessionID)
    expect(setup.requests).toHaveLength(2)
    await setup.data.session.task.patch({
      sessionID: first.sessionID,
      taskID: first.id,
      content: "Changed",
      expectedRevision: 1,
      workspace: "ws_a",
    })
    await setup.data.session.task.sync(first.sessionID)
    expect(setup.data.session.task.list(first.sessionID)).toEqual([changed])
    expect(setup.data.session.task.list(second.sessionID)).toEqual([second])
    expect(
      setup.requests.map((request) => {
        const url = new URL(request.url)
        return [request.method, url.searchParams.get("directory"), url.searchParams.get("workspace")]
      }),
    ).toEqual([
      ["GET", "/a", null],
      ["GET", "/b", null],
      ["PATCH", "/a", "ws_a"],
      ["GET", "/a", null],
    ])
  } finally {
    setup.dispose()
  }
})

test("keeps a deleted Session's Task cache revoked when an in-flight mutation acknowledges", async () => {
  const initial = taskInfo()
  const updated = taskInfo({ content: "Acknowledged", revision: 2 })
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const setup = taskFixture((request) => {
    if (request.method === "GET") return Response.json([initial])
    requested.resolve()
    return release.promise
  })
  try {
    await setup.data.session.task.sync(initial.sessionID)
    const mutation = setup.data.session.task.patch({
      sessionID: initial.sessionID,
      taskID: initial.id,
      content: updated.content,
      expectedRevision: 1,
    })
    await requested.promise
    setup.emit({
      id: "evt_task_session_deleted",
      created: 2,
      type: "session.deleted",
      durable: { aggregateID: initial.sessionID, seq: 1, version: 1 },
      data: { sessionID: initial.sessionID },
    })
    release.resolve(Response.json(updated))
    expect(await mutation).toEqual(updated)
    expect(setup.data.session.task.list(initial.sessionID)).toBeUndefined()
    expect(setup.requests).toHaveLength(2)
  } finally {
    release.resolve(Response.json(updated))
    setup.dispose()
  }
})

test("loads Delegations at the canonical Session Location with distinct participant identities", async () => {
  const value = delegationInfo()
  const setup = taskFixture(() => Response.json([value]))
  try {
    setup.data.session.remember({ ...session(0), location: { directory: "/canonical" } })
    await setup.data.session.delegation.sync("ses_refresh")
    await setup.data.session.delegation.sync("ses_refresh")
    expect(setup.data.session.delegation.list("ses_refresh")).toEqual([value])
    const url = new URL(setup.requests[0].url)
    expect(url.pathname).toBe("/delegation")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      parentSessionID: "ses_refresh",
      includeArchived: "true",
      directory: "/canonical",
    })
    expect(setup.requests).toHaveLength(1)
    expect(setup.data.session.delegation.list("ses_refresh")?.[0].participants.map((item) => item.id)).toEqual([
      "par_one",
      "par_two",
    ])
  } finally {
    setup.dispose()
  }
})

test("keeps the real Memory mutation ACK when following reads fail", async () => {
  const proposal: PersonalMemoryInfo = {
    id: "pm_ack",
    content: "Concise updates",
    source: "explicit",
    trustLevel: "high",
    sensitivityLevel: "low",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
  }
  const confirmed = { ...proposal, status: "confirmed" as const, updatedAt: 2 }
  const owner = { changed: false }
  const setup = taskFixture((request) => {
    if (request.method === "POST") {
      owner.changed = true
      return Response.json(confirmed)
    }
    if (owner.changed) return Response.json({ message: "Memory read unavailable" }, { status: 503 })
    return Response.json([proposal])
  })
  try {
    await setup.data.memory.sync()
    expect(setup.data.memory.pending()?.map((item) => item.id)).toEqual([proposal.id])
    expect(await setup.data.memory.confirm({ id: proposal.id })).toEqual(confirmed)
    await expect(setup.data.memory.sync()).rejects.toBeDefined()
    expect(setup.data.memory.list()?.[0].status).toBe("confirmed")
    expect(setup.data.memory.pending()).toEqual([])
  } finally {
    setup.dispose()
  }
})

test.each(["workflow", "cache"] as const)(
  "revokes late %s reads across API replacement and canonical directory changes",
  async (name) => {
    const release = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    const first =
      name === "workflow"
        ? { steps: [] }
        : {
            sessionHitRate: 0,
            sessionCacheRead: 0,
            sessionCacheWrite: 0,
            sessionTotalInput: 0,
            confidence: "unavailable",
            perStep: [],
          }
    const next =
      name === "workflow"
        ? { steps: [{ id: "swr_new", stepId: "Current step" }] }
        : { ...first, sessionCacheRead: 300, confidence: "estimated" }
    const setup = taskFixture(() => {
      started.resolve()
      return release.promise
    })
    try {
      setup.data.session.remember(session(0))
      const read = setup.data.session[name].sync("ses_refresh")
      await started.promise
      setup.owner.api = AigcForge.make({ baseUrl: "http://replacement.local", fetch: async () => Response.json(next) })
      setup.data.session.remember({ ...session(0), location: { directory: "/canonical" } })
      const replacement = setup.data.session[name].sync("ses_refresh")
      expect(setup.data.session[name].get("ses_refresh")).toBeUndefined()
      await replacement
      release.resolve(Response.json(first))
      await read
      expect(setup.data.session[name].get("ses_refresh")).toEqual(next)
      setup.data.session.evict("ses_refresh")
      expect(setup.data.session[name].get("ses_refresh")).toBeUndefined()
    } finally {
      release.resolve(Response.json(first))
      setup.dispose()
    }
  },
)

test.each(["invalidated", "API replaced", "deleted", "evicted", "disposed"] as const)(
  "revokes a late Delegation read when its owner is %s",
  async (change) => {
    const initial = delegationInfo()
    const fresh = delegationInfo("Current delegation")
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const setup = taskFixture(() => {
      if (setup.requests.length > 1) return Response.json([fresh])
      started.resolve()
      return release.promise
    })
    try {
      setup.data.session.remember(session(0))
      const read = setup.data.session.delegation.sync("ses_refresh")
      await started.promise
      if (change === "invalidated") setup.data.session.delegation.invalidate("ses_refresh")
      if (change === "API replaced")
        setup.owner.api = AigcForge.make({
          baseUrl: "http://replacement.local",
          fetch: async () => Response.json([fresh]),
        })
      if (change === "deleted")
        setup.emit({
          id: "evt_delete_delegation_owner",
          type: "session.deleted",
          created: 3,
          data: { sessionID: "ses_refresh" },
        })
      if (change === "evicted") setup.data.session.evict("ses_refresh")
      if (change === "disposed") setup.dispose()
      release.resolve(Response.json([initial]))
      await read
      expect(setup.data.session.delegation.list("ses_refresh")).toBeUndefined()
      if (change !== "invalidated" && change !== "API replaced") return
      await setup.data.session.delegation.sync("ses_refresh")
      expect(setup.data.session.delegation.list("ses_refresh")).toEqual([fresh])
    } finally {
      release.resolve(Response.json([initial]))
      setup.dispose()
    }
  },
)

function delegationInfo(title = "Saved delegation"): DelegationLegacyState {
  return {
    delegation: {
      id: "dlg_consumer",
      parentSessionID: "ses_refresh",
      title,
      status: "running",
      rejectionBlocked: false,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    participants: ["par_one", "par_two"].map((id) => ({
      id,
      delegationID: "dlg_consumer",
      provider: "internal",
      target: "build",
      role: "implementer" as const,
      context: "fresh" as const,
      phase: "active" as const,
      childSessionID: `ses_child_${id}`,
      runtimeStatus: "idle" as const,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })),
    turns: [
      {
        id: "trn_work",
        delegationID: "dlg_consumer",
        seq: 1,
        kind: "task",
        status: "completed",
        participantIDs: ["par_one", "par_two"],
        delivery: "steer",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    softExpired: false,
  }
}

function taskInfo(input: Partial<SessionTaskInfo> = {}): SessionTaskInfo {
  return {
    id: "tsk_primary",
    sessionID: "ses_tasks",
    content: "Initial",
    status: "pending",
    priority: "medium",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

function identityInfo(agent = "meta", eventID = "evt_identity_initial"): SessionIdentityIdentity {
  return {
    sessionID: "ses_refresh",
    projectID: "project",
    mode: "coding",
    location: { directory: "/project" },
    agent,
    model: { status: "missing" },
    permission: { declaredTier: "propose", effect: "ask" },
    capability: { health: "ready", reasons: [] },
    coordination: {
      available: agent === "meta",
      reasons: agent === "meta" ? [] : [{ code: "meta-not-selected", severity: "info" }],
      selection: { agent, event: { id: eventID, seq: 1 } },
    },
    detail: {
      status: "ready",
      detail: { source: "coding", vcs: { branch: { status: "missing" }, worktree: { status: "missing" } } },
    },
  }
}

test.skipIf(isServer)("Meta getters created before hydration react to their original cache", async () => {
  const operation = operationInfo()
  const goal = goalInfo()
  const communication = communicationInfo()
  const rule = scheduleRuleInfo()
  const occurrence = scheduleOccurrenceInfo()
  const capability = { read: true, list: true, send: true, reply: true, reasons: [] }
  const identity: SessionIdentityIdentity = {
    sessionID: "ses_refresh",
    location: { directory: "/project" },
    projectID: "project",
    mode: "coding",
    agent: "meta",
    model: { status: "missing" },
    permission: { declaredTier: "propose", effect: "ask" },
    capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
    detail: { status: "missing", reason: "mode-detail-not-projected" },
  }
  const setup = taskFixture((request) => {
    const path = new URL(request.url).pathname
    if (path === "/session/ses_refresh/task/operations") return Response.json([operation])
    if (path === "/api/session/ses_refresh/goal") return Response.json({ data: [goal] })
    if (path === "/api/session/ses_refresh/communication")
      return Response.json({ data: { items: [communication], next: "older-page", capability } })
    if (path === "/schedule/rules/ses_refresh") return Response.json([rule])
    if (path === `/schedule/rule/${rule.id}/runs`) return Response.json([occurrence])
    if (path === "/session/ses_refresh/identity") return Response.json(identity)
    throw new Error("Unexpected request: " + request.url)
  })
  setup.data.session.remember({ ...session(0), agent: "meta" })
  // Each eager memo needs its own subscription; a shared observer would hide a broken getter.
  const observer = createRoot((dispose) => ({
    values: {
      operationList: createMemo(() => setup.data.session.task.operation.list("ses_refresh")),
      operation: createMemo(() => setup.data.session.task.operation.get("ses_refresh", operation.operationID)),
      goals: createMemo(() => setup.data.session.goal.list("ses_refresh")),
      goal: createMemo(() => setup.data.session.goal.get("ses_refresh", goal.id)),
      communications: createMemo(() => setup.data.session.communication.list("ses_refresh")),
      communication: createMemo(() => setup.data.session.communication.get("ses_refresh", communication.id)),
      capability: createMemo(() => setup.data.session.communication.capability("ses_refresh")),
      next: createMemo(() => setup.data.session.communication.next("ses_refresh")),
      version: createMemo(() => setup.data.session.communication.version("ses_refresh")),
      schedules: createMemo(() => setup.data.session.schedule.list("ses_refresh")),
      schedule: createMemo(() => setup.data.session.schedule.get("ses_refresh", rule.id)),
      runs: createMemo(() => setup.data.session.schedule.runs("ses_refresh", rule.id)),
      occurrence: createMemo(() => setup.data.session.schedule.occurrence("ses_refresh", occurrence.id)),
      identity: createMemo(() => setup.data.session.identity.get("ses_refresh")),
    },
    dispose,
  }))
  try {
    Object.entries(observer.values).forEach(([key, read]) => expect(read()).toBe(key === "version" ? 0 : undefined))
    expect(setup.requests).toHaveLength(0)
    await setup.data.session.task.operation.sync("ses_refresh")
    await setup.data.session.goal.sync("ses_refresh")
    await setup.data.session.communication.sync("ses_refresh")
    await setup.data.session.schedule.sync("ses_refresh")
    await setup.data.session.schedule.syncRuns("ses_refresh", rule.id)
    await setup.data.session.identity.sync("ses_refresh")
    expect(observer.values.operationList()).toEqual([operation])
    expect(observer.values.operation()).toEqual(operation)
    expect(observer.values.goals()).toEqual([goal])
    expect(observer.values.goal()).toEqual(goal)
    expect(observer.values.communications()).toEqual([communication])
    expect(observer.values.communication()).toEqual(communication)
    expect(observer.values.capability()).toEqual(capability)
    expect(observer.values.next()).toBe("older-page")
    expect(observer.values.schedules()).toEqual([rule])
    expect(observer.values.schedule()).toEqual(rule)
    expect(observer.values.runs()).toEqual([occurrence])
    expect(observer.values.occurrence()).toEqual(occurrence)
    expect(observer.values.identity()).toEqual(identity)
    setup.emit({
      id: "evt_getter_delivery",
      type: "session.inbox.delivered",
      created: 3,
      durable: { aggregateID: communication.targetSessionID, seq: 1, version: 1 },
      data: { sessionID: communication.targetSessionID, inboxID: communication.body.inputID },
    })
    expect(observer.values.version()).toBe(1)
    expect(observer.values.communication()?.state).toBe("visible")
  } finally {
    observer.dispose()
    setup.dispose()
  }
})

test("task operation list and detail share facts across an Agent switch and use the full saved Location", async () => {
  const initial = operationInfo()
  const settled = operationInfo({
    phase: "settled",
    updatedAt: 4,
    result: { sessionID: "ses_data_target", inputID: "msg_data_task", messageIDs: ["msg_data_answer"] },
  })
  const setup = taskFixture((request) =>
    Response.json(new URL(request.url).pathname.endsWith("/operations") ? [initial] : settled),
  )
  try {
    setup.data.session.remember({
      ...session(0),
      agent: "meta",
      location: { directory: "/project", workspaceID: "wrk_task_data" },
    })
    await setup.data.session.task.operation.sync(initial.sourceSessionID)
    expect(setup.data.session.task.operation.list(initial.sourceSessionID, initial.taskID)).toEqual([initial])
    expect(setup.data.session.task.operation.list(initial.sourceSessionID, "tsk_other")).toEqual([])
    await setup.data.session.task.operation.readback(initial.sourceSessionID, initial.operationID)
    expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)).toEqual(settled)
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)?.[0]).toBe(
      setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID),
    )
    setup.emit({
      id: "evt_operation_agent",
      type: "session.agent.selected",
      created: 5,
      data: { sessionID: initial.sourceSessionID, agent: "build" },
    })
    expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)?.selection.agent).toBe(
      "meta",
    )
    expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)?.source).toEqual(
      initial.source,
    )
    expect(
      setup.requests.map((request) => [
        new URL(request.url).pathname,
        new URL(request.url).searchParams.get("directory"),
        new URL(request.url).searchParams.get("workspace"),
      ]),
    ).toEqual([
      ["/session/ses_refresh/task/operations", "/project", "wrk_task_data"],
      ["/session/ses_refresh/task/operations/top_data_task", "/project", "wrk_task_data"],
    ])
  } finally {
    setup.dispose()
  }
})

test("task operation list and detail HTTP reads cannot overtake one another", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const detailStarted = Promise.withResolvers<void>()
  const detailRelease = Promise.withResolvers<Response>()
  const initial = operationInfo()
  const settled = operationInfo({ phase: "settled", updatedAt: 6 })
  const setup = taskFixture((request) => {
    if (new URL(request.url).pathname.endsWith("/operations")) {
      started.resolve()
      return release.promise
    }
    detailStarted.resolve()
    return detailRelease.promise
  })
  const reads: Promise<void>[] = []
  try {
    setup.data.session.remember(session(0))
    const list = setup.data.session.task.operation.sync(initial.sourceSessionID)
    reads.push(list)
    await started.promise
    const detail = setup.data.session.task.operation.readback(initial.sourceSessionID, initial.operationID)
    reads.push(detail)
    expect(setup.requests).toHaveLength(1)
    release.resolve(Response.json([initial]))
    await detailStarted.promise
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toEqual([initial])
    detailRelease.resolve(Response.json(settled))
    await Promise.all(reads)
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toEqual([settled])
  } finally {
    release.resolve(Response.json([initial]))
    detailRelease.resolve(Response.json(settled))
    await Promise.allSettled(reads)
    setup.dispose()
  }
})

test("task operation SSE invalidation discards a held snapshot and queues one replacement", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const replacementStarted = Promise.withResolvers<void>()
  const replacementRelease = Promise.withResolvers<Response>()
  const initial = operationInfo()
  const settled = operationInfo({ phase: "settled", updatedAt: 7 })
  const setup = taskFixture(() => {
    if (setup.requests.length > 1) {
      replacementStarted.resolve()
      return replacementRelease.promise
    }
    started.resolve()
    return release.promise
  })
  const reads: Promise<void>[] = []
  try {
    setup.data.session.remember(session(0))
    reads.push(setup.data.session.task.operation.sync(initial.sourceSessionID))
    await started.promise
    setup.emit({
      id: "evt_operation_changed",
      type: "task.operation.changed",
      created: 7,
      durable: { aggregateID: initial.sourceSessionID, seq: 2, version: 1 },
      data: { sessionID: initial.sourceSessionID, operationID: initial.operationID, change: { phase: "settled" } },
    })
    reads.push(setup.data.session.task.operation.sync(initial.sourceSessionID))
    reads.push(setup.data.session.task.operation.sync(initial.sourceSessionID))
    release.resolve(Response.json([initial]))
    await replacementStarted.promise
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toBeUndefined()
    expect(setup.requests).toHaveLength(2)
    replacementRelease.resolve(Response.json([settled]))
    await Promise.all(reads)
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toEqual([settled])
  } finally {
    release.resolve(Response.json([initial]))
    replacementRelease.resolve(Response.json([settled]))
    await Promise.allSettled(reads)
    setup.dispose()
  }
})

test.each(
  (["list", "detail"] as const).flatMap((read) =>
    (["API replaced", "Location changed", "workspace changed", "evicted", "deleted", "disposed"] as const).map(
      (change) => [read, change] as const,
    ),
  ),
)("task operation %s ignores a held response after its owner is %s", async (read, change) => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const initial = operationInfo()
  const setup = taskFixture(() => {
    started.resolve()
    return release.promise
  })
  const pending: Promise<void>[] = []
  try {
    setup.data.session.remember(session(0))
    const held =
      read === "list"
        ? setup.data.session.task.operation.sync(initial.sourceSessionID)
        : setup.data.session.task.operation.readback(initial.sourceSessionID, initial.operationID)
    pending.push(held)
    await started.promise
    if (change === "API replaced")
      setup.owner.api = AigcForge.make({ baseUrl: "http://replacement.local", fetch: async () => Response.json([]) })
    if (change === "Location changed")
      setup.data.session.remember({ ...session(0), location: { directory: "/canonical" } })
    if (change === "workspace changed")
      setup.data.session.remember({ ...session(0), location: { directory: "/project", workspaceID: "wrk_replaced" } })
    if (change === "evicted") setup.data.session.evict(initial.sourceSessionID)
    if (change === "deleted")
      setup.emit({
        id: "evt_operation_deleted",
        type: "session.deleted",
        created: 3,
        data: { sessionID: initial.sourceSessionID },
      })
    if (change === "disposed") setup.dispose()
    release.resolve(Response.json(read === "list" ? [initial] : initial))
    await held
    expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toBeUndefined()
    expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)).toBeUndefined()
  } finally {
    release.resolve(Response.json(read === "list" ? [initial] : initial))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test("task dispatch and cancellation return the actual acknowledgement and refresh their one fact cache", async () => {
  const initial = operationInfo()
  const cancelled = operationInfo({ phase: "cancelled", cancelIntent: true, updatedAt: 9 })
  const setup = taskFixture((request) => {
    const path = new URL(request.url).pathname
    if (path.endsWith("/dispatch")) return Response.json(initial)
    if (path.endsWith("/cancel")) return Response.json(cancelled)
    return Response.json([
      setup.requests.some((request) => new URL(request.url).pathname.endsWith("/cancel")) ? cancelled : initial,
    ])
  })
  try {
    setup.data.session.remember({ ...session(0), location: { directory: "/project", workspaceID: "wrk_mutation" } })
    await setup.data.session.task.operation.sync(initial.sourceSessionID)
    expect(
      await setup.data.session.task.operation.dispatch({
        sessionID: initial.sourceSessionID,
        request: initial.request,
      }),
    ).toEqual(initial)
    expect(await setup.requests[1]?.json()).toEqual(initial.request)
    const permission: PermissionRequest = {
      id: "per_cancel_ack",
      sessionID: initial.sourceSessionID,
      action: "task",
      resources: ["root"],
      source: { type: "operation", sessionID: initial.sourceSessionID, operationID: initial.operationID },
    }
    setup.emit({ id: "evt_cancel_ask", type: "permission.asked", created: 3, data: permission })
    setup.emit({
      id: "evt_other_cancel_ask",
      type: "permission.asked",
      created: 3,
      data: {
        ...permission,
        id: "per_other_ack",
        source: { type: "operation", sessionID: initial.sourceSessionID, operationID: "top_other_ack" },
      },
    })
    setup.data.session.remember({
      ...session(0),
      agent: "build",
      location: { directory: "/project", workspaceID: "wrk_mutation" },
    })
    expect(
      await setup.data.session.task.operation.cancel({
        sessionID: initial.sourceSessionID,
        operationID: initial.operationID,
      }),
    ).toEqual(cancelled)
    expect(setup.data.session.permission.list(initial.sourceSessionID).map((value) => value.id)).toEqual([
      "per_other_ack",
    ])
    setup.emit({ id: "evt_cancel_ask", type: "permission.asked", created: 3, data: permission })
    expect(setup.data.session.permission.list(initial.sourceSessionID).map((value) => value.id)).toEqual([
      "per_other_ack",
    ])
    await setup.data.session.task.operation.sync(initial.sourceSessionID)
    expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)).toEqual(cancelled)
    expect(setup.data.session.message.list(initial.sourceSessionID)).toEqual([])
    expect(
      setup.requests.every((request) => new URL(request.url).searchParams.get("workspace") === "wrk_mutation"),
    ).toBe(true)
  } finally {
    setup.dispose()
  }
})

test("operation cancellation SSE removes only its permission asks and rejects an older permission snapshot", async () => {
  const initial = operationInfo()
  const operationAsk: PermissionRequest = {
    id: "per_operation_cancel",
    sessionID: initial.sourceSessionID,
    action: "task",
    resources: ["root"],
    source: { type: "operation", sessionID: initial.sourceSessionID, operationID: initial.operationID },
  }
  const requests: PermissionRequest[] = [
    operationAsk,
    { ...operationAsk, id: "per_operation_second", resources: ["workspace"] },
    {
      ...operationAsk,
      id: "per_operation_sibling",
      source: { type: "operation", sessionID: initial.sourceSessionID, operationID: "top_sibling_permission" },
    },
    {
      ...operationAsk,
      id: "per_tool_sibling",
      source: { type: "tool", messageID: "msg_tool_sibling", id: "call_tool_sibling" },
    },
  ]
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const setup = taskFixture(() => {
    started.resolve()
    return release.promise
  })
  const pending: Promise<void>[] = []
  try {
    setup.data.session.remember(session(0))
    requests.forEach((request, index) =>
      setup.emit({ id: `evt_operation_permission_${index}`, type: "permission.asked", created: 3, data: request }),
    )
    const held = setup.data.session.permission.sync(initial.sourceSessionID)
    pending.push(held)
    await started.promise
    setup.emit({
      id: "evt_permission_operation_cancelled",
      type: "task.operation.changed",
      created: 4,
      durable: { aggregateID: initial.sourceSessionID, seq: 2, version: 1 },
      data: {
        sessionID: initial.sourceSessionID,
        operationID: initial.operationID,
        change: { phase: "cancelled", cancelIntent: true },
      },
    })
    expect(setup.data.session.permission.list(initial.sourceSessionID).map((value) => value.id)).toEqual([
      "per_operation_sibling",
      "per_tool_sibling",
    ])
    release.resolve(Response.json({ data: requests }))
    await held
    expect(setup.data.session.permission.list(initial.sourceSessionID).map((value) => value.id)).toEqual([
      "per_operation_sibling",
      "per_tool_sibling",
    ])
  } finally {
    release.resolve(Response.json({ data: requests }))
    await Promise.allSettled(pending)
    setup.dispose()
  }
})

test.skipIf(isServer)(
  "task operation reconnect invalidates a held read even when its API client is unchanged",
  async () => {
    const [status, setStatus] = createSignal<"connected" | "connecting" | "reconnecting">("connected")
    const initial = operationInfo()
    const settled = operationInfo({ phase: "settled", updatedAt: 8 })
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const setup = taskFixture(
      () => {
        if (setup.requests.length > 1) return Response.json([settled])
        started.resolve()
        return release.promise
      },
      { status },
    )
    const reads: Promise<void>[] = []
    try {
      setup.data.session.remember(session(0))
      reads.push(setup.data.session.task.operation.sync(initial.sourceSessionID))
      await started.promise
      setStatus("reconnecting")
      setStatus("connected")
      release.resolve(Response.json([initial]))
      await Promise.all(reads)
      expect(setup.data.session.task.operation.get(initial.sourceSessionID, initial.operationID)).toBeUndefined()
      await setup.data.session.task.operation.sync(initial.sourceSessionID)
      expect(setup.data.session.task.operation.list(initial.sourceSessionID)).toEqual([settled])
    } finally {
      release.resolve(Response.json([initial]))
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

test("a reserved operation reads the server source row without duplicating it on repeated SSE or readback", async () => {
  const operation = operationInfo()
  const row: SessionMessageInfo = {
    id: `msg_${operation.operationID}`,
    type: "synthetic",
    text: "Review saved work",
    metadata: {
      coordination: {
        operationRef: { sourceSessionID: operation.sourceSessionID, operationID: operation.operationID },
        actorSessionID: operation.sourceSessionID,
        actorAgent: "meta",
        targetSessionID: operation.targetSessionID,
        kind: "task",
      },
    },
    time: { created: 3 },
  }
  const sourceRead = Promise.withResolvers<void>()
  const snapshots = { rows: [] as SessionMessageInfo[] }
  const setup = taskFixture(() => {
    if (snapshots.rows.length) sourceRead.resolve()
    return Response.json({ data: snapshots.rows, cursor: {} })
  })
  try {
    setup.data.session.remember(session(0))
    await setup.data.session.message.sync(operation.sourceSessionID)
    snapshots.rows = [row]
    const event: AigcForgeEvent = {
      id: "evt_reserved_task_source",
      type: "task.operation.reserved",
      created: 3,
      durable: { aggregateID: operation.sourceSessionID, seq: 1, version: 1 },
      data: {
        sessionID: operation.sourceSessionID,
        request: operation.request,
        source: operation.source,
        selection: operation.selection,
        sourceLocation: operation.sourceLocation,
        sourceMode: operation.sourceMode,
        targetSessionID: "ses_data_target",
      },
    }
    setup.emit(event)
    setup.emit(event)
    await sourceRead.promise
    await setup.data.session.message.sync(operation.sourceSessionID)
    setup.data.session.message.invalidate(operation.sourceSessionID)
    await setup.data.session.message.sync(operation.sourceSessionID)
    expect(setup.data.session.message.list(operation.sourceSessionID)).toEqual([row])
  } finally {
    setup.dispose()
  }
})

test.each(["goal", "rule", "occurrence"] as const)(
  "%s full SSE snapshots overtake a held HTTP read without duplicate records",
  async (kind) => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const initial = kind === "goal" ? goalInfo() : kind === "rule" ? scheduleRuleInfo() : scheduleOccurrenceInfo()
    const setup = taskFixture(async () => {
      started.resolve()
      await release.promise
      return Response.json(kind === "goal" ? { data: [initial] } : [initial])
    })
    try {
      setup.data.session.remember({ ...session(0), agent: "meta" })
      const read =
        kind === "goal"
          ? setup.data.session.goal.sync("ses_refresh")
          : kind === "rule"
            ? setup.data.session.schedule.sync("ses_refresh")
            : setup.data.session.schedule.syncRuns("ses_refresh", "sch_data_rule")
      await started.promise
      if (kind === "goal")
        setup.emit({
          id: "evt_goal_full",
          type: "session.goal.updated",
          created: 4,
          data: {
            sessionID: "ses_refresh",
            goal: goalInfo({ status: "paused", pauseReason: "user", pauseVersion: 1, updatedAt: 4 }),
          },
        })
      if (kind === "rule")
        setup.emit({
          id: "evt_rule_full",
          type: "schedule.rule.updated",
          created: 4,
          data: {
            sessionID: "ses_refresh",
            rule: scheduleRuleInfo({ status: "paused", nextDueAt: undefined, updatedAt: 4 }),
          },
        })
      if (kind === "occurrence")
        setup.emit({
          id: "evt_occurrence_full",
          type: "schedule.occurrence.updated",
          created: 1004,
          data: {
            sessionID: "ses_refresh",
            occurrence: scheduleOccurrenceInfo({
              status: "completed",
              output: "Saved result",
              sourceSettlement: "completed",
              completedAt: 1004,
              updatedAt: 1004,
            }),
          },
        })
      release.resolve()
      await read
      if (kind === "goal")
        expect(setup.data.session.goal.list("ses_refresh")?.map((goal) => [goal.id, goal.status])).toEqual([
          ["gol_data_goal", "paused"],
        ])
      if (kind === "rule")
        expect(setup.data.session.schedule.list("ses_refresh")?.map((rule) => [rule.id, rule.status])).toEqual([
          ["sch_data_rule", "paused"],
        ])
      if (kind === "occurrence")
        expect(
          setup.data.session.schedule
            .runs("ses_refresh", "sch_data_rule")
            ?.map((run) => [run.id, run.status, run.output]),
        ).toEqual([["sco_data_occurrence", "completed", "Saved result"]])
      setup.emit({
        id: "evt_saved_history_build",
        type: "session.agent.selected",
        created: 5,
        data: { sessionID: "ses_refresh", agent: "build" },
      })
      if (kind === "goal") expect(setup.data.session.goal.get("ses_refresh", "gol_data_goal")?.agent).toBe("meta")
      if (kind === "rule")
        expect(setup.data.session.schedule.get("ses_refresh", "sch_data_rule")?.sourceAgent).toBe("meta")
      if (kind === "occurrence")
        expect(setup.data.session.schedule.occurrence("ses_refresh", "sco_data_occurrence")?.sourceSettlement).toBe(
          "completed",
        )
    } finally {
      release.resolve()
      setup.dispose()
    }
  },
)

test.each(
  (["goal", "rule"] as const).flatMap((kind) =>
    (["api replaced", "Location moved", "evicted", "deleted", "disposed"] as const).map(
      (change) => [kind, change] as const,
    ),
  ),
)("%s rejects a held snapshot when its owner is %s", async (kind, change) => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const setup = taskFixture(async () => {
    started.resolve()
    await release.promise
    return Response.json(kind === "goal" ? { data: [goalInfo()] } : [scheduleRuleInfo()])
  })
  try {
    setup.data.session.remember(session(0))
    const read =
      kind === "goal" ? setup.data.session.goal.sync("ses_refresh") : setup.data.session.schedule.sync("ses_refresh")
    await started.promise
    if (change === "api replaced")
      setup.owner.api = AigcForge.make({
        baseUrl: "http://replacement.local",
        fetch: async () => Response.json(kind === "goal" ? { data: [] } : []),
      })
    if (change === "Location moved")
      setup.data.session.remember({ ...session(0), location: { directory: "/other", workspaceID: "wrk_other" } })
    if (change === "evicted") setup.data.session.evict("ses_refresh")
    if (change === "deleted")
      setup.emit({ id: "evt_owner_deleted", type: "session.deleted", created: 3, data: { sessionID: "ses_refresh" } })
    if (change === "disposed") setup.dispose()
    release.resolve()
    await read
    if (kind === "goal") {
      expect(setup.data.session.goal.list("ses_refresh")).toBeUndefined()
      expect(setup.data.session.goal.get("ses_refresh", "gol_data_goal")).toBeUndefined()
    }
    if (kind === "rule") {
      expect(setup.data.session.schedule.list("ses_refresh")).toBeUndefined()
      expect(setup.data.session.schedule.get("ses_refresh", "sch_data_rule")).toBeUndefined()
    }
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("Schedule mutation captures the full saved Location and keeps rule and occurrence acknowledgements distinct", async () => {
  const requests: { path: string; directory: string | null; workspace: string | null; body: unknown }[] = []
  const rule = scheduleRuleInfo({ status: "paused", nextDueAt: undefined, revision: 2, updatedAt: 3 })
  const run = scheduleOccurrenceInfo({ status: "admitted", updatedAt: 1004 })
  const setup = taskFixture(async (request) => {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname,
      directory: url.searchParams.get("directory"),
      workspace: url.searchParams.get("workspace"),
      body: request.method === "POST" ? await request.json() : undefined,
    })
    if (url.pathname.endsWith("/pause")) return Response.json(rule)
    if (url.pathname.endsWith("/run")) return Response.json(run)
    return Response.json([scheduleRuleInfo()])
  })
  try {
    setup.data.session.remember({ ...session(0), location: { directory: "/project", workspaceID: "wrk_task_data" } })
    await setup.data.session.schedule.sync("ses_refresh")
    expect(
      await setup.data.session.schedule.pause({
        sessionID: "ses_refresh",
        id: rule.id,
        payload: { expectedRevision: 1 },
      }),
    ).toEqual(rule)
    expect(setup.data.session.schedule.get("ses_refresh", rule.id)?.status).toBe("paused")
    expect(
      await setup.data.session.schedule.run({
        sessionID: "ses_refresh",
        id: rule.id,
        payload: { expectedRevision: 2 },
      }),
    ).toEqual(run)
    expect(setup.data.session.schedule.get("ses_refresh", rule.id)?.status).toBe("paused")
    expect(setup.data.session.schedule.occurrence("ses_refresh", run.id)?.status).toBe("admitted")
    expect(requests.map((request) => [request.path, request.directory, request.workspace])).toEqual([
      ["/schedule/rules/ses_refresh", "/project", "wrk_task_data"],
      ["/schedule/rule/sch_data_rule/pause", "/project", "wrk_task_data"],
      ["/schedule/rule/sch_data_rule/run", "/project", "wrk_task_data"],
    ])
    expect(requests.at(-1)?.body).toEqual({ expectedRevision: 2 })
  } finally {
    setup.dispose()
  }
})

test("Session reference deletion is a canonical Data fact and an authoritative read can restore it", async () => {
  const setup = taskFixture(() => Response.json({ data: session(0) }))
  try {
    await setup.data.session.readback("ses_refresh")
    expect(setup.data.session.deleted("ses_refresh")).toBe(false)
    setup.emit({ id: "evt_reference_deleted", type: "session.deleted", created: 3, data: { sessionID: "ses_refresh" } })
    expect(setup.data.session.deleted("ses_refresh")).toBe(true)
    expect(setup.data.session.get("ses_refresh")).toBeUndefined()
    await setup.data.session.readback("ses_refresh")
    expect(setup.data.session.deleted("ses_refresh")).toBe(false)
    expect(setup.data.session.get("ses_refresh")?.id).toBe("ses_refresh")
  } finally {
    setup.dispose()
  }
})

test("Goal reads and mutations use the generated Promise value and saved full Location", async () => {
  const requests: { path: string; directory: string | null; workspace: string | null; body: unknown }[] = []
  const initial = goalInfo()
  const paused = goalInfo({ status: "paused", pauseReason: "user", updatedAt: 4 })
  const completed = goalInfo({ status: "completed", updatedAt: 5 })
  const setup = taskFixture(async (request) => {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname,
      directory: url.searchParams.get("directory"),
      workspace: url.searchParams.get("workspace"),
      body: request.method === "POST" ? await request.json() : undefined,
    })
    if (url.pathname.endsWith("/pause")) return Response.json({ data: paused })
    if (url.pathname.endsWith("/confirm")) return Response.json({ data: completed })
    if (url.pathname.endsWith("/gol_missing")) return Response.json({ data: null })
    if (request.method === "POST" || url.pathname.endsWith(initial.id)) return Response.json({ data: initial })
    return Response.json({ data: [initial] })
  })
  try {
    setup.data.session.remember({ ...session(0), location: { directory: "/project", workspaceID: "wrk_goal_data" } })
    await setup.data.session.goal.sync(initial.sessionID)
    await setup.data.session.goal.readback(initial.sessionID, initial.id)
    await setup.data.session.goal.readback(initial.sessionID, "gol_missing")
    expect(setup.data.session.goal.list(initial.sessionID)).toEqual([initial])
    expect(
      await setup.data.session.goal.set({
        sessionID: initial.sessionID,
        goalID: initial.id,
        objective: initial.objective,
        conditions: initial.conditions,
        budget: initial.budget,
      }),
    ).toEqual(initial)
    expect(
      await setup.data.session.goal.pause({
        sessionID: initial.sessionID,
        goalID: initial.id,
        expectedRevision: initial.revision,
      }),
    ).toEqual(paused)
    expect(setup.data.session.goal.get(initial.sessionID, initial.id)?.status).toBe("paused")
    expect(
      await setup.data.session.goal.confirm({
        sessionID: initial.sessionID,
        goalID: initial.id,
        expectedRevision: initial.revision,
        evidenceIDs: ["evidence_current"],
        evidenceSetDigest: initial.evidenceSetDigest,
      }),
    ).toEqual(completed)
    expect(setup.data.session.goal.get(initial.sessionID, initial.id)?.status).toBe("completed")
    expect(requests.every((request) => request.directory === "/project" && request.workspace === "wrk_goal_data")).toBe(
      true,
    )
    expect(requests.at(-2)?.body).toEqual({ expectedRevision: 1 })
    expect(requests.at(-1)?.body).toEqual({
      expectedRevision: 1,
      evidenceIDs: ["evidence_current"],
      evidenceSetDigest: initial.evidenceSetDigest,
    })
    expect(requests.find((request) => request.body && request.path.endsWith("/goal"))?.body).toEqual({
      goalID: initial.id,
      objective: initial.objective,
      conditions: initial.conditions,
      budget: {},
    })
  } finally {
    setup.dispose()
  }
})

test("communication pages, detail and capability share the canonical Data records", async () => {
  const first = communicationInfo({ createdAt: 3 })
  const older = communicationInfo({ id: "com_data_older", createdAt: 1, state: "visible" })
  const setup = taskFixture((request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith(older.id)) return Response.json({ data: older })
    return Response.json({
      data: {
        items: url.searchParams.has("cursor") ? [first, older] : [first],
        next: url.searchParams.has("cursor") ? undefined : "older-page",
        capability: { read: true, list: true, send: false, reply: false, reasons: ["historical-agent"] },
      },
    })
  })
  try {
    setup.data.session.remember({
      ...session(0),
      location: { directory: "/project", workspaceID: "wrk_communication_data" },
    })
    await setup.data.session.communication.sync("ses_refresh")
    expect(setup.data.session.communication.next("ses_refresh")).toBe("older-page")
    await setup.data.session.communication.more("ses_refresh")
    await setup.data.session.communication.readback("ses_refresh", older.id)
    expect(setup.data.session.communication.list("ses_refresh")?.map((value) => value.id)).toEqual([first.id, older.id])
    expect(setup.data.session.communication.get("ses_refresh", older.id)).toEqual(older)
    expect(setup.data.session.communication.next("ses_refresh")).toBeUndefined()
    expect(setup.data.session.communication.capability("ses_refresh")).toEqual({
      read: true,
      list: true,
      send: false,
      reply: false,
      reasons: ["historical-agent"],
    })
    expect(
      setup.requests.map((request) => {
        const url = new URL(request.url)
        return [
          url.pathname,
          url.searchParams.get("directory"),
          url.searchParams.get("workspace"),
          url.searchParams.get("cursor"),
        ]
      }),
    ).toEqual([
      ["/api/session/ses_refresh/communication", "/project", "wrk_communication_data", null],
      ["/api/session/ses_refresh/communication", "/project", "wrk_communication_data", "older-page"],
      ["/api/session/ses_refresh/communication/com_data_older", "/project", "wrk_communication_data", null],
    ])
  } finally {
    setup.dispose()
  }
})

test.each(["send", "reply"] as const)(
  "communication %s preserves the exact wire request while lifecycle facts overtake its acknowledgement",
  async (action) => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const received = communicationInfo({
      actor: { type: "user", sessionID: "ses_data_target" },
      targetSessionID: "ses_refresh",
      body: { sessionID: "ses_refresh", inputID: "msg_communication_data", digest: "a".repeat(64) },
    })
    const value = communicationInfo({ replyTo: action === "reply" ? received.id : undefined, id: "com_data_sent" })
    const receipt: SessionCommunicationReceipt = { ...value, admission: "admitted", wake: "not_requested" }
    const bodies: unknown[] = []
    const setup = taskFixture(async (request) => {
      if (request.method === "GET")
        return Response.json({
          data: {
            items: action === "reply" ? [received] : [],
            capability: { read: true, list: true, send: true, reply: true, reasons: [] },
          },
        })
      bodies.push(await request.json())
      started.resolve()
      await release.promise
      return Response.json({ data: receipt })
    })
    const reads: Promise<SessionCommunicationReceipt>[] = []
    try {
      setup.data.session.remember({
        ...session(0),
        location: { directory: "/project", workspaceID: "wrk_communication_data" },
      })
      await setup.data.session.communication.sync("ses_refresh")
      const content = { type: "text" as const, text: value.text }
      const send = () =>
        action === "send"
          ? setup.data.session.communication.send({
              sessionID: "ses_refresh",
              payload: {
                id: value.id,
                targetSessionID: value.targetSessionID,
                content,
                delivery: "queue",
                trigger: false,
              },
            })
          : setup.data.session.communication.reply({
              sessionID: "ses_refresh",
              communicationID: received.id,
              payload: { id: value.id, content, delivery: "queue", trigger: false },
            })
      reads.push(send())
      await started.promise
      setup.emit(communicationEvent(value))
      setup.emit(communicationEvent(value))
      setup.emit({
        id: "evt_communication_cancelled",
        type: "session.inbox.cancelled",
        created: 5,
        durable: { aggregateID: value.targetSessionID, seq: 2, version: 1 },
        data: { sessionID: value.targetSessionID, inboxID: value.body.inputID },
      })
      release.resolve()
      expect(await reads[0]).toEqual(receipt)
      expect(setup.data.session.communication.get("ses_refresh", value.id)?.state).toBe("cancelled")
      expect(setup.data.session.communication.list("ses_refresh")?.filter((item) => item.id === value.id)).toHaveLength(
        1,
      )
      reads.push(send())
      await reads[1]
      expect(bodies[0]).toEqual(bodies[1])
      expect(bodies[0]).toEqual({
        id: value.id,
        ...(action === "send" ? { targetSessionID: value.targetSessionID } : {}),
        content,
        delivery: "queue",
        trigger: false,
      })
      const url = new URL(setup.requests.at(-1)!.url)
      expect(url.pathname).toBe(
        action === "send"
          ? "/api/session/ses_refresh/communication"
          : `/api/session/ses_refresh/communication/${received.id}/reply`,
      )
      expect(url.searchParams.get("workspace")).toBe("wrk_communication_data")
      expect(url.searchParams.get("directory")).toBe("/project")
    } finally {
      release.resolve()
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

test("communication lifecycle and deletion supersede a held page without duplicating its original carrier", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const value = communicationInfo()
  const snapshot = { held: false }
  const setup = taskFixture(async () => {
    if (snapshot.held) {
      started.resolve()
      await release.promise
    }
    return Response.json({
      data: {
        items: snapshot.held ? [value] : [],
        capability: { read: true, list: true, send: true, reply: true, reasons: [] },
      },
    })
  })
  const reads: Promise<void>[] = []
  try {
    setup.data.session.remember(session(0))
    await setup.data.session.communication.sync("ses_refresh")
    snapshot.held = true
    setup.data.session.communication.invalidate("ses_refresh")
    reads.push(setup.data.session.communication.sync("ses_refresh"))
    await started.promise
    setup.emit(communicationEvent(value))
    setup.emit({
      id: "evt_communication_delivered",
      type: "session.inbox.delivered",
      created: 4,
      durable: { aggregateID: value.targetSessionID, seq: 2, version: 1 },
      data: { sessionID: value.targetSessionID, inboxID: value.body.inputID },
    })
    release.resolve()
    await reads[0]
    expect(setup.data.session.communication.list("ses_refresh")?.map((item) => [item.id, item.state])).toEqual([
      [value.id, "visible"],
    ])
    setup.emit(communicationEvent(value))
    expect(setup.data.session.communication.get("ses_refresh", value.id)?.state).toBe("visible")
    setup.emit({
      id: "evt_communication_target_deleted",
      type: "session.deleted",
      created: 6,
      data: { sessionID: value.targetSessionID },
    })
    expect(setup.data.session.communication.get("ses_refresh", value.id)?.state).toBe("removed")
    expect(setup.data.session.deleted(value.targetSessionID)).toBe(true)
  } finally {
    release.resolve()
    await Promise.allSettled(reads)
    setup.dispose()
  }
})

test("older Inbox lifecycle events do not regress the canonical communication state", async () => {
  const value = communicationInfo()
  const setup = taskFixture(() =>
    Response.json({
      data: { items: [], capability: { read: true, list: true, send: true, reply: true, reasons: [] } },
    }),
  )
  try {
    setup.data.session.remember(session(0))
    await setup.data.session.communication.sync("ses_refresh")
    setup.emit(communicationEvent(value))
    setup.emit({
      id: "evt_communication_new_cancel",
      type: "session.inbox.cancelled",
      created: 5,
      durable: { aggregateID: value.targetSessionID, seq: 3, version: 1 },
      data: { sessionID: value.targetSessionID, inboxID: value.body.inputID },
    })
    setup.emit({
      id: "evt_communication_old_delivery",
      type: "session.inbox.delivered",
      created: 4,
      durable: { aggregateID: value.targetSessionID, seq: 2, version: 1 },
      data: { sessionID: value.targetSessionID, inboxID: value.body.inputID },
    })
    setup.emit(communicationEvent(value))
    expect(setup.data.session.communication.list("ses_refresh")?.map((item) => [item.id, item.state])).toEqual([
      [value.id, "cancelled"],
    ])
  } finally {
    setup.dispose()
  }
})

test.skipIf(isServer)(
  "communication reconnect revokes a held page and the existing owner performs the next read",
  async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const [status, setStatus] = createSignal<"connected" | "reconnecting">("connected")
    const value = communicationInfo()
    const snapshots = { calls: 0 }
    const setup = taskFixture(
      async () => {
        snapshots.calls += 1
        if (snapshots.calls === 1) {
          started.resolve()
          await release.promise
        }
        return Response.json({
          data: {
            items: [{ ...value, state: snapshots.calls === 1 ? "pending" : "visible" }],
            capability: { read: true, list: true, send: true, reply: true, reasons: [] },
          },
        })
      },
      { status },
    )
    const reads: Promise<void>[] = []
    try {
      setup.data.session.remember(session(0))
      reads.push(setup.data.session.communication.sync("ses_refresh"))
      await started.promise
      setStatus("reconnecting")
      setStatus("connected")
      release.resolve()
      await reads[0]
      expect(setup.data.session.communication.list("ses_refresh")).toBeUndefined()
      await setup.data.session.communication.sync("ses_refresh")
      expect(setup.data.session.communication.get("ses_refresh", value.id)?.state).toBe("visible")
    } finally {
      release.resolve()
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

test.each(["api replaced", "Location moved", "evicted", "deleted", "disposed"] as const)(
  "communication rejects a held page when its owner is %s",
  async (change) => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const value = communicationInfo()
    const setup = taskFixture(async () => {
      started.resolve()
      await release.promise
      return Response.json({
        data: { items: [value], capability: { read: true, list: true, send: true, reply: true, reasons: [] } },
      })
    })
    const reads: Promise<void>[] = []
    try {
      setup.data.session.remember(session(0))
      reads.push(setup.data.session.communication.sync("ses_refresh"))
      await started.promise
      if (change === "api replaced")
        setup.owner.api = AigcForge.make({
          baseUrl: "http://replacement.local",
          fetch: async () =>
            Response.json({
              data: { items: [], capability: { read: true, list: true, send: false, reply: false, reasons: [] } },
            }),
        })
      if (change === "Location moved")
        setup.data.session.remember({ ...session(0), location: { directory: "/other", workspaceID: "wrk_other" } })
      if (change === "evicted") setup.data.session.evict("ses_refresh")
      if (change === "deleted")
        setup.emit({
          id: "evt_communication_owner_deleted",
          type: "session.deleted",
          created: 3,
          data: { sessionID: "ses_refresh" },
        })
      if (change === "disposed") setup.dispose()
      release.resolve()
      await reads[0]
      expect(setup.data.session.communication.list("ses_refresh")).toBeUndefined()
      expect(setup.data.session.communication.get("ses_refresh", value.id)).toBeUndefined()
      expect(setup.data.session.communication.capability("ses_refresh")).toBeUndefined()
    } finally {
      release.resolve()
      await Promise.allSettled(reads)
      setup.dispose()
    }
  },
)

function communicationInfo(input: Partial<SessionCommunicationMessage> = {}): SessionCommunicationMessage {
  return {
    id: "com_data_communication",
    actor: { type: "user", sessionID: "ses_refresh" },
    contentSource: { sessionID: "ses_refresh", scope: "text" },
    targetSessionID: "ses_data_target",
    body: { sessionID: "ses_data_target", inputID: "msg_communication_data", digest: "a".repeat(64) },
    requestDigest: "b".repeat(64),
    delivery: "queue",
    trigger: false,
    createdAt: 1,
    text: "Read this exact saved communication.",
    state: "pending",
    ...input,
  }
}

function communicationEvent(value: SessionCommunicationMessage): AigcForgeEvent {
  return {
    id: "evt_communication_enqueued",
    type: "session.inbox.enqueued",
    created: 1,
    durable: { aggregateID: value.targetSessionID, seq: 1, version: 1 },
    data: {
      sessionID: value.targetSessionID,
      inboxID: value.body.inputID,
      communication: value,
      item: {
        type: "synthetic",
        delivery: value.delivery,
        payload: { text: value.text, metadata: { source: "share", communication: { id: value.id } } },
      },
    },
  }
}

function goalInfo(input: Partial<SessionGoalInfo> = {}): SessionGoalInfo {
  const count = { steps: 0, attempts: 0, recordedTokens: 0, sharedTokens: 0, unknownAttempts: 0, pendingAttempts: 0 }
  return {
    id: "gol_data_goal",
    sessionID: "ses_refresh",
    metaAgentID: "meta_data_goal",
    agent: "meta",
    selection: { agent: "meta", event: { id: "evt_goal_selection", seq: 1 } },
    objective: "Finish the saved task",
    conditions: [{ id: "acceptance", kind: "human_acceptance", description: "Review the saved result" }],
    taskRefs: [],
    revision: 1,
    revisionCreatedAt: 0,
    status: "active",
    pauseVersion: 0,
    budget: {},
    rounds: [],
    attempts: [],
    evidence: [],
    evidenceSetDigest: "a".repeat(64),
    currentEvidenceIDs: [],
    satisfiedConditionIDs: [],
    activeMilliseconds: 0,
    accounting: {
      rounds: 0,
      activeMilliseconds: 0,
      coordinator: { ...count },
      worker: { ...count },
      compaction: { ...count },
      auxiliary: { ...count },
    },
    createdAt: 0,
    updatedAt: 0,
    ...input,
  }
}

function scheduleRuleInfo(input: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: "sch_data_rule",
    sessionID: "ses_refresh",
    kind: "prompt",
    content: "Review the current work",
    dueAt: 1000,
    timezone: "UTC",
    target: { policy: "existing", sessionID: "ses_data_target" },
    executionPolicy: { delivery: "queue", missed: "catch_up" },
    sourceAgent: "meta",
    revision: 1,
    status: "pending",
    nextDueAt: 1000,
    createdAt: 0,
    updatedAt: 0,
    ...input,
  }
}

function scheduleOccurrenceInfo(input: Partial<ScheduleOccurrence> = {}): ScheduleOccurrence {
  return {
    id: "sco_data_occurrence",
    scheduleID: "sch_data_rule",
    sessionID: "ses_refresh",
    ruleRevision: 1,
    snapshot: scheduleRuleInfo(),
    scheduledAt: 1000,
    claimedAt: 1001,
    claimOwner: "test",
    caughtUp: false,
    status: "claimed",
    inputID: "msg_data_schedule",
    operationID: "top_data_schedule",
    createdAt: 1001,
    updatedAt: 1001,
    ...input,
  }
}

function operationInfo(input: Partial<SessionTaskOperationInfo> = {}): SessionTaskOperationInfo {
  return {
    sourceSessionID: "ses_refresh",
    sourceLocation: { directory: "/project" },
    sourceMode: "coding",
    operationID: "top_data_task",
    taskID: "tsk_data_task",
    inputID: "msg_data_task",
    targetSessionID: "ses_data_target",
    requestDigest: "a".repeat(64),
    request: {
      operationID: "top_data_task",
      inputID: "msg_data_task",
      taskID: "tsk_data_task",
      target: { type: "existing_root", sessionID: "ses_data_target" },
      prompt: "Read the saved work.",
      description: "Review saved work",
      files: [],
      delivery: "queue",
      resume: false,
    },
    source: { type: "user_coordination", sessionID: "ses_refresh" },
    selection: { agent: "meta", seq: 1 },
    phase: "admitted",
    cancelIntent: false,
    createdAt: 1,
    updatedAt: 2,
    ...input,
  }
}

function taskFixture(
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
  const owner = { api }
  return createRoot((dispose) => ({
    data: createData({
      api: () => owner.api,
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
    owner,
    requests,
    emit: (details: AigcForgeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    dispose,
  }))
}

test("physical attempt SSE preserves logical selection, exact observations and authoritative accounting on readback", async () => {
  const selection = { type: "group", groupID: "fallback" } as const
  const models = [
    { providerID: "a", id: "catalog-a" },
    { providerID: "b", id: "catalog-b" },
  ]
  const snapshot: SessionMessageInfo[] = []
  const setup = taskFixture(() => Response.json({ data: snapshot, cursor: {} }))
  const parent = session(0)
  const identity = { sessionID: parent.id, assistantMessageID: "msg_attempts" }
  const durable = (seq: number) => ({ aggregateID: parent.id, seq, version: 1 })
  try {
    setup.data.session.remember({ ...parent, model: selection, cost: 7 })
    setup.emit({
      id: "evt_attempt_a",
      type: "session.attempt.started",
      created: 1,
      durable: durable(1),
      data: {
        ...identity,
        ordinal: 0,
        attemptID: "physical-a",
        agent: "build",
        selection,
        model: models[0],
        apiModelID: "api-a",
        connection: { type: "credential", id: "cred_a" },
        quote: { status: "unknown" },
        goalRefs: [],
        transition: "initial",
        started: 1,
      },
    })
    setup.emit({
      id: "evt_first_step",
      type: "session.step.started",
      created: 2,
      durable: durable(2),
      data: { ...identity, agent: "build", model: models[0], started: 1 },
    })
    setup.emit({ id: "evt_a_streamed", type: "session.step.streamed", created: 3, durable: durable(3), data: identity })
    setup.emit({
      id: "evt_attempt_a_end",
      type: "session.attempt.ended",
      created: 3,
      durable: durable(4),
      data: {
        ...identity,
        ordinal: 0,
        terminal: {
          status: "failed",
          ended: 3,
          outputStarted: false,
          failure: { reason: "Authentication", status: 401 },
          usage: parent.tokens,
        },
      },
    })
    setup.emit({
      id: "evt_attempt_b",
      type: "session.attempt.started",
      created: 4,
      durable: durable(5),
      data: {
        ...identity,
        ordinal: 1,
        attemptID: "physical-b",
        agent: "build",
        selection,
        model: models[1],
        apiModelID: "api-b",
        connection: { type: "credential", id: "cred_b" },
        quote: { status: "free", prices: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] },
        goalRefs: [],
        transition: "fallback",
        reason: { reason: "Authentication", status: 401 },
        started: 4,
      },
    })
    const sent: AigcForgeEvent = {
      id: "evt_b_sent",
      type: "session.attempt.observed",
      created: 5,
      durable: durable(6),
      data: { ...identity, ordinal: 1, observation: { observedAt: 5, transport: "http", delivery: "accepted" } },
    }
    setup.emit(sent)
    setup.emit(sent)
    setup.emit({ ...sent, id: "evt_b_sent_again", durable: durable(7) })
    setup.emit({
      id: "evt_legacy_retry_start",
      type: "session.step.started",
      created: 6,
      durable: durable(8),
      data: { ...identity, agent: "build", model: models[1], started: 6 },
    })
    setup.emit({ id: "evt_b_streamed", type: "session.step.streamed", created: 6, durable: durable(9), data: identity })
    setup.emit({
      id: "evt_b_output",
      type: "session.attempt.observed",
      created: 7,
      durable: durable(10),
      data: { ...identity, ordinal: 1, observation: { observedAt: 7, outputStarted: true, firstOutputAt: 7 } },
    })
    setup.emit({ id: "evt_b_text", type: "session.text.started", created: 8, data: identity })
    setup.emit({
      id: "evt_b_delta",
      type: "session.text.delta",
      created: 9,
      data: { ...identity, delta: "Actual B output" },
    })
    const terminal: AigcForgeEvent = {
      id: "evt_attempt_b_end",
      type: "session.attempt.ended",
      created: 10,
      durable: durable(11),
      data: {
        ...identity,
        ordinal: 1,
        terminal: {
          status: "completed",
          ended: 10,
          outputStarted: true,
          finish: "stop",
          usage: parent.tokens,
          cost: 0,
        },
      },
    }
    setup.emit(terminal)
    setup.emit(terminal)
    expect(setup.data.session.get(parent.id)?.cost).toBe(7)
    setup.emit({
      id: "evt_step_end",
      type: "session.step.ended",
      created: 11,
      durable: durable(12),
      data: {
        ...identity,
        finish: "stop",
        needsContinuation: false,
        cost: 0,
        tokens: parent.tokens,
        unknownPriceAttempts: 1,
        missingUsageAttempts: 0,
      },
    })
    setup.emit({
      id: "evt_usage",
      type: "session.usage.updated",
      created: 12,
      data: { sessionID: parent.id, cost: 7, tokens: parent.tokens, unknownPriceAttempts: 1, missingUsageAttempts: 0 },
    })
    const message = setup.data.session.message.get(parent.id, identity.assistantMessageID)
    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") throw new Error("Missing actual attempt projection")
    expect(message.model).toEqual(models[1]!)
    expect(message.needsContinuation).toBe(false)
    expect(message.time.created).toBe(1)
    expect(message.time.streamed).toBe(3)
    if (message.origin?.kind !== "step") throw new Error("Missing first dispatch origin")
    expect(message.origin.id).toBe("evt_attempt_a")
    expect(
      message.attempts?.map((attempt) => [
        attempt.ordinal,
        attempt.model.providerID,
        attempt.apiModelID,
        attempt.terminal?.status,
      ]),
    ).toEqual([
      [0, "a", "api-a", "failed"],
      [1, "b", "api-b", "completed"],
    ])
    expect(message.attempts?.[1]?.observations.map((item) => item.event.id)).toEqual([
      "evt_b_sent",
      "evt_b_sent_again",
      "evt_b_output",
    ])
    expect(message.attempts?.[0]?.quote.status).toBe("unknown")
    expect(message.attempts?.[1]?.quote.status).toBe("free")
    expect(message.unknownPriceAttempts).toBe(1)
    expect(setup.data.session.get(parent.id)).toMatchObject({
      model: selection,
      cost: 7,
      unknownPriceAttempts: 1,
      missingUsageAttempts: 0,
    })
    snapshot.push(structuredClone(unwrap(message)))
    setup.data.session.message.invalidate(parent.id)
    await setup.data.session.message.sync(parent.id)
    expect(setup.data.session.message.get(parent.id, identity.assistantMessageID)).toEqual(snapshot[0]!)
  } finally {
    setup.dispose()
  }
})

test("the original model group resource refreshes only observed Location reads after configuration changes", async () => {
  const state = { name: "First" }
  const location = { directory: "/project" }
  const setup = taskFixture((request) => {
    if (new URL(request.url).pathname === "/api/model/group")
      return Response.json({
        location,
        data: {
          targets: [],
          definitions: [],
          effective: [
            {
              groupID: "fallback",
              definition: { name: state.name, enabled: true, members: [], strategy: "order", affinity: "turn" },
              unavailable: "empty",
            },
          ],
          defaultSelection: { type: "group", groupID: "fallback" },
        },
      })
    return Response.json({ location, data: [] })
  })
  try {
    const event: AigcForgeEvent = { id: "evt_group_config", type: "config.updated", created: 1, location, data: {} }
    setup.emit(event)
    expect(setup.requests.filter((request) => new URL(request.url).pathname === "/api/model/group")).toHaveLength(0)
    await setup.data.location.model.group.definition.sync(location)
    expect(setup.data.location.model.group.definition.list(location)?.effective[0]?.definition?.name).toBe("First")
    state.name = "Updated"
    setup.emit({ ...event, id: "evt_group_updated", created: 2 })
    await setup.data.location.model.group.definition.sync(location)
    expect(setup.requests.filter((request) => new URL(request.url).pathname === "/api/model/group")).toHaveLength(2)
    expect(setup.data.location.model.group.definition.list(location)?.effective[0]?.definition?.name).toBe("Updated")
  } finally {
    setup.dispose()
  }
})

function modelInfo(name: string): ModelInfo {
  return {
    id: "chat",
    modelID: "chat",
    providerID: "company",
    name,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 8192, output: 1024 },
  }
}

function activityFixture(
  read: () => Response | Promise<Response>,
  http?: (request: Request) => Response | Promise<Response>,
) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = AigcForge.make({
    baseUrl: "http://aigcfroge.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const path = new URL(request.url).pathname
      if (path === "/api/session/active") return read()
      if (path === "/api/project") return Response.json([])
      if (path === "/api/location") return Response.json({ directory: "/project" })
      if (http) return http(request)
      return Response.json({ location: { directory: "/project" }, data: { branch: "main" } })
    },
  })
  return createRoot((dispose) => ({
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
    }),
    emit: (details: AigcForgeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    dispose,
  }))
}

async function wait(check: () => boolean) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition")
    await Bun.sleep(10)
  }
}

for (const mode of ["chat", undefined] as const)
  test(`preserves an optimistic product mode ${mode ?? "default"} and adopts the canonical response`, async () => {
    const received = Promise.withResolvers<unknown>()
    const release = Promise.withResolvers<void>()
    const canonical = { ...session(0), mode: "work" as const, agent: "build" }
    const api = AigcForge.make({
      baseUrl: "http://aigcfroge.local",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        if (!request.url.endsWith("/api/session")) throw new Error(`Unexpected request: ${request.url}`)
        received.resolve(await request.json())
        await release.promise
        return Response.json({ data: canonical })
      },
    })
    const setup = createRoot((dispose) => ({
      data: createData({
        api: () => api,
        directory: "/project",
        event: { on: () => () => {}, listen: () => () => {} },
        connection: { status: () => "connected" },
      }),
      dispose,
    }))
    const input = { id: "ses_refresh", mode, agent: "build", location: { directory: "/project" } }
    const created = setup.data.session.create(input)
    try {
      const body = await received.promise
      expect({ mode: setup.data.session.get(created.id)?.mode, body }).toMatchObject({
        mode: mode ?? "coding",
        body: { id: created.id, agent: "build", ...(mode === undefined ? {} : { mode }) },
      })
      if (mode === undefined) expect(body).not.toHaveProperty("mode")
      expect(setup.data.session.creating(created.id)).toBe(true)
      release.resolve()
      await created.request
      expect(setup.data.session.get(created.id)).toMatchObject({ id: created.id, mode: "work", agent: "build" })
      expect(setup.data.session.creating(created.id)).toBe(false)
    } finally {
      release.resolve()
      await created.request
      setup.dispose()
    }
  })

test.each([
  ["gate", "replacement"],
  ["prepare", "replacement"],
  ["gate", "disposed"],
  ["prepare", "disposed"],
] as const)("prompt admission respects a %s-time %s of its owner", async (window, revocation) => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const requests: string[] = []
  const replacementRequests: string[] = []
  const admitted = {
    id: "msg_owner",
    sessionID: "ses_owner",
    type: "user" as const,
    delivery: "steer" as const,
    time: { created: 1 },
    payload: { text: "Keep the original owner" },
  }
  const owner = AigcForge.make({
    baseUrl: "http://owner.local",
    fetch: async (input, init) => {
      requests.push((input instanceof Request ? input : new Request(input, init)).url)
      return Response.json({ data: admitted })
    },
  })
  const replacement = AigcForge.make({
    baseUrl: "http://replacement.local",
    fetch: async (input, init) => {
      replacementRequests.push((input instanceof Request ? input : new Request(input, init)).url)
      return Response.json({ data: admitted })
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
    const sending = setup.data.session.prompt({
      sessionID: admitted.sessionID,
      id: admitted.id,
      text: admitted.payload.text,
      gate: window === "gate" ? release.promise : undefined,
      prepare: async () => {
        started.resolve()
        if (window === "prepare") await release.promise
      },
    })
    const outcome = sending.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    expect(setup.data.session.input.has(admitted.sessionID, admitted.id)).toBe(true)
    if (window === "prepare") await started.promise
    if (revocation === "replacement") api.current = replacement
    if (revocation === "disposed") setup.dispose()
    release.resolve()
    const result = await outcome
    if (result.ok) throw new Error("An obsolete prompt was sent")
    expect(result.error).toBeInstanceOf(ClientError)
    expect(result.error).toMatchObject({ name: "ClientError", reason: "Transport" })
    expect(requests).toEqual([])
    expect(replacementRequests).toEqual([])
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("an old API's rejected prompt cannot retract a retry owned by its replacement", async () => {
  const response = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  const retryGate = Promise.withResolvers<void>()
  const requests: string[] = []
  const input = { sessionID: "ses_owner_retry", id: "msg_owner_retry", text: "Keep the retry" }
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
    fetch: async (request, init) => {
      requests.push((request instanceof Request ? request : new Request(request, init)).url)
      return Response.json({
        data: {
          id: input.id,
          sessionID: input.sessionID,
          type: "user",
          delivery: "steer",
          time: { created: 2 },
          payload: { text: input.text },
        },
      })
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
    const first = setup.data.session.prompt(input).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await started.promise
    api.current = replacement
    const retry = setup.data.session.prompt({ ...input, gate: retryGate.promise }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    response.reject(new TypeError("Connection closed"))
    const failed = await first
    if (failed.ok) throw new Error("The old request unexpectedly succeeded")
    expect(failed.error).toBeInstanceOf(ClientError)
    expect(failed.error).toMatchObject({ reason: "Transport", cause: { message: "Connection closed" } })
    expect(setup.data.session.input.has(input.sessionID, input.id)).toBe(true)
    expect(setup.data.session.message.get(input.sessionID, input.id)).toMatchObject({
      type: "user",
      text: input.text,
    })
    retryGate.resolve()
    const result = await retry
    if (!result.ok) throw result.error
    expect(result.value.id).toBe(input.id)
    expect(setup.data.session.input.has(input.sessionID, input.id)).toBe(true)
    expect(requests).toEqual([
      "http://owner.local/api/session/ses_owner_retry/prompt",
      "http://replacement.local/api/session/ses_owner_retry/prompt",
    ])
  } finally {
    response.resolve(new Response(null, { status: 204 }))
    retryGate.resolve()
    setup.dispose()
  }
})

test.each(["known", "legacy"] as const)("reconciles the %s revert cut with nonmonotonic inbox IDs", async (kind) => {
  const sessionID = "ses_refresh"
  const inboxPath = "/api/session/" + sessionID + "/inbox"
  const messagePath = "/api/session/" + sessionID + "/message"
  const requests: string[] = []
  const firstRefresh = Promise.withResolvers<string>()
  const inboxRelease = Promise.withResolvers<void>()
  const messageRequested = Promise.withResolvers<void>()
  const retained = {
    id: "msg_z_old",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    origin: { kind: "step", sessionID, id: "evt_old_started", seq: 5 },
    time: { created: 5, completed: 21 },
    content: [],
  }
  const keep = {
    id: "msg_z_keep",
    sessionID,
    type: "user" as const,
    delivery: "queue" as const,
    payload: { text: "Queued before the cut" },
    time: { created: 10 },
  }
  const drop = {
    ...keep,
    id: "msg_a_drop",
    payload: { text: "Queued after the cut" },
    time: { created: 30 },
  }
  const setup = activityFixture(
    () => Response.json({ data: {} }),
    async (request) => {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (path === inboxPath) {
        firstRefresh.resolve(path)
        await inboxRelease.promise
        return Response.json({ data: [keep] })
      }
      if (path !== messagePath) throw new Error("Unexpected request: " + request.url)
      if (requests.filter((item) => item === messagePath).length === 1)
        return Response.json({
          data: [
            { id: "msg_a_tail", type: "user", text: "Later history", time: { created: 25 } },
            ...(kind === "known"
              ? [{ id: "msg_m_cut", type: "user", text: "Inclusive boundary", time: { created: 20 } }]
              : []),
            { ...retained, completion: { id: "evt_old_completed", seq: 21 } },
          ],
          cursor: {},
        })
      firstRefresh.resolve(path)
      messageRequested.resolve()
      // The marker lets the keeper observe canonical publication after the local index cut.
      return Response.json({
        data: [{ ...retained, metadata: { revertReadback: true } }],
        cursor: {},
      })
    },
  )
  try {
    await setup.data.session.message.sync(sessionID)
    ;[keep, drop].forEach((item) =>
      setup.emit({
        id: "evt_" + item.id,
        type: "session.inbox.enqueued",
        created: item.time.created,
        durable: { aggregateID: sessionID, seq: item.time.created, version: 1 },
        data: {
          sessionID,
          inboxID: item.id,
          item: { type: item.type, delivery: item.delivery, payload: item.payload },
        },
      }),
    )
    expect(setup.data.session.pending.list(sessionID).map((item) => item.id)).toEqual([keep.id, drop.id])
    setup.emit({
      id: "evt_nonmonotonic_revert",
      type: "session.revert.committed",
      created: 40,
      durable: { aggregateID: sessionID, seq: 40, version: 1 },
      data: { sessionID, to: "msg_m_cut", ...(kind === "known" ? { boundarySeq: 20 } : {}) },
    })
    // The server read owns pending order; no lexical ID filter may run while that read is blocked.
    expect(setup.data.session.pending.list(sessionID).map((item) => item.id)).toEqual([keep.id, drop.id])
    const projected = setup.data.session.message.get(sessionID, retained.id)
    if (projected?.type !== "assistant") throw new Error("Retained Assistant was removed by the cut")
    if (kind === "known") expect(projected.completion).toBeUndefined()
    expect(await firstRefresh.promise).toBe(inboxPath)
    expect(requests).toEqual([messagePath, inboxPath])
    inboxRelease.resolve()
    await messageRequested.promise
    await wait(() => setup.data.session.message.get(sessionID, retained.id)?.metadata?.revertReadback === true)
    expect(requests).toEqual([messagePath, inboxPath, messagePath])
    expect(setup.data.session.pending.list(sessionID).map((item) => item.id)).toEqual([keep.id])
    expect(setup.data.session.message.list(sessionID).map((item) => item.id)).toEqual([retained.id, keep.id])
    const canonical = setup.data.session.message.get(sessionID, retained.id)
    if (canonical?.type !== "assistant") throw new Error("Canonical Assistant was not restored")
    expect(canonical.completion).toBeUndefined()
  } finally {
    inboxRelease.resolve()
    setup.dispose()
  }
})
