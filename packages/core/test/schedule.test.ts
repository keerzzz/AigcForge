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

  test("sparse yearly cron resolves the next year's match (jump search, MEDIUM-2)", () => {
    const from = at(2026, 8, 2, 9, 0)
    expect(nextRun("0 0 1 1 *", from)).toBe(at(2027, 1, 1, 0, 0))
  })

  test("sparse leap-day cron resolves the next Feb 29 (jump search, MEDIUM-2)", () => {
    // 2028 is a leap year; the day loop must skip 2027's non-existent Feb 29.
    expect(nextRun("0 0 29 2 *", at(2026, 8, 2, 9, 0))).toBe(at(2028, 2, 29, 0, 0))
  })

  test("jump search honors the AND day-of-month/day-of-week rule", () => {
    // Feb 1 2027 is a Monday. `0 0 1 2 1` requires DOM=1 AND DOW=Monday.
    const from = at(2026, 8, 2, 9, 0)
    // Next Feb 1 that is also a Monday: 2027-02-01 is Monday → matches.
    expect(nextRun("0 0 1 2 1", from)).toBe(at(2027, 2, 1, 0, 0))
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
