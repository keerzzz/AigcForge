import { describe, expect, test } from "bun:test"
import { nextRun } from "@aigcfroge/core/session/schedule"

// Timestamps are built with local Date so the cron matching (which reads local
// clock fields) is deterministic on any machine timezone.
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe("nextRun", () => {
  test("every minute returns the next minute boundary", () => {
    const from = at(2026, 8, 2, 9, 0)
    expect(nextRun("* * * * *", from)).toBe(from + 60_000)
  })

  test("specific hour returns the next match within the day", () => {
    const from = at(2026, 8, 2, 8, 30)
    expect(nextRun("0 9 * * *", from)).toBe(at(2026, 8, 2, 9, 0))
  })

  test("a past match today rolls forward to tomorrow", () => {
    const from = at(2026, 8, 2, 10, 0)
    expect(nextRun("0 9 * * *", from)).toBe(at(2026, 8, 3, 9, 0))
  })

  test("step expression matches every 5th minute", () => {
    const from = at(2026, 8, 2, 9, 1)
    expect(nextRun("*/5 * * * *", from)).toBe(at(2026, 8, 2, 9, 5))
  })

  test("list expression matches any listed minute", () => {
    const from = at(2026, 8, 2, 9, 1)
    expect(nextRun("5,15,25 * * * *", from)).toBe(at(2026, 8, 2, 9, 5))
  })

  test("range expression matches within the range", () => {
    const from = at(2026, 8, 2, 9, 0)
    expect(nextRun("10-20 10 * * *", from)).toBe(at(2026, 8, 2, 10, 10))
  })

  test("a strict-after match excludes the exact current minute", () => {
    const from = at(2026, 8, 2, 9, 5)
    expect(nextRun("*/5 * * * *", from)).toBe(at(2026, 8, 2, 9, 10))
  })

  test("returns undefined when the cron never matches in the window", () => {
    // 30th of February does not exist.
    expect(nextRun("0 9 30 2 *", at(2026, 8, 2, 9, 0))).toBeUndefined()
  })

  test("an invalid cron expression returns undefined", () => {
    expect(nextRun("not a cron", 0)).toBeUndefined()
  })

  test("a non-minute-aligned from returns a minute-aligned timestamp", () => {
    // 37 seconds and 500ms past the minute must not leak into the result.
    const from = new Date(2026, 7, 2, 9, 0, 37, 500).getTime()
    expect(nextRun("* * * * *", from)).toBe(at(2026, 8, 2, 9, 1))
    expect(nextRun("*/5 * * * *", from)).toBe(at(2026, 8, 2, 9, 5))
  })

  test("an out-of-range field makes the cron unparseable", () => {
    const from = at(2026, 8, 2, 9, 0)
    expect(nextRun("0 25 * * *", from)).toBeUndefined()
    expect(nextRun("61 * * * *", from)).toBeUndefined()
    expect(nextRun("0 9 * 13 *", from)).toBeUndefined()
    expect(nextRun("0 9 32 * *", from)).toBeUndefined()
    expect(nextRun("0 9 * * 8", from)).toBeUndefined()
  })
})
