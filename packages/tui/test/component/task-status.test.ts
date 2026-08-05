import { describe, expect, test } from "bun:test"
import { formatNextRun, taskStatusStyle } from "../../src/component/task-status"

describe("taskStatusStyle", () => {
  // Explicit six-state mapping: every task status resolves to a marker/color
  // pair. Unknown statuses must not silently fall through to a default style.
  test("maps pending to a muted empty marker", () => {
    expect(taskStatusStyle("pending")).toEqual({ marker: " ", color: "textMuted" })
  })

  test("maps in_progress to a warning bullet", () => {
    expect(taskStatusStyle("in_progress")).toEqual({ marker: "•", color: "warning" })
  })

  test("maps completed to a success check", () => {
    expect(taskStatusStyle("completed")).toEqual({ marker: "✓", color: "success" })
  })

  test("maps cancelled to a muted cross", () => {
    expect(taskStatusStyle("cancelled")).toEqual({ marker: "✕", color: "textMuted" })
  })

  test("maps failed to an error cross", () => {
    expect(taskStatusStyle("failed")).toEqual({ marker: "✕", color: "error" })
  })

  test("maps scheduled to an accent bolt", () => {
    expect(taskStatusStyle("scheduled")).toEqual({ marker: "⚡", color: "accent" })
  })

  test("returns undefined for unknown statuses instead of a default style", () => {
    expect(taskStatusStyle("unknown")).toBeUndefined()
  })
})

describe("formatNextRun", () => {
  test("formats a timestamp as a non-empty readable string", () => {
    const formatted = formatNextRun(1700000000000)
    expect(typeof formatted).toBe("string")
    expect(formatted.length).toBeGreaterThan(0)
  })
})
