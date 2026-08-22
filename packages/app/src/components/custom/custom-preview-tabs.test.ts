import { describe, expect, test } from "bun:test"
import type { Plan, Instruction } from "@aigcfroge/schema/composition"
import type { CompositionPlan } from "@aigcfroge/sdk/v2/client"
import { planPreviewSummary } from "./custom-preview-tabs"

describe("custom-preview-tabs model logic", () => {
  test("summarizes the server plan's workflow, agent pool, concurrency, and cost", () => {
    const plan: Partial<CompositionPlan> = {
      agents: [
        { id: "coder", name: "Coder", description: "", relativePath: "coder.md", revision: "" },
        { id: "reviewer", name: "Reviewer", description: "", relativePath: "reviewer.md", revision: "" },
      ],
      workflow: {
        name: "Release",
        description: "",
        relativePath: "release.yaml",
        revision: "",
        steps: [
          { id: "build", name: "Build", agent: "coder", input: {} },
          { id: "review", name: "Review", agent: "reviewer", next: "publish", input: {} },
          { id: "publish", name: "Publish", agent: "coder", input: {} },
        ],
      },
      costPreview: { estimatedTokens: 4200, maxConcurrency: 2, effectiveToolCount: 4, agentCount: 2 },
    }

    expect(planPreviewSummary(plan)).toEqual({
      workflowName: "Release",
      stepCount: 3,
      agentCount: 2,
      maxConcurrency: 2,
      estimatedTokens: 4200,
      effectiveToolCount: 4,
      edgeCount: 1,
    })
  })

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
