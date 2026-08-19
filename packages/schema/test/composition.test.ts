import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "../src/composition"

describe("Composition Schema", () => {
  const agentRef = {
    kind: "agent" as const,
    relativePath: "reviewer.md",
    revision: "a".repeat(64),
  }

  const promptRef = {
    kind: "prompt" as const,
    relativePath: "prompt.md",
    revision: "b".repeat(64),
  }

  const skillRef = {
    kind: "skill" as const,
    relativePath: "skill.md",
    revision: "c".repeat(64),
  }

  test("AssetRef decodes valid agent, prompt, and skill refs", () => {
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(agentRef).kind).toBe("agent")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(promptRef).kind).toBe("prompt")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(skillRef).kind).toBe("skill")
  })

  test("AssetRef rejects disallowed asset kind in M1", () => {
    expect(() =>
      Schema.decodeUnknownSync(Composition.AssetRef)({
        kind: "mcp",
        relativePath: "mcp.json",
        revision: "a".repeat(64),
      }),
    ).toThrow()
  })

  test("Consumer matches orchestrator and agents/<id>", () => {
    expect(String(Schema.decodeSync(Composition.Consumer)("orchestrator"))).toBe("orchestrator")
    expect(String(Schema.decodeSync(Composition.Consumer)("agents/reviewer"))).toBe("agents/reviewer")
    expect(String(Schema.decodeSync(Composition.Consumer)("agents/my-agent_1"))).toBe("agents/my-agent_1")
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("invalid-consumer")).toThrow()
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("agents/")).toThrow()
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("orchestrator/extra")).toThrow()
  })

  test("Diagnostic decodes with severity, code, and message", () => {
    const d = Schema.decodeUnknownSync(Composition.Diagnostic)({
      severity: "error",
      code: "missing_asset",
      message: "Referenced asset does not exist",
      path: "bindings.agents/reviewer.prompts[0]",
      asset: promptRef,
    })
    expect(d.severity).toBe("error")
    expect(d.code).toBe("missing_asset")
  })

  test("Health decodes healthy and degraded status", () => {
    const h = Schema.decodeUnknownSync(Composition.Health)({
      status: "healthy",
      diagnostics: [],
      staleRevisions: [],
    })
    expect(h.status).toBe("healthy")
  })

  test("Plan decodes full plan record with version=1", () => {
    const plan = Schema.decodeUnknownSync(Composition.Plan)({
      version: 1,
      digest: "e".repeat(64),
      valid: true,
      input: {
        source: "temporary",
        agents: [agentRef],
        bindings: {
          orchestrator: { prompts: [], skills: [] },
          "agents/reviewer": { prompts: [promptRef], skills: [skillRef] },
        },
        presentation: "native",
        requestedCapabilities: [],
      },
      agent: {
        id: "reviewer",
        name: "reviewer",
        description: "A code reviewer",
        relativePath: "reviewer.md",
        revision: "a".repeat(64),
      },
      instructions: [
        { source: "platform", content: "Platform baseline" },
        { source: "custom-mode", content: "Custom mode instruction" },
        { source: "agent", content: "Agent instruction" },
        { source: "prompt:prompt.md", content: "Prompt content" },
      ],
      skills: [
        {
          name: "review-skill",
          description: "Checklist for reviews",
          relativePath: "skill.md",
          revision: "c".repeat(64),
        },
      ],
      capabilities: [
        { id: "product-mode-custom-v1", status: "effective" },
      ],
      diagnostics: [],
    })
    expect(plan.version).toBe(1)
    expect(plan.valid).toBe(true)
    expect(String(plan.digest)).toBe("e".repeat(64))
  })

  test("Snapshot decodes with version=1 and data", () => {
    const snap = Schema.decodeUnknownSync(Composition.Snapshot)({
      version: 1,
      digest: "f".repeat(64),
      createdAt: 10000,
      data: {
        agentID: "reviewer",
        instructions: [
          { source: "platform", content: "Platform baseline" },
        ],
        prompts: [
          { relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" },
        ],
        skills: [
          { name: "review-skill", description: "Desc", relativePath: "skill.md", revision: "c".repeat(64) },
        ],
        tools: {
          fingerprints: [
            {
              placement: "location",
              name: "read",
              digest: "a".repeat(64),
              installationVersion: "test",
            },
          ],
          catalogDigest: "b".repeat(64),
          catalog: ["read", "write"],
        },
      },
    })
    expect(snap.version).toBe(1)
    expect(String(snap.digest)).toBe("f".repeat(64))
  })
})
