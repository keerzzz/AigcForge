import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { CommandAsset } from "@aigcfroge/core/command-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Hash } from "@aigcfroge/core/util/hash"
import { InstallationVersion } from "@aigcfroge/core/installation/version"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolDefinition } from "@aigcfroge/llm"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"

function locationLayer(dir: string) {
  return Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(dir) })),
  )
}

function fullResolverLayer(dir: string) {
  const location = locationLayer(dir)
  const assets = Layer.mergeAll(
    CustomProfile.locationLayer,
    AgentAsset.locationLayer,
    PromptAsset.locationLayer,
    SkillAsset.locationLayer,
    WorkflowAsset.locationLayer,
    CommandAsset.locationLayer,
  ).pipe(Layer.provide(location), Layer.provide(FSUtil.defaultLayer))
  const tools = Layer.mock(ToolRegistry.Service, {
    materialize: () =>
      Effect.succeed({
        definitions: [
          new ToolDefinition({
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          }),
        ],
        settle: () => Effect.die("Tool settlement is not used by CompositionResolver tests"),
      }),
  })
  const base = Layer.mergeAll(assets, location, tools)

  return Layer.merge(
    CompositionResolver.locationLayer.pipe(Layer.provide(base)),
    base,
  )
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await tmpdir()
  try {
    return await fn(tmp.path)
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

describe("CompositionResolver", () => {
  test("successfully resolves valid composition input into Plan", async () => {
    await withTmp(async (dir) => {
      // 1. Create agent asset
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      // 2. Create prompt asset
      const promptDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptDir, { recursive: true })
      const promptRaw = `---\nkind: prompt\nname: system-prompt\ndescription: System prompt\n---\nBe precise.\n`
      await fs.writeFile(path.join(promptDir, "system-prompt.md"), promptRaw)
      const promptRev = Hash.sha256(Buffer.from(promptRaw))

      // 3. Create skill asset
      const skillDir = path.join(dir, ".aigcfroge", "skills", "git-tools")
      await fs.mkdir(skillDir, { recursive: true })
      const skillRaw = `---\nname: git-tools\ndescription: Git tools\n---\nGit commands\n`
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skillRaw)
      const skillRev = Hash.sha256(Buffer.from(skillRaw))

      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [
          {
            kind: "agent",
            relativePath: "coder.md",
            revision: agentRev,
          },
        ],
        bindings: {
          orchestrator: {
            prompts: [
              {
                kind: "prompt",
                relativePath: "system-prompt.md",
                revision: promptRev,
              },
            ],
            skills: [],
          },
          "agents/coder": {
            prompts: [],
            skills: [
              {
                kind: "skill",
                relativePath: "git-tools/SKILL.md",
                revision: skillRev,
              },
            ],
          },
        },
        presentation: "native",
        requestedCapabilities: ["workspace.read"],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(input)
          expect(plan.version).toBe(1)
          expect(plan.valid).toBe(true)
          expect(plan.agent?.name).toBe("coder")
          expect(plan.instructions).toHaveLength(2) // agent system prompt + bound prompt
          expect(plan.skills).toHaveLength(1)
          expect(plan.capabilities).toHaveLength(1)
          expect(plan.capabilities[0].status).toBe("denied")
          expect(plan.diagnostics).toHaveLength(0)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("fails closed when agent revision is stale or asset missing", async () => {
    await withTmp(async (dir) => {
      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [
          {
            kind: "agent",
            relativePath: "missing-agent.md",
            revision: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(input)
          expect(plan.valid).toBe(false)
          expect(plan.diagnostics.length).toBeGreaterThanOrEqual(1)
          expect(plan.diagnostics[0].severity).toBe("blocking")
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("profile health check detects healthy, degraded, and broken states", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nCode\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const healthyProfile = Schema.decodeUnknownSync(SchemaCustomProfile.Profile)({
        kind: "custom-profile",
        name: "Healthy Profile",
        description: "Test",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
        bindings: { "agents/coder": { prompts: [], skills: [] } },
        presentation: "native",
        requestedCapabilities: [],
      })

      const staleProfile = Schema.decodeUnknownSync(SchemaCustomProfile.Profile)({
        kind: "custom-profile",
        name: "Stale Profile",
        description: "Test",
        agents: [
          {
            kind: "agent",
            relativePath: "coder.md",
            revision: "1111111111111111111111111111111111111111111111111111111111111111",
          },
        ],
        bindings: { "agents/coder": { prompts: [], skills: [] } },
        presentation: "native",
        requestedCapabilities: [],
      })

      const brokenProfile = Schema.decodeUnknownSync(SchemaCustomProfile.Profile)({
        kind: "custom-profile",
        name: "Broken Profile",
        description: "Test",
        agents: [
          {
            kind: "agent",
            relativePath: "missing.md",
            revision: "1111111111111111111111111111111111111111111111111111111111111111",
          },
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const health1 = yield* resolver.checkHealth(healthyProfile)
          expect(health1.status).toBe("healthy")
          expect(health1.staleRevisions).toHaveLength(0)

          const health2 = yield* resolver.checkHealth(staleProfile)
          expect(health2.status).toBe("degraded")
          expect(health2.staleRevisions).toHaveLength(1)

          const health3 = yield* resolver.checkHealth(brokenProfile)
          expect(health3.status).toBe("broken")
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("findReferencingProfiles finds profiles referencing an asset", async () => {
    await withTmp(async (dir) => {
      const profileDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profileDir, { recursive: true })
      const profileYaml = `kind: custom-profile
name: Ref Profile
description: Profile with reference
agents:
  - kind: agent
    relativePath: coder.md
    revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
bindings:
  agents/coder:
    prompts:
      - kind: prompt
        relativePath: my-prompt.md
        revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    skills: []
presentation: native
requestedCapabilities: []
`
      await fs.writeFile(path.join(profileDir, "ref.yaml"), profileYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const customProfileService = yield* CustomProfile.Service
          yield* customProfileService.reload()

          const agentRefs = yield* resolver.findReferencingProfiles("agent", "coder.md")
          expect(agentRefs).toHaveLength(1)
          expect(String(agentRefs[0].name)).toBe("Ref Profile")

          const promptRefs = yield* resolver.findReferencingProfiles("prompt", "my-prompt.md")
          expect(promptRefs).toHaveLength(1)
          expect(String(promptRefs[0].name)).toBe("Ref Profile")

          const unreferenced = yield* resolver.findReferencingProfiles("skill", "other.md")
          expect(unreferenced).toHaveLength(0)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("freeze re-resolves and builds immutable Snapshot", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const skillDir = path.join(dir, ".aigcfroge", "skills", "git-tools")
      await fs.mkdir(skillDir, { recursive: true })
      const skillRaw = `---\nname: git-tools\ndescription: Git tools\n---\nGit commands\n`
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skillRaw)
      const skillRev = Hash.sha256(Buffer.from(skillRaw))

      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
        bindings: {
          "agents/coder": {
            prompts: [],
            skills: [{ kind: "skill", relativePath: "git-tools/SKILL.md", revision: skillRev }],
          },
        },
        presentation: "native",
        requestedCapabilities: ["workspace.read"],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input, sessionID: "session-123" }))
          expect(snapshot.version).toBe(1)
          expect(snapshot.sessionID).toBe("session-123")
          if (snapshot.version === 1) {
            expect(snapshot.data.agentID).toBe("coder")
            expect(snapshot.data.skills).toHaveLength(1)
          }
          expect(snapshot.data.tools.catalog).toEqual(["read"])
          expect(snapshot.data.tools.catalogDigest).toHaveLength(64)
          expect(snapshot.data.tools.fingerprints).toHaveLength(1)
          expect(snapshot.data.tools.fingerprints[0].name).toBe("read")
          expect(snapshot.data.tools.fingerprints[0].placement).toBe(dir)
          expect(snapshot.data.tools.fingerprints[0].digest).toHaveLength(64)
          expect(snapshot.data.tools.fingerprints[0].installationVersion).toBe(InstallationVersion)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("freeze fails closed with ResolveError when plan is invalid", async () => {
    await withTmp(async (dir) => {
      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [
          {
            kind: "agent",
            relativePath: "missing.md",
            revision: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const err = yield* resolver
            .freeze(new Composition.FreezeInput({ input }))
            .pipe(Effect.flip)
          expect(err._tag).toBe("Composition.ResolveError")
          expect(err.code).toBe("invalid_composition_plan")
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("resolve rejects unknown consumer keys in bindings", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nCode\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
        bindings: {
          "agents/unknown-agent": {
            prompts: [],
            skills: [],
          },
        },
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(input)
          expect(plan.valid).toBe(false)
          expect(plan.diagnostics.some((d) => d.code === "unknown_consumer_key")).toBe(true)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("resolve fails closed with blocking diagnostic on duplicate assets", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nCode\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const promptDir = path.join(dir, ".aigcfroge", "prompts")
      await fs.mkdir(promptDir, { recursive: true })
      const promptRaw = `---\nkind: prompt\nname: system-prompt\ndescription: System prompt\n---\nBe precise.\n`
      await fs.writeFile(path.join(promptDir, "system-prompt.md"), promptRaw)
      const promptRev = Hash.sha256(Buffer.from(promptRaw))

      const promptRef = { kind: "prompt", relativePath: "system-prompt.md", revision: promptRev }
      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
        bindings: {
          // Same prompt listed twice within one binding, and again for another consumer.
          orchestrator: { prompts: [promptRef, promptRef], skills: [] },
          "agents/coder": { prompts: [promptRef], skills: [] },
        },
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(input)
          expect(plan.valid).toBe(false)
          const duplicates = plan.diagnostics.filter((d) => d.code === "duplicate_asset")
          // Assets are consumer-scoped, so only the duplicate within orchestrator is invalid.
          expect(duplicates).toHaveLength(1)
          expect(duplicates[0].severity).toBe("blocking")
          expect(duplicates[0].path).toBe("system-prompt.md")
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("resolve lists assets bound to unrecognized consumers as unconnected", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nCode\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
        bindings: {
          "agents/unknown-agent": {
            prompts: [
              {
                kind: "prompt",
                relativePath: "ghost-prompt.md",
                revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              },
            ],
            skills: [
              {
                kind: "skill",
                relativePath: "ghost-tools/SKILL.md",
                revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              },
            ],
          },
        },
        presentation: "native",
        requestedCapabilities: [],
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const plan = yield* resolver.resolve(input)
          expect(plan.valid).toBe(false)
          expect(plan.diagnostics.some((d) => d.code === "unknown_consumer_key")).toBe(true)
          const unconnected = plan.diagnostics.filter((d) => d.code === "unconnected_asset")
          expect(unconnected).toHaveLength(2)
          expect(unconnected.every((d) => d.severity === "error")).toBe(true)
          expect(unconnected.map((d) => d.path).toSorted()).toEqual([
            "ghost-prompt.md",
            "ghost-tools/SKILL.md",
          ])
          // Unconnected assets must not silently land in the plan output
          expect(plan.instructions).toHaveLength(1) // agent system prompt only
          expect(plan.skills).toHaveLength(0)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("ProfileInput derives composition facts strictly from stored profile", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      await fs.mkdir(agentDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nCode\n`
      await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
      const agentRev = Hash.sha256(Buffer.from(agentRaw))

      const profileDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profileDir, { recursive: true })
      const profileYaml = `kind: custom-profile
name: stored-coder
description: Stored coder profile
agents:
  - kind: agent
    relativePath: coder.md
    revision: ${agentRev}
bindings:
  agents/coder:
    prompts: []
    skills: []
presentation: native
requestedCapabilities:
  - workspace.read
`
      await fs.writeFile(path.join(profileDir, "stored-coder.yaml"), profileYaml)
      const profileRev = Hash.sha256(Buffer.from(profileYaml))

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const customProfileService = yield* CustomProfile.Service
          yield* customProfileService.reload()

          const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
            source: "profile",
            profilePath: "stored-coder.yaml",
            profileRevision: profileRev,
          })

          const plan = yield* resolver.resolve(input)
          expect(plan.valid).toBe(true)
          expect(plan.agent?.name).toBe("coder")
          expect(plan.capabilities).toHaveLength(1)
          expect(plan.capabilities[0].id).toBe("workspace.read")
          expect(plan.capabilities[0].status).toBe("denied")
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  describe("M2 Multi-Agent and Workflow Resolution", () => {
    test("successfully resolves multi-agent composition plan with cost preview", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })

        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Primary coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const reviewerRaw = `---\nkind: agent\nname: reviewer\ndescription: Code reviewer\n---\nReview code.\n`
        await fs.writeFile(path.join(agentDir, "reviewer.md"), reviewerRaw)
        const reviewerRev = Hash.sha256(Buffer.from(reviewerRaw))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [
                { kind: "agent", relativePath: "coder.md", revision: coderRev },
                { kind: "agent", relativePath: "reviewer.md", revision: reviewerRev },
              ],
              bindings: {
                "agents/coder": { prompts: [], skills: [] },
                "agents/reviewer": { prompts: [], skills: [] },
              },
              presentation: "native",
              requestedCapabilities: ["workspace.read"],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.version).toBe(2)
            expect(plan.agents).toHaveLength(2)
            expect(plan.agents?.[0].name).toBe("coder")
            expect(plan.agents?.[1].name).toBe("reviewer")
            expect(plan.costPreview).toBeDefined()
            expect(plan.costPreview?.agentCount).toBe(2)
            expect(plan.costPreview?.effectiveToolCount).toBe(1)
            expect(plan.costPreview?.maxConcurrency).toBe(1)
            expect(plan.costPreview?.estimatedTokens).toBeGreaterThan(0)
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("successfully resolves workflow asset, validates DAG, and checks step agents", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const reviewerRaw = `---\nkind: agent\nname: reviewer\ndescription: Reviewer\n---\nReview.\n`
        await fs.writeFile(path.join(agentDir, "reviewer.md"), reviewerRaw)
        const reviewerRev = Hash.sha256(Buffer.from(reviewerRaw))

        const workflowDir = path.join(dir, ".aigcfroge", "workflows")
        await fs.mkdir(workflowDir, { recursive: true })
        const workflowYaml = `kind: workflow
name: code-and-review
description: Code then review workflow
version: "1.0.0"
triggers:
  - manual
steps:
  - id: step_code
    name: Code Implementation
    agent: coder
    next: step_review
  - id: step_review
    name: Code Review
    agent: reviewer
    next: END
`
        await fs.writeFile(path.join(workflowDir, "pipeline.yaml"), workflowYaml)
        const workflowRev = Hash.sha256(Buffer.from(workflowYaml))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [
                { kind: "agent", relativePath: "coder.md", revision: coderRev },
                { kind: "agent", relativePath: "reviewer.md", revision: reviewerRev },
              ],
              workflow: {
                kind: "workflow",
                relativePath: "pipeline.yaml",
                revision: workflowRev,
              },
              bindings: {
                "agents/coder": { prompts: [], skills: [] },
                "agents/reviewer": { prompts: [], skills: [] },
              },
              presentation: "native",
              requestedCapabilities: [],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.version).toBe(2)
            expect(plan.workflow).toBeDefined()
            expect(plan.workflow?.name).toBe("code-and-review")
            expect(plan.workflow?.steps).toHaveLength(2)
            expect(plan.workflow?.steps[0].id).toBe("step_code")
            expect(plan.workflow?.steps[0].next).toBe("step_review")
            expect(plan.workflow?.steps[1].id).toBe("step_review")
            expect(plan.workflow?.steps[1].next).toBe("END")
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("rejects workflow with unknown agent or cyclic DAG", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const workflowDir = path.join(dir, ".aigcfroge", "workflows")
        await fs.mkdir(workflowDir, { recursive: true })
        const cyclicYaml = `kind: workflow
name: cyclic-flow
description: Cyclic workflow
version: "1.0.0"
steps:
  - id: a
    name: Step A
    agent: coder
    next: b
  - id: b
    name: Step B
    agent: ghost-agent
    next: a
`
        await fs.writeFile(path.join(workflowDir, "cyclic.yaml"), cyclicYaml)
        const cyclicRev = Hash.sha256(Buffer.from(cyclicYaml))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [{ kind: "agent", relativePath: "coder.md", revision: coderRev }],
              workflow: {
                kind: "workflow",
                relativePath: "cyclic.yaml",
                revision: cyclicRev,
              },
              bindings: { "agents/coder": { prompts: [], skills: [] } },
              presentation: "native",
              requestedCapabilities: [],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(false)
            expect(plan.diagnostics.some((d) => d.code === "invalid_workflow_graph")).toBe(true)
            expect(plan.diagnostics.some((d) => d.code === "workflow_unknown_agent")).toBe(true)
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("freezes multi-agent and workflow plan into SnapshotV2", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const reviewerRaw = `---\nkind: agent\nname: reviewer\ndescription: Reviewer\n---\nReview.\n`
        await fs.writeFile(path.join(agentDir, "reviewer.md"), reviewerRaw)
        const reviewerRev = Hash.sha256(Buffer.from(reviewerRaw))

        const workflowDir = path.join(dir, ".aigcfroge", "workflows")
        await fs.mkdir(workflowDir, { recursive: true })
        const workflowYaml = `kind: workflow
name: multi-flow
description: Multi flow
version: "1.0.0"
steps:
  - id: s1
    name: S1
    agent: coder
`
        await fs.writeFile(path.join(workflowDir, "flow.yaml"), workflowYaml)
        const workflowRev = Hash.sha256(Buffer.from(workflowYaml))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [
                { kind: "agent", relativePath: "coder.md", revision: coderRev },
                { kind: "agent", relativePath: "reviewer.md", revision: reviewerRev },
              ],
              workflow: {
                kind: "workflow",
                relativePath: "flow.yaml",
                revision: workflowRev,
              },
              bindings: {
                "agents/coder": { prompts: [], skills: [] },
                "agents/reviewer": { prompts: [], skills: [] },
              },
              presentation: "native",
              requestedCapabilities: [],
            })

            const snapshot = yield* resolver.freeze(
              new Composition.FreezeInput({ input, sessionID: "ses-multi-123" }),
            )
            expect(snapshot.version).toBe(2)
            expect(snapshot.sessionID).toBe("ses-multi-123")
            if (snapshot.version === 2) {
              expect(snapshot.data.agents).toHaveLength(2)
              expect(snapshot.data.agents[0].name).toBe("coder")
              expect(snapshot.data.agents[1].name).toBe("reviewer")
              expect(snapshot.data.workflow).toBeDefined()
              expect(snapshot.data.workflow?.name).toBe("multi-flow")
            }
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("resolves and freezes consumer-scoped commands without granting execution authority", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const promptDir = path.join(dir, ".aigcfroge", "prompts")
        await fs.mkdir(promptDir, { recursive: true })
        const promptRaw = `---\nkind: prompt\nname: review-context\ndescription: Review context\n---\nReview carefully.\n`
        await fs.writeFile(path.join(promptDir, "review.md"), promptRaw)
        const promptRev = Hash.sha256(Buffer.from(promptRaw))

        const skillDir = path.join(dir, ".aigcfroge", "skills", "review")
        await fs.mkdir(skillDir, { recursive: true })
        const skillRaw = `---\nname: review\ndescription: Review checklist\n---\nCheck correctness.\n`
        await fs.writeFile(path.join(skillDir, "SKILL.md"), skillRaw)
        const skillRev = Hash.sha256(Buffer.from(skillRaw))

        const commandDir = path.join(dir, ".aigcfroge", "commands")
        await fs.mkdir(commandDir, { recursive: true })
        const commandRaw = `---\nkind: command\nname: review\ndescription: Review the current change\ninvocation: /review\n---\nReview the supplied change without executing it.\n`
        await fs.writeFile(path.join(commandDir, "review.md"), commandRaw)
        const commandRev = Hash.sha256(Buffer.from(commandRaw))

        const workflowDir = path.join(dir, ".aigcfroge", "workflows")
        await fs.mkdir(workflowDir, { recursive: true })
        const workflowYaml = `kind: workflow
name: review-flow
description: Review workflow
version: "1.0.0"
steps:
  - id: review
    name: Review
    agent: coder
`
        await fs.writeFile(path.join(workflowDir, "review.yaml"), workflowYaml)
        const workflowRev = Hash.sha256(Buffer.from(workflowYaml))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const commandRef = { kind: "command" as const, relativePath: "review.md", revision: commandRev }
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [{ kind: "agent", relativePath: "coder.md", revision: coderRev }],
              workflow: { kind: "workflow", relativePath: "review.yaml", revision: workflowRev },
              bindings: {
                orchestrator: {
                  prompts: [{ kind: "prompt", relativePath: "review.md", revision: promptRev }],
                  skills: [],
                  commands: [commandRef],
                },
                "agents/coder": {
                  prompts: [],
                  skills: [{ kind: "skill", relativePath: "review/SKILL.md", revision: skillRev }],
                  commands: [commandRef],
                },
              },
              presentation: "native",
              requestedCapabilities: [],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.commands).toHaveLength(1)
            expect(plan.commands[0].name).toBe("review")
            expect(plan.commands[0].template).toContain("without executing it")
            expect(plan.capabilities).toEqual([])
            expect(plan.costPreview?.effectiveToolCount).toBe(1)
            expect(plan.instructions.some((instruction) => instruction.content.includes("without executing it"))).toBe(false)

            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(snapshot.version).toBe(2)
            if (snapshot.version === 2) {
              expect(snapshot.data.maxConcurrency).toBe(1)
              expect(snapshot.data.bindings.orchestrator.prompts).toHaveLength(1)
              expect(snapshot.data.bindings.orchestrator.skills).toEqual([])
              expect(snapshot.data.bindings.orchestrator.commands[0].name).toBe("review")
              expect(snapshot.data.bindings["agents/coder"].prompts).toEqual([])
              expect(snapshot.data.bindings["agents/coder"].skills[0].name).toBe("review")
              expect(snapshot.data.bindings["agents/coder"].commands[0].name).toBe("review")
              expect(snapshot.data.tools.catalog).toEqual(["read"])
            }
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("rejects composition with > 16 agents", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const agents = Array.from({ length: 17 }, (_, i) => ({
              kind: "agent" as const,
              relativePath: "coder.md",
              revision: coderRev,
            }))
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents,
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(false)
            expect(plan.diagnostics.some((d) => d.code === "invalid_agent_cardinality")).toBe(true)
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("computes maxConcurrency correctly for parallel workflow DAG", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nWrite code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const workflowDir = path.join(dir, ".aigcfroge", "workflows")
        await fs.mkdir(workflowDir, { recursive: true })
        const workflowYaml = `kind: workflow
name: parallel-flow
description: Parallel workflow
version: "1.0.0"
steps:
  - id: start
    name: Start
    agent: coder
    parallel:
      - branch_a
      - branch_b
      - branch_c
  - id: branch_a
    name: Branch A
    agent: coder
    next: merge
  - id: branch_b
    name: Branch B
    agent: coder
    next: merge
  - id: branch_c
    name: Branch C
    agent: coder
    next: merge
  - id: merge
    name: Merge
    agent: coder
    next: END
`
        await fs.writeFile(path.join(workflowDir, "parallel.yaml"), workflowYaml)
        const workflowRev = Hash.sha256(Buffer.from(workflowYaml))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [{ kind: "agent", relativePath: "coder.md", revision: coderRev }],
              workflow: {
                kind: "workflow",
                relativePath: "parallel.yaml",
                revision: workflowRev,
              },
              bindings: { "agents/coder": { prompts: [], skills: [] } },
              presentation: "native",
              requestedCapabilities: [],
            })

            const plan = yield* resolver.resolve(input)
            expect(plan.valid).toBe(true)
            expect(plan.costPreview?.maxConcurrency).toBe(3)
            expect(plan.costPreview?.agentCount).toBe(1)
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })
  })
})
