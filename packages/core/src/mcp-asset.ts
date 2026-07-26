export * as MCPAsset from "./mcp-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { MCPAsset as SchemaMCPAsset } from "@aigcfroge/schema/mcp-asset"
import { AssetMigration } from "./asset-migration"
import { Config } from "./config"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { MCPAssetPath } from "./mcp-asset/path"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { MCPS_DIR } from "./constants"

export { MCPS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCPAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "mcp"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Record<string, string>
  readonly configJson: string
  readonly revision: string
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: "parse_error" | "bad_frontmatter" | "name_conflict"
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly listSystem: () => Effect.Effect<ReadonlyArray<Info>>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, NotFoundError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined>
  readonly listInvalid: () => Effect.Effect<ReadonlyArray<InvalidEntry>>
  readonly getInvalid: (relativePath: string) => Effect.Effect<InvalidEntry | undefined>
  readonly reload: () => Effect.Effect<void, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MCPAsset") {}

// 系统 MCP 配置发现路径
const SYSTEM_MCP_ROOTS: string[] = []

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** 从服务器配置对象中提取 MCP 服务器条目（兼容 { servers } 和 { mcpServers } 两种 key）。 */
function extractServers(json: Record<string, unknown>): Record<string, unknown> {
  const servers = json.servers ?? json.mcpServers
  return isRecord(servers) ? servers : {}
}

/** 解析单条 MCP 服务器配置，返回 { name, command, args?, env?, configJson? } | null。 */
function parseServerEntry(name: string, entry: unknown, configJson: string): { name: string; command: string; args: string[]; env: Record<string, string>; configJson: string } | null {
  if (!isRecord(entry)) return null
  const command = typeof entry.command === "string" ? entry.command : ""
  if (!command) return null
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : []
  const env = isRecord(entry.env) ? Object.fromEntries(Object.entries(entry.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}
  return { name, command, args, env, configJson }
}

/** 逐个添加资产（处理 name 冲突）。 */
function storeAsset(assets: Map<string, Info>, byName: Map<string, string[]>, info: Info) {
  const existing = byName.get(info.name)
  if (existing) {
    existing.push(info.relativePath)
    for (const p of existing) { assets.delete(p) }
    return
  }
  byName.set(info.name, [info.relativePath])
  assets.set(info.relativePath, info)
}

function loadDir(
  fs: FSUtil.Interface,
  ownerRoot: string,
  // 如果非空，结果存入第二份 assets（系统发现用，不混淆 invalid）
  targetInvalid?: Map<string, InvalidEntry>,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = targetInvalid ?? new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.glob("*.json", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      const raw = yield* fs.readFile(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      )
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      let json: unknown
      try { json = JSON.parse(text) } catch {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid mcp asset (JSON parse failed)", { relativePath })
        continue
      }
      if (!isRecord(json)) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        continue
      }

      const servers = extractServers(json)
      const entries = Object.keys(servers).length > 0
        ? Object.entries(servers).map(([name, entry]) => parseServerEntry(name, entry, text))
        : [parseServerEntry(path.basename(relativePath, ".json"), json, text)]

      const revision = Hash.sha256(Buffer.from(raw))

      for (const entry of entries) {
        if (!entry) {
          invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
          continue
        }
        const info: Info = {
          kind: "mcp",
          name: entry.name,
          description: "",
          relativePath: `${entry.name}.json`,
          command: entry.command,
          args: entry.args,
          env: entry.env,
          configJson: entry.configJson,
          revision,
        }
        storeAsset(assets, byName, info)
      }
    }

    return { assets, invalid }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const location = yield* Location.Service

    const ownerRoot = path.resolve(location.directory, MCPS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("MCPAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
          // 系统 MCP 发现暂禁用（Effect API 兼容性问题，后续修复）
          // 系统 MCP 仍通过 server-sync data.mcp 显示（前端 systemAssets 提取）
        }),
      )
    })

    const list = Effect.fn("MCPAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const listSystem = Effect.fn("MCPAsset.listSystem")(function* () {
      return []
    })

    const getByPath = Effect.fn("MCPAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("MCPAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("MCPAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("MCPAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(EventV2.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value
        .subscribe(Watcher.Event.Updated)
        .pipe(
          Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".json")),
          Stream.runForEach(() =>
            reload().pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to reload mcp assets", {
                  errorTag: "_tag" in error ? String(error._tag) : "filesystem_error",
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
    }

    if (Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET && Option.isSome(config)) {
      yield* AssetMigration.importEntriesOnce(fs, {
        ownerRoot,
        entries: AssetMigration.mcpConfigEntries(yield* config.value.entries(), location.project.directory),
        isValidName: MCPAssetPath.isValidSegment,
      }).pipe(Effect.catch((error) => Effect.logWarning("legacy mcp migration failed", { error })))
    }
    yield* reload().pipe(Effect.orDie)

    return Service.of({ list, listSystem, getByPath, findByName, listInvalid, getInvalid, reload })
  }),
)

export const locationLayer = layer
