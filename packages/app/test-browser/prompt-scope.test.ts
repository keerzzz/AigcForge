import { expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import { createTabComposerState, selectPromptTab, type ComposerState } from "@/composer/persistence"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import { createTabMemory } from "@/shell/tabs/memory"
import { ServerScope } from "@/runtime/server/scope"
import { createDraftStore } from "@/runtime/persistence/drafts"
import type { Platform } from "@/runtime/platform/platform"

test("selects the explicitly scoped session tab instead of the active tab", () => {
  const server = ServerConnection.Key.make("local")

  const tabs: Tab[] = [
    { type: "session", server, sessionId: "A" },
    { type: "session", server, sessionId: "B" },
  ]

  expect(selectPromptTab(tabs, { dir: "repo", id: "B" }, server)).toBe(tabs[1])
})

test("selects a server-scoped child without requiring an open Shell", () => {
  const server = ServerConnection.Key.make("first")
  const targetServer = ServerConnection.Key.make("second")
  const tabs: Tab[] = [{ type: "session", server, sessionId: "B" }]

  expect(selectPromptTab(tabs, { dir: "repo", id: "B" }, targetServer)).toEqual({
    type: "session",
    server: targetServer,
    sessionId: "B",
  })
})

test("selects a draft only from its requested server", () => {
  const server = ServerConnection.Key.make("first")
  const targetServer = ServerConnection.Key.make("second")

  const tabs: Tab[] = [
    { type: "draft", server, draftID: "draft", directory: "/first" },
    { type: "draft", server: targetServer, draftID: "draft", directory: "/second" },
  ]

  expect(selectPromptTab(tabs, { draftID: "draft" }, targetServer)).toBe(tabs[1])
})

test("isolates a child Composer by server and Location while reusing the same target", async () => {
  const documents = new Map<string, string>()

  const platform: Platform = {
    platform: "web",
    openExternal: () => undefined,
    restart: async () => undefined,
    notify: async () => undefined,
    draftStore: createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => {
        documents.set(key, value)

        return []
      },
      remove: async (key) => void documents.delete(key),
      putBlob: async () => "unused",
      getBlob: async () => null,
    }),
  }

  const root = createRoot((dispose) => {
    const memory = createTabMemory<ComposerState>(getOwner())
    onCleanup(memory.dispose)

    return {
      dispose,
      tabs: {
        state(tab: Tab, name: string, init: () => ComposerState) {
          return memory.ensure(tabKey(tab), name, init)
        },
      },
    }
  })

  const server = ServerConnection.Key.make("first")
  const otherServer = ServerConnection.Key.make("second")
  const tab: Tab = { type: "session", server, sessionId: "B" }
  const scope = { dir: "cmVwby1h", id: "B" }
  const first = createTabComposerState(root.tabs, tab, ServerScope.fromServerKey(server), scope, undefined, platform)

  const moved = createTabComposerState(
    root.tabs,
    tab,
    ServerScope.fromServerKey(server),
    { ...scope, dir: "cmVwby1i" },
    undefined,
    platform,
  )

  const other = createTabComposerState(
    root.tabs,
    { ...tab, server: otherServer },
    ServerScope.fromServerKey(otherServer),
    scope,
    undefined,
    platform,
  )

  await Promise.all([first.ready.promise, moved.ready.promise, other.ready.promise])
  expect(moved).not.toBe(first)
  expect(other).not.toBe(first)

  first.set([{ type: "text", content: "first", start: 0, end: 5 }], 3)
  moved.set([{ type: "text", content: "moved", start: 0, end: 5 }], 2)
  moved.model.set({ providerID: "provider", modelID: "moved-model" })
  moved.context.add({ type: "file", path: "src/moved.ts" })
  expect(first.current()[0]).toMatchObject({ type: "text", content: "first" })
  expect(first.cursor()).toBe(3)
  expect(first.model.current()).toBeUndefined()
  expect(first.context.items()).toEqual([])
  expect(moved.current()[0]).toMatchObject({ type: "text", content: "moved" })
  expect(moved.cursor()).toBe(2)
  expect(moved.model.current()).toEqual({ providerID: "provider", modelID: "moved-model" })
  expect(moved.context.items()).toHaveLength(1)
  expect(moved.context.items()[0]).toMatchObject({ type: "file", path: "src/moved.ts" })
  expect(other.current()[0]).toMatchObject({ type: "text", content: "" })
  expect(createTabComposerState(root.tabs, tab, ServerScope.fromServerKey(server), scope, undefined, platform)).toBe(
    first,
  )
  root.dispose()
})
