import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { createHash } from "crypto"
import { MetaAgent } from "../../../src/agent/meta-agent"

const SHA256_L1 = "2e87b668ef8fb6a78532d483834ad7c299cb02de5272d5148fbcbe71fbaebb21"

describe("meta agent", () => {
  it("exports description", () => {
    expect(MetaAgent.description).toBeString()
    expect(MetaAgent.description.length).toBeGreaterThan(0)
  })

  it("exports prompt from meta.txt", () => {
    expect(MetaAgent.prompt).toBeString()
    expect(MetaAgent.prompt.length).toBeGreaterThan(0)
    expect(MetaAgent.prompt).toContain("AigcForge Meta Agent")
    expect(MetaAgent.prompt).toContain("{{SUBAGENTS_LIST}}")
    expect(MetaAgent.prompt).toContain("{{CLI_LIST}}")
  })

  it("exports mode as primary", () => {
    expect(MetaAgent.mode).toBe("primary")
  })

  it("exports hidden as false", () => {
    expect(MetaAgent.hidden).toBe(false)
  })

  it("meta.txt L1 SHA256 is locked", () => {
    const content = readFileSync("src/agent/prompt/meta.txt", "utf-8")
    const l1Marker = "## Available Subagents"
    const idx = content.indexOf(l1Marker)
    const l1 = content.slice(0, idx).trimEnd()
    const sha = createHash("sha256").update(l1, "utf-8").digest("hex")
    expect(sha).toBe(SHA256_L1)
  })
})
