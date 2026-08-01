import { describe, expect, test } from "bun:test"
import { describeApplyError, isConflictError } from "./work-artifact-error"

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

describe("describeApplyError", () => {
  test("extracts message from SDK error body without leaking the object", () => {
    expect(describeApplyError({ _tag: "InvalidRequestError", message: "Path must be relative to the location" })).toBe(
      "Path must be relative to the location",
    )
  })

  test("uses Error.message", () => {
    expect(describeApplyError(new Error("fetch failed"))).toBe("fetch failed")
  })

  test("accepts a plain string", () => {
    expect(describeApplyError("boom")).toBe("boom")
  })

  test("falls back for non-string message and unknown shapes", () => {
    expect(describeApplyError({ _tag: "ConflictError", message: 42 })).toBe("unknown error")
    expect(describeApplyError(null)).toBe("unknown error")
    expect(describeApplyError(undefined)).toBe("unknown error")
  })
})
