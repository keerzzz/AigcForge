import { describe, expect } from "bun:test"
import { Cause, Exit, Effect, Layer, Option, Scope, Schema } from "effect"
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

/**
 * `expect(x instanceof T).toBe(true)` was the pattern here, and one site had
 * only `Exit.isFailure`. Neither pins what callers actually key on: `_tag` is
 * the string that crosses the wire and the event log, so a rename passes an
 * `instanceof` check, and `Exit.isFailure` cannot tell a typed refusal from a
 * defect. The identifying fields went unasserted too, which is what
 * distinguishes "collided on this name" from "collided on some name".
 *
 * Throws instead of skipping on a wrong class so the failure names the culprit.
 */
const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error("expected a typed failure, got a success")
  return Option.getOrThrow(Cause.findErrorOption(exit.cause))
}

const describeError = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : String(error)

const expectCollision = (exit: Exit.Exit<unknown, unknown>, name: string) => {
  const error = failureOf(exit)
  if (!(error instanceof McpRegistration.McpNameCollisionError))
    throw new Error(`expected McpNameCollisionError, got ${describeError(error)}`)
  expect(error._tag).toBe("McpRegistration.McpNameCollisionError")
  expect(error.name).toBe(name)
}

const expectInvalidServerName = (exit: Exit.Exit<unknown, unknown>, serverName: string) => {
  const error = failureOf(exit)
  if (!(error instanceof McpRegistration.InvalidServerNameError))
    throw new Error(`expected InvalidServerNameError, got ${describeError(error)}`)
  expect(error._tag).toBe("McpRegistration.InvalidServerNameError")
  expect(error.serverName).toBe(serverName)
}

const expectRegistrationError = (exit: Exit.Exit<unknown, unknown>, name: string) => {
  const error = failureOf(exit)
  if (!(error instanceof Tool.RegistrationError))
    throw new Error(`expected Tool.RegistrationError, got ${describeError(error)}`)
  expect(error._tag).toBe("Tool.RegistrationError")
  expect(error.name).toBe(name)
}

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
      yield* mcp
        .registerServer({ serverName: "context7", tools: { read: echo(), grep: echo() } })
        .pipe(Scope.provide(scope))

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
      expectInvalidServerName(exit, "Bad Server!")
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
      expectCollision(exit, "mcp_ctx_echo")

      yield* Scope.close(appScope, Exit.void)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect(
    "fails closed when a Location registration would shadow a session-placed server (no silent last-wins)",
    () =>
      Effect.gen(function* () {
        const mcp = yield* McpRegistration.Service
        const sessionID = SessionV2.ID.make("ses_mcp_cross")
        const firstScope = yield* Scope.make()
        yield* mcp
          .registerServer({ serverName: "dup", sessionID, tools: { echo: echo() } })
          .pipe(Scope.provide(firstScope))

        // A Location registration is visible to every session, so it would become
        // the newer winner for this session too — that is a real conflict.
        const secondScope = yield* Scope.make()
        const exit = yield* mcp
          .registerServer({ serverName: "dup", tools: { echo: echo() } })
          .pipe(Scope.provide(secondScope), Effect.exit)
        expectCollision(exit, "mcp_dup_echo")

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
      yield* mcp
        .registerServer({ serverName: "github", sessionID: a, tools: { search: echo() } })
        .pipe(Scope.provide(scopeA))
      yield* mcp
        .registerServer({ serverName: "github", sessionID: b, tools: { search: echo() } })
        .pipe(Scope.provide(scopeB))

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

  it.effect("keeps short canonical names stable and deterministically compacts long catalog identities", () =>
    Effect.gen(function* () {
      const longServer = "azure-devops-work-items"
      const firstTool = "list_work_item_comments_with_expansion"
      const secondTool = "list_work_item_comments_with_expansions"
      const first = McpRegistration.canonicalToolName(longServer, firstTool)
      const second = McpRegistration.canonicalToolName(longServer, secondTool)

      expect(McpRegistration.canonicalToolName("github", "search")).toBe("mcp_github_search")
      expect(first).toHaveLength(McpRegistration.MAX_TOOL_NAME)
      expect(first).toStartWith("mcp_azure-devops-work-ite_list_work_item_commen_")
      expect(first).not.toBe(second)

      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({ serverName: longServer, tools: { [firstTool]: echo(), [secondTool]: echo() } })
        .pipe(Scope.provide(scope))
      const definitions = (yield* (yield* ToolRegistry.Service).materialize()).definitions
      expect(definitions.map((definition) => definition.name).toSorted()).toEqual([first, second].toSorted())
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
      expectRegistrationError(exit, "mcp_ok_bad name")
      // Nothing was registered: all-or-nothing per server.
      expect(yield* (yield* ToolRegistry.Service).materialize()).toMatchObject({ definitions: [] })
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
