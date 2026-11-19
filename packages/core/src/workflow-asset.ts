export * as WorkflowAsset from "./workflow-asset"

import { AssetYaml } from "./util/asset-yaml"
import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { Frontmatter, StepDef } from "@aigcfroge/schema/workflow-asset"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Bus } from "./bus"
import { KeyedMutex } from "./effect/keyed-mutex"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Location } from "./location"
import { Hash } from "@aigcfroge/util/hash"
import { Watcher } from "./filesystem/watcher"
import { WORKFLOWS_DIR } from "./constants"

export { WORKFLOWS_DIR }

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("WorkflowAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "workflow"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly version: string
  readonly triggers: ReadonlyArray<string>
  readonly steps: ReadonlyArray<StepDef>
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

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowAsset") {}

export function parseContent(content: string) {
  // The old decoder excluded one leading BOM from the disk reader's character limit.
  if (content.length - (content.startsWith("\uFEFF") ? 1 : 0) > 5_000_000)
    return { kind: "invalid", errorTag: "parse_error" } as const
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

    const files = yield* fs.scan("**/*.yaml", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

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
        yield* Effect.logWarning("Skipping invalid workflow asset", { relativePath, errorTag: parsed.errorTag })
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
        yield* Effect.logWarning("Workflow asset name conflict", { name: frontmatter.name, paths: [...conflicts] })
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      assets.set(relativePath, {
        kind: "workflow",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        version: frontmatter.version,
        triggers: frontmatter.triggers ?? [],
        steps: frontmatter.steps,
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

    const ownerRoot = path.resolve(location.directory, WORKFLOWS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("WorkflowAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("WorkflowAsset.list")(function* () {
      return Array.from(assets.values())
    })

    const getByPath = Effect.fn("WorkflowAsset.getByPath")(function* (relativePath: string) {
      const entry = assets.get(relativePath)
      if (!entry) return yield* new NotFoundError({ relativePath })
      return entry
    })

    const findByName = Effect.fn("WorkflowAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) {
        if (entry.name === name) return entry
      }
      return undefined
    })

    const listInvalid = Effect.fn("WorkflowAsset.listInvalid")(function* () {
      return Array.from(invalid.values())
    })

    const getInvalid = Effect.fn("WorkflowAsset.getInvalid")(function* (relativePath: string) {
      return invalid.get(relativePath)
    })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value.subscribe(Watcher.Event.Updated).pipe(
        Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".yaml")),
        Stream.runForEach(() =>
          reload().pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to reload workflow assets", {
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
