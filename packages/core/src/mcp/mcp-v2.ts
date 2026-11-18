export * as McpV2 from "./mcp-v2"

import { Context, Effect, Layer } from "effect"

/** A discovered MCP tool definition, ready for registration. */
export interface McpToolDef {
  readonly name: string
  readonly description?: string
  readonly inputSchema: unknown
}

/** Minimal MCP V2 service — manages server connections and exposes tools. */
export interface Interface {
  /** Start all configured MCP servers and register their tools. */
  readonly start: () => Effect.Effect<void>
  /** Stop all MCP servers and unregister their tools. */
  readonly stop: () => Effect.Effect<void>
  /** List discovered tool definitions. */
  readonly tools: () => Effect.Effect<McpToolDef[]>
  /** Execute a tool call. */
  readonly callTool: (input: { name: string; args: Record<string, unknown> }) => Effect.Effect<unknown>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Mcp") {}

/** No-op layer for when MCP is not configured. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    start: () => Effect.void,
    stop: () => Effect.void,
    tools: () => Effect.succeed([]),
    callTool: () => Effect.succeed(undefined),
  }),
)
