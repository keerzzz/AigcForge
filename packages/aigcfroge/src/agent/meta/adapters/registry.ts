import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import {
  getCliAdapter,
  listCliAdapters,
  registerCliAdapter,
} from "@aigcfroge/core/tool/cli-adapter"
import { adapter as claudeCodeAdapter } from "@aigcfroge/core/tool/claude-code"
import { adapter as geminiAdapter } from "@aigcfroge/core/tool/gemini"
import { adapter as codexAdapter } from "@aigcfroge/core/tool/codex"
import { adapter as opencodeAdapter } from "@aigcfroge/core/tool/opencode"
import { adapter as claudeCodeSdkAdapter } from "@aigcfroge/core/tool/claude-code-sdk"
import { adapter as codexSdkAdapter } from "@aigcfroge/core/tool/codex-sdk"
import { adapter as claudeCodeAcpAdapter } from "@aigcfroge/core/tool/claude-code-acp"
import { adapter as codexAcpAdapter } from "@aigcfroge/core/tool/codex-acp"
import { which } from "@aigcfroge/core/util/which"
import type { CliAdapter } from "./interface"

export interface Interface {
  readonly register: (name: string, adapter: CliAdapter) => Effect.Effect<void>
  readonly get: (name: string) => Effect.Effect<CliAdapter | undefined>
  readonly list: () => Effect.Effect<CliAdapter[]>
  readonly available: () => Effect.Effect<CliAdapter[]>
}

export class AdapterRegistry extends Context.Service<AdapterRegistry, Interface>()("@aigcfroge/CliAdapterRegistry") {}

// Single registry: this service is a thin Effect wrapper over the core module
// cell (the same store the `task` tool's TaskDriverFill reads from). Seeding the
// cell with the built-ins here keeps the agent list (@ agent/agent.ts) and the
// task tool on one store; TaskDriverFill re-registers them idempotently. SDK
// transports are the default for claude/codex (jsonl stays config-selectable).
const BUILT_INS = [
  claudeCodeAdapter,
  geminiAdapter,
  codexAdapter,
  opencodeAdapter,
  claudeCodeSdkAdapter,
  codexSdkAdapter,
  // ACP transports become the default only when the bridge binary is on PATH;
  // otherwise the SDK transport stays the default (see TaskDriverFill).
  ...(which("claude-code-acp") ? [claudeCodeAcpAdapter] : []),
  ...(which("codex-acp") ? [codexAcpAdapter] : []),
]

export const layer = Layer.effect(
  AdapterRegistry,
  Effect.sync(() => {
    for (const adapter of BUILT_INS) registerCliAdapter(adapter.name, adapter)
    return AdapterRegistry.of({
      register: Effect.fn("AdapterRegistry.register")(function* (name: string, adapter: CliAdapter) {
        registerCliAdapter(name, adapter)
      }),

      get: Effect.fn("AdapterRegistry.get")(function* (name: string) {
        return getCliAdapter(name)
      }),

      list: Effect.fn("AdapterRegistry.list")(function* () {
        return listCliAdapters()
      }),

      available: Effect.fn("AdapterRegistry.available")(function* () {
        const results = yield* Effect.forEach(
          listCliAdapters(),
          (adapter) =>
            adapter
              .detect()
              .pipe(
                Effect.map((available) => ({ adapter, available })),
                Effect.catch(() => Effect.succeed({ adapter, available: false as const })),
              ),
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
