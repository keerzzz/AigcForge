import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  registerPreToolUse,
  registerPostToolUse,
  runPreToolUse,
  runPostToolUse,
} from "@aigcfroge/core/tool/lifecycle-hooks"

const sessionID = "ses_lifecycle_test"
const toolName = "test_tool"
const args = { query: "hello" }

// lifecycle-hooks uses module-level mutable state; clean up between tests.
const cleanups: Array<() => void> = []

afterEach(() => {
  for (const c of cleanups) c()
  cleanups.length = 0
})

const reg = {
  pre: (...fn: Parameters<typeof registerPreToolUse>) => {
    const unreg = registerPreToolUse(fn[0])
    cleanups.push(unreg)
  },
  post: (...fn: Parameters<typeof registerPostToolUse>) => {
    const unreg = registerPostToolUse(fn[0])
    cleanups.push(unreg)
  },
}

describe("tool-lifecycle-hooks", () => {
  describe("runPreToolUse", () => {
    test("should allow when no hooks registered", () =>
      Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(true)
        expect(r.reason).toBeUndefined()
      }).pipe(Effect.runPromise),
    )

    test("should allow when single hook returns allow", () => {
      reg.pre(() => Effect.succeed({ allow: true }))
      return Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(true)
      }).pipe(Effect.runPromise)
    })

    test("should deny when single hook returns deny", () => {
      reg.pre(() => Effect.succeed({ allow: false, reason: "blocked by policy" }))
      return Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(false)
        expect(r.reason).toBe("blocked by policy")
      }).pipe(Effect.runPromise)
    })

    test("should short-circuit on first deny", () => {
      const order: number[] = []
      reg.pre(() =>
        Effect.sync(() => {
          order.push(1)
          return { allow: false, reason: "no" }
        }),
      )
      reg.pre(() =>
        Effect.sync(() => {
          order.push(2)
          return { allow: true }
        }),
      )
      return Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(false)
        expect(order).toEqual([1])
      }).pipe(Effect.runPromise)
    })

    test("should run all hooks in registration order when all allow", () => {
      const order: number[] = []
      reg.pre(() =>
        Effect.sync(() => {
          order.push(1)
          return { allow: true }
        }),
      )
      reg.pre(() =>
        Effect.sync(() => {
          order.push(2)
          return { allow: true }
        }),
      )
      reg.pre(() =>
        Effect.sync(() => {
          order.push(3)
          return { allow: true }
        }),
      )
      return Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(true)
        expect(order).toEqual([1, 2, 3])
      }).pipe(Effect.runPromise)
    })

    test("should pass toolName and args to hooks", () => {
      let captured: unknown
      reg.pre((input) => {
        captured = input
        return Effect.succeed({ allow: true })
      })
      return Effect.gen(function* () {
        yield* runPreToolUse({ toolName, args, sessionID })
        expect(captured).toEqual({ toolName, args, sessionID })
      }).pipe(Effect.runPromise)
    })
  })

  describe("runPostToolUse", () => {
    const result = { forecast: "sunny" }

    test("should complete when no hooks registered", () =>
      Effect.gen(function* () {
        const r = yield* runPostToolUse({ toolName, args, result, sessionID })
        expect(r).toBeUndefined()
      }).pipe(Effect.runPromise),
    )

    test("should pass input to hooks", () => {
      let captured: unknown
      reg.post((input) => {
        captured = input
        return Effect.void
      })
      return Effect.gen(function* () {
        yield* runPostToolUse({ toolName, args, result, sessionID })
        expect(captured).toEqual({ toolName, args, result, sessionID })
      }).pipe(Effect.runPromise)
    })

    test("should run all hooks even if one throws", () => {
      const order: number[] = []
      reg.post(() =>
        Effect.sync(() => {
          order.push(1)
        }),
      )
      reg.post(() => {
        order.push(2)
        return Effect.fail(new Error("hook error")) as unknown as Effect.Effect<void>
      })
      reg.post(() =>
        Effect.sync(() => {
          order.push(3)
        }),
      )
      return Effect.gen(function* () {
        yield* runPostToolUse({ toolName, args, result, sessionID })
        expect(order).toEqual([1, 2, 3])
      }).pipe(Effect.runPromise)
    })
  })

  describe("unregister", () => {
    test("should stop hook from running after unregister", () => {
      const unreg = registerPreToolUse(() => Effect.succeed({ allow: false, reason: "blocked" }))
      unreg()
      return Effect.gen(function* () {
        const r = yield* runPreToolUse({ toolName, args, sessionID })
        expect(r.allow).toBe(true)
      }).pipe(Effect.runPromise)
    })
  })
})
