export * as MetaPromptFiller from "./meta-prompt-filler"

import { Effect, Layer, Option } from "effect"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { AgentV2 } from "@aigcfroge/core/agent"
import { CliAdapterRegistry } from "@/agent/meta/adapters/registry"

/**
 * Fills {{CLI_LIST}} in the V2 meta agent's system prompt with names
 * of actually available external CLI tools from the AdapterRegistry.
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

    // Attempt to register an AgentV2 transform; skip silently when
    // AgentV2 is not available (e.g. outside a Location scope).
    const agentV2Option = yield* Effect.serviceOption(AgentV2.Service)
    if (Option.isSome(agentV2Option)) {
      yield* agentV2Option.value.transform((draft) => {
        draft.update(AgentV2.ID.make("meta"), (item) => {
          if (item.system) {
            item.system = MetaPrompt.fillCliList(item.system, cliNames)
          }
        })
      })
    }

    return MetaPrompt.Service.of({
      fill: (prompt: string) =>
        Effect.sync(() => MetaPrompt.fillCliList(prompt, cliNames)),
    })
  }),
)
