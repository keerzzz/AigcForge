export * as MetaPromptFiller from "./meta-prompt-filler"

import { Effect, Layer, Option } from "effect"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { AgentV2 } from "@aigcfroge/core/agent"
import { CliAdapterRegistry } from "@/agent/meta/adapters/registry"
import { scanAssets } from "./assets-loader"

/**
 * Fills {{CLI_LIST}} and {{ASSETS_LIST}} in the V2 meta agent's system prompt.
 * CLI_LIST is filled from the CliAdapterRegistry. ASSETS_LIST is filled by
 * scanning .aigcfroge/ directories in the project root (process.cwd()).
 *
 * Provides MetaPrompt.Service and registers an AgentV2 transform that
 * patches the meta agent prompt after core plugin initialization.
 */
export const layer = Layer.effect(
  MetaPrompt.Service,
  Effect.gen(function* () {
    const registry = yield* CliAdapterRegistry.AdapterRegistry

    // Pre-compute CLI names, then register a synchronous transform.
    const adapters = yield* registry.available()
    const cliNames = adapters.map((a) => a.name)

    // Pre-compute asset list from project's .aigcfroge/ directories.
    let assets: readonly { kind: string; name: string }[] = []
    try {
      assets = yield* Effect.promise(() => scanAssets(process.cwd()))
    } catch {
      // Silently fall back to empty list if scanning fails
    }

    // Attempt to register an AgentV2 transform; skip silently when
    // AgentV2 is not available (e.g. outside a Location scope).
    const agentV2Option = yield* Effect.serviceOption(AgentV2.Service)
    if (Option.isSome(agentV2Option)) {
      yield* agentV2Option.value.transform((draft) => {
        draft.update(AgentV2.ID.make("meta"), (item) => {
          if (item.system) {
            item.system = MetaPrompt.fillAssetsList(MetaPrompt.fillCliList(item.system, cliNames), assets)
          }
        })
      })
    }

    return MetaPrompt.Service.of({
      fill: (prompt: string) =>
        Effect.sync(() => MetaPrompt.fillAssetsList(MetaPrompt.fillCliList(prompt, cliNames), assets)),
    })
  }),
)
