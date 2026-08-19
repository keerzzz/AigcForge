import { describe, expect, test } from "bun:test"
import { createCustomDraftState, toCompositionInput, type CustomDraftState } from "@/context/custom-draft"
import { Digest, Revision, type Snapshot } from "@aigcfroge/schema/composition"

describe("custom-draft store", () => {
  test("initializes with default state", () => {
    const store = createCustomDraftState()
    expect(store.state.source).toBe("temporary")
    expect(store.state.primaryAgent).toBe("coder")
    expect(store.state.agents).toEqual([])
    expect(store.state.bindings).toEqual({})
    expect(store.state.requestedCapabilities).toEqual([])
  })

  test("adds and removes agents, automatically updating primary agent", () => {
    const store = createCustomDraftState()
    store.reset()

    store.addAgent({
      kind: "agent",
      relativePath: "agent1.md",
      revision: "rev1",
      name: "agent1",
    })

    expect(store.state.agents.length).toBe(1)
    expect(store.state.primaryAgent).toBe("agent1")

    store.addAgent({
      kind: "agent",
      relativePath: "agent2.md",
      revision: "rev2",
      name: "agent2",
    })

    expect(store.state.agents.length).toBe(2)
    expect(store.state.primaryAgent).toBe("agent1")

    store.removeAgent("agent1.md")
    expect(store.state.agents.length).toBe(1)
    expect(store.state.primaryAgent).toBe("agent2")
  })

  test("toggles prompts and skills in bindings", () => {
    const store = createCustomDraftState()
    store.reset()

    store.togglePrompt("orchestrator", {
      kind: "prompt",
      relativePath: "p1.md",
      revision: "rev1",
      name: "p1",
    })

    expect(store.state.bindings["orchestrator"]?.prompts.length).toBe(1)

    // Toggle off
    store.togglePrompt("orchestrator", {
      kind: "prompt",
      relativePath: "p1.md",
      revision: "rev1",
      name: "p1",
    })
    expect(store.state.bindings["orchestrator"]?.prompts.length).toBe(0)

    store.toggleSkill("orchestrator", {
      kind: "skill",
      relativePath: "s1.md",
      revision: "rev1",
      name: "s1",
    })
    expect(store.state.bindings["orchestrator"]?.skills.length).toBe(1)
  })

  test("toggles requested capabilities", () => {
    const store = createCustomDraftState()
    store.reset()

    store.toggleCapability("custom-cap-1")
    expect(store.state.requestedCapabilities).toEqual(["custom-cap-1"])

    store.toggleCapability("custom-cap-1")
    expect(store.state.requestedCapabilities).toEqual([])
  })

  test("loads from frozen snapshot", () => {
    const store = createCustomDraftState()
    const snapshot: Snapshot = {
      version: 1,
      digest: Digest.make("sha256:abcd1234abcd1234"),
      createdAt: Date.now(),
      data: {
        agentID: "reviewer",
        instructions: [],
        prompts: [{ relativePath: "code-review.md", revision: Revision.make("revP"), content: "" }],
        skills: [{ name: "git-diff", description: "", relativePath: "git-diff", revision: Revision.make("revS") }],
        tools: { fingerprints: [], catalogDigest: Digest.make("sha256:1"), catalog: [] },
      },
    }

    store.loadFromSnapshot(snapshot)
    expect(store.state.source).toBe("temporary")
    expect(store.state.primaryAgent).toBe("reviewer")
    expect(store.state.bindings["orchestrator"]?.prompts[0]?.relativePath).toBe("code-review.md")
    expect(store.state.bindings["orchestrator"]?.skills[0]?.name).toBe("git-diff")
  })

  test("converts draft state to CompositionInput schema", () => {
    const tempState: CustomDraftState = {
      source: "temporary",
      title: "Test Title",
      primaryAgent: "agent1",
      agents: [{ kind: "agent", relativePath: "agent1.md", revision: "rev1", name: "agent1" }],
      bindings: {
        orchestrator: {
          prompts: [{ kind: "prompt", relativePath: "p1.md", revision: "revP" }],
          skills: [{ kind: "skill", relativePath: "s1.md", revision: "revS" }],
        },
      },
      requestedCapabilities: ["cap1"],
      presentation: "native",
    }

    const comp = toCompositionInput(tempState)
    expect(comp.source).toBe("temporary")
    if (comp.source === "temporary") {
      expect(comp.bindings["orchestrator"]?.prompts.length).toBe(1)
      expect(comp.bindings["orchestrator"]?.skills.length).toBe(1)
      expect(comp.requestedCapabilities).toEqual(["cap1"])
    }

    const profileState: CustomDraftState = {
      ...tempState,
      source: "profile",
      profilePath: ".aigcfroge/profiles/custom.yaml",
      profileRevision: "revProf",
    }

    const profComp = toCompositionInput(profileState)
    expect(profComp.source).toBe("profile")
    if (profComp.source === "profile") {
      expect(profComp.profilePath).toBe(".aigcfroge/profiles/custom.yaml")
    }
  })
})
