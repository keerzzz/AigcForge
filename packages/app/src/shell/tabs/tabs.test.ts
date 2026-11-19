import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./memory"
import {
  listClosedTabs,
  nextTabAfterClose,
  pushClosedTab,
  removeClosedTabs,
  takeClosedTab,
  type ClosedTab,
} from "./closed"
import { findSessionTab, sessionIDHasOpenTab, tabHref, tabKey, type SessionTab, type Tab } from "./tabs"
import { Schema } from "effect"
import { TabStorage } from "./schema"
import { ServerConnection } from "@/runtime/server/registry"
import { Persistence } from "@/runtime/persistence/schema"

const server = ServerConnection.Key.make("local\nhttp://localhost:4096")

const decodeTabs = Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Tabs, []))

function sessionTab(sessionId: string): SessionTab {
  return { type: "session", server, sessionId }
}

describe("tab migration", () => {
  test("round trips a captured draft Location beside an older draft", () => {
    const legacy: Tab = { type: "draft", draftID: "legacy-location", server, directory: "/project" }

    const captured: Tab = {
      ...legacy,
      draftID: "captured-location",
      mode: "chat",
      directory: "/project/nested",
      location: { directory: "/project/nested", workspaceID: "wrk_capture" },
      worktree: "/project/nested",
    }

    expect(decodeTabs(Schema.encodeSync(TabStorage.Tabs)([legacy, captured]))).toEqual([legacy, captured])
    expect(Object.hasOwn(decodeTabs([legacy])[0]!, "location")).toBe(false)
  })

  test("round trips draft MCP choices without changing older drafts", () => {
    const legacy: Tab = { type: "draft", draftID: "legacy-draft", server, directory: "/project" }

    const draft: Tab = {
      ...legacy,
      draftID: "mcp-draft",
      mode: "work",
      worktree: "create",
      mcp: { target: "new-worktree", states: { first: true, second: false } },
    }

    const restored = decodeTabs([legacy, draft])
    expect(restored).toEqual([legacy, draft])
    expect(decodeTabs(Schema.encodeSync(TabStorage.Tabs)(restored))).toEqual([legacy, draft])
  })

  test("defaults only an omitted draft mode to coding", () => {
    const draft = { type: "draft" as const, draftID: "legacy-mode", server, directory: "/project" }
    const restored = decodeTabs([draft])[0]

    expect(restored).toEqual(draft)
    expect(Object.hasOwn(restored!, "mode")).toBe(false)
    expect(TabStorage.genericMode(restored?.type === "draft" ? restored : undefined)).toBe("coding")
    expect(TabStorage.genericMode(undefined)).toBeUndefined()
    expect(TabStorage.genericMode({ ...draft, mode: undefined })).toBeUndefined()
  })

  test.each(["chat", "coding", "work", "assistant"] as const)("round trips a %s draft mode", (mode) => {
    const draft = { type: "draft" as const, draftID: "generic-mode", server, directory: "/project", mode }
    const restored = decodeTabs(JSON.parse(JSON.stringify(Schema.encodeSync(TabStorage.Tabs)([draft]))))

    expect(restored).toEqual([draft])
    expect(TabStorage.genericMode(restored[0]?.type === "draft" ? restored[0] : undefined)).toBe(mode)
  })

  test.each([
    { name: "custom", mode: "custom" },
    { name: "unknown", mode: "future-mode" },
    { name: "empty", mode: "" },
    { name: "padded", mode: " chat " },
    { name: "null", mode: null },
    { name: "number", mode: 1 },
    { name: "boolean", mode: false },
    { name: "array", mode: ["chat"] },
    { name: "object", mode: { id: "chat" } },
  ])("preserves an unsupported $name draft mode for explicit recovery", ({ mode }) => {
    const draft = { type: "draft" as const, draftID: "unsupported-mode", server, directory: "/project", mode }
    const restored = decodeTabs(JSON.parse(JSON.stringify([draft])))

    expect(restored).toEqual([draft])
    expect(TabStorage.genericMode(restored[0]?.type === "draft" ? restored[0] : undefined)).toBeUndefined()
    expect(decodeTabs(JSON.parse(JSON.stringify(Schema.encodeSync(TabStorage.Tabs)(restored))))).toEqual([draft])
  })

  const dropped: { name: string; stored: unknown; expected: Tab[] }[] = [
    {
      name: "null and malformed tabs",
      stored: [null, sessionTab("a"), { type: "session", server }, { type: "unknown", server }, "invalid"],
      expected: [sessionTab("a")],
    },
    { name: "tabs without a server", stored: [{ type: "session", sessionId: "a" }], expected: [] },
    { name: "null top-level data", stored: null, expected: [] },
    { name: "object top-level data", stored: {}, expected: [] },
  ]

  test.each(dropped)("drops $name", ({ stored, expected }) => {
    expect(decodeTabs(stored)).toEqual(expected)
  })

  test("preserves the active child route and drops an invalid one", () => {
    expect(decodeTabs([{ ...sessionTab("root"), routeSessionId: "child", routeParentId: "parent" }])).toEqual([
      { ...sessionTab("root"), routeSessionId: "child", routeParentId: "parent" },
    ])
    expect(decodeTabs([{ ...sessionTab("parent"), routeSessionId: 1 }])).toEqual([sessionTab("parent")])
    expect(decodeTabs([{ ...sessionTab("parent"), routeSessionId: "child", routeParentId: 1 }])).toEqual([
      { ...sessionTab("parent"), routeSessionId: "child" },
    ])
  })

  test("encodes only canonical tabs and preserves drafts", () => {
    const draft: Tab = { type: "draft", server, draftID: "draft", directory: "/project", branch: "main" }

    const tabs = decodeTabs([
      { ...sessionTab("root"), routeSessionId: "root", routeParentId: "stale", legacy: true },
      draft,
    ])

    expect(tabs).toEqual([sessionTab("root"), draft])
    expect(Schema.encodeSync(TabStorage.Tabs)(tabs)).toEqual(tabs)
    expect(decodeTabs(Schema.encodeSync(TabStorage.Tabs)(tabs))).toEqual(tabs)
  })

  test("salvages valid closed session tabs", () => {
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Closed, []))([
        { tab: sessionTab("a"), index: 1 },
        { tab: sessionTab("b"), index: -1 },
        { tab: { type: "draft", server, draftID: "d", directory: "/project" }, index: 0 },
        null,
      ]),
    ).toEqual([{ tab: sessionTab("a"), index: 1 }])
  })

  test("validates auxiliary tab state", () => {
    expect(
      Schema.decodeUnknownSync(Persistence.withInitial(TabStorage.Recent, { key: undefined }))({ key: 1 }),
    ).toEqual({ key: undefined })
    expect(Schema.decodeUnknownSync(TabStorage.Infos)({})).toEqual({})
    expect(Schema.decodeUnknownSync(TabStorage.Regions)({})).toEqual({})
    expect(Schema.decodeUnknownSync(TabStorage.Infos)({ tab: { title: "Title", directory: "/project" } })).toEqual({
      tab: { title: "Title", directory: "/project" },
    })
    const regions = Schema.decodeUnknownSync(TabStorage.Regions)({ tab: { terminal: true, terminalHeight: 300 } })
    expect(regions).toEqual({ tab: { dock: true, dockHeight: 300 } })
    expect(Schema.encodeSync(TabStorage.Regions)(regions)).toEqual({ tab: { terminal: true, terminalHeight: 300 } })
    expect(() => Schema.decodeUnknownSync(TabStorage.Regions)({ tab: { terminal: "yes" } })).toThrow()
  })
})

test("session tab identity stays rooted while its href follows the child route", () => {
  const parent = sessionTab("parent")
  const child = { ...parent, routeSessionId: "child" }

  expect(tabKey(child)).toBe(tabKey(parent))
  expect(tabHref(child)).toContain("/session/child")
})

test("finds open root and routed session tabs", () => {
  const tab = { ...sessionTab("root"), routeSessionId: "child" }
  const tabs = [tab]

  expect(findSessionTab(tabs, server, "root")).toBe(tab)
  expect(findSessionTab(tabs, server, "child")).toBe(tab)
  expect(findSessionTab(tabs, server, "closed")).toBeUndefined()
  expect(sessionIDHasOpenTab(tabs, server, "root")).toBe(true)
  expect(sessionIDHasOpenTab(tabs, server, "child")).toBe(true)
  expect(sessionIDHasOpenTab(tabs, server, "closed")).toBe(false)
  expect(sessionIDHasOpenTab(tabs, ServerConnection.Key.make("other"), "root")).toBe(false)
})

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory<{ value: string }>(getOwner())
      let disposed = 0

      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)

        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get("tab", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })

  test("keeps shared state when a Shell closes and reopens before the last content view releases", () => {
    createRoot((dispose) => {
      const memory = createTabMemory<{ text: string }>(getOwner())
      onCleanup(memory.dispose)
      const key = tabKey(sessionTab("B"))
      const closed: string[] = []
      const releaseShell = memory.retain(key)
      const releaseMain = memory.retain(key)
      const releaseSide = memory.retain(key)

      const state = memory.ensure(key, "prompt", () => {
        onCleanup(() => closed.push("B"))

        return { text: "draft" }
      })

      releaseShell()
      releaseMain()
      state.text = "continued from A"
      expect(memory.get(key, "prompt")).toBe(state)
      expect(closed).toEqual([])

      const releaseReopened = memory.retain(key)
      expect(memory.ensure(key, "prompt", () => ({ text: "replacement" }))).toBe(state)
      expect(memory.get(key, "prompt")?.text).toBe("continued from A")
      releaseShell()
      releaseSide()
      expect(closed).toEqual([])

      releaseReopened()
      expect(closed).toEqual(["B"])
      expect(memory.get(key, "prompt")).toBeUndefined()
      releaseSide()
      releaseReopened()
      expect(closed).toEqual(["B"])
      dispose()
    })
  })

  test("releases state held by an independent content view without a Shell", () => {
    createRoot((dispose) => {
      const memory = createTabMemory<{ text: string }>(getOwner())
      onCleanup(memory.dispose)
      const key = tabKey(sessionTab("child"))
      const closed: string[] = []
      const release = memory.retain(key)

      const state = memory.ensure(key, "prompt", () => {
        onCleanup(() => closed.push("child"))

        return { text: "child prompt" }
      })

      expect(memory.get(key, "prompt")).toBe(state)
      release()
      expect(closed).toEqual(["child"])
      expect(memory.get(key, "prompt")).toBeUndefined()
      dispose()
    })
  })

  test.each(["remove", "dispose"] as const)("ignores old releases after forced %s and replacement", (operation) => {
    createRoot((dispose) => {
      const memory = createTabMemory<{ text: string }>(getOwner())
      onCleanup(memory.dispose)
      const key = tabKey(sessionTab("B"))
      const closed: string[] = []
      const releaseOld = memory.retain(key)
      memory.ensure(key, "prompt", () => {
        onCleanup(() => closed.push("old"))

        return { text: "old" }
      })

      if (operation === "remove") memory.remove(key)

      if (operation === "dispose") memory.dispose()
      expect(closed).toEqual(["old"])

      const releaseCurrent = memory.retain(key)

      const current = memory.ensure(key, "prompt", () => {
        onCleanup(() => closed.push("current"))

        return { text: "current" }
      })

      releaseOld()
      expect(memory.get(key, "prompt")).toBe(current)
      expect(closed).toEqual(["old"])
      releaseCurrent()
      expect(closed).toEqual(["old", "current"])
      dispose()
    })
  })
})

describe("closed tab stack", () => {
  test("records session tabs with their index", () => {
    const stack = pushClosedTab([], sessionTab("a"), 2, {
      title: "Alpha",
      directory: "/project",
      prompted: true,
    })

    expect(stack).toEqual([
      { tab: sessionTab("a"), index: 2, info: { title: "Alpha", directory: "/project", prompted: true } },
    ])
  })

  test("ignores draft tabs", () => {
    const draft: Tab = { type: "draft", draftID: "d1", server, directory: "/tmp" }

    expect(pushClosedTab([], draft, 0)).toEqual([])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, sessionTab(`s${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.sessionId).toBe("s5")
    expect(stack.at(-1)?.tab.sessionId).toBe("s29")
  })

  test("keeps only the newest close record for a session", () => {
    const stack = pushClosedTab(
      pushClosedTab([], sessionTab("a"), 1, { title: "Old", directory: "/old", prompted: true }),
      sessionTab("a"),
      3,
      { title: "New", directory: "/new", prompted: true },
    )

    expect(stack).toEqual([
      { tab: sessionTab("a"), index: 3, info: { title: "New", directory: "/new", prompted: true } },
    ])
  })

  test("pops the most recently closed tab", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    const result = takeClosedTab(stack, [])

    expect(result.entry?.tab.sessionId).toBe("b")
    expect(result.stack).toEqual([{ tab: sessionTab("a"), index: 0 }])
  })

  test("skips entries whose tab is already open", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    const result = takeClosedTab(stack, [sessionTab("b")])

    expect(result.entry?.tab.sessionId).toBe("a")
    expect(result.stack).toEqual([])
  })

  test("lists closed tabs from newest to oldest and excludes open tabs", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
      { tab: sessionTab("c"), index: 2 },
    ]

    expect(listClosedTabs(stack, [sessionTab("b")]).map((entry) => entry.tab.sessionId)).toEqual(["c", "a"])
  })

  test("deduplicates previously stored close records", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
      { tab: sessionTab("a"), index: 2 },
    ]

    expect(listClosedTabs(stack, []).map((entry) => [entry.tab.sessionId, entry.index])).toEqual([
      ["a", 2],
      ["b", 1],
    ])
  })

  test("takes a selected closed tab without removing newer entries", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
      { tab: sessionTab("c"), index: 2 },
    ]

    const result = takeClosedTab(stack, [], sessionTab("a"))

    expect(result.entry?.tab.sessionId).toBe("a")
    expect(result.stack.map((entry) => entry.tab.sessionId)).toEqual(["b", "c"])
  })

  test("returns no entry when everything is open or empty", () => {
    expect(takeClosedTab([], []).entry).toBeUndefined()

    const result = takeClosedTab([{ tab: sessionTab("a"), index: 0 }], [sessionTab("a")])
    expect(result.entry).toBeUndefined()
    expect(result.stack).toEqual([])
  })

  test("purges removed sessions", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(removeClosedTabs(stack, server, ["a"])).toEqual([{ tab: sessionTab("b"), index: 1 }])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(sessionTab("c"))
    expect(nextTabAfterClose([sessionTab("a")], 0, true)).toBeNull()
  })
})
