export * as McpRegistration from "./mcp-registration"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { SessionSchema } from "../session/schema"
import { RegistrationError, validateName, type AnyTool } from "./tool"
import { ToolRegistry } from "./registry"
import { Hash } from "../util/hash"

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

// Conservative provider-neutral grammar for the variable middle segment. The
// binding constraint is not this bound but MAX_TOOL_NAME below, which the
// prefix, server and tool segments share — a server name near 64 characters is
// only registrable with a very short tool name (ADR-19 §2.5).
const SERVER_NAME = /^[a-z0-9_-]{1,64}$/

/** Shared grammar so connection-time validation matches registration-time exactly. */
export const SERVER_NAME_PATTERN = SERVER_NAME

/** `Tool.validateName` bound (`tool.ts:116`); the whole prefixed name must fit. */
export const MAX_TOOL_NAME = 64

const HASH_LENGTH = 16
const PREFIX_LENGTH = "mcp_".length
const SEPARATOR_LENGTH = 2
const READABLE_BUDGET = MAX_TOOL_NAME - PREFIX_LENGTH - SEPARATOR_LENGTH - HASH_LENGTH

/**
 * Single source of the canonical `mcp_<server>_<tool>` namespace shape.
 * Short names remain byte-for-byte stable. Longer names preserve bounded
 * readable prefixes and append a deterministic digest of the complete source
 * pair, so independent reconnects cannot silently rename a catalog entry.
 */
export const canonicalToolName = (serverName: string, toolName: string) => {
  const direct = `mcp_${serverName}_${toolName}`
  if (direct.length <= MAX_TOOL_NAME) return direct
  const server = serverName.slice(0, Math.min(serverName.length, Math.floor(READABLE_BUDGET / 2)))
  const tool = toolName.slice(0, READABLE_BUDGET - server.length)
  return `mcp_${server}_${tool}_${Hash.sha256(`${serverName}\u0000${toolName}`).slice(0, HASH_LENGTH)}`
}

export type RegisterServerInput = {
  readonly serverName: string
  readonly tools: Readonly<Record<string, AnyTool>>
  /** Omit for Location placement; provide to scope the server to one Session. */
  readonly sessionID?: SessionSchema.ID
}

export interface Interface {
  readonly registerServer: (
    input: RegisterServerInput,
  ) => Effect.Effect<
    void,
    RegistrationError | InvalidServerNameError | McpNameCollisionError,
    Scope.Scope
  >
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
          const name = canonicalToolName(input.serverName, toolName)
          yield* validateName(name)
          mangled[name] = tool
        }
        // Occupancy check at this registration's own placement (ADR-19 §2.2 +
        // §2.4): a failed registration must leave the previous winner
        // untouched, so last-wins is never exercised. A sibling Session's
        // registration is invisible here and is not a conflict — otherwise two
        // child Sessions of one composition could not bind the same server.
        const taken = registry.registeredNames(input.sessionID)
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
