import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { registerClaudeMcpServerContributor, buildMcpServersFromRegistry } from "@aigcfroge/core/mcp/contributor"

describe("MCP Contributor Registry", () => {
  test("should return empty when no contributors registered", () =>
    Effect.gen(function* () {
      const servers = yield* buildMcpServersFromRegistry()
      expect(servers).toEqual({})
    }).pipe(Effect.runPromise))

  test("should return servers from single contributor", () => {
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          "file-system": {
            command: "npx",
            args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
            transport: "stdio",
          },
        }),
    }))
    return Effect.gen(function* () {
      const servers = yield* buildMcpServersFromRegistry()
      expect(servers["file-system"]).toBeDefined()
      expect(servers["file-system"].command).toBe("npx")
      expect(servers["file-system"].transport).toBe("stdio")
    }).pipe(Effect.runPromise)
  })

  test("should merge servers from multiple contributors", () => {
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          "server-a": { command: "a", transport: "stdio" as const },
        }),
    }))
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          "server-b": { command: "b", transport: "sse" as const },
        }),
    }))
    return Effect.gen(function* () {
      const servers = yield* buildMcpServersFromRegistry()
      expect(Object.keys(servers).sort()).toEqual(["file-system", "server-a", "server-b"])
    }).pipe(Effect.runPromise)
  })

  test("later contributor wins name collision", () => {
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          overlap: { command: "v1", transport: "stdio" as const },
        }),
    }))
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          overlap: { command: "v2", transport: "sse" as const },
        }),
    }))
    return Effect.gen(function* () {
      const servers = yield* buildMcpServersFromRegistry()
      expect(servers.overlap.command).toBe("v2")
    }).pipe(Effect.runPromise)
  })

  test("should handle disabled servers", () => {
    registerClaudeMcpServerContributor(() => ({
      getMcpServers: () =>
        Effect.succeed({
          "disabled-server": { command: "bad", disabled: true },
          "enabled-server": { command: "good" },
        }),
    }))
    return Effect.gen(function* () {
      const servers = yield* buildMcpServersFromRegistry()
      expect(servers["disabled-server"].disabled).toBe(true)
      expect(servers["enabled-server"].disabled).toBeUndefined()
    }).pipe(Effect.runPromise)
  })
})
