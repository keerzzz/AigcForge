import { describe, expect } from "bun:test"
import { Exit, Effect, Layer, Scope, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionV2 } from "@aigcfroge/core/session"
import { Tool } from "@aigcfroge/core/tool/tool"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { testEffect } from "./lib/effect"

// ADR-19 approval condition C1: one materialization feeds both definitions and
// settle. When a Location registration changes between materialize and settle,
// the settle side must keep the captured registration.identity and fail stale
// instead of re-resolving the current winner. This pins the existing Law so
// the upcoming sessionID placement filter cannot reopen the stale window.

const permission = Layer.mock(PermissionV2.Service, { assert: () => Effect.void })
const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(ApplicationTools.layer),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const it = testEffect(registryLayer)

const echo = (tag: string) =>
  Tool.make({
    description: `echo ${tag}`,
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text: `${tag}:${text}` }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })

const call = (id: string) => ({
  sessionID: SessionV2.ID.make("ses_stale_law"),
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_stale_law"),
  call: { type: "tool-call" as const, id, name: "echo", input: { text: "hi" } },
})

describe("ToolRegistry single-materialization law (ADR-19 C1)", () => {
  it.effect("settle keeps the materialized identity across a mid-flight registration change", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const firstScope = yield* Scope.make()
      yield* registry.register({ echo: echo("v1") }).pipe(Scope.provide(firstScope))

      const materialized = yield* registry.materialize()
      expect(materialized.definitions.map((definition) => definition.name)).toEqual(["echo"])

      const before = yield* materialized.settle(call("call-before"))
      expect(before.result.type).toBe("text")

      // Location re-registration replaces the effective winner after
      // materialization but before settlement.
      const secondScope = yield* Scope.make()
      yield* registry.register({ echo: echo("v2") }).pipe(Scope.provide(secondScope))

      const stale = yield* materialized.settle(call("call-stale"))
      expect(stale.result).toMatchObject({ type: "error" })
      if (stale.result.type === "error") expect(String(stale.result.value)).toContain("Stale tool call")

      // Closing the replacement reveals the original winner; the SAME
      // materialization settles against its captured identity once more.
      yield* Scope.close(secondScope, Exit.void)
      const revealed = yield* materialized.settle(call("call-revealed"))
      expect(revealed.result.type).toBe("text")

      yield* Scope.close(firstScope, Exit.void)
      const afterClose = yield* materialized.settle(call("call-after-close"))
      expect(afterClose.result).toMatchObject({ type: "error" })
      if (afterClose.result.type === "error") expect(String(afterClose.result.value)).toContain("Stale tool call")
    }),
  )
})
