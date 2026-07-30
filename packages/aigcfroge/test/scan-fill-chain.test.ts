import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { scanAssets } from "../src/agent/meta/assets-loader"

describe("scanAssets → fillAssetsList chain", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "scan-fill-chain-"))
    const aigcfroge = join(tmpDir, ".aigcfroge")
    mkdirSync(join(aigcfroge, "prompts", "code-review"), { recursive: true })
    mkdirSync(join(aigcfroge, "prompts", "commit-msg"), { recursive: true })
    mkdirSync(join(aigcfroge, "skills", "deploy"), { recursive: true })
    mkdirSync(join(aigcfroge, "mcps"), { recursive: true })
    writeFileSync(join(aigcfroge, "mcps", "github.json"), "{}")
    writeFileSync(join(aigcfroge, "mcps", "filesystem.json"), "{}")
  })

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
  })

  it("scanAssets discovers correct structure", async () => {
    const assets = await scanAssets(tmpDir)
    expect(assets.length).toBe(5) // 2 prompts + 1 skill + 2 mcps

    const prompts = assets.filter((a) => a.kind === "prompt")
    expect(prompts.map((p) => p.name).sort()).toEqual(["code-review", "commit-msg"])

    const skills = assets.filter((a) => a.kind === "skill")
    expect(skills.map((s) => s.name)).toEqual(["deploy"])
  })
})
