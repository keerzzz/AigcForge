import { describe, expect, it } from "bun:test"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"

describe("fillAssetsList", () => {
  const template = "## Available Assets\n{{ASSETS_LIST}}\n\n## Notes"

  it("replaces {{ASSETS_LIST}} with grouped assets by kind", () => {
    const assets = [
      { kind: "prompt", name: "code-review" },
      { kind: "prompt", name: "commit-msg" },
      { kind: "skill", name: "deploy" },
    ]
    const result = MetaPrompt.fillAssetsList(template, assets)
    expect(result).toContain("- **prompts**: code-review, commit-msg")
    expect(result).toContain("- **skills**: deploy")
    expect(result).not.toContain("{{ASSETS_LIST}}")
  })

  it("shows default text when no assets", () => {
    const result = MetaPrompt.fillAssetsList(template, [])
    expect(result).toContain("(no assets available)")
    expect(result).not.toContain("{{ASSETS_LIST}}")
  })

  it("sorts assets alphabetically within each kind", () => {
    const assets = [
      { kind: "prompt", name: "zebra" },
      { kind: "prompt", name: "apple" },
      { kind: "prompt", name: "banana" },
    ]
    const result = MetaPrompt.fillAssetsList(template, assets)
    const promptsIdx = result.indexOf("**prompts**:")
    const appleIdx = result.indexOf("apple", promptsIdx)
    const bananaIdx = result.indexOf("banana", promptsIdx)
    const zebraIdx = result.indexOf("zebra", promptsIdx)
    expect(appleIdx).toBeGreaterThan(promptsIdx)
    expect(bananaIdx).toBeGreaterThan(appleIdx)
    expect(zebraIdx).toBeGreaterThan(bananaIdx)
  })

  it("orders kinds alphabetically", () => {
    const assets = [
      { kind: "skill", name: "build" },
      { kind: "agent", name: "reviewer" },
      { kind: "prompt", name: "test" },
    ]
    const result = MetaPrompt.fillAssetsList(template, assets)
    const agentIdx = result.indexOf("- **agents**:")
    const promptIdx = result.indexOf("- **prompts**:")
    const skillIdx = result.indexOf("- **skills**:")
    expect(agentIdx).toBeGreaterThan(0)
    expect(promptIdx).toBeGreaterThan(agentIdx)
    expect(skillIdx).toBeGreaterThan(promptIdx)
  })

  it("does not modify prompt when {{ASSETS_LIST}} is absent", () => {
    const tpl = "## Some Other Section\ncontent here"
    const result = MetaPrompt.fillAssetsList(tpl, [{ kind: "prompt", name: "test" }])
    expect(result).toBe(tpl)
  })

  it("handles multiple assets of the same kind efficiently", () => {
    const assets = Array.from({ length: 50 }, (_, i) => ({
      kind: "prompt",
      name: `asset-${i}`,
    }))
    const result = MetaPrompt.fillAssetsList(template, assets)
    expect(result).toContain("- **prompts**:")
    expect(result).not.toContain("{{ASSETS_LIST}}")
    for (let i = 0; i < 10; i++) {
      expect(result).toContain(`asset-${i}`)
    }
  })
})
