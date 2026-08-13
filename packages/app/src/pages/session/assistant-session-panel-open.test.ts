import { describe, expect, test } from "bun:test"
import {
  openEntityPanel,
  toggleEntityPanel,
  type AssistantPanelHandle,
  type AssistantPanelTab,
} from "./assistant-session-panel-open"

// 批次 1 §3.1 D3：openEntityPanel 信号（对齐 open-session-context.ts 纯函数模式）。
// 面板状态访问器是注入的 handle（layout store 提供），此处只测状态迁移逻辑。

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
