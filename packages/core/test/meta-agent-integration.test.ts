import { describe, expect, it } from "bun:test"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"

describe("Meta-agent A injection integration", () => {
  it("PROMPT_META template contains {{ASSETS_LIST}}", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    expect(template).toContain("{{ASSETS_LIST}}")
  })

  it("fillAssetsList replaces placeholder in template", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}\n\n## Notes`
    const assets = [
      { kind: "prompt", name: "code-review" },
      { kind: "prompt", name: "commit-msg" },
      { kind: "skill", name: "deploy" },
    ]
    const result = MetaPrompt.fillAssetsList(template, assets)
    expect(result).not.toContain("{{ASSETS_LIST}}")
    expect(result).toContain("code-review")
    expect(result).toContain("deploy")
    expect(result).toMatch(/- \*\*.*\*\*: .+/)
  })

  it("fillAssetsList with empty assets shows fallback", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, [])
    expect(result).toContain("(no assets available)")
  })

  it("fillAssetsList handles single asset per kind", () => {
    const template = `## Available Assets\n{{ASSETS_LIST}}`
    const result = MetaPrompt.fillAssetsList(template, [{ kind: "mcp", name: "github" }])
    expect(result).toContain("- **mcps**: github")
  })
})
