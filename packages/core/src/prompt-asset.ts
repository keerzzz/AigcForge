export * as PromptAsset from "./prompt-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { PromptAsset } from "@omnixa/schema/prompt-asset"
import { ConfigMarkdown } from "./config/markdown"
import { Bus } from "./bus"
import { FSUtil } from "@omnixa/util/fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Location } from "./location"
import { Hash } from "@omnixa/util/hash"
import { Watcher } from "./filesystem/watcher"
import { PROMPTS_DIR } from "./constants"
import { AssetPlacement } from "./asset-placement"
import { LocationMutation } from "./location-mutation"
import { PromptAssetPath } from "./prompt-asset/path"
import { Global } from "@omnixa/util/global"

// Re-export so PromptAsset.PROMPTS_DIR still works for existing consumers.
export { PROMPTS_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PromptAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "prompt"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly template: string
  readonly revision: string
  readonly target?: AssetPlacement.Target
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: "parse_error" | "bad_frontmatter" | "bad_template" | "name_conflict"
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

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/PromptAsset") {}

export function loadDir<E = never>(
  fs: FSUtil.Interface,
  ownerRoot: string,
  validate?: (relativePath: string, file: string) => Effect.Effect<unknown, E>,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error | E> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.scan("**/*.md", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      if (validate) yield* validate(relativePath, file)
      const raw = yield* fs
        .readFile(file)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      const parsed = ConfigMarkdown.parseOption(text)
      // parse_error: gray-matter threw OR returned empty data (no valid frontmatter
      // could be extracted - covers plain text and empty/illegal frontmatter that
      // gray-matter silently normalizes to {}).
      if (!parsed || Object.keys(parsed.data).length === 0) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        yield* Effect.logWarning("Skipping invalid prompt asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      const frontmatter = Schema.decodeUnknownOption(PromptAsset.Frontmatter)(parsed.data)
      if (Option.isNone(frontmatter)) {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid prompt asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      const template = Schema.decodeUnknownOption(PromptAsset.Template)(parsed.content)
      if (Option.isNone(template)) {
        invalid.set(relativePath, { relativePath, errorTag: "bad_template" })
        yield* Effect.logWarning("Skipping invalid prompt asset", { errorTag: "bad_template" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.value.name)
      if (conflicts) {
        conflicts.push(relativePath)
        // PRD §9.4: every file participating in a duplicate-name conflict is
        // excluded and surfaced as invalid, not just the later one.
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Prompt asset name conflict", { name: frontmatter.value.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.value.name, [relativePath])

      assets.set(relativePath, {
        kind: "prompt",
        name: frontmatter.value.name,
        description: frontmatter.value.description,
        relativePath,
        template: template.value,
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
    const mutation = yield* LocationMutation.Service
    const global = yield* Global.Service

    // Resolve only the Location base; another selected owner must not validate these legacy descendants.
    const ownerRoot = path.resolve(
      (yield* mutation.resolve({ path: ".", kind: "directory" }).pipe(Effect.orDie)).absolute,
      PROMPTS_DIR,
    )
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("PromptAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("PromptAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("PromptAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("PromptAsset.findByName")(function* (name: string) {
      return Array.from(assets.values()).find((entry) => entry.name === name)
    })

    const listInvalid = Effect.fn("PromptAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("PromptAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    const select = Effect.fn("PromptAsset.select")(function* (scope: AssetPlacement.Scope) {
      const target = yield* AssetPlacement.resolve(scope, { fs, mutation, location, global }, undefined, "prompt")
      const read = Effect.fnUntraced(function* () {
        return yield* reloadLock.withLock("reload")(
          Effect.gen(function* () {
            yield* AssetPlacement.resolve(scope, { fs, mutation, location, global }, target, "prompt")
            const result = yield* loadDir(fs, target.root, (relativePath) =>
              PromptAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs),
            )
            // Prompt's legacy catalog is eager. Same-owner writes must refresh it even without Watcher events.
            if (target.root === ownerRoot) {
              assets = result.assets
              invalid = result.invalid
            }
            return result
          }),
        )
      })
      const selectedInfo = (info: Info) => ({ ...info, target })
      return {
        target,
        list: () => read().pipe(Effect.map((result) => Array.from(result.assets.values()).map(selectedInfo))),
        getByPath: (relativePath) =>
          Effect.gen(function* () {
            yield* PromptAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
            const entry = (yield* read()).assets.get(relativePath)
            if (!entry) return yield* new NotFoundError({ relativePath })
            return selectedInfo(entry)
          }),
        findByName: (name) =>
          read().pipe(
            Effect.map((result) => {
              const entry = Array.from(result.assets.values()).find((entry) => entry.name === name)
              return entry ? selectedInfo(entry) : undefined
            }),
          ),
        listInvalid: () => read().pipe(Effect.map((result) => Array.from(result.invalid.values()))),
        getInvalid: (relativePath) =>
          Effect.gen(function* () {
            yield* PromptAssetPath.resolveSelectedTarget(relativePath, target, mutation, fs)
            return (yield* read()).invalid.get(relativePath)
          }),
        reload: () => read().pipe(Effect.asVoid),
      } satisfies Selected
    })

    // Watch owner root .md files for add/change/unlink (optional; without EventV2
    // the registry still works but won't live-reload on file changes)
    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value.subscribe(Watcher.Event.Updated).pipe(
        Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".md")),
        Stream.runForEach(() =>
          reload().pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to reload prompt assets", {
                errorTag: "_tag" in error ? error._tag : "filesystem_error",
              }),
            ),
          ),
        ),
        Effect.forkIn(scope),
      )
    }

    yield* reload().pipe(Effect.orDie)

    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload, select })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, LocationMutation.node, Global.node],
})
