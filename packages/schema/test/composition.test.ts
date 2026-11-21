import { createHash } from "node:crypto"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { Composition } from "../src/composition.js"
import { Session } from "../src/session.js"
import { Location } from "../src/location.js"
import { AbsolutePath } from "../src/schema.js"

describe("Composition Schema", () => {
  test("consumer identity preserves the original POSIX basename and SHA-256 semantics", () => {
    const cases = [
      ["reviewer", "team/reviewer.md"],
      ["Code Reviewer", "team/code-reviewer.md"],
      ["审查员", "team/审查员.md"],
      ["审查员", "team\\reviewer.md"],
      ["审查员", "/.md/"],
      ["审查员", "team/名.md/"],
      ["", ""],
      [" A_1 ", "other.md"],
    ]
    for (const [name, relativePath] of cases) {
      const trimmed = name.trim()
      const basename = path.posix
        .basename(relativePath, ".md")
        .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/^_+|_+$/g, "")
      const original = /^[a-zA-Z0-9_-]+$/.test(trimmed)
        ? trimmed
        : basename || createHash("sha256").update(`${relativePath}:${name}`).digest("hex").slice(0, 12)
      expect(Composition.consumerKeyForAgent(name, relativePath)).toBe(`agents/${original}`)
    }
  })

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

  test("Prompt, Skill and Command sources roundtrip through runtime and JSON input codecs", () => {
    const input = {
      source: "temporary" as const,
      agents: [agentRef],
      bindings: {
        orchestrator: {
          prompts: [{ ...promptRef, target: { scope: "project" as const, root: "/project/.aigcfroge/prompts" } }],
          skills: [{ ...skillRef, target: { scope: "global" as const, root: "/global/skills" } }],
          commands: [
            { ...commandRef, target: { scope: "location" as const, root: "/project/child/.aigcfroge/commands" } },
          ],
        },
      },
      presentation: "native" as const,
      requestedCapabilities: [],
    }
    const decoded = Schema.decodeUnknownSync(Composition.TemporaryInput)(input)
    expect(Schema.encodeSync(Composition.TemporaryInput)(decoded)).toEqual(input)
    const codec = Schema.toCodecJson(Composition.TemporaryInput)
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(input))).toEqual(input)
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(decoded))).toEqual(decoded)
  })

  test("unsupported reference sources fail before runtime and JSON codecs can discard the target", () => {
    const target = { scope: "project", root: "/project/.aigcfroge/assets" }
    const refs = [agentRef, workflowRef, { kind: "mcp", relativePath: "search.md", revision: "f".repeat(64) }]
    const codec = Schema.toCodecJson(Composition.AssetRef)
    refs.forEach((ref) => {
      expect(() => Schema.decodeUnknownSync(Composition.AssetRef)({ ...ref, target })).toThrow()
      expect(() => Schema.decodeUnknownSync(codec)({ ...ref, target })).toThrow()
    })
    expect(() =>
      Schema.decodeUnknownSync(Composition.Root)({ ...agentRef, source: "asset", id: "reviewer", target }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Schema.toCodecJson(Composition.Root))({
        ...agentRef,
        source: "asset",
        id: "reviewer",
        target,
      }),
    ).toThrow()
  })

  test("missing and undefined reference sources stay absent in encoded historical inputs", () => {
    const input = {
      source: "temporary" as const,
      agents: [agentRef],
      bindings: { orchestrator: { prompts: [promptRef], skills: [skillRef], commands: [commandRef] } },
      presentation: "native" as const,
      requestedCapabilities: [],
    }
    const decoded = Schema.decodeUnknownSync(Composition.TemporaryInput)(input)
    expect(Schema.encodeSync(Composition.TemporaryInput)(decoded)).toEqual(input)
    const codec = Schema.toCodecJson(Composition.TemporaryInput)
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(input))).toEqual(input)
    expect(
      Schema.encodeSync(Composition.PromptRef)(
        new Composition.PromptRef({
          ...decoded.bindings.orchestrator.prompts[0],
          target: undefined,
        }),
      ),
    ).toEqual(promptRef)
    expect(
      Schema.encodeSync(Composition.SkillRef)(
        new Composition.SkillRef({
          ...decoded.bindings.orchestrator.skills[0],
          target: undefined,
        }),
      ),
    ).toEqual(skillRef)
    expect(
      Schema.encodeSync(Composition.CommandRef)(
        new Composition.CommandRef({
          ...decoded.bindings.orchestrator.commands[0],
          target: undefined,
        }),
      ),
    ).toEqual(commandRef)
  })

  test("frozen bindings and stale revisions retain sources without altering stored digests", () => {
    const prompt = {
      relativePath: promptRef.relativePath,
      revision: promptRef.revision,
      content: "Captured prompt",
      target: { scope: "project" as const, root: "/project/.aigcfroge/prompts" },
    }
    const skill = {
      name: "checklist",
      description: "Captured skill",
      relativePath: skillRef.relativePath,
      revision: skillRef.revision,
      content: "Captured skill body",
      target: { scope: "global" as const, root: "/global/skills" },
    }
    const command = {
      name: "lint",
      description: "Captured command",
      relativePath: commandRef.relativePath,
      revision: commandRef.revision,
      invocation: "lint",
      source: "Captured command body",
      target: { scope: "location" as const, root: "/project/child/.aigcfroge/commands" },
    }
    const raw = {
      version: 2 as const,
      digest: "f".repeat(64),
      createdAt: 10000,
      data: {
        agents: [],
        maxConcurrency: 1,
        instructions: [],
        prompts: [prompt],
        skills: [skill],
        commands: [command],
        bindings: { orchestrator: { instructions: [], prompts: [prompt], skills: [skill], commands: [command] } },
        tools: { fingerprints: [], catalogDigest: "a".repeat(64), catalog: [] },
        mcp: { bindings: [], tools: [] },
      },
    }
    const decoded = Schema.decodeUnknownSync(Composition.SnapshotV2)(raw)
    expect(Schema.encodeSync(Composition.SnapshotV2)(decoded)).toEqual(raw)
    const codec = Schema.toCodecJson(Composition.SnapshotV2)
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(raw))).toEqual(raw)
    expect(Schema.encodeSync(Composition.SkillInfo)(Schema.decodeUnknownSync(Composition.SkillInfo)(skill))).toEqual({
      name: skill.name,
      description: skill.description,
      relativePath: skill.relativePath,
      revision: skill.revision,
      target: skill.target,
    })
    const stale = {
      kind: "prompt" as const,
      relativePath: prompt.relativePath,
      expectedRevision: prompt.revision,
      currentRevision: "a".repeat(64),
      target: prompt.target,
    }
    const health = { status: "degraded" as const, diagnostics: [], staleRevisions: [stale] }
    const healthCodec = Schema.toCodecJson(Composition.Health)
    expect(Schema.encodeSync(Composition.Health)(Schema.decodeUnknownSync(Composition.Health)(health))).toEqual(health)
    expect(Schema.encodeSync(healthCodec)(Schema.decodeUnknownSync(healthCodec)(health))).toEqual(health)
  })

  test("legacy frozen assets preserve missing targets in both snapshot versions", () => {
    const prompt = { relativePath: promptRef.relativePath, revision: promptRef.revision, content: "Legacy prompt" }
    const skill = {
      name: "checklist",
      description: "Legacy skill",
      relativePath: skillRef.relativePath,
      revision: skillRef.revision,
    }
    const base = {
      digest: "f".repeat(64),
      createdAt: 10000,
      data: {
        instructions: [],
        prompts: [prompt],
        skills: [skill],
        tools: { fingerprints: [], catalogDigest: "a".repeat(64), catalog: [] },
      },
    }
    const snapshots = [
      { ...base, version: 1 as const, data: { ...base.data, agentID: "reviewer" } },
      {
        ...base,
        version: 2 as const,
        data: { ...base.data, agents: [], maxConcurrency: 1, commands: [], mcp: { bindings: [], tools: [] } },
      },
    ]
    const codec = Schema.toCodecJson(Composition.Snapshot)
    snapshots.forEach((raw) => {
      expect(Schema.encodeSync(Composition.Snapshot)(Schema.decodeUnknownSync(Composition.Snapshot)(raw))).toEqual(raw)
      expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(raw))).toEqual(raw)
    })
  })

  test("Consumer matches orchestrator and agents/<id>", () => {
    expect(String(Schema.decodeSync(Composition.Consumer)("orchestrator"))).toBe("orchestrator")
    expect(String(Schema.decodeSync(Composition.Consumer)("agents/reviewer"))).toBe("agents/reviewer")
    expect(String(Schema.decodeSync(Composition.Consumer)("agents/my-agent_1"))).toBe("agents/my-agent_1")
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("invalid-consumer")).toThrow()
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("agents/")).toThrow()
    expect(() => Schema.decodeUnknownSync(Composition.Consumer)("orchestrator/extra")).toThrow()
  })

  test("FreezeInput retains optional string Session references without adding execution facts", () => {
    const input = { source: "profile" as const, profilePath: "review.yaml", profileRevision: "a".repeat(64) }
    const decoded = Schema.decodeUnknownSync(Composition.FreezeInput)({ input })
    expect(
      Schema.encodeSync(Composition.FreezeInput)(new Composition.FreezeInput({ ...decoded, sessionID: undefined })),
    ).toEqual({ input })
    expect(Schema.decodeUnknownSync(Composition.FreezeInput)({ input, sessionID: "preview-reference" }).sessionID).toBe(
      "preview-reference",
    )
  })

  test("builtin-root previews retain explicit source and adoption revision without asset references", () => {
    for (const id of ["build", "plan", "meta"] as const) {
      const preview = {
        source: "temporary" as const,
        root: { source: "builtin" as const, id },
        agents: [],
        bindings: {},
        presentation: "native" as const,
        requestedCapabilities: [],
      }
      expect(
        Schema.encodeSync(Composition.TemporaryInput)(Schema.decodeUnknownSync(Composition.TemporaryInput)(preview)),
      ).toEqual(preview)
      const adopted = { ...preview, root: { ...preview.root, revision: "a".repeat(64) } }
      expect(
        Schema.encodeSync(Composition.TemporaryInput)(Schema.decodeUnknownSync(Composition.TemporaryInput)(adopted)),
      ).toEqual(adopted)
    }
  })

  test("legacy temporary inputs retain their encoded identity without a root default", () => {
    const input = {
      source: "temporary" as const,
      agents: [agentRef],
      bindings: { orchestrator: { prompts: [], skills: [], commands: [] } },
      presentation: "native" as const,
      requestedCapabilities: [],
    }
    const encoded = Schema.encodeSync(Composition.TemporaryInput)(
      Schema.decodeUnknownSync(Composition.TemporaryInput)(input),
    )
    expect(encoded).toEqual(input)
    expect(Object.hasOwn(encoded, "root")).toBe(false)
  })

  test("asset roots reuse the agent reference and preserve source, ID and byte revision", () => {
    const root = { ...agentRef, source: "asset" as const, id: "reviewer" }
    const input = {
      source: "temporary" as const,
      root,
      agents: [],
      bindings: {},
      presentation: "native" as const,
      requestedCapabilities: [],
    }
    const decoded = Schema.decodeUnknownSync(Composition.TemporaryInput)(input)
    expect(decoded.root).toBeInstanceOf(Composition.AssetRoot)
    expect(Schema.encodeSync(Composition.TemporaryInput)(decoded)).toEqual(input)
    const codec = Schema.toCodecJson(Composition.TemporaryInput)
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(decoded))).toEqual(decoded)
    ;[
      { ...root, id: undefined },
      { ...root, kind: "prompt" },
      { ...root, relativePath: undefined },
      { ...root, revision: undefined },
      { ...root, revision: "not-a-file-revision" },
    ].forEach((invalid) => expect(() => Schema.decodeUnknownSync(Composition.Root)(invalid)).toThrow())
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
      capabilities: [{ id: "product-mode-custom-v1", status: "effective" }],
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
        steps: [{ id: "step_1", name: "Step 1", agent: "reviewer", failurePolicy: "abort", maxAttempts: 1 }],
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
      instructions: [{ source: "platform", content: "Platform baseline" }],
      skills: [],
      capabilities: [{ id: "product-mode-custom-v1", status: "effective" }],
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
        instructions: [{ source: "platform", content: "Platform baseline" }],
        prompts: [{ relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" }],
        skills: [{ name: "review-skill", description: "Desc", relativePath: "skill.md", revision: "c".repeat(64) }],
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
    expect(snap.data.skills[0].content).toBeUndefined()
    expect(snap.data.tools.capture).toBeUndefined()
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
          steps: [{ id: "step_1", name: "Step 1", agent: "reviewer", failurePolicy: "abort", maxAttempts: 1 }],
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
            prompts: [{ relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" }],
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
            skills: [{ name: "review-skill", description: "Desc", relativePath: "skill.md", revision: "c".repeat(64) }],
            commands: [],
          },
        },
        maxConcurrency: 4,
        instructions: [{ source: "platform", content: "Platform baseline" }],
        prompts: [{ relativePath: "prompt.md", revision: "b".repeat(64), content: "Prompt content" }],
        skills: [{ name: "review-skill", description: "Desc", relativePath: "skill.md", revision: "c".repeat(64) }],
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
      expect(snap.data.executors).toBeUndefined()
      expect(snap.data.orchestrator).toBeUndefined()
      expect(snap.data.tools.capture).toBeUndefined()
      expect(snap.data.workflow?.name).toBe("review-flow")
      expect(snap.data.bindings!.orchestrator.commands[0].name).toBe("lint")
      expect(snap.data.bindings!["agents/reviewer"].skills[0].name).toBe("review-skill")
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

  test("Snapshot MCP bindings retain frozen transport identity and omit absent historical fingerprints", () => {
    const binding = {
      serverName: "review-tools",
      ref: { kind: "mcp" as const, relativePath: "review-tools.json", revision: "a".repeat(64) },
      credentialRef: "credential:review-tools",
    }
    const frozen = Schema.decodeUnknownSync(Composition.SnapshotMcpInfo)({
      bindings: [{ ...binding, transportFingerprint: "b".repeat(64) }],
      tools: [],
    })
    expect(Schema.encodeSync(Composition.SnapshotMcpInfo)(frozen).bindings).toEqual([
      { ...binding, transportFingerprint: "b".repeat(64) },
    ])

    const legacy = Schema.decodeUnknownSync(Composition.SnapshotMcpBinding)(binding)
    expect(legacy.transportFingerprint).toBeUndefined()
    expect(
      Schema.encodeSync(Composition.SnapshotMcpBinding)(
        new Composition.SnapshotMcpBinding({ ...legacy, transportFingerprint: undefined }),
      ),
    ).toEqual(binding)
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

  describe("frozen execution data", () => {
    const skill = {
      name: "review-skill",
      description: "Review checklist",
      relativePath: skillRef.relativePath,
      revision: skillRef.revision,
    }
    const data = {
      agents: [
        {
          id: "reviewer",
          name: "reviewer",
          description: "Review code",
          relativePath: agentRef.relativePath,
          revision: agentRef.revision,
          consumerKey: "agents/reviewer",
        },
      ],
      bindings: {
        orchestrator: { instructions: [], prompts: [], skills: [], commands: [] },
        "agents/reviewer": { instructions: [], prompts: [], skills: [], commands: [] },
      },
      instructions: [],
      prompts: [],
      skills: [skill],
      tools: { fingerprints: [], catalogDigest: "b".repeat(64), catalog: [] },
    }

    test("preserves canonical Agent configuration, Skill bodies, and captured Tool definitions", () => {
      const orchestrator = Agent.Info.make({
        ...Agent.Info.empty(Agent.ID.make("meta")),
        name: Agent.Name.make("Meta"),
        mode: "primary",
        system: "Coordinate the frozen pool.",
        request: { settings: {}, headers: { "X-Root": "frozen" }, body: { root: true } },
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      })
      const executor = {
        id: "reviewer",
        relativePath: agentRef.relativePath,
        revision: agentRef.revision,
        info: {
          id: "reviewer",
          name: "Reviewer",
          model: { providerID: "openai", id: "review-model", variant: "fixed" },
          request: {
            settings: { temperature: 0.2 },
            headers: { "x-profile": "frozen" },
            body: { reasoning: { effort: "low" } },
          },
          system: "Frozen agent instructions",
          description: "Frozen reviewer",
          mode: "subagent" as const,
          hidden: false,
          steps: 3,
          permissions: [{ action: "read", resource: "*", effect: "allow" as const }],
          attended: false,
          handoffs: [],
          originRelativePath: agentRef.relativePath,
          originRevision: agentRef.revision,
        },
      }
      const capture = [
        {
          name: "read",
          placement: "codemode",
          description: "Read workspace files",
          input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          options: { namespace: "fs", codemode: true, permission: "read" },
        },
      ]
      const snapshot = Schema.decodeUnknownSync(Composition.SnapshotV2)({
        version: 2,
        digest: "f".repeat(64),
        createdAt: 10000,
        data: {
          ...data,
          sourceLocation: { directory: "/project#source", workspaceID: "wrk_source" },
          orchestrator,
          executors: [executor],
          skills: [{ ...skill, content: "Frozen shared checklist" }],
          bindings: {
            ...data.bindings,
            "agents/reviewer": {
              ...data.bindings["agents/reviewer"],
              skills: [{ ...skill, content: "Frozen reviewer checklist" }],
            },
          },
          tools: { ...data.tools, capture },
        },
      })
      const encoded = Schema.encodeSync(Composition.SnapshotV2)(snapshot)
      expect(encoded.data.sourceLocation).toEqual({ directory: "/project#source", workspaceID: "wrk_source" })
      expect(Schema.encodeSync(Location.Ref)(Location.Ref.make({ directory: AbsolutePath.make("/project") }))).toEqual({
        directory: "/project",
      })
      expect(Composition.SnapshotExecutorData.fields.info).toBe(Agent.Info)
      expect(snapshot.data.orchestrator).toEqual(orchestrator)
      expect(encoded.data.orchestrator).toEqual(Schema.encodeSync(Agent.Info)(orchestrator))
      expect(snapshot.data.executors?.[0].info).toEqual(Schema.decodeUnknownSync(Agent.Info)(executor.info))
      expect(encoded.data.executors).toEqual([executor])
      expect(encoded.data.skills[0].content).toBe("Frozen shared checklist")
      expect(encoded.data.bindings?.["agents/reviewer"].skills[0].content).toBe("Frozen reviewer checklist")
      expect(encoded.data.tools.capture).toEqual(capture)
    })

    test("keeps historical missing fields distinct from explicit empty frozen values", () => {
      const legacy = Schema.decodeUnknownSync(Composition.SnapshotDataV2)(data)
      const encoded = Schema.encodeSync(Composition.SnapshotDataV2)(
        new Composition.SnapshotDataV2({
          ...legacy,
          orchestrator: undefined,
          executors: undefined,
          skills: [new Composition.SnapshotSkillData({ ...legacy.skills[0], content: undefined })],
          tools: new Composition.SnapshotToolInfo({ ...legacy.tools, capture: undefined }),
        }),
      )
      expect(encoded).not.toHaveProperty("executors")
      expect(encoded).not.toHaveProperty("sourceLocation")
      expect(encoded).not.toHaveProperty("orchestrator")
      expect(encoded.tools).not.toHaveProperty("capture")
      expect(encoded.skills[0]).not.toHaveProperty("content")

      const empty = Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
        ...data,
        executors: [],
        skills: [{ ...skill, content: "" }],
        tools: { ...data.tools, capture: [] },
      })
      expect(empty.executors).toEqual([])
      expect(empty.tools.capture).toEqual([])
      expect(empty.skills[0].content).toBe("")
      expect(
        Schema.encodeSync(Composition.SkillInfo)(
          Schema.decodeUnknownSync(Composition.SkillInfo)({ ...skill, content: "" }),
        ),
      ).not.toHaveProperty("content")
    })

    test("rejects incomplete Agent configurations and non-JSON Tool capture", () => {
      expect(() =>
        Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
          ...data,
          orchestrator: { id: "meta", mode: "primary", hidden: false },
        }),
      ).toThrow()
      expect(() =>
        Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
          ...data,
          executors: [
            {
              id: "reviewer",
              relativePath: agentRef.relativePath,
              revision: agentRef.revision,
              info: { id: "reviewer", name: "Reviewer", mode: "subagent", hidden: false, handoffs: [] },
            },
          ],
        }),
      ).toThrow()
      expect(() =>
        Schema.decodeUnknownSync(Composition.SnapshotDataV2)({
          ...data,
          tools: { ...data.tools, capture: [{ name: "read", execute: () => undefined }] },
        }),
      ).toThrow()
    })

    test("StartResponse uses current Session.Info without legacy slug, version, or required title", () => {
      const response = {
        session: {
          id: "ses_current_custom",
          projectID: "global",
          mode: "custom",
          agent: "meta",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 10000, updated: 10000 },
          location: { directory: "/project" },
        },
        snapshot: { version: 2, digest: "f".repeat(64), createdAt: 10000, data },
      }
      const decoded = Schema.decodeUnknownSync(Composition.StartResponse)(response)
      const encoded = Schema.encodeSync(Composition.StartResponse)(decoded)
      expect(Composition.StartResponse.fields.session).toBe(Session.Info)
      expect(encoded.session).toEqual(Schema.encodeSync(Session.Info)(decoded.session))
      expect(encoded.session.id).toBe("ses_current_custom")
      expect(encoded.session).not.toHaveProperty("slug")
      expect(encoded.session).not.toHaveProperty("version")
      expect(encoded.session).not.toHaveProperty("title")
      expect(() =>
        Schema.decodeUnknownSync(Composition.StartResponse)({
          ...response,
          session: { ...response.session, id: "invalid" },
        }),
      ).toThrow()
    })
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
