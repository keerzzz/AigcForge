export * as PluginAsset from "./plugin-asset"

import { AssetYaml } from "./util/asset-yaml"
import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { Frontmatter } from "@omnixa/schema/plugin-asset"
import { FSUtil } from "@omnixa/util/fs-util"
import { Bus } from "./bus"
import { KeyedMutex } from "./effect/keyed-mutex"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Location } from "./location"
import { Hash } from "@omnixa/util/hash"
import { Watcher } from "./filesystem/watcher"
import { PLUGINS_DIR } from "./constants"

export { PLUGINS_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PluginAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "plugin"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly version: string
  readonly category?: string
  readonly author?: { readonly name: string; readonly email?: string }
  readonly source?: {
    readonly type: "mcp" | "openapi" | "bundled"
    readonly mcp?: { readonly name: string }
    readonly openapi?: { readonly url: string }
  }
  readonly hooks: ReadonlyArray<{ readonly event: string; readonly command: string; readonly timeout?: number }>
  readonly revision: string
  readonly content: string
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

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/PluginAsset") {}

export function parseContent(content: string) {
  if (content.length > 1_000_000) return { kind: "invalid", errorTag: "parse_error" } as const
  const parsed = parseYaml(content)
  if (Option.isNone(parsed) || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value))
    return { kind: "invalid", errorTag: "parse_error" } as const
  const decoded = Schema.decodeUnknownOption(Frontmatter)(parsed.value)
  if (Option.isNone(decoded)) return { kind: "invalid", errorTag: "bad_frontmatter" } as const
  return { kind: "valid", value: decoded.value } as const
}

function parseYaml(content: string) {
  try {
    return Option.some(AssetYaml.parse(content))
  } catch {
    return Option.none()
  }
}

export function loadDir<E = never>(
  fs: FSUtil.Interface,
  ownerRoot: string,
  validate?: (relativePath: string, file: string) => Effect.Effect<unknown, E>,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error | E> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.scan("**/*.plugin.yaml", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      if (validate) yield* validate(relativePath, file)
      const raw = yield* fs
        .readFile(file)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!raw) continue

      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(raw)

      const parsed = parseContent(text)
      if (parsed.kind === "invalid") {
        invalid.set(relativePath, { relativePath, errorTag: parsed.errorTag })
        yield* Effect.logWarning("Skipping invalid plugin asset", { relativePath, errorTag: parsed.errorTag })
        continue
      }
      const frontmatter = parsed.value

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Plugin asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      const declaration = Schema.encodeSync(Frontmatter)(frontmatter)
      assets.set(relativePath, {
        ...declaration,
        relativePath,
        hooks: declaration.hooks ?? [],
        revision,
        content: text,
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

    const ownerRoot = path.resolve(location.directory, PLUGINS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("PluginAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("PluginAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("PluginAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("PluginAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("PluginAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("PluginAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value.subscribe(Watcher.Event.Updated).pipe(
        Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".plugin.yaml")),
        Stream.runForEach(() =>
          reload().pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to reload plugin assets", {
                errorTag: "_tag" in error ? error._tag : "filesystem_error",
              }),
            ),
          ),
        ),
        Effect.forkIn(scope),
      )
    }

    yield* reload().pipe(Effect.orDie)

    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Location.node] })
