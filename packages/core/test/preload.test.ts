import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "@omnixa/util/global"

describe("Core test environment", () => {
  test("disables public npm security audits", () => {
    expect(process.env.NPM_CONFIG_AUDIT).toBe("false")
  })

  test("isolates global home and XDG roots", () => {
    const home = process.env.OMNIXA_TEST_HOME
    expect(home).toBeDefined()
    if (!home) return

    expect(os.homedir()).toBe(home)
    expect(Global.Path.home).toBe(home)
    expect(Global.Path.config).toBe(path.join(home, ".config", "omnixa"))
    expect(Global.Path.data).toBe(path.join(home, ".local", "share", "omnixa"))
    expect(Global.Path.cache).toBe(path.join(home, ".cache", "omnixa"))
    expect(Global.Path.state).toBe(path.join(home, ".local", "state", "omnixa"))
    expect(os.tmpdir()).toBe(path.join(home, "tmp"))
    expect(process.env.OMNIXA_CONFIG_DIR).toBe(Global.Path.config)
    expect(process.env.OMNIXA_CONFIG).toBeUndefined()
    expect(process.env.OMNIXA_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    if (process.env.RECORD !== "true") expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})
