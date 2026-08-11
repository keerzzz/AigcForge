import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { VerifierProse } from "../src/session/verifier-prose"
import { it } from "./lib/effect"

const cases: ReadonlyArray<{ error: string; expect: string }> = [
  {
    error: "Cannot find module './foo' or its corresponding type declarations.",
    expect: "Self-export is the global default",
  },
  {
    error: "Type 'A' is not assignable to type 'B'.",
    expect: "Avoid the `any` type",
  },
  {
    error: "Property 'x' does not exist on type 'Foo'.",
    expect: "No Null Pointer",
  },
]

describe("VerifierProse", () => {
  for (const testCase of cases) {
    it.effect(`maps "${testCase.error}" to its principle`, () =>
      Effect.gen(function* () {
        const prose = VerifierProse.render(testCase.error)
        expect(prose).toContain(testCase.expect)
      }),
    )
  }

  it.effect("falls back to generic prose with the original error for unmatched errors", () =>
    Effect.gen(function* () {
      const prose = VerifierProse.render("Some exotic compiler error with a new shape")
      expect(prose).toContain("Some exotic compiler error with a new shape")
    }),
  )
})
