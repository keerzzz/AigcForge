import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { MetaPrompt } from "@aigcfroge/core/agent/meta/meta-prompt"
import { AgentV2 } from "@aigcfroge/core/agent"
import { MetaPromptFiller } from "../../../src/agent/meta/meta-prompt-filler"
import { CliAdapterRegistry } from "../../../src/agent/meta/adapters/registry"
import type { CliAdapter } from "../../../src/agent/meta/adapters/interface"
import { testEffect } from "../../lib/effect"

// A registry whose availability is mutable, so the test can simulate a CLI
// appearing after the filler layer has already been built.
const liveAdapters: CliAdapter[] = []
const makeAdapter = (name: string): CliAdapter => ({
  name,
  command: name,
  description: name,
  detect: () => Effect.succeed(true),
  buildArgs: () => Effect.succeed([]),
  parseOutput: () => Effect.succeed({ status: "success", summary: "ok" }),
})

const mockRegistry = Layer.succeed(
  CliAdapterRegistry.AdapterRegistry,
  CliAdapterRegistry.AdapterRegistry.of({
    register: () => Effect.void,
    get: () => Effect.succeed(undefined),
    list: () => Effect.succeed(liveAdapters),
    available: () => Effect.succeed(liveAdapters),
  }),
)

const it = testEffect(MetaPromptFiller.layer.pipe(Layer.provide(mockRegistry)))

// Production-path layer: one shared AgentV2 instance, with the meta agent's
// template transform registered BEFORE the filler (mirrors core plugin init →
// aigcfroge app-runtime ordering). The provide chain pins the build order.
const templateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((draft) => {
      draft.update(AgentV2.ID.make("meta"), (item) => {
        item.system = "Available CLIs:\n{{CLI_LIST}}"
      })
    })
  }),
).pipe(Layer.provide(AgentV2.layer))

const productionLayer = Layer.mergeAll(
  AgentV2.layer,
  MetaPromptFiller.layer.pipe(Layer.provide(mockRegistry), Layer.provide(templateLayer), Layer.provide(AgentV2.layer)),
)

const itProduction = testEffect(productionLayer)

describe("MetaPromptFiller", () => {
  it.live("fill reflects available() changes instead of a frozen snapshot", () =>
    Effect.gen(function* () {
      const metaPrompt = yield* MetaPrompt.Service
      liveAdapters.length = 0
      liveAdapters.push(makeAdapter("cli-a"))

      const first = yield* metaPrompt.fill("Available CLIs:\n{{CLI_LIST}}")
      expect(first).toContain("cli-a")

      // A CLI installed after the filler layer built must appear on the next fill.
      liveAdapters.push(makeAdapter("cli-b"))
      const second = yield* metaPrompt.fill("Available CLIs:\n{{CLI_LIST}}")
      expect(second).toContain("cli-b")
    }),
  )

  itProduction.live("meta agent system prompt reflects CLI changes across reloads", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      liveAdapters.length = 0
      liveAdapters.push(makeAdapter("cli-a"))

      yield* agents.reload()
      const first = yield* agents.get(AgentV2.ID.make("meta"))
      expect(first?.system).toContain("cli-a")
      expect(first?.system).not.toContain("{{CLI_LIST}}")

      // A CLI installed later reaches the meta prompt on the next reload —
      // transforms replay from pristine state, re-resolving the live CLI list.
      liveAdapters.push(makeAdapter("cli-b"))
      yield* agents.reload()
      const second = yield* agents.get(AgentV2.ID.make("meta"))
      expect(second?.system).toContain("cli-a")
      expect(second?.system).toContain("cli-b")
    }),
  )
})
