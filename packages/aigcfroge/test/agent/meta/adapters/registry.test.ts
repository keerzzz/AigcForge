import { describe, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../../lib/effect"
import { disposeAllInstances } from "../../../fixture/fixture"
import { CliAdapterRegistry } from "../../../../src/agent/meta/adapters/registry"
import { Config } from "@aigcfroge/core/config"
import { ConfigCliAgent } from "@aigcfroge/core/config/cli-agent"
import { registerConfigCliAdapters } from "@aigcfroge/core/tool/cli-adapter"

const cliAgentDoc = (
  entries: Record<string, { command: string; transport?: "jsonl" | "sdk" | "acp" }>,
) =>
  new Config.Document({
    type: "document",
    info: new Config.Info({
      cli_agents: Object.fromEntries(
        Object.entries(entries).map(([name, value]) => [name, new ConfigCliAgent.Info(value)]),
      ),
    }),
  })

const it = testEffect(CliAdapterRegistry.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

describe("adapter registry", () => {
  it.instance("starts with claude-code registered", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      const adapter = yield* registry.get("claude-code")
      expect(adapter).toBeDefined()
      expect(adapter!.name).toBe("claude-code")
      expect(adapter!.command).toBe("claude")
    }),
  )

  it.instance("register adds new adapter", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      yield* registry.register("test-cli", {
        name: "test-cli",
        command: "test",
        description: "test adapter",
        detect: () => Effect.succeed(false),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "ok" }),
      })
      const adapter = yield* registry.get("test-cli")
      expect(adapter).toBeDefined()
      expect(adapter!.name).toBe("test-cli")
    }),
  )

  it.instance("list returns all adapters", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      const all = yield* registry.list()
      expect(all.length).toBeGreaterThanOrEqual(1)
    }),
  )

  it.instance("available only returns adapters that pass detect", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      yield* registry.register("available-cli", {
        name: "available-cli",
        command: "test",
        description: "test",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "ok" }),
      })
      yield* registry.register("unavailable-cli", {
        name: "unavailable-cli",
        command: "test2",
        description: "test2",
        detect: () => Effect.succeed(false),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "ok" }),
      })
      const available = yield* registry.available()
      expect(available.some((a) => a.name === "available-cli")).toBe(true)
      expect(available.some((a) => a.name === "unavailable-cli")).toBe(false)
    }),
  )

  it.instance("available adapters can be shaped as Agent.Info", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      // Register a detect=true adapter for deterministic testing
      yield* registry.register("test-agent-cli", {
        name: "test-agent-cli",
        command: "test",
        description: "A test CLI agent",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "ok" }),
      })
      const available = yield* registry.available()
      const testAdapter = available.find((a) => a.name === "test-agent-cli")
      expect(testAdapter).toBeDefined()

      // Convert to Agent.Info shape
      const agentInfo = {
        name: testAdapter!.name,
        description: testAdapter!.description,
        mode: "subagent" as const,
        source: "external-cli" as const,
        native: false,
        hidden: false,
        permission: [],
        options: {},
      }
      expect(agentInfo.name).toBe("test-agent-cli")
      expect(agentInfo.description).toBe("A test CLI agent")
      expect(agentInfo.mode).toBe("subagent")
      expect(agentInfo.source).toBe("external-cli")
      expect(agentInfo.native).toBe(false)
      expect(agentInfo.hidden).toBe(false)
    }),
  )

  it.instance("merges config-defined cli_agents into the registry", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      registerConfigCliAdapters([cliAgentDoc({ "custom-cli": { command: "custom-cli" } })])
      const adapter = yield* registry.get("custom-cli")
      expect(adapter).toBeDefined()
      expect(adapter!.name).toBe("custom-cli")
      expect(adapter!.command).toBe("custom-cli")
    }),
  )

  it.instance("config cli_agents override built-ins with the same name", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      registerConfigCliAdapters([cliAgentDoc({ "claude-code": { command: "my-claude" } })])
      const adapter = yield* registry.get("claude-code")
      expect(adapter).toBeDefined()
      expect(adapter!.command).toBe("my-claude")
    }),
  )

  it.instance("config transport sdk keeps the built-in SDK adapter for claude/codex", () =>
    Effect.gen(function* () {
      const registry = yield* CliAdapterRegistry.AdapterRegistry
      registerConfigCliAdapters([cliAgentDoc({ "claude-code": { command: "claude", transport: "sdk" } })])
      const adapter = yield* registry.get("claude-code")
      expect(adapter?.transport).toBe("sdk")
    }),
  )

  it.instance("config transport sdk for an unknown name fails loudly", () =>
    Effect.gen(function* () {
      expect(() =>
        registerConfigCliAdapters([cliAgentDoc({ "custom-cli": { command: "custom", transport: "sdk" } })]),
      ).toThrow()
    }),
  )
})
