import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { testDouble } from "@aigcfroge/core/permission/tool-handler"
import { EditHandler, registerEditHandler } from "@aigcfroge/core/tool/edit-handler"

const ctx = { sessionID: "ses_edit_test" }

describe("EditHandler", () => {
  const service = testDouble()
  registerEditHandler(service)

  test.each(["edit", "write", "apply_patch"])("should auto-approve %s in /tmp/", (tool) =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission(tool, { filePath: "/tmp/work/file.txt" }, ctx)
      expect(result).toEqual({ allow: true })
    }).pipe(Effect.runPromise),
  )

  test.each(["edit", "write", "apply_patch"])("should ask for %s outside whitelist", (tool) =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission(tool, { filePath: "/home/user/file.txt" }, ctx)
      expect(result).toEqual({ allow: "ask" })
    }).pipe(Effect.runPromise),
  )

  test("should ask when path is missing", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("edit", { content: "hello" }, ctx)
      expect(result).toEqual({ allow: "ask" })
    }).pipe(Effect.runPromise),
  )

  test("should provide confirmation params with path", () => {
    const params = EditHandler.getConfirmationParams?.("edit", { filePath: "/home/user/file.txt" })
    expect(params).toEqual({ title: "edit file", description: "/home/user/file.txt" })
  })
})
