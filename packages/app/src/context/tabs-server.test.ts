import { afterEach, expect, mock, test } from "bun:test"
import { createComponent, createEffect, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { ServerScope, SessionStateKey } from "@/utils/server-scope"
// Deep specifiers are not mocked by sibling tests, so they resolve to the real
// implementations used to rebuild the barrel below.
import * as uiContextHelper from "@aigcfroge/ui/context/helper"
import * as uiContextFile from "@aigcfroge/ui/context/file"
import * as uiContextDialog from "@aigcfroge/ui/context/dialog"
import * as uiContextI18n from "@aigcfroge/ui/context/i18n"

import type { Tab } from "./tabs"

const route = { pathname: "/", search: "", query: {} }
const navigations: string[] = []

// Sibling tests share one bun module registry and never restore their mocks:
// components/file-tree mocks @solidjs/router with an incomplete surface, and
// context/comments + context/terminal mock @aigcfroge/ui/context with a no-op
// createSimpleContext — which turns every provider built at module load into
// undefined. Restore both to the real surface here (TabsProvider only reads the
// router via hooks, so render it directly instead of through MemoryRouter/Route).
mock.module("@solidjs/router", () => ({
  useNavigate: () => (href: string) => navigations.push(href),
  useParams: () => ({}),
  useLocation: () => route,
  useSearchParams: () => [{}, () => undefined],
  useBeforeLeave: () => undefined,
}))
mock.module("@aigcfroge/ui/context", () => ({
  ...uiContextHelper,
  ...uiContextFile,
  ...uiContextDialog,
  ...uiContextI18n,
}))

const { PlatformProvider } = await import("./platform")
const { ServerConnection, ServerProvider, useServer } = await import("./server")
const { tabKey, TabsProvider, useTabs } = await import("./tabs")
const { Persist, PersistTesting } = await import("@/utils/persist")
const { sessionHref } = await import("@/utils/session-route")
const { LanguageProvider } = await import("./language")
const { ChatWorkspaceProvider, useChatWorkspace } = await import("./chat-workspace")
const { RouteContributionProvider, useRouteContribution } = await import("./route-contribution")

const storage = PersistTesting.localStorageWithPrefix(Persist.global("tabs").storage!)
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  ;["tabs", "tabs.recent", "server"].forEach((key) => storage.removeItem(key))
  route.pathname = "/"
  navigations.length = 0
})

function renderTabs(connections: import("./server").ServerConnection.Any[], Probe: () => null) {
  const container = document.createElement("div")
  document.body.append(container)
  return render(
    () =>
      createComponent(PlatformProvider, {
        value: {
          platform: "web",
          openLink() {},
          restart: async () => {},
          back() {},
          forward() {},
          notify: async () => {},
        },
        get children() {
          return createComponent(ServerProvider, {
            defaultServer: ServerConnection.Key.make("sidecar"),
            servers: connections,
            get children() {
              return createComponent(LanguageProvider, {
                locale: "en",
                get children() {
                  return createComponent(uiContextDialog.DialogProvider, {
                    get children() {
                      return createComponent(ChatWorkspaceProvider, {
                        get children() {
                          return createComponent(RouteContributionProvider, {
                            get children() {
                              return createComponent(TabsProvider, {
                                get children() {
                                  return createComponent(Probe, {})
                                },
                              })
                            },
                          })
                        },
                      })
                    },
                  })
                },
              })
            },
          })
        },
      }),
    container,
  )
}

function waitFor(check: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop()
      reject(new Error("Tab state did not settle"))
    }, 2_000)
    const stop = createRoot((dispose) => {
      createEffect(() => {
        if (!check()) return
        clearTimeout(timeout)
        dispose()
        resolve()
      })
      return dispose
    })
  })
}

test("registered sidecar/http/ssh/wsl tabs and draft memory survive pruning; removed servers do not", async () => {
  const [connections, setConnections] = createStore<import("./server").ServerConnection.Any[]>([
    { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } },
    { type: "http", http: { url: "http://127.0.0.1:4096" } },
    { type: "ssh", host: "User@Host", http: { url: "http://127.0.0.1:4098" } },
    { type: "sidecar", variant: "wsl", distro: "Ubuntu", http: { url: "http://127.0.0.1:4097" } },
  ])
  const saved: Tab[] = connections.flatMap((connection, index) => {
    const server =
      connection.type === "http"
        ? ServerConnection.Key.make("http://localhost:4096/")
        : ServerConnection.key(connection)
    return [
      { type: "session", server, sessionId: `session-${index}` },
      { type: "draft", server, draftID: `draft-${index}`, directory: "/repo", mode: "coding" },
    ]
  })
  const removed: Tab = {
    type: "draft",
    server: ServerConnection.Key.make("http://removed.test"),
    draftID: "removed",
    directory: "/repo",
    mode: "coding",
  }
  storage.setItem("tabs", JSON.stringify([...saved, removed]))
  storage.setItem("tabs.recent", JSON.stringify({ key: tabKey(saved[1]) }))
  storage.removeItem("server")
  const state = new Map<string, object>()
  const cleaned: string[] = []
  let tabs: ReturnType<typeof useTabs> | undefined
  let server: ReturnType<typeof useServer> | undefined
  function Probe() {
    tabs = useTabs()
    server = useServer()
    ;[...saved, removed].forEach((tab) => {
      state.set(
        tabKey(tab),
        tabs!.state(tab, "prompt", () => {
          onCleanup(() => cleaned.push(tabKey(tab)))
          return { text: `unsent:${tabKey(tab)}` }
        }),
      )
    })
    return null
  }
  dispose = renderTabs(connections, Probe)
  await waitFor(() => !!tabs?.ready() && tabs.recentReady())
  expect(tabs?.ready()).toBe(true)
  expect(tabs?.store).toEqual(saved)
  expect(server?.key).toBe(ServerConnection.Key.make("sidecar"))
  expect(server?.scope()).toBe(ServerScope.local)
  expect(cleaned).toEqual([tabKey(removed)])
  saved.forEach((tab) => expect(tabs?.state(tab, "prompt", () => ({}))).toBe(state.get(tabKey(tab))))
  expect(JSON.parse(storage.getItem("tabs.recent")!)).toEqual({ key: tabKey(saved[1]) })

  // Removing SSH still exercises the real provider's destructive cleanup path.
  setConnections((current) => current.filter((connection) => connection.type !== "ssh"))
  expect(tabs?.store).toEqual(saved.filter((tab) => !tab.server.startsWith("ssh:")))
  expect(cleaned).toEqual([tabKey(removed), ...saved.filter((tab) => tab.server.startsWith("ssh:")).map(tabKey)])
  saved
    .filter((tab) => !tab.server.startsWith("ssh:"))
    .forEach((tab) => {
      expect(tabs?.state(tab, "prompt", () => ({}))).toBe(state.get(tabKey(tab)))
    })
})

test("a stale active owner cannot redirect a newer route when an archive finishes", async () => {
  const target = ServerConnection.Key.make("sidecar")
  const saved: Tab[] = [
    { type: "session", server: target, sessionId: "old" },
    { type: "session", server: target, sessionId: "new" },
  ]
  storage.setItem("tabs", JSON.stringify(saved))
  let tabs: ReturnType<typeof useTabs> | undefined
  let contribution: ReturnType<typeof useRouteContribution>
  function Probe() {
    tabs = useTabs()
    contribution = useRouteContribution()
    useChatWorkspace()!.route.setActiveTabKey(tabKey(saved[0]), Symbol("old-owner"))
    return null
  }
  dispose = renderTabs([{ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } }], Probe)
  await waitFor(() => !!tabs?.ready() && tabs.recentReady())
  const owner = (leafID: string) => ({
    routeIdentity: `${target}\0${leafID}`,
    activeTopLevelTabKey: tabKey(saved[0]),
    key: SessionStateKey.from(ServerScope.local, SessionStateKey.route(leafID)),
    server: target,
    scope: ServerScope.local,
    directory: "/repo",
    leafID,
    openContext() {},
    sessionStatus: { unseenCount: () => 0, unseenHasError: () => false, autoResponds: () => false },
    assistantPanel: { available: () => false, active: () => undefined, target: () => undefined, open() {} },
  })
  contribution!.register(owner("old"))
  route.pathname = sessionHref(target, "new")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["old"] })
  await waitFor(() => tabs!.store.length === 1)
  expect(tabs!.store).toEqual([saved[1]])
  expect(navigations).toEqual([])

  // A not-yet-hydrated child route also rejects the preceding owner's root key.
  tabs!.addSessionTab({ server: target, sessionId: "old" })
  route.pathname = sessionHref(target, "new-child")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["old"] })
  await waitFor(() => tabs!.store.length === 1)
  expect(navigations).toEqual([])

  // Once the child publishes its actual root, removing that root still navigates.
  tabs!.addSessionTab({ server: target, sessionId: "old" })
  contribution!.register(owner("new-child"))
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["old"] })
  await waitFor(() => tabs!.store.length === 1)
  expect(tabs!.store).toEqual([saved[1]])
  expect(navigations).toEqual([sessionHref(target, "new")])
})

test("session removal uses the event server and canonical route while preserving other servers and drafts", async () => {
  const target = ServerConnection.Key.make("http://127.0.0.1:4096")
  const other = ServerConnection.Key.make("http://127.0.0.1:4097")
  const saved: Tab[] = [
    { type: "session", server: ServerConnection.Key.make("http://localhost:4096/"), sessionId: "shared" },
    { type: "session", server: other, sessionId: "shared" },
    { type: "session", server: target, sessionId: "next" },
    { type: "draft", server: target, draftID: "draft", directory: "/repo", mode: "coding" },
  ]
  storage.setItem("tabs", JSON.stringify(saved))
  storage.setItem("tabs.recent", JSON.stringify({ key: tabKey(saved[0]) }))
  storage.removeItem("server")
  const cleaned: string[] = []
  let tabs: ReturnType<typeof useTabs> | undefined
  let server: ReturnType<typeof useServer> | undefined
  function Probe() {
    tabs = useTabs()
    server = useServer()
    saved.forEach((tab) =>
      tabs!.state(tab, "prompt", () => {
        onCleanup(() => cleaned.push(tabKey(tab)))
        return { text: "unsent" }
      }),
    )
    return null
  }
  dispose = renderTabs(
    [
      { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4098" } },
      { type: "http", http: { url: target } },
      { type: "http", http: { url: other } },
    ],
    Probe,
  )
  await waitFor(() => !!tabs?.ready() && tabs.recentReady())
  expect(server?.key).toBe(ServerConnection.Key.make("sidecar"))

  // A background archive must preserve the same Session ID on the routed server.
  route.pathname = sessionHref(other, "shared")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["shared"] })
  await waitFor(() => tabs!.store.length === 3)
  expect(tabs!.store).toEqual(saved.slice(1))
  expect(navigations).toEqual([])
  expect(cleaned).toEqual([tabKey(saved[0])])
  expect(JSON.parse(storage.getItem("tabs.recent")!)).toEqual({})

  // A legacy spelling in the URL still identifies the target server's live tab.
  tabs!.addSessionTab({ server: target, sessionId: "shared" })
  route.pathname = sessionHref(ServerConnection.Key.make("http://localhost:4096/"), "shared")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["shared"] })
  await waitFor(() => tabs!.store.length === 3)
  expect(navigations).toEqual([sessionHref(target, "next")])
  expect(tabs!.store).toEqual(saved.slice(1))

  route.pathname = sessionHref(target, "next")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["next"] })
  await waitFor(() => tabs!.store.length === 2)
  expect(navigations.at(-1)).toBe(sessionHref(other, "shared"))
  expect(cleaned).toEqual([tabKey(saved[0]), tabKey(saved[2])])

  route.pathname = sessionHref(other, "shared")
  tabs!.removeSessions({ server: other, directory: "/repo", sessionIDs: ["shared"] })
  await waitFor(() => tabs!.store.length === 1)
  expect(tabs!.store).toEqual([saved[3]])
  expect(navigations.at(-1)).toBe("/")
  expect(cleaned).toEqual([tabKey(saved[0]), tabKey(saved[2]), tabKey(saved[1])])

  // Timeline mutations own their destination even if the old route is still visible.
  const managed = tabs!.addSessionTab({ server: target, sessionId: "managed" })
  tabs!.state(managed, "prompt", () => {
    onCleanup(() => cleaned.push(tabKey(managed)))
    return { text: "unsent" }
  })
  tabs!.remember(managed)
  route.pathname = sessionHref(target, "managed")
  tabs!.removeSessions({ server: target, directory: "/repo", sessionIDs: ["managed"], navigate: false })
  await waitFor(() => tabs!.store.length === 1)
  expect(tabs!.store).toEqual([saved[3]])
  expect(navigations).toEqual([sessionHref(target, "next"), sessionHref(other, "shared"), "/"])
  expect(cleaned.at(-1)).toBe(tabKey(managed))
  expect(JSON.parse(storage.getItem("tabs.recent")!)).toEqual({})
})
