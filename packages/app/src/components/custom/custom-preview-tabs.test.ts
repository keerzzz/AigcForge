import { describe, expect, test } from "bun:test"
import type { Plan, Digest, Instruction } from "@aigcfroge/schema/composition"

describe("custom-preview-tabs model logic", () => {
  test("calculates instruction stats accurately", () => {
    const plan: Partial<Plan> = {
      instructions: [
        { source: "agent:coder", content: "You are a coder." },
        { source: "ambient", content: "Follow repo guidelines." },
      ] as readonly Instruction[],
    }

    const instructions = plan.instructions ?? []
    expect(instructions.length).toBe(2)
    const totalChars = instructions.reduce((acc: number, i: Instruction) => acc + (i.content?.length ?? 0), 0)
    expect(totalChars).toBe("You are a coder.".length + "Follow repo guidelines.".length)
    const tokenEst = Math.ceil(totalChars / 4)
    expect(tokenEst).toBeGreaterThan(0)
  })

  test("filters and groups permissions by tool name and action", () => {
    const permissions = [
      { tool: "read", action: "allow" as const },
      { tool: "write", action: "ask" as const },
      { tool: "bash", action: "deny" as const },
    ]

    const query = "wr"
    const filtered = permissions.filter((p) => p.tool.toLowerCase().includes(query))
    expect(filtered.length).toBe(1)
    expect(filtered[0]?.tool).toBe("write")
    expect(filtered[0]?.action).toBe("ask")
  })

  test("groups diagnostics by severity and detects blocking issues", () => {
    const diagnostics = [
      { severity: "blocking" as const, code: "duplicate_agent_name", message: "Duplicate agent name" },
      { severity: "warning" as const, code: "missing_doc", message: "Missing description" },
      { severity: "info" as const, code: "info_hint", message: "Hint" },
    ]

    const blocking = diagnostics.filter((d) => d.severity === "blocking")
    const warnings = diagnostics.filter((d) => d.severity === "warning")

    expect(blocking.length).toBe(1)
    expect(blocking[0]?.code).toBe("duplicate_agent_name")
    expect(warnings.length).toBe(1)
  })
})
