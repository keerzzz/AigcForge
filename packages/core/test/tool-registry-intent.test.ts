import { describe, expect } from "bun:test"
import { Tool } from "@aigcfroge/core/tool/tool"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"

const make = () =>
  Tool.make({
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: () =>
    Effect.succeed({ output: { structured: {}, content: [{ type: "text" as const, text: "" }] }, outputPaths: [] }),
})
const registry = ToolRegistry.layer.pipe(Layer.provide(ApplicationTools.layer), Layer.provide(outputStore))
const it = testEffect(registry)

describe("ToolRegistry INTENT_TOOL_FILTERS", () => {
  it.effect("code_understanding returns only readonly tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ read: make(), grep: make(), edit: make(), bash: make(), write: make() })
      const names = (yield* service.materialize([], "code_understanding")).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["grep", "read"])
    }),
  )

  it.effect("code_modification returns all tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ read: make(), grep: make(), edit: make(), bash: make() })
      const names = (yield* service.materialize([], "code_modification")).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["bash", "edit", "grep", "read"])
    }),
  )

  it.effect("undefined intent returns all tools (backward compatible)", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ read: make(), edit: make(), bash: make() })
      const names = (yield* service.materialize([], undefined)).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["bash", "edit", "read"])
    }),
  )

  it.effect("content_creation returns write + readonly", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        read: make(),
        write: make(),
        edit: make(),
        config: make(),
        grep: make(),
        bash: make(),
        propose_prompt_asset: make(),
      })
      const names = (yield* service.materialize([], "content_creation")).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["bash", "edit", "grep", "propose_prompt_asset", "read", "write"])
    }),
  )

  it.effect("configuration returns only config tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        read: make(),
        edit: make(),
        config: make(),
        agent: make(),
        bash: make(),
        skill: make(),
        propose_workflow_asset: make(),
      })
      const names = (yield* service.materialize([], "configuration")).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["agent", "config", "propose_workflow_asset", "skill"])
    }),
  )

  it.effect("chat-orchestrator permissions retain propose tools after intent filtering", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ read: make(), bash: make(), propose_workflow_asset: make() })
      const permissions = [
        { action: "*", resource: "*", effect: "deny" as const },
        { action: "read", resource: "*", effect: "allow" as const },
        { action: "propose_workflow_asset", resource: "*", effect: "allow" as const },
      ]
      const names = (yield* service.materialize(permissions, "configuration")).definitions.map((d) => d.name).sort()
      expect(names).toEqual(["propose_workflow_asset"])
    }),
  )

  it.effect("permissions applied after intent filter", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ read: make(), grep: make(), edit: make(), bash: make() })
      const names = (yield* service.materialize(
        [{ action: "grep", resource: "*", effect: "deny" }],
        "code_understanding",
      )).definitions
        .map((d) => d.name)
        .sort()
      expect(names).toEqual(["read"])
    }),
  )
})
