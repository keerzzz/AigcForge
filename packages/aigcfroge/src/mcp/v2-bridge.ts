export * as McpV2Bridge from "./v2-bridge"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { CallToolResultSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Layer, Option } from "effect"
import { McpV2 } from "@aigcfroge/core/mcp/mcp-v2"
import { buildMcpServersFromRegistry } from "@aigcfroge/core/mcp/contributor"
import { Config as ConfigV2 } from "@aigcfroge/core/config"
import { InstallationVersion } from "@aigcfroge/core/installation/version"
import { McpAuthV2 } from "./v2-auth"
import { McpOAuthProvider, type McpOAuthConfig } from "./v2-oauth-provider"
import * as McpOAuthCallback from "./v2-oauth-callback"
// Import MCP contributors to trigger side-effect registration
import "./contributors/ide"

const DEFAULT_TIMEOUT = 30_000

function createMcpClient() {
  return new Client(
    { name: "aigcfroge", version: InstallationVersion },
    { capabilities: { roots: {} } },
  )
}

export const layer = Layer.effect(
  McpV2.Service,
  Effect.gen(function* () {
    const config = yield* ConfigV2.Service
    const auth = yield* McpAuthV2.Service
    const servers = new Map<string, { client: any; defs: readonly MCPToolDef[] }>()

    const start = Effect.fn("McpV2.start")(function* () {
      const entries = yield* config.entries()
      let mergedMcp: { servers?: Record<string, any> } | undefined
      for (const entry of entries) {
        if (entry.type === "document") {
          const info = entry.info as any
          if (info.mcp) mergedMcp = info.mcp
        }
      }
      if (!mergedMcp?.servers) return

      // Merge contributor-provided servers as defaults (config overrides contributors)
      const contributorServers = yield* buildMcpServersFromRegistry()
      const allServers = { ...contributorServers, ...mergedMcp.servers }

      for (const [name, raw] of Object.entries(allServers)) {
        const cfg = raw
        if (cfg.disabled) continue
        const timeout = cfg.timeout ?? DEFAULT_TIMEOUT

        const result = yield* Effect.promise<{ client: any; defs: MCPToolDef[] } | undefined>(async () => {
          try {
            let client: any
            if (cfg.type === "local" || cfg.command) {
              const [cmd, ...args] = cfg.command ?? []
              const transport = new StdioClientTransport({
                command: cmd, args, cwd: cfg.cwd,
                env: { ...process.env, ...(cmd === "aigcfroge" ? { BUN_BE_BUN: "1" } : {}), ...cfg.environment },
              })
              client = createMcpClient()
              await client.connect(transport)
            } else if (cfg.type === "remote" && cfg.url) {
              const url = new URL(cfg.url)
              // Build OAuth provider if the config has OAuth enabled
              const oauthConfig: McpOAuthConfig | undefined = cfg.oauth && typeof cfg.oauth === "object"
                ? { clientId: cfg.oauth.clientId, clientSecret: cfg.oauth.clientSecret, scope: cfg.oauth.scope, callbackPort: cfg.oauth.callbackPort, redirectUri: cfg.oauth.redirectUri }
                : cfg.oauth === false ? undefined : undefined
              const oauthProvider = oauthConfig
                ? new McpOAuthProvider(name, cfg.url.toString(), oauthConfig, {
                    onRedirect: async (authUrl) => {
                      await McpOAuthCallback.ensureRunning(oauthConfig.redirectUri)
                      const urlStr = typeof authUrl === "string" ? authUrl : authUrl.toString()
                      console.log(`Open browser to: ${urlStr}`)
                      try {
                        const mod = await import("open")
                        mod.default(urlStr).catch(() => {})
                      } catch { /* open not available */ }
                    },
                  }, auth)
                : undefined

              for (const makeTransport of [
                () => new StreamableHTTPClientTransport(url, {
                  ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
                  ...(oauthProvider ? { authProvider: oauthProvider } : {}),
                }),
                () => new SSEClientTransport(url, {
                  ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
                  ...(oauthProvider ? { authProvider: oauthProvider } : {}),
                }),
              ]) {
                try {
                  const transport = makeTransport()
                  client = createMcpClient()
                  await client.connect(transport)
                  break
                } catch { continue }
              }
            }
            if (!client) return undefined

            let defs: MCPToolDef[] = []
            if (client.getServerCapabilities?.()?.tools) {
              const result = await client.listTools({}, { timeout })
              defs = (result.tools ?? []) as MCPToolDef[]
            }
            return { client, defs }
          } catch (e) {
            console.warn(`MCP server "${name}" failed:`, e)
            return undefined
          }
        })
        if (result) servers.set(name, result)
      }
    })

    const stop = Effect.fn("McpV2.stop")(function* () {
      for (const [, s] of servers) {
        if (s.client) yield* Effect.promise(() => s.client.close()).pipe(Effect.ignore)
      }
      servers.clear()
    })

    const tools = Effect.fn("McpV2.tools")(function* () {
      const result: McpV2.McpToolDef[] = []
      for (const [, s] of servers) {
        for (const t of s.defs) {
          result.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
        }
      }
      return result
    })

    const callTool = Effect.fn("McpV2.callTool")(function* (input: { name: string; args: Record<string, unknown> }) {
      for (const [, s] of servers) {
        if (!s.client) continue
        const matched = s.defs.find((t) => t.name === input.name)
        if (!matched) continue
        return yield* Effect.promise(async () => {
          return await s.client.callTool({ name: input.name, arguments: input.args }, CallToolResultSchema)
        })
      }
      return yield* Effect.die(new Error(`MCP tool not found: ${input.name}`))
    })

    return McpV2.Service.of({ start, stop, tools, callTool })
  }),
)

/**
 * Global-safe MCP layer: builds McpV2Bridge when a Location context is
 * available (session scope), falls back to noop at app-wide level.
 */
export const globalLayer = Layer.unwrap(
  Effect.gen(function* () {
    const configOpt = yield* Effect.serviceOption(ConfigV2.Service)
    if (Option.isSome(configOpt)) return layer
    return McpV2.noopLayer
  }),
)
