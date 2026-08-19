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

  test("Profile decodes valid profile structure", () => {
    const decoded = Schema.decodeUnknownSync(CustomProfile.Profile)(validProfile)
    expect(decoded.kind).toBe("custom-profile")
    expect(String(decoded.name)).toBe("release-review")
    expect(decoded.agents.length).toBe(1)
    expect(decoded.presentation).toBe("native")
  })

  test("Profile rejects zero agents (M1 cardinality)", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: [],
      }),
    ).toThrow()
  })

  test("Profile rejects more than one agent (M1 cardinality)", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomProfile.Profile)({
        ...validProfile,
        agents: [
          { kind: "agent", relativePath: "a1.md", revision: "a".repeat(64) },
          { kind: "agent", relativePath: "a2.md", revision: "b".repeat(64) },
        ],
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
      revision: "d".repeat(64),
    })
    expect(s.kind).toBe("custom-profile")
    expect(String(s.name)).toBe("test-profile")
  })

  test("Candidate decodes candidate fields", () => {
    const c = Schema.decodeUnknownSync(CustomProfile.Candidate)({
      name: "test-profile",
      description: "A test profile",
      relativePath: "test-profile.yaml",
      profile: validProfile,
    })
    expect(String(c.name)).toBe("test-profile")
    expect(c.profile.kind).toBe("custom-profile")
  })
})
