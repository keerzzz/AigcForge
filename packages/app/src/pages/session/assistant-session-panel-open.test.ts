import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { openEntityPanel, type AssistantPanelHandle, type AssistantPanelTab } from "./assistant-session-panel-open"

// openEntityPanel follows the same pure state-transition pattern as
// open-session-context.ts; the layout handles are injected so this file only
// tests transitions.

function fake(initial: { target?: string } = {}) {
  let target = initial.target
  let opened = false
  let active: string | undefined
  const openedTabs: string[] = []
  const handle: AssistantPanelHandle = {
    target: () => target,
    setTarget: (next) => {
      target = next
    },
  }
  const view = {
    reviewPanel: {
      open: () => {
        opened = true
      },
    },
  }
  const tabs = {
    open: (tab: string) => {
      openedTabs.push(tab)
    },
    setActive: (tab: string | undefined) => {
      active = tab
    },
  }
  return { handle, view, tabs, read: () => ({ opened, target, active, openedTabs }) }
}

const TABS: AssistantPanelTab[] = ["reminders", "memory", "kb", "editor"]

describe("openEntityPanel", () => {
  test("reveals the panel, opens and activates the tab, and targets the item", () => {
    const f = fake()
    openEntityPanel({ view: f.view, tabs: f.tabs, assistant: f.handle, kind: "kb", itemId: "kb_123" })
    expect(f.read()).toEqual({ opened: true, target: "kb_123", active: "kb", openedTabs: ["kb"] })
  })

  test("targets undefined when the item id is omitted", () => {
    const f = fake()
    openEntityPanel({ view: f.view, tabs: f.tabs, assistant: f.handle, kind: "reminders" })
    expect(f.read().target).toBeUndefined()
    expect(f.read().active).toBe("reminders")
  })

  test("covers all four entity tabs", () => {
    for (const tab of TABS) {
      const f = fake()
      openEntityPanel({ view: f.view, tabs: f.tabs, assistant: f.handle, kind: tab, itemId: `item-${tab}` })
      expect(f.read().active).toBe(tab)
      expect(f.read().opened).toBe(true)
    }
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

  test("utils/assistant-panel owns the shared entity tab and state types", () => {
    expect(utils).toContain("export type AssistantPanelTab")
    expect(utils).toContain("export type AssistantPanelState")
  })
})
