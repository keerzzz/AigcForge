export * as CommandAsset from "./command-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { CommandAsset as SchemaCommandAsset } from "@aigcfroge/schema/command-asset"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { COMMANDS_DIR } from "./constants"
import { AssetKind } from "./asset-kind"

export { COMMANDS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("CommandAsset.NotFound", {
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

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CommandAsset") {}

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
        yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "parse_error" })
        continue
      }

      let frontmatter: SchemaCommandAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaCommandAsset.Frontmatter)(parsed.data)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        yield* Effect.logWarning("Skipping invalid command asset", { relativePath, errorTag: "bad_frontmatter" })
        continue
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
        args: frontmatter.args,
        source: frontmatter.source || parsed.content,
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
    const registry = yield* AssetKind.Service

    const ownerRoot = path.resolve(location.directory, COMMANDS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    yield* registry.register({
      id: "command",
      schema: { Summary: SchemaCommandAsset.Summary, Info: SchemaCommandAsset.Info },
      ownerDir: COMMANDS_DIR,
    })

    const reload = Effect.fn("CommandAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("CommandAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("CommandAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("CommandAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("CommandAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("CommandAsset.getInvalid")(function* (relativePath: string) {
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
                Effect.logWarning("Failed to reload command assets", {
                  errorTag: "_tag" in error ? String(error._tag) : "filesystem_error",
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
