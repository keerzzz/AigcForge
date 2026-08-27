export * as CustomProfile from "./custom-profile"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import yaml from "js-yaml"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { CUSTOM_PROFILES_DIR } from "./constants"
import { CustomProfilePath } from "./custom-profile/path"

export { CUSTOM_PROFILES_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("CustomProfile.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "custom-profile"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly revision: string
  readonly profile: SchemaCustomProfile.Profile
  readonly rawYaml?: string
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: SchemaCustomProfile.InvalidErrorTag
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, NotFoundError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined>
  readonly listInvalid: () => Effect.Effect<ReadonlyArray<InvalidEntry>>
  readonly getInvalid: (relativePath: string) => Effect.Effect<InvalidEntry | undefined>
  readonly reload: () => Effect.Effect<void, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CustomProfile") {}

function loadDir(
  fs: FSUtil.Interface,
  ownerRoot: string,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.glob("**/*.yaml", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      const raw = yield* fs.readFile(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      )
      if (!raw) continue

      const text = new TextDecoder().decode(raw)

      const MAX_YAML_BYTES = 5_000_000
      if (text.length > MAX_YAML_BYTES) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Custom profile asset exceeds max size", { relativePath, size: text.length })
        continue
      }

      let doc: unknown
      try {
        doc = yaml.load(text)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid custom profile YAML", { relativePath, errorTag: "parse_error" })
        continue
      }

      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid custom profile asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      let profile: SchemaCustomProfile.Profile
      try {
        profile = SchemaCustomProfile.decodeProfile(doc)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_yaml" })
        yield* Effect.logWarning("Skipping custom profile with bad schema", { relativePath, errorTag: "bad_yaml" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(profile.name)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Custom profile name conflict", { name: profile.name, paths: [...conflicts] })
        continue
      }
      byName.set(profile.name, [relativePath])

      assets.set(relativePath, {
        kind: "custom-profile",
        name: profile.name,
        description: profile.description,
        relativePath,
        revision,
        profile,
        rawYaml: text,
      })
    }

    return { assets, invalid }
  })
}

function normalizeLookupPath(relativePath: string) {
  try {
    return CustomProfilePath.normalizeRelativePath(relativePath)
  } catch {
    return relativePath
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    const ownerRoot = path.resolve(location.directory, CUSTOM_PROFILES_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("CustomProfile.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("CustomProfile.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("CustomProfile.getByPath")(function* (relativePath: string) {
      const normalized = normalizeLookupPath(relativePath)
      const entry = assets.get(normalized)
      if (!entry) return yield* new NotFoundError({ relativePath: normalized })
      return entry
    })

    const findByName = Effect.fn("CustomProfile.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("CustomProfile.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("CustomProfile.getInvalid")(function* (relativePath: string) {
      const normalized = normalizeLookupPath(relativePath)
      return invalid.get(normalized)
    })

    // Initial load
    yield* reload().pipe(Effect.orDie)

    // Watch for file changes
    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(EventV2.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value
        .subscribe(Watcher.Event.Updated)
        .pipe(
          Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".yaml")),
          Stream.runForEach(() =>
            reload().pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to reload custom profile assets", {
                  errorTag: "_tag" in error ? error._tag : "filesystem_error",
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
    }

    return Service.of({
      list,
      getByPath,
      findByName,
      listInvalid,
      getInvalid,
      reload,
    } satisfies Interface)
  }),
)

export const locationLayer = layer
