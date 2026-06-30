import { describe, it, expect } from "bun:test"
import { MetaMention } from "../../../src/agent/meta/mention"

const KNOWN_AGENTS = ["build", "plan", "general", "explore"]
const KNOWN_CLIS = ["claude-code", "gemini"]

describe("mention parser", () => {
  it("parses single @mention", () => {
    const result = MetaMention.parse("@build 修复 bug", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(1)
    expect(result.mentions[0].name).toBe("build")
    expect(result.mentions[0].type).toBe("subagent")
    expect(result.mentions[0].prompt).toBe("修复 bug")
  })

  it("parses multiple @mentions as parallel", () => {
    const result = MetaMention.parse("@claude-code 分析 @gemini 检查", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(2)
    expect(result.mentions[0].name).toBe("claude-code")
    expect(result.mentions[0].type).toBe("external-cli")
    expect(result.mentions[1].name).toBe("gemini")
    expect(result.mentions[1].type).toBe("external-cli")
  })

  it("detects pipeline workflow", () => {
    const result = MetaMention.parse("先 @plan 写方案，然后 @build 实现", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(2)
    expect(result.workflow).toBe("pipeline")
  })

  it("returns clean text without mentions", () => {
    const result = MetaMention.parse("修复这个 bug", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(0)
    expect(result.text).toBe("修复这个 bug")
    expect(result.workflow).toBeUndefined()
  })

  it("handles @mention with empty prompt", () => {
    const result = MetaMention.parse("@build", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(1)
    expect(result.mentions[0].prompt).toBe("")
  })

  it("ignores unknown @name", () => {
    const result = MetaMention.parse("@unknown 测试", KNOWN_AGENTS, KNOWN_CLIS)
    expect(result.mentions).toHaveLength(0)
  })
})
