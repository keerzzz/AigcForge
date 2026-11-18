import path from "path"
import { Effect, Schema } from "effect"
import { Scope, Target } from "@aigcfroge/schema/asset-placement"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { COMMANDS_DIR, PROMPTS_DIR, SKILLS_DIR } from "./constants"

export { Scope, Target }

export class PathError extends Schema.TaggedError<PathError>()("AssetPlacement.PathError", {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class TargetMismatchError extends Schema.TaggedError<TargetMismatchError>()("AssetPlacement.TargetMismatch", {
  expected: Target,
  actual: Target,
}) {
  override get message() {
    return "The selected asset owner has changed; inspect and confirm the target again"
  }
}

export type Error = PathError | TargetMismatchError | LocationMutation.PathError | FSUtil.Error

interface Sources {
  readonly fs: FSUtil.Interface
  readonly mutation: LocationMutation.Interface
  readonly location: Location.Interface
  readonly global: Global.Interface
}

/** The server chooses the directory from a finite scope; a reviewed root only proves equality. */
export const resolve = Effect.fn("AssetPlacement.resolve")(function* (
  scope: Scope,
  sources: Sources,
  reviewed?: Target,
  family: "skill" | "command" | "prompt" = "skill",
) {
  const directory =
    scope === "global"
      ? sources.global.config
      : scope === "project"
        ? sources.location.project.directory
        : sources.location.directory
  // A configured base may itself be an alias. Descendants must not redirect out of that canonical base.
  const base = yield* sources.fs
    .realPath(directory)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        sources.mutation.resolve({ path: directory, kind: "directory" }).pipe(Effect.map((value) => value.absolute)),
      ),
    )
  const ownerDirectory = family === "command" ? COMMANDS_DIR : family === "prompt" ? PROMPTS_DIR : SKILLS_DIR
  const owner = yield* resolveWithin(
    AbsolutePath.make(base),
    scope === "global" ? path.basename(ownerDirectory) : ownerDirectory,
    sources,
    "directory",
  )
  const target = new Target({ scope, root: owner.absolute })
  const mismatch = reviewed && targetMismatch(target, reviewed)
  if (mismatch) return yield* mismatch
  return target
})

export function targetMismatch(expected: Target, actual: Target) {
  if (expected.scope !== actual.scope || expected.root !== actual.root)
    return new TargetMismatchError({ expected, actual })
}

/** Resolve beneath a server-derived canonical owner, rejecting redirects including dangling symlinks. */
export const resolveWithin = Effect.fn("AssetPlacement.resolveWithin")(function* (
  root: AbsolutePath,
  relativePath: string,
  sources: Pick<Sources, "fs" | "mutation">,
  kind: "file" | "directory" = "file",
) {
  const segments = relativePath.replaceAll("\\", "/").split("/")
  if (path.isAbsolute(relativePath) || segments.some((part) => part === "" || part === "." || part === ".."))
    return yield* new PathError({ path: relativePath, reason: "Asset path must stay below its owner" })

  // realPath alone treats a dangling symlink as a missing file. Inspect directory entries before resolving it.
  yield* Effect.forEach(segments, (_, index) =>
    Effect.gen(function* () {
      const parent = path.join(root, ...segments.slice(0, index))
      const info = yield* sources.fs
        .stat(parent)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!info) return
      if (info.type !== "Directory")
        return yield* new PathError({ path: parent, reason: "Asset path has a non-directory ancestor" })
      const entries = yield* sources.fs.readDirectoryEntries(parent)
      if (entries.some((entry) => entry.name === segments[index] && entry.type === "symlink"))
        return yield* new PathError({
          path: path.join(parent, segments[index]),
          reason: "Asset path must not redirect through a symlink",
        })
    }),
  )

  const absolute = path.resolve(root, ...segments)
  const target = yield* sources.mutation.resolve({ path: absolute, kind })
  if (target.absolute !== absolute)
    return yield* new PathError({ path: relativePath, reason: "Canonical asset path differs from its selected owner" })
  const info = yield* sources.fs
    .stat(absolute)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (info && info.type !== (kind === "directory" ? "Directory" : "File"))
    return yield* new PathError({ path: absolute, reason: `Asset path must be a ${kind}` })
  return target
})

export * as AssetPlacement from "./asset-placement"
