export * as PromptAsset from "./prompt-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"

export const PROMPTS_DIR = ".aigcfroge/prompts"

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
  readonly reload: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PromptAsset") {}

function loadDir(fs: FSUtil.Interface, ownerRoot: string): Effect.Effect<Map<string, Info>> {
  return Effect.gen(function* () {
    const next = new Map<string, Info>()
    const byName = new Map<string, string>()

    const files = yield* fs.glob("**/*.md", { cwd: ownerRoot, absolute: true, include: "file", dot: true }).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
    )

    for (const file of files) {
      const raw = yield* fs.readFile(file).pipe(Effect.catch(() => Effect.succeed(undefined as unknown as never)))
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      const parsed = ConfigMarkdown.parseOption(text)
      if (!parsed) {
        yield* Effect.logWarning("Skipping invalid prompt asset (parse error)", { file })
        continue
      }

      let frontmatter: SchemaPromptAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaPromptAsset.Frontmatter)(parsed.data)
      } catch {
        yield* Effect.logWarning("Skipping prompt asset (bad frontmatter)", { file })
        continue
      }

      const relativePath = path.relative(ownerRoot, file)
      const revision = Hash.sha256(Buffer.from(raw))

      const conflict = byName.get(frontmatter.name)
      if (conflict) {
        yield* Effect.logWarning("Prompt asset name conflict", { name: frontmatter.name, paths: [conflict, relativePath] })
        continue
      }
      byName.set(frontmatter.name, relativePath)

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

    const reload = Effect.fn("PromptAsset.reload")(function* () {
      assets = yield* loadDir(fs, ownerRoot)
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
        if (entry.name === name) return entry as Info
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
          Stream.filter((e) => e.data.file.startsWith(ownerRoot) && e.data.file.endsWith(".md")),
          Stream.runForEach(() => reload()),
          Effect.forkIn(scope),
        )
    }

    yield* reload()

    return Service.of({ list, getByPath, findByName, reload })
  }),
)

export const locationLayer = layer
