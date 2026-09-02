import { describe, expect, test } from "bun:test"
import { whenActive } from "@/pages/mode-slot-active"

// The contract these pin is Solid's: `createResource` skips its fetcher when the
// source is undefined/null/false. An object source is always truthy, so gating has to
// collapse to undefined rather than to a falsy-but-present value.

describe("whenActive", () => {
  test("passes the source through while the slot is on screen", () => {
    expect(whenActive(true, () => ({ sdk: "x" }))).toEqual({ sdk: "x" })
  })

  test("collapses an object source to undefined while the slot is hidden", () => {
    expect(whenActive(false, () => ({ sdk: "x" }))).toBeUndefined()
  })

  test("does not evaluate the source while hidden", () => {
    // The source itself reads signals and can build request payloads; running it for
    // a hidden slot is the cost being avoided, not just the fetch.
    let reads = 0
    whenActive(false, () => {
      reads++
      return 1
    })
    expect(reads).toBe(0)

    whenActive(true, () => {
      reads++
      return 1
    })
    expect(reads).toBe(1)
  })

  test("preserves a legitimately undefined source when active", () => {
    // "No SDK yet" and "slot hidden" both mean skip, so they are allowed to look the
    // same to the resource — but the active path must not invent a value.
    expect(whenActive(true, () => undefined)).toBeUndefined()
  })
})
