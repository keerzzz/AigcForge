export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@aigcfroge/llm"
import { Context, Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { runPostToolUse, runPreToolUse } from "./lifecycle-hooks"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import { definition, permission, settle, validateName, type AnyTool, type RegistrationError } from "./tool"
import { Tools } from "./tools"

// Phase 4: intent-based tool filtering rules.
// Keyed by the IntentCategory string from the meta-agent prerouter.
const INTENT_TOOL_FILTERS: Record<string, (name: string) => boolean> = {
  code_understanding: (name) => READONLY_TOOL_NAMES.has(name),
  content_creation: (name) =>
    WRITE_TOOL_NAMES.has(name) || READONLY_TOOL_NAMES.has(name) || name.startsWith("propose_"),
  configuration: (name) => CONFIG_TOOL_NAMES.has(name) || name.startsWith("propose_"),
  code_modification: () => true,
  workflow: () => true,
  mention: () => true,
}

const READONLY_TOOL_NAMES = new Set([
  "read", "read_file", "grep", "glob", "search", "list_files",
  "code_search", "tool_search", "web_fetch", "fetch",
  "todo_write", "todo_list", "complete_step",
])

const WRITE_TOOL_NAMES = new Set([
  "write", "write_file", "edit", "edit_file", "patch", "apply_patch",
  "create", "delete", "remove", "rename", "move",
  "multi_edit", "bash",
])

const CONFIG_TOOL_NAMES = new Set([
  "config", "agent", "skill", "mcp", "workflow",
])

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

export type MaterializeOptions = {
  readonly allowlist?: ReadonlyArray<string>
  /** Placement filter (ADR-19 §2.2): omit for Location-wide, or scope to one Session. */
  readonly sessionID?: SessionSchema.ID
}

export interface Interface {
  readonly materialize: (
    permissions?: PermissionV2.Ruleset,
    intent?: string,
    options?: MaterializeOptions,
  ) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
  /**
   * Registers tools visible only to one Session (ADR-19 §2.2). Same scoped
   * cleanup semantics as `register`; the owner Scope close removes exactly
   * this registration.
   */
  readonly registerSession: (
    sessionID: SessionSchema.ID,
    tools: Readonly<Record<string, AnyTool>>,
  ) => Effect.Effect<void, RegistrationError, Scope.Scope>
  /** Every occupied tool name across all placements plus application tools (ADR-19 §2.4 collision input). */
  readonly registeredNames: () => ReadonlySet<string>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool; readonly sessionId?: SessionSchema.ID }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()
    // ADR-19 §2.2: one placement predicate for both phases. Location
    // registrations (sessionId undefined) are visible to every session; a
    // session registration only to its own. Applying the same filter before
    // the fresh settle lookup keeps definitions ≡ captured settle (C1) — a
    // foreign session's shadow can neither execute nor fake staleness.
    const visibleWinner = (
      name: string,
      sessionId: SessionSchema.ID | undefined,
    ): Registration | undefined => {
      const entries = local.get(name)
      if (!entries) return undefined
      const visible = entries.filter(
        (entry) => entry.registration.sessionId === undefined || entry.registration.sessionId === sessionId,
      )
      return visible.at(-1)?.registration
    }

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration =
        visibleWinner(input.call.name, input.sessionID) ?? applications.entries().get(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      // PreToolUse: lifecycle hooks may deny the tool before execution.
      const preCheck = yield* runPreToolUse({
        toolName: input.call.name,
        args: (input.call as { input?: Record<string, unknown> }).input ?? {},
        sessionID: input.sessionID,
      })
      if (!preCheck.allow)
        return {
          result: {
            type: "error" as const,
            value: preCheck.reason ?? `Tool blocked by policy: ${input.call.name}`,
          },
        }
      const pending = yield* settle(registration.tool, input.call, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      const callInput = (input.call as { input?: Record<string, unknown> }).input ?? {}
      if ("result" in pending) {
        yield* runPostToolUse({
          toolName: input.call.name,
          args: callInput,
          result: pending.result,
          sessionID: input.sessionID,
        }).pipe(Effect.ignore)
        return pending
      }
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output })
      const result = ToolOutput.toResultValue(bounded.output)
      yield* runPostToolUse({
        toolName: input.call.name,
        args: callInput,
        result,
        sessionID: input.sessionID,
      }).pipe(Effect.ignore)
      if (result.type === "error")
        return bounded.outputPaths.length > 0 ? { result, outputPaths: bounded.outputPaths } : { result }
      return bounded.outputPaths.length > 0
        ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
        : { result, output: bounded.output }
    })

    const registerEntries = (sessionId: SessionSchema.ID | undefined) =>
      Effect.fn("ToolRegistry.register")(function* (tools: Readonly<Record<string, AnyTool>>) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool, sessionId } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      })
    const register = registerEntries(undefined)

    return Service.of({
      register,
      registerSession: (sessionID, tools) => registerEntries(sessionID)(tools),
      registeredNames: () => {
        const names = new Set<string>(applications.entries().keys())
        for (const name of local.keys()) names.add(name)
        return names
      },
      materialize: Effect.fn("ToolRegistry.materialize")(function* (
        permissions = [],
        intent?: string,
        options?: MaterializeOptions,
      ) {
        const registrations = new Map(applications.entries())
        for (const [name] of local) {
          const registration = visibleWinner(name, options?.sessionID)
          if (registration) registrations.set(name, registration)
        }
        // Phase 4: intent-based tool filtering
        const filter = intent ? INTENT_TOOL_FILTERS[intent] : undefined
        for (const [name] of registrations) {
          if (filter && !filter(name)) registrations.delete(name)
        }
        // Custom Mode snapshot tool allowlist filtering
        if (options?.allowlist) {
          const allowedSet = new Set(options.allowlist)
          for (const [name] of registrations) {
            if (!allowedSet.has(name)) registrations.delete(name)
          }
        }
        for (const [name, registration] of registrations)
          if (whollyDisabled(permission(registration.tool, name), permissions)) registrations.delete(name)
        return {
          definitions: Array.from(registrations, ([name, registration]) => definition(name, registration.tool)),
          settle: (input) => {
            const registration = registrations.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
          },
        }
      }),
    })
  }),
)

export const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) =>
    Effect.succeed(
      Tools.Service.of({ register: registry.register, registerSession: registry.registerSession }),
    ),
  ),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const defaultLayer = layer.pipe(
  Layer.provide(ApplicationTools.layer),
  Layer.provide(ToolOutputStore.defaultLayer),
)
