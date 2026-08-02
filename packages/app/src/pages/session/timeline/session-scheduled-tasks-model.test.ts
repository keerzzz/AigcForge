import { describe, expect, test } from "bun:test"
import {
  formatFullTime,
  formatNextRun,
  isScheduledActive,
  isScheduledTask,
  nextScheduledRun,
  scheduledToggleStatus,
} from "./session-scheduled-tasks-model"

const base = { id: "tsk_x", content: "job", priority: "medium" as const }

describe("isScheduledTask", () => {
  test("one-shot scheduledAt counts", () => {
    expect(isScheduledTask({ ...base, status: "scheduled", scheduledAt: 1700000000000 })).toBe(true)
  })

  test("recurrence counts even without scheduledAt", () => {
    expect(
      isScheduledTask({ ...base, status: "scheduled", recurrence: { cron: "0 9 * * *", enabled: true } }),
    ).toBe(true)
  })

  test("plain task does not count", () => {
    expect(isScheduledTask({ ...base, status: "pending" })).toBe(false)
  })

  test("non-finite scheduledAt does not count", () => {
    expect(isScheduledTask({ ...base, status: "scheduled", scheduledAt: "NaN" })).toBe(false)
  })
})

describe("nextScheduledRun", () => {
  test("picks the smallest nextRun among scheduled/pending tasks", () => {
    expect(
      nextScheduledRun([
        { ...base, id: "a", status: "scheduled", nextRun: 3000 },
        { ...base, id: "b", status: "pending", nextRun: 1000 },
        { ...base, id: "c", status: "scheduled", nextRun: 2000 },
      ]),
    ).toBe(1000)
  })

  test("terminal statuses and missing/non-finite nextRun drop out", () => {
    expect(
      nextScheduledRun([
        { ...base, id: "a", status: "cancelled", nextRun: 1000 },
        { ...base, id: "b", status: "completed", nextRun: 500 },
        { ...base, id: "c", status: "scheduled" },
        { ...base, id: "d", status: "scheduled", nextRun: "NaN" },
      ]),
    ).toBeUndefined()
  })

  test("empty input yields undefined", () => {
    expect(nextScheduledRun([])).toBeUndefined()
  })
})

describe("pause/resume status mapping", () => {
  test("scheduled and pending are active", () => {
    expect(isScheduledActive("scheduled")).toBe(true)
    expect(isScheduledActive("pending")).toBe(true)
    expect(isScheduledActive("cancelled")).toBe(false)
    expect(isScheduledActive("completed")).toBe(false)
  })

  test("toggle maps to the task_schedule semantics", () => {
    expect(scheduledToggleStatus(true)).toBe("scheduled")
    expect(scheduledToggleStatus(false)).toBe("cancelled")
  })
})

describe("formatNextRun", () => {
  const intl = "en"

  test("same-day run shows time only", () => {
    const now = new Date(2026, 7, 2, 8, 0, 0).getTime()
    const run = new Date(2026, 7, 2, 9, 30, 0).getTime()
    expect(formatNextRun(run, intl, now)).toBe(
      new Intl.DateTimeFormat(intl, { hour: "numeric", minute: "2-digit" }).format(new Date(run)),
    )
  })

  test("later day adds the short weekday", () => {
    const now = new Date(2026, 7, 2, 8, 0, 0).getTime()
    const run = new Date(2026, 7, 3, 9, 30, 0).getTime()
    expect(formatNextRun(run, intl, now)).toBe(
      new Intl.DateTimeFormat(intl, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(run)),
    )
  })

  test("same instant on another day is not same-day", () => {
    const now = new Date(2026, 7, 2, 23, 59, 0).getTime()
    const run = new Date(2026, 7, 3, 0, 1, 0).getTime()
    expect(formatNextRun(run, intl, now)).not.toBe(
      new Intl.DateTimeFormat(intl, { hour: "numeric", minute: "2-digit" }).format(new Date(run)),
    )
  })
})

describe("formatFullTime", () => {
  test("renders a medium date with short time", () => {
    const run = new Date(2026, 7, 3, 9, 30, 0).getTime()
    expect(formatFullTime(run, "en")).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run)),
    )
  })
})
