import { describe, expect, test } from "bun:test"
import { mutationErrorMessage } from "./assistant-dashboard-model"

describe("mutationErrorMessage", () => {
  test("keeps an Error message", () => {
    expect(mutationErrorMessage(new Error("memory rejected"), "fallback")).toBe("memory rejected")
  })

  test("falls back for unknown or blank errors", () => {
    expect(mutationErrorMessage("network down", "fallback")).toBe("fallback")
    expect(mutationErrorMessage(new Error("   "), "fallback")).toBe("fallback")
  })
})
