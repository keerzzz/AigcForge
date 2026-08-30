import { Effect } from "effect"
import { registerClaudeMcpServerContributor, type McpServerConfig } from "@aigcfroge/core/mcp/contributor"

/**
 * IdeMcpServerContributor — exposes IDE simulated diagnostics as an MCP tool.
 *
 * This is an example contributor demonstrating how to extend MCP capabilities
 * without modifying core code.
 */
export const IdeMcpServerContributor = {
  getMcpServers: (): Effect.Effect<Record<string, McpServerConfig>> =>
    Effect.succeed({
      ide: {
        command: "aigcfroge",
        args: ["--mcp-tools", "getDiagnostics"],
        transport: "stdio",
        env: {
          AIGCFROGE_MCP_ENABLED: "1",
        },
      },
    }),
}

// Register on module load
registerClaudeMcpServerContributor(() => IdeMcpServerContributor)
