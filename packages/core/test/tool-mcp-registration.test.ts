import { describe, expect } from "bun:test"
import { Cause, Exit, Effect, Layer, Scope, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionV2 } from "@aigcfroge/core/session"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { McpRegistration } from "@aigcfroge/core/tool/mcp-registration"
import { Tool } from "@aigcfroge/core/tool/tool"
import { testEffect } from "./lib/effect"

// ADR-19 §2.4/§2.5: MCP producers register through a dedicated owner that
// namespaces every tool under `mcp_<server>_<tool>` and fails closed on any
// name collision — external servers must never shadow built-ins via the
// generic last-wins mechanism.

const permission = Layer.mock(PermissionV2.Service, { assert: () => Effect.void })
const mcpLayer = McpRegistration.layer.pipe(
  Layer.provide(permission),
  Layer.provideMerge(ApplicationTools.layer),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const it = testEffect(mcpLayer)

const echo = () =>
  Tool.make({
    description: "echo",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })
describe("McpRegistration namespace and collision (ADR-19 §2.4/§2.5)", () => {
  it.effect("names every tool under mcp_<server>_<tool> and the prefixed set settles", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp.registerServer({ serverName: "context7", tools: { read: echo(), grep: echo() } }).pipe(
        Scope.provide(scope),
      )

      const view = yield* ToolRegistry.Service
      const materialized = yield* view.materialize(undefined, undefined, { allowlist: ["mcp_context7_read"] })
      expect(materialized.definitions.map((definition) => definition.name)).toEqual(["mcp_context7_read"])

      const settled = yield* materialized.settle({
        sessionID: SessionV2.ID.make("ses_mcp_ns"),
        agent: AgentV2.ID.make("build"),
        assistantMessageID: SessionMessage.ID.make("msg_mcp_ns"),
        call: { type: "tool-call" as const, id: "call-ns", name: "mcp_context7_read", input: { text: "hi" } },
      })
      expect(settled.result.type).toBe("text")

      yield* Scope.close(scope, Exit.void)
      const afterClose = yield* view.materialize(undefined, undefined, { allowlist: ["mcp_context7_read"] })
      expect(afterClose.definitions).toEqual([])
    }),
  )

  it.effect("rejects server names outside the conservative grammar", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      const exit = yield* mcp
        .registerServer({ serverName: "Bad Server!", tools: { read: echo() } })
        .pipe(Scope.provide(scope), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof McpRegistration.InvalidServerNameError).toBe(true)
      }
      expect((yield* ToolRegistry.Service).materialize).toBeDefined()
      expect(yield* (yield* ToolRegistry.Service).materialize()).toMatchObject({ definitions: [] })
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("fails closed when a prefixed name collides with an application tool", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const appScope = yield* Scope.make()
      yield* applications.register({ mcp_ctx_echo: echo() }).pipe(Scope.provide(appScope))

      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      const exit = yield* mcp
        .registerServer({ serverName: "ctx", tools: { echo: echo() } })
        .pipe(Scope.provide(scope), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof McpRegistration.McpNameCollisionError).toBe(true)
      }

      yield* Scope.close(appScope, Exit.void)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("fails closed when a Location registration would shadow a session-placed server (no silent last-wins)", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const sessionID = SessionV2.ID.make("ses_mcp_cross")
      const firstScope = yield* Scope.make()
      yield* mcp.registerServer({ serverName: "dup", sessionID, tools: { echo: echo() } }).pipe(
        Scope.provide(firstScope),
      )

      // A Location registration is visible to every session, so it would become
      // the newer winner for this session too — that is a real conflict.
      const secondScope = yield* Scope.make()
      const exit = yield* mcp
        .registerServer({ serverName: "dup", tools: { echo: echo() } })
        .pipe(Scope.provide(secondScope), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof McpRegistration.McpNameCollisionError).toBe(true)
      }

      // The first registration is untouched by the failed one.
      const view = yield* ToolRegistry.Service
      const materialized = yield* view.materialize(undefined, undefined, { sessionID })
      expect(materialized.definitions.map((definition) => definition.name)).toEqual(["mcp_dup_echo"])

      yield* Scope.close(firstScope, Exit.void)
      yield* Scope.close(secondScope, Exit.void)
    }),
  )

  // ADR-19 §2.2: two child Sessions of one composition binding the same server
  // is the ordinary multi-agent shape, not a conflict — a sibling's
  // registration is invisible at this placement, so the collision input
  // (§2.4) must be evaluated at the registering placement.
  it.effect("lets sibling sessions bind the same server independently", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const a = SessionV2.ID.make("ses_mcp_sib_a")
      const b = SessionV2.ID.make("ses_mcp_sib_b")
      const scopeA = yield* Scope.make()
      const scopeB = yield* Scope.make()
      yield* mcp.registerServer({ serverName: "github", sessionID: a, tools: { search: echo() } }).pipe(
        Scope.provide(scopeA),
      )
      yield* mcp.registerServer({ serverName: "github", sessionID: b, tools: { search: echo() } }).pipe(
        Scope.provide(scopeB),
      )

      const view = yield* ToolRegistry.Service
      for (const sessionID of [a, b]) {
        const materialized = yield* view.materialize(undefined, undefined, { sessionID })
        expect(materialized.definitions.map((definition) => definition.name)).toEqual(["mcp_github_search"])
      }
      // Still isolated: closing A leaves B serving its own registration.
      yield* Scope.close(scopeA, Exit.void)
      const afterA = yield* view.materialize(undefined, undefined, { sessionID: a })
      expect(afterA.definitions).toEqual([])
      const stillB = yield* view.materialize(undefined, undefined, { sessionID: b })
      expect(stillB.definitions.map((definition) => definition.name)).toEqual(["mcp_github_search"])
      yield* Scope.close(scopeB, Exit.void)
    }),
  )

  it.effect("fails closed with the shared name budget when the prefixed name overflows", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      // Realistic server + tool names: the prefixed name is 66 characters, so
      // the 64-character bound the two segments share rejects it.
      const exit = yield* mcp
        .registerServer({
          serverName: "azure-devops-work-items",
          tools: { list_work_item_comments_with_expansion: echo() },
        })
        .pipe(Scope.provide(scope), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(McpRegistration.McpToolNameTooLongError)
        // The message must name the budget: the operator controls neither
        // segment's length once a server is chosen.
        if (error instanceof McpRegistration.McpToolNameTooLongError) {
          expect(error.message).toContain("limit 64")
        }
      }
      expect(yield* (yield* ToolRegistry.Service).materialize()).toMatchObject({ definitions: [] })
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("rejects tools whose prefixed name cannot satisfy the provider-neutral grammar", () =>
    Effect.gen(function* () {
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      const exit = yield* mcp
        .registerServer({ serverName: "ok", tools: { "bad name": echo() } })
        .pipe(Scope.provide(scope), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      // Nothing was registered: all-or-nothing per server.
      expect(yield* (yield* ToolRegistry.Service).materialize()).toMatchObject({ definitions: [] })
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
