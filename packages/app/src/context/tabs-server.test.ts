import { afterEach, expect, test } from "bun:test"
import { MemoryRouter, Route } from "@solidjs/router"
import { createComponent, createEffect, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { ServerScope } from "@/utils/server-scope"

import type { Tab } from "./tabs"

const { PlatformProvider } = await import("./platform")
const { ServerConnection, ServerProvider, useServer } = await import("./server")
const { tabKey, TabsProvider, useTabs } = await import("./tabs")
const { Persist, PersistTesting } = await import("@/utils/persist")

const storage = PersistTesting.localStorageWithPrefix(Persist.global("tabs").storage!)
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  ;["tabs", "tabs.recent", "server"].forEach((key) => storage.removeItem(key))
})

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
  const container = document.createElement("div")
  document.body.append(container)
  dispose = render(
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
              return createComponent(MemoryRouter, {
                get children() {
                  return createComponent(Route, {
                    path: "/",
                    component: () =>
                      createComponent(TabsProvider, {
                        get children() {
                          return createComponent(Probe, {})
                        },
                      }),
                  })
                },
              })
            },
          })
        },
      }),
    container,
  )

  await new Promise<void>((resolve) =>
    createRoot((stop) => {
      createEffect(() => {
        if (!tabs?.ready() || !tabs.recentReady()) return
        stop()
        resolve()
      })
    }),
  )
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
