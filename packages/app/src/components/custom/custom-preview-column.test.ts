import { describe, expect, test } from "bun:test"
import { classifyPlanFailure, DISABLED_MESSAGE_MARKER } from "./custom-preview-column"

// Kept literal rather than imported from core: `packages/app` must not pull
// anything that transitively reaches `core/flag/flag.ts`, which reads `process`
// and blanks the web build. So this constant is duplicated on purpose, and this
// assertion is what catches the two copies drifting apart.
const SERVER_MESSAGE = "Custom mode is disabled on this server. Set AIGCFROGE_CUSTOM_MODE=true to enable it."

/**
 * `disabled` is the only signal that downgrades the Builder from a red error to
 * the amber opt-in notice, and it is one of the two flags that keep `canStart`
 * false. Misclassify it and Start becomes clickable against a server that will
 * refuse the request — so this is a behaviour boundary, not formatting.
 */
describe("classifyPlanFailure", () => {
  test("recognizes the server's custom-mode-disabled message", () => {
    expect(classifyPlanFailure({ status: 400, message: SERVER_MESSAGE })).toEqual({
      disabled: true,
      error: SERVER_MESSAGE,
    })
  })

  test("stays in sync with the server's wording", () => {
    // If the server message is reworded or localized so it no longer contains
    // this marker, `disabled` silently becomes undefined and Start re-enables.
    expect(SERVER_MESSAGE).toContain(DISABLED_MESSAGE_MARKER)
  })

  test("treats 404 as an unsupported server, not a disabled flag", () => {
    expect(classifyPlanFailure({ status: 404, message: "Not Found" })).toEqual({
      unsupported: true,
      error: "This server does not support custom compositions",
    })
  })

  test("leaves every other failure as a plain error", () => {
    expect(classifyPlanFailure({ status: 500, message: "boom" })).toEqual({ error: "boom" })
    expect(classifyPlanFailure({ status: 400, message: 'Unknown or unsupported product mode "nope"' })).toEqual({
      error: 'Unknown or unsupported product mode "nope"',
    })
  })

  test("survives a non-object rejection", () => {
    expect(classifyPlanFailure("network down")).toEqual({ error: "network down" })
    expect(classifyPlanFailure(undefined)).toEqual({ error: "undefined" })
  })

  test("does not mark a 404 as disabled even when the body mentions the flag", () => {
    // Order matters: an unsupported server cannot be fixed by setting the flag,
    // so the 404 branch has to win.
    expect(classifyPlanFailure({ status: 404, message: SERVER_MESSAGE })).toEqual({
      unsupported: true,
      error: "This server does not support custom compositions",
    })
  })
})
