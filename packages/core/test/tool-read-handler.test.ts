import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { testDouble } from "@aigcfroge/core/permission/tool-handler"
import { ReadHandler, registerReadHandler } from "@aigcfroge/core/tool/read-handler"

const ctx = { sessionID: "ses_read_test" }

describe("ReadHandler", () => {
  const service = testDouble()
  registerReadHandler(service)

  test.each(["read", "read_file", "grep", "glob", "list"])("should auto-approve %s", (tool) =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission(tool, { filePath: "/etc/passwd" }, ctx)
      expect(result).toEqual({ allow: true })
    }).pipe(Effect.runPromise),
  )

  test("should be undefined for non-read tool", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("custom_tool", { command: "ls" }, ctx)
      expect(result).toBeUndefined()
    }).pipe(Effect.runPromise),
  )

  test("exported handler can be registered individually", () => {
    expect(ReadHandler.canAutoApprove).toBeDefined()
  })
})
