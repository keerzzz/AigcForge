import path from "node:path"
import { Effect, Schema, Struct } from "effect"
import { Asset } from "@omnixa/schema/asset"
import { AssetPublication } from "@omnixa/schema/asset-publication"
import { AbsolutePath } from "@omnixa/schema/schema"
import type { FSUtil } from "@omnixa/util/fs-util"
import type { Global } from "@omnixa/util/global"
import { AssetPlacement } from "./asset-placement.js"
import { AgentAsset } from "./agent-asset.js"
import { CommandAsset } from "./command-asset.js"
import { MCPAsset } from "./mcp-asset.js"
import { PluginAsset } from "./plugin-asset.js"
import { PromptAsset } from "./prompt-asset.js"
import { SkillAsset } from "./skill-asset.js"
import { WorkflowAsset } from "./workflow-asset.js"
import type { Location } from "./location.js"
import type { LocationMutation } from "./location-mutation.js"
import type { Skill } from "./skill.js"
import { AGENTS_DIR, MCPS_DIR, WORKFLOWS_DIR, PLUGINS_DIR } from "./constants.js"

export { Publication, Json } from "@omnixa/schema/asset-publication"

export interface Sources {
  readonly fs: FSUtil.Interface
  readonly mutation: LocationMutation.Interface
  readonly location: Location.Interface
  readonly global: Global.Interface
}

export const read = Effect.fn("AssetPublication.read")(function* (sources: Sources, skills: ReadonlyArray<Skill.Info>) {
  const planned = [
    ...(["prompt", "skill", "command"] as const).flatMap((kind) =>
      (["global", "project", "location"] as const).map((scope) => ({ kind, scope })),
    ),
    ...(["agent", "mcp", "workflow", "plugin"] as const).map((kind) => ({ kind, scope: "location" as const })),
  ]
  const observed = yield* Effect.forEach(planned, ({ kind, scope }) => readSource(sources, kind, scope))
  return new AssetPublication.Publication({
    runtime: new AssetPublication.Runtime({
      sourceLocation: { directory: sources.location.directory, workspaceID: sources.location.workspaceID },
      skills: skills.map(
        (skill) =>
          new AssetPublication.RegisteredSkill(Struct.pick(skill, ["id", "name", "description", "autoinvoke", "path"])),
      ),
    }),
    definitions: observed.filter(
      (source): source is AssetPublication.Definition => !(source instanceof AssetPublication.SourceError),
    ),
    errors: observed.filter(
      (source): source is AssetPublication.SourceError => source instanceof AssetPublication.SourceError,
    ),
  })
})

export function toModelAssets(
  publication: AssetPublication.Publication,
  registered: ReadonlyArray<AssetPublication.RegisteredSkill> = publication.runtime.skills,
) {
  return [
    {
      kind: "Registered skills",
      name: JSON.stringify({ sourceLocation: publication.runtime.sourceLocation, count: registered.length }),
    },
    ...registered.map((skill) => ({
      kind: "Registered skills",
      name: JSON.stringify(Struct.pick(skill, ["id", "name", "description", "autoinvoke", "path"])),
    })),
    ...publication.definitions.flatMap((source) => [
      {
        kind: `${source.kind} definitions`,
        name: JSON.stringify({ target: source.target, count: source.assets.length, invalid: source.invalid.length }),
      },
      ...source.assets.map((asset) => ({
        kind: `${source.kind} definitions`,
        name: JSON.stringify({ target: source.target, ...asset }),
      })),
      ...source.invalid.map((invalid) => ({
        kind: `${source.kind} invalid definitions`,
        name: JSON.stringify({ target: source.target, ...invalid }),
      })),
    ]),
    ...publication.errors.map((source) => ({ kind: "Definition source errors", name: JSON.stringify(source) })),
  ]
}

const readSource = Effect.fn("AssetPublication.readSource")(function* (
  sources: Sources,
  kind: AssetPublication.Kind,
  scope: AssetPlacement.Scope,
) {
  return yield* Effect.gen(function* () {
    const target = yield* resolveTarget(sources, kind, scope).pipe(Effect.mapError((error) => sourceError(kind, error)))
    return yield* readDefinition(sources, kind, target).pipe(
      Effect.mapError((error) => sourceError(kind, error)),
      Effect.catchTag("AssetError", (error) =>
        Effect.succeed(new AssetPublication.SourceError({ kind, scope, target, error })),
      ),
    )
  }).pipe(
    Effect.catchTag("AssetError", (error) => Effect.succeed(new AssetPublication.SourceError({ kind, scope, error }))),
  )
})

const resolveTarget = Effect.fn("AssetPublication.resolveTarget")(function* (
  sources: Sources,
  kind: AssetPublication.Kind,
  scope: AssetPlacement.Scope,
) {
  const base =
    scope === "global"
      ? sources.global.config
      : scope === "project"
        ? sources.location.project.directory
        : sources.location.directory
  if ((yield* sources.fs.stat(base)).type !== "Directory")
    return yield* new AssetPlacement.PathError({ path: base, reason: "Asset source base must be a directory" })
  if (kind === "prompt" || kind === "skill" || kind === "command")
    return yield* AssetPlacement.resolve(scope, sources, undefined, kind)
  const owner = yield* AssetPlacement.resolveWithin(
    AbsolutePath.make(yield* sources.fs.realPath(sources.location.directory)),
    kind === "agent" ? AGENTS_DIR : kind === "mcp" ? MCPS_DIR : kind === "workflow" ? WORKFLOWS_DIR : PLUGINS_DIR,
    sources,
    "directory",
  )
  return new AssetPlacement.Target({ scope, root: owner.absolute })
})

const readDefinition = Effect.fn("AssetPublication.readDefinition")(function* (
  sources: Sources,
  kind: AssetPublication.Kind,
  target: AssetPlacement.Target,
) {
  const exists = yield* sources.fs
    .stat(target.root)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (!exists) return Schema.decodeUnknownSync(AssetPublication.Definition)({ kind, target, assets: [], invalid: [] })
  if (exists.type !== "Directory")
    return yield* new AssetPlacement.PathError({ path: target.root, reason: "Asset owner must be a directory" })
  const validate = Effect.fnUntraced(function* (relativePath: string, file: string) {
    if (path.resolve(target.root, relativePath) !== path.resolve(file))
      return yield* new AssetPlacement.PathError({
        path: file,
        reason: "Scanned asset path differs from its owner reference",
      })
    return yield* AssetPlacement.resolveWithin(target.root, relativePath, sources)
  })
  const load: Effect.Effect<
    {
      assets: ReadonlyMap<string, Asset.AssetSummary>
      invalid: ReadonlyMap<string, { relativePath: string; errorTag: string }>
    },
    AssetPlacement.Error
  > =
    kind === "prompt"
      ? PromptAsset.loadDir(sources.fs, target.root, validate)
      : kind === "skill"
        ? SkillAsset.loadDir(sources.fs, target.root, { target, validate })
        : kind === "command"
          ? CommandAsset.loadDir(sources.fs, target.root, { target, validate })
          : kind === "agent"
            ? AgentAsset.loadDir(sources.fs, target.root, validate)
            : kind === "mcp"
              ? MCPAsset.loadDir(sources.fs, target.root, validate)
              : kind === "workflow"
                ? WorkflowAsset.loadDir(sources.fs, target.root, validate)
                : PluginAsset.loadDir(sources.fs, target.root, validate)
  const result = yield* load
  return Schema.decodeUnknownSync(AssetPublication.Definition)({
    kind,
    target,
    assets: Array.from(result.assets.values()).map((asset) =>
      Struct.pick(asset, ["kind", "name", "description", "relativePath", "revision"]),
    ),
    invalid: Array.from(result.invalid.values()),
  })
})

function sourceError(kind: AssetPublication.Kind, error: AssetPlacement.Error) {
  if (
    error._tag !== "FileSystemError" &&
    error._tag !== "PlatformError" &&
    error._tag !== "AssetPlacement.PathError" &&
    error._tag !== "LocationMutation.PathError"
  )
    return error
  return new Asset.AssetError({
    kind,
    reason: error._tag === "FileSystemError" || error._tag === "PlatformError" ? "reload_failed" : "path_escape",
    message: `Cannot read ${kind} definition source (${error._tag})`,
  })
}

export * as AssetPublication from "./asset-publication.js"
