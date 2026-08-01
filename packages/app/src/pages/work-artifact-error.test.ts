import { describe, expect, test } from "bun:test"
import { isConflictError } from "./work-artifact-error"

describe("isConflictError", () => {
  test("recognizes a ConflictError body thrown by the SDK", () => {
    expect(isConflictError({ _tag: "ConflictError", message: "Overwrite required: x.md", resource: "x.md" })).toBe(
      true,
    )
  })

  test("rejects other tagged errors", () => {
    expect(isConflictError({ _tag: "InvalidRequestError", message: "bad path" })).toBe(false)
  })

  test("rejects null/undefined/non-object", () => {
    expect(isConflictError(null)).toBe(false)
    expect(isConflictError(undefined)).toBe(false)
    expect(isConflictError("ConflictError")).toBe(false)
    expect(isConflictError(409)).toBe(false)
  })
})
