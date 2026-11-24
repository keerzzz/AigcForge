import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Global } from "@omnixa/util/global"
import { Bus } from "../src/bus"
import { Agent } from "../src/agent"
import { AgentAsset } from "../src/agent-asset"
import {
  parseAgentAssetConfig,
  agentAssetToAgentInfo,
  refreshAgentAssets,
  registerAgentAssetTransform,
} from "../src/agent/asset-bridge"
import { Model } from "../src/model"
import { Provider } from "../src/provider"
import { FSUtil } from "@omnixa/util/fs-util"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { location } from "./fixture/location"

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })),
)
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))

describe("AgentAssetBridge - parseAgentAssetConfig", () => {
  test("retains protocol cards and rejects malformed nonempty Agent registration config", () => {
    const config = "card:\n  capabilities: [review]\n  constraints: []\n  protocol: Exact asset protocol.\n"
    expect(parseAgentAssetConfig(config)?.card).toEqual({
      capabilities: ["review"],
      constraints: [],
      protocol: "Exact asset protocol.",
    })
    expect(parseAgentAssetConfig("card: false")?.card).toEqual({ _tag: "InvalidCard", reason: "invalid_shape" })
    const asset = {
      kind: "agent" as const,
      name: "reviewer",
      description: "Review",
      relativePath: "reviewer.md",
      revision: "a".repeat(64),
      source: "Review carefully.",
      handoffs: [],
      config,
    }
    expect(agentAssetToAgentInfo(asset)?.card).toEqual(parseAgentAssetConfig(config)?.card)
    expect(agentAssetToAgentInfo({ ...asset, config: "steps: nope" })).toBeUndefined()
    expect(agentAssetToAgentInfo({ ...asset, config: "" })?.card).toBeUndefined()
  })
  test("parses valid YAML config into ConfigAgent.Info", () => {
    const yamlStr = `model: anthropic/claude-3-5-sonnet
mode: subagent
hidden: true
permissions:
  - action: bash
    resource: "*"
    effect: allow
`
    const parsed = parseAgentAssetConfig(yamlStr)
    expect(parsed).toBeDefined()
    expect(parsed?.model).toMatchObject({
      providerID: Provider.ID.make("anthropic"),
      model: Model.ID.make("claude-3-5-sonnet"),
    })
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
  test("converts valid AgentAsset.Info to Agent.Info", () => {
    const asset: AgentAsset.Info = {
      kind: "agent",
      name: "reviewer",
      description: "Code reviewer",
      relativePath: "reviewer.md",
      config: `model: anthropic/claude-3-5-sonnet
mode: subagent
request:
  headers:
    X-Agent: reviewer
  body:
    temperature: 0.2
    metadata:
      owner: reviewer`,
      source: "You are a code reviewer.",
      revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      handoffs: [],
    }
    const info = agentAssetToAgentInfo(asset)
    expect(info).toBeDefined()
    expect(info?.id).toBe(Agent.ID.make("reviewer"))
    expect(info?.description).toBe("Code reviewer")
    expect(info?.model).toMatchObject({
      id: Model.ID.make("claude-3-5-sonnet"),
      providerID: Provider.ID.make("anthropic"),
    })
    expect(info?.mode).toBe("subagent")
    expect(info?.request).toEqual({
      settings: {},
      headers: { "X-Agent": "reviewer" },
      body: { temperature: 0.2, metadata: { owner: "reviewer" } },
    })
    expect(info?.originRelativePath).toBe("reviewer.md")
    expect(info?.originRevision).toBe(asset.revision)
  })

  test("keeps default request fields when overrides are absent or partial", () => {
    const asset: AgentAsset.Info = {
      kind: "agent",
      name: "reviewer",
      description: "Code reviewer",
      relativePath: "reviewer.md",
      config: "",
      source: "You are a code reviewer.",
      revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      handoffs: [],
    }
    expect(agentAssetToAgentInfo(asset)?.request).toEqual({ settings: {}, headers: {}, body: {} })
    expect(agentAssetToAgentInfo({ ...asset, config: "request:\n  headers:\n    X-Agent: reviewer" })?.request).toEqual(
      {
        settings: {},
        headers: { "X-Agent": "reviewer" },
        body: {},
      },
    )
    expect(agentAssetToAgentInfo({ ...asset, config: "request:\n  body:\n    temperature: 0.2" })?.request).toEqual({
      settings: {},
      headers: {},
      body: { temperature: 0.2 },
    })
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
  test("transforms Agent state by injecting AgentAsset candidates", async () => {
    const tmp = await tmpdir()
    try {
      const agentsDir = path.join(tmp.path, ".omnixa", "agents")
      await fs.mkdir(agentsDir, { recursive: true })
      await fs.writeFile(
        path.join(agentsDir, "writer.md"),
        `---
kind: agent
name: writer
description: Technical writer
config: |
  mode: subagent
  card:
    capabilities: [documentation]
    constraints: [focused]
    protocol: Exact registered asset protocol.
  request:
    headers:
      X-Agent: writer
    body:
      temperature: 0.2
---
Write good docs.
`,
      )

      const locationLayer = Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
      )
      const agentLayer = AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node]), [
        Global.node.replace(globalLayer),
        Location.node.replace(locationLayer),
      ])

      const effect = Effect.gen(function* () {
        const agentAssetService = yield* AgentAsset.Service
        const agentV2Service = yield* Agent.Service
        yield* agentAssetService.reload()

        yield* registerAgentAssetTransform(agentV2Service, agentAssetService)
        yield* agentV2Service.reload()

        const writer = yield* agentV2Service.get(Agent.ID.make("writer"))
        expect(writer).toBeDefined()
        expect(writer?.description).toBe("Technical writer")
        expect(writer?.system).toBe("Write good docs.")
        expect(writer?.mode).toBe("subagent")
        expect(writer?.card).toEqual({
          capabilities: ["documentation"],
          constraints: ["focused"],
          protocol: "Exact registered asset protocol.",
        })
        expect(writer?.request).toEqual({ settings: {}, headers: { "X-Agent": "writer" }, body: { temperature: 0.2 } })
        expect(writer?.originRelativePath).toBe("writer.md")
        expect(writer?.originRevision).toBeString()

        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(agentsDir, "writer.md"),
            `---
kind: agent
name: writer
description: Updated writer
config: |
  mode: subagent
  request:
    headers:
      X-Agent: updated
    body:
      temperature: 0.4
---
Write updated docs.
`,
          ),
        )
        yield* refreshAgentAssets(agentV2Service, agentAssetService)
        const updated = yield* agentV2Service.get(Agent.ID.make("writer"))
        expect(updated?.description).toBe("Updated writer")
        expect(updated?.system).toBe("Write updated docs.")
        expect(updated?.request).toEqual({
          settings: {},
          headers: { "X-Agent": "updated" },
          body: { temperature: 0.4 },
        })
      }).pipe(
        Effect.provide(agentLayer),
        Effect.provide(AgentAsset.layer),
        Effect.provide(locationLayer),
        Effect.provide(fsLayer),
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
      const agentsDir = path.join(tmp.path, ".omnixa", "agents")
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
      const agentLayer = AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node]), [
        Global.node.replace(globalLayer),
        Location.node.replace(locationLayer),
      ])

      const effect = Effect.gen(function* () {
        const agentAssetService = yield* AgentAsset.Service
        const agentV2Service = yield* Agent.Service
        yield* agentAssetService.reload()

        // Stand in for the built-in agent transforms that run before the bridge.
        yield* agentV2Service.transform((draft) => {
          draft.update(Agent.ID.make("chat-orchestrator"), (agent) => {
            agent.description = "Built-in chat orchestrator"
            agent.system = "Built-in prompt."
            agent.permissions = [{ action: "write", resource: "*", effect: "deny" }]
          })
        })

        yield* registerAgentAssetTransform(agentV2Service, agentAssetService)
        yield* agentV2Service.reload()

        const agent = yield* agentV2Service.get(Agent.ID.make("chat-orchestrator"))
        expect(agent?.description).toBe("Built-in chat orchestrator")
        expect(agent?.system).toBe("Built-in prompt.")
        expect(agent?.permissions).toEqual([{ action: "write", resource: "*", effect: "deny" }])
      }).pipe(
        Effect.provide(agentLayer),
        Effect.provide(AgentAsset.layer),
        Effect.provide(locationLayer),
        Effect.provide(fsLayer),
        Effect.scoped,
      )

      await Effect.runPromise(effect)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})
