import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { Composition } from "@aigcfroge/schema/composition"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { SkillV2 } from "@aigcfroge/core/skill"
import { SystemContext } from "@aigcfroge/core/system-context"
import { Tool } from "@aigcfroge/core/tool/tool"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { createCompositionSkillCatalog } from "@aigcfroge/core/skill/composition-catalog"
import { testEffect } from "./lib/effect"

const mockDigest = Schema.decodeUnknownSync(Composition.Digest)(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
)
const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function makeMockSnapshot(sessionID: string): Composition.Snapshot {
  return new Composition.Snapshot({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: 1700000000000,
    data: new Composition.SnapshotData({
      agentID: "code-reviewer",
      instructions: [
        new Composition.Instruction({
          source: "profile:reviewer",
          content: "You are a code review assistant in custom mode.",
        }),
      ],
      prompts: [
        new Composition.SnapshotPromptData({
          relativePath: "prompts/review.md",
          revision: mockRevision,
          content: "Review this diff carefully.",
        }),
      ],
      skills: [
        new Composition.SkillInfo({
          name: "git-diff-analyzer",
          description: "Analyzes git diffs",
          relativePath: "skills/git-diff.md",
          revision: mockRevision,
        }),
      ],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [
          {
            placement: "/project",
            name: "read",
            digest: mockDigest,
            installationVersion: "0.1.0",
          },
        ],
        catalogDigest: mockDigest,
        catalog: ["read"],
      }),
    }),
  })
}

const makeTool = (name: string) =>
  Tool.make({
    description: `Tool ${name}`,
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})

const registryLayer = ToolRegistry.layer.pipe(Layer.provide(ApplicationTools.layer), Layer.provide(outputStore))
const mockSkill = Layer.mock(SkillV2.Service, { list: () => Effect.succeed([]) })
const testLayer = Layer.mergeAll(registryLayer, SkillGuidance.layer.pipe(Layer.provide(mockSkill)))
const it = testEffect(testLayer)

describe("Phase C: Runner, Skill Catalog, and Tool Materialization", () => {
  describe("ProductModeAgentPolicy for Custom Mode", () => {
    it.effect("allows meta as root primary agent in custom mode", () =>
      Effect.gen(function* () {
        const metaVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", "meta")
        expect(metaVerdict.allowed).toBe(true)

        const defaultVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", undefined)
        expect(defaultVerdict.allowed).toBe(false)

        const nonMetaVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", "code-reviewer")
        expect(nonMetaVerdict.allowed).toBe(false)
        if (!nonMetaVerdict.allowed) {
          expect(nonMetaVerdict.error._tag).toBe("AgentNotAllowedError")
        }
      }),
    )
  })

  describe("ToolRegistry Materialization Allowlist", () => {
    it.effect("filters definitions and settle functions when allowlist is provided", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* registry.register({
          read: makeTool("read"),
          write: makeTool("write"),
          edit: makeTool("edit"),
        })

        // Materialize with allowlist ["read"]
        const materialized = yield* registry.materialize([], undefined, { allowlist: ["read"] })
        expect(materialized.definitions.map((d) => d.name)).toEqual(["read"])

        const sessionID = SessionV2.ID.make("ses_custom_tools")
        const assistantMessageID = SessionMessage.ID.make("msg_tool_settle")

        // Allowed tool call settles successfully
        const readSettlement = yield* materialized.settle({
          sessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: { type: "tool-call", id: "call-1", name: "read", input: { text: "hello" } },
        })
        expect(readSettlement.result.type).toBe("text")

        // Non-allowed tool call is rejected as unknown in settle
        const writeSettlement = yield* materialized.settle({
          sessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: { type: "tool-call", id: "call-2", name: "write", input: { text: "hello" } },
        })
        expect(writeSettlement.result.type).toBe("error")
        if (writeSettlement.result.type === "error") {
          expect(String(writeSettlement.result.value)).toContain("Unknown tool: write")
        }
      }),
    )

    it.effect("non-custom caller omitting allowlist exhibits zero behavioral regression", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        yield* registry.register({
          read: makeTool("read"),
          write: makeTool("write"),
        })

        const materialized = yield* registry.materialize([])
        expect(materialized.definitions.map((d) => d.name).sort()).toEqual(["read", "write"].sort())
      }),
    )
  })

  describe("Skill Catalog and Guidance", () => {
    it.effect("createCompositionSkillCatalog matches skills by name and relative path", () =>
      Effect.gen(function* () {
        const allSkills: SkillV2.Info[] = [
          {
            name: "git-diff-analyzer",
            description: "Analyzes git diffs",
            location: AbsolutePath.make("/workspace/skills/git-diff.md"),
            content: "Git diff instructions",
          },
          {
            name: "other-skill",
            description: "Another skill",
            location: AbsolutePath.make("/workspace/skills/other.md"),
            content: "Other instructions",
          },
        ]

        const snapshotSkills: Composition.SkillInfo[] = [
          new Composition.SkillInfo({
            name: "git-diff-analyzer",
            description: "Analyzes git diffs",
            relativePath: "skills/git-diff.md",
            revision: mockRevision,
          }),
        ]

        const filtered = createCompositionSkillCatalog(snapshotSkills, allSkills)
        expect(filtered).toHaveLength(1)
        expect(filtered[0].name).toBe("git-diff-analyzer")
      }),
    )

    it.effect("SkillGuidance renders only snapshot skills when snapshot is provided", () =>
      Effect.gen(function* () {
        const guidance = yield* SkillGuidance.Service
        const snapshot = makeMockSnapshot("ses_guidance_test")
        const selection: AgentV2.Selection = {
          id: AgentV2.ID.make("meta"),
          info: AgentV2.Info.empty(AgentV2.ID.make("meta")),
        }

        const initialized = yield* guidance
          .load(selection, { snapshot })
          .pipe(Effect.flatMap(SystemContext.initialize))
        expect(initialized.baseline).toContain("git-diff-analyzer")
        expect(initialized.baseline).toContain("Analyzes git diffs")
      }),
    )
  })
})
