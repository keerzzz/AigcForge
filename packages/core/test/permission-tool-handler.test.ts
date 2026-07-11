import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  testDouble,
  type Interface as Handler,
} from "@aigcfroge/core/permission/tool-handler"

const ctx = { sessionID: "ses_test" }

/** Create a fresh, isolated service for each test group to avoid cross-test pollution. */
function freshService() {
  return testDouble()
}

describe("ToolPermissionHandler", () => {
  describe("register and resolve", () => {
    test("should register and resolve exact match", () => {
      const service = freshService()
      const handler: Handler = { canAutoApprove: () => Effect.succeed(true) }
      service.register("bash", handler)
      expect(service.resolve("bash")).toBe(handler)
    })

    test("should return undefined for unregistered tool", () => {
      const service = freshService()
      expect(service.resolve("unknown_tool")).toBeUndefined()
    })

    test("should resolve wildcard patterns", () => {
      const service = freshService()
      const handler: Handler = { canAutoApprove: () => Effect.succeed(true) }
      service.register("read_*", handler)
      expect(service.resolve("read_file")).toBe(handler)
      expect(service.resolve("read_directory")).toBe(handler)
    })

    test("should prefer exact match over wildcard", () => {
      const service = freshService()
      const wildcard: Handler = { canAutoApprove: () => Effect.succeed(true) }
      const exact: Handler = { canAutoApprove: () => Effect.succeed(false) }
      service.register("read_*", wildcard)
      service.register("read_file", exact)
      expect(service.resolve("read_file")).toBe(exact)
      expect(service.resolve("read_directory")).toBe(wildcard)
    })
  })

  describe("resolvePermission", () => {
    test("should return undefined when no handler registered", () =>
      Effect.gen(function* () {
        const service = freshService()
        const result = yield* service.resolvePermission("unknown", {}, ctx)
        expect(result).toBeUndefined()
      }).pipe(Effect.runPromise),
    )

    test("should call canAutoApprove and return allow", () => {
      const service = freshService()
      service.register("safe_tool", {
        canAutoApprove: () => Effect.succeed(true),
      } satisfies Handler)
      return Effect.gen(function* () {
        const result = yield* service.resolvePermission("safe_tool", {}, ctx)
        expect(result).toEqual({ allow: true })
      }).pipe(Effect.runPromise)
    })

    test("should return ask when canAutoApprove returns false", () => {
      const service = freshService()
      service.register("ask_tool", {
        canAutoApprove: () => Effect.succeed(false),
      } satisfies Handler)
      return Effect.gen(function* () {
        const result = yield* service.resolvePermission("ask_tool", {}, ctx)
        expect(result).toEqual({ allow: "ask" })
      }).pipe(Effect.runPromise)
    })

    test("should call handle when defined (takes precedence)", () => {
      const service = freshService()
      service.register("custom_tool", {
        handle: () => Effect.succeed({ allow: false, reason: "custom deny" }),
      } satisfies Handler)
      return Effect.gen(function* () {
        const result = yield* service.resolvePermission("custom_tool", {}, ctx)
        expect(result).toEqual({ allow: false, reason: "custom deny" })
      }).pipe(Effect.runPromise)
    })

    test("should fallthrough canAutoApprove when handle is not defined", () => {
      const service = freshService()
      service.register("no_handle_tool", {
        canAutoApprove: () => Effect.succeed(true),
      } satisfies Handler)
      return Effect.gen(function* () {
        const result = yield* service.resolvePermission("no_handle_tool", {}, ctx)
        expect(result).toEqual({ allow: true })
      }).pipe(Effect.runPromise)
    })

    test("should pass tool name, input, and context to handler", () => {
      const service = freshService()
      const captured: unknown[] = []
      service.register("capture_tool", {
        handle: (name, input, handlerCtx) => {
          captured.push(name, input, handlerCtx)
          return Effect.succeed({ allow: true })
        },
      } satisfies Handler)
      return Effect.gen(function* () {
        yield* service.resolvePermission("capture_tool", { key: "val" }, ctx)
        expect(captured).toEqual(["capture_tool", { key: "val" }, ctx])
      }).pipe(Effect.runPromise)
    })
  })
})
