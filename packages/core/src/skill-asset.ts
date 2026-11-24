export * as SkillAsset from "./skill-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { SkillAsset } from "@omnixa/schema/skill-asset"
import { ConfigMarkdown } from "./config/markdown"
import { Bus } from "./bus"
import { FSUtil } from "@omnixa/util/fs-util"
import { Flag } from "./flag/flag"
import { KeyedMutex } from "./effect/keyed-mutex"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Location } from "./location"
import { AssetMigration } from "./asset-migration"
import { SkillAssetPath } from "./skill-asset/path"
import { Hash } from "@omnixa/util/hash"
import { Watcher } from "./filesystem/watcher"
import { SKILLS_DIR } from "./constants"
import { AssetPlacement } from "./asset-placement"
import { LocationMutation } from "./location-mutation"
import { Global } from "@omnixa/util/global"

export { SKILLS_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("SkillAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "skill"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly slash: boolean
  readonly content: string
  readonly triggers: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
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

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/SkillAsset") {}

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
        yield* Effect.logWarning("Skipping invalid skill asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      // description 超 300 码点上限时按边界截断，而非整条判 bad_frontmatter
      //（上限即 SkillAsset.Description 约束；与 command/discover.ts 写入端截断策略对齐）
      const data =
        typeof parsed.data.description === "string" && Array.from(parsed.data.description).length > 300
          ? { ...parsed.data, description: Array.from(parsed.data.description).slice(0, 300).join("") }
          : parsed.data

      let frontmatter: SkillAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SkillAsset.Frontmatter)({
          ...data,
          name: data.name === undefined ? path.basename(relativePath, ".md") : data.name,
        })
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid skill asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      // name 可选（对齐原生 SkillV2），无 frontmatter name 时回退文件名
      const derivedName = frontmatter.name ?? path.basename(relativePath, ".md")
      const derivedDescription = frontmatter.description ?? ""
      const derivedSlash = frontmatter.slash ?? false
      const derivedTriggers = frontmatter.triggers ?? []
      const derivedTags = frontmatter.tags ?? []
      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(derivedName)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Skill asset name conflict", { name: derivedName, paths: [...conflicts] })
        continue
      }
      byName.set(derivedName, [relativePath])

      assets.set(relativePath, {
        kind: "skill",
        name: derivedName,
        description: derivedDescription,
        relativePath,
        slash: derivedSlash,
        content: parsed.content,
        triggers: derivedTriggers,
        tags: derivedTags,
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
    const location = yield* Location.Service
    const mutation = yield* LocationMutation.Service
    const global = yield* Global.Service

    const ownerRoot = path.resolve(location.directory, SKILLS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    let initialized = false
    const reloadLock = KeyedMutex.makeUnsafe<string>()
    const migration = yield* Effect.cached(migrateLegacy(fs, location.directory, ownerRoot))

    const reload = Effect.fn("SkillAsset.reload")(function* () {
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

    const list = Effect.fn("SkillAsset.list")(function* () {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("SkillAsset.getByPath")(function* (relativePath: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("SkillAsset.findByName")(function* (name: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("SkillAsset.listInvalid")(function* () {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("SkillAsset.getInvalid")(function* (relativePath: string) {
      if (!initialized) yield* reload().pipe(Effect.orDie)
      return invalid.get(relativePath)
    })

    const select = Effect.fn("SkillAsset.select")(function* (scope: AssetPlacement.Scope) {
      const target = yield* AssetPlacement.resolve(scope, { fs, mutation, location, global })
      const read = Effect.fnUntraced(function* () {
        yield* AssetPlacement.resolve(scope, { fs, mutation, location, global }, target)
        return yield* loadDir(fs, target.root, {
          target,
          validate: (relativePath) => SkillAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs),
        })
      })
      return {
        target,
        list: () => read().pipe(Effect.map((result) => Array.from(result.assets.values()))),
        getByPath: (relativePath) =>
          Effect.gen(function* () {
            yield* SkillAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
            const entry = (yield* read()).assets.get(relativePath)
            if (!entry) return yield* new NotFoundError({ relativePath })
            return entry
          }),
        findByName: (name) =>
          read().pipe(Effect.map((result) => Array.from(result.assets.values()).find((entry) => entry.name === name))),
        listInvalid: () => read().pipe(Effect.map((result) => Array.from(result.invalid.values()))),
        getInvalid: (relativePath) =>
          Effect.gen(function* () {
            yield* SkillAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
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
                  Effect.logWarning("Failed to reload skill assets", {
                    errorTag: "_tag" in error ? error._tag : "filesystem_error",
                  }),
                ),
              )
            : Effect.void,
        ),
        Effect.forkIn(scope),
      )
    }

    // Selected reads must not cause a write through legacy migration. Old callers initialize on first use.
    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload, select })
  }),
)

/** First-run import of project-local legacy skills (`.claude/skills`, `.agents/skills`). Best-effort: never blocks boot. */
const migrateLegacy = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string, ownerRoot: string) {
  if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return
  yield* AssetMigration.importOnce(fs, {
    ownerRoot,
    files: yield* AssetMigration.legacySkillFiles(fs, directory),
    parse: AssetMigration.skillEntry,
    isValidName: SkillAssetPath.isValidSegment,
  }).pipe(Effect.catch((error) => Effect.logWarning("legacy skill migration failed", { error })))
})

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, LocationMutation.node, Global.node],
})
