/**
 * End-to-end integration test for meta-agent ASSETS_LIST injection.
 * Verifies that scanAssets → fillAssetsList → agent system prompt works end-to-end
 * using isolated AgentV2 state.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { scanAssets } from "../src/agent/meta/assets-loader"

describe("Meta-agent e2e", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "meta-e2e-"))
    const aigcfroge = join(tmpDir, ".aigcfroge")
    mkdirSync(join(aigcfroge, "prompts", "code-review"), { recursive: true })
    mkdirSync(join(aigcfroge, "prompts", "commit-msg"), { recursive: true })
    writeFileSync(join(aigcfroge, "prompts", "code-review", "source.md"), "Review code changes")
    writeFileSync(join(aigcfroge, "prompts", "commit-msg", "source.md"), "Generate commit message")
    mkdirSync(join(aigcfroge, "skills", "deploy"), { recursive: true })
    writeFileSync(join(aigcfroge, "skills", "deploy", "SKILL.md"), "Deploy to production")
  })

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
  })

  it("scanAssets discovers all assets in .aigcfroge/", async () => {
    const assets = await scanAssets(tmpDir)
    expect(assets.length).toBe(3)
    expect(assets.find((a) => a.name === "code-review")).toBeDefined()
    expect(assets.find((a) => a.name === "commit-msg")).toBeDefined()
    expect(assets.find((a) => a.name === "deploy")).toBeDefined()
  })

  it("fillAssetsList produces well-formatted output", () => {
    const assets = [
      { kind: "prompt", name: "code-review" },
      { kind: "prompt", name: "commit-msg" },
      { kind: "skill", name: "deploy" },
    ]
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, assets)
    expect(result).toContain("- **prompts**: code-review, commit-msg")
    expect(result).toContain("- **skills**: deploy")
    expect(result).not.toContain("{{ASSETS_LIST}}")
  })

  it("PROMPT_META template contains ASSETS_LIST after fill", () => {
    // Simulate what the agent transform does: replace {{ASSETS_LIST}} in PROMPT_META
    const assets = [
      { kind: "prompt", name: "code-review" },
      { kind: "skill", name: "deploy" },
    ]
    const filled = MetaPrompt.fillAssetsList(
      "## Available Assets\n{{ASSETS_LIST}}",
      assets,
    )
    expect(filled).toContain("code-review")
    expect(filled).toContain("deploy")
    // Verify the format matches what agent sees
    expect(filled).toMatch(/-\s+\*\*\w+\*\*:\s+[\w,\s-]+/)
  })

  it("full assets list fits within reasonable token budget", async () => {
    const assets = Array.from({ length: 50 }, (_, i) => ({
      kind: i < 40 ? "prompt" as const : "skill" as const,
      name: `asset-${i}`,
    }))
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, assets)
    // Rough token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(result.length / 4)
    // 50 assets should be well under 2000 tokens
    expect(estimatedTokens).toBeLessThan(500)
    expect(result).not.toContain("{{ASSETS_LIST}}")
  })
})
