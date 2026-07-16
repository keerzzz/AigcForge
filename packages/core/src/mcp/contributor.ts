export * as McpContributor from "./contributor"

import { Effect } from "effect"

/**
 * MCP Server contributor interface.
 *
 * Extensions implement this to contribute MCP server configurations
 * without modifying core code.
 */
export interface IClaudeMcpServerContributor {
  /** Return MCP server configurations keyed by server name. */
  readonly getMcpServers: () => Effect.Effect<Record<string, McpServerConfig>>
}

export interface McpServerConfig {
  readonly command?: string
  readonly args?: string[]
  readonly url?: string
  readonly env?: Record<string, string>
  readonly disabled?: boolean
  readonly transport?: "stdio" | "streamable-http" | "sse"
}

const contributors = new Set<() => IClaudeMcpServerContributor>()

/**
 * Register an MCP server contributor factory.
 * Factories are called lazily when `buildMcpServersFromRegistry` runs.
 */
export const registerClaudeMcpServerContributor = (factory: () => IClaudeMcpServerContributor): void => {
  contributors.add(factory)
}

/**
 * Build the merged MCP server configuration from all registered contributors.
 */
export const buildMcpServersFromRegistry = Effect.fn("McpContributor.buildMcpServers")(function* () {
  const result: Record<string, McpServerConfig> = {}
  for (const factory of contributors) {
    const contributor = factory()
    const servers = yield* contributor.getMcpServers()
    for (const [name, config] of Object.entries(servers)) {
      // Last registered contributor wins on name collision
      result[name] = config
    }
  }
  return result
})
