export * as MetaPromptFiller from "./meta-prompt-filler"

import { Effect, Layer, Option, Schedule } from "effect"
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

    // Pre-compute asset list from project's .aigcfroge/ directories. CLI names
    // are NOT pre-computed: both fill() and the AgentV2 transform below resolve
    // them live so a CLI that appears after this layer built shows up without
    // a restart.
    let assets: readonly { kind: string; name: string }[] = []
    try {
      assets = yield* Effect.promise(() => scanAssets(process.cwd()))
    } catch {
      // Silently fall back to empty list if scanning fails
    }

    const cliNames = Effect.fnUntraced(function* () {
      const adapters = yield* registry.available()
      return adapters.map((a) => a.name)
    })

    const fill = Effect.fn("MetaPromptFiller.fill")(function* (prompt: string) {
      const names = yield* cliNames()
      return MetaPrompt.fillAssetsList(MetaPrompt.fillCliList(prompt, names), assets)
    })

    const agentV2Option = yield* Effect.serviceOption(AgentV2.Service)
    if (Option.isSome(agentV2Option)) {
      const agentV2 = agentV2Option.value
      // AgentV2 transforms are replayed from pristine state on every reload, so
      // resolving the CLI list inside the transform keeps the meta prompt live:
      // each reload re-fills {{CLI_LIST}} with the currently-detectable CLIs.
      yield* agentV2.transform((draft) =>
        Effect.gen(function* () {
          const names = yield* cliNames()
          draft.update(AgentV2.ID.make("meta"), (item) => {
            if (item.system) {
              item.system = MetaPrompt.fillAssetsList(MetaPrompt.fillCliList(item.system, names), assets)
            }
          })
        }),
      )

      // Re-detect on a slow cadence and reload agents when the detectable CLI
      // set changes — a CLI installed after startup reaches the meta prompt
      // without a restart (same 60s cadence the agent-list refresh uses).
      yield* Effect.gen(function* () {
        let last = yield* cliNames()
        yield* Effect.repeat(
          Effect.gen(function* () {
            const next = yield* cliNames()
            if (next.join("\n") === last.join("\n")) return
            last = next
            yield* agentV2.reload()
          }),
          Schedule.fixed("60 seconds"),
        )
      }).pipe(Effect.forkScoped)
    }

    return MetaPrompt.Service.of({ fill })
  }),
)
