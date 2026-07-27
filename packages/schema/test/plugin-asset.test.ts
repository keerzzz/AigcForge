import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PluginAsset } from "../src/plugin-asset"

describe("PluginAsset.Frontmatter", () => {
  test("accepts minimal valid frontmatter", () => {
    const f = Schema.decodeUnknownSync(PluginAsset.Frontmatter)({
      kind: "plugin",
      name: "my-plugin",
      description: "A test plugin",
      version: "1.0.0",
    })
    expect(f.kind).toBe("plugin")
    expect(f.name).toBe(Schema.decodeSync(PluginAsset.Name)("my-plugin"))
  })

  test("accepts full frontmatter with hooks", () => {
    const f = Schema.decodeUnknownSync(PluginAsset.Frontmatter)({
      kind: "plugin",
      name: "hookify",
      description: "User-configurable hooks",
      version: "1.2.0",
      category: "development",
      author: { name: "Anthropic", email: "support@anthropic.com" },
      source: { type: "mcp", mcp: { name: "github" } },
      hooks: [
        { event: "PreToolUse", command: "python3 hooks/check.py", timeout: 10 },
        { event: "PostToolUse", command: "python3 hooks/audit.py" },
      ],
    })
    expect(f.hooks!.length).toBe(2)
  })
})

describe("PluginAsset.Summary", () => {
  test("accepts valid summary", () => {
    const s = Schema.decodeSync(PluginAsset.Summary)({
      kind: "plugin",
      name: Schema.decodeSync(PluginAsset.Name)("code-review"),
      description: Schema.decodeSync(PluginAsset.Description)("Auto review"),
      relativePath: "code-review.plugin.yaml",
      revision: Schema.decodeSync(PluginAsset.Revision)("a".repeat(64)),
      source: "mcp",
      toolCount: 5,
    })
    expect(s.kind).toBe("plugin")
  })
})

describe("PluginAsset.BridgeEntry", () => {
  test("accepts claude-code bridge entry", () => {
    const b = Schema.decodeUnknownSync(PluginAsset.BridgeEntry)({
      name: "code-review",
      description: "Automated code review",
      source: "claude-code",
      category: "productivity",
      originPath: "/home/user/.claude/plugins/marketplaces/.../plugin.json",
      format: "claude-plugin-v1",
      bundled: { commands: 1, skills: 2, agents: 0, hooks: 0, mcpServers: 0 },
    })
    expect(b.source).toBe("claude-code")
    expect(b.bundled.commands).toBe(1)
  })

  test("accepts codex bridge entry", () => {
    const b = Schema.decodeUnknownSync(PluginAsset.BridgeEntry)({
      name: "figma",
      description: "Use Figma MCP for design-to-code",
      source: "codex",
      category: "design",
      originPath: "/home/user/.codex/vendor_imports/skills-curated-cache.json",
      format: "codex-skill-v1",
      bundled: { commands: 0, skills: 1, agents: 0, hooks: 0, mcpServers: 1 },
    })
    expect(b.source).toBe("codex")
  })
})

describe("PluginAsset.InvalidEntry", () => {
  test("accepts parse_error tag", () => {
    const e = Schema.decodeUnknownSync(PluginAsset.InvalidEntry)({
      relativePath: "broken.plugin.yaml",
      errorTag: "parse_error",
    })
    expect(e.errorTag).toBe("parse_error")
  })
})
