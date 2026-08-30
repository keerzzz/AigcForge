import { describe, expect, test } from "bun:test"

import { isNushell, loadShellEnvAsync, mergeShellEnv, parseShellEnv, resolveUserShell } from "./shell-env"

describe("shell env", () => {
  test("parseShellEnv supports null-delimited pairs", () => {
    const env = parseShellEnv(Buffer.from("PATH=/usr/bin:/bin\0FOO=bar=baz\0\0"))

    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(env.FOO).toBe("bar=baz")
  })

  test("parseShellEnv ignores invalid entries", () => {
    const env = parseShellEnv(Buffer.from("INVALID\0=empty\0OK=1\0"))

    expect(Object.keys(env).length).toBe(1)
    expect(env.OK).toBe("1")
  })

  test("mergeShellEnv keeps explicit overrides", () => {
    const env = mergeShellEnv(
      {
        PATH: "/shell/path",
        HOME: "/tmp/home",
      },
      {
        PATH: "/desktop/path",
        AIGCFROGE_CLIENT: "desktop",
      },
    )

    expect(env.PATH).toBe("/desktop/path")
    expect(env.HOME).toBe("/tmp/home")
    expect(env.AIGCFROGE_CLIENT).toBe("desktop")
  })

  test("resolveUserShell falls back to the login shell before /bin/sh", () => {
    expect(resolveUserShell("/custom/env-shell", "/bin/zsh")).toBe("/custom/env-shell")
    expect(resolveUserShell(undefined, "/bin/zsh")).toBe("/bin/zsh")
    expect(resolveUserShell(undefined, "unknown")).toBe("/bin/sh")
    expect(resolveUserShell(undefined, undefined)).toBe("/bin/sh")
  })

  test("isNushell handles path and binary name", () => {
    expect(isNushell("nu")).toBe(true)
    expect(isNushell("/opt/homebrew/bin/nu")).toBe(true)
    expect(isNushell("C:\\Program Files\\nu.exe")).toBe(true)
    expect(isNushell("/bin/zsh")).toBe(false)
  })
})

describe("loadShellEnvAsync", () => {
  const silent = { log: () => {} }

  // /bin/sh login-shell probing is posix-only; Windows has no /bin/sh for libuv to spawn.
  test.skipIf(process.platform === "win32")("loads env from a shell that exits 0", async () => {
    const env = await loadShellEnvAsync("/bin/sh", silent)

    expect(env).not.toBeNull()
    expect(Object.keys(env!).length).toBeGreaterThan(0)
  })

  test("returns null for nushell without spawning", async () => {
    const env = await loadShellEnvAsync("nu", silent)

    expect(env).toBeNull()
  })

  test("falls back to null when the shell does not exist", async () => {
    const env = await loadShellEnvAsync("/nonexistent/shell", silent)

    expect(env).toBeNull()
  })
})
