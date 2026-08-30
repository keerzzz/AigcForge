import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Phase 3a source-contract tests: SessionFileTabStrip owns the shared DragDrop tab
// surface (SortableProvider/SortableTab/DragOverlay/createFileTabListSync + drag state).
// It must NOT own Chat/Coding leading tabs, active fallback, review content, or file tree.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("SessionFileTabStrip (shared drag tab surface)", () => {
  test("exports the SessionFileTabStrip component", () => {
    expect(read("file-tab-strip.tsx")).toContain("export function SessionFileTabStrip")
  })

  test("owns the DragDrop surface and drag state", () => {
    const strip = read("file-tab-strip.tsx")
    expect(strip).toContain("DragDropProvider")
    expect(strip).toContain("DragDropSensors")
    expect(strip).toContain("handleDragStart")
    expect(strip).toContain("activeDraggable")
  })

  test("owns SortableProvider/SortableTab/DragOverlay/createFileTabListSync", () => {
    const strip = read("file-tab-strip.tsx")
    expect(strip).toContain("<SortableProvider")
    expect(strip).toContain("<SortableTab")
    expect(strip).toContain("<DragOverlay")
    expect(strip).toContain("createFileTabListSync")
  })

  test("exposes the minimal contract props (openedTabs/contextOpen/onClose/onMove/renderLeading/renderTrailing?/renderOverlay/children)", () => {
    const strip = read("file-tab-strip.tsx")
    expect(strip).toContain("openedTabs")
    expect(strip).toContain("contextOpen")
    expect(strip).toContain("onClose")
    expect(strip).toContain("onMove")
    expect(strip).toContain("renderLeading")
    expect(strip).toContain("renderTrailing")
    expect(strip).toContain("renderOverlay")
    expect(strip).toContain("children")
  })

  test("does not own Chat/Coding leading tabs, active fallback, or file-tree business", () => {
    const strip = read("file-tab-strip.tsx")
    expect(strip).not.toContain('value="preview"')
    expect(strip).not.toContain('value="review"')
    expect(strip).not.toContain("<FileTree")
  })

  test("session-side-panel consumes SessionFileTabStrip and keeps its own TabsV2 active state", () => {
    const side = read("session-side-panel.tsx")
    expect(side).toContain("<SessionFileTabStrip")
    expect(side).toContain("SessionFileTabStrip")
    expect(side).toContain("value={activeTab()}")
  })

  test("chat-right-panel consumes SessionFileTabStrip", () => {
    expect(read("../../components/chat/chat-right-panel.tsx")).toContain("<SessionFileTabStrip")
  })
})
