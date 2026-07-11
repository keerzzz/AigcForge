import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { testDouble } from "@aigcfroge/core/permission/tool-handler"
import { BashHandler, registerBashHandler } from "@aigcfroge/core/tool/bash-handler"

const ctx = { sessionID: "ses_bash_test" }

describe("BashHandler", () => {
  const service = testDouble()
  registerBashHandler(service)

  test("should auto-approve bash command in /tmp/ path", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("bash", { command: "echo hello", workdir: "/tmp/work" }, ctx)
      expect(result).toEqual({ allow: true })
    }).pipe(Effect.runPromise),
  )

  test("should ask for bash command outside whitelist", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("bash", { command: "rm -rf /", workdir: "/home/user" }, ctx)
      expect(result).toEqual({ allow: "ask" })
    }).pipe(Effect.runPromise),
  )

  test("should ask when no workdir provided", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("bash", { command: "echo hello" }, ctx)
      expect(result).toEqual({ allow: "ask" })
    }).pipe(Effect.runPromise),
  )

  test("should be undefined for non-bash tool (other handler catches it)", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("edit", { filePath: "/tmp/x" }, ctx)
      expect(result).toBeUndefined()
    }).pipe(Effect.runPromise),
  )

  test("should not auto-approve outside /tmp/ even with command in args", () =>
    Effect.gen(function* () {
      const result = yield* service.resolvePermission("bash", { command: "ls /etc", workdir: "/etc" }, ctx)
      expect(result).toEqual({ allow: "ask" })
    }).pipe(Effect.runPromise),
  )
})
