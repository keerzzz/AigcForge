import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { nextRun } from "@aigcfroge/core/session/schedule"
import { testEffect } from "./lib/effect"
import { withEnv } from "./fixture/env"

// Timestamps are built with local Date so the cron matching (which reads local
// clock fields) is deterministic on any machine timezone.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const it = testEffect(Layer.empty)

describe("nextRun", () => {
  test("an invalid or overflowing start has no future calendar run", () => {
    for (const from of [NaN, Infinity, 8_640_000_000_000_000]) {
      expect(nextRun("* * * * *", from)).toBeUndefined()
      expect(nextRun("* * * * *", from, "UTC")).toBeUndefined()
    }
  })

  it.effect("legacy fold fallback returns a future first occurrence and restores TZ", () =>
    Effect.gen(function* () {
      const previous = process.env.TZ
      yield* withEnv({ TZ: "America/New_York" }, () =>
        Effect.sync(() => {
          expect(nextRun("* * * * *", Date.parse("2026-11-01T01:10:00.000-05:00"))).toBe(
            Date.parse("2026-11-01T07:00:00.000Z"),
          )
          expect(nextRun("* * * * *", Date.parse("2026-11-01T01:59:00.000-04:00"))).toBe(
            Date.parse("2026-11-01T07:00:00.000Z"),
          )
          expect(nextRun("30 1 * * *", Date.parse("2026-11-01T01:10:00.000-05:00"))).toBe(
            Date.parse("2026-11-02T06:30:00.000Z"),
          )
        }),
      )
      expect(process.env.TZ).toBe(previous)
    }),
  )

  test("a missing New York 02:30 is skipped", () => {
    expect(nextRun("30 2 * * *", Date.parse("2026-03-08T01:59:00-05:00"), "America/New_York")).toBe(
      Date.parse("2026-03-09T06:30:00.000Z"),
    )
  })

  test("a half-hour gap keeps the first valid Lord Howe candidate", () => {
    expect(nextRun("15,30 2 * * *", Date.parse("2026-10-04T01:59:00+10:30"), "Australia/Lord_Howe")).toBe(
      Date.parse("2026-10-03T15:30:00.000Z"),
    )
  })

  test("a skipped calendar day does not execute Apia's missing morning", () => {
    expect(nextRun("0 8 * * *", Date.parse("2011-12-29T23:59:00-10:00"), "Pacific/Apia")).toBe(
      Date.parse("2011-12-30T18:00:00.000Z"),
    )
  })

  for (const from of [
    "2026-11-01T01:30:00.000-04:00",
    "2026-11-01T01:40:00.000-04:00",
    "2026-11-01T01:10:00.000-05:00",
  ]) {
    test(`a repeated 01:30 runs only once when resuming at ${from}`, () => {
      expect(nextRun("30 1 * * *", Date.parse(from), "America/New_York")).toBe(Date.parse("2026-11-02T06:30:00.000Z"))
    })
  }

  test("a repeated 01:30 selects its first occurrence", () => {
    expect(nextRun("30 1 * * *", Date.parse("2026-11-01T00:59:00-04:00"), "America/New_York")).toBe(
      Date.parse("2026-11-01T05:30:00.000Z"),
    )
  })

  test("explicit every-minute timezone has a future run from the second fold hour", () => {
    const from = Date.parse("2026-11-01T01:10:00.000-05:00")
    const run = nextRun("* * * * *", from, "America/New_York")
    if (run === undefined) throw new Error("Expected a future minute in America/New_York")
    expect(run).toBeGreaterThan(from)
    expect(run % 60_000).toBe(0)
    expect(run).toBe(Date.parse("2026-11-01T07:00:00.000Z"))
  })

  test("explicit timezone never returns the first fold occurrence before its second-hour start", () => {
    const from = Date.parse("2026-11-01T01:10:00.000-05:00")
    const run = nextRun("30 1 * * *", from, "America/New_York")
    if (run === undefined) throw new Error("Expected a future 01:30 in America/New_York")
    expect(run).toBeGreaterThan(from)
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(run)),
    ).toBe("01:30")
  })

  test("explicit recurrence timezones select distinct UTC instants", () => {
    const from = Date.parse("2026-08-01T23:59:00.000Z")
    expect([nextRun("0 9 * * *", from, "Asia/Tokyo"), nextRun("0 9 * * *", from, "Europe/London")]).toEqual([
      Date.parse("2026-08-02T00:00:00.000Z"),
      Date.parse("2026-08-02T08:00:00.000Z"),
    ])
  })

  test("an explicit named timezone keeps 09:00 across a seasonal offset change", () => {
    expect(nextRun("0 9 * * *", Date.parse("2026-03-28T00:00:00.000Z"), "Europe/Berlin")).toBe(
      Date.parse("2026-03-28T08:00:00.000Z"),
    )
    expect(nextRun("0 9 * * *", Date.parse("2026-03-28T08:00:00.000Z"), "Europe/Berlin")).toBe(
      Date.parse("2026-03-29T07:00:00.000Z"),
    )
  })

  test("explicit timezone retains AND day constraints and Sunday 7", () => {
    expect(nextRun("0 0 1 * 1", Date.parse("2024-01-02T00:00:00.000Z"), "UTC")).toBe(
      Date.parse("2024-04-01T00:00:00.000Z"),
    )
    expect(nextRun("0 9 * * 7", Date.parse("2026-08-01T23:59:00.000Z"), "Asia/Tokyo")).toBe(
      Date.parse("2026-08-02T00:00:00.000Z"),
    )
  })

  test("invalid explicit timezone returns undefined without a host-local fallback", () => {
    expect(nextRun("0 9 * * *", Date.parse("2026-08-01T23:59:00.000Z"), "Not/A_TimeZone")).toBeUndefined()
  })

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
    expect(nextRun("0 9 31 2 *", at(2026, 8, 2, 9, 0))).toBeUndefined()
    expect(nextRun("0 9 31 2 *", Date.parse("2026-08-02T00:00:00.000Z"), "UTC")).toBeUndefined()
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
