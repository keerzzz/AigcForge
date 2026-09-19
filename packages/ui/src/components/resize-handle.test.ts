import { describe, expect, test } from "bun:test"
import { keyDeltaFor, resolveEdge, sizeDeltaFor } from "./resize-handle"

/**
 * The sign rule is the part of this component a DOM test cannot reach cheaply: the old inline
 * ternary was correct but invisible to a unit test, which is why the drag geometry and the
 * keyboard path could drift apart. These four quadrants are the whole contract.
 */
describe("sizeDeltaFor", () => {
  test("horizontal end-anchored grows with a positive pointer delta", () => {
    expect(sizeDeltaFor("horizontal", "end", 10)).toBe(10)
  })

  test("horizontal start-anchored shrinks with a positive pointer delta", () => {
    expect(sizeDeltaFor("horizontal", "start", 10)).toBe(-10)
  })

  test("vertical end-anchored grows with a positive pointer delta", () => {
    expect(sizeDeltaFor("vertical", "end", 10)).toBe(10)
  })

  test("vertical start-anchored shrinks with a positive pointer delta", () => {
    expect(sizeDeltaFor("vertical", "start", 10)).toBe(-10)
  })

  test("a negative delta is the exact inverse of the positive one in every quadrant", () => {
    for (const direction of ["horizontal", "vertical"] as const) {
      for (const edge of ["start", "end"] as const) {
        expect(sizeDeltaFor(direction, edge, -7)).toBe(-sizeDeltaFor(direction, edge, 7))
      }
    }
  })
})

describe("resolveEdge", () => {
  test("vertical dividers default to start, horizontal to end", () => {
    expect(resolveEdge("vertical", undefined)).toBe("start")
    expect(resolveEdge("horizontal", undefined)).toBe("end")
  })

  test("an explicit edge wins over the default", () => {
    expect(resolveEdge("vertical", "end")).toBe("end")
    expect(resolveEdge("horizontal", "start")).toBe("start")
  })
})

describe("keyDeltaFor", () => {
  test("a horizontal separator resizes on left/right only", () => {
    expect(keyDeltaFor("horizontal", "ArrowLeft", 16)).toBe(-16)
    expect(keyDeltaFor("horizontal", "ArrowRight", 16)).toBe(16)
    expect(keyDeltaFor("horizontal", "ArrowUp", 16)).toBeUndefined()
    expect(keyDeltaFor("horizontal", "ArrowDown", 16)).toBeUndefined()
  })

  test("a vertical separator resizes on up/down only", () => {
    expect(keyDeltaFor("vertical", "ArrowUp", 16)).toBe(-16)
    expect(keyDeltaFor("vertical", "ArrowDown", 16)).toBe(16)
    expect(keyDeltaFor("vertical", "ArrowLeft", 16)).toBeUndefined()
    expect(keyDeltaFor("vertical", "ArrowRight", 16)).toBeUndefined()
  })

  test("non-arrow keys are not resize keys on either axis", () => {
    for (const direction of ["horizontal", "vertical"] as const) {
      for (const key of ["Enter", "Home", "End", "Tab", "a"]) {
        expect(keyDeltaFor(direction, key, 16)).toBeUndefined()
      }
    }
  })

  test("the step is honoured, not baked in", () => {
    expect(keyDeltaFor("horizontal", "ArrowRight", 4)).toBe(4)
    expect(keyDeltaFor("vertical", "ArrowDown", 32)).toBe(32)
  })
})
