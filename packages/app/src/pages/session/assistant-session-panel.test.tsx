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

  test("B zone uses the shell default project FileTree (no explicit fileTree)", () => {
    expect(panel).not.toContain("fileTree=")
    expect(read("../../components/session-right-panel.tsx")).toContain("FileTree")
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

/**
 * S7 replaced the four hand-written mode slots with one `modePanel(id, children)` helper, so the
 * per-mode inline-style literals these cases used to match no longer exist. What they protected is
 * the slot MODEL — every mode renders together and visibility is `display`, not a `Show` that
 * would unmount the owner — and that is what is asserted here. The behaviour itself (mounted at
 * both widths, reachable at 390 and at real 200% zoom, tab surviving a desktop↔narrow round trip)
 * is asserted in `e2e/regression/mode-slot-fallback-a11y.spec.ts` and `e2e/zoom/`, where it can
 * actually fail; a source check cannot see a mount.
 */
describe("SessionSidePanel mode slots (batch 1 G2, reshaped by S7)", () => {
  test("renders AssistantSessionPanel instead of the placeholder", () => {
    expect(sidePanel).toContain("<AssistantSessionPanel />")
    expect(sidePanel).not.toContain("<PlaceholderPanel")
  })

  test("keeps every mode panel mounted and toggles it by display, never per-mode unmount", () => {
    expect(sidePanel).toContain("const modePanel = (id: string, children: JSX.Element)")
    for (const mode of ["chat", "work", "assistant", "custom"]) {
      // Whitespace-tolerant: the custom slot's children are long enough that the formatter wraps
      // the call onto its own line, which a literal match would miss for the wrong reason.
      expect(sidePanel, `${mode} is rendered through the shared slot`).toMatch(new RegExp(`modePanel\\(\\s*"${mode}"`))
    }
    expect(sidePanel).toContain(
      'style={{ display: mode.currentMode === id && (isDesktop() || mode.contentPanelOpen) ? "" : "none" }}',
    )
  })

  test("the mode slot fills the remaining width when docked", () => {
    expect(sidePanel).toContain('"flex-1 min-w-0": isDesktop()')
  })

  test("no slot renders a FileTree or the review panel of its own", () => {
    const start = sidePanel.indexOf("const modePanel =")
    const body = sidePanel.slice(start, sidePanel.indexOf("return (", start))
    expect(body).not.toContain("FileTree")
    expect(body).not.toContain("reviewPanel")
  })
})
