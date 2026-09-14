import { describe, expect, test } from "bun:test"
import { isInternalNavigation, runInternalNavigation } from "./chat-workspace"

// The dirty guard skips navigations flagged as internal (one-shot URL cleanup).
// The flag must be synchronous and nesting-safe: an internal navigation that
// triggers another must stay internal for the whole chain, and must never leak
// into the next user navigation.
describe("internal navigation marker", () => {
  test("is off by default and on only inside the wrapper", () => {
    expect(isInternalNavigation()).toBe(false)
    runInternalNavigation(() => {
      expect(isInternalNavigation()).toBe(true)
    })
    expect(isInternalNavigation()).toBe(false)
  })

  test("stays on through nesting and clears on throw", () => {
    runInternalNavigation(() => {
      runInternalNavigation(() => {
        expect(isInternalNavigation()).toBe(true)
      })
      expect(isInternalNavigation()).toBe(true)
    })
    expect(isInternalNavigation()).toBe(false)

    expect(() =>
      runInternalNavigation(() => {
        throw new Error("navigation failed")
      }),
    ).toThrow("navigation failed")
    expect(isInternalNavigation()).toBe(false)
  })

  test("returns the wrapped value", () => {
    expect(runInternalNavigation(() => 42)).toBe(42)
  })
})
