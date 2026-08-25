import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CustomProfile } from "../src/custom-profile"

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

  test("Profile rejects zero agents", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: [],
      }),
    ).toThrow()
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
})
