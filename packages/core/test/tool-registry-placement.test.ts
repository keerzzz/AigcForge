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

// ADR-19 §2.2: registration placement is { location } | { session, sessionID }.
// A session-scoped registration is visible only to that session's
// materialization; a Location registration is visible to every session; and
// the placement filter applies to settle resolution with the same predicate —
// so a foreign session's shadow registration can neither execute nor fake a
// stale error for the owning session.

const permission = Layer.mock(PermissionV2.Service, { assert: () => Effect.void })
const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(ApplicationTools.layer),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const it = testEffect(registryLayer)

const executed: string[] = []
const echo = (tag: string) => {
  const tool = Tool.make({
    description: `echo ${tag}`,
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) =>
      Effect.sync(() => {
        executed.push(tag)
        return { text: `${tag}:${text}` }
      }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })
  return tool
}


const sessionA = SessionV2.ID.make("ses_placement_a")
const sessionB = SessionV2.ID.make("ses_placement_b")
const callFor = (sessionID: SessionV2.ID, id: string) => ({
  sessionID,
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make(`msg_${id}`),
  call: { type: "tool-call" as const, id, name: "echo", input: { text: "hi" } },
})

describe("ToolRegistry placement (ADR-19 §2.2)", () => {
  it.effect("a session registration is invisible to other sessions and to location-wide views", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* registry.registerSession(sessionA, { echo: echo("a") }).pipe(Scope.provide(scope))

      const forA = yield* registry.materialize(undefined, undefined, { sessionID: sessionA })
      expect(forA.definitions.map((definition) => definition.name)).toEqual(["echo"])

      const forB = yield* registry.materialize(undefined, undefined, { sessionID: sessionB })
      expect(forB.definitions).toEqual([])

      const locationWide = yield* registry.materialize()
      expect(locationWide.definitions).toEqual([])

      // Settle resolves placement from the materialization, not from the call:
      // a Session-placed materialization is only settleable by its own Session.
      const before = executed.length
      const crossSettle = yield* forA.settle(callFor(sessionB, "call-cross"))
      expect(crossSettle.result).toMatchObject({ type: "error", value: "Tool call placement mismatch: echo" })
      expect(executed.length).toBe(before)

      const ownSettle = yield* forA.settle(callFor(sessionA, "call-own"))
      expect(ownSettle.result.type).toBe("text")

      yield* Scope.close(scope, Exit.void)
      const afterClose = yield* registry.materialize(undefined, undefined, { sessionID: sessionA })
      expect(afterClose.definitions).toEqual([])
    }),
  )

  it.effect("a location registration is visible to every session and shadows nothing by default", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const locationScope = yield* Scope.make()
      yield* registry.register({ echo: echo("loc") }).pipe(Scope.provide(locationScope))

      for (const sessionID of [sessionA, sessionB]) {
        const view = yield* registry.materialize(undefined, undefined, { sessionID })
        expect(view.definitions.map((definition) => definition.name)).toEqual(["echo"])
        const settled = yield* view.settle(callFor(sessionID, `call-${sessionID}`))
        expect(settled.result.type).toBe("text")
      }

      // A session registration shadows the location winner inside its own
      // session only; the location-wide view keeps serving the location entry.
      const sessionScope = yield* Scope.make()
      yield* registry.registerSession(sessionA, { echo: echo("shadow") }).pipe(Scope.provide(sessionScope))

      const forA = yield* registry.materialize(undefined, undefined, { sessionID: sessionA })
      yield* forA.settle(callFor(sessionA, "call-shadowed"))
      expect(executed.at(-1)).toBe("shadow")
      const forB = yield* registry.materialize(undefined, undefined, { sessionID: sessionB })
      yield* forB.settle(callFor(sessionB, "call-unshadowed"))
      expect(executed.at(-1)).toBe("loc")
      const wide = yield* registry.materialize()
      expect(wide.definitions.map((definition) => definition.name)).toEqual(["echo"])

      yield* Scope.close(sessionScope, Exit.void)
      const restoredA = yield* registry.materialize(undefined, undefined, { sessionID: sessionA })
      const settledRestored = yield* restoredA.settle(callFor(sessionA, "call-restored"))
      expect(settledRestored.result.type).toBe("text")

      yield* Scope.close(locationScope, Exit.void)
    }),
  )

  it.effect("a mid-flight foreign-session registration does not stale the owning session (same placement predicate)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const locationScope = yield* Scope.make()
      yield* registry.register({ echo: echo("loc") }).pipe(Scope.provide(locationScope))

      const forA = yield* registry.materialize(undefined, undefined, { sessionID: sessionA })

      // Session B registers its own echo after A materialized but before A's
      // settle: A's effective winner is unchanged, so no stale error.
      const scopeB = yield* Scope.make()
      yield* registry.registerSession(sessionB, { echo: echo("b") }).pipe(Scope.provide(scopeB))

      const settled = yield* forA.settle(callFor(sessionA, "call-midflight"))
      expect(settled.result.type).toBe("text")

      yield* Scope.close(scopeB, Exit.void)
      yield* Scope.close(locationScope, Exit.void)
    }),
  )

  // C1 (ADR-19 approval condition). The production materialize callers
  // (`session/runner/llm.ts:209` and `:556`) pass no sessionID, i.e. they take
  // the Location-wide view. If settle re-derived placement from the call
  // instead of from the materialization, the calling Session's OWN registration
  // would become a newer winner than the one advertised and every call would
  // come back `Stale tool call` — a session-placed registration could silently
  // disable a built-in for that session. definitions ≡ captured settle must
  // hold for the Location-wide view too.
  it.effect("a Location-wide materialization is not perturbed by a session registration", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const locationScope = yield* Scope.make()
      yield* registry.register({ echo: echo("loc") }).pipe(Scope.provide(locationScope))

      const wide = yield* registry.materialize()
      expect(wide.definitions.map((definition) => definition.name)).toEqual(["echo"])

      const sessionScope = yield* Scope.make()
      yield* registry.registerSession(sessionA, { echo: echo("sess") }).pipe(Scope.provide(sessionScope))

      const settled = yield* wide.settle(callFor(sessionA, "call-wide"))
      expect(settled.result.type).toBe("text")
      expect(executed.at(-1)).toBe("loc")

      yield* Scope.close(sessionScope, Exit.void)
      yield* Scope.close(locationScope, Exit.void)
    }),
  )
})
