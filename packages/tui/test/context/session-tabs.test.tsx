/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { OmnixaEvent } from "@omnixa/client"
import { testRender } from "@opentui/solid"
import { mkdirSync, watch } from "fs"
import path from "path"
import { ConfigProvider, useConfig } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider, useSessionTabs } from "../../src/context/session-tabs"
import { NEW_SESSION_TAB_TITLE } from "../../src/context/session-tabs-model"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2_000, label = "condition") {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

async function renderSessionTabs(
  initialSessionID: string,
  options?: {
    state?: string
    title?: string
    home?: boolean
    persisted?: string[]
    sessionGate?: Promise<void>
    sessionDirectories?: Record<string, string>
    sessionParents?: Record<string, string>
    sessionTimes?: Record<string, { idle?: number; viewed?: number }>
    sessionOutcomes?: Record<string, "succeeded" | "failed" | "interrupted">
    newLocation?: "launch" | "inherit"
    launchDirectory?: string
    tabsEnabled?: boolean
    viewFailures?: number
    experimental?: Record<string, boolean>
  },
) {
  const temporary = options?.state ? undefined : await tmpdir()
  const state = options?.state ?? temporary!.path
  if (options?.persisted) {
    const file = path.join(state, "test", "tui", "tabs.json")
    mkdirSync(path.dirname(file), { recursive: true })
    await Bun.write(
      file,
      JSON.stringify({
        global: { tabs: [], unread: { ses_legacy: "error" } },
        cwd: {
          [directory]: {
            tabs: options.persisted.map((sessionID) => ({ sessionID })),
            unread: { ses_legacy: "activity" },
          },
        },
      }),
    )
  }
  const events = createEventStream()
  const sessions: string[] = []
  const views: string[] = []
  const viewWatermarks: number[] = []
  const locations: string[] = []
  const vcsLocations: string[] = []
  const sessionTimes = Object.fromEntries(
    Object.entries(options?.sessionTimes ?? {}).map(([sessionID, time]) => [sessionID, { ...time }]),
  )
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location") {
      const requested = url.searchParams.get("location[directory]") ?? directory
      locations.push(requested)
      return json({
        directory: requested,
        project: { id: "project", directory: requested, canonical: directory },
      })
    }
    if (url.pathname === "/api/vcs") {
      const requested = url.searchParams.get("location[directory]") ?? directory
      vcsLocations.push(requested)
      return json({
        location: { directory: requested },
        data: { branch: { current: "main", default: "main" } },
      })
    }
    if (url.pathname === "/api/session" && url.searchParams.has("parentID")) {
      const parentID = url.searchParams.get("parentID")
      const children = Object.entries(options?.sessionParents ?? {})
        .filter(([, parent]) => parent === parentID)
        .map(([sessionID]) => sessionInfo(sessionID))
      return json({ data: children, cursor: {} })
    }
    const viewed = url.pathname.match(/^\/api\/session\/([^/]+)\/view$/)?.[1]
    if (viewed && request.method === "POST") {
      views.push(viewed)
      const payload: unknown = await request.json()
      if (typeof payload !== "object" || payload === null || !("idle" in payload) || typeof payload.idle !== "number")
        throw new Error("Expected an idle watermark")
      viewWatermarks.push(payload.idle)
      if (views.length <= (options?.viewFailures ?? 0)) return new Response(null, { status: 503 })
      const time = (sessionTimes[viewed] ??= {})
      time.viewed = Math.min(payload.idle, time.idle ?? payload.idle)
      return new Response(null, { status: 204 })
    }
    const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (!sessionID) return undefined
    sessions.push(sessionID)
    await options?.sessionGate
    return json({ data: sessionInfo(sessionID) })
  }, events)

  function sessionInfo(sessionID: string) {
    return {
      id: sessionID,
      parentID: options?.sessionParents?.[sessionID],
      title: sessionID === initialSessionID ? options?.title : undefined,
      projectID: "project",
      location: { directory: options?.sessionDirectories?.[sessionID] ?? directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: options?.sessionOutcomes?.[sessionID],
      time: { created: 0, updated: 0, ...sessionTimes[sessionID] },
    }
  }
  let tabs!: ReturnType<typeof useSessionTabs>
  let route!: ReturnType<typeof useRoute>
  let client!: ReturnType<typeof useClient>
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>
  let config!: ReturnType<typeof useConfig>
  let configuration = {
    tabs: { mode: options?.tabsEnabled === false ? ("off" as const) : ("on" as const) },
    experimental: options?.experimental,
    session: { new_location: options?.newLocation ?? "launch" },
  }

  function Probe() {
    tabs = useSessionTabs()
    route = useRoute()
    client = useClient()
    data = useData()
    storage = useStorage()
    config = useConfig()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ state }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider
            config={createTuiResolvedConfig(configuration)}
            service={{
              get: async () => configuration,
              update: async (update) => {
                configuration = structuredClone(configuration)
                update(configuration)
                return configuration
              },
            }}
          >
            <RouteProvider
              initialRoute={options?.home ? { type: "home" } : { type: "session", sessionID: initialSessionID }}
            >
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={options?.launchDirectory ?? directory}>
                  <LocationProvider>
                    <SessionTabsProvider>
                      <Probe />
                    </SessionTabsProvider>
                  </LocationProvider>
                </DataProvider>
              </ClientProvider>
            </RouteProvider>
          </ConfigProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))

  await wait(() => client.connection.status() === "connected")
  return {
    tabs,
    route,
    data,
    sessions,
    views,
    viewWatermarks,
    locations,
    vcsLocations,
    state,
    setSessionTime(sessionID: string, time: { idle?: number; viewed?: number }) {
      sessionTimes[sessionID] = time
    },
    emit: (event: OmnixaEvent) => events.emit({ ...event, location: { directory } }),
    focus: () => app.renderer.emit("focus"),
    blur: () => app.renderer.emit("blur"),
    flush: () => storage.flush(),
    setTabsEnabled: (enabled: boolean) =>
      config.update((draft) => {
        draft.tabs ??= {}
        draft.tabs.mode = enabled ? "on" : "off"
      }),
    async destroy() {
      app.renderer.destroy()
      await storage.flush()
      await temporary?.[Symbol.asyncDispose]()
    },
  }
}

function admitted(sessionID: string, inboxID: string): OmnixaEvent {
  return {
    id: `evt_${inboxID}`,
    created: Date.now(),
    type: "session.inbox.enqueued",
    durable: { aggregateID: sessionID, seq: Number(inboxID.replace(/\D/g, "")), version: 1 },
    data: {
      sessionID,
      inboxID,
      item: { type: "user", payload: { text: inboxID }, delivery: "steer" },
    },
  }
}

test("loads persisted tab metadata concurrently on connect", async () => {
  let release!: () => void
  const sessionGate = new Promise<void>((resolve) => (release = resolve))
  const setup = await renderSessionTabs("ses_first", {
    home: true,
    persisted: ["ses_first", "ses_second"],
    sessionGate,
  })

  try {
    await wait(() => setup.sessions.length === 2)
    expect(setup.sessions.toSorted()).toEqual(["ses_first", "ses_second"])
    release()
    await wait(
      () => setup.data.session.get("ses_first") !== undefined && setup.data.session.get("ses_second") !== undefined,
    )
  } finally {
    release()
    await setup.destroy()
  }
})

test("loads VCS metadata for each persisted tab location", async () => {
  const other = `${directory}/other-worktree`
  const setup = await renderSessionTabs("ses_first", {
    home: true,
    persisted: ["ses_first", "ses_second"],
    sessionDirectories: { ses_second: other },
  })

  try {
    await wait(() => setup.locations.includes(other))
    await wait(() => setup.vcsLocations.includes(other))
  } finally {
    await setup.destroy()
  }
})

test("opens a background tab without changing the current session", async () => {
  const setup = await renderSessionTabs("ses_first")

  try {
    await wait(
      () => setup.tabs.current() === "ses_first" && setup.tabs.tabs().some((tab) => tab.sessionID === "ses_first"),
    )
    setup.tabs.open("ses_background")
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_background"))

    expect(setup.tabs.current()).toBe("ses_first")
    setup.tabs.move("ses_background", 0)
    await wait(() => setup.tabs.tabs()[0]?.sessionID === "ses_background")
  } finally {
    await setup.destroy()
  }
})

test("loads location metadata when an open session moves", async () => {
  const destination = `${directory}/moved-worktree`
  const setup = await renderSessionTabs("ses_first")

  try {
    // server.connected loads the default location on its own, so also wait for the session and its tab:
    // a move that arrives before either has loaded is dropped.
    await wait(
      () =>
        setup.data.session.get("ses_first") !== undefined &&
        setup.tabs.tabs().some((tab) => tab.sessionID === "ses_first") &&
        setup.locations.includes(directory) &&
        setup.vcsLocations.includes(directory),
    )
    setup.emit({
      id: "evt_moved",
      created: 1,
      type: "session.moved",
      durable: { aggregateID: "ses_first", seq: 1, version: 1 },
      data: {
        sessionID: "ses_first",
        location: { directory: destination },
        projectID: "project",
      },
    })

    await wait(() => setup.data.session.get("ses_first")?.location.directory === destination)
    await wait(() => setup.locations.includes(destination))
    await wait(() => setup.vcsLocations.includes(destination))
  } finally {
    await setup.destroy()
  }
})

test("keeps each visited session open", async () => {
  const setup = await renderSessionTabs("ses_first", { persisted: ["ses_first"] })

  try {
    await wait(() => setup.tabs.tabs().length === 1)
    setup.route.navigate({ type: "session", sessionID: "ses_second" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_second"))
    setup.route.navigate({ type: "session", sessionID: "ses_third" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_third"))

    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["ses_first", "ses_second", "ses_third"])
  } finally {
    await setup.destroy()
  }
})

test("lists closed tabs newest first and reopens a selected entry", async () => {
  const setup = await renderSessionTabs("ses_first", { persisted: ["ses_first", "ses_second", "ses_third"] })
  try {
    await wait(() => setup.tabs.tabs().length === 3)
    setup.tabs.close("ses_second")
    await wait(() => setup.tabs.tabs().length === 2)
    setup.tabs.close("ses_third")
    await wait(() => setup.tabs.tabs().length === 1)
    expect(setup.tabs.recentlyClosed().map((tab) => tab.sessionID)).toEqual(["ses_third", "ses_second"])
    setup.tabs.reopen("ses_second")
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_second"))
    expect(setup.tabs.current()).toBe("ses_second")
    expect(setup.tabs.recentlyClosed().map((tab) => tab.sessionID)).toEqual(["ses_third"])
    setup.tabs.reopen()
    await wait(() => setup.tabs.tabs().length === 3)
    expect(setup.tabs.current()).toBe("ses_third")
    expect(setup.tabs.recentlyClosed()).toEqual([])
  } finally {
    await setup.destroy()
  }
})

test("stores session tabs for the current working directory by default", async () => {
  const setup = await renderSessionTabs("ses_first")

  try {
    const file = path.join(setup.state, "test", "tui", "tabs.json")
    await wait(async () => {
      if (!(await Bun.file(file).exists())) return false
      const stored = await Bun.file(file).json()
      return stored.cwd[directory]?.tabs.some((tab: { sessionID: string }) => tab.sessionID === "ses_first")
    })
    const stored = await Bun.file(file).json()
    expect(stored.global).toEqual({ tabs: [], unread: {} })
    expect(Object.keys(stored.cwd)).toEqual([directory])
    expect(stored.cwd[directory].tabs.map((tab: { sessionID: string }) => tab.sessionID)).toEqual(["ses_first"])
    expect(stored.cwd[directory].unread).toEqual({})
  } finally {
    await setup.destroy()
  }
})

test("keeps scroll anchors for open session tabs", async () => {
  const setup = await renderSessionTabs("ses_first")

  try {
    await wait(() => setup.tabs.current() === "ses_first")
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_first"))
    const target = { type: "part" as const, ref: { messageID: "msg_1", partID: "text:0" } }
    setup.tabs.setScrollAnchor("ses_first", { target, screenY: -3 })
    expect(setup.tabs.scrollAnchor("ses_first")).toEqual({ target, screenY: -3 })
    const group = { type: "group" as const, groupID: "group-1" }
    setup.tabs.setScrollAnchor("ses_first", { target: group, screenY: -3 })
    expect(setup.tabs.scrollAnchor("ses_first")?.target).toEqual(group)
    setup.tabs.setGroupExpanded("ses_first", group.groupID, true)
    expect(setup.tabs.groupExpanded("ses_first", group.groupID)).toBe(true)
    setup.tabs.setGroupExpanded("ses_first", group.groupID, false)
    expect(setup.tabs.groupExpanded("ses_first", group.groupID)).toBe(false)

    setup.tabs.close("ses_first")
    await wait(() => setup.tabs.tabs().every((tab) => tab.sessionID !== "ses_first"))
    expect(setup.tabs.scrollAnchor("ses_first")).toBeUndefined()
    expect(setup.tabs.groupExpanded("ses_first", group.groupID)).toBeUndefined()
  } finally {
    await setup.destroy()
  }
})

test("keeps parent and subagent scroll anchors independent", async () => {
  const setup = await renderSessionTabs("ses_root", {
    persisted: ["ses_root"],
    sessionParents: { ses_child: "ses_root" },
  })

  try {
    await wait(() => setup.data.session.get("ses_child") !== undefined)
    const parent = {
      target: { type: "part" as const, ref: { messageID: "msg_parent", partID: "message" } },
      screenY: -3,
    }
    const child = { target: { type: "part" as const, ref: { messageID: "msg_child", partID: "message" } }, screenY: -5 }
    setup.tabs.setScrollAnchor("ses_root", parent)

    // A short subagent transcript is at the bottom, so it saves no anchor.
    setup.tabs.setScrollAnchor("ses_child", undefined)
    expect(setup.tabs.scrollAnchor("ses_root")).toEqual(parent)
    expect(setup.tabs.scrollAnchor("ses_child")).toBeUndefined()

    setup.tabs.setScrollAnchor("ses_child", child)
    expect(setup.tabs.scrollAnchor("ses_root")).toEqual(parent)
    expect(setup.tabs.scrollAnchor("ses_child")).toEqual(child)

    setup.tabs.setScrollAnchor("ses_root", undefined)
    expect(setup.tabs.scrollAnchor("ses_child")).toEqual(child)

    setup.tabs.close("ses_root")
    await wait(() => setup.tabs.tabs().length === 0)
    setup.route.navigate({ type: "session", sessionID: "ses_root" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_root"))
    expect(setup.tabs.scrollAnchor("ses_root")).toBeUndefined()
    expect(setup.tabs.scrollAnchor("ses_child")).toBeUndefined()
  } finally {
    await setup.destroy()
  }
})

test("derives unread state from server session times", async () => {
  const setup = await renderSessionTabs("ses_first", {
    home: true,
    persisted: ["ses_first", "ses_second"],
    sessionTimes: { ses_second: { idle: 2 } },
  })
  try {
    await wait(() => setup.tabs.status("ses_second").unread === "activity")
    expect(setup.tabs.status("ses_first").unread).toBeUndefined()
  } finally {
    await setup.destroy()
  }
})

test("marks unread failed sessions with error styling", async () => {
  const setup = await renderSessionTabs("ses_first", {
    home: true,
    persisted: ["ses_first", "ses_second"],
    sessionTimes: { ses_first: { idle: 2 }, ses_second: { idle: 2 } },
    sessionOutcomes: { ses_second: "failed" },
  })
  try {
    await wait(() => setup.tabs.status("ses_second").unread === "error")
    expect(setup.tabs.status("ses_first").unread).toBe("activity")
  } finally {
    await setup.destroy()
  }
})

test("acknowledges viewed sessions even when tabs are disabled", async () => {
  const setup = await renderSessionTabs("ses_first", {
    tabsEnabled: false,
    sessionTimes: { ses_first: { idle: 2 } },
  })
  try {
    setup.focus()
    await setup.data.session.sync("ses_first")
    await wait(() => setup.views.includes("ses_first"))
    expect(setup.tabs.tabs()).toEqual([])
  } finally {
    await setup.destroy()
  }
})

test("empties legacy persisted unread records for rollback compatibility", async () => {
  const setup = await renderSessionTabs("ses_first", { persisted: ["ses_first"] })
  try {
    const file = path.join(setup.state, "test", "tui", "tabs.json")
    // Normalize rewrites the active scope; legacy values must not survive, but older clients require the field.
    await wait(async () => {
      const stored = await Bun.file(file).json()
      return Object.keys(stored.cwd[directory].unread).length === 0
    })
  } finally {
    await setup.destroy()
  }
})

test("refreshes server session times after terminal events", async () => {
  const setup = await renderSessionTabs("ses_first", { home: true, persisted: ["ses_first"] })
  try {
    // Terminal events refresh only already-loaded sessions, so ensure the initial sync landed.
    await wait(() => setup.data.session.get("ses_first") !== undefined)
    setup.setSessionTime("ses_first", { idle: 2 })
    setup.emit({
      id: "evt_done_first",
      created: 2,
      type: "session.execution.succeeded",
      durable: { aggregateID: "ses_first", seq: 1, version: 1 },
      data: { sessionID: "ses_first" },
    })
    await wait(() => setup.tabs.status("ses_first").unread === "activity")
  } finally {
    await setup.destroy()
  }
})

test("views a selected unread session only while focused", async () => {
  const setup = await renderSessionTabs("ses_first", {
    home: true,
    persisted: ["ses_first"],
    sessionTimes: { ses_first: { idle: 2 } },
  })
  try {
    setup.blur()
    setup.route.navigate({ type: "session", sessionID: "ses_first" })
    await wait(() => setup.tabs.current() === "ses_first" && setup.tabs.status("ses_first").unread === "activity")
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    setup.focus()
    await wait(() => setup.views.includes("ses_first"))
    setup.emit({
      id: "evt_viewed_first",
      created: 3,
      type: "session.viewed",
      durable: { aggregateID: "ses_first", seq: 2, version: 1 },
      data: { sessionID: "ses_first", idle: 2 },
    })
    await wait(() => setup.tabs.status("ses_first").unread === undefined)
    expect(setup.views).toEqual(["ses_first"])
    expect(setup.viewWatermarks).toEqual([2])
  } finally {
    await setup.destroy()
  }
})

test("does not acknowledge an unread session until focus is confirmed", async () => {
  const setup = await renderSessionTabs("ses_first", { sessionTimes: { ses_first: { idle: 2 } } })
  try {
    await wait(() => setup.tabs.status("ses_first").unread === "activity")
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    setup.focus()
    await wait(() => setup.views.includes("ses_first"))
  } finally {
    await setup.destroy()
  }
})

test("retries a failed view acknowledgement", async () => {
  const setup = await renderSessionTabs("ses_first", {
    sessionTimes: { ses_first: { idle: 2 } },
    viewFailures: 1,
  })
  try {
    setup.focus()
    await wait(() => setup.views.length === 2)
    expect(setup.views).toEqual(["ses_first", "ses_first"])
    expect(setup.viewWatermarks).toEqual([2, 2])
  } finally {
    await setup.destroy()
  }
})

test("ignores subagent unread state on the root tab", async () => {
  const setup = await renderSessionTabs("ses_root", {
    home: true,
    persisted: ["ses_root"],
    sessionParents: { ses_child: "ses_root" },
    sessionTimes: { ses_child: { idle: 2 } },
  })
  try {
    await wait(() => setup.data.session.get("ses_child") !== undefined)
    expect(setup.tabs.status("ses_root").unread).toBeUndefined()

    setup.route.navigate({ type: "session", sessionID: "ses_root" })
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    // A background subagent completion wakes the parent; the parent's own idle transition
    // then carries the unread signal and is the only state acknowledged.
    setup.focus()
    setup.setSessionTime("ses_root", { idle: 3 })
    setup.emit({
      id: "evt_done_root",
      created: 3,
      type: "session.execution.succeeded",
      durable: { aggregateID: "ses_root", seq: 1, version: 1 },
      data: { sessionID: "ses_root" },
    })
    await wait(() => setup.views.includes("ses_root"))
    expect(setup.views).toEqual(["ses_root"])
  } finally {
    await setup.destroy()
  }
})

test("distinguishes family questions and permissions without clearing them on selection", async () => {
  const setup = await renderSessionTabs("ses_root", {
    home: true,
    persisted: ["ses_root"],
    sessionParents: { ses_child: "ses_root" },
  })
  try {
    await wait(() => setup.data.session.get("ses_child") !== undefined)
    expect(setup.tabs.status("ses_root").attention).toBe(false)

    setup.emit({
      id: "evt_question",
      created: 1,
      type: "form.created",
      data: {
        form: {
          id: "frm_question",
          sessionID: "ses_child",
          title: "Choose an approach",
          fields: [{ key: "approach", type: "string", title: "Approach" }],
        },
      },
    })
    await wait(() => setup.tabs.status("ses_root").attention === "question")

    setup.tabs.select("ses_root")
    await wait(() => setup.tabs.current() === "ses_root")
    expect(setup.tabs.status("ses_root").attention).toBe("question")

    setup.emit({
      id: "evt_permission",
      created: 2,
      type: "permission.asked",
      data: { id: "per_command", sessionID: "ses_root", action: "shell", resources: ["bun run test"] },
    })
    await wait(() => setup.tabs.status("ses_root").attention === "permission")
    expect(setup.tabs.status("ses_child").attention).toBe("permission")

    setup.emit({
      id: "evt_permission_reply",
      created: 3,
      type: "permission.replied",
      data: { sessionID: "ses_root", requestID: "per_command", reply: "once" },
    })
    await wait(() => setup.tabs.status("ses_root").attention === "question")

    setup.emit({
      id: "evt_question_reply",
      created: 4,
      type: "form.replied",
      data: { sessionID: "ses_child", id: "frm_question", answer: {} },
    })
    await wait(() => setup.tabs.status("ses_root").attention === false)
  } finally {
    await setup.destroy()
  }
})

test("concurrent TUIs do not alternate shared tab titles from divergent session caches", async () => {
  await using temporary = await tmpdir()
  const state = temporary.path
  let titled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined
  let untitled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined

  try {
    titled = await renderSessionTabs("ses_shared", { state, title: "Generated title" })
    untitled = await renderSessionTabs("ses_shared", { state })
    const file = path.join(state, "test", "tui", "tabs.json")
    await titled.data.session.sync("ses_shared")
    await wait(async () => {
      if (!(await Bun.file(file).exists())) return false
      return (await Bun.file(file).json()).cwd[directory]?.tabs[0]?.title === "Generated title"
    })
    const observed = ["Generated title"]
    const pending = new Set<Promise<void>>()
    const watcher = watch(path.dirname(file), (_, name) => {
      if (name !== path.basename(file)) return
      const read = Bun.file(file)
        .json()
        .then((value) => {
          const title = value.cwd[directory]?.tabs[0]?.title
          if (title && observed.at(-1) !== title) observed.push(title)
        })
        .catch(() => undefined)
        .finally(() => pending.delete(read))
      pending.add(read)
    })
    try {
      await untitled.data.session.sync("ses_shared")
      await Bun.sleep(500)
    } finally {
      watcher.close()
      await Promise.allSettled(pending)
    }

    expect(observed).toEqual(["Generated title"])
  } finally {
    if (titled) await titled.destroy()
    if (untitled) await untitled.destroy()
  }
})

test("closing a tab is not undone by another TUI viewing the same session", async () => {
  await using temporary = await tmpdir()
  const clients: Awaited<ReturnType<typeof renderSessionTabs>>[] = []

  try {
    const first = await renderSessionTabs("ses_shared", { state: temporary.path })
    clients.push(first)
    const second = await renderSessionTabs("ses_shared", { state: temporary.path })
    clients.push(second)
    await wait(() => first.tabs.tabs().some((tab) => tab.sessionID === "ses_shared"), 2_000, "first tab to open")
    await wait(() => second.tabs.tabs().some((tab) => tab.sessionID === "ses_shared"), 2_000, "second tab to open")
    await Promise.all([first.flush(), second.flush()])
    first.tabs.close()
    await wait(() => first.route.data.type === "home", 2_000, "first client to navigate home")
    await first.flush()
    await wait(
      () => !second.tabs.tabs().some((tab) => tab.sessionID === "ses_shared"),
      2_000,
      "second client to observe close",
    )
    await second.flush()

    const stored = await Bun.file(path.join(temporary.path, "test", "tui", "tabs.json")).json()
    expect(stored.cwd[directory].tabs).toEqual([])

    second.route.navigate({ type: "home" })
    await wait(() => second.route.data.type === "home", 2_000, "second client to navigate home")
    second.route.navigate({ type: "session", sessionID: "ses_shared" })
    await wait(
      () => second.tabs.tabs().some((tab) => tab.sessionID === "ses_shared"),
      2_000,
      "second client to reopen tab",
    )
    await second.flush()
    await wait(
      () => first.tabs.tabs().some((tab) => tab.sessionID === "ses_shared"),
      2_000,
      "first client to observe reopen",
    )
  } finally {
    await Promise.allSettled(clients.map((client) => client.destroy()))
  }
})

test("user prompt admissions pulse an already-busy background tab", async () => {
  const setup = await renderSessionTabs("ses_background", { persisted: ["ses_background"] })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "ses_background"))
    setup.route.navigate({ type: "session", sessionID: "ses_active" })
    await wait(() => setup.tabs.current() === "ses_active" && setup.tabs.tabs().length === 2)

    setup.emit({
      id: "evt_context",
      created: Date.now(),
      type: "session.inbox.enqueued",
      durable: { aggregateID: "ses_background", seq: 0, version: 1 },
      data: {
        sessionID: "ses_background",
        inboxID: "msg_context",
        item: { type: "synthetic", payload: { text: "editor context" }, delivery: "steer" },
      },
    })
    await Bun.sleep(20)
    expect(setup.tabs.status("ses_background").promptPulse).toBe(0)

    setup.emit(admitted("ses_background", "msg_1"))
    await wait(() => setup.tabs.status("ses_background").promptPulse === 1 && setup.tabs.status("ses_background").busy)

    setup.emit(admitted("ses_background", "msg_2"))
    await wait(() => setup.tabs.status("ses_background").promptPulse === 2)

    setup.emit(admitted("ses_active", "msg_3"))
    await Bun.sleep(20)
    expect(setup.tabs.status("ses_active").promptPulse).toBe(0)
    expect(setup.tabs.status("ses_background")).toMatchObject({ promptPulse: 2, busy: true })
  } finally {
    await setup.destroy()
  }
})

test("tracks a temporary new session tab across close and creation", async () => {
  const setup = await renderSessionTabs("ses_first", { persisted: ["ses_first"] })

  try {
    await wait(() => setup.tabs.current() === "ses_first")
    setup.route.navigate({ type: "session", sessionID: "ses_second" })
    await wait(() => setup.tabs.current() === "ses_second" && setup.tabs.tabs().length === 2)
    setup.route.navigate({ type: "session", sessionID: "ses_first" })
    await wait(() => setup.tabs.current() === "ses_first")

    setup.route.navigate({ type: "home" })
    await wait(() => setup.tabs.newTab() && setup.tabs.current() === undefined)
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["ses_first", "ses_second"])
    setup.tabs.close()
    await wait(() => setup.route.data.type === "session")

    expect(setup.route.data).toEqual({ type: "session", sessionID: "ses_first" })

    setup.route.navigate({ type: "home" })
    await wait(() => setup.tabs.newTab())
    setup.route.navigate({ type: "session", sessionID: "ses_third" })
    expect(setup.tabs.newTab()).toBe(true)
    await wait(
      () => setup.tabs.current() === "ses_third" && setup.tabs.tabs().some((tab) => tab.sessionID === "ses_third"),
    )

    expect(setup.tabs.newTab()).toBe(false)
    expect(setup.tabs.tabs().find((tab) => tab.sessionID === "ses_third")?.title).toBe(NEW_SESSION_TAB_TITLE)
  } finally {
    await setup.destroy()
  }
})

test("add opens the new session tab in the resolved server launch directory", async () => {
  const launchDirectory = `${directory}/server`
  const setup = await renderSessionTabs("ses_first", {
    launchDirectory,
    sessionDirectories: { ses_first: `${directory}/worktree` },
  })

  try {
    await wait(() => setup.tabs.current() === "ses_first" && setup.data.session.get("ses_first") !== undefined)
    setup.tabs.add()
    expect(setup.route.data).toEqual({ type: "home", location: { directory: launchDirectory } })
    await wait(() => setup.tabs.newTab())
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["ses_first"])
  } finally {
    await setup.destroy()
  }
})

test("add inherits the current session location when configured", async () => {
  const worktree = `${directory}/worktree`
  const setup = await renderSessionTabs("ses_first", {
    newLocation: "inherit",
    sessionDirectories: { ses_first: worktree },
  })

  try {
    await wait(() => setup.tabs.current() === "ses_first" && setup.data.session.get("ses_first") !== undefined)
    setup.tabs.add()
    expect(setup.route.data).toEqual({ type: "home", location: { directory: worktree } })
  } finally {
    await setup.destroy()
  }
})
