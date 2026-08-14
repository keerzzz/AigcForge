import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Batch 1 G2: AssistantSessionPanel structure, slot wiring, and layout contract.
// The app has no solid-testing-library, so wiring is checked at source level;
// state transitions are covered by assistant-session-panel-open.test.ts.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const panel = read("assistant-session-panel.tsx")
const sidePanel = read("session-side-panel.tsx")

describe("AssistantSessionPanel (right panel, batch 1 G2)", () => {
  test("exports the AssistantSessionPanel component", () => {
    expect(panel).toContain("export function AssistantSessionPanel")
  })

  test("renders the four entity tabs behind i18n keys", () => {
    for (const key of [
      "assistant.panel.tab.reminders",
      "assistant.panel.tab.memory",
      "assistant.panel.tab.kb",
      "assistant.panel.tab.editor",
    ]) {
      expect(panel).toContain(`label: "${key}"`)
    }
    expect(panel).toContain("language.t(item.label)")
  })

  test("renders the context tab via the shared trigger and closes it via the session tab store", () => {
    expect(panel).toContain("<SessionContextTabTrigger")
    expect(panel).toContain('closeTab("context")')
  })

  test("delegates open/close to the SessionRightPanel shell instead of owning width", () => {
    expect(panel).toContain("<SessionRightPanel")
    expect(panel).not.toContain('width: opened() ? "auto" : "0px"')
  })

  test("renders a project FileTree in the B zone (matching work)", () => {
    expect(panel).toContain("<FileTree")
  })

  test("closes entity tabs individually (closeButton wiring)", () => {
    expect(panel).toContain("closeButton")
    expect(panel).toContain("tabs().close")
  })

  test("reuses the shared entity lists and the context tab", () => {
    expect(panel).toContain("<ReminderList")
    expect(panel).toContain("<MemoryInspector")
    expect(panel).toContain("<DeliveryList")
    expect(panel).toContain("<SessionContextTab")
  })

  test("reminders tab sources session-scoped schedule.list + delivery.inbox", () => {
    expect(panel).toContain("client.schedule.list")
    expect(panel).toContain("client.delivery.inbox")
  })

  test("targets entities through openEntityPanel state (targetId to lists)", () => {
    expect(panel).toContain("target()")
    expect(panel).toContain("targetId={target()}")
  })
})

describe("SessionSidePanel assistant slot (batch 1 G2)", () => {
  test("renders AssistantSessionPanel instead of the placeholder", () => {
    expect(sidePanel).toContain("<AssistantSessionPanel")
    expect(sidePanel).not.toContain("<PlaceholderPanel")
  })

  test("keeps the render-all + display:none slot model for assistant", () => {
    expect(sidePanel).toContain('mode.currentMode === "assistant"')
    expect(sidePanel).toContain('style={{ display: mode.currentMode === "assistant" ? "" : "none" }}')
  })

  test("the assistant slot fills the remaining width (flex-1, matching chat/work)", () => {
    const slotStart = sidePanel.indexOf('mode.currentMode === "assistant"')
    const slot = sidePanel.slice(slotStart, slotStart + 600)
    expect(slot).toContain("flex-1 min-w-0")
  })

  test("the assistant slot contains no fileTree rendering (no B-zone empty placeholder)", () => {
    const slotStart = sidePanel.indexOf('mode.currentMode === "assistant"')
    const slot = sidePanel.slice(slotStart, slotStart + 600)
    expect(slot).not.toContain("FileTree")
    expect(slot).not.toContain("reviewPanel")
  })
})
