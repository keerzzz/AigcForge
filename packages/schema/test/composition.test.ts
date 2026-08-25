import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
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

  const workflowRef = {
    kind: "workflow" as const,
    relativePath: "review-flow.yaml",
    revision: "d".repeat(64),
  }

  const commandRef = {
    kind: "command" as const,
    relativePath: "lint.yaml",
    revision: "e".repeat(64),
  }

  test("AssetRef decodes valid agent, prompt, skill, workflow, and command refs", () => {
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(agentRef).kind).toBe("agent")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(promptRef).kind).toBe("prompt")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(skillRef).kind).toBe("skill")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(workflowRef).kind).toBe("workflow")
    expect(Schema.decodeUnknownSync(Composition.AssetRef)(commandRef).kind).toBe("command")
  })

  test("AssetRef accepts M3 MCP refs and still rejects unsupported kinds", () => {
    const mcp = Schema.decodeUnknownSync(Composition.AssetRef)({
      kind: "mcp",
      relativePath: "mcp.json",
      revision: "a".repeat(64),
    })
    expect(mcp.kind).toBe("mcp")
    expect(() =>
      Schema.decodeUnknownSync(Composition.AssetRef)({
        kind: "plugin",
        relativePath: "plugin.json",
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

  test("Plan decodes full plan record with version=2 and costPreview", () => {
    const plan = Schema.decodeUnknownSync(Composition.Plan)({
      version: 2,
      digest: "e".repeat(64),
      valid: true,
      input: {
        source: "temporary",
        agents: [agentRef, { kind: "agent", relativePath: "coder.md", revision: "f".repeat(64) }],
        workflow: workflowRef,
        bindings: {
          orchestrator: { prompts: [], skills: [] },
          "agents/reviewer": { prompts: [promptRef], skills: [skillRef], commands: [commandRef] },
        },
        presentation: "native",
        requestedCapabilities: [],
      },
      agents: [
        {
          id: "reviewer",
          name: "reviewer",
          description: "A code reviewer",
          relativePath: "reviewer.md",
          revision: "a".repeat(64),
        },
      ],
      workflow: {
        name: "review-flow",
        description: "Review workflow",
        relativePath: "review-flow.yaml",
        revision: "d".repeat(64),
        steps: [
          { id: "step_1", name: "Step 1", agent: "reviewer", failurePolicy: "abort", maxAttempts: 1 },
        ],
      },
      commands: [
        {
          name: "lint",
          description: "Run linter",
          relativePath: "lint.yaml",
          revision: "e".repeat(64),
          template: "bun run lint --filter {target}",
        },
      ],
      instructions: [
        { source: "platform", content: "Platform baseline" },
      ],
      skills: [],
      capabilities: [
        { id: "product-mode-custom-v1", status: "effective" },
      ],
      costPreview: {
        estimatedTokens: 12000,
        maxConcurrency: 4,
        effectiveToolCount: 10,
        agentCount: 2,
      },
      diagnostics: [],
    })
    expect(plan.version).toBe(2)
    expect(plan.valid).toBe(true)
    expect(plan.costPreview?.estimatedTokens).toBe(12000)
    expect(plan.workflow?.name).toBe("review-flow")
  })

  test("Snapshot decodes with version=1 and data (M1 backwards compatibility)", () => {
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

  test("Snapshot decodes with version=2 and multi-agent + workflow data", () => {
    const snap = Schema.decodeUnknownSync(Composition.Snapshot)({
      version: 2,
      digest: "f".repeat(64),
      createdAt: 10000,
      data: {
        agents: [
          {
            id: "reviewer",
            name: "reviewer",
            description: "Desc",
            relativePath: "reviewer.md",
            revision: "a".repeat(64),
          },
        ],
        workflow: {
          name: "review-flow",
          description: "Review workflow",
          relativePath: "review-flow.yaml",
          revision: "d".repeat(64),
          steps: [
            { id: "step_1", name: "Step 1", agent: "reviewer", failurePolicy: "abort", maxAttempts: 1 },
          ],
        },
        commands: [
          {
            name: "lint",
            description: "Run linter",
            relativePath: "lint.yaml",
            revision: "e".repeat(64),
            template: "bun run lint",
          },
        ],
        bindings: {
          orchestrator: {
            prompts: [
              { relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" },
            ],
            skills: [],
            commands: [
              {
                name: "lint",
                description: "Run linter",
                relativePath: "lint.yaml",
                revision: "e".repeat(64),
                template: "bun run lint",
              },
            ],
          },
          "agents/reviewer": {
            prompts: [],
            skills: [
              { name: "review-skill", description: "Desc", relativePath: "skill.md", revision: "c".repeat(64) },
            ],
            commands: [],
          },
        },
        maxConcurrency: 4,
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
    expect(snap.version).toBe(2)
    expect(String(snap.digest)).toBe("f".repeat(64))
    if (snap.version === 2) {
      expect(snap.data.agents.length).toBe(1)
      expect(snap.data.workflow?.name).toBe("review-flow")
      expect(snap.data.bindings.orchestrator.commands[0].name).toBe("lint")
      expect(snap.data.bindings["agents/reviewer"].skills[0].name).toBe("review-skill")
      expect(snap.data.maxConcurrency).toBe(4)
    }
  })

  test("Snapshot v2 freezes maxConcurrency within 1..8", () => {
    const base = {
      agents: [],
      bindings: {},
      instructions: [],
      prompts: [],
      skills: [],
      tools: {
        fingerprints: [],
        catalogDigest: "b".repeat(64),
        catalog: [],
      },
    }

    expect(() => Schema.decodeUnknownSync(Composition.SnapshotDataV2)({ ...base, maxConcurrency: 0 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Composition.SnapshotDataV2)({ ...base, maxConcurrency: 9 })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
        ...base,
        bindings: { "steps/legacy": { prompts: [], skills: [], commands: [] } },
      }),
    ).toThrow()
    expect(Schema.decodeUnknownSync(Composition.SnapshotDataV2)({ ...base, maxConcurrency: 8 }).maxConcurrency).toBe(8)
  })

  test("Plan and legacy SnapshotV2 default MCP projections without opening a V3", () => {
    const plan = Schema.decodeUnknownSync(Composition.Plan)({
      version: 1,
      digest: "a".repeat(64),
      valid: true,
      input: {
        source: "temporary",
        agents: [],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      },
      instructions: [],
      skills: [],
      capabilities: [],
      diagnostics: [],
    })
    expect(plan.mcp).toEqual({ requested: [], effective: [], denied: [] })

    const snapshot = Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
      agents: [],
      bindings: {},
      instructions: [],
      prompts: [],
      skills: [],
      tools: { fingerprints: [], catalogDigest: "b".repeat(64), catalog: [] },
    })
    expect(snapshot.mcp).toEqual({ bindings: [], tools: [] })
  })

  test("Snapshot rejects unknown version (fail-closed)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Composition.Snapshot)({
        version: 3,
        digest: "f".repeat(64),
        createdAt: 10000,
        data: {},
      }),
    ).toThrow()
  })

  test("Snapshot encodes cleanly via Schema.encodeUnknownSync and Schema.encodeUnknownEffect", async () => {
    const rawData = {
      version: 2 as const,
      digest: "f".repeat(64),
      createdAt: 10000,
      data: {
        agents: [
          {
            id: "reviewer",
            name: "reviewer",
            description: "Desc",
            relativePath: "reviewer.md",
            revision: "a".repeat(64),
          },
        ],
        instructions: [{ source: "platform", content: "Platform baseline" }],
        prompts: [{ relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" }],
        skills: [],
        tools: {
          fingerprints: [],
          catalogDigest: "b".repeat(64),
          catalog: [],
        },
      },
    }

    const decoded = Schema.decodeUnknownSync(Composition.Snapshot)(rawData)
    const encodedSync = Schema.encodeUnknownSync(Composition.Snapshot)(decoded)
    expect(encodedSync).toBeDefined()
    expect((encodedSync as { version: number }).version).toBe(2)

    const encodedEffect = await Effect.runPromise(Schema.encodeUnknownEffect(Composition.Snapshot)(decoded))
    expect(encodedEffect).toBeDefined()
    expect((encodedEffect as { version: number }).version).toBe(2)
  })

  describe("mcpAuditMatchesCatalog", () => {
    // Regression: two canonical names differing only by `-` vs `_` order
    // DIFFERENTLY under localeCompare and the default comparator. The catalog is
    // stored in localeCompare order, so an audit list sorted with the default
    // comparator reports a mismatch on a perfectly healthy session. Both tool
    // names below pass Tool.validateName, so this is reachable input, not a
    // hypothetical.
    const canonical = ["mcp_git_list-files", "mcp_git_list_files"]
    const catalogOrder = [...canonical].toSorted((a, b) => a.localeCompare(b))

    test("the two comparators really do disagree on these names", () => {
      expect([...canonical].toSorted()).not.toEqual(catalogOrder)
    })

    test("matches a catalog whose mcp_ entries equal the audit identities", () => {
      const result = Composition.mcpAuditMatchesCatalog({
        catalog: ["bash", ...catalogOrder, "read"],
        auditToolNames: [...canonical].reverse(),
      })
      expect(result.matches).toBe(true)
      expect(result.catalogMcpTools).toEqual(catalogOrder)
    })

    test("reports a mismatch when an audit identity is missing", () => {
      const result = Composition.mcpAuditMatchesCatalog({
        catalog: catalogOrder,
        auditToolNames: [canonical[0]!],
      })
      expect(result.matches).toBe(false)
    })

    test("reports a mismatch when the audit carries a name the catalog lacks", () => {
      const result = Composition.mcpAuditMatchesCatalog({
        catalog: [canonical[0]!],
        auditToolNames: [canonical[0]!, "mcp_git_other"],
      })
      expect(result.matches).toBe(false)
    })

    test("ignores non-mcp catalog entries on both sides", () => {
      const result = Composition.mcpAuditMatchesCatalog({
        catalog: ["bash", "edit", "read"],
        auditToolNames: [],
      })
      expect(result.matches).toBe(true)
      expect(result.catalogMcpTools).toEqual([])
    })
  })
})
