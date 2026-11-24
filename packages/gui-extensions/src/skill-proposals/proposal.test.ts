import { describe, expect, test } from "bun:test"
import type {
  AgentAssetApplyOutput,
  CommandAssetApplyOutput,
  JsonValue,
  McpAssetApplyOutput,
  PluginAssetApplyOutput,
  PluginAssetListOutput,
  PromptAssetApplyOutput,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SkillAssetApplyOutput,
  WorkflowAssetApplyOutput,
  WorkflowAssetListOutput,
} from "@omnixa/client/promise"
import { AgentAsset } from "@omnixa/schema/agent-asset"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { CommandAsset } from "@omnixa/schema/command-asset"
import { MCPAsset } from "@omnixa/schema/mcp-asset"
import { PluginAsset } from "@omnixa/schema/plugin-asset"
import { PromptAsset } from "@omnixa/schema/prompt-asset"
import { SkillAsset } from "@omnixa/schema/skill-asset"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Match, Schema } from "effect"
import { SkillProposalContract } from "./contract"
import { SkillProposal } from "./proposal"

function input() {
  return { name: " Review ", description: "Review changes", slash: false, content: "Check the changed code.\n" }
}

function workflowInput(name = "Review") {
  return {
    name,
    description: "Review workflow declaration",
    content: [
      "\uFEFF# Preserve the reviewed declaration",
      "kind: workflow",
      `name: ${name}`,
      "description: Review workflow declaration",
      'version: "3"',
      "triggers: [manual, pull-request]",
      "extra: preserve this field",
      "steps:",
      "  - id: inspect",
      "    name: Inspect changes",
      "    agent: reviewer",
      "    next: report",
      "    branches: { approved: report, rejected: END }",
      "    parallel: [verify]",
      "    failurePolicy: retry",
      "    maxAttempts: 3",
      "    timeoutSeconds: 90",
      "  - id: report",
      "    name: Report findings",
      "    agent: writer",
      "    input: { options: { paths: [src, null], strict: true }, labels: [review] }",
      "  - id: verify",
      "    name: Verify findings",
      "    agent: checker",
      "    next: report",
      "",
    ].join("\r\n"),
  }
}

function workflowFacts(relativePath = "Review.yaml") {
  return { relativePath, exists: false, revision: null, nameConflict: false, pathConflict: false }
}

function workflowTool(
  body: Record<string, JsonValue> = workflowInput(),
  metadata: Record<string, JsonValue> | undefined = workflowFacts(),
): SessionMessageAssistantTool {
  return { ...tool(body, metadata), name: "propose_workflow_asset" }
}

function workflowAsset(name = "Review"): WorkflowAssetApplyOutput {
  return {
    kind: "workflow",
    ...workflowInput(name),
    relativePath: `${name}.yaml`,
    revision: "a".repeat(64),
    version: "3",
    triggers: ["manual", "pull-request"],
    steps: [
      {
        id: "inspect",
        name: "Inspect changes",
        agent: "reviewer",
        input: {},
        next: "report",
        branches: { approved: "report", rejected: "END" },
        parallel: ["verify"],
        failurePolicy: "retry",
        maxAttempts: 3,
        timeoutSeconds: 90,
      },
      {
        id: "report",
        name: "Report findings",
        agent: "writer",
        input: { options: { paths: ["src", null], strict: true }, labels: ["review"] },
        failurePolicy: "abort",
        maxAttempts: 1,
      },
      {
        id: "verify",
        name: "Verify findings",
        agent: "checker",
        input: {},
        next: "report",
        failurePolicy: "abort",
        maxAttempts: 1,
      },
    ],
  }
}

function workflowCatalog(name = "Review"): WorkflowAssetListOutput {
  return {
    assets: [
      {
        kind: "workflow",
        name,
        description: workflowInput(name).description,
        relativePath: `${name}.yaml`,
        revision: "a".repeat(64),
      },
    ],
    invalid: [],
  }
}

function facts() {
  return { relativePath: "Review.md", exists: false, revision: null, nameConflict: false, pathConflict: false }
}

function tool(
  body: Record<string, JsonValue> = input(),
  metadata: Record<string, JsonValue> | undefined = facts(),
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "call_propose_review",
    name: "propose_skill_asset",
    time: { created: 1, completed: 2 },
    state: { status: "completed", input: body, metadata, content: [{ type: "text", text: "Candidate ready" }] },
  }
}

function asset(): SkillAssetApplyOutput {
  return { kind: "skill", ...input(), relativePath: "Review.md", revision: "a".repeat(64), triggers: [], tags: [] }
}

function message(id: string, part: SessionMessageAssistantTool): SessionMessageAssistant {
  return {
    id,
    type: "assistant",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    content: [part],
  }
}

function ready(part: SessionMessageAssistantTool) {
  const parsed = SkillProposal.read(part)

  if (parsed.kind !== "ready") throw new Error(`Expected a ready ${part.name} proposal`)

  return parsed
}

function skillReady(part: SessionMessageAssistantTool = tool()) {
  const proposal = ready(part)

  if (proposal.assetKind !== "skill") throw new Error("Expected a Skill proposal")

  return proposal
}

function target(scope: AssetPlacement.Scope = "project") {
  return {
    scope,
    root: Match.value(scope).pipe(
      Match.when("global", () => "/global/config/skills"),
      Match.when("location", () => "/project/packages/app/.omnixa/skills"),
      Match.orElse(() => "/project/.omnixa/skills"),
    ),
  }
}

function inspection(scope: AssetPlacement.Scope = "project") {
  return { ...facts(), target: target(scope) }
}

describe("saved Workflow proposal parser", () => {
  test("reads original Workflow YAML and five own facts without requiring another family's fields", () => {
    const parsed = SkillProposal.read(
      workflowTool(
        { ...workflowInput(), slash: true, source: "Not a Command", config: "Not an Agent", tags: ["ignored"] },
        { ...workflowFacts(), truncated: true, outputPath: "/tmp/result.txt" },
      ),
    )

    expect(parsed.kind).toBe("ready")

    if (parsed.kind !== "ready" || parsed.assetKind !== "workflow") throw new Error("Expected a Workflow proposal")
    expect(parsed.assetKind).toBe("workflow")
    expect(parsed.candidate).toEqual({
      ...Schema.decodeUnknownSync(WorkflowAsset.Candidate)(workflowInput()),
      relativePath: "Review.yaml",
    })
    expect(parsed.candidate).not.toHaveProperty("slash")
    expect(parsed.candidate).not.toHaveProperty("source")
    expect(parsed.candidate).not.toHaveProperty("config")
    expect(parsed.facts).toEqual(workflowFacts())
  })

  test("accepts a Workflow name ending in .plugin and keeps its same-shaped Plugin proposal distinct", () => {
    const workflow = SkillProposal.read(
      workflowTool(workflowInput("Review.plugin"), workflowFacts("Review.plugin.yaml")),
    )

    const plugin = SkillProposal.read(pluginTool())
    expect(workflow.kind).toBe("ready")
    expect(plugin.kind).toBe("ready")

    if (workflow.kind !== "ready" || plugin.kind !== "ready") throw new Error("Expected both proposal families")
    expect(workflow.assetKind).toBe("workflow")
    expect(plugin.assetKind).toBe("plugin")
    expect(workflow.candidate).toEqual({
      ...Schema.decodeUnknownSync(WorkflowAsset.Candidate)(workflowInput("Review.plugin")),
      relativePath: "Review.plugin.yaml",
    })
    expect(plugin.candidate).toEqual({
      ...Schema.decodeUnknownSync(PluginAsset.Candidate)(pluginInput()),
      relativePath: "Review.plugin.yaml",
    })
  })

  test("requires every own Workflow input and fact rather than inferring historical metadata", () => {
    for (const key of ["name", "description", "content"]) {
      const body = Object.fromEntries(Object.entries(workflowInput()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(workflowTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    }

    for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict"]) {
      const metadata = Object.fromEntries(Object.entries(workflowFacts()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(workflowTool(workflowInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsMissing",
      })
    }

    const inheritedInput: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inheritedInput, workflowInput())
    expect(SkillProposal.read(workflowTool(inheritedInput))).toEqual({
      kind: "invalid",
      issue: "proposal.inputMissing",
    })
    const inheritedFacts: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inheritedFacts, workflowFacts())
    expect(SkillProposal.read(workflowTool(workflowInput(), inheritedFacts))).toEqual({
      kind: "invalid",
      issue: "proposal.factsMissing",
    })
    const legacy = workflowTool()

    if (legacy.state.status !== "completed") throw new Error("Expected a completed Workflow tool")
    delete legacy.state.metadata
    expect(SkillProposal.read(legacy)).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
  })

  test("rejects malformed Workflow input and its canonical candidate length limit", () => {
    for (const body of [
      { ...workflowInput(), name: "" },
      { ...workflowInput(), description: 42 },
      { ...workflowInput(), content: null },
      { ...workflowInput(), content: ["kind: workflow"] },
      { ...workflowInput(), content: "x".repeat(100_001) },
    ])
      expect(SkillProposal.read(workflowTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputInvalid" })
  })

  test("requires a short Workflow YAML path and consistent nullable revision facts", () => {
    for (const relativePath of [
      "",
      "Review.md",
      "Review.yml",
      ".yaml",
      ".omnixa/workflows/Review.yaml",
      "nested/Review.yaml",
      "../Review.yaml",
      "nested\\Review.yaml",
      "/tmp/Review.yaml",
      "Review\n.yaml",
    ])
      expect(SkillProposal.read(workflowTool(workflowInput(), workflowFacts(relativePath)))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })

    for (const metadata of [
      { ...workflowFacts(), exists: true },
      { ...workflowFacts(), revision: "a".repeat(64) },
      { ...workflowFacts(), pathConflict: true },
      { ...workflowFacts(), exists: true, revision: "A".repeat(64) },
      { ...workflowFacts(), nameConflict: "false" },
    ])
      expect(SkillProposal.read(workflowTool(workflowInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })
  })
})

describe("saved Skill proposal facts", () => {
  test("uses the persisted body and canonical path, and accepts framework output metadata", () => {
    const parsed = SkillProposal.read(tool(input(), { ...facts(), truncated: true, outputPath: "/tmp/result.txt" }))
    expect(parsed.kind).toBe("ready")

    if (parsed.kind !== "ready") throw new Error("Expected a ready candidate")

    expect(parsed.candidate).toEqual(
      SkillAsset.Candidate.make({ ...input(), relativePath: "Review.md", triggers: [], tags: [] }),
    )
    expect(parsed.facts.revision).toBeNull()
  })

  for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict"]) {
    test("does not infer missing " + key + " facts", () => {
      const metadata = Object.fromEntries(Object.entries(facts()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(tool(input(), metadata))).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
    })
  }

  test("rejects a legacy tool with no metadata", () => {
    const legacy = tool()

    if (legacy.state.status !== "completed") throw new Error("Expected a completed tool")

    delete legacy.state.metadata
    expect(SkillProposal.read(legacy)).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
  })

  test("rejects inherited facts and inherited required input", () => {
    const metadata: Record<string, JsonValue> = {}
    Object.setPrototypeOf(metadata, facts())
    expect(SkillProposal.read(tool(input(), metadata))).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
    const body: Record<string, JsonValue> = {}
    Object.setPrototypeOf(body, input())
    expect(SkillProposal.read(tool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
  })

  for (const metadata of [
    { ...facts(), exists: true },
    { ...facts(), revision: "a".repeat(64) },
    { ...facts(), pathConflict: true },
    { ...facts(), exists: true, revision: "A".repeat(64) },
    { ...facts(), relativePath: "../Review.md" },
    { ...facts(), nameConflict: "false" },
  ]) {
    test("rejects inconsistent or invalid facts " + JSON.stringify(metadata), () => {
      expect(SkillProposal.read(tool(input(), metadata))).toEqual({ kind: "invalid", issue: "proposal.factsInvalid" })
    })
  }

  for (const body of [
    { ...input(), slash: true },
    { ...input(), triggers: ["on-save"] },
    { ...input(), tags: ["review"] },
  ]) {
    test("rejects unsupported input " + JSON.stringify(body), () => {
      expect(SkillProposal.read(tool(body))).toEqual({ kind: "invalid", issue: "proposal.basicOnly" })
    })
  }

  test("keeps conflicting facts explicit and keys tools by message plus tool id", () => {
    const conflict = SkillProposal.read(tool(input(), { ...facts(), nameConflict: true }))
    expect(conflict.kind).toBe("ready")

    if (conflict.kind !== "ready") throw new Error("Expected valid conflict facts")

    expect(conflict.facts.nameConflict).toBe(true)
    const entries = SkillProposal.list([message("msg_one", tool()), message("msg_two", tool())])
    expect(entries.map((entry) => entry.key)).toEqual(["msg_one:call_propose_review", "msg_two:call_propose_review"])
    const edited = tool({ ...input(), content: "Changed candidate" })
    expect(SkillProposal.list([message("msg_one", edited)])[0]?.stamp).not.toBe(entries[0]?.stamp)
  })
})

describe("current file and native consumer identity", () => {
  const catalog = () => ({ assets: [asset()], invalid: [] })

  test("requires consistent authoritative list/content before replacement", () => {
    expect(SkillProposal.current(ready(tool()), asset(), catalog()).kind).toBe("ready")
    expect(
      SkillProposal.current(ready(tool()), asset(), {
        assets: [{ ...asset(), revision: "b".repeat(64) }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.changed" })
    expect(
      SkillProposal.current(ready(tool()), asset(), {
        assets: [],
        invalid: [{ relativePath: "Review.md", errorTag: "name_conflict" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(ready(tool()), asset(), {
        assets: [asset(), { ...asset(), relativePath: "another.md" }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.nameConflict" })
  })

  test("checks the successful reply against the actual reviewed candidate", () => {
    expect(SkillProposal.applied(ready(tool()), asset())?.revision).toBe(
      Schema.decodeUnknownSync(SkillAsset.Revision)("a".repeat(64)),
    )
    expect(SkillProposal.applied(ready(tool()), { ...asset(), content: "Different" })).toBeUndefined()
    expect(SkillProposal.applied(ready(tool()), { ...asset(), relativePath: "other.md" })).toBeUndefined()
  })

  test("uses the winning native path and exact content, and displays its actual id", () => {
    const current = {
      id: "Review",
      name: input().name,
      description: input().description,
      content: input().content,
      path: "/project/.omnixa/skills/Review.md",
    }

    expect(SkillProposal.native(asset(), { directory: "/project" }, [current])?.id).toBe("Review")
    expect(
      SkillProposal.native(asset(), { directory: "/project" }, [
        { ...current, path: "/other/.omnixa/skills/Review.md" },
      ]),
    ).toBeUndefined()
    expect(
      SkillProposal.native(asset(), { directory: "/project" }, [{ ...current, content: current.content.trim() }]),
    ).toBeUndefined()
    expect(
      SkillProposal.native(asset(), { directory: "C:\\project" }, [
        { ...current, path: "C:\\project\\.omnixa\\skills\\Review.md" },
      ])?.id,
    ).toBe("Review")
  })
})

describe("Skill proposal placement", () => {
  test.each(["project", "global", "location"] as const)("preserves the canonical %s target", (scope) => {
    const metadata = inspection(scope)
    const proposal = skillReady(tool(input(), metadata))

    expect(proposal.target).toBeInstanceOf(AssetPlacement.Target)
    expect(proposal.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target(scope)))
    expect(proposal.facts).toEqual(facts())
    expect(proposal.facts).not.toHaveProperty("target")
    expect(proposal.candidate).not.toHaveProperty("target")
    expect(metadata).toEqual(inspection(scope))
  })

  test("keeps missing historical targets absent and does not adopt inherited targets", () => {
    const metadata = facts()
    Object.setPrototypeOf(metadata, { target: target("global") })

    expect(skillReady()).not.toHaveProperty("target")
    expect(skillReady(tool(input(), metadata))).not.toHaveProperty("target")
    expect(Object.hasOwn(metadata, "target")).toBe(false)
  })

  test.each(
    [
      null,
      false,
      "global",
      [],
      {},
      { scope: "project" },
      { root: "/project/.omnixa/skills" },
      { scope: "workspace", root: "/project/.omnixa/skills" },
      { scope: "Project", root: "/project/.omnixa/skills" },
      { scope: "project", root: null },
      { scope: "project", root: 1 },
    ].map((target) => ({ target })),
  )("rejects an own malformed target $target without falling back to legacy facts", (row) => {
    const metadata = facts()
    Object.defineProperty(metadata, "target", { value: row.target, enumerable: true })

    expect(SkillProposal.read(tool(input(), metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.factsInvalid",
    })
  })

  test("rejects an own undefined target instead of treating it as missing history", () => {
    const metadata = facts()
    Object.defineProperty(metadata, "target", { value: undefined, enumerable: true })

    expect(SkillProposal.read(tool(input(), metadata))).toEqual({ kind: "invalid", issue: "proposal.factsInvalid" })
  })

  test("does not use a target to synthesize missing historical facts", () => {
    for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict"]) {
      const metadata = Object.fromEntries(Object.entries(inspection()).filter((entry) => entry[0] !== key))

      expect(SkillProposal.read(tool(input(), metadata))).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
    }
  })

  test("preserves root strings accepted by the canonical AbsolutePath brand", () => {
    for (const root of ["", "relative/skills", "/project/.omnixa/skills", "C:\\project\\.omnixa\\skills"]) {
      const placement = { scope: "project", root }

      expect(skillReady(tool(input(), { ...facts(), target: placement })).target).toEqual(
        Schema.decodeUnknownSync(AssetPlacement.Target)(placement),
      )
    }
  })

  test("leaves the four other families independent of Skill, Command and Prompt target metadata", () => {
    for (const part of [agentTool(), mcpTool(), pluginTool(), workflowTool()]) {
      if (part.state.status !== "completed" || !part.state.metadata) throw new Error("Expected persisted facts")

      const proposal = ready(part)

      const tagged = {
        ...part,
        state: { ...part.state, metadata: { ...part.state.metadata, target: null } },
      }

      expect(SkillProposal.read(tagged)).toEqual(proposal)
      expect(proposal).not.toHaveProperty("target")
      expect(proposal.facts).not.toHaveProperty("target")
    }
  })

  test("changes proposal identity when only the persisted target changes", () => {
    const original = SkillProposal.list([message("msg_target", tool(input(), inspection()))])[0]

    for (const placement of [
      { ...target(), scope: "location" },
      { ...target(), root: "/other/.omnixa/skills" },
    ]) {
      const changed = SkillProposal.list([message("msg_target", tool(input(), { ...facts(), target: placement }))])[0]

      expect(changed?.key).toBe(original?.key)
      expect(changed?.stamp).not.toBe(original?.stamp)
    }
  })
})

describe("Skill proposal inspection", () => {
  test("replaces local facts and target without rewriting the persisted proposal or candidate body", () => {
    const body = { ...input(), content: "\uFEFF# Keep this body\r\n\r\n`$HOME` and 中文.\r\n" }
    const part = tool(body, inspection())
    const original = skillReady(part)
    const response = { ...inspection("global"), exists: true, revision: "b".repeat(64), nameConflict: true }
    const reviewed = SkillProposal.inspected(original, response, "global")

    if (!reviewed || reviewed.assetKind !== "skill") throw new Error("Expected an inspected Skill proposal")

    expect(reviewed).not.toBe(original)
    expect(reviewed?.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target("global")))
    expect(reviewed?.facts).toEqual({
      ...facts(),
      exists: true,
      revision: SkillAsset.Revision.make("b".repeat(64)),
      nameConflict: true,
    })
    expect(reviewed?.facts).not.toHaveProperty("target")
    expect(reviewed?.candidate).toEqual(original.candidate)
    expect(reviewed?.candidate.content).toBe(body.content)
    expect(original.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target()))
    expect(original.facts).toEqual(facts())
    expect(part).toEqual(tool(body, inspection()))
    expect(SkillProposal.inspected(original, response, "global")).not.toBe(reviewed)
  })

  test("gives complete legacy facts an explicit Location review without filling historical metadata", () => {
    const original = skillReady()
    const reviewed = SkillProposal.inspected(original, inspection("location"), "location")

    expect(reviewed?.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target("location")))
    expect(reviewed?.facts).toEqual(facts())
    expect(original).not.toHaveProperty("target")
  })

  test("requires every own inspection fact and target", () => {
    for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict", "target"]) {
      const response = Object.fromEntries(Object.entries(inspection()).filter((entry) => entry[0] !== key))

      expect(SkillProposal.inspected(skillReady(), response, "project")).toBeUndefined()
      Object.setPrototypeOf(response, inspection())
      expect(SkillProposal.inspected(skillReady(), response, "project")).toBeUndefined()
    }
  })

  test.each(
    [
      null,
      undefined,
      [],
      { ...inspection(), exists: true },
      { ...inspection(), revision: "b".repeat(64) },
      { ...inspection(), pathConflict: true },
      { ...inspection(), exists: true, revision: "B".repeat(64) },
      { ...inspection(), nameConflict: "false" },
      { ...inspection(), relativePath: "Other.md" },
      { ...inspection(), relativePath: "../Review.md" },
      { ...inspection(), relativePath: "" },
      { ...inspection(), target: null },
      { ...inspection(), target: undefined },
      { ...inspection(), target: [] },
      { ...inspection(), target: { scope: "project" } },
      { ...inspection(), target: { scope: "workspace", root: target().root } },
    ].map((response) => ({ response })),
  )("rejects malformed or inconsistent inspection $response", (row) => {
    expect(SkillProposal.inspected(skillReady(), row.response, "project")).toBeUndefined()
  })

  test("requires the requested scope even when the returned root is unchanged", () => {
    expect(
      SkillProposal.inspected(skillReady(), { ...inspection(), target: { ...target(), scope: "global" } }, "project"),
    ).toBeUndefined()
    expect(SkillProposal.inspected(skillReady(), inspection(), "global")).toBeUndefined()
  })
})

describe("selected Skill owner identity", () => {
  const proposal = () => skillReady(tool(input(), inspection()))
  const content = () => ({ ...asset(), target: target() })
  const catalog = () => ({ assets: [asset()], invalid: [], target: target() })

  test("accepts one selected owner while preserving existing revision and exact-body checks", () => {
    const applied = SkillProposal.applied(proposal(), content())

    if (applied?.kind !== "skill") throw new Error("Expected a saved Skill")

    expect(SkillProposal.current(proposal(), content(), catalog()).kind).toBe("ready")
    expect(applied.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target()))
    expect(
      SkillProposal.current(proposal(), content(), {
        ...catalog(),
        assets: [{ ...asset(), revision: "b".repeat(64) }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.changed" })
    expect(SkillProposal.applied(proposal(), { ...content(), content: input().content.trim() })).toBeUndefined()
  })

  test.each([
    { label: "same root with different scope", target: { ...target(), scope: "location" as const } },
    { label: "same scope with different root", target: { ...target(), root: "/other/.omnixa/skills" } },
  ])("rejects $label in content, catalog and apply replies", (mismatch) => {
    expect(SkillProposal.current(proposal(), { ...content(), target: mismatch.target }, catalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), content(), { ...catalog(), target: mismatch.target })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), { ...content(), target: mismatch.target })).toBeUndefined()
  })

  test("does not accept target omission in an explicitly reviewed response", () => {
    expect(SkillProposal.current(proposal(), asset(), catalog())).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.current(proposal(), content(), { assets: [asset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), asset(), { assets: [asset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), asset())).toBeUndefined()
  })

  test("rejects malformed selected targets from either authoritative read and from apply", () => {
    for (const malformed of [null, undefined, [], {}, { scope: "project" }, { scope: "project", root: false }]) {
      const changedContent = content()
      const changedCatalog = catalog()
      Object.defineProperty(changedContent, "target", { value: malformed })
      Object.defineProperty(changedCatalog, "target", { value: malformed })

      expect(SkillProposal.current(proposal(), changedContent, catalog())).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
      expect(SkillProposal.current(proposal(), content(), changedCatalog)).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
      expect(SkillProposal.applied(proposal(), changedContent)).toBeUndefined()
    }
  })

  test("keeps legacy response compatibility from accepting an unreviewed selected owner", () => {
    expect(SkillProposal.current(skillReady(), asset(), { assets: [asset()], invalid: [] }).kind).toBe("ready")
    expect(SkillProposal.applied(skillReady(), asset())).toBeDefined()
    expect(SkillProposal.current(skillReady(), content(), catalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(skillReady(), asset(), catalog())).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.current(skillReady(), content(), { assets: [asset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(skillReady(), content())).toBeUndefined()
  })

  test("uses the re-inspected global target instead of the persisted Project target", () => {
    const reviewed = SkillProposal.inspected(proposal(), inspection("global"), "global")

    if (!reviewed) throw new Error("Expected a current global inspection")

    const globalContent = { ...asset(), target: target("global") }
    const globalCatalog = { assets: [asset()], invalid: [], target: target("global") }
    const applied = SkillProposal.applied(reviewed, globalContent)

    if (applied?.kind !== "skill") throw new Error("Expected a saved global Skill")

    expect(SkillProposal.current(reviewed, globalContent, globalCatalog).kind).toBe("ready")
    expect(applied.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(target("global")))
    expect(SkillProposal.current(reviewed, content(), catalog())).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.applied(reviewed, content())).toBeUndefined()
  })

  test.each(["project", "global", "location"] as const)("matches the native winner under the %s root", (scope) => {
    const selected = { ...asset(), target: target(scope) }

    const native = {
      id: "Actual-native-id",
      name: selected.name,
      description: selected.description,
      content: selected.content,
      path: target(scope).root + "/" + selected.relativePath,
    }

    const location = { directory: "/project/packages/app" }

    expect(SkillProposal.native(selected, location, [native])?.id).toBe(native.id)
    expect(SkillProposal.native(selected, location, [{ ...native, path: "/other/skills/Review.md" }])).toBeUndefined()
    expect(SkillProposal.native(selected, location, [{ ...native, content: native.content.trim() }])).toBeUndefined()
    expect(SkillProposal.native(selected, location, [{ ...native, name: "Different name" }])).toBeUndefined()
    expect(
      SkillProposal.native(selected, location, [{ ...native, description: "Different description" }]),
    ).toBeUndefined()
  })
})

function commandInput() {
  return {
    name: " Ｒｅｖｉｅｗ ",
    description: "Review the actual change",
    invocation: "/review-alias",
    args: "target",
    source: "Inspect $ARGUMENTS.",
  }
}

function commandTool(
  body: Record<string, JsonValue> = commandInput(),
  metadata: Record<string, JsonValue> | undefined = facts(),
): SessionMessageAssistantTool {
  return { ...tool(body, metadata), name: "propose_command_asset" }
}

function commandAsset(): CommandAssetApplyOutput {
  return { kind: "command", ...commandInput(), relativePath: "Review.md", revision: "a".repeat(64) }
}

function commandReady(part: SessionMessageAssistantTool = commandTool()) {
  const proposal = ready(part)

  if (proposal.assetKind !== "command") throw new Error("Expected a Command proposal")

  return proposal
}

function commandTarget(scope: AssetPlacement.Scope = "project") {
  return {
    scope,
    root: Match.value(scope).pipe(
      Match.when("global", () => "/global/config/commands"),
      Match.when("location", () => "/project/packages/app/.omnixa/commands"),
      Match.orElse(() => "/project/.omnixa/commands"),
    ),
  }
}

function commandInspection(scope: AssetPlacement.Scope = "project") {
  return { ...facts(), target: commandTarget(scope) }
}

function commandCatalog(scope?: AssetPlacement.Scope) {
  const result = {
    assets: [Schema.encodeSync(CommandAsset.Summary)(Schema.decodeUnknownSync(CommandAsset.Summary)(commandAsset()))],
    invalid: [],
  }

  if (!scope) return result

  return { ...result, target: commandTarget(scope) }
}

describe("saved Command proposal contract", () => {
  test("preserves Command fields and canonical facts through the shared proposal reader", () => {
    const parsed = SkillProposal.read(commandTool())

    if (parsed.kind !== "ready" || parsed.assetKind !== "command") throw new Error("Expected a Command candidate")

    expect(parsed.candidate).toEqual(
      Schema.decodeUnknownSync(CommandAsset.Candidate)({ ...commandInput(), relativePath: "Review.md" }),
    )
    expect(parsed.facts.revision).toBeNull()
    expect(parsed.candidate.args).toBe("target")
  })

  test("does not infer required Command source or unknown target facts", () => {
    const body = Object.fromEntries(Object.entries(commandInput()).filter((entry) => entry[0] !== "source"))
    expect(SkillProposal.read(commandTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    expect(SkillProposal.read(commandTool(commandInput(), {}))).toEqual({
      kind: "invalid",
      issue: "proposal.factsMissing",
    })
    expect(SkillProposal.read(commandTool(commandInput(), { ...facts(), exists: true }))).toEqual({
      kind: "invalid",
      issue: "proposal.factsInvalid",
    })
  })

  test("keeps the two panes separate and changes the stamp when Command source changes", () => {
    const messages = [message("msg_skill", tool()), message("msg_command", commandTool())]
    expect(SkillProposal.list(messages).map((entry) => entry.tool.name)).toEqual(["propose_skill_asset"])
    expect(SkillProposal.list(messages, "command").map((entry) => entry.tool.name)).toEqual(["propose_command_asset"])
    const before = SkillProposal.list(messages, "command")[0]
    const changed = message("msg_command", commandTool({ ...commandInput(), source: "Changed source" }))
    expect(SkillProposal.list([changed], "command")[0]?.stamp).not.toBe(before?.stamp)
  })

  test("uses Command readback fields and the authoritative catalogue before replacement", () => {
    const proposal = ready(commandTool())
    expect(SkillProposal.current(proposal, commandAsset(), { assets: [commandAsset()], invalid: [] }).kind).toBe(
      "ready",
    )
    expect(
      SkillProposal.current(proposal, commandAsset(), {
        assets: [{ ...commandAsset(), revision: "b".repeat(64) }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.changed" })
    expect(SkillProposal.applied(proposal, commandAsset())?.kind).toBe("command")

    for (const response of [
      { ...commandAsset(), source: "Different source" },
      { ...commandAsset(), invocation: "/different" },
      { ...commandAsset(), args: "other" },
      { ...commandAsset(), relativePath: "other.md" },
      asset(),
    ])
      expect(SkillProposal.applied(proposal, response)).toBeUndefined()
  })

  test("uses the actual filename for a listed Command without inventing an invocation alias", () => {
    expect(
      SkillProposal.nativeCommand(commandAsset(), [{ name: "Review", description: commandInput().description }])?.name,
    ).toBe("Review")
    expect(
      SkillProposal.nativeCommand(commandAsset(), [
        { name: commandInput().name, description: commandInput().description },
        { name: "review-alias", description: commandInput().description },
      ]),
    ).toBeUndefined()
  })
})

describe("Command proposal placement", () => {
  test.each(["project", "global", "location"] as const)(
    "preserves the canonical %s target and Command facts",
    (scope) => {
      const metadata = commandInspection(scope)
      const proposal = commandReady(commandTool(commandInput(), metadata))

      expect(proposal.target).toBeInstanceOf(AssetPlacement.Target)
      expect(proposal.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(commandTarget(scope)))
      expect(proposal.candidate).toBeInstanceOf(CommandAsset.Candidate)
      expect(proposal.facts).toBeInstanceOf(SkillProposalContract.CommandFacts)
      expect(proposal.facts).toEqual(facts())
      expect(proposal.facts).not.toHaveProperty("target")
      expect(proposal.candidate).not.toHaveProperty("target")
      expect(metadata).toEqual(commandInspection(scope))
    },
  )

  test("keeps historical targets absent and does not adopt an inherited target", () => {
    const metadata = facts()
    Object.setPrototypeOf(metadata, { target: commandTarget("global") })

    expect(commandReady()).not.toHaveProperty("target")
    expect(commandReady(commandTool(commandInput(), metadata))).not.toHaveProperty("target")
    expect(Object.hasOwn(metadata, "target")).toBe(false)
  })

  test.each(
    [
      undefined,
      null,
      false,
      "global",
      [],
      {},
      { scope: "project" },
      { root: "/project/.omnixa/commands" },
      { scope: "workspace", root: "/project/.omnixa/commands" },
      { scope: "Project", root: "/project/.omnixa/commands" },
      { scope: "project", root: null },
      { scope: "project", root: 1 },
    ].map((target) => ({ target })),
  )("rejects an own malformed Command target $target without legacy fallback", (row) => {
    const metadata = facts()
    Object.defineProperty(metadata, "target", { value: row.target, enumerable: true })

    expect(SkillProposal.read(commandTool(commandInput(), metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.factsInvalid",
    })
  })

  test("does not use a target or inherited facts to synthesize historical Command metadata", () => {
    ;["relativePath", "exists", "revision", "nameConflict", "pathConflict"].forEach((key) => {
      const metadata = Object.fromEntries(Object.entries(commandInspection()).filter((entry) => entry[0] !== key))

      expect(SkillProposal.read(commandTool(commandInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsMissing",
      })
      Object.setPrototypeOf(metadata, commandInspection())
      expect(SkillProposal.read(commandTool(commandInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsMissing",
      })
    })
  })

  test.each(
    [
      { ...commandInspection(), exists: true },
      { ...commandInspection(), revision: "b".repeat(64) },
      { ...commandInspection(), pathConflict: true },
      { ...commandInspection(), exists: true, revision: "B".repeat(64) },
      { ...commandInspection(), nameConflict: "false" },
      { ...commandInspection(), relativePath: "../Review.md" },
      { ...commandInspection(), relativePath: "" },
    ].map((metadata) => ({ metadata })),
  )("rejects inconsistent Command facts even with a valid target: $metadata", (row) => {
    expect(SkillProposal.read(commandTool(commandInput(), row.metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.factsInvalid",
    })
  })

  test("keeps canonical root strings without inventing a second path validator", () => {
    ;["", "relative/commands", "/project/.omnixa/commands", "C:\\project\\.omnixa\\commands"].forEach((root) => {
      const placement = { scope: "project", root }

      expect(commandReady(commandTool(commandInput(), { ...facts(), target: placement })).target).toEqual(
        Schema.decodeUnknownSync(AssetPlacement.Target)(placement),
      )
    })
  })

  test("requires own Command source from the input even when metadata or the prototype offers one", () => {
    const body = Object.fromEntries(Object.entries(commandInput()).filter((entry) => entry[0] !== "source"))
    const metadata = { ...commandInspection(), source: commandInput().source }

    expect(SkillProposal.read(commandTool(body, metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.inputMissing",
    })
    Object.setPrototypeOf(body, { source: commandInput().source })
    expect(SkillProposal.read(commandTool(body, metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.inputMissing",
    })
  })

  test("changes the Command stamp when only target scope or root changes", () => {
    const original = SkillProposal.list(
      [message("msg_command_target", commandTool(commandInput(), commandInspection()))],
      "command",
    )[0]

    if (!original) throw new Error("Expected the original Command proposal")
    ;[
      { ...commandTarget(), scope: "location" },
      { ...commandTarget(), root: "/other/.omnixa/commands" },
    ].forEach((placement) => {
      const changed = SkillProposal.list(
        [message("msg_command_target", commandTool(commandInput(), { ...facts(), target: placement }))],
        "command",
      )[0]

      if (!changed) throw new Error("Expected the changed Command proposal")

      expect(changed.key).toBe(original.key)
      expect(changed.stamp).not.toBe(original.stamp)
    })
  })
})

describe("Command proposal inspection", () => {
  test("replaces only local Command facts and target while preserving the persisted candidate", () => {
    const body = { ...commandInput(), source: "\uFEFF# Keep source\r\n\r\n$ARGUMENTS and 中文.\r\n" }
    const part = commandTool(body, commandInspection())
    const original = commandReady(part)

    const response = {
      ...commandInspection("global"),
      exists: true,
      revision: "b".repeat(64),
      nameConflict: true,
      pathConflict: true,
    }

    const reviewed = SkillProposal.inspected(original, response, "global")

    if (!reviewed || reviewed.assetKind !== "command") throw new Error("Expected a reviewed Command")

    expect(reviewed).not.toBe(original)
    expect(reviewed.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(commandTarget("global")))
    expect(reviewed.facts).toBeInstanceOf(SkillProposalContract.CommandFacts)
    expect(reviewed.facts).toEqual(Schema.decodeUnknownSync(SkillProposalContract.CommandFacts)(response))
    expect(reviewed.facts).not.toHaveProperty("target")
    expect(reviewed.candidate).toEqual(original.candidate)
    expect(body.source).toBe(reviewed.candidate.source)
    expect(original.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(commandTarget()))
    expect(original.facts).toEqual(facts())
    expect(part).toEqual(commandTool(body, commandInspection()))
    expect(SkillProposal.inspected(original, response, "global")).not.toBe(reviewed)
  })

  test("gives complete historical Command facts an explicit Location review", () => {
    const original = commandReady()
    const reviewed = SkillProposal.inspected(original, commandInspection("location"), "location")

    expect(reviewed?.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(commandTarget("location")))
    expect(reviewed?.facts).toBeInstanceOf(SkillProposalContract.CommandFacts)
    expect(reviewed?.facts).toEqual(facts())
    expect(original).not.toHaveProperty("target")
  })

  test("requires all six own Command inspection facts instead of using inherited replies", () => {
    ;["relativePath", "exists", "revision", "nameConflict", "pathConflict", "target"].forEach((key) => {
      const response = Object.fromEntries(Object.entries(commandInspection()).filter((entry) => entry[0] !== key))

      expect(SkillProposal.inspected(commandReady(), response, "project")).toBeUndefined()
      Object.setPrototypeOf(response, commandInspection())
      expect(SkillProposal.inspected(commandReady(), response, "project")).toBeUndefined()
    })
  })

  test.each(
    [
      null,
      undefined,
      [],
      { ...commandInspection(), exists: true },
      { ...commandInspection(), revision: "b".repeat(64) },
      { ...commandInspection(), pathConflict: true },
      { ...commandInspection(), exists: true, revision: "B".repeat(64) },
      { ...commandInspection(), nameConflict: "false" },
      { ...commandInspection(), relativePath: "Other.md" },
      { ...commandInspection(), relativePath: "../Review.md" },
      { ...commandInspection(), relativePath: "" },
      { ...commandInspection(), target: null },
      { ...commandInspection(), target: undefined },
      { ...commandInspection(), target: [] },
      { ...commandInspection(), target: { scope: "project" } },
      { ...commandInspection(), target: { scope: "workspace", root: commandTarget().root } },
    ].map((response) => ({ response })),
  )("rejects a malformed or inconsistent Command inspection $response", (row) => {
    expect(SkillProposal.inspected(commandReady(), row.response, "project")).toBeUndefined()
  })

  test("checks the requested Command scope even when roots match", () => {
    expect(
      SkillProposal.inspected(
        commandReady(),
        { ...commandInspection(), target: { ...commandTarget(), scope: "global" } },
        "project",
      ),
    ).toBeUndefined()
    expect(SkillProposal.inspected(commandReady(), commandInspection(), "global")).toBeUndefined()
  })
})

describe("selected Command owner identity", () => {
  const proposal = () => commandReady(commandTool(commandInput(), commandInspection()))
  const content = () => ({ ...commandAsset(), target: commandTarget() })

  test.each(["project", "global", "location"] as const)("accepts one canonical %s owner", (scope) => {
    const selected = commandReady(commandTool(commandInput(), commandInspection(scope)))
    const response = { ...commandAsset(), target: commandTarget(scope) }
    const current = SkillProposal.current(selected, response, commandCatalog(scope))
    const applied = SkillProposal.applied(selected, response)

    expect(current).toEqual({ kind: "ready", current: Schema.decodeUnknownSync(CommandAsset.Info)(response) })
    expect(applied).toBeInstanceOf(CommandAsset.Info)
    expect(applied).toEqual(Schema.decodeUnknownSync(CommandAsset.Info)(response))
  })

  test.each([
    { label: "same root with different scope", target: { ...commandTarget(), scope: "location" as const } },
    { label: "same scope with different root", target: { ...commandTarget(), root: "/other/.omnixa/commands" } },
  ])("rejects $label in either authoritative read and apply", (mismatch) => {
    const changedContent = { ...content(), target: mismatch.target }
    const changedCatalog = { ...commandCatalog("project"), target: mismatch.target }

    expect(SkillProposal.current(proposal(), changedContent, commandCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), content(), changedCatalog)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), changedContent, changedCatalog)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), changedContent)).toBeUndefined()
  })

  test("rejects omitted targets in selected content, catalog and apply replies", () => {
    expect(SkillProposal.current(proposal(), commandAsset(), commandCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), content(), commandCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), commandAsset(), commandCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), commandAsset())).toBeUndefined()
  })

  test("rejects malformed selected targets from either read and apply", () => {
    ;[null, undefined, [], {}, { scope: "project" }, { scope: "project", root: false }].forEach((malformed) => {
      const changedContent = content()
      const changedCatalog = commandCatalog("project")
      Object.defineProperty(changedContent, "target", { value: malformed, enumerable: true })
      Object.defineProperty(changedCatalog, "target", { value: malformed, enumerable: true })

      expect(SkillProposal.current(proposal(), changedContent, commandCatalog("project"))).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
      expect(SkillProposal.current(proposal(), content(), changedCatalog)).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
      expect(SkillProposal.applied(proposal(), changedContent)).toBeUndefined()
    })
  })

  test("keeps legacy replies from adopting an unreviewed selected Command target", () => {
    expect(SkillProposal.current(commandReady(), commandAsset(), commandCatalog()).kind).toBe("ready")
    expect(SkillProposal.applied(commandReady(), commandAsset())).toBeDefined()
    expect(SkillProposal.current(commandReady(), content(), commandCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(commandReady(), commandAsset(), commandCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(commandReady(), content(), commandCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(commandReady(), content())).toBeUndefined()
  })

  test("preserves authoritative revision, invalid-entry and name-conflict checks for a selected owner", () => {
    expect(
      SkillProposal.current(proposal(), content(), {
        ...commandCatalog("project"),
        assets: commandCatalog().assets.map((entry) => ({ ...entry, revision: "b".repeat(64) })),
      }),
    ).toEqual({ kind: "blocked", issue: "error.changed" })
    expect(
      SkillProposal.current(proposal(), content(), {
        ...commandCatalog("project"),
        invalid: [{ relativePath: "Review.md", errorTag: "parse_error" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(proposal(), content(), {
        ...commandCatalog("project"),
        assets: [
          ...commandCatalog().assets,
          ...commandCatalog().assets.map((entry) => ({ ...entry, relativePath: "Other.md" })),
        ],
      }),
    ).toEqual({ kind: "blocked", issue: "error.nameConflict" })
  })

  test("offers current peer content for confirmation without confusing it with candidate readback", () => {
    const peer = { ...content(), source: "Changed by another editor.\r\n", revision: "b".repeat(64) }

    const current = SkillProposal.current(proposal(), peer, {
      ...commandCatalog("project"),
      assets: commandCatalog().assets.map((entry) => ({ ...entry, revision: peer.revision })),
    })

    expect(current).toEqual({ kind: "ready", current: Schema.decodeUnknownSync(CommandAsset.Info)(peer) })
    expect(SkillProposal.applied(proposal(), peer)).toBeUndefined()
  })

  test("keeps complete Command candidate and valid revision checks on selected apply", () => {
    ;[
      { ...content(), name: "Different name" },
      { ...content(), description: "Different description" },
      { ...content(), source: "Different source" },
      { ...content(), invocation: "/different" },
      { ...content(), args: "other" },
      { ...content(), relativePath: "Other.md" },
      { ...content(), revision: "not-a-revision" },
      asset(),
    ].forEach((response) => expect(SkillProposal.applied(proposal(), response)).toBeUndefined())
  })

  test("uses the re-inspected global owner instead of the persisted Project owner", () => {
    const reviewed = SkillProposal.inspected(proposal(), commandInspection("global"), "global")

    if (!reviewed || reviewed.assetKind !== "command") throw new Error("Expected a global Command inspection")

    const response = { ...commandAsset(), target: commandTarget("global") }
    const applied = SkillProposal.applied(reviewed, response)

    expect(SkillProposal.current(reviewed, response, commandCatalog("global")).kind).toBe("ready")
    expect(applied).toEqual(Schema.decodeUnknownSync(CommandAsset.Info)(response))
    expect(SkillProposal.current(reviewed, content(), commandCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(reviewed, content())).toBeUndefined()
  })

  test.each([undefined, "", "target"])("preserves literal source and args %s through selected readback", (args) => {
    const body = {
      name: commandInput().name,
      description: commandInput().description,
      invocation: commandInput().invocation,
      source: "\uFEFF# Command\r\n\r\nKeep $ARGUMENTS, $HOME and 中文.\r\n",
    }

    const input = args === undefined ? body : { ...body, args }
    const selected = commandReady(commandTool(input, commandInspection()))

    const response = {
      kind: "command" as const,
      ...input,
      relativePath: "Review.md",
      revision: "a".repeat(64),
      target: commandTarget(),
    }

    const applied = SkillProposal.applied(selected, response)

    if (applied?.kind !== "command") throw new Error("Expected complete Command readback")

    expect(body.source).toBe(selected.candidate.source)
    expect(body.source).toBe(applied.source)
    expect(selected.candidate.args).toBe(args)
    expect(applied.args).toBe(args)
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Candidate))(selected.candidate)).toEqual(
      Schema.decodeUnknownSync(Schema.Json)({ ...input, relativePath: "Review.md" }),
    )
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Info))(applied)).toEqual(
      Schema.decodeUnknownSync(Schema.Json)(response),
    )
  })

  test("keeps empty Command source distinct from missing source", () => {
    const body = { ...commandInput(), args: "", source: "" }
    const selected = commandReady(commandTool(body, commandInspection()))
    const response = { ...commandAsset(), args: "", source: "", target: commandTarget() }
    const applied = SkillProposal.applied(selected, response)

    expect("").toBe(selected.candidate.source)
    expect(applied).toEqual(Schema.decodeUnknownSync(CommandAsset.Info)(response))
  })

  test("limits native readiness to the filename and description across selected sources", () => {
    const native = { name: "Review", description: commandInput().description }
    const project = { ...content(), source: "Project source." }
    const global = { ...content(), source: "Global source.", target: commandTarget("global") }

    expect(SkillProposal.nativeCommand(project, [native])).toEqual(native)
    expect(SkillProposal.nativeCommand(global, [native])).toEqual(native)
    expect(
      SkillProposal.nativeCommand(project, [{ ...native, name: commandInput().invocation.slice(1) }]),
    ).toBeUndefined()
    expect(SkillProposal.nativeCommand(project, [{ ...native, description: "Different description" }])).toBeUndefined()
  })
})

function promptInput() {
  return { name: " Review ", description: "Review changes", template: "Review {{target}}.\nPreserve this body.\n" }
}

function promptTool(
  body: Record<string, JsonValue> = promptInput(),
  metadata: Record<string, JsonValue> | undefined = facts(),
): SessionMessageAssistantTool {
  return { ...tool(body, metadata), name: "propose_prompt_asset" }
}

function promptAsset(scope?: AssetPlacement.Scope): PromptAssetApplyOutput {
  const input = {
    kind: "prompt",
    ...promptInput(),
    relativePath: "Review.md",
    revision: "a".repeat(64),
  }

  if (scope) Object.assign(input, { target: promptTarget(scope) })

  return Schema.encodeSync(PromptAsset.Info)(Schema.decodeUnknownSync(PromptAsset.Info)(input))
}

function promptReady(part: SessionMessageAssistantTool = promptTool()) {
  const proposal = ready(part)

  if (proposal.assetKind !== "prompt") throw new Error("Expected a Prompt proposal")

  return proposal
}

function promptTarget(scope: AssetPlacement.Scope = "project") {
  return Schema.encodeSync(AssetPlacement.Target)(
    Schema.decodeUnknownSync(AssetPlacement.Target)({
      scope,
      root: Match.value(scope).pipe(
        Match.when("global", () => "/global/config/prompts"),
        Match.when("location", () => "/project/packages/app/.omnixa/prompts"),
        Match.orElse(() => "/project/.omnixa/prompts"),
      ),
    }),
  )
}

function promptInspection(scope: AssetPlacement.Scope = "project") {
  return Schema.encodeSync(PromptAsset.Inspection)(
    Schema.decodeUnknownSync(PromptAsset.Inspection)({ ...facts(), target: promptTarget(scope) }),
  )
}

function promptCatalog(scope?: AssetPlacement.Scope) {
  const result = {
    assets: [Schema.encodeSync(PromptAsset.Summary)(Schema.decodeUnknownSync(PromptAsset.Summary)(promptAsset()))],
    invalid: [],
  }

  if (scope) Object.assign(result, { target: promptTarget(scope) })

  return result
}

describe("saved Prompt proposal contract", () => {
  const candidate = () =>
    Schema.decodeUnknownSync(PromptAsset.Candidate)({ ...promptInput(), relativePath: "Review.md" })

  test("preserves the Prompt template and canonical persisted facts", () => {
    const parsed = SkillProposal.read(
      promptTool(promptInput(), { ...facts(), truncated: true, outputPath: "/tmp/result.txt" }),
    )

    if (parsed.kind !== "ready" || parsed.assetKind !== "prompt") throw new Error("Expected a Prompt candidate")

    expect(parsed.candidate).toEqual(candidate())
    expect(parsed.candidate.template).toBe(PromptAsset.Template.make(promptInput().template))
    expect(parsed.facts.revision).toBeNull()
    expect("content" in parsed.candidate).toBe(false)
    expect("source" in parsed.candidate).toBe(false)
  })

  test("requires every own Prompt input field", () => {
    for (const key of ["name", "description", "template"]) {
      const body = Object.fromEntries(Object.entries(promptInput()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(promptTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    }

    const inherited: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inherited, promptInput())
    expect(SkillProposal.read(promptTool(inherited))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
  })

  test("uses the canonical Template bounds through the proposal boundary", () => {
    for (const template of ["", "x".repeat(100_001), null])
      expect(SkillProposal.read(promptTool({ ...promptInput(), template }))).toEqual({
        kind: "invalid",
        issue: "proposal.inputInvalid",
      })

    const parsed = SkillProposal.read(promptTool({ ...promptInput(), template: "x".repeat(100_000) }))

    if (parsed.kind !== "ready" || parsed.assetKind !== "prompt") throw new Error("Expected a Prompt candidate")

    expect(parsed.candidate.template.length).toBe(100_000)
  })

  test("requires own facts and preserves nullable revision instead of inferring it", () => {
    Object.keys(facts()).forEach((key) => {
      ;[facts(), promptInspection()].forEach((original) => {
        const metadata = Object.fromEntries(Object.entries(original).filter((entry) => entry[0] !== key))
        expect(SkillProposal.read(promptTool(promptInput(), metadata))).toEqual({
          kind: "invalid",
          issue: "proposal.factsMissing",
        })
        Object.setPrototypeOf(metadata, original)
        expect(SkillProposal.read(promptTool(promptInput(), metadata))).toEqual({
          kind: "invalid",
          issue: "proposal.factsMissing",
        })
      })
    })

    const inherited: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inherited, facts())
    expect(SkillProposal.read(promptTool(promptInput(), inherited))).toEqual({
      kind: "invalid",
      issue: "proposal.factsMissing",
    })

    const parsed = SkillProposal.read(
      promptTool(promptInput(), {
        ...facts(),
        exists: true,
        revision: "a".repeat(64),
        nameConflict: true,
        pathConflict: true,
      }),
    )

    if (parsed.kind !== "ready") throw new Error("Expected valid existing Prompt facts")

    expect(parsed.facts).toMatchObject({
      exists: true,
      revision: "a".repeat(64),
      nameConflict: true,
      pathConflict: true,
    })
  })

  test("rejects inconsistent and malformed Prompt facts", () => {
    for (const metadata of [
      { ...facts(), exists: true },
      { ...facts(), revision: "a".repeat(64) },
      { ...facts(), pathConflict: true },
      { ...facts(), exists: true, revision: "A".repeat(64) },
      { ...facts(), relativePath: "../Review.md" },
      { ...facts(), nameConflict: "false" },
    ])
      expect(SkillProposal.read(promptTool(promptInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })
  })

  test("keeps Skill, Command, and Prompt lists separate and revokes changed confirmations", () => {
    const messages = [
      message("msg_skill", tool()),
      message("msg_command", commandTool()),
      message("msg_prompt", promptTool()),
    ]

    expect(SkillProposal.list(messages).map((entry) => entry.tool.name)).toEqual(["propose_skill_asset"])
    expect(SkillProposal.list(messages, "command").map((entry) => entry.tool.name)).toEqual(["propose_command_asset"])
    expect(SkillProposal.list(messages, "prompt").map((entry) => entry.key)).toEqual(["msg_prompt:call_propose_review"])

    const before = SkillProposal.list(messages, "prompt")[0]

    for (const changed of [
      promptTool({ ...promptInput(), template: "Changed template" }),
      promptTool(promptInput(), { ...facts(), exists: true, revision: "b".repeat(64) }),
    ])
      expect(SkillProposal.list([message("msg_prompt", changed)], "prompt")[0]?.stamp).not.toBe(before?.stamp)
  })

  test("lists only completed Prompt tools", () => {
    const pending: SessionMessageAssistantTool = {
      ...promptTool(),
      time: { created: 1 },
      state: { status: "running", input: promptInput(), metadata: facts() },
    }

    expect(SkillProposal.read(pending)).toEqual({ kind: "invalid", issue: "proposal.pending" })
    expect(SkillProposal.list([message("msg_prompt", pending)], "prompt")).toEqual([])
  })

  test("uses the authoritative Prompt catalogue and readback before replacement", () => {
    expect(
      SkillProposal.current(ready(promptTool()), promptAsset(), { assets: [promptAsset()], invalid: [] }).kind,
    ).toBe("ready")

    for (const summary of [
      { ...promptAsset(), revision: "b".repeat(64) },
      { ...promptAsset(), name: "Changed name" },
      { ...promptAsset(), description: "Changed description" },
    ])
      expect(SkillProposal.current(ready(promptTool()), promptAsset(), { assets: [summary], invalid: [] })).toEqual({
        kind: "blocked",
        issue: "error.changed",
      })

    expect(SkillProposal.current(ready(promptTool()), promptAsset(), { assets: [], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
    expect(
      SkillProposal.current(ready(promptTool()), promptAsset(), {
        assets: [promptAsset(), { ...promptAsset(), relativePath: "another.md" }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.nameConflict" })
  })

  test("blocks invalid paths, invalid Prompt files, and a catalogue from another family", () => {
    expect(
      SkillProposal.current(
        ready(promptTool()),
        { ...promptAsset(), relativePath: "other.md" },
        { assets: [promptAsset()], invalid: [] },
      ),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(ready(promptTool()), promptAsset(), {
        assets: [promptAsset()],
        invalid: [{ relativePath: "Review.md", errorTag: "bad_template" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.current(ready(promptTool()), asset(), { assets: [asset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(
      SkillProposal.current(ready(promptTool()), promptAsset(), { assets: [commandAsset()], invalid: [] }),
    ).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })

  test("checks the exact reviewed Prompt template and family in the successful reply", () => {
    expect(SkillProposal.applied(ready(promptTool()), promptAsset())?.kind).toBe("prompt")
    expect(SkillProposal.applied(ready(promptTool()), promptAsset())?.revision).toBe(
      PromptAsset.Revision.make("a".repeat(64)),
    )

    for (const response of [
      { ...promptAsset(), template: "Different template" },
      { ...promptAsset(), template: "" },
      { ...promptAsset(), relativePath: "other.md" },
      { ...promptAsset(), name: "Another prompt" },
      { ...promptAsset(), description: "Another description" },
      asset(),
      commandAsset(),
    ])
      expect(SkillProposal.applied(ready(promptTool()), response)).toBeUndefined()
  })
})

describe("Prompt proposal target metadata", () => {
  test.each([...AssetPlacement.Scope.literals])(
    "decodes the own %s target with Prompt candidate and facts",
    (scope) => {
      const parsed = promptReady(promptTool(promptInput(), promptInspection(scope)))

      expect(parsed.candidate).toBeInstanceOf(PromptAsset.Candidate)
      expect(parsed.facts).toBeInstanceOf(SkillProposalContract.PromptFacts)
      expect(parsed.facts).toEqual(Schema.decodeUnknownSync(SkillProposalContract.PromptFacts)(facts()))
      expect(parsed.candidate).not.toHaveProperty("target")
      expect(parsed.facts).not.toHaveProperty("target")
      expect(parsed).toHaveProperty("target", Schema.decodeUnknownSync(AssetPlacement.Target)(promptTarget(scope)))

      if (!("target" in parsed)) throw new Error("Expected a selected Prompt target")
      expect(parsed.target).toBeInstanceOf(AssetPlacement.Target)
    },
  )

  test("keeps complete legacy facts independent of inherited target metadata", () => {
    expect(promptReady()).not.toHaveProperty("target")
    ;[promptTarget(), null].forEach((target) => {
      const metadata = facts()
      Object.setPrototypeOf(metadata, { target })
      const parsed = promptReady(promptTool(promptInput(), metadata))

      expect(parsed).toEqual(promptReady())
      expect(parsed).not.toHaveProperty("target")
      expect(parsed.facts).not.toHaveProperty("target")
    })
  })

  test.each(
    [
      undefined,
      null,
      false,
      "global",
      [],
      {},
      { scope: "project" },
      { root: promptTarget().root },
      { scope: "workspace", root: promptTarget().root },
      { scope: "Project", root: promptTarget().root },
      { scope: "project", root: null },
      { scope: "project", root: 1 },
    ].map((target) => ({ target })),
  )("rejects own malformed Prompt target $target without falling back to Location", (row) => {
    const metadata = facts()
    Object.defineProperty(metadata, "target", { value: row.target, enumerable: true })

    expect(SkillProposal.read(promptTool(promptInput(), metadata))).toEqual({
      kind: "invalid",
      issue: "proposal.factsInvalid",
    })
  })

  test("preserves root strings accepted by the canonical Prompt target schema", () => {
    ;["", "relative/prompts", "/project/.omnixa/prompts", "C:\\project\\.omnixa\\prompts"].forEach((root) => {
      const target = Schema.decodeUnknownSync(AssetPlacement.Target)({ ...promptTarget(), root })

      const parsed = promptReady(
        promptTool(promptInput(), { ...facts(), target: Schema.encodeSync(AssetPlacement.Target)(target) }),
      )

      expect(parsed).toHaveProperty("target", target)
    })
  })

  test("changes the Prompt stamp when only target scope or root changes", () => {
    const original = SkillProposal.list(
      [message("msg_prompt_target", promptTool(promptInput(), promptInspection()))],
      "prompt",
    )[0]

    if (!original) throw new Error("Expected a persisted Prompt proposal")
    ;[
      { ...promptTarget("location"), root: promptTarget().root },
      { ...promptTarget(), root: "/other/.omnixa/prompts" },
    ].forEach((target) => {
      const changed = SkillProposal.list(
        [message("msg_prompt_target", promptTool(promptInput(), { ...facts(), target }))],
        "prompt",
      )[0]

      if (!changed) throw new Error("Expected the changed Prompt proposal")

      expect(changed.key).toBe(original.key)
      expect(changed.stamp).not.toBe(original.stamp)
    })
  })
})

describe("Prompt proposal inspection", () => {
  test("uses canonical Prompt facts and the reviewed target without changing the literal candidate", () => {
    const body = {
      ...promptInput(),
      template: "\uFEFF \tReview {{target}}, $ARGUMENTS, $HOME and 中文.\r\n\r\nKeep trailing space. \t\r\n",
    }

    const part = promptTool(body, promptInspection())
    const original = promptReady(part)

    const response = Schema.encodeSync(PromptAsset.Inspection)(
      Schema.decodeUnknownSync(PromptAsset.Inspection)({
        ...promptInspection("global"),
        exists: true,
        revision: "b".repeat(64),
        nameConflict: true,
        pathConflict: true,
      }),
    )

    const reviewed = SkillProposal.inspected(original, response, "global")

    if (!reviewed || reviewed.assetKind !== "prompt") throw new Error("Expected a reviewed Prompt")

    expect(reviewed).not.toBe(original)
    expect(reviewed.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(promptTarget("global")))
    expect(reviewed.target).toBeInstanceOf(AssetPlacement.Target)
    expect(reviewed.facts).toBeInstanceOf(SkillProposalContract.PromptFacts)
    expect(reviewed.facts).toEqual(Schema.decodeUnknownSync(SkillProposalContract.PromptFacts)(response))
    expect(reviewed.facts.revision).toBe(PromptAsset.Revision.make("b".repeat(64)))
    expect(reviewed.facts).not.toHaveProperty("target")
    expect(reviewed.candidate).toBe(original.candidate)
    expect(reviewed.candidate.template).toBe(PromptAsset.Template.make(body.template))
    expect(Schema.encodeSync(PromptAsset.Candidate)(reviewed.candidate)).toEqual({
      ...body,
      relativePath: "Review.md",
    })
    expect(original).toHaveProperty("target", Schema.decodeUnknownSync(AssetPlacement.Target)(promptTarget()))
    expect(original.facts).toEqual(Schema.decodeUnknownSync(SkillProposalContract.PromptFacts)(facts()))
    expect(part).toEqual(promptTool(body, promptInspection()))
    expect(SkillProposal.inspected(original, response, "global")).not.toBe(reviewed)
  })

  test("gives complete historical Prompt facts an explicit Location review", () => {
    const original = promptReady()
    const reviewed = SkillProposal.inspected(original, promptInspection("location"), "location")

    expect(reviewed?.target).toEqual(Schema.decodeUnknownSync(AssetPlacement.Target)(promptTarget("location")))
    expect(reviewed?.facts).toBeInstanceOf(SkillProposalContract.PromptFacts)
    expect(reviewed?.facts).toEqual(Schema.decodeUnknownSync(SkillProposalContract.PromptFacts)(facts()))
    expect(original).not.toHaveProperty("target")
  })

  test("requires all six own Prompt inspection fields", () => {
    Object.keys(promptInspection()).forEach((key) => {
      const response = Object.fromEntries(Object.entries(promptInspection()).filter((entry) => entry[0] !== key))

      expect(SkillProposal.inspected(promptReady(), response, "project")).toBeUndefined()
      Object.setPrototypeOf(response, promptInspection())
      expect(SkillProposal.inspected(promptReady(), response, "project")).toBeUndefined()
    })
  })

  test.each(
    [
      null,
      undefined,
      [],
      { ...promptInspection(), exists: true },
      { ...promptInspection(), revision: "b".repeat(64) },
      { ...promptInspection(), pathConflict: true },
      { ...promptInspection(), exists: true, revision: "B".repeat(64) },
      { ...promptInspection(), nameConflict: "false" },
      { ...promptInspection(), relativePath: "Other.md" },
      { ...promptInspection(), relativePath: "../Review.md" },
      { ...promptInspection(), relativePath: "" },
      { ...promptInspection(), target: null },
      { ...promptInspection(), target: undefined },
      { ...promptInspection(), target: [] },
      { ...promptInspection(), target: { scope: "project" } },
      { ...promptInspection(), target: { scope: "workspace", root: promptTarget().root } },
    ].map((response) => ({ response })),
  )("rejects malformed or inconsistent Prompt inspection $response", (row) => {
    expect(SkillProposal.inspected(promptReady(), row.response, "project")).toBeUndefined()
  })

  test("checks the requested Prompt scope even when the returned root matches", () => {
    expect(
      SkillProposal.inspected(
        promptReady(),
        { ...promptInspection(), target: { ...promptTarget("location"), root: promptTarget().root } },
        "project",
      ),
    ).toBeUndefined()
    expect(SkillProposal.inspected(promptReady(), promptInspection(), "global")).toBeUndefined()
  })
})

describe("selected Prompt owner identity", () => {
  const proposal = () => promptReady(promptTool(promptInput(), promptInspection()))

  test("returns canonical Prompt Info only for the reviewed owner", () => {
    const current = SkillProposal.current(proposal(), promptAsset("project"), promptCatalog("project"))
    const applied = SkillProposal.applied(proposal(), promptAsset("project"))

    expect(current).toEqual({
      kind: "ready",
      current: Schema.decodeUnknownSync(PromptAsset.Info)(promptAsset("project")),
    })
    expect(applied).toBeInstanceOf(PromptAsset.Info)
    expect(applied).toEqual(Schema.decodeUnknownSync(PromptAsset.Info)(promptAsset("project")))
  })

  test.each([
    { label: "same SHA at a different root", target: { ...promptTarget(), root: "/other/.omnixa/prompts" } },
    { label: "same root with a different scope", target: { ...promptTarget("location"), root: promptTarget().root } },
  ])("rejects $label in catalog, content and apply", (row) => {
    const content = { ...promptAsset("project"), target: row.target }
    const catalog = { ...promptCatalog("project"), target: row.target }

    expect(content.revision).toBe(promptAsset("project").revision)
    expect(SkillProposal.current(proposal(), content, promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), promptAsset("project"), catalog)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), content, catalog)).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.applied(proposal(), content)).toBeUndefined()
  })

  test("rejects omitted targets from selected content, catalog and apply", () => {
    expect(SkillProposal.current(proposal(), promptAsset(), promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), promptAsset("project"), promptCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), promptAsset(), promptCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), promptAsset())).toBeUndefined()
  })

  test.each(
    [undefined, null, [], {}, { scope: "project" }, { scope: "project", root: false }].map((target) => ({ target })),
  )("rejects malformed selected Prompt reply target $target", (row) => {
    const content = promptAsset("project")
    const catalog = promptCatalog("project")
    Object.defineProperty(content, "target", { value: row.target, enumerable: true })
    Object.defineProperty(catalog, "target", { value: row.target, enumerable: true })

    expect(SkillProposal.current(proposal(), content, promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(proposal(), promptAsset("project"), catalog)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(proposal(), content)).toBeUndefined()
  })

  test("does not let legacy Prompt replies adopt a target without a review", () => {
    expect(SkillProposal.current(promptReady(), promptAsset(), promptCatalog()).kind).toBe("ready")
    expect(SkillProposal.applied(promptReady(), promptAsset())).toBeDefined()
    expect(SkillProposal.current(promptReady(), promptAsset("project"), promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(promptReady(), promptAsset(), promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(promptReady(), promptAsset("project"), promptCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(promptReady(), promptAsset("project"))).toBeUndefined()
  })

  test("keeps peer replacement review distinct from exact candidate readback", () => {
    const peer = { ...promptAsset("project"), template: "Changed by a peer.\r\n", revision: "b".repeat(64) }

    const current = SkillProposal.current(proposal(), peer, {
      ...promptCatalog("project"),
      assets: promptCatalog().assets.map((entry) => ({ ...entry, revision: peer.revision })),
    })

    expect(current).toEqual({ kind: "ready", current: Schema.decodeUnknownSync(PromptAsset.Info)(peer) })
    expect(SkillProposal.applied(proposal(), peer)).toBeUndefined()
    expect(SkillProposal.current(proposal(), peer, promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
  })

  test("uses the re-inspected global Prompt owner instead of the persisted Project owner", () => {
    const reviewed = SkillProposal.inspected(proposal(), promptInspection("global"), "global")

    if (!reviewed || reviewed.assetKind !== "prompt") throw new Error("Expected a global Prompt inspection")

    expect(SkillProposal.current(reviewed, promptAsset("global"), promptCatalog("global")).kind).toBe("ready")
    expect(SkillProposal.applied(reviewed, promptAsset("global"))).toEqual(
      Schema.decodeUnknownSync(PromptAsset.Info)(promptAsset("global")),
    )
    expect(SkillProposal.current(reviewed, promptAsset("project"), promptCatalog("project"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.applied(reviewed, promptAsset("project"))).toBeUndefined()
  })
})

function agentInput() {
  return {
    name: "Review",
    description: "Review code",
    config: 'permissions:\n  - action: read\n    resource: "*"\n    effect: allow',
    source: "Inspect the actual source.\n",
  }
}

function agentResult(): AgentAssetApplyOutput {
  return {
    asset: { kind: "agent", ...agentInput(), relativePath: "Review.md", revision: "a".repeat(64), handoffs: [] },
    warnings: [{ code: "wildcard_allow", action: "read", resource: "*" }],
  }
}

function agentTool(metadata: Record<string, JsonValue> = { ...facts(), warnings: agentResult().warnings }) {
  return { ...tool(agentInput(), metadata), name: "propose_agent_asset" }
}

describe("saved Agent proposal contract", () => {
  const candidate = () => Schema.decodeUnknownSync(AgentAsset.Candidate)({ ...agentInput(), relativePath: "Review.md" })

  test("reads a Config import from its captured candidate and never reconstructs a missing definition", () => {
    const original = agentTool()

    if (original.state.status !== "completed") throw new Error("Expected the completed Agent proposal fixture")
    const expected = candidate()

    const imported = {
      ...original,
      state: {
        ...original.state,
        input: { configAgentID: "Review" },
        metadata: {
          ...facts(),
          warnings: agentResult().warnings,
          candidate: Schema.encodeSync(AgentAsset.Candidate)(expected),
        },
      },
    }

    const parsed = SkillProposal.read(imported)

    if (parsed.kind !== "ready" || parsed.assetKind !== "agent") throw new Error("Expected the captured Config import")
    expect(parsed.candidate).toEqual(expected)
    expect(parsed.candidate.config).toBe(expected.config)
    expect(parsed.candidate.source).toBe(expected.source)
    expect(
      SkillProposal.read({ ...imported, state: { ...imported.state, metadata: { ...facts(), warnings: [] } } }),
    ).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
  })

  test("preserves config and source as an Agent instead of dispatching it as a Command", () => {
    const parsed = SkillProposal.read(agentTool())
    expect(parsed.kind).toBe("ready")

    if (parsed.kind !== "ready" || parsed.assetKind !== "agent") throw new Error("Expected an Agent candidate")

    expect(parsed.candidate).toEqual(candidate())
    expect(parsed.candidate).not.toHaveProperty("invocation")
    expect(parsed.facts).toMatchObject({ revision: null, warnings: agentResult().warnings })
  })

  test("requires canonical persisted warning facts and rejects malformed declarations", () => {
    expect(SkillProposal.read(agentTool(facts()))).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })

    for (const warnings of [
      null,
      "none",
      [{ code: "unknown", action: "read", resource: "*" }],
      [{ code: "wildcard_allow" }],
    ])
      expect(SkillProposal.read(agentTool({ ...facts(), warnings }))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })

    expect(SkillProposal.read(agentTool({ ...facts(), warnings: [] })).kind).toBe("ready")
  })

  test("lists the Agent family separately and revokes its identity when persisted warnings change", () => {
    const messages = [message("msg_command", commandTool()), message("msg_agent", agentTool())]
    const listed = SkillProposal.list(messages, "agent")
    expect(listed.map((entry) => entry.tool.name)).toEqual(["propose_agent_asset"])
    expect(SkillProposal.list(messages, "command").map((entry) => entry.tool.name)).toEqual(["propose_command_asset"])
    expect(
      SkillProposal.list([message("msg_agent", agentTool({ ...facts(), warnings: [] }))], "agent")[0]?.stamp,
    ).not.toBe(listed[0]?.stamp)
  })

  test("preserves the canonical apply wrapper warnings with the exact saved Agent", () => {
    const result = SkillProposal.applied(ready(agentTool()), agentResult())
    expect(result).toEqual({
      ...Schema.decodeUnknownSync(AgentAsset.Info)(agentResult().asset),
      warnings: [new AgentAsset.Warning({ code: "wildcard_allow", action: "read", resource: "*" })],
    })
  })

  test("rejects mismatched Agent content, unexpected handoffs and missing apply warnings", () => {
    for (const changed of [
      { config: "mode: subagent" },
      { source: "Different instructions" },
      { relativePath: "Other.md" },
      { name: "Other" },
      { description: "Different description" },
      { handoffs: [{ label: "Build", agent: "build", prompt: "Implement it" }] },
    ])
      expect(
        SkillProposal.applied(ready(agentTool()), { ...agentResult(), asset: { ...agentResult().asset, ...changed } }),
      ).toBeUndefined()

    const incomplete = agentResult()
    Object.defineProperty(incomplete, "warnings", { value: undefined })
    expect(SkillProposal.applied(ready(agentTool()), incomplete)).toBeUndefined()
  })

  test("uses Agent content and catalogue revisions before replacement and keeps current handoffs visible", () => {
    const info = { ...agentResult().asset, handoffs: [{ label: "Build", agent: "build", prompt: "Implement it" }] }
    expect(SkillProposal.current(ready(agentTool()), info, { assets: [info], invalid: [] })).toEqual({
      kind: "ready",
      current: Schema.decodeUnknownSync(AgentAsset.Info)(info),
    })
    expect(
      SkillProposal.current(ready(agentTool()), info, { assets: [{ ...info, revision: "b".repeat(64) }], invalid: [] }),
    ).toEqual({ kind: "blocked", issue: "error.changed" })
    expect(
      SkillProposal.current(ready(agentTool()), info, {
        assets: [info, { ...info, relativePath: "Other.md" }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.nameConflict" })
    expect(
      SkillProposal.current(ready(agentTool()), commandAsset(), { assets: [commandAsset()], invalid: [] }),
    ).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })
})

function mcpInput() {
  return {
    name: "Review",
    description: "Review MCP configuration",
    command: "node",
    args: ["server.js", "--label", 'quoted "value"'],
    env: { REVIEW_LABEL: 'quoted "value"\nsecond line', EMPTY: "" },
    configJson: '{\n  "transport": "stdio",\n  "enabled": false\n}\n',
  }
}

function mcpTool(
  body: Record<string, JsonValue> = mcpInput(),
  metadata: Record<string, JsonValue> | undefined = facts(),
): SessionMessageAssistantTool {
  return { ...tool(body, metadata), name: "propose_mcp_asset" }
}

function mcpAsset(): McpAssetApplyOutput {
  return { kind: "mcp", ...mcpInput(), relativePath: "Review.md", revision: "a".repeat(64) }
}

describe("saved MCP proposal contract", () => {
  const candidate = () => Schema.decodeUnknownSync(MCPAsset.Candidate)({ ...mcpInput(), relativePath: "Review.md" })

  test("preserves every MCP input field and nullable facts without treating it as another asset family", () => {
    const parsed = SkillProposal.read(
      mcpTool(
        { ...mcpInput(), source: "Not a Command", config: "Not an Agent", content: "Not a Skill" },
        { ...facts(), truncated: true, outputPath: "/tmp/result.txt" },
      ),
    )

    if (parsed.kind !== "ready" || parsed.assetKind !== "mcp") throw new Error("Expected an MCP candidate")

    expect(parsed.candidate).toEqual(candidate())
    expect(parsed.candidate.args).toEqual(["server.js", "--label", 'quoted "value"'])
    expect(parsed.candidate.env).toEqual({ REVIEW_LABEL: 'quoted "value"\nsecond line', EMPTY: "" })
    expect(parsed.candidate.configJson).toBe(MCPAsset.ConfigJson.make(mcpInput().configJson))
    expect(parsed.candidate).not.toHaveProperty("source")
    expect(parsed.candidate).not.toHaveProperty("config")
    expect(parsed.candidate).not.toHaveProperty("content")
    expect(parsed.facts).toMatchObject(facts())
    expect(Object.keys(parsed.facts).toSorted()).toEqual(Object.keys(facts()).toSorted())
  })

  test("requires every own MCP input field", () => {
    for (const key of ["name", "description", "command", "args", "env", "configJson"]) {
      const body = Object.fromEntries(Object.entries(mcpInput()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(mcpTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    }

    const inherited: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inherited, mcpInput())
    expect(SkillProposal.read(mcpTool(inherited))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
  })

  test("rejects invalid MCP scalar, argument, environment and config shapes", () => {
    for (const body of [
      { ...mcpInput(), name: "" },
      { ...mcpInput(), description: 42 },
      { ...mcpInput(), command: "" },
      { ...mcpInput(), args: "server.js" },
      { ...mcpInput(), args: [1] },
      { ...mcpInput(), env: [] },
      { ...mcpInput(), env: { REVIEW_LABEL: false } },
      { ...mcpInput(), configJson: null },
      { ...mcpInput(), configJson: "x".repeat(100_001) },
    ])
      expect(SkillProposal.read(mcpTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputInvalid" })
  })

  test("requires all five own MCP facts without inventing missing revisions", () => {
    for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict"]) {
      const metadata = Object.fromEntries(Object.entries(facts()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(mcpTool(mcpInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsMissing",
      })
    }

    const inherited: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inherited, facts())
    expect(SkillProposal.read(mcpTool(mcpInput(), inherited))).toEqual({
      kind: "invalid",
      issue: "proposal.factsMissing",
    })

    const legacy = mcpTool()

    if (legacy.state.status !== "completed") throw new Error("Expected a completed MCP tool")

    delete legacy.state.metadata
    expect(SkillProposal.read(legacy)).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
  })

  test("keeps valid MCP conflicts explicit and rejects contradictory or malformed facts", () => {
    const parsed = SkillProposal.read(
      mcpTool(mcpInput(), {
        ...facts(),
        exists: true,
        revision: "a".repeat(64),
        nameConflict: true,
        pathConflict: true,
      }),
    )

    if (parsed.kind !== "ready") throw new Error("Expected valid existing MCP facts")

    expect(parsed.facts).toMatchObject({
      exists: true,
      revision: "a".repeat(64),
      nameConflict: true,
      pathConflict: true,
    })

    for (const metadata of [
      { ...facts(), exists: true },
      { ...facts(), revision: "a".repeat(64) },
      { ...facts(), pathConflict: true },
      { ...facts(), exists: true, revision: "A".repeat(64) },
      { ...facts(), relativePath: "../Review.md" },
      { ...facts(), relativePath: "Review.txt" },
      { ...facts(), nameConflict: "false" },
    ])
      expect(SkillProposal.read(mcpTool(mcpInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })
  })

  test("lists only completed MCP proposals and keeps all asset families separate", () => {
    const pending: SessionMessageAssistantTool = {
      ...mcpTool(),
      time: { created: 1 },
      state: { status: "running", input: mcpInput(), metadata: facts() },
    }

    const messages = [
      message("msg_skill", tool()),
      message("msg_command", commandTool()),
      message("msg_prompt", promptTool()),
      message("msg_agent", agentTool()),
      message("msg_mcp", mcpTool()),
      message("msg_pending", pending),
    ]

    expect(SkillProposal.read(pending)).toEqual({ kind: "invalid", issue: "proposal.pending" })
    expect(SkillProposal.list(messages).map((entry) => entry.tool.name)).toEqual(["propose_skill_asset"])
    expect(SkillProposal.list(messages, "command").map((entry) => entry.tool.name)).toEqual(["propose_command_asset"])
    expect(SkillProposal.list(messages, "prompt").map((entry) => entry.tool.name)).toEqual(["propose_prompt_asset"])
    expect(SkillProposal.list(messages, "agent").map((entry) => entry.tool.name)).toEqual(["propose_agent_asset"])
    expect(SkillProposal.list(messages, "mcp").map((entry) => entry.key)).toEqual(["msg_mcp:call_propose_review"])
  })

  test("revokes MCP confirmation identity when persisted configuration or facts change", () => {
    const before = SkillProposal.list([message("msg_mcp", mcpTool())], "mcp")[0]

    for (const changed of [
      mcpTool({ ...mcpInput(), command: "bun" }),
      mcpTool({ ...mcpInput(), args: [...mcpInput().args].reverse() }),
      mcpTool({ ...mcpInput(), env: { REVIEW_LABEL: "Changed", EMPTY: "" } }),
      mcpTool({ ...mcpInput(), configJson: mcpInput().configJson.trim() }),
      mcpTool(mcpInput(), { ...facts(), exists: true, revision: "b".repeat(64) }),
    ])
      expect(SkillProposal.list([message("msg_mcp", changed)], "mcp")[0]?.stamp).not.toBe(before?.stamp)
  })

  test("uses the MCP catalogue revision and preserves the current configuration for overwrite review", () => {
    const current = { ...mcpAsset(), command: "bun", args: [], env: {}, configJson: "{}" }

    expect(SkillProposal.current(ready(mcpTool()), current, { assets: [current], invalid: [] })).toEqual({
      kind: "ready",
      current: Schema.decodeUnknownSync(MCPAsset.Info)(current),
    })

    for (const summary of [
      { ...mcpAsset(), revision: "b".repeat(64) },
      { ...mcpAsset(), name: "Other" },
      { ...mcpAsset(), description: "Changed description" },
    ])
      expect(SkillProposal.current(ready(mcpTool()), mcpAsset(), { assets: [summary], invalid: [] })).toEqual({
        kind: "blocked",
        issue: "error.changed",
      })

    expect(SkillProposal.current(ready(mcpTool()), mcpAsset(), { assets: [], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
    expect(
      SkillProposal.current(ready(mcpTool()), mcpAsset(), {
        assets: [mcpAsset(), { ...mcpAsset(), relativePath: "Other.md" }],
        invalid: [],
      }),
    ).toEqual({ kind: "blocked", issue: "error.nameConflict" })
  })

  test("blocks mismatched MCP paths, invalid inventory and content or catalogues from another family", () => {
    expect(
      SkillProposal.current(
        ready(mcpTool()),
        { ...mcpAsset(), relativePath: "Other.md" },
        { assets: [mcpAsset()], invalid: [] },
      ),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(ready(mcpTool()), mcpAsset(), {
        assets: [mcpAsset()],
        invalid: [{ relativePath: "Review.md", errorTag: "bad_frontmatter" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.current(ready(mcpTool()), commandAsset(), { assets: [commandAsset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(ready(mcpTool()), mcpAsset(), { assets: [agentResult().asset], invalid: [] })).toEqual(
      {
        kind: "blocked",
        issue: "error.current",
      },
    )
  })

  test("accepts direct MCP Info with the same environment independent of key order", () => {
    const response = { ...mcpAsset(), env: { EMPTY: "", REVIEW_LABEL: mcpInput().env.REVIEW_LABEL } }

    expect(SkillProposal.applied(ready(mcpTool()), response)).toEqual(
      Schema.decodeUnknownSync(MCPAsset.Info)(mcpAsset()),
    )

    const wrapped = agentResult()
    // A malformed wire reply must not turn the Agent apply wrapper into an MCP success.
    Object.defineProperty(wrapped, "asset", { value: mcpAsset() })
    expect(SkillProposal.applied(ready(mcpTool()), wrapped)).toBeUndefined()
  })

  test("rejects successful replies that change any reviewed MCP field, argument order or raw config bytes", () => {
    for (const response of [
      { ...mcpAsset(), relativePath: "Other.md" },
      { ...mcpAsset(), name: "Other" },
      { ...mcpAsset(), description: "Changed description" },
      { ...mcpAsset(), command: "bun" },
      { ...mcpAsset(), args: [] },
      { ...mcpAsset(), args: [...mcpInput().args].reverse() },
      { ...mcpAsset(), args: ["server.js", "--label", "Changed"] },
      { ...mcpAsset(), env: { EMPTY: "" } },
      { ...mcpAsset(), env: { ...mcpInput().env, EXTRA: "extra" } },
      { ...mcpAsset(), env: { REVIEW_LABEL: "Changed", EMPTY: "" } },
      { ...mcpAsset(), env: { REVIEW_LABEL: mcpInput().env.REVIEW_LABEL, OTHER: "" } },
      { ...mcpAsset(), configJson: mcpInput().configJson.trim() },
      { ...mcpAsset(), configJson: '{"transport":"stdio","enabled":false}' },
      asset(),
      commandAsset(),
      promptAsset(),
      agentResult(),
    ])
      expect(SkillProposal.applied(ready(mcpTool()), response)).toBeUndefined()
  })

  test("rejects missing or malformed MCP readback fields and inherited environment values", () => {
    for (const change of [
      { field: "command", value: undefined },
      { field: "args", value: undefined },
      { field: "env", value: undefined },
      { field: "configJson", value: undefined },
      { field: "revision", value: "not-a-revision" },
      { field: "command", value: 42 },
      { field: "args", value: "server.js" },
      { field: "args", value: [42] },
      { field: "env", value: [] },
      { field: "env", value: { REVIEW_LABEL: false, EMPTY: "" } },
      { field: "configJson", value: null },
    ]) {
      const response = mcpAsset()
      // Exercise corrupt runtime replies at the real decoder without weakening its typed SDK boundary.
      Object.defineProperty(response, change.field, { value: change.value })
      expect(SkillProposal.applied(ready(mcpTool()), response)).toBeUndefined()
    }

    const response = { ...mcpAsset(), env: { EMPTY: "", OTHER: "" } }
    Object.setPrototypeOf(response.env, { REVIEW_LABEL: mcpInput().env.REVIEW_LABEL })
    expect(SkillProposal.applied(ready(mcpTool()), response)).toBeUndefined()
  })
})

function pluginInput() {
  return {
    name: "Review",
    description: "Review changes",
    content:
      '# Keep this comment\nkind: plugin\nname: Review\ndescription: Review changes\nversion: "1.0.0"\nsource:\n  type: mcp\n  mcp:\n    name: review-server\nhooks:\n  - event: PreToolUse\n    command: "node review.cjs"\nextra: preserve this field\n',
  }
}

function pluginFacts() {
  return { ...facts(), relativePath: "Review.plugin.yaml" }
}

function pluginTool(
  body: Record<string, JsonValue> = pluginInput(),
  metadata: Record<string, JsonValue> | undefined = pluginFacts(),
): SessionMessageAssistantTool {
  return { ...tool(body, metadata), name: "propose_plugin_asset" }
}

function pluginAsset(): PluginAssetApplyOutput {
  return {
    kind: "plugin",
    ...pluginInput(),
    relativePath: "Review.plugin.yaml",
    revision: "a".repeat(64),
    version: "1.0.0",
    source: { type: "mcp", mcp: { name: "review-server" } },
    hooks: [{ event: "PreToolUse", command: "node review.cjs" }],
  }
}

function pluginCatalog(): PluginAssetListOutput {
  return {
    assets: [
      {
        kind: "plugin",
        name: "Review",
        description: "Review changes",
        relativePath: "Review.plugin.yaml",
        revision: "a".repeat(64),
        source: "mcp",
        toolCount: 0,
      },
    ],
    invalid: [],
    bridged: [],
  }
}

describe("saved Plugin proposal contract", () => {
  const candidate = () =>
    Schema.decodeUnknownSync(PluginAsset.Candidate)({ ...pluginInput(), relativePath: "Review.plugin.yaml" })

  test("preserves raw Plugin YAML and the short facts path without falling into Skill or Command parsing", () => {
    const parsed = SkillProposal.read(
      pluginTool(
        { ...pluginInput(), source: "Not a Command", config: "Not an Agent", slash: true, triggers: ["ignored"] },
        { ...pluginFacts(), truncated: true, outputPath: "/tmp/result.txt" },
      ),
    )

    if (parsed.kind !== "ready" || parsed.assetKind !== "plugin") throw new Error("Expected a Plugin candidate")

    expect(parsed.candidate).toEqual({ ...candidate(), relativePath: "Review.plugin.yaml" })
    expect(parsed.candidate.content).toBe(PluginAsset.Content.make(pluginInput().content))
    expect(parsed.candidate.relativePath.endsWith(".plugin.yaml")).toBe(true)
    expect(parsed.candidate).not.toHaveProperty("source")
    expect(parsed.candidate).not.toHaveProperty("slash")
    expect(parsed.candidate).not.toHaveProperty("config")
    expect(parsed.facts).toMatchObject(pluginFacts())
    expect(Object.keys(parsed.facts).toSorted()).toEqual(Object.keys(pluginFacts()).toSorted())
  })

  test("requires every own Plugin input field and all five own facts", () => {
    for (const key of ["name", "description", "content"]) {
      const body = Object.fromEntries(Object.entries(pluginInput()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(pluginTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    }

    for (const key of ["relativePath", "exists", "revision", "nameConflict", "pathConflict"]) {
      const metadata = Object.fromEntries(Object.entries(pluginFacts()).filter((entry) => entry[0] !== key))
      expect(SkillProposal.read(pluginTool(pluginInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsMissing",
      })
    }

    const inheritedInput: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inheritedInput, pluginInput())
    expect(SkillProposal.read(pluginTool(inheritedInput))).toEqual({ kind: "invalid", issue: "proposal.inputMissing" })
    const inheritedFacts: Record<string, JsonValue> = {}
    Object.setPrototypeOf(inheritedFacts, pluginFacts())
    expect(SkillProposal.read(pluginTool(pluginInput(), inheritedFacts))).toEqual({
      kind: "invalid",
      issue: "proposal.factsMissing",
    })

    const legacy = pluginTool()

    if (legacy.state.status !== "completed") throw new Error("Expected a completed Plugin tool")

    delete legacy.state.metadata
    expect(SkillProposal.read(legacy)).toEqual({ kind: "invalid", issue: "proposal.factsMissing" })
  })

  test("rejects malformed Plugin input and content exceeding the canonical bound", () => {
    for (const body of [
      { ...pluginInput(), name: "" },
      { ...pluginInput(), description: 42 },
      { ...pluginInput(), content: null },
      { ...pluginInput(), content: ["kind: plugin"] },
      { ...pluginInput(), content: "x".repeat(1_000_001) },
    ])
      expect(SkillProposal.read(pluginTool(body))).toEqual({ kind: "invalid", issue: "proposal.inputInvalid" })
  })

  test("requires a short plugin.yaml facts path and rejects inconsistent revision facts", () => {
    for (const relativePath of [
      "",
      "Review.md",
      "Review.plugin.yml",
      ".plugin.yaml",
      ".omnixa/plugins/Review.plugin.yaml",
      "nested/Review.plugin.yaml",
      "../Review.plugin.yaml",
      "nested\\Review.plugin.yaml",
      "/tmp/Review.plugin.yaml",
      "Review\n.plugin.yaml",
    ])
      expect(SkillProposal.read(pluginTool(pluginInput(), { ...pluginFacts(), relativePath }))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })

    for (const metadata of [
      { ...pluginFacts(), exists: true },
      { ...pluginFacts(), revision: "a".repeat(64) },
      { ...pluginFacts(), pathConflict: true },
      { ...pluginFacts(), exists: true, revision: "A".repeat(64) },
      { ...pluginFacts(), nameConflict: "false" },
    ])
      expect(SkillProposal.read(pluginTool(pluginInput(), metadata))).toEqual({
        kind: "invalid",
        issue: "proposal.factsInvalid",
      })

    const existing = SkillProposal.read(
      pluginTool(pluginInput(), {
        ...pluginFacts(),
        exists: true,
        revision: "a".repeat(64),
        nameConflict: true,
        pathConflict: true,
      }),
    )

    if (existing.kind !== "ready") throw new Error("Expected valid existing Plugin facts")

    expect(existing.facts).toMatchObject({
      exists: true,
      revision: "a".repeat(64),
      nameConflict: true,
      pathConflict: true,
    })
  })

  test("lists only completed Plugin tools and revokes confirmation when persisted content or facts change", () => {
    const pending: SessionMessageAssistantTool = {
      ...pluginTool(),
      time: { created: 1 },
      state: { status: "running", input: pluginInput(), metadata: pluginFacts() },
    }

    const messages = [
      message("msg_skill", tool()),
      message("msg_command", commandTool()),
      message("msg_agent", agentTool()),
      message("msg_mcp", mcpTool()),
      message("msg_plugin", pluginTool()),
      message("msg_pending", pending),
    ]

    expect(SkillProposal.read(pending)).toEqual({ kind: "invalid", issue: "proposal.pending" })
    expect(SkillProposal.list(messages).map((entry) => entry.tool.name)).toEqual(["propose_skill_asset"])
    expect(SkillProposal.list(messages, "command").map((entry) => entry.tool.name)).toEqual(["propose_command_asset"])
    expect(SkillProposal.list(messages, "agent").map((entry) => entry.tool.name)).toEqual(["propose_agent_asset"])
    expect(SkillProposal.list(messages, "mcp").map((entry) => entry.tool.name)).toEqual(["propose_mcp_asset"])
    expect(SkillProposal.list(messages, "plugin").map((entry) => entry.key)).toEqual(["msg_plugin:call_propose_review"])

    const before = SkillProposal.list(messages, "plugin")[0]

    for (const changed of [
      pluginTool({ ...pluginInput(), content: pluginInput().content.trim() }),
      pluginTool(pluginInput(), { ...pluginFacts(), exists: true, revision: "b".repeat(64) }),
    ])
      expect(SkillProposal.list([message("msg_plugin", changed)], "plugin")[0]?.stamp).not.toBe(before?.stamp)
  })

  test("distinguishes Plugin candidates from every other asset family", () => {
    expect(ready(pluginTool()).assetKind).toBe("plugin")

    for (const part of [tool(), commandTool(), promptTool(), agentTool(), mcpTool(), workflowTool()]) {
      const parsed = SkillProposal.read(part)

      if (parsed.kind !== "ready") throw new Error("Expected a ready fixture proposal")

      expect(parsed.assetKind).not.toBe("plugin")
    }
  })

  test("keeps the current Plugin declaration for overwrite review using the catalogue revision", () => {
    const current = { ...pluginAsset(), content: pluginInput().content.replace('"1.0.0"', '"2.0.0"'), version: "2.0.0" }

    expect(SkillProposal.current(ready(pluginTool()), current, pluginCatalog())).toEqual({
      kind: "ready",
      current: Schema.decodeUnknownSync(PluginAsset.Info)(current),
    })

    for (const changed of [{ revision: "b".repeat(64) }, { name: "Changed" }, { description: "Changed description" }]) {
      const catalog = pluginCatalog()
      catalog.assets = catalog.assets.map((entry) => ({ ...entry, ...changed }))
      expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), catalog)).toEqual({
        kind: "blocked",
        issue: "error.changed",
      })
    }

    const missing = pluginCatalog()
    missing.assets = []
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), missing)).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
    const collision = pluginCatalog()
    collision.assets.push(...collision.assets.map((entry) => ({ ...entry, relativePath: "Other.plugin.yaml" })))
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), collision)).toEqual({
      kind: "blocked",
      issue: "error.nameConflict",
    })
  })

  test("blocks mismatched Plugin paths, invalid entries and another family's readback", () => {
    expect(
      SkillProposal.current(
        ready(pluginTool()),
        { ...pluginAsset(), relativePath: "Other.plugin.yaml" },
        pluginCatalog(),
      ),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(ready(pluginTool()), pluginAsset(), {
        ...pluginCatalog(),
        invalid: [{ relativePath: "Review.plugin.yaml", errorTag: "bad_frontmatter" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(ready(pluginTool()), commandAsset(), { assets: [commandAsset()], invalid: [] }),
    ).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), { assets: [asset()], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })

  test("validates the canonical Plugin catalogue including bridged entries without treating them as local targets", () => {
    const catalog = pluginCatalog()
    catalog.bridged = [
      {
        name: "Review",
        description: "External plugin",
        source: "codex",
        originPath: "/outside/plugin.json",
        format: "external-plugin",
        bundled: { commands: 1, skills: 0, agents: 0, hooks: 0, mcpServers: 0 },
      },
    ]
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), catalog).kind).toBe("ready")

    const missing = pluginCatalog()
    Object.defineProperty(missing, "bridged", { value: undefined })
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), missing)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    const malformed = pluginCatalog()
    Object.defineProperty(malformed, "bridged", { value: [{ name: "Review" }] })
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), malformed)).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })

  test("accepts direct Plugin Info with structured source and hooks while preserving the YAML exactly", () => {
    const saved = SkillProposal.applied(ready(pluginTool()), pluginAsset())

    if (saved?.kind !== "plugin") throw new Error("Expected direct Plugin Info")

    expect(saved.content).toBe(PluginAsset.Content.make(pluginInput().content))
    expect(saved.source).toEqual({ type: "mcp", mcp: { name: "review-server" } })
    expect(saved.hooks).toEqual([{ event: "PreToolUse", command: "node review.cjs" }])
    expect(saved.revision).toBe(PluginAsset.Revision.make("a".repeat(64)))

    const wrapped = agentResult()
    // Exercise an incorrect wrapper shape without weakening the typed response boundary.
    Object.defineProperty(wrapped, "asset", { value: pluginAsset() })
    expect(SkillProposal.applied(ready(pluginTool()), wrapped)).toBeUndefined()
  })

  test("decodes JSON-encoded non-finite Plugin hook timeouts in current and applied responses", () => {
    for (const value of [
      { yaml: ".nan", json: "NaN", decoded: Number.NaN },
      { yaml: ".inf", json: "Infinity", decoded: Number.POSITIVE_INFINITY },
      { yaml: "-.inf", json: "-Infinity", decoded: Number.NEGATIVE_INFINITY },
    ]) {
      const content = pluginInput().content.replace(
        '    command: "node review.cjs"\n',
        `    command: "node review.cjs"\n    timeout: ${value.yaml}\n`,
      )

      const proposal = ready(pluginTool({ ...pluginInput(), content }))

      const response = { ...pluginAsset(), content }
      // HttpApi encodes these numbers as strings, despite the SDK's decoded Number type.
      Object.defineProperty(response, "hooks", {
        value: [{ event: "PreToolUse", command: "node review.cjs", timeout: value.json }],
      })
      const current = SkillProposal.current(proposal, response, pluginCatalog())
      const applied = SkillProposal.applied(proposal, response)

      if (current.kind !== "ready" || current.current.kind !== "plugin" || applied?.kind !== "plugin")
        throw new Error("Expected the JSON-encoded Plugin response to decode")

      expect(current.current.hooks?.[0]?.timeout).toBe(value.decoded)
      expect(applied.hooks?.[0]?.timeout).toBe(value.decoded)
      expect(current.current.content).toBe(PluginAsset.Content.make(content))
      expect(applied.content).toBe(PluginAsset.Content.make(content))
    }
  })

  test("decodes JSON-encoded Plugin catalogue numbers before checking the current revision", () => {
    const catalog = pluginCatalog()
    catalog.assets = catalog.assets.map((entry) => Object.defineProperty(entry, "toolCount", { value: "Infinity" }))
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), catalog).kind).toBe("ready")

    catalog.assets = catalog.assets.map((entry) => ({ ...entry, revision: "b".repeat(64) }))
    expect(SkillProposal.current(ready(pluginTool()), pluginAsset(), catalog)).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
  })

  test("rejects changes to reviewed Plugin identity, YAML bytes or asset family", () => {
    for (const response of [
      { ...pluginAsset(), relativePath: "Other.plugin.yaml" },
      { ...pluginAsset(), name: "Other" },
      { ...pluginAsset(), description: "Changed" },
      { ...pluginAsset(), content: pluginInput().content.trim() },
      { ...pluginAsset(), content: pluginInput().content.replace("# Keep this comment\n", "") },
      { ...pluginAsset(), content: pluginInput().content.replace("extra: preserve this field\n", "") },
      { ...pluginAsset(), content: pluginInput().content.replaceAll("\n", "\r\n") },
      asset(),
      commandAsset(),
      promptAsset(),
      mcpAsset(),
      agentResult(),
    ])
      expect(SkillProposal.applied(ready(pluginTool()), response)).toBeUndefined()
  })

  test("rejects malformed Plugin Info and a missing original-content field", () => {
    for (const change of [
      { field: "content", value: undefined },
      { field: "content", value: null },
      { field: "revision", value: "not-a-revision" },
      { field: "version", value: undefined },
      { field: "source", value: "mcp" },
      { field: "hooks", value: [{ event: "Unknown", command: "echo ignored" }] },
    ]) {
      const response = pluginAsset()
      Object.defineProperty(response, change.field, { value: change.value })
      expect(SkillProposal.applied(ready(pluginTool()), response)).toBeUndefined()
      expect(SkillProposal.current(ready(pluginTool()), response, pluginCatalog())).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
    }
  })
})

describe("saved Workflow proposal contract", () => {
  test("keeps every proposal family explicit and revokes Workflow confirmations when persistence changes", () => {
    const pending: SessionMessageAssistantTool = {
      ...workflowTool(),
      time: { created: 1 },
      state: { status: "running", input: workflowInput(), metadata: workflowFacts() },
    }

    const messages = [
      message("msg_skill", tool()),
      message("msg_command", commandTool()),
      message("msg_prompt", promptTool()),
      message("msg_agent", agentTool()),
      message("msg_mcp", mcpTool()),
      message("msg_plugin", pluginTool()),
      message("msg_workflow", workflowTool()),
      message("msg_pending", pending),
    ]

    expect(SkillProposal.read(pending)).toEqual({ kind: "invalid", issue: "proposal.pending" })

    for (const kind of ["skill", "command", "prompt", "agent", "mcp", "plugin", "workflow"] as const) {
      const entries = SkillProposal.list(messages, kind)
      expect(entries.map((entry) => entry.tool.name)).toEqual([`propose_${kind}_asset`])
      expect(ready(entries[0]?.tool ?? pending).assetKind).toBe(kind)
    }

    expect(SkillProposal.list(messages, "workflow").map((entry) => entry.key)).toEqual([
      "msg_workflow:call_propose_review",
    ])
    const before = SkillProposal.list(messages, "workflow")[0]

    for (const changed of [
      workflowTool({ ...workflowInput(), content: workflowInput().content.trim() }),
      workflowTool(workflowInput(), { ...workflowFacts(), exists: true, revision: "b".repeat(64) }),
    ])
      expect(SkillProposal.list([message("msg_workflow", changed)], "workflow")[0]?.stamp).not.toBe(before?.stamp)
  })

  test("dispatches same-shaped Workflow and Plugin replies by the persisted tool kind even with the same suffix", () => {
    const workflow = ready(workflowTool(workflowInput("Review.plugin"), workflowFacts("Review.plugin.yaml")))
    const plugin = ready(pluginTool())
    expect(SkillProposal.current(workflow, workflowAsset("Review.plugin"), workflowCatalog("Review.plugin")).kind).toBe(
      "ready",
    )
    expect(SkillProposal.current(plugin, pluginAsset(), pluginCatalog()).kind).toBe("ready")
    expect(SkillProposal.applied(workflow, workflowAsset("Review.plugin"))?.kind).toBe("workflow")
    expect(SkillProposal.applied(plugin, pluginAsset())?.kind).toBe("plugin")
    expect(SkillProposal.applied(workflow, pluginAsset())).toBeUndefined()
    expect(SkillProposal.applied(plugin, workflowAsset("Review.plugin"))).toBeUndefined()
    expect(SkillProposal.current(workflow, pluginAsset(), pluginCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
    expect(SkillProposal.current(plugin, workflowAsset("Review.plugin"), workflowCatalog("Review.plugin"))).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })

  test("preserves original YAML, version, triggers and all StepDef fields in current and applied Info", () => {
    const proposal = ready(workflowTool())
    const saved = SkillProposal.applied(proposal, workflowAsset())
    const current = SkillProposal.current(proposal, workflowAsset(), workflowCatalog())

    if (saved?.kind !== "workflow" || current.kind !== "ready" || current.current.kind !== "workflow")
      throw new Error("Expected canonical Workflow Info")
    expect(saved.content).toBe(workflowInput().content)
    expect(saved.version).toBe("3")
    expect(saved.triggers).toEqual(["manual", "pull-request"])
    expect(saved.steps).toEqual(Schema.decodeUnknownSync(WorkflowAsset.Info)(workflowAsset()).steps)
    expect(current.current).toEqual(saved)
  })

  test("decodes minimal JSON StepDef defaults and preserves an empty Workflow declaration", () => {
    for (const steps of [[{ id: "only", name: "Only step", agent: "reviewer" }], []]) {
      const content =
        workflowInput().content.split("steps:\r\n")[0] +
        (steps.length === 0
          ? "steps: []\r\n"
          : "steps:\r\n  - id: only\r\n    name: Only step\r\n    agent: reviewer\r\n")

      const proposal = ready(workflowTool({ ...workflowInput(), content }))
      const response = { ...workflowAsset(), content, steps }
      const saved = SkillProposal.applied(proposal, response)

      if (saved?.kind !== "workflow") throw new Error("Expected minimal Workflow Info")
      expect(saved.content).toBe(content)
      expect(saved.steps).toEqual(
        steps.length === 0
          ? []
          : [{ id: "only", name: "Only step", agent: "reviewer", input: {}, failurePolicy: "abort", maxAttempts: 1 }],
      )
      expect(SkillProposal.current(proposal, response, workflowCatalog())).toEqual({ kind: "ready", current: saved })
    }
  })

  test("allows review of existing Workflow Info larger than the candidate write limit", () => {
    const content = workflowInput().content.replace("# Preserve the reviewed declaration", "# " + "x".repeat(100_001))
    const current = SkillProposal.current(ready(workflowTool()), { ...workflowAsset(), content }, workflowCatalog())

    if (current.kind !== "ready" || current.current.kind !== "workflow")
      throw new Error("Expected the larger existing Workflow to remain reviewable")
    expect(current.current.content).toBe(content)
    expect(current.current.steps).toEqual(Schema.decodeUnknownSync(WorkflowAsset.Info)(workflowAsset()).steps)
  })

  test("requires matching Workflow catalogue identity, revision and target before replacement", () => {
    const proposal = ready(workflowTool())

    for (const changed of [{ revision: "b".repeat(64) }, { name: "Other" }, { description: "Changed description" }]) {
      const catalog = workflowCatalog()
      catalog.assets = catalog.assets.map((entry) => ({ ...entry, ...changed }))
      expect(SkillProposal.current(proposal, workflowAsset(), catalog)).toEqual({
        kind: "blocked",
        issue: "error.changed",
      })
    }

    expect(SkillProposal.current(proposal, workflowAsset(), { assets: [], invalid: [] })).toEqual({
      kind: "blocked",
      issue: "error.changed",
    })
    const collision = workflowCatalog()
    collision.assets.push(...collision.assets.map((entry) => ({ ...entry, relativePath: "Other.yaml" })))
    expect(SkillProposal.current(proposal, workflowAsset(), collision)).toEqual({
      kind: "blocked",
      issue: "error.nameConflict",
    })
    expect(
      SkillProposal.current(proposal, workflowAsset(), {
        ...workflowCatalog(),
        invalid: [{ relativePath: "Review.yaml", errorTag: "bad_frontmatter" }],
      }),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(
      SkillProposal.current(proposal, { ...workflowAsset(), relativePath: "Other.yaml" }, workflowCatalog()),
    ).toEqual({ kind: "blocked", issue: "error.current" })
    expect(SkillProposal.current(proposal, workflowAsset(), pluginCatalog())).toEqual({
      kind: "blocked",
      issue: "error.current",
    })
  })

  test("rejects altered Workflow identity, original YAML bytes and other asset families after saving", () => {
    const proposal = ready(workflowTool())

    for (const response of [
      { ...workflowAsset(), relativePath: "Other.yaml" },
      { ...workflowAsset(), name: "Other" },
      { ...workflowAsset(), description: "Changed" },
      { ...workflowAsset(), content: workflowInput().content.trim() },
      { ...workflowAsset(), content: workflowInput().content.replace("\uFEFF", "") },
      { ...workflowAsset(), content: workflowInput().content.replace("# Preserve the reviewed declaration\r\n", "") },
      { ...workflowAsset(), content: workflowInput().content.replace("extra: preserve this field\r\n", "") },
      { ...workflowAsset(), content: workflowInput().content.replaceAll("\r\n", "\n") },
      asset(),
      commandAsset(),
      promptAsset(),
      agentResult(),
      mcpAsset(),
      pluginAsset(),
    ])
      expect(SkillProposal.applied(proposal, response)).toBeUndefined()
  })

  test("rejects corrupt Workflow Info without inventing content, fields or graph structure", () => {
    const proposal = ready(workflowTool())

    for (const change of [
      { field: "content", value: undefined },
      { field: "content", value: null },
      { field: "kind", value: "plugin" },
      { field: "revision", value: "not-a-revision" },
      { field: "version", value: undefined },
      { field: "triggers", value: "manual" },
      { field: "steps", value: undefined },
      { field: "steps", value: [{ id: "step", name: "Step", agent: "reviewer", input: [] }] },
      { field: "steps", value: [{ id: "step", name: "Step", agent: "reviewer", branches: { approved: 42 } }] },
      { field: "steps", value: [{ id: "step", name: "Step", agent: "reviewer", parallel: [42] }] },
      { field: "steps", value: [{ id: "step", name: "Step", agent: "reviewer", maxAttempts: "three" }] },
    ]) {
      const response = workflowAsset()
      Object.defineProperty(response, change.field, { value: change.value })
      expect(SkillProposal.applied(proposal, response)).toBeUndefined()
      expect(SkillProposal.current(proposal, response, workflowCatalog())).toEqual({
        kind: "blocked",
        issue: "error.current",
      })
    }
  })
})
