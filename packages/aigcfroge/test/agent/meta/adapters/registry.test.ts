import { describe, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../../lib/effect"
import { disposeAllInstances } from "../../../fixture/fixture"
import { CliAdapterRegistry } from "../../../../src/agent/meta/adapters/registry"

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
})
