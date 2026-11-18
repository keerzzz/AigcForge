export * as CommandAsset from "./command-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { Frontmatter } from "@aigcfroge/schema/command-asset"
import { AssetMigration } from "./asset-migration"
import { Config } from "./config"
import { ConfigMarkdown } from "./config/markdown"
import { Bus } from "./bus"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Flag } from "./flag/flag"
import { KeyedMutex } from "./effect/keyed-mutex"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Location } from "./location"
import { CommandAssetPath } from "./command-asset/path"
import { Hash } from "@aigcfroge/util/hash"
import { Watcher } from "./filesystem/watcher"
import { COMMANDS_DIR } from "./constants"
import { AssetPlacement } from "./asset-placement"
import { LocationMutation } from "./location-mutation"
import { Global } from "@aigcfroge/util/global"

export { COMMANDS_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("CommandAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "command"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly invocation: string
  readonly args?: string
  readonly source: string
  readonly revision: string
  readonly target?: AssetPlacement.Target
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
  readonly select: (scope: AssetPlacement.Scope) => Effect.Effect<Selected, SelectError>
}

export type SelectError = AssetPlacement.Error
export type ReadError = SelectError | NotFoundError

export interface Selected {
  readonly target: AssetPlacement.Target
  readonly list: () => Effect.Effect<ReadonlyArray<Info>, SelectError>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, ReadError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined, SelectError>
  readonly listInvalid: () => Effect.Effect<ReadonlyArray<InvalidEntry>, SelectError>
  readonly getInvalid: (relativePath: string) => Effect.Effect<InvalidEntry | undefined, SelectError>
  readonly reload: () => Effect.Effect<void, SelectError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CommandAsset") {}

const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

export function loadDir<E = never>(
  fs: FSUtil.Interface,
  ownerRoot: string,
  selected?: {
    readonly target: AssetPlacement.Target
    readonly validate: (relativePath: string, file: string) => Effect.Effect<unknown, E>
  },
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error | E> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.scan("**/*.md", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      if (selected) yield* selected.validate(relativePath, file)
      const raw = yield* fs
        .readFile(file)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      const parsed = ConfigMarkdown.parseOption(text)
      if (!parsed || Object.keys(parsed.data).length === 0) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      const decoded = decodeFrontmatter(parsed.data)
      let frontmatter: Frontmatter
      let source = parsed.content
      if (Option.isSome(decoded)) {
        frontmatter = decoded.value
      } else {
        // `.aigcfroge/commands` was a V1 command source before it became the
        // asset owner. Read legacy entries until an explicit migration rewrites them.
        if (parsed.data.kind !== undefined) {
          invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
          yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "bad_frontmatter" })
          continue
        }
        const legacy = AssetMigration.commandEntry(text, relativePath.replace(/\.md$/, ""))
        const migrated = legacy && ConfigMarkdown.parseOption(legacy.file)
        if (!migrated) {
          invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
          yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "bad_frontmatter" })
          continue
        }
        const migratedFrontmatter = decodeFrontmatter(migrated.data)
        if (Option.isNone(migratedFrontmatter)) {
          invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
          yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "bad_frontmatter" })
          continue
        }
        frontmatter = migratedFrontmatter.value
        source = migrated.content
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Command asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      assets.set(relativePath, {
        kind: "command",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        invocation: frontmatter.invocation,
        ...(frontmatter.args === undefined ? {} : { args: frontmatter.args }),
        source: frontmatter.source || source,
        revision,
        ...(selected ? { target: selected.target } : {}),
      })
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
    const mutation = yield* LocationMutation.Service
    const global = yield* Global.Service

    const ownerRoot = path.resolve(location.directory, COMMANDS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    let initialized = false
    const reloadLock = KeyedMutex.makeUnsafe<string>()
    const migration = yield* Effect.cached(
      Effect.gen(function* () {
        if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET || Option.isNone(config)) return
        const files = yield* AssetMigration.legacyCommandFiles(fs, location.directory)
        yield* AssetMigration.importEntriesOnce(fs, {
          ownerRoot,
          marker: path.resolve(location.directory, ".aigcfroge/.command-asset-migration-v1"),
          entries: [
            ...AssetMigration.commandConfigEntries(yield* config.value.entries(), location.project.directory),
            ...(yield* AssetMigration.entriesFromFiles(fs, files, AssetMigration.commandEntry)),
          ],
          isValidName: (name) => name.split("/").every(CommandAssetPath.isValidSegment),
        })
      }).pipe(Effect.catch((error) => Effect.logWarning("legacy command migration failed", { error }))),
    )

    const reload = Effect.fn("CommandAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          yield* migration
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
          initialized = true
        }),
      )
    })

    const list = Effect.fn("CommandAsset.list")(function* () {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("CommandAsset.getByPath")(function* (relativePath: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("CommandAsset.findByName")(function* (name: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return Array.from(assets.values()).find((entry) => entry.name === name)
    })

    const listInvalid = Effect.fn("CommandAsset.listInvalid")(function* () {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("CommandAsset.getInvalid")(function* (relativePath: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return invalid.get(relativePath)
    })

    const select = Effect.fn("CommandAsset.select")(function* (scope: AssetPlacement.Scope) {
      const target = yield* AssetPlacement.resolve(scope, { fs, mutation, location, global }, undefined, "command")
      const read = Effect.fnUntraced(function* () {
        yield* AssetPlacement.resolve(scope, { fs, mutation, location, global }, target, "command")
        return yield* loadDir(fs, target.root, {
          target,
          validate: (relativePath) => CommandAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs),
        })
      })
      return {
        target,
        list: () => read().pipe(Effect.map((result) => Array.from(result.assets.values()))),
        getByPath: (relativePath) =>
          Effect.gen(function* () {
            yield* CommandAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
            const entry = (yield* read()).assets.get(relativePath)
            if (!entry) return yield* new NotFoundError({ relativePath })
            return entry
          }),
        findByName: (name) =>
          read().pipe(Effect.map((result) => Array.from(result.assets.values()).find((entry) => entry.name === name))),
        listInvalid: () => read().pipe(Effect.map((result) => Array.from(result.invalid.values()))),
        getInvalid: (relativePath) =>
          Effect.gen(function* () {
            yield* CommandAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
            return (yield* read()).invalid.get(relativePath)
          }),
        reload: () => read().pipe(Effect.asVoid),
      } satisfies Selected
    })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value.subscribe(Watcher.Event.Updated).pipe(
        Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".md")),
        Stream.runForEach(() =>
          initialized
            ? reload().pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Failed to reload command assets", {
                    errorTag: "_tag" in error ? error._tag : "filesystem_error",
                  }),
                ),
              )
            : Effect.void,
        ),
        Effect.forkIn(scope),
      )
    }

    // Selected activation stays read-only; the first legacy consumer performs the existing import.
    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload, select })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, LocationMutation.node, Global.node],
})
