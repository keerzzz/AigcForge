import { describe, expect, test } from "bun:test"
import { isMode, modeHref } from "./mode"

describe("product mode", () => {
  test("accepts only built-in modes", () => {
    expect(isMode("chat")).toBe(true)
    expect(isMode("coding")).toBe(true)
    expect(isMode("work")).toBe(true)
    expect(isMode("assistant")).toBe(true)
    expect(isMode("custom")).toBe(false)
    expect(isMode(undefined)).toBe(false)
  })

  test("builds the canonical mode route", () => {
    expect(modeHref("work")).toBe("/mode/work")
  })
})
