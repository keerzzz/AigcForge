import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import {
  openEntityPanel,
  toggleEntityPanel,
  type AssistantPanelHandle,
  type AssistantPanelTab,
} from "./assistant-session-panel-open"

// Batch 1 §3.1 D3: openEntityPanel follows the pure state-transition pattern
// used by open-session-context.ts. The layout store is injected as a handle,
// so this file only tests state transitions.

function fakeHandle(initial: { opened?: boolean; tab?: AssistantPanelTab; target?: string } = {}) {
  let state = { opened: initial.opened ?? false, tab: initial.tab ?? ("reminders" as AssistantPanelTab), target: initial.target }
  const handle: AssistantPanelHandle = {
    opened: () => state.opened,
    tab: () => state.tab,
    target: () => state.target,
    open: (tab, target) => {
      state = { opened: true, tab, target }
    },
    close: () => {
      state = { ...state, opened: false }
    },
  }
  return { handle, read: () => state }
}

const TABS: AssistantPanelTab[] = ["reminders", "memory", "kb", "editor", "context"]

describe("openEntityPanel", () => {
  test("opens the panel on the given tab with the item target", () => {
    const { handle, read } = fakeHandle()
    openEntityPanel(handle, "kb", "kb_123")
    expect(read()).toEqual({ opened: true, tab: "kb", target: "kb_123" })
  })

  test("re-targets an already-open panel to a different tab", () => {
    const { handle, read } = fakeHandle({ opened: true, tab: "memory", target: "mem_1" })
    openEntityPanel(handle, "reminders", "sch_9")
    expect(read()).toEqual({ opened: true, tab: "reminders", target: "sch_9" })
  })

  test("opens with an undefined target when the item id is omitted", () => {
    const { handle, read } = fakeHandle()
    openEntityPanel(handle, "context")
    expect(read()).toEqual({ opened: true, tab: "context", target: undefined })
  })

  test("covers all five tabs of the assistant panel", () => {
    for (const tab of TABS) {
      const { handle, read } = fakeHandle()
      openEntityPanel(handle, tab, `item-${tab}`)
      expect(read().tab).toBe(tab)
      expect(read().opened).toBe(true)
    }
  })
})

describe("toggleEntityPanel", () => {
  test("closes the panel when the same tab is already active", () => {
    const { handle, read } = fakeHandle({ opened: true, tab: "context" })
    toggleEntityPanel(handle, "context")
    expect(read().opened).toBe(false)
  })

  test("opens the tab when another tab is active", () => {
    const { handle, read } = fakeHandle({ opened: true, tab: "reminders" })
    toggleEntityPanel(handle, "context")
    expect(read()).toEqual({ opened: true, tab: "context", target: undefined })
  })

  test("opens the tab when the panel is closed", () => {
    const { handle, read } = fakeHandle()
    toggleEntityPanel(handle, "context")
    expect(read()).toEqual({ opened: true, tab: "context", target: undefined })
  })
})

describe("panel types location (LOW-1: context layer must not import pages)", () => {
  const layout = fs.readFileSync(path.resolve(__dirname, "../../context/layout.tsx"), "utf-8")
  const utils = fs.readFileSync(path.resolve(__dirname, "../../utils/assistant-panel.ts"), "utf-8")

  test("layout imports the panel types from utils", () => {
    expect(layout).toContain('from "@/utils/assistant-panel"')
  })

  test("layout no longer imports from the pages layer", () => {
    expect(layout).not.toContain('from "@/pages/session/assistant-session-panel-open"')
  })

  test("utils/assistant-panel owns the shared tab and state types", () => {
    expect(utils).toContain("export type AssistantPanelTab")
    expect(utils).toContain("export type AssistantPanelState")
  })
})
