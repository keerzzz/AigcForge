export * as SkillAsset from "./skill-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { SkillAsset as SchemaSkillAsset } from "@aigcfroge/schema/skill-asset"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { AssetMigration } from "./asset-migration"
import { SkillAssetPath } from "./skill-asset/path"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { SKILLS_DIR } from "./constants"

export { SKILLS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SkillAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "skill"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly slash: boolean
  readonly content: string
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

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SkillAsset") {}

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
        yield* Effect.logWarning("Skipping invalid skill asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      let frontmatter: SchemaSkillAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaSkillAsset.Frontmatter)(parsed.data)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid skill asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      // name 可选（对齐原生 SkillV2），无 frontmatter name 时回退文件名
      const derivedName = frontmatter.name ?? path.basename(relativePath, ".md")
      const derivedDescription = frontmatter.description ?? ""
      const derivedSlash = frontmatter.slash ?? false
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

    const ownerRoot = path.resolve(location.directory, SKILLS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("SkillAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("SkillAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("SkillAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("SkillAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("SkillAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("SkillAsset.getInvalid")(function* (relativePath: string) {
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
                Effect.logWarning("Failed to reload skill assets", {
                  errorTag: "_tag" in error ? String(error._tag) : "filesystem_error",
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

/** First-run import of project-local legacy skills (`.claude/skills`, `.agents/skills`). Best-effort: never blocks boot. */
const migrateLegacy = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string, ownerRoot: string) {
  yield* AssetMigration.importOnce(fs, {
    ownerRoot,
    files: yield* AssetMigration.legacySkillFiles(fs, directory),
    parse: AssetMigration.skillEntry,
    isValidName: SkillAssetPath.isValidSegment,
  }).pipe(Effect.catch((error) => Effect.logWarning("legacy skill migration failed", { error })))
})

export const locationLayer = layer
