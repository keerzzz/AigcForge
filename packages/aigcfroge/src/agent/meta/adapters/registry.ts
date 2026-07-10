import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import type { CliAdapter } from "./interface"
import { adapter as claudeCodeAdapter } from "./claude-code"
import { adapter as geminiAdapter } from "./gemini"
import { adapter as codexAdapter } from "./codex"

export interface Interface {
  readonly register: (name: string, adapter: CliAdapter) => Effect.Effect<void>
  readonly get: (name: string) => Effect.Effect<CliAdapter | undefined>
  readonly list: () => Effect.Effect<CliAdapter[]>
  readonly available: () => Effect.Effect<CliAdapter[]>
}

export class AdapterRegistry extends Context.Service<AdapterRegistry, Interface>()("@aigcfroge/CliAdapterRegistry") {}

export const layer = Layer.effect(
  AdapterRegistry,
  Effect.gen(function* () {
    const adapters = new Map<string, CliAdapter>()

    // Register built-in adapters
    adapters.set(claudeCodeAdapter.name, claudeCodeAdapter)
    adapters.set(geminiAdapter.name, geminiAdapter)
    adapters.set(codexAdapter.name, codexAdapter)

    return AdapterRegistry.of({
      register: Effect.fn("AdapterRegistry.register")(function* (name: string, adapter: CliAdapter) {
        adapters.set(name, adapter)
      }),

      get: Effect.fn("AdapterRegistry.get")(function* (name: string) {
        return adapters.get(name)
      }),

      list: Effect.fn("AdapterRegistry.list")(function* () {
        return Array.from(adapters.values())
      }),

      available: Effect.fn("AdapterRegistry.available")(function* () {
        const results = yield* Effect.forEach(
          Array.from(adapters.values()),
          (adapter) =>
            adapter.detect().pipe(Effect.map((available) => ({ adapter, available }))),
          { concurrency: "unbounded" },
        )
        return results.filter((r) => r.available).map((r) => r.adapter)
      }),
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as CliAdapterRegistry from "./registry"
