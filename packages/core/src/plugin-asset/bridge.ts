export * as PluginBridge from "./bridge"

import { Context, Duration, Effect, Layer } from "effect"
import os from "node:os"
import path from "path"
import { FSUtil } from "../fs-util"

function getHome(): string {
  return process.env.AIGCFROGE_TEST_HOME ?? os.homedir()
}

export interface BridgeEntry {
  readonly name: string
  readonly description: string
  readonly source: "claude-code" | "codex" | "cursor" | "zcode" | "kimi-code"
  readonly category: string
  readonly originPath: string
  readonly format: string
  readonly bundled: {
    readonly commands: number
    readonly skills: number
    readonly agents: number
    readonly hooks: number
    readonly mcpServers: number
  }
}

export interface Interface {
  readonly scan: () => Effect.Effect<readonly BridgeEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PluginBridge") {}

const EMPTY_BRIDGE: readonly BridgeEntry[] = []

// ── 子扫描函数 ──

function scanClaudeCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const pattern = path.join(getHome(), ".claude", "plugins", "**", ".claude-plugin", "plugin.json")
    const files: readonly string[] = yield* fs.glob(pattern, { absolute: true, include: "file" }).pipe(
      Effect.catch(() => Effect.succeed([] as readonly string[])),
    )
    const results: Effect.Effect<readonly BridgeEntry[]>[] = []
    for (const file of files) {
      results.push(
        Effect.gen(function* () {
          const raw: Uint8Array | undefined = yield* fs.readFile(file).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!raw) return [] as readonly BridgeEntry[]
          const text = new TextDecoder().decode(raw)
          const parsed: Record<string, unknown> = JSON.parse(text)
          const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
          const description = typeof parsed.description === "string" ? parsed.description.trim() : ""
          if (!name) return [] as readonly BridgeEntry[]
          const pluginDir = path.dirname(path.dirname(file))
          const bundled = yield* countBundled(fs, pluginDir)
          return [{ name, description, source: "claude-code" as const, category: "", originPath: file, format: "claude-plugin-v1", bundled }]
        }).pipe(Effect.catch(() => Effect.succeed([] as readonly BridgeEntry[]))),
      )
    }
    const nested: readonly (readonly BridgeEntry[])[] = yield* Effect.all(results)
    return nested.flat()
  })
}

function scanCodexSkills(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const cachePath = path.join(getHome(), ".codex", "vendor_imports", "skills-curated-cache.json")
    const raw: Uint8Array | undefined = yield* fs.readFile(cachePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!raw) return EMPTY_BRIDGE
    const text = new TextDecoder().decode(raw)
    const data: Record<string, unknown> = JSON.parse(text)
    const skills: readonly Record<string, unknown>[] = Array.isArray(data.skills) ? data.skills.filter((s: unknown): s is Record<string, unknown> => typeof s === "object" && s !== null) : []
    return skills
      .filter((s): s is Record<string, unknown> & { id: string } => typeof s.id === "string" && s.id.length > 0)
      .map((s) => ({
        name: s.id,
        description: typeof s.description === "string" ? s.description : "",
        source: "codex" as const,
        category: "",
        originPath: cachePath,
        format: "codex-skill-v1",
        bundled: { commands: 0, skills: 1, agents: 0, hooks: 0, mcpServers: 0 },
      }))
  })
}

function scanCodexMCPServers(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(getHome(), ".codex", "config.toml")
    const raw: Uint8Array | undefined = yield* fs.readFile(configPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!raw) return EMPTY_BRIDGE
    const text = new TextDecoder().decode(raw)
    const matches = text.matchAll(/^\[mcp_servers\.(\w+)\]\s*$/gm)
    const entries: BridgeEntry[] = []
    for (const m of matches) {
      entries.push({
        name: m[1],
        description: `MCP server from Codex config: ${m[1]}`,
        source: "codex" as const,
        category: "",
        originPath: configPath,
        format: "codex-mcp-v1",
        bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 1 },
      })
    }
    return entries
  })
}

function scanCursorPlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const pattern = path.join(getHome(), ".cursor", "plugins", "local", "**", "package.json")
    const files: readonly string[] = yield* fs.glob(pattern, { absolute: true, include: "file" }).pipe(
      Effect.catch(() => Effect.succeed([] as readonly string[])),
    )
    const results: Effect.Effect<readonly BridgeEntry[]>[] = []
    for (const file of files) {
      results.push(
        Effect.gen(function* () {
          const raw: Uint8Array | undefined = yield* fs.readFile(file).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!raw) return [] as readonly BridgeEntry[]
          const text = new TextDecoder().decode(raw)
          const pkg: Record<string, unknown> = JSON.parse(text)
          const name = typeof pkg.name === "string" ? pkg.name.trim() : ""
          if (!name) return [] as readonly BridgeEntry[]
          const description = typeof pkg.description === "string" ? pkg.description : ""
          return [{ name, description, source: "cursor" as const, category: "", originPath: file, format: "cursor-ext-v1", bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 0 } }]
        }).pipe(Effect.catch(() => Effect.succeed([] as readonly BridgeEntry[]))),
      )
    }
    const nested: readonly (readonly BridgeEntry[])[] = yield* Effect.all(results)
    return nested.flat()
  })
}

function scanZCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(getHome(), ".zcode", "v2", "config.json")
    const raw: Uint8Array | undefined = yield* fs.readFile(configPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!raw) return EMPTY_BRIDGE
    const text = new TextDecoder().decode(raw)
    const data: Record<string, unknown> = JSON.parse(text)
    const count = Object.keys(data).length > 0 ? 1 : 0
    return count > 0
      ? [{ name: "zcode-configurations", description: "ZCode v2 configurations and model cache", source: "zcode" as const, category: "", originPath: configPath, format: "zcode-config-v1", bundled: { commands: 0, skills: 0, agents: count, hooks: 0, mcpServers: 0 } }]
      : EMPTY_BRIDGE
  })
}

function scanKimiCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(getHome(), ".kimi-code", "config.toml")
    const raw: Uint8Array | undefined = yield* fs.readFile(configPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!raw) return EMPTY_BRIDGE
    const text = new TextDecoder().decode(raw)
    const matches = text.matchAll(/^\[models\."kimi-code\/(\S+)"\]/gm)
    const entries: BridgeEntry[] = []
    for (const m of matches) {
      entries.push({
        name: m[1],
        description: `Kimi Code model: ${m[1]}`,
        source: "kimi-code" as const,
        category: "",
        originPath: configPath,
        format: "kimi-config-v1",
        bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 0 },
      })
    }
    return entries
  })
}

// ── bundled 计数器 ──

function countBundled(fs: FSUtil.Interface, pluginDir: string): Effect.Effect<BridgeEntry["bundled"]> {
  return Effect.gen(function* () {
    const cmds: readonly string[] = yield* fs.glob(path.join(pluginDir, "commands", "*.md"), { include: "file" }).pipe(Effect.catch(() => Effect.succeed([])))
    const skills: readonly string[] = yield* fs.glob(path.join(pluginDir, "skills", "**", "SKILL.md"), { include: "file" }).pipe(Effect.catch(() => Effect.succeed([])))
    const agents: readonly string[] = yield* fs.glob(path.join(pluginDir, "agents", "*.md"), { include: "file" }).pipe(Effect.catch(() => Effect.succeed([])))
    const hooksFiles: readonly string[] = yield* fs.glob(path.join(pluginDir, "hooks", "hooks.json"), { include: "file" }).pipe(Effect.catch(() => Effect.succeed([])))
    const mcpRaw: Uint8Array | undefined = yield* fs.readFile(path.join(pluginDir, ".mcp.json")).pipe(Effect.catch(() => Effect.succeed(undefined)))
    return {
      commands: cmds.length,
      skills: skills.length,
      agents: agents.length,
      hooks: hooksFiles.length > 0 ? 1 : 0,
      mcpServers: mcpRaw ? 1 : 0,
    }
  })
}

// ── 主扫描入口（30s TTL 缓存）──

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const scanRaw: Effect.Effect<readonly BridgeEntry[]> = Effect.gen(function* () {
      const results: readonly (readonly BridgeEntry[])[] = yield* Effect.all(
        [
          scanClaudeCodePlugins(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
          scanCodexSkills(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
          scanCodexMCPServers(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
          scanCursorPlugins(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
          scanZCodePlugins(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
          scanKimiCodePlugins(fs).pipe(Effect.catch(() => Effect.succeed(EMPTY_BRIDGE))),
        ],
        { concurrency: "unbounded" },
      )
      return results.flat()
    })

    const scanCached = yield* Effect.cachedWithTTL(scanRaw, Duration.seconds(30))

    const scan = Effect.fn("PluginBridge.scan")(function* () {
      return yield* scanCached
    })

    return Service.of({ scan })
  }),
)
