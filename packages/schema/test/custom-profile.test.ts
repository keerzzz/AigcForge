import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "../src/composition.js"
import { CustomProfile } from "../src/custom-profile.js"

describe("CustomProfile Schema", () => {
  const validProfile = {
    kind: "custom-profile",
    name: "release-review",
    description: "Review a release against project policy",
    agents: [
      {
        kind: "agent",
        relativePath: "reviewer.md",
        revision: "a".repeat(64),
      },
    ],
    bindings: {
      orchestrator: {
        prompts: [],
        skills: [],
      },
      "agents/reviewer": {
        prompts: [
          {
            kind: "prompt",
            relativePath: "release-policy.md",
            revision: "b".repeat(64),
          },
        ],
        skills: [
          {
            kind: "skill",
            relativePath: "review-checklist.md",
            revision: "c".repeat(64),
          },
        ],
      },
    },
    presentation: "native",
    requestedCapabilities: [],
  }

  test("Profile defaults M3 MCP bindings to an empty list for existing YAML", () => {
    const decoded = CustomProfile.decodeProfile(validProfile)
    expect(decoded.kind).toBe("custom-profile")
    expect(String(decoded.name)).toBe("release-review")
    expect(decoded.agents.length).toBe(1)
    expect(decoded.presentation).toBe("native")
    expect(decoded.mcpBindings).toEqual([])
    expect(decoded.root).toBeUndefined()
    expect(Object.hasOwn(Schema.encodeSync(CustomProfile.Profile)(decoded), "root")).toBe(false)
    const encoded = Schema.encodeSync(Schema.toCodecJson(CustomProfile.Profile))(decoded)
    if (encoded === null || typeof encoded !== "object" || Array.isArray(encoded))
      throw new Error("Expected an encoded Profile JSON object")
    expect(Object.hasOwn(encoded, "root")).toBe(false)
    expect(Schema.encodeSync(CustomProfile.Profile)(decoded).bindings["agents/reviewer"].prompts[0]).not.toHaveProperty(
      "target",
    )
    expect(Schema.encodeSync(CustomProfile.Profile)(decoded).bindings["agents/reviewer"].skills[0]).not.toHaveProperty(
      "target",
    )
  })

  test("Profile and Candidate preserve all three asset sources over runtime and JSON codecs", () => {
    const binding = {
      prompts: [
        {
          ...validProfile.bindings["agents/reviewer"].prompts[0],
          kind: "prompt" as const,
          target: { scope: "project" as const, root: "/project/.omnixa/prompts" },
        },
      ],
      skills: [
        {
          ...validProfile.bindings["agents/reviewer"].skills[0],
          kind: "skill" as const,
          target: { scope: "global" as const, root: "/global/skills" },
        },
      ],
      commands: [
        {
          kind: "command" as const,
          relativePath: "release.md",
          revision: "d".repeat(64),
          target: { scope: "location" as const, root: "/project/child/.omnixa/commands" },
        },
      ],
    }
    const profile = CustomProfile.decodeProfile({ ...validProfile, bindings: { "agents/reviewer": binding } })
    const encoded = Schema.encodeSync(CustomProfile.Profile)(profile)
    expect(encoded.bindings["agents/reviewer"]).toEqual(binding)
    expect(CustomProfile.decodeProfileJson(encoded)).toEqual(profile)
    const candidate = new CustomProfile.Candidate({
      name: profile.name,
      description: profile.description,
      relativePath: "selected-sources.yaml",
      profile,
    })
    const codec = Schema.toCodecJson(CustomProfile.Candidate)
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(candidate)).profile).toEqual(profile)
  })

  test("Profile rejects unsupported Agent, Workflow and MCP targets over both decoding boundaries", () => {
    const target = { scope: "project", root: "/project/.omnixa/assets" }
    const profiles = [
      { ...validProfile, agents: [{ ...validProfile.agents[0], target }] },
      {
        ...validProfile,
        workflow: { kind: "workflow", relativePath: "review.yaml", revision: "d".repeat(64), target },
      },
      {
        ...validProfile,
        mcpBindings: [
          {
            serverName: "search",
            ref: { relativePath: "search.md", revision: "f".repeat(64), target },
            transport: "stdio",
            command: ["bun", "server.ts"],
          },
        ],
      },
    ]
    profiles.forEach((profile) => {
      expect(() => CustomProfile.decodeProfile(profile)).toThrow()
      expect(() => CustomProfile.decodeProfileJson(profile)).toThrow()
    })
  })

  test("Profile and Candidate codecs preserve each captured builtin root with an empty agent pool", () => {
    ;(["build", "plan", "meta"] as const).forEach((id) => {
      const root = new Composition.BuiltinRoot({
        source: "builtin",
        id,
        revision: Composition.Revision.make("d".repeat(64)),
      })
      const profile = CustomProfile.decodeProfile({ ...validProfile, root, agents: [], bindings: {} })
      expect(profile.root).toBeInstanceOf(Composition.BuiltinRoot)
      expect(profile.root).toEqual(root)
      expect(profile.agents).toEqual([])
      const encoded = Schema.encodeSync(CustomProfile.Profile)(profile)
      expect(encoded.root).toEqual(Schema.encodeSync(Composition.BuiltinRoot)(root))
      expect(CustomProfile.decodeProfileJson(encoded).root).toEqual(root)
      const candidate = new CustomProfile.Candidate({
        name: profile.name,
        description: profile.description,
        relativePath: "captured-root.yaml",
        profile,
      })
      const codec = Schema.toCodecJson(CustomProfile.Candidate)
      const decoded = Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(candidate))
      expect(decoded.profile.root).toBeInstanceOf(Composition.BuiltinRoot)
      expect(decoded.profile.root).toEqual(root)
      expect(decoded.profile.agents).toEqual([])
    })
  })

  test("Profile requires a captured revision for an explicit root over runtime and JSON codecs", () => {
    ;[[], validProfile.agents].forEach((agents) => {
      const profile = { ...validProfile, root: { source: "builtin", id: "build" }, agents }
      expect(() => CustomProfile.decodeProfile(profile)).toThrow("captured revision")
      expect(() => CustomProfile.decodeProfileJson(profile)).toThrow("captured revision")
      expect(() =>
        Schema.decodeUnknownSync(Schema.toCodecJson(CustomProfile.Candidate))({
          name: profile.name,
          description: profile.description,
          relativePath: "uncaptured-root.yaml",
          profile,
        }),
      ).toThrow("captured revision")
    })
  })

  test("Profile and Candidate preserve an asset root with an empty user pool", () => {
    const root = Schema.decodeUnknownSync(Composition.AssetRoot)({
      source: "asset",
      id: "release-root",
      kind: "agent",
      relativePath: "release-root.md",
      revision: "e".repeat(64),
    })
    const profile = CustomProfile.decodeProfile({ ...validProfile, root, agents: [], bindings: {} })
    expect(profile.root).toBeInstanceOf(Composition.AssetRoot)
    expect(profile.root).toEqual(root)
    expect(CustomProfile.decodeProfileJson(Schema.encodeSync(CustomProfile.Profile)(profile)).root).toEqual(root)
    const candidate = new CustomProfile.Candidate({
      name: profile.name,
      description: profile.description,
      relativePath: "asset-root.yaml",
      profile,
    })
    const codec = Schema.toCodecJson(CustomProfile.Candidate)
    const decoded = Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(candidate))
    expect(decoded.profile.root).toEqual(root)
    expect(decoded.profile.agents).toEqual([])
    expect(decoded.profile.root).not.toHaveProperty("ref")
  })

  test("Profile root uses the builtin identity and revision contract", () => {
    ;[
      { source: "profile", id: "build", revision: "d".repeat(64) },
      { source: "builtin", id: "other", revision: "d".repeat(64) },
      { source: "builtin", id: "build", revision: "invalid" },
    ].forEach((root) => {
      expect(() => CustomProfile.decodeProfile({ ...validProfile, root })).toThrow()
      expect(() => CustomProfile.decodeProfileJson({ ...validProfile, root })).toThrow()
    })
  })

  test("Profile decoding routes MCP bindings through the strict canonical decoder", () => {
    const decoded = CustomProfile.decodeProfile({
      ...validProfile,
      mcpBindings: [
        {
          serverName: "project-search",
          ref: { relativePath: "project-search.md", revision: "f".repeat(64) },
          transport: "stdio",
          command: ["bun", "run", "server.ts"],
        },
      ],
    })
    expect(decoded.mcpBindings).toHaveLength(1)
    expect(decoded.mcpBindings[0]?.serverName).toBe("project-search")
    expect(() =>
      CustomProfile.decodeProfile({
        ...validProfile,
        mcpBindings: [
          {
            serverName: "poisoned",
            ref: { relativePath: "poisoned.md", revision: "f".repeat(64) },
            transport: "stdio",
            command: ["bun", "run", "server.ts"],
            authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwxyz012345",
          },
        ],
      }),
    ).toThrow()
  })

  test("Profile schema itself rejects secret-bearing MCP bindings before HTTP candidates can strip them", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        mcpBindings: [
          {
            serverName: "direct-poison",
            ref: { relativePath: "direct-poison.md", revision: "f".repeat(64) },
            transport: "stdio",
            command: ["bun", "run", "server.ts"],
            authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwxyz012345",
          },
        ],
      }),
    ).toThrow()
  })

  test("Profile decodes valid profile structure with multiple agents (M2)", () => {
    const multiAgentProfile = {
      ...validProfile,
      agents: [
        { kind: "agent", relativePath: "reviewer.md", revision: "a".repeat(64) },
        { kind: "agent", relativePath: "coder.md", revision: "b".repeat(64) },
      ],
      workflow: {
        kind: "workflow",
        relativePath: "review-flow.yaml",
        revision: "c".repeat(64),
      },
      bindings: {
        orchestrator: { prompts: [], skills: [] },
        "agents/reviewer": {
          prompts: [{ kind: "prompt", relativePath: "release-policy.md", revision: "b".repeat(64) }],
          skills: [],
          commands: [{ kind: "command", relativePath: "review.yaml", revision: "d".repeat(64) }],
        },
        "agents/coder": {
          prompts: [],
          skills: [{ kind: "skill", relativePath: "code.md", revision: "e".repeat(64) }],
        },
      },
    }
    const decoded = Schema.decodeUnknownSync(CustomProfile.Profile)(multiAgentProfile)
    expect(decoded.agents.length).toBe(2)
    expect(decoded.workflow?.relativePath).toBe("review-flow.yaml")
  })

  test("Root-less Profile rejects zero agents over runtime and JSON codecs", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: [],
      }),
    ).toThrow()
    expect(() => CustomProfile.decodeProfileJson({ ...validProfile, agents: [] })).toThrow()
  })

  test("Profile rejects more than 16 agents (M2 limit)", () => {
    const tooManyAgents = Array.from({ length: 17 }, (_, i) => ({
      kind: "agent",
      relativePath: `agent_${i}.md`,
      revision: "a".repeat(64),
    }))
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: tooManyAgents,
      }),
    ).toThrow()
    expect(() =>
      CustomProfile.decodeProfile({
        ...validProfile,
        root: { source: "builtin", id: "build", revision: "d".repeat(64) },
        agents: tooManyAgents,
      }),
    ).toThrow()
  })

  test("Profile rejects non-native presentation", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        presentation: "code",
      }),
    ).toThrow()
  })

  test("Profile rejects invalid revision format", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: [
          {
            kind: "agent",
            relativePath: "reviewer.md",
            revision: "invalid-rev",
          },
        ],
      }),
    ).toThrow()
  })

  test("Summary decodes summary fields", () => {
    const s = Schema.decodeUnknownSync(CustomProfile.Summary)({
      kind: "custom-profile",
      name: "test-profile",
      description: "A test profile",
      relativePath: "test-profile.yaml",
      revision: "a".repeat(64),
    })
    expect(s.kind).toBe("custom-profile")
    expect(String(s.name)).toBe("test-profile")
  })

  test("Candidate decodes candidate fields", () => {
    const c = Schema.decodeUnknownSync(CustomProfile.Candidate)({
      name: "candidate-profile",
      description: "A candidate profile",
      relativePath: "candidate.yaml",
      profile: validProfile,
    })
    expect(String(c.name)).toBe("candidate-profile")
  })

  // The HTTP boundary decodes wire JSON, which goes through the `toCodecJson`
  // link rather than the runtime declaration. The link target used to be the
  // plain binding class, so unknown keys were stripped and `POST
  // /custom-profile/apply` answered 200 with the credential silently dropped —
  // the exact silent-swallow the strict decoder exists to prevent. Patching the
  // link's getter does not fix it (the target decodes first) and removing the
  // link breaks every decode with `Expected null`, so the target itself is strict.
  describe("JSON codec path", () => {
    const json = CustomProfile.decodeProfileJson
    const binding = {
      serverName: "probe",
      ref: { relativePath: "probe.yaml", revision: "a".repeat(64) },
      transport: "remote" as const,
      url: "https://example.com/mcp",
    }
    const withBinding = (extra: Record<string, unknown>) => ({
      ...validProfile,
      mcpBindings: [{ ...binding, ...extra }],
    })

    test("rejects an unknown, secret-bearing binding key instead of stripping it", () => {
      expect(() => json(withBinding({ headers: { Authorization: "Bearer topsecrettoken1234567890" } }))).toThrow()
    })

    test("still admits a clean binding and preserves its fields", () => {
      const decoded = json(withBinding({}))
      expect(decoded.mcpBindings).toHaveLength(1)
      expect(decoded.mcpBindings[0]!.serverName).toBe("probe")
      expect(decoded.mcpBindings[0]!.url).toBe("https://example.com/mcp")
    })

    test("still enforces the transport and userinfo rules over JSON", () => {
      expect(() => json(withBinding({ transport: "stdio", url: undefined }))).toThrow()
      expect(() => json(withBinding({ url: "https://u:p@example.com/mcp" }))).toThrow()
    })
  })
})
