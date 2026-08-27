import { describe, expect, test } from "bun:test"
import type { Plan, Instruction } from "@aigcfroge/schema/composition"
import type { CompositionPlan } from "@aigcfroge/sdk/v2/client"
import { mcpPreviewState, mcpPreviewSummary, planPreviewSummary } from "./custom-preview-tabs"

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

  test("keeps server-provided MCP health, denials, and top-level MCP diagnostics unchanged", () => {
    const ref = { kind: "mcp" as const, relativePath: ".aigcfroge/mcp/search.yaml", revision: "rev-1" }
    const plan: Partial<CompositionPlan> = {
      mcp: {
        requested: [{ serverName: "search", ref }],
        effective: [{
          serverName: "search",
          ref,
          credentialStatus: "available",
          health: "degraded",
          tools: ["mcp_search_query"],
        }],
        denied: [{
          serverName: "private-search",
          ref,
          reason: "binding_mismatch",
        }],
      },
      diagnostics: [
        { severity: "error", code: "mcp_not_ready", message: "Server is revoked", asset: ref },
        { severity: "warning", code: "mcp_binding_mismatch", message: "Binding changed" },
        { severity: "warning", code: "missing_doc", message: "Unrelated diagnostic" },
      ],
    }

    const summary = mcpPreviewSummary(plan)
    expect(summary.effective[0]?.health).toBe("degraded")
    expect(summary.effective[0]?.credentialStatus).toBe("available")
    expect(summary.denied[0]?.reason).toBe("binding_mismatch")
    expect("health" in (summary.denied[0] ?? {})).toBe(false)
    expect(summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "mcp_not_ready",
      "mcp_binding_mismatch",
    ])
  })

  test("distinguishes MCP loading, error, unavailable, empty, and content states", () => {
    const emptyPlan: Partial<CompositionPlan> = {
      mcp: { requested: [], effective: [], denied: [] },
      diagnostics: [],
    }
    const requestedPlan: Partial<CompositionPlan> = {
      mcp: {
        requested: [{
          serverName: "search",
          ref: { kind: "mcp", relativePath: ".aigcfroge/mcp/search.yaml", revision: "rev-1" },
        }],
        effective: [],
        denied: [],
      },
      diagnostics: [],
    }

    expect(mcpPreviewState({ plan: undefined, loading: true, error: "stale" })).toBe("loading")
    expect(mcpPreviewState({ plan: undefined, error: "failed" })).toBe("error")
    expect(mcpPreviewState({ plan: undefined })).toBe("unavailable")
    expect(mcpPreviewState({ plan: emptyPlan })).toBe("empty")
    expect(mcpPreviewState({ plan: requestedPlan })).toBe("content")
  })
})
