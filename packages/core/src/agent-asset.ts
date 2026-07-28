export * as AgentAsset from "./agent-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { AgentAsset as SchemaAgentAsset } from "@aigcfroge/schema/agent-asset"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { AssetMigration } from "./asset-migration"
import { AgentAssetPath } from "./agent-asset/path"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { AGENTS_DIR } from "./constants"

export { AGENTS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("AgentAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "agent"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly config: string
  readonly source: string
  readonly revision: string
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: "parse_error" | "bad_frontmatter" | "name_conflict"
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, NotFoundError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined>
  readonly listInvalid: () => Effect.Effect<ReadonlyArray<InvalidEntry>>
  readonly getInvalid: (relativePath: string) => Effect.Effect<InvalidEntry | undefined>
  readonly reload: () => Effect.Effect<void, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/AgentAsset") {}

function loadDir(
  fs: FSUtil.Interface,
  ownerRoot: string,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.glob("**/*.md", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      const raw = yield* fs.readFile(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      )
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      const parsed = ConfigMarkdown.parseOption(text)
      if (!parsed || Object.keys(parsed.data).length === 0) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid agent asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      let frontmatter: SchemaAgentAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaAgentAsset.Frontmatter)(parsed.data)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid agent asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Agent asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      assets.set(relativePath, {
        kind: "agent",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        config: frontmatter.config || "",
        source: parsed.content,
        revision,
      })
    }

    return { assets, invalid }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    const ownerRoot = path.resolve(location.directory, AGENTS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()


    const reload = Effect.fn("AgentAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("AgentAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("AgentAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("AgentAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("AgentAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("AgentAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(EventV2.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value
        .subscribe(Watcher.Event.Updated)
        .pipe(
          Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".md")),
          Stream.runForEach(() =>
            reload().pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to reload agent assets", {
                  errorTag: "_tag" in error ? error._tag : "filesystem_error",
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
    }

    // First-run legacy import must land before the initial reload so migrated
    // files are visible in the first list().
    yield* migrateLegacy(fs, location.directory, ownerRoot)
    yield* reload().pipe(Effect.orDie)

    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload })
  }),
)

/** First-run import of project-local legacy agents (`.claude/agents`). Best-effort: never blocks boot. */
const migrateLegacy = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string, ownerRoot: string) {
  if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return
  yield* AssetMigration.importOnce(fs, {
    ownerRoot,
    files: yield* AssetMigration.legacyAgentFiles(fs, directory),
    parse: AssetMigration.agentEntry,
    isValidName: AgentAssetPath.isValidSegment,
  }).pipe(Effect.catch((error) => Effect.logWarning("legacy agent migration failed", { error })))
})

export const locationLayer = layer
