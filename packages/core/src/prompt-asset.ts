export * as PromptAsset from "./prompt-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset" // Schema namespace; local/core PromptAsset uses the unaliased name.
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { PROMPTS_DIR } from "./constants"

// Re-export so PromptAsset.PROMPTS_DIR still works for existing consumers.
export { PROMPTS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PromptAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "prompt"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly template: string
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

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PromptAsset") {}

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

      let frontmatter: SchemaPromptAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaPromptAsset.Frontmatter)(parsed.data)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid prompt asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        // PRD §9.4: every file participating in a duplicate-name conflict is
        // excluded and surfaced as invalid, not just the later one.
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        yield* Effect.logWarning("Prompt asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      assets.set(relativePath, {
        kind: "prompt",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        template: parsed.content,
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

    const ownerRoot = path.resolve(location.directory, PROMPTS_DIR)
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
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("PromptAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("PromptAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    // Watch owner root .md files for add/change/unlink (optional; without EventV2
    // the registry still works but won't live-reload on file changes)
    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(EventV2.Service)
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

    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload })
  }),
)

export const locationLayer = layer
