export * as McpRegistration from "./mcp-registration"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { SessionSchema } from "../session/schema"
import { RegistrationError, validateName, type AnyTool } from "./tool"
import { ToolRegistry } from "./registry"

/**
 * Owner for canonical MCP tool registration (ADR-19 §2.4/§2.5): namespaces
 * every external tool under `mcp_<server>_<tool>`, validates the server name,
 * and fails closed on any name collision so an external server can never
 * shadow built-ins through the generic last-wins mechanism.
 */
export class InvalidServerNameError extends Schema.TaggedErrorClass<InvalidServerNameError>()(
  "McpRegistration.InvalidServerNameError",
  { serverName: Schema.String },
) {
  override get message() {
    return `Invalid MCP server name: ${JSON.stringify(this.serverName)} (expected [a-z0-9_-]{1,64})`
  }
}

export class McpNameCollisionError extends Schema.TaggedErrorClass<McpNameCollisionError>()(
  "McpRegistration.McpNameCollisionError",
  { serverName: Schema.String, name: Schema.String },
) {
  override get message() {
    return `MCP tool name collision: '${this.name}' (server '${this.serverName}') is already registered`
  }
}

// Conservative provider-neutral grammar; the final prefixed name must also
// pass Tool.validateName, so this guards the variable middle segment only.
const SERVER_NAME = /^[a-z0-9_-]{1,64}$/

export type RegisterServerInput = {
  readonly serverName: string
  readonly tools: Readonly<Record<string, AnyTool>>
  /** Omit for Location placement; provide to scope the server to one Session. */
  readonly sessionID?: SessionSchema.ID
}

export interface Interface {
  readonly registerServer: (
    input: RegisterServerInput,
  ) => Effect.Effect<void, RegistrationError | InvalidServerNameError | McpNameCollisionError, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/McpRegistration") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    return Service.of({
      registerServer: Effect.fn("McpRegistration.registerServer")(function* (input: RegisterServerInput) {
        if (!SERVER_NAME.test(input.serverName)) {
          yield* new InvalidServerNameError({ serverName: input.serverName })
          return
        }
        // All-or-nothing: validate every prefixed name before touching state.
        const mangled: Record<string, AnyTool> = {}
        for (const [toolName, tool] of Object.entries(input.tools)) {
          const name = `mcp_${input.serverName}_${toolName}`
          yield* validateName(name)
          mangled[name] = tool
        }
        // Cross-placement occupancy check: a failed registration must leave
        // the previous winner untouched, so last-wins is never exercised.
        const taken = registry.registeredNames()
        for (const name of Object.keys(mangled)) {
          if (taken.has(name)) {
            yield* new McpNameCollisionError({ serverName: input.serverName, name })
            return
          }
        }
        if (input.sessionID !== undefined) yield* registry.registerSession(input.sessionID, mangled)
        else yield* registry.register(mangled)
      }),
    })
  }),
).pipe(Layer.provideMerge(ToolRegistry.layer))
