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

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, NotFoundError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined>
  readonly reload: () => Effect.Effect<void, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PromptAsset") {}

function loadDir(fs: FSUtil.Interface, ownerRoot: string): Effect.Effect<Map<string, Info>, FSUtil.Error> {
  return Effect.gen(function* () {
    const next = new Map<string, Info>()
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
      if (!parsed) {
        yield* Effect.logWarning("Skipping invalid prompt asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      let frontmatter: SchemaPromptAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaPromptAsset.Frontmatter)(parsed.data)
      } catch {
        yield* Effect.logWarning("Skipping invalid prompt asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        next.delete(conflicts[0])
        yield* Effect.logWarning("Prompt asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      next.set(relativePath, {
        kind: "prompt",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        template: parsed.content,
        revision,
      })
    }

    return next
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    const ownerRoot = path.resolve(location.directory, PROMPTS_DIR)
    let assets = new Map<string, Info>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("PromptAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          assets = yield* loadDir(fs, ownerRoot)
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

    // Watch owner root .md files for add/change/unlink (optional; without EventV2
    // the registry still works but won't live-reload on file changes)
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
                Effect.logWarning("Failed to reload prompt assets", {
                  errorTag: "_tag" in error ? String(error._tag) : "filesystem_error",
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
    }

    yield* reload().pipe(Effect.orDie)

    return Service.of({ list, getByPath, findByName, reload })
  }),
)

export const locationLayer = layer
