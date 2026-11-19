import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PluginAsset } from "../src/plugin-asset.js"

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

describe("PluginAsset review content", () => {
  test("keeps original YAML and omits an unspecified candidate path from encoding", () => {
    const content = '# keep formatting\nkind: plugin\nname: review\ndescription: Review\nversion: "1.0.0"\n'
    const candidate = Schema.decodeUnknownSync(PluginAsset.Candidate)({
      name: "review",
      description: "Review",
      content,
    })
    expect(Schema.encodeSync(PluginAsset.Candidate)(candidate)).toEqual({
      name: "review",
      description: "Review",
      content,
    })
    const info = Schema.decodeUnknownSync(PluginAsset.Info)({
      kind: "plugin",
      name: "review",
      description: "Review",
      content,
      relativePath: "review.plugin.yaml",
      revision: "a".repeat(64),
      version: "1.0.0",
    })
    expect(info.content).toBe(Schema.decodeUnknownSync(PluginAsset.Content)(content))
    expect(() => Schema.decodeUnknownSync(PluginAsset.Info)({ ...info, content: undefined })).toThrow()
    expect(() => Schema.decodeUnknownSync(PluginAsset.Content)("x".repeat(1_000_001))).toThrow()
    expect(Schema.decodeUnknownSync(PluginAsset.BaseRevision)(null)).toBeNull()
  })
})

const encodedInfo = Schema.toCodecJson(PluginAsset.Info)
test("plugin wire encoding omits absent optional fields at every level", () => {
  const info = Schema.decodeUnknownSync(PluginAsset.Info)({
    kind: "plugin",
    name: "review",
    description: "Review",
    relativePath: "review.plugin.yaml",
    revision: "a".repeat(64),
    content: "original",
    version: "1.0.0",
    author: { name: "Example" },
    source: { type: "mcp", mcp: { name: "example" } },
    hooks: [{ event: "PreToolUse", command: "review" }],
  })
  expect(Schema.encodeSync(encodedInfo)(info)).toEqual({
    kind: "plugin",
    name: "review",
    description: "Review",
    relativePath: "review.plugin.yaml",
    revision: "a".repeat(64),
    content: "original",
    version: "1.0.0",
    author: { name: "Example" },
    source: { type: "mcp", mcp: { name: "example" } },
    hooks: [{ event: "PreToolUse", command: "review" }],
  })
})
