import { describe, expect, test } from "bun:test"
import {
  createCustomDraftState,
  createCustomDraftStore,
  toCompositionInput,
  type CustomDraftState,
} from "@/context/custom-draft"
import { Digest, Revision, type Snapshot } from "@aigcfroge/schema/composition"

describe("custom-draft store", () => {
  test("initializes with default state", () => {
    const store = createCustomDraftState()
    expect(store.state.source).toBe("temporary")
    expect(store.state.agents).toEqual([])
    expect(store.state.bindings).toEqual({})
    expect(store.state.requestedCapabilities).toEqual([])
  })

  test("adds and removes agents without duplicating a relativePath", () => {
    const store = createCustomDraftState()
    store.reset()

    store.addAgent({
      kind: "agent",
      relativePath: "agent1.md",
      revision: "rev1",
      name: "agent1",
    })

    expect(store.state.agents.length).toBe(1)

    store.addAgent({
      kind: "agent",
      relativePath: "agent2.md",
      revision: "rev2",
      name: "agent2",
    })

    expect(store.state.agents.length).toBe(2)

    store.removeAgent("agent1.md")
    expect(store.state.agents.length).toBe(1)
    expect(store.state.agents[0]?.name).toBe("agent2")
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

  test("toggles command bindings per consumer and serializes them", () => {
    const store = createCustomDraftState()
    store.reset()

    store.toggleCommand("agents/reviewer", {
      kind: "command",
      relativePath: "commands/review.md",
      revision: "rev-command",
      name: "review",
    })

    expect(store.state.bindings["agents/reviewer"]?.commands).toEqual([
      {
        kind: "command",
        relativePath: "commands/review.md",
        revision: "rev-command",
        name: "review",
      },
    ])
    expect(store.composition).toMatchObject({
      source: "temporary",
      bindings: {
        "agents/reviewer": {
          prompts: [],
          skills: [],
          commands: [{ kind: "command", relativePath: "commands/review.md", revision: "rev-command" }],
        },
      },
    })

    store.toggleCommand("agents/reviewer", {
      kind: "command",
      relativePath: "commands/review.md",
      revision: "rev-command",
      name: "review",
    })
    expect(store.state.bindings["agents/reviewer"]?.commands).toEqual([])
  })

  test("selects a single workflow: toggling a second one replaces it, toggling the same one clears it", () => {
    // Replaces the source-string assertions in `custom-builder-contract.test.ts`,
    // which checked that `custom-sidebar.tsx` contained the text "toggleWorkflow".
    // The behaviour worth pinning is that this "toggle" is single-select — a draft
    // holds at most one workflow, so picking a second silently drops the first.
    const store = createCustomDraftState()
    store.reset()
    const first = { kind: "workflow" as const, relativePath: "workflows/a.yaml", revision: "rev-a", name: "a" }
    const second = { kind: "workflow" as const, relativePath: "workflows/b.yaml", revision: "rev-b", name: "b" }

    store.toggleWorkflow(first)
    expect(store.state.workflow?.relativePath).toBe("workflows/a.yaml")
    expect(store.composition).toMatchObject({
      workflow: { kind: "workflow", relativePath: "workflows/a.yaml", revision: "rev-a" },
    })

    store.toggleWorkflow(second)
    expect(store.state.workflow?.relativePath).toBe("workflows/b.yaml")

    store.toggleWorkflow(second)
    expect(store.state.workflow).toBeUndefined()
    // `composition` is a union and only the temporary arm carries `workflow`, so
    // narrow rather than assert.
    const composition = store.composition
    if (composition.source !== "temporary") throw new Error("expected a temporary composition")
    expect(composition.workflow).toBeUndefined()
  })

  test("removes agent-scoped bindings when the agent leaves the pool", () => {
    const store = createCustomDraftState()
    store.reset()
    store.addAgent({ kind: "agent", relativePath: "reviewer.md", revision: "rev-agent", name: "reviewer" })
    store.toggleCommand("agents/reviewer", {
      kind: "command",
      relativePath: "commands/review.md",
      revision: "rev-command",
      name: "review",
    })

    store.removeAgent("reviewer.md")

    expect(store.state.bindings["agents/reviewer"]).toBeUndefined()
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
      digest: Digest.make("a".repeat(64)),
      createdAt: Date.now(),
      data: {
        agentID: "reviewer",
        instructions: [],
        prompts: [{ relativePath: "code-review.md", revision: Revision.make("c".repeat(64)), content: "" }],
        skills: [
          { name: "git-diff", description: "", relativePath: "git-diff", revision: Revision.make("d".repeat(64)) },
        ],
        tools: { fingerprints: [], catalogDigest: Digest.make("b".repeat(64)), catalog: [] },
      },
    }

    store.loadFromSnapshot(snapshot)
    expect(store.state.source).toBe("temporary")
    expect(store.state.agents[0]?.name).toBe("reviewer")
    expect(store.state.bindings["orchestrator"]?.prompts[0]?.relativePath).toBe("code-review.md")
    expect(store.state.bindings["orchestrator"]?.skills[0]?.name).toBe("git-diff")
  })

  test("loads from v2 snapshot with multi-agent pool and workflow", () => {
    const store = createCustomDraftState()
    const snapshot: Snapshot = {
      version: 2,
      digest: Digest.make("a".repeat(64)),
      createdAt: Date.now(),
      data: {
        agents: [
          {
            id: "coder",
            name: "coder",
            description: "Coder agent",
            relativePath: "coder.md",
            revision: Revision.make("c".repeat(64)),
          },
          {
            id: "reviewer",
            name: "reviewer",
            description: "Reviewer agent",
            relativePath: "reviewer.md",
            revision: Revision.make("d".repeat(64)),
          },
        ],
        workflow: {
          name: "ci-flow",
          description: "CI workflow",
          relativePath: "ci-flow.yaml",
          revision: Revision.make("e".repeat(64)),
          steps: [
            {
              id: "step_1",
              name: "Code",
              agent: "coder",
              input: {},
              failurePolicy: "abort",
              maxAttempts: 1,
              timeoutSeconds: 60,
            },
          ],
        },
        bindings: {
          orchestrator: {
            instructions: [],
            prompts: [{ relativePath: "guide.md", revision: Revision.make("f".repeat(64)), content: "" }],
            skills: [{ name: "bash", description: "", relativePath: "bash", revision: Revision.make("1".repeat(64)) }],
            commands: [],
          },
        },
        maxConcurrency: 2,
        commands: [],
        instructions: [],
        prompts: [{ relativePath: "guide.md", revision: Revision.make("f".repeat(64)), content: "" }],
        skills: [{ name: "bash", description: "", relativePath: "bash", revision: Revision.make("1".repeat(64)) }],
        tools: { fingerprints: [], catalogDigest: Digest.make("b".repeat(64)), catalog: [] },
        mcp: { bindings: [], tools: [] },
      },
    }

    store.loadFromSnapshot(snapshot)
    expect(store.state.source).toBe("temporary")
    expect(store.state.agents.length).toBe(2)
    expect(store.state.workflow?.name).toBe("ci-flow")
    expect(store.state.bindings["orchestrator"]?.prompts[0]?.relativePath).toBe("guide.md")
  })

  test("loads consumer-scoped v2 snapshot command bindings", () => {
    const store = createCustomDraftState()
    const snapshot: Snapshot = {
      version: 2,
      digest: Digest.make("a".repeat(64)),
      createdAt: Date.now(),
      data: {
        agents: [
          {
            id: "coder",
            name: "coder",
            description: "Coder agent",
            relativePath: "coder.md",
            revision: Revision.make("c".repeat(64)),
          },
        ],
        workflow: null,
        bindings: {
          "agents/coder": {
            instructions: [],
            prompts: [],
            skills: [],
            commands: [
              {
                name: "review",
                description: "Review changes",
                relativePath: "commands/review.md",
                revision: Revision.make("e".repeat(64)),
                invocation: "/review",
              },
            ],
          },
        },
        maxConcurrency: 1,
        commands: [
          {
            name: "review",
            description: "Review changes",
            relativePath: "commands/review.md",
            revision: Revision.make("e".repeat(64)),
            invocation: "/review",
          },
        ],
        instructions: [],
        prompts: [],
        skills: [],
        tools: { fingerprints: [], catalogDigest: Digest.make("b".repeat(64)), catalog: [] },
        mcp: { bindings: [], tools: [] },
      },
    }

    store.loadFromSnapshot(snapshot)
    expect(store.state.bindings["agents/coder"]?.commands).toEqual([
      {
        kind: "command",
        relativePath: "commands/review.md",
        revision: Revision.make("e".repeat(64)),
        name: "review",
        description: "Review changes",
      },
    ])
  })

  test("converts draft state to CompositionInput schema", () => {
    const tempState: CustomDraftState = {
      source: "temporary",
      title: "Test Title",
      agents: [{ kind: "agent", relativePath: "agent1.md", revision: "rev1", name: "agent1" }],
      bindings: {
        orchestrator: {
          prompts: [{ kind: "prompt", relativePath: "p1.md", revision: "revP" }],
          skills: [{ kind: "skill", relativePath: "s1.md", revision: "revS" }],
          commands: [{ kind: "command", relativePath: "c1.md", revision: "revC" }],
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
      expect(comp.bindings["orchestrator"]?.commands).toEqual([
        { kind: "command", relativePath: "c1.md", revision: "revC" },
      ])
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

describe("createCustomDraftStore", () => {
  test("returns an independent store per call, with no instance cache", () => {
    // The module-level `sharedStores` map is gone: the Custom Sidebar and Main share a
    // store because `ModeWorkspace` owns one Provider above both slots, not because a
    // global map hands them the same object. Pinned here because the cache was also
    // what made an inline `value={createCustomDraftStore(...)}` look harmless — see
    // `CustomDraftScope`. Only the unresolved-Location path is reachable from a unit
    // test; the persisted path needs `usePlatform()`.
    const first = createCustomDraftStore(undefined)
    const second = createCustomDraftStore(undefined)

    expect(first).not.toBe(second)
    first.setTitle("only mine")
    expect(second.state.title).toBe("")
  })
})
