import { describe, expect, test } from "bun:test"
import { parseAgentFile } from "@aigcfroge/core/agent/file-loader"

const MINIMAL_AGENT = `\
---
name: Explore
description: Fast read-only codebase exploration agent
tools: [search, read, grep, glob]
user-invocable: false
---
You are an exploration agent.

Be concise and fast.
`

const FULL_AGENT = `\
---
name: Plan
description: Researches and outlines multi-step plans
model: Claude Haiku 4.5
tools: [search, read, web]
---
You are a planning agent.
`

describe("AgentFileLoader", () => {
  describe("parseAgentFile", () => {
    test("should parse minimal agent file", () => {
      const agent = parseAgentFile("/tmp/.claude/agents/explore.agent.md", MINIMAL_AGENT)
      expect(agent).toBeDefined()
      expect(agent!.info.id as string).toBe("Explore")
      expect(agent!.info.description).toBe("Fast read-only codebase exploration agent")
      expect(agent!.info.system).toBe("You are an exploration agent.\n\nBe concise and fast.")
      expect(agent!.info.hidden).toBe(true)
      expect(agent!.sourcePath).toBe("/tmp/.claude/agents/explore.agent.md")
    })

    test("should map tools to permissions", () => {
      const agent = parseAgentFile("test.agent.md", MINIMAL_AGENT)
      const actions = agent!.info.permissions.map((p) => p.action)
      expect(actions).toEqual(["search", "read", "grep", "glob"])
      for (const perm of agent!.info.permissions) {
        expect(perm.effect).toBe("allow")
        expect(perm.resource).toBe("*")
      }
    })

    test("should return undefined when name is missing", () => {
      const agent = parseAgentFile("test.agent.md", `\
---
description: No name
---
Just body
`)
      expect(agent).toBeUndefined()
    })

    test("should return undefined on invalid YAML", () => {
      const agent = parseAgentFile("test.agent.md", `\
---
name: test
invalid yaml: [unclosed
---
body
`)
      expect(agent).toBeUndefined()
    })

    test("should handle body without frontmatter", () => {
      const agent = parseAgentFile("test.agent.md", `\
---
name: Bare
---
`)
      expect(agent).toBeDefined()
      expect(agent!.info.id as string).toBe("Bare")
      expect(agent!.info.system).toBeUndefined()
    })

    test("should set user-invocable: false as hidden", () => {
      const agent = parseAgentFile("test.agent.md", `\
---
name: HiddenAgent
user-invocable: false
---
body
`)
      expect(agent!.info.hidden).toBe(true)
    })

    test("should default hidden to false", () => {
      const agent = parseAgentFile("test.agent.md", `\
---
name: VisibleAgent
---
body
`)
      expect(agent!.info.hidden).toBe(false)
    })

    test("should handle model as string", () => {
      const agent = parseAgentFile("test.agent.md", FULL_AGENT)
      expect(agent).toBeDefined()
      expect(agent!.info.id as string).toBe("Plan")
      expect(agent!.info.description).toBe("Researches and outlines multi-step plans")
      expect(agent!.info.system).toBe("You are a planning agent.")
    })
  })
})
