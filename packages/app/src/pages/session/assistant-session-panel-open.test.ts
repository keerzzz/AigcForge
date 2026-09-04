import { describe, expect, test } from "bun:test"
import { openEntityPanel, type AssistantPanelHandle, type AssistantPanelTab } from "./assistant-session-panel-open"
// The shared panel shapes are owned by the utils layer, not by this page: the context
// layer needs them and must not import upward. Naming them here is the check — the
// import fails typecheck if the ownership moves back. The direction itself is enforced
// by the `no-restricted-imports` override for `packages/app/src/context/**`, which
// replaces the `toContain` assertions on `layout.tsx`'s source text that used to live
// at the bottom of this file.
import type { AssistantPanelState, AssistantPanelTab as UtilsPanelTab } from "@/utils/assistant-panel"

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

describe("panel types location", () => {
  test("the page's tab union is the one utils owns", () => {
    // A type-level assertion, so it is `tsgo` that fails if the page starts
    // declaring its own union again: both directions must be assignable.
    const fromUtils: UtilsPanelTab = "reminders"
    const fromPage: AssistantPanelTab = fromUtils
    const backToUtils: UtilsPanelTab = fromPage
    const state: AssistantPanelState = { target: "item-reminders" }
    expect(backToUtils).toBe("reminders")
    expect(state.target).toBe("item-reminders")
  })
})
