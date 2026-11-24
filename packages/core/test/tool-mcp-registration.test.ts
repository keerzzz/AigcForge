import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { Agent } from "@omnixa/core/agent"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Image } from "@omnixa/core/image"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { Session } from "@omnixa/core/session"
import { SessionMessage } from "@omnixa/core/session/message"
import { Tool } from "@omnixa/core/tool"
import { McpRegistration } from "@omnixa/core/tool/mcp-registration"
import type { Info } from "@omnixa/schema/tool"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"

// MCP producers register through a dedicated owner that namespaces every tool
// under `mcp_<server>_<tool>` and fails closed on any name collision —
// external servers must never shadow built-ins through the tool service's
// generic last-wins mechanism.

const imageStore = Layer.mock(Image.Service, {
  normalize: (_resource, content) => Effect.succeed(content),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [
  Image.node.replace(imageStore),
])
const it = testEffect(registryLayer)

/**
 * `_tag` is the string that crosses the wire and the event log, so a rename
 * passes an `instanceof` check. Throws instead of skipping on a wrong class so
 * the failure names the culprit.
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

const echo = (): Info => ({
  name: "echo",
  description: "echo",
  options: { codemode: false },
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ text: Schema.String }),
  execute: ({ text }) => Effect.succeed({ output: { text }, content: text }),
})

const registeredNames = (tools: Tool.Interface) =>
  tools.list().pipe(Effect.map((list) => list.map((tool) => tool.id).toSorted()))

describe("McpRegistration namespace and collision", () => {
  it.effect("names every tool under mcp_<server>_<tool>, settles, and unregisters on scope close", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const scope = yield* Scope.make()
      yield* McpRegistration.registerServer(tools, {
        serverName: "context7",
        tools: { read: echo(), grep: echo() },
      }).pipe(Scope.provide(scope))

      expect(yield* registeredNames(tools)).toEqual(["mcp_context7_grep", "mcp_context7_read"])

      const snapshot = yield* tools.snapshot()
      expect(
        snapshot.definitions
          .map((definition) => definition.name)
          .filter((name) => name.startsWith("mcp_"))
          .toSorted(),
      ).toEqual(["mcp_context7_grep", "mcp_context7_read"])
      const settled = yield* snapshot.execute({
        sessionID: Session.ID.make("ses_mcp_ns"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_mcp_ns"),
        call: { type: "tool-call", id: "call-ns", name: "mcp_context7_read", input: { text: "hi" } },
      })
      expect(settled.output).toEqual({ text: "hi" })

      yield* Scope.close(scope, Exit.void)
      expect(yield* registeredNames(tools)).toEqual([])
    }),
  )

  it.effect("rejects server names outside the conservative grammar", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const scope = yield* Scope.make()
      const exit = yield* McpRegistration.registerServer(tools, {
        serverName: "Bad Server!",
        tools: { read: echo() },
      }).pipe(Scope.provide(scope), Effect.exit)
      expectInvalidServerName(exit, "Bad Server!")
      expect(yield* registeredNames(tools)).toEqual([])
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("fails closed when a prefixed name collides with an existing registration", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const appScope = yield* Scope.make()
      yield* tools.transform((editor) => editor.add({ ...echo(), name: "mcp_ctx_echo" })).pipe(Scope.provide(appScope))

      const scope = yield* Scope.make()
      const exit = yield* McpRegistration.registerServer(tools, { serverName: "ctx", tools: { echo: echo() } }).pipe(
        Scope.provide(scope),
        Effect.exit,
      )
      expectCollision(exit, "mcp_ctx_echo")

      // The failed registration leaves the existing winner untouched.
      expect(yield* registeredNames(tools)).toEqual(["mcp_ctx_echo"])
      yield* Scope.close(appScope, Exit.void)
      yield* Scope.close(scope, Exit.void)
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

      const tools = yield* Tool.Service
      const scope = yield* Scope.make()
      yield* McpRegistration.registerServer(tools, {
        serverName: longServer,
        tools: { [firstTool]: echo(), [secondTool]: echo() },
      }).pipe(Scope.provide(scope))
      expect(yield* registeredNames(tools)).toEqual([first, second].toSorted())
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("rejects tools whose prefixed name cannot satisfy the provider-neutral grammar", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const scope = yield* Scope.make()
      const exit = yield* McpRegistration.registerServer(tools, {
        serverName: "ok",
        tools: { "bad name": echo() },
      }).pipe(Scope.provide(scope), Effect.exit)
      expectRegistrationError(exit, "mcp_ok_bad name")
      // Nothing was registered: all-or-nothing per server.
      expect(yield* registeredNames(tools)).toEqual([])
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
