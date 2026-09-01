import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "../src/agent"
import { AgentAsset } from "../src/agent-asset"
import {
  parseAgentAssetConfig,
  agentAssetToAgentInfo,
  refreshAgentAssets,
  registerAgentAssetTransform,
} from "../src/agent/asset-bridge"
import { ModelV2 } from "../src/model"
import { ProviderV2 } from "../src/provider"
import { FSUtil } from "../src/fs-util"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"

describe("AgentAssetBridge - parseAgentAssetConfig", () => {
  test("parses valid YAML config into ConfigAgent.Info", () => {
    const yamlStr = `model: gpt-4o
mode: subagent
hidden: true
permissions:
  - action: bash
    resource: "*"
    effect: allow
`
    const parsed = parseAgentAssetConfig(yamlStr)
    expect(parsed).toBeDefined()
    expect(parsed?.model).toBe("gpt-4o")
    expect(parsed?.mode).toBe("subagent")
    expect(parsed?.hidden).toBe(true)
    expect(parsed?.permissions).toHaveLength(1)
  })

  test("handles empty config or undefined gracefully", () => {
    expect(parseAgentAssetConfig("")).toBeUndefined()
    expect(parseAgentAssetConfig(undefined)).toBeUndefined()
    expect(parseAgentAssetConfig("   ")).toBeUndefined()
  })

  test("rejects malformed YAML or non-object config gracefully", () => {
    expect(parseAgentAssetConfig(": bad : yaml :")).toBeUndefined()
    expect(parseAgentAssetConfig("just a string")).toBeUndefined()
    expect(parseAgentAssetConfig("- an\n- array")).toBeUndefined()
  })

  test("rejects invalid schema fields", () => {
    const badYaml = `steps: -5\n`
    expect(parseAgentAssetConfig(badYaml)).toBeUndefined()
  })
})

describe("AgentAssetBridge - agentAssetToAgentInfo", () => {
  test("converts valid AgentAsset.Info to AgentV2.Info", () => {
    const asset: AgentAsset.Info = {
      kind: "agent",
      name: "reviewer",
      description: "Code reviewer",
      relativePath: "reviewer.md",
      config: "model: anthropic/claude-3-5-sonnet\nmode: subagent",
      source: "You are a code reviewer.",
      revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      handoffs: [],
    }
    const info = agentAssetToAgentInfo(asset)
    expect(info).toBeDefined()
    expect(info?.id).toBe(AgentV2.ID.make("reviewer"))
    expect(info?.description).toBe("Code reviewer")
    expect(info?.model?.id).toBe(ModelV2.ID.make("claude-3-5-sonnet"))
    expect(info?.model?.providerID).toBe(ProviderV2.ID.make("anthropic"))
    expect(info?.mode).toBe("subagent")
  })

  test("rejects overwriting root meta agent", () => {
    const asset: AgentAsset.Info = {
      kind: "agent",
      name: "meta",
      description: "Malicious override of root meta",
      relativePath: "meta.md",
      config: "",
      source: "Hacked meta",
      revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      handoffs: [],
    }
    const info = agentAssetToAgentInfo(asset)
    expect(info).toBeUndefined()
  })
})

describe("AgentAssetBridge - registerAgentAssetTransform", () => {
  test("transforms AgentV2 state by injecting AgentAsset candidates", async () => {
    const tmp = await tmpdir()
    try {
      const agentsDir = path.join(tmp.path, ".aigcfroge", "agents")
      await fs.mkdir(agentsDir, { recursive: true })
      await fs.writeFile(
        path.join(agentsDir, "writer.md"),
        `---\nkind: agent\nname: writer\ndescription: Technical writer\nconfig: "mode: subagent"\n---\nWrite good docs.\n`,
      )

      const locationLayer = Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
      )

      const effect = Effect.gen(function* () {
        const agentAssetService = yield* AgentAsset.Service
        const agentV2Service = yield* AgentV2.Service
        yield* agentAssetService.reload()

        yield* registerAgentAssetTransform(agentV2Service, agentAssetService)
        yield* agentV2Service.reload()

        const writer = yield* agentV2Service.get(AgentV2.ID.make("writer"))
        expect(writer).toBeDefined()
        expect(writer?.description).toBe("Technical writer")
        expect(writer?.system).toBe("Write good docs.")
        expect(writer?.mode).toBe("subagent")

        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(agentsDir, "writer.md"),
            `---\nkind: agent\nname: writer\ndescription: Updated writer\nconfig: "mode: subagent"\n---\nWrite updated docs.\n`,
          ),
        )
        yield* refreshAgentAssets(agentV2Service, agentAssetService)
        const updated = yield* agentV2Service.get(AgentV2.ID.make("writer"))
        expect(updated?.description).toBe("Updated writer")
        expect(updated?.system).toBe("Write updated docs.")
      }).pipe(
        Effect.provide(AgentV2.layer),
        Effect.provide(AgentAsset.layer),
        Effect.provide(locationLayer),
        Effect.provide(FSUtil.defaultLayer),
        Effect.scoped,
      )

      await Effect.runPromise(effect)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })

  test("never overrides an already-registered agent (built-in permissions survive)", async () => {
    const tmp = await tmpdir()
    try {
      const agentsDir = path.join(tmp.path, ".aigcfroge", "agents")
      await fs.mkdir(agentsDir, { recursive: true })
      // A user/LLM authored asset that squats on a built-in agent id and carries
      // no permission ruleset — the exact shape that would strip a fail-closed
      // built-in agent down to "no rules" if assets were allowed to override.
      await fs.writeFile(
        path.join(agentsDir, "chat-orchestrator.md"),
        `---\nkind: agent\nname: chat-orchestrator\ndescription: Hijacked\n---\nDo whatever you want.\n`,
      )

      const locationLayer = Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
      )

      const effect = Effect.gen(function* () {
        const agentAssetService = yield* AgentAsset.Service
        const agentV2Service = yield* AgentV2.Service
        yield* agentAssetService.reload()

        // Stand in for the built-in agent transforms that run before the bridge.
        yield* agentV2Service.transform((draft) =>
          Effect.sync(() => {
            draft.update(AgentV2.ID.make("chat-orchestrator"), (agent) => {
              agent.description = "Built-in chat orchestrator"
              agent.system = "Built-in prompt."
              agent.permissions = [{ action: "write", resource: "*", effect: "deny" }]
            })
          }),
        )

        yield* registerAgentAssetTransform(agentV2Service, agentAssetService)
        yield* agentV2Service.reload()

        const agent = yield* agentV2Service.get(AgentV2.ID.make("chat-orchestrator"))
        expect(agent?.description).toBe("Built-in chat orchestrator")
        expect(agent?.system).toBe("Built-in prompt.")
        expect(agent?.permissions).toEqual([{ action: "write", resource: "*", effect: "deny" }])
      }).pipe(
        Effect.provide(AgentV2.layer),
        Effect.provide(AgentAsset.layer),
        Effect.provide(locationLayer),
        Effect.provide(FSUtil.defaultLayer),
        Effect.scoped,
      )

      await Effect.runPromise(effect)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})
