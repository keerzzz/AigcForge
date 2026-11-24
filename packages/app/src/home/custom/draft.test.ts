import { describe, expect, test } from "bun:test"
import { Composition } from "@omnixa/schema/composition"
import { CustomProfile } from "@omnixa/schema/custom-profile"
import type { CompositionSnapshotV2 } from "@omnixa/client/promise"
import {
  buildFirstPromptPayload,
  buildProfileCandidate,
  composeDraftFromProfile,
  composeDraftFromSnapshot,
  diagnoseWorkflowSteps,
  findDanglingBindingConsumers,
  initialComposeDraft,
  isScopedAssetKind,
  nextInputIDAfterEdit,
  preparePendingTaskStart,
  requiresProfileForMcp,
  toTemporaryCompositionInput,
  validateMcpBindingInput,
} from "./draft"

const revA = "a".repeat(64)
const revB = "b".repeat(64)
const revC = "c".repeat(64)

describe("custom workspace draft helpers", () => {
  test("preserves the implicit Meta root when editing a legacy root-less Profile", () => {
    const profile = CustomProfile.decodeProfile({
      kind: "custom-profile",
      name: "Legacy team",
      description: "Keep the original coordinator",
      agents: [{ kind: "agent", relativePath: "reviewer.md", revision: revA }],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
      mcpBindings: [],
    })
    const draft = composeDraftFromProfile({
      name: profile.name,
      description: profile.description,
      relativePath: "legacy.yaml",
      revision: revA,
      profile,
    })

    expect(draft.root).toMatchObject({ source: "builtin", id: "meta" })
    const candidate = buildProfileCandidate(draft, {
      source: "builtin",
      id: "meta",
      revision: Composition.Revision.make(revB),
    })
    expect(candidate.candidate?.profile.root).toMatchObject({ source: "builtin", id: "meta", revision: revB })
  })
  test("enforces scoped asset kinds strictly for prompt, skill, and command only", () => {
    expect(isScopedAssetKind("prompt")).toBe(true)
    expect(isScopedAssetKind("skill")).toBe(true)
    expect(isScopedAssetKind("command")).toBe(true)
    expect(isScopedAssetKind("agent")).toBe(false)
    expect(isScopedAssetKind("workflow")).toBe(false)
    expect(isScopedAssetKind("mcp")).toBe(false)
    expect(isScopedAssetKind("plugin")).toBe(false)
  })

  test("builds TemporaryInput with real role bindings and blocks silent MCP drop", () => {
    const draft = {
      ...initialComposeDraft("build"),
      agents: [{ kind: "agent" as const, relativePath: "reviewer.md", revision: revA, name: "reviewer" }],
      bindings: {
        orchestrator: {
          prompts: [
            {
              kind: "prompt" as const,
              relativePath: "lead.md",
              revision: revA,
              target: { scope: "project" as const, root: "/repo/.omnixa/prompts" },
            },
          ],
          skills: [],
          commands: [],
        },
        "agents/reviewer": {
          prompts: [],
          skills: [
            {
              kind: "skill" as const,
              relativePath: "audit/SKILL.md",
              revision: revB,
              target: { scope: "global" as const, root: "/home/.omnixa/skills" },
            },
          ],
          commands: [
            {
              kind: "command" as const,
              relativePath: "check.md",
              revision: revC,
              target: { scope: "location" as const, root: "/repo/.omnixa/commands" },
            },
          ],
        },
        "agents/empty": { prompts: [], skills: [], commands: [] },
      },
      workflow: { kind: "workflow" as const, relativePath: "review.yaml", revision: revA, name: "review" },
    }

    expect(requiresProfileForMcp(draft)).toBe(false)
    const temporary = toTemporaryCompositionInput(draft)
    expect(temporary).toBeDefined()
    expect(temporary?.bindings["agents/empty"]).toBeUndefined()
    expect(temporary?.bindings.orchestrator?.prompts[0]?.target?.scope).toBe("project")
    expect(temporary?.bindings["agents/reviewer"]?.skills[0]?.target?.scope).toBe("global")
    expect(temporary?.bindings["agents/reviewer"]?.commands[0]?.target?.scope).toBe("location")
    expect(temporary?.workflow?.relativePath).toBe("review.yaml")

    const withMcp = {
      ...draft,
      mcpBindings: [
        {
          serverName: "docs",
          ref: { relativePath: "docs.md", revision: revA },
          transport: "remote" as const,
          url: "https://example.com/mcp",
        },
      ],
    }
    expect(requiresProfileForMcp(withMcp)).toBe(true)
    expect(toTemporaryCompositionInput(withMcp)).toBeUndefined()
  })

  test("validates MCP bindings strictly and rejects embedded credentials", () => {
    expect(
      validateMcpBindingInput({
        serverName: "docs",
        ref: { relativePath: "docs.md", revision: revA },
        transport: "remote",
        url: "https://user:secret@example.com/mcp",
      }).valid,
    ).toBe(false)

    expect(
      validateMcpBindingInput({
        serverName: "docs",
        ref: { relativePath: "docs.md", revision: revA },
        transport: "remote",
        url: "https://example.com/mcp",
        credentialRef: "cred_docs_token",
      }).valid,
    ).toBe(true)
  })

  test("builds CustomProfile candidate with role bindings, workflow, and MCP bindings", () => {
    const draft = {
      ...initialComposeDraft("build"),
      name: "Review Team",
      description: "Lead + Reviewer",
      path: "team/review.yaml",
      agents: [{ kind: "agent" as const, relativePath: "reviewer.md", revision: revA, name: "reviewer" }],
      bindings: {
        "agents/reviewer": {
          prompts: [{ kind: "prompt" as const, relativePath: "review.md", revision: revB }],
          skills: [],
          commands: [],
        },
      },
      workflow: { kind: "workflow" as const, relativePath: "review.yaml", revision: revC },
      mcpBindings: [
        {
          serverName: "docs",
          ref: { relativePath: "docs.md", revision: revA },
          transport: "stdio" as const,
          command: ["npx", "docs-mcp"],
        },
      ],
    }

    // Without resolved builtin root revision, save is refused.
    expect(buildProfileCandidate(draft).error).toBe("missing_root_revision")

    const built = buildProfileCandidate(
      draft,
      new Composition.BuiltinRoot({ source: "builtin", id: "build", revision: Composition.Revision.make(revA) }),
    )
    expect(built.error).toBeUndefined()
    expect(built.candidate?.profile.bindings["agents/reviewer"]?.prompts[0]?.relativePath).toBe("review.md")
    expect(built.candidate?.profile.workflow?.relativePath).toBe("review.yaml")
    expect(built.candidate?.profile.mcpBindings).toHaveLength(1)
  })

  test("diagnoses workflow step executors without counting root as an executor", () => {
    const diagnostics = diagnoseWorkflowSteps(
      [
        { id: "s1", name: "Plan", agent: "build" },
        { id: "s2", name: "Review", agent: "reviewer" },
        { id: "s3", name: "Audit", agent: "auditor" },
      ],
      [{ id: "reviewer", name: "reviewer" }],
      "build",
    )

    expect(diagnostics[0]).toMatchObject({ stepID: "s1", matched: false, matchesRootOnly: true })
    expect(diagnostics[1]).toMatchObject({ stepID: "s2", matched: true, matchesRootOnly: false })
    expect(diagnostics[2]).toMatchObject({ stepID: "s3", matched: false, matchesRootOnly: false })
  })

  test("detects dangling role bindings when a member is removed", () => {
    const dangling = findDanglingBindingConsumers(
      {
        orchestrator: { prompts: [{ kind: "prompt", relativePath: "a.md", revision: revA }], skills: [], commands: [] },
        "agents/removed": {
          prompts: [],
          skills: [{ kind: "skill", relativePath: "s/SKILL.md", revision: revB }],
          commands: [],
        },
      },
      ["agents/active"],
    )
    expect(dangling).toEqual(["agents/removed"])
  })

  test("preserves IDs on retry and allocates a new input ID after admission edit", () => {
    const first = preparePendingTaskStart(undefined, "Audit src/app.ts", [])
    expect(first.stage).toBe("creating")

    // Retrying with identical content reuses the exact sessionID and firstInputID.
    const retry = preparePendingTaskStart({ ...first, stage: "admit_unknown" }, "Audit src/app.ts", [])
    expect(retry.sessionID).toBe(first.sessionID)
    expect(retry.firstInputID).toBe(first.firstInputID)

    // Editing an uncertain admission keeps the created Session but uses a fresh input ID.
    const openFailed = nextInputIDAfterEdit(
      { ...first, stage: "admit_unknown", createdSessionID: first.sessionID },
      "Audit src/app.ts and tests",
      [],
    )
    expect(openFailed?.createdSessionID).toBe(first.sessionID)
    expect(openFailed?.firstInputID).not.toBe(first.firstInputID)

    // Editing after admission clears the admitted attempt so the next send allocates a fresh input ID.
    expect(nextInputIDAfterEdit({ ...first, stage: "admitted" }, "New prompt", [])).toBeUndefined()

    const payload = buildFirstPromptPayload({
      sessionID: first.sessionID,
      firstInputID: first.firstInputID,
      directory: "/repo",
      text: "Check these files",
      materials: [
        { id: "m1", kind: "file", path: "src/a b.ts", name: "a b.ts", mime: "text/plain" },
        {
          id: "m2",
          kind: "image",
          path: "shot.png",
          name: "shot.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
    })
    expect(payload.id).toBe(first.firstInputID)
    expect(payload.files).toEqual([
      { uri: "file:///repo/src/a%20b.ts", name: "a b.ts" },
      { uri: "data:image/png;base64,AA==", name: "shot.png" },
    ])
  })

  test("hydrates a ComposeDraft from a SnapshotV2 without mutating the snapshot", () => {
    const snapshot: CompositionSnapshotV2 = {
      version: 2,
      sessionID: "ses_1",
      digest: revA,
      createdAt: 1,
      profilePath: "team/review.yaml",
      profileRevision: revB,
      data: {
        root: { source: "builtin", id: "build", revision: revA },
        agents: [],
        executors: [
          {
            id: "reviewer",
            relativePath: "reviewer.md",
            revision: revC,
            info: {
              id: "reviewer",
              name: "reviewer",
              description: "Reviews changes",
              mode: "subagent",
              permissions: [],
              request: { settings: {}, headers: {}, body: {} },
              hidden: false,
              handoffs: [],
            },
          },
        ],
        bindings: {
          "agents/reviewer": {
            prompts: [
              {
                relativePath: "review.md",
                revision: revB,
                content: "Review.",
                target: { scope: "project", root: "/repo/.omnixa/prompts" },
              },
            ],
            skills: [],
            commands: [],
          },
        },
        workflow: {
          relativePath: "review.yaml",
          revision: revA,
          name: "Review Flow",
          description: "Flow",
          steps: [],
        },
        instructions: [],
        prompts: [],
        skills: [],
        tools: { fingerprints: [], catalogDigest: revA, catalog: [] },
        mcp: {
          bindings: [
            {
              serverName: "docs",
              ref: { kind: "mcp", relativePath: "docs.md", revision: revA },
            },
          ],
          tools: [],
        },
      },
    }

    const hydrated = composeDraftFromSnapshot(snapshot)
    expect(hydrated.kind).toBe("profile")
    expect(hydrated.profilePath).toBe("team/review.yaml")
    expect(hydrated.baseRevision).toBe(revB)
    expect(hydrated.agents).toHaveLength(1)
    expect(hydrated.bindings["agents/reviewer"]?.prompts[0]?.target?.scope).toBe("project")
    expect(hydrated.workflow?.relativePath).toBe("review.yaml")
    expect(hydrated.mcpBindings).toEqual([])
  })

  test("preserves requestedCapabilities, presentation, bindings, workflow, and mcpBindings across Profile round-trip", () => {
    const draft = composeDraftFromProfile({
      name: "Full Profile",
      description: "Preserves all fields",
      relativePath: "team/full.yaml",
      revision: revB,
      profile: {
        root: { source: "builtin", id: "build", revision: revA },
        agents: [{ relativePath: "builder.md", revision: revC }],
        workflow: { relativePath: "release.yaml", revision: revA },
        bindings: {
          orchestrator: {
            prompts: [{ relativePath: "review.md", revision: revB }],
            skills: [{ relativePath: "craft/SKILL.md", revision: revC }],
            commands: [{ relativePath: "verify.md", revision: revA }],
          },
        },
        presentation: "native",
        requestedCapabilities: ["asset.info", "project.read"],
        mcpBindings: [
          {
            serverName: "Docs",
            ref: { relativePath: "docs.yaml", revision: revA },
            transport: "stdio",
            command: ["docs-mcp"],
          },
        ],
      },
    })

    const built = buildProfileCandidate(draft)
    expect(built.error).toBeUndefined()
    expect(built.candidate?.profile.requestedCapabilities).toEqual(["asset.info", "project.read"])
    expect(built.candidate?.profile.presentation).toBe("native")
    expect(built.candidate?.profile.mcpBindings).toHaveLength(1)
    expect(built.candidate?.profile.workflow?.relativePath).toBe("release.yaml")
    expect(built.candidate?.profile.bindings.orchestrator?.prompts[0]?.relativePath).toBe("review.md")
  })
})
