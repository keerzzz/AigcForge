import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Batch 1 G1/F4: ReminderList, MemoryInspector, and DeliveryList are shared by
// the dashboard and the session panel. The dashboard remains the regression gate.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const lists = read("assistant-entity-lists.tsx")
const dashboard = read("../pages/assistant-dashboard.tsx")

describe("assistant-entity-lists (shared components, batch 1 G1)", () => {
  test("exports ReminderList, MemoryInspector and DeliveryList", () => {
    expect(lists).toContain("export function ReminderList")
    expect(lists).toContain("export function MemoryInspector")
    expect(lists).toContain("export function DeliveryList")
  })

  test("shared rows keep the dashboard row rendering (count, content, due · timezone, cancel)", () => {
    expect(lists).toContain('language.t("assistant.dashboard.pendingCount"')
    expect(lists).toContain("formatDueAt(reminder.dueAt)")
    expect(lists).toContain('reminder.timezone ?? ""')
    expect(lists).toContain("assistant.dashboard.cancelReminder")
    expect(lists).toContain("assistant.dashboard.markRead")
    expect(lists).toContain("assistant.dashboard.caughtUp")
  })

  test("MemoryInspector keeps pending/confirmed groups with confirm/reject/remove actions", () => {
    expect(lists).toContain('language.t("assistant.memory.pending")')
    expect(lists).toContain('language.t("assistant.memory.confirmed")')
    expect(lists).toContain('language.t("assistant.memory.confirm")')
    expect(lists).toContain('language.t("assistant.memory.reject")')
    expect(lists).toContain('language.t("assistant.memory.delete")')
  })

  test("status badge is opt-in so the dashboard markup stays unchanged", () => {
    expect(lists).toContain("showStatus")
    expect(lists).toContain("assistant.reminder.status")
  })

  test("openEntityPanel targets render data-targeted highlights on matching rows", () => {
    expect(lists).toContain("targetId?: string")
    expect(lists).toContain('data-targeted={reminder.id === props.targetId ? "" : undefined}')
    expect(lists).toContain('data-targeted={memory.id === props.targetId ? "" : undefined}')
  })
})

describe("assistant-dashboard (F4 regression gate: extraction must not change behavior)", () => {
  test("dashboard consumes the shared components instead of inlining lists", () => {
    expect(dashboard).toContain('from "@/components/assistant-entity-lists"')
    expect(dashboard).toContain("<ReminderList")
    expect(dashboard).toContain("<MemoryInspector")
    expect(dashboard).toContain("<DeliveryList")
  })

  test("dashboard sections keep their headers and show-conditions", () => {
    expect(dashboard).toContain('language.t("assistant.dashboard.reminders")')
    expect(dashboard).toContain('language.t("assistant.dashboard.recent")')
    expect(dashboard).toContain('language.t("assistant.memory.title")')
    expect(dashboard).toContain("recent().length > 0")
    expect(dashboard).toContain("memories().length > 0")
  })

  test("dashboard no longer inlines the old row markup", () => {
    expect(dashboard).not.toContain("formatDue(")
  })
})
