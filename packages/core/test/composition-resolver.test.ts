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
import { MCPAsset } from "@aigcfroge/core/mcp-asset"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Hash } from "@aigcfroge/core/util/hash"
import { InstallationVersion } from "@aigcfroge/core/installation/version"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolDefinition } from "@aigcfroge/llm"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

let mcpFacts: ReadonlyArray<McpConnection.Fact> = []

function fullResolverLayer(dir: string) {
  const location = locationLayer(dir)
  const assets = Layer.mergeAll(
    CustomProfile.locationLayer,
    AgentAsset.locationLayer,
    PromptAsset.locationLayer,
    SkillAsset.locationLayer,
    WorkflowAsset.locationLayer,
    CommandAsset.locationLayer,
    MCPAsset.locationLayer,
  ).pipe(Layer.provide(location), Layer.provide(FSUtil.defaultLayer))
  const tools = Layer.mock(ToolRegistry.Service, {
    registeredNames: () => new Set<string>(),
    materialize: () =>
      Effect.succeed({
        definitions: [
          new ToolDefinition({
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          }),
          ...mcpFacts.flatMap((fact) =>
            fact.tools.map(
              (name) =>
                new ToolDefinition({
                  name,
                  description: `MCP tool ${name}`,
                  inputSchema: { type: "object", properties: {} },
                }),
            ),
          ),
        ],
        settle: () => Effect.die("Tool settlement is not used by CompositionResolver tests"),
      }),
  })
  const mcp = Layer.mock(McpConnection.Service, {
    connect: () => Effect.die("CompositionResolver must not connect MCP servers"),
    disconnect: () => Effect.die("unused"),
    connections: () => Effect.succeed([]),
    facts: () => Effect.succeed(mcpFacts),
    health: (serverName) => Effect.succeed(mcpFacts.find((fact) => fact.serverName === serverName)?.health),
    callTool: () => Effect.die("unused"),
    shutdown: () => Effect.void,
  })
  const base = Layer.mergeAll(assets, location, tools, mcp)

  return Layer.merge(CompositionResolver.locationLayer.pipe(Layer.provide(base)), base)
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  mcpFacts = []
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
          const err = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
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
          expect(unconnected.map((d) => d.path).toSorted()).toEqual(["ghost-prompt.md", "ghost-tools/SKILL.md"])
          // Unconnected assets must not silently land in the plan output
          expect(plan.instructions).toHaveLength(1) // agent system prompt only
          expect(plan.skills).toHaveLength(0)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("resolves only profile-bound MCP registrations into Plan and Snapshot audit facts", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      const mcpDir = path.join(dir, ".aigcfroge", "mcps")
      const profileDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(agentDir, { recursive: true })
      await fs.mkdir(mcpDir, { recursive: true })
      await fs.mkdir(profileDir, { recursive: true })

      const agentRaw = `---\nkind: agent\nname: researcher\ndescription: Researcher\n---\nResearch.\n`
      await fs.writeFile(path.join(agentDir, "researcher.md"), agentRaw)
      const agentRevision = Hash.sha256(Buffer.from(agentRaw))
      const boundMcpRaw = `---\nkind: mcp\nname: project-search\ndescription: Project search\ncommand: bun\nargs: [run, server.ts]\n---\n{}`
      const unboundMcpRaw = `---\nkind: mcp\nname: unbound\ndescription: Unbound\ncommand: bun\nargs: [run, server.ts]\n---\n{}`
      await fs.writeFile(path.join(mcpDir, "project-search.md"), boundMcpRaw)
      await fs.writeFile(path.join(mcpDir, "unbound.md"), unboundMcpRaw)
      const boundRevision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(boundMcpRaw)))
      const unboundRevision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(unboundMcpRaw)))
      const credentialRef = "cred_" + "c".repeat(32)
      mcpFacts = [
        new McpConnection.Fact({
          serverName: "project-search",
          ref: { relativePath: "project-search.md", revision: boundRevision },
          credentialRef,
          health: "ready",
          tools: ["mcp_project_search_search"],
        }),
        new McpConnection.Fact({
          serverName: "unbound",
          ref: { relativePath: "unbound.md", revision: unboundRevision },
          health: "ready",
          tools: ["mcp_unbound_admin"],
        }),
      ]
      const profileRaw = `kind: custom-profile
name: mcp-profile
description: Binds only project search
agents:
  - kind: agent
    relativePath: researcher.md
    revision: ${agentRevision}
bindings: {}
presentation: native
requestedCapabilities: []
mcpBindings:
  - serverName: project-search
    ref:
      relativePath: project-search.md
      revision: ${boundRevision}
    transport: stdio
    command: [bun, run, server.ts]
    credentialRef: ${credentialRef}
`
      await fs.writeFile(path.join(profileDir, "mcp-profile.yaml"), profileRaw)
      const profileRevision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(profileRaw)))

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "mcp-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.requested).toHaveLength(1)
          expect(plan.mcp.requested[0]?.serverName).toBe("project-search")
          expect(plan.mcp.effective).toHaveLength(1)
          expect(plan.mcp.effective[0]?.tools).toEqual(["mcp_project_search_search"])
          expect(plan.mcp.effective[0]?.credentialStatus).toBe("available")
          expect(plan.mcp.denied).toEqual([])

          const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
          expect(snapshot.version).toBe(2)
          if (snapshot.version !== 2) throw new Error("MCP audit facts require SnapshotV2")
          expect(snapshot.data.tools.catalog).toEqual(["mcp_project_search_search", "read"])
          expect(snapshot.data.mcp.bindings).toEqual([
            {
              serverName: "project-search",
              ref: { kind: "mcp", relativePath: "project-search.md", revision: boundRevision },
              credentialRef,
            },
          ])
          expect(snapshot.data.mcp.tools).toEqual([
            {
              canonicalName: "mcp_project_search_search",
              serverName: "project-search",
              ref: { kind: "mcp", relativePath: "project-search.md", revision: boundRevision },
            },
          ])
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("keeps requested MCP bindings visible when an asset is stale and denies freeze", async () => {
    await withTmp(async (dir) => {
      const agentDir = path.join(dir, ".aigcfroge", "agents")
      const mcpDir = path.join(dir, ".aigcfroge", "mcps")
      const profileDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(agentDir, { recursive: true })
      await fs.mkdir(mcpDir, { recursive: true })
      await fs.mkdir(profileDir, { recursive: true })
      const agentRaw = `---\nkind: agent\nname: reader\ndescription: Reader\n---\nRead.\n`
      await fs.writeFile(path.join(agentDir, "reader.md"), agentRaw)
      const agentRevision = Hash.sha256(Buffer.from(agentRaw))
      const assetRaw = `---\nkind: mcp\nname: stale-search\ndescription: Stale search\ncommand: bun\nargs: [run, server.ts]\n---\n{}`
      await fs.writeFile(path.join(mcpDir, "stale-search.md"), assetRaw)
      const actualRevision = Hash.sha256(Buffer.from(assetRaw))
      const declaredRevision = "d".repeat(64)
      expect(actualRevision).not.toBe(declaredRevision)
      const profileRaw = `kind: custom-profile
name: stale-mcp-profile
description: Shows denial facts
agents:
  - kind: agent
    relativePath: reader.md
    revision: ${agentRevision}
bindings: {}
presentation: native
requestedCapabilities: []
mcpBindings:
  - serverName: stale-search
    ref:
      relativePath: stale-search.md
      revision: ${declaredRevision}
    transport: stdio
    command: [bun, run, server.ts]
`
      await fs.writeFile(path.join(profileDir, "stale-mcp-profile.yaml"), profileRaw)
      const profileRevision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(profileRaw)))

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "stale-mcp-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.requested).toHaveLength(1)
          expect(plan.mcp.effective).toEqual([])
          expect(plan.mcp.denied).toHaveLength(1)
          expect(plan.mcp.denied[0]?.reason).toBe("mcp_asset_stale_revision")
          expect(plan.valid).toBe(false)
          const failure = yield* resolver.freeze(new Composition.FreezeInput({ input })).pipe(Effect.flip)
          expect(failure.code).toBe("invalid_composition_plan")
          const references = yield* resolver.findReferencingProfiles("mcp", "stale-search.md")
          expect(references.map((entry) => entry.relativePath)).toEqual(["stale-mcp-profile.yaml"])
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  // The two branches below are the ONLY thing keeping a requested-but-unusable
  // MCP server out of `effective` — and `effective` is what becomes the frozen
  // Snapshot's MCP bindings and tool catalog. Removing either guard used to leave
  // the whole resolver suite green, because the only case that reached this code
  // was the happy path where the fact matched AND health was "ready".
  /** Effective tool count when every requested MCP server is denied. */
  const MCP_DENIED_TOOL_COUNT = 1

  const mcpDenialProfile = async (
    dir: string,
    over: { readonly serverName: string; readonly credentialRef?: string },
  ) => {
    const agentDir = path.join(dir, ".aigcfroge", "agents")
    const mcpDir = path.join(dir, ".aigcfroge", "mcps")
    const profileDir = path.join(dir, ".aigcfroge", "custom-profiles")
    await fs.mkdir(agentDir, { recursive: true })
    await fs.mkdir(mcpDir, { recursive: true })
    await fs.mkdir(profileDir, { recursive: true })
    const agentRaw = `---\nkind: agent\nname: reader\ndescription: Reader\n---\nRead.\n`
    await fs.writeFile(path.join(agentDir, "reader.md"), agentRaw)
    const agentRevision = Hash.sha256(Buffer.from(agentRaw))
    const assetRaw = `---\nkind: mcp\nname: ${over.serverName}\ndescription: Server\ncommand: bun\nargs: [run, server.ts]\n---\n{}`
    await fs.writeFile(path.join(mcpDir, `${over.serverName}.md`), assetRaw)
    const revision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(assetRaw)))
    const profileRaw = `kind: custom-profile
name: denial-profile
description: Requests one MCP server
agents:
  - kind: agent
    relativePath: reader.md
    revision: ${agentRevision}
bindings: {}
presentation: native
requestedCapabilities: []
mcpBindings:
  - serverName: ${over.serverName}
    ref:
      relativePath: ${over.serverName}.md
      revision: ${revision}
    transport: stdio
    command: [bun, run, server.ts]
${over.credentialRef === undefined ? "" : `    credentialRef: ${over.credentialRef}\n`}`
    await fs.writeFile(path.join(profileDir, "denial-profile.yaml"), profileRaw)
    const profileRevision = Schema.decodeUnknownSync(Composition.Revision)(Hash.sha256(Buffer.from(profileRaw)))
    return { revision, profileRevision }
  }

  test("denies a requested MCP server that the connection owner has no fact for", async () => {
    await withTmp(async (dir) => {
      await mcpDenialProfile(dir, { serverName: "absent-search" })
      mcpFacts = []
      const { profileRevision } = await mcpDenialProfile(dir, { serverName: "absent-search" })

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "denial-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.requested).toHaveLength(1)
          expect(plan.mcp.effective).toEqual([])
          expect(plan.mcp.denied).toHaveLength(1)
          expect(plan.mcp.denied[0]?.reason).toBe("not_connected")
          expect(plan.valid).toBe(false)
          // A denied server contributes no tools to the effective count.
          expect(plan.costPreview?.effectiveToolCount).toBe(MCP_DENIED_TOOL_COUNT)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("denies a requested MCP server whose asset no longer exists on disk", async () => {
    await withTmp(async (dir) => {
      await mcpDenialProfile(dir, { serverName: "absent-asset" })
      mcpFacts = []
      const { profileRevision } = await mcpDenialProfile(dir, { serverName: "absent-asset" })
      // The profile still pins the asset ref; the asset row itself is gone, so
      // the resolver must deny before it ever consults a connection fact.
      await fs.rm(path.join(dir, ".aigcfroge", "mcps", "absent-asset.md"))

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "denial-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.requested).toHaveLength(1)
          expect(plan.mcp.effective).toEqual([])
          expect(plan.mcp.denied).toHaveLength(1)
          expect(plan.mcp.denied[0]?.reason).toBe("mcp_asset_not_found")
          expect(plan.diagnostics.some((d) => d.code === "mcp_asset_not_found")).toBe(true)
          expect(plan.valid).toBe(false)
          expect(plan.costPreview?.effectiveToolCount).toBe(MCP_DENIED_TOOL_COUNT)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("denies a requested MCP server whose fact exists but is not ready", async () => {
    await withTmp(async (dir) => {
      const credentialRef = "cred_" + "e".repeat(32)
      const { revision, profileRevision } = await mcpDenialProfile(dir, {
        serverName: "degraded-search",
        credentialRef,
      })
      mcpFacts = [
        new McpConnection.Fact({
          serverName: "degraded-search",
          ref: { relativePath: "degraded-search.md", revision },
          credentialRef,
          health: "revoked",
          tools: ["mcp_degraded_search_query"],
        }),
      ]

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "denial-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.effective).toEqual([])
          expect(plan.mcp.denied).toHaveLength(1)
          expect(plan.mcp.denied[0]?.reason).toBe("not_ready")
          expect(plan.mcp.denied[0]?.health).toBe("revoked")
          expect(plan.mcp.denied[0]?.credentialStatus).toBe("revoked")
          expect(plan.valid).toBe(false)
          // The fact advertises mcp_degraded_search_query; dropping the health
          // gate would add it to the effective set and bump this count.
          expect(plan.costPreview?.effectiveToolCount).toBe(MCP_DENIED_TOOL_COUNT)
        }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
      )
    })
  })

  test("denies a connected MCP server whose live identity is not the frozen binding", async () => {
    await withTmp(async (dir) => {
      const boundRef = "cred_" + "f".repeat(32)
      const otherRef = "cred_" + "0".repeat(32)
      const { revision, profileRevision } = await mcpDenialProfile(dir, {
        serverName: "swapped-search",
        credentialRef: boundRef,
      })
      // Same server name, ready, same asset revision — but a DIFFERENT credential
      // ref than the Profile froze. Matching on serverName alone would accept it.
      mcpFacts = [
        new McpConnection.Fact({
          serverName: "swapped-search",
          ref: { relativePath: "swapped-search.md", revision },
          credentialRef: otherRef,
          health: "ready",
          tools: ["mcp_swapped_search_query"],
        }),
      ]

      await Effect.runPromise(
        Effect.gen(function* () {
          const resolver = yield* CompositionResolver.Service
          const input = new Composition.ProfileInput({
            source: "profile",
            profilePath: "denial-profile.yaml",
            profileRevision,
          })
          const plan = yield* resolver.resolve(input)
          expect(plan.mcp.effective).toEqual([])
          expect(plan.mcp.denied).toHaveLength(1)
          expect(plan.mcp.denied[0]?.reason).toBe("binding_mismatch")
          expect(plan.mcp.denied[0]?.health).toBe("ready")
          expect(plan.valid).toBe(false)
          expect(plan.costPreview?.effectiveToolCount).toBe(MCP_DENIED_TOOL_COUNT)
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

            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input, sessionID: "ses-multi-123" }))
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
            expect(plan.commands[0].source).toContain("without executing it")
            expect(plan.capabilities).toEqual([])
            expect(plan.costPreview?.effectiveToolCount).toBe(1)
            expect(plan.instructions.some((instruction) => instruction.content.includes("without executing it"))).toBe(
              false,
            )

            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(snapshot.version).toBe(2)
            if (snapshot.version === 2) {
              expect(snapshot.data.maxConcurrency).toBe(1)
              expect(snapshot.data.bindings!.orchestrator.prompts).toHaveLength(1)
              expect(snapshot.data.bindings!.orchestrator.skills).toEqual([])
              expect(snapshot.data.bindings!.orchestrator.commands[0].name).toBe("review")
              expect(snapshot.data.bindings!["agents/coder"].prompts).toEqual([])
              expect(snapshot.data.bindings!["agents/coder"].skills[0].name).toBe("review")
              expect(snapshot.data.bindings!["agents/coder"].commands[0].name).toBe("review")
              expect(snapshot.data.tools.catalog).toEqual(["read"])
            }
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("freezes the full CommandAsset identity (invocation/args/source) in the snapshot", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nYou code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))

        const commandDir = path.join(dir, ".aigcfroge", "commands")
        await fs.mkdir(commandDir, { recursive: true })
        const commandRaw = `---\nkind: command\nname: review\ndescription: Review the change\ninvocation: /review $1\nargs: "$1: path"\n---\nReview it without executing.\n`
        await fs.writeFile(path.join(commandDir, "review.md"), commandRaw)
        const commandRev = Hash.sha256(Buffer.from(commandRaw))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const commandRef = { kind: "command" as const, relativePath: "review.md", revision: commandRev }
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [{ kind: "agent", relativePath: "coder.md", revision: coderRev }],
              bindings: {
                orchestrator: { prompts: [], skills: [], commands: [commandRef] },
              },
              presentation: "native",
              requestedCapabilities: [],
            })
            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(snapshot.version).toBe(2)
            if (snapshot.version === 2) {
              const commands = snapshot.data.bindings!.orchestrator.commands
              expect(commands[0]?.invocation).toBe("/review $1")
              expect(commands[0]?.args).toBe("$1: path")
              expect(commands[0]?.source).toContain("Review it without executing")
            }
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("legacy CommandInfo snapshots decode with an empty invocation (fail closed)", () => {
      // A snapshot written before S5 carries the body under the retired `template`
      // key. It must still decode (excess keys are ignored) and must be
      // identifiable as legacy: `invocation` is the discriminator, because
      // `CommandAsset.Invocation` requires >= 1 code point so a real freeze can
      // never produce "".
      const legacy = Schema.decodeUnknownSync(Composition.CommandInfo)({
        name: "review",
        description: "Review",
        relativePath: "review.md",
        revision: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        template: "old template",
      })
      expect(legacy.invocation).toBe("")
      expect(legacy.args).toBeUndefined()
      expect(legacy.source).toBeUndefined()
    })

    test("freezes an orchestrator entry even when nothing is bound to it", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        const coderRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nYou code.\n`
        await fs.writeFile(path.join(agentDir, "coder.md"), coderRaw)
        const coderRev = Hash.sha256(Buffer.from(coderRaw))
        // A second agent puts the composition on the V2 (scoped graph) freeze path; a single-agent
        // composition with no workflow or command still freezes as V1 by design.
        const writerRaw = `---\nkind: agent\nname: writer\ndescription: Writer\n---\nYou write.\n`
        await fs.writeFile(path.join(agentDir, "writer.md"), writerRaw)
        const writerRev = Hash.sha256(Buffer.from(writerRaw))

        const skillDir = path.join(dir, ".aigcfroge", "skills", "review")
        await fs.mkdir(skillDir, { recursive: true })
        const skillRaw = `---\nname: review\ndescription: Review checklist\n---\nCheck correctness.\n`
        await fs.writeFile(path.join(skillDir, "SKILL.md"), skillRaw)
        const skillRev = Hash.sha256(Buffer.from(skillRaw))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            // Everything bound to the child agent, nothing to the orchestrator. The frozen graph must
            // still carry an orchestrator entry: the runtime fails closed on an absent consumer, so
            // omitting it would make this legitimate composition unrunnable at its root.
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [
                { kind: "agent", relativePath: "coder.md", revision: coderRev },
                { kind: "agent", relativePath: "writer.md", revision: writerRev },
              ],
              bindings: {
                "agents/coder": {
                  prompts: [],
                  skills: [{ kind: "skill", relativePath: "review/SKILL.md", revision: skillRev }],
                },
              },
              presentation: "native",
              requestedCapabilities: [],
            })

            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(snapshot.version).toBe(2)
            if (snapshot.version === 2) {
              expect(snapshot.data.bindings).toBeDefined()
              const keys = Object.keys(snapshot.data.bindings!)
              // Every addressable consumer gets an entry, bound or not.
              expect(keys).toContain("orchestrator")
              expect(keys).toContain("agents/writer")
              expect(snapshot.data.bindings!.orchestrator.skills).toEqual([])
              expect(snapshot.data.bindings!.orchestrator.prompts).toEqual([])
              expect(snapshot.data.bindings!["agents/coder"].skills[0].name).toBe("review")
              expect(snapshot.data.bindings!["agents/writer"].skills).toEqual([])
              // Each agent's own system prompt lands in its own consumer, never the orchestrator's.
              expect(snapshot.data.bindings!["agents/coder"].instructions.map((i) => i.source)).toContain("agent:coder")
              expect(snapshot.data.bindings!["agents/writer"].instructions.map((i) => i.source)).toContain(
                "agent:writer",
              )
              expect(snapshot.data.bindings!.orchestrator.instructions.map((i) => i.source)).not.toContain(
                "agent:coder",
              )
            }
          }).pipe(Effect.provide(fullResolverLayer(dir)), Effect.scoped),
        )
      })
    })

    test("derives a machine consumer key for agent names ConsumerKey cannot express", async () => {
      await withTmp(async (dir) => {
        const agentDir = path.join(dir, ".aigcfroge", "agents")
        await fs.mkdir(agentDir, { recursive: true })
        // ConsumerKey only accepts [a-zA-Z0-9_-]; AgentAsset.Name accepts any 1-80 code points. The
        // key is therefore derived, not copied: an ASCII filename supplies it, and a filename that
        // sanitizes to nothing falls back to a deterministic hex digest.
        const asciiFileRaw = `---\nkind: agent\nname: 测试 代理.1\ndescription: Unicode name, ASCII file\n---\nYou test.\n`
        await fs.writeFile(path.join(agentDir, "reviewer.md"), asciiFileRaw)
        const asciiFileRev = Hash.sha256(Buffer.from(asciiFileRaw))
        const unicodeFileRaw = `---\nkind: agent\nname: 写手\ndescription: Unicode name and file\n---\nYou write.\n`
        await fs.writeFile(path.join(agentDir, "写手.md"), unicodeFileRaw)
        const unicodeFileRev = Hash.sha256(Buffer.from(unicodeFileRaw))

        await Effect.runPromise(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            const input = Schema.decodeUnknownSync(Composition.CompositionInput)({
              source: "temporary",
              agents: [
                { kind: "agent", relativePath: "reviewer.md", revision: asciiFileRev },
                { kind: "agent", relativePath: "写手.md", revision: unicodeFileRev },
              ],
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            })

            const snapshot = yield* resolver.freeze(new Composition.FreezeInput({ input }))
            expect(snapshot.version).toBe(2)
            if (snapshot.version !== 2) return
            const keyFor = (name: string) => snapshot.data.agents.find((a) => a.name === name)?.consumerKey
            const asciiKey = keyFor("测试 代理.1")
            const hexKey = keyFor("写手")
            // Display names survive untouched; the keys are ASCII and ConsumerKey-decodable.
            expect(asciiKey).toBe("agents/reviewer")
            expect(hexKey).toMatch(/^agents\/[0-9a-f]{1,12}$/)
            for (const key of [asciiKey, hexKey]) {
              expect(() => Schema.decodeUnknownSync(Composition.ConsumerKey)(key!)).not.toThrow()
              expect(Object.keys(snapshot.data.bindings!)).toContain(key!)
            }
            // Distinct agents never collapse onto one consumer.
            expect(asciiKey).not.toBe(hexKey)
            // Each agent's own prompt is scoped to its own derived key.
            expect(snapshot.data.bindings![asciiKey!].instructions.map((i) => i.source)).toContain("agent:测试 代理.1")
            expect(snapshot.data.bindings![hexKey!].instructions.map((i) => i.source)).toContain("agent:写手")
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
