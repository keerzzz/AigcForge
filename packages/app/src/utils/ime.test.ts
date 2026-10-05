import { describe, expect, test } from "bun:test"
import { isImeComposing } from "./ime"

// AI-TDD-S02-R05: a keydown fired while an IME composition is in progress
// (confirming a Chinese/Japanese/Korean candidate) must never be interpreted
// as a user-intended Enter/select/submit action. Three independent signals
// are checked because browsers are inconsistent about which one fires:
// `event.isComposing` (spec), a component-tracked composing signal (Safari
// drops isComposing on some paths), and the legacy `keyCode === 229` sentinel
// (older WebKit).
describe("isImeComposing", () => {
  test("true when the native isComposing flag is set", () => {
    const event = { isComposing: true, keyCode: 13 }
    expect(isImeComposing(event, false)).toBe(true)
  })

  test("true when the component's own composing signal is set, even if isComposing is false", () => {
    const event = { isComposing: false, keyCode: 13 }
    expect(isImeComposing(event, true)).toBe(true)
  })

  test("true for the legacy keyCode 229 sentinel", () => {
    const event = { isComposing: false, keyCode: 229 }
    expect(isImeComposing(event, false)).toBe(true)
  })

  test("false for an ordinary Enter with no composition signal present", () => {
    const event = { isComposing: false, keyCode: 13 }
    expect(isImeComposing(event, false)).toBe(false)
  })

  test("false for an ordinary digit key press with no composition signal present", () => {
    const event = { isComposing: false, keyCode: 49 }
    expect(isImeComposing(event, false)).toBe(false)
  })
})
