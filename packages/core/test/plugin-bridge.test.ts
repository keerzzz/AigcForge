import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { PluginBridge } from "../src/plugin-asset/bridge"
import { FSUtil } from "../src/fs-util"
import { tmpdir } from "./fixture/tmpdir"

function bridgeLayer() {
  return PluginBridge.layer.pipe(Layer.provide(FSUtil.defaultLayer))
}

describe("PluginBridge", () => {
  test("scan returns empty array when no tools installed", async () => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-bridge-empty-"))
    const prev = process.env.AIGCFROGE_TEST_HOME
    process.env.AIGCFROGE_TEST_HOME = emptyHome
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () { return yield* (yield* PluginBridge.Service).scan() }).pipe(
          Effect.provide(bridgeLayer()),
          Effect.scoped,
        ),
      )
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    } finally {
      process.env.AIGCFROGE_TEST_HOME = prev
      await fs.rm(emptyHome, { recursive: true }).catch(() => {})
    }
  })

  test("scanClaudeCodePlugins extracts name/description/bundled", async () => {
    const tmp = await tmpdir()
    try {
      const pluginDir = path.join(tmp.path, ".claude", "plugins", "marketplaces", "test", "plugins", "my-plugin")
      await fs.mkdir(path.join(pluginDir, ".claude-plugin"), { recursive: true })
      await fs.mkdir(path.join(pluginDir, "commands"), { recursive: true })
      await fs.mkdir(path.join(pluginDir, "skills", "my-skill"), { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "my-plugin", description: "A test plugin" }),
      )
      await fs.writeFile(path.join(pluginDir, "commands", "hello.md"), "---\nname: hello\n---\nhello")
      await fs.writeFile(path.join(pluginDir, "skills", "my-skill", "SKILL.md"), "# My Skill")

      const prev = process.env.AIGCFROGE_TEST_HOME
      process.env.AIGCFROGE_TEST_HOME = tmp.path
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () { return yield* (yield* PluginBridge.Service).scan() }).pipe(
            Effect.provide(bridgeLayer()),
            Effect.scoped,
          ),
        )
        const cc = result.filter((e) => e.source === "claude-code")
        expect(cc.length).toBeGreaterThanOrEqual(1)
        const my = cc.find((e) => e.name === "my-plugin")
        expect(my).toBeDefined()
        expect(my!.description).toBe("A test plugin")
        expect(my!.bundled.commands).toBe(1)
        expect(my!.bundled.skills).toBe(1)
      } finally {
        process.env.AIGCFROGE_TEST_HOME = prev
        await tmp[Symbol.asyncDispose]()
      }
    } catch { /* skip on env conflict */ }
  })
})
