import { describe, expect, it } from "bun:test"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { AgentPlugin } from "@aigcfroge/core/plugin/agent"

describe("fillSubagentsList adopted catalogs", () => {
  const previous = [
    { id: "coder", description: "Frozen coder" },
    { id: "writer", description: "Frozen writer\nwith retained context" },
  ]
  const frozen = MetaPrompt.fillSubagentsList(AgentPlugin.metaSystem, previous)

  it("narrows and restores an exact generated section while preserving all surrounding bytes", () => {
    const narrowed = MetaPrompt.fillSubagentsList(frozen, previous.slice(1), previous)
    expect(narrowed).not.toContain("- **coder**: Frozen coder")
    expect(narrowed).toContain("- **writer**: Frozen writer\nwith retained context")
    expect(narrowed).toBe(frozen.replace("- **coder**: Frozen coder\n", ""))
    expect(MetaPrompt.fillSubagentsList(narrowed, previous, previous.slice(1))).toBe(frozen)
    const empty = MetaPrompt.fillSubagentsList(frozen, [], previous)
    expect(empty).toContain("(no subagents registered)")
    expect(MetaPrompt.fillSubagentsList(empty, previous, [])).toBe(frozen)
  })

  it("keeps the existing placeholder behavior and does not refill without an original pool", () => {
    expect(MetaPrompt.fillSubagentsList(AgentPlugin.metaSystem, previous)).toBe(frozen)
    expect(MetaPrompt.fillSubagentsList(frozen, [])).toBe(frozen)
    expect(MetaPrompt.fillSubagentsList(frozen, [], previous.slice(1))).toBe(frozen)
    expect(MetaPrompt.fillSubagentsList("Authored Meta instructions.", [], previous)).toBe(
      "Authored Meta instructions.",
    )
  })
  ;[
    frozen.replace("## Available CLI Tools", "## External Tools"),
    frozen + "\n## Available Subagents\nauthored list",
    frozen + "\n\n## Available CLI Tools\nauthored tools",
    frozen.replace("## Available Subagents", "### Available Subagents"),
    "```markdown\n" + frozen + "\n```",
    "~~~markdown\n" + frozen + "\n~~~",
    "  ```markdown\n" + frozen + "\n  ```",
    frozen.replace("## Available CLI Tools", "## Available CLI ToolsSuffix"),
    frozen + "\n## Available Subagents",
    frozen + "\n## Available CLI Tools",
    frozen.replace("- **coder**: Frozen coder", "Use coder when appropriate."),
  ].forEach((prompt, index) => {
    it(`preserves ambiguous or authored catalog text ${index + 1}`, () => {
      expect(MetaPrompt.fillSubagentsList(prompt, [], previous)).toBe(prompt)
    })
  })
})

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

  it("refills only the exact frozen Skill row and retains authored asset names", () => {
    const previous = ["writer", "coder"]
    const source = MetaPrompt.fillAssetsList(
      "Before\n## Available Assets\n{{ASSETS_LIST}}\n\n## Protocol Documents\nAfter",
      [
        { kind: "prompt", name: "Custom empty prompt" },
        { kind: "command", name: "Custom command, with commas" },
        ...previous.map((name) => ({ kind: "skill", name })),
      ],
    )
    expect(MetaPrompt.fillAssetsList(source, [{ kind: "skill", name: "writer" }], previous)).toBe(
      source.replace("- **skills**: coder, writer", "- **skills**: writer"),
    )
    expect(MetaPrompt.fillAssetsList(source, [], previous)).toBe(source.replace("\n- **skills**: coder, writer", ""))
    expect(MetaPrompt.fillAssetsList(source, [], [])).toBe(source)
    expect(MetaPrompt.fillAssetsList(source, [{ kind: "skill", name: "outside" }], previous)).toBe(source)
    expect(previous).toEqual(["writer", "coder"])
  })

  it("uses the existing empty asset marker when all frozen Skills are hidden", () => {
    const source = MetaPrompt.fillAssetsList("## Available Assets\n{{ASSETS_LIST}}\n\n## Protocol Documents", [
      { kind: "skill", name: "craft" },
    ])
    expect(MetaPrompt.fillAssetsList(source, [], ["craft"])).toBe(
      "## Available Assets\n(no assets available)\n\n## Protocol Documents",
    )
  })

  it("retains placeholder text inside adopted prompt and command names", () => {
    const source =
      "## Available Assets\n- **commands**: Preserve {{ASSETS_LIST}} command\n- **prompts**: Preserve {{ASSETS_LIST}} prompt\n- **skills**: craft\n\n## Protocol Documents"
    expect(MetaPrompt.fillAssetsList(source, [], ["craft"])).toBe(source.replace("\n- **skills**: craft", ""))
  })
  ;[
    "### Available Assets\n- **skills**: craft\n\n## Protocol Documents",
    "## Available AssetsSuffix\n- **skills**: craft\n\n## Protocol Documents",
    "## Available Assets\n- **skills**: craft\n\n## Protocol DocumentsSuffix",
    "## Available Assets\n- **skills**: craft\n\n## Notes",
    "## Available Assets\n- **skills**: craft\n\n## Protocol Documents\n## Available Assets",
    "## Available Assets\n- **skills**: craft\n\n## Protocol Documents\n## Protocol Documents",
    "## Available Assets\n- **skills**: craft\n- **skills**: craft\n\n## Protocol Documents",
    "## Available Assets\n- **skills**: different\n\n## Protocol Documents",
    "## Available Assets\nUse - **skills**: craft\n\n## Protocol Documents",
    "## Available Assets\n- **skills**: craft\nCustom prose\n\n## Protocol Documents",
  ].forEach((source, index) => {
    it(`preserves ambiguous frozen Skill catalogs ${index + 1}`, () => {
      expect(MetaPrompt.fillAssetsList(source, [], ["craft"])).toBe(source)
    })
  })
  ;["```markdown\n", "  ~~~markdown\n", "\t```markdown\n"].forEach((prefix, index) => {
    it(`preserves fenced frozen Skill catalogs ${index + 1}`, () => {
      const source = prefix + "## Available Assets\n- **skills**: craft\n\n## Protocol Documents"
      expect(MetaPrompt.fillAssetsList(source, [], ["craft"])).toBe(source)
    })
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
