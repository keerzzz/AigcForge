import { describe, expect, test } from "bun:test"
import { lastActivityAt, stalled, STALL_THRESHOLD_MS } from "./stall"

// The row builder itself cannot be unit tested: `rows.ts` imports
// `@aigcfroge/session-ui/message-part`, whose graph reaches a Vite-only
// `?worker&url` import that bun cannot resolve. So the decision lives in this module,
// which imports nothing but types, and the row-level conditions (busy, no error, no
// renderable part) are asserted from the real route in
// `e2e/regression/session-turn-stall.spec.ts`.

const sent = 1_700_000_000_000

// No casts: `stall.ts` takes only the timestamps it reads, so these are real values of the
// parameter types rather than SDK messages forced into shape.
const userMessage = (created: number | undefined) => ({ time: { created } })

const assistantMessage = (time: { created?: number; completed?: number }) => ({ time })

describe("lastActivityAt", () => {
  test("falls back to when the user sent the turn if no assistant message exists", () => {
    expect(lastActivityAt(userMessage(sent), [])).toBe(sent)
  })

  test("prefers the assistant message over the user message", () => {
    expect(lastActivityAt(userMessage(sent), [assistantMessage({ created: sent + 5_000 })])).toBe(sent + 5_000)
  })

  test("takes the newest timestamp across messages and their completion", () => {
    const messages = [
      assistantMessage({ created: sent + 1_000, completed: sent + 2_000 }),
      assistantMessage({ created: sent + 9_000 }),
    ]
    expect(lastActivityAt(userMessage(sent), messages)).toBe(sent + 9_000)
  })

  test("ignores non-finite timestamps instead of reading them as zero", () => {
    // A NaN treated as 0 would date the turn to 1970 and trip the threshold instantly.
    const messages = [assistantMessage({ created: Number.NaN, completed: undefined })]
    expect(lastActivityAt(userMessage(sent), messages)).toBe(sent)
  })

  test("returns undefined when nothing carries a usable time", () => {
    expect(lastActivityAt(userMessage(undefined), [])).toBeUndefined()
  })
})

describe("stalled", () => {
  test("is false below the threshold", () => {
    expect(stalled({ since: sent, now: sent + STALL_THRESHOLD_MS - 1 })).toBe(false)
  })

  test("is true exactly at the threshold", () => {
    expect(stalled({ since: sent, now: sent + STALL_THRESHOLD_MS })).toBe(true)
  })

  test("is true past the threshold", () => {
    expect(stalled({ since: sent, now: sent + STALL_THRESHOLD_MS * 3 })).toBe(true)
  })

  test("is false before the clock has produced a value", () => {
    // The timeline's tick only runs while the session is working, so `now` is undefined on
    // first render — which must not be read as "silent forever".
    expect(stalled({ since: sent, now: undefined })).toBe(false)
  })

  test("is false when there is no timestamp to measure from", () => {
    expect(stalled({ since: undefined, now: sent + STALL_THRESHOLD_MS * 3 })).toBe(false)
  })

  test("is false when the clock runs behind the last activity", () => {
    expect(stalled({ since: sent + 10_000, now: sent })).toBe(false)
  })

  test("honours an explicit threshold", () => {
    expect(stalled({ since: sent, now: sent + 5_000, thresholdMs: 4_000 })).toBe(true)
    expect(stalled({ since: sent, now: sent + 5_000, thresholdMs: 6_000 })).toBe(false)
  })
})
