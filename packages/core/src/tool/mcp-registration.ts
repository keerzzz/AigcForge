export * as McpRegistration from "./mcp-registration.js"

import type { Info } from "@omnixa/schema/tool"
import { Effect, Schema, Scope } from "effect"
import { Hash } from "@omnixa/util/hash"
import { Tool } from "../tool.js"

/**
 * Owner for canonical MCP tool registration: namespaces every external tool
 * under `mcp_<server>_<tool>`, validates the server name, and fails closed on
 * any name collision so an external server can never shadow built-ins through
 * the tool service's generic last-wins mechanism.
 */
export class InvalidServerNameError extends Schema.TaggedError<InvalidServerNameError>()(
  "McpRegistration.InvalidServerNameError",
  { serverName: Schema.String },
) {
  override get message() {
    return `Invalid MCP server name: ${JSON.stringify(this.serverName)} (expected [a-z0-9_-]{1,64})`
  }
}

export class McpNameCollisionError extends Schema.TaggedError<McpNameCollisionError>()(
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
// only registrable with a very short tool name.
const SERVER_NAME = /^[a-z0-9_-]{1,64}$/

/** Shared grammar so connection-time validation matches registration-time exactly. */
export const SERVER_NAME_PATTERN = SERVER_NAME

/** Provider-neutral tool name ceiling; the whole prefixed name must fit. */
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
  readonly tools: Readonly<Record<string, Info>>
}

const nameError = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? undefined
    : new Tool.RegistrationError({ name, message: `Invalid tool name: ${name}` })

/**
 * Register one server's tools under their canonical names on the caller's
 * Scope. All-or-nothing: every prefixed name is validated and checked against
 * the currently registered catalog before anything is added, so a failed
 * registration leaves the previous catalog untouched instead of exercising
 * last-wins.
 */
export const registerServer = (
  tools: Tool.Interface,
  input: RegisterServerInput,
): Effect.Effect<void, InvalidServerNameError | McpNameCollisionError | Tool.RegistrationError, Scope.Scope> =>
  Effect.gen(function* () {
    if (!SERVER_NAME.test(input.serverName)) {
      yield* new InvalidServerNameError({ serverName: input.serverName })
      return
    }
    const mangled: Array<[string, Info]> = []
    for (const [toolName, tool] of Object.entries(input.tools)) {
      const name = canonicalToolName(input.serverName, toolName)
      const error = nameError(name)
      if (error !== undefined) {
        yield* error
        return
      }
      mangled.push([name, { ...tool, name }])
    }
    const occupied = new Set((yield* tools.list()).map((tool) => tool.id))
    for (const [name] of mangled) {
      if (occupied.has(name)) {
        yield* new McpNameCollisionError({ serverName: input.serverName, name })
        return
      }
    }
    yield* tools.transform((editor) => {
      for (const [name, tool] of mangled) editor.add({ ...tool, name })
    })
  })
