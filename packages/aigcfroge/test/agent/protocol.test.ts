import { describe, it, expect } from "bun:test"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { getAgentCard, listAgents } from "../../src/agent/protocol"

describe("agent cards", () => {
  const agents = listAgents()
  const packageRoot = path.resolve(import.meta.dir, "../..")

  it("all agents have valid cards", () => {
    expect(agents.length).toBeGreaterThanOrEqual(4)
    const names = agents.map((a) => a.name)
    expect(names).toContain("build")
    expect(names).toContain("explore")
    expect(names).toContain("plan")
    expect(names).toContain("general")
  })

  it("each card has required fields", () => {
    for (const agent of agents) {
      expect(typeof agent.name).toBe("string")
      expect(["primary", "subagent", "all"]).toContain(agent.mode)
      expect(typeof agent.description).toBe("string")
      expect(Array.isArray(agent.capabilities)).toBe(true)
      expect(agent.capabilities.length).toBeGreaterThan(0)
    }
  })

  it("getAgentCard returns correct card", () => {
    const build = getAgentCard("build")
    expect(build).toBeDefined()
    expect(build!.name).toBe("build")
    expect(build!.mode).toBe("primary")
  })

  it("getAgentCard returns undefined for unknown agent", () => {
    expect(getAgentCard("unknown")).toBeUndefined()
  })

  it("each agent with protocol has a protocol.md file", () => {
    for (const agent of agents) {
      if (!agent.protocol) continue
      const fullPath = path.join(packageRoot, "src", "agent", agent.name, "protocol.md")
      expect(existsSync(fullPath)).toBe(true)
      const content = readFileSync(fullPath, "utf-8")
      expect(content).toContain("## ")
    }
  })

  it("protocol.md files contain ## Role section", () => {
    for (const agent of agents) {
      if (!agent.protocol) continue
      const fullPath = path.join(packageRoot, "src", "agent", agent.name, "protocol.md")
      const content = readFileSync(fullPath, "utf-8")
      expect(content).toContain("## ")
    }
  })

  it("protocol.md files do not exceed 25 lines", () => {
    for (const agent of agents) {
      if (!agent.protocol) continue
      const fullPath = path.join(packageRoot, "src", "agent", agent.name, "protocol.md")
      const lineCount = readFileSync(fullPath, "utf-8").split("\n").length
      expect(lineCount).toBeLessThanOrEqual(25)
    }
  })
})
