export * as CustomProfile from "./custom-profile"

import { AssetYaml } from "./util/asset-yaml"
import { Context, Effect, Layer, Option, Result, Schema, Scope, Stream } from "effect"
import path from "path"
import { Composition } from "@aigcfroge/schema/composition"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { CompositionReference } from "./composition/reference"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Bus } from "./bus"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { Hash } from "@aigcfroge/util/hash"
import { Watcher } from "./filesystem/watcher"
import { CUSTOM_PROFILES_DIR } from "./constants"
import { CustomProfilePath } from "./custom-profile/path"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"

export { CUSTOM_PROFILES_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("CustomProfile.NotFound", {
  relativePath: Schema.String,
}) {}

export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()("CustomProfile.InvalidPath", {
  kind: Composition.AllowedKind,
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export interface Info {
  readonly kind: "custom-profile"
  readonly name: CustomProfile.Name
  readonly description: CustomProfile.Description
  readonly relativePath: string
  readonly revision: CustomProfile.Revision
  readonly profile: CustomProfile.Profile
  readonly rawYaml?: string
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: CustomProfile.InvalidErrorTag
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly references: (input: {
    readonly kind: Composition.AllowedKind
    readonly path: string
    readonly target?: AssetPlacement.Target
    readonly includeLegacyLocation?: boolean
  }) => Effect.Effect<ReadonlyArray<CustomProfile.Summary>, InvalidPathError>
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

    const files = yield* fs.scan("**/*.yaml", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      const raw = yield* fs
        .readFile(file)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
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
        doc = AssetYaml.parse(text)
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

      let profile: CustomProfile.Profile
      try {
        profile = CustomProfile.decodeProfile(doc)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_yaml" })
        yield* Effect.logWarning("Skipping custom profile with bad schema", { relativePath, errorTag: "bad_yaml" })
        continue
      }

      const revision = CustomProfile.Revision.make(Hash.sha256(Buffer.from(raw)))

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

function referencesProfile(
  profile: CustomProfile.Profile,
  kind: Composition.AllowedKind,
  relativePath: string,
  target: AssetPlacement.Target | undefined,
  legacyTarget: AssetPlacement.Target | undefined,
  includeLegacyLocation: boolean,
) {
  const matches = (candidate: CompositionReference.Entry) => {
    // Historical omission retains this Profile's Location membership when its base is an alias.
    if (candidate.target === undefined && includeLegacyLocation)
      return CompositionReference.matches(kind, relativePath, candidate.relativePath)
    return CompositionReference.matches(
      kind,
      relativePath,
      candidate.relativePath,
      target,
      candidate.target ?? legacyTarget,
    )
  }

  if (kind === "agent")
    return (profile.root?.source === "asset" && matches(profile.root)) || profile.agents.some(matches)
  if (kind === "workflow") return profile.workflow !== undefined && matches(profile.workflow)
  if (kind === "mcp") return profile.mcpBindings.some((binding) => matches(binding.ref))
  return Object.values(profile.bindings).some((binding) => {
    if (kind === "prompt") return binding.prompts.some(matches)
    if (kind === "skill") return binding.skills.some(matches)
    return binding.commands.some(matches)
  })
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

    const references = Effect.fn("CustomProfile.references")(function* (input: {
      readonly kind: Composition.AllowedKind
      readonly path: string
      readonly target?: AssetPlacement.Target
      readonly includeLegacyLocation?: boolean
    }) {
      if (input.target !== undefined && input.kind !== "prompt" && input.kind !== "skill" && input.kind !== "command")
        return yield* new InvalidPathError({
          kind: input.kind,
          path: input.path,
          reason: `Selected targets are unsupported for ${input.kind} references`,
        })
      const normalized = Result.try(() => CompositionReference.normalize(input.kind, input.path))
      if (Result.isFailure(normalized))
        return yield* new InvalidPathError({
          kind: input.kind,
          path: input.path,
          reason: normalized.failure instanceof Error ? normalized.failure.message : String(normalized.failure),
        })

      const legacyTarget = CompositionReference.legacyTarget(input.kind, location.directory)
      const includeLegacyLocation = input.includeLegacyLocation ?? input.target === undefined
      return Array.from(assets.values())
        .filter((entry) =>
          referencesProfile(
            entry.profile,
            input.kind,
            normalized.success,
            input.target ?? legacyTarget,
            legacyTarget,
            includeLegacyLocation,
          ),
        )
        .sort((left, right) =>
          left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
        )
        .map(
          (entry) =>
            new CustomProfile.Summary({
              kind: entry.kind,
              name: entry.name,
              description: entry.description,
              relativePath: entry.relativePath,
              revision: entry.revision,
            }),
        )
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
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value.subscribe(Watcher.Event.Updated).pipe(
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
      references,
      getByPath,
      findByName,
      listInvalid,
      getInvalid,
      reload,
    } satisfies Interface)
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Location.node, Bus.node] })
