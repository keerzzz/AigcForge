export * as PluginAssetService from "./plugin-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import type { Candidate } from "@omnixa/schema/plugin-asset"
import { FSUtil } from "@omnixa/util/fs-util"
import { Hash } from "@omnixa/util/hash"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { FileMutation } from "./file-mutation"
import { LocationMutation } from "./location-mutation"
import { PluginAsset } from "./plugin-asset"
import { PluginAssetPath } from "./plugin-asset/path"

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "PluginAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("PluginAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "PluginAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("PluginAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "PluginAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()(
  "PluginAssetService.RollbackFailed",
  {
    relativePath: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "PluginAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export interface ProposeResult {
  readonly relativePath: string
  readonly exists: boolean
  readonly revision: string | null
  readonly nameConflict: boolean
  readonly pathConflict: boolean
}

export interface ApplyInput {
  readonly candidate: Candidate
  readonly baseRevision: string | null
  readonly overwrite: boolean
}

export interface DeleteInput {
  readonly relativePath: string
  readonly baseRevision: string | null
}

export type ApplyError =
  | InvalidCandidateError
  | StaleRevisionError
  | OverwriteRequiredError
  | WriteFailedError
  | ReadbackMismatchError
  | RollbackFailedError
  | ConcurrentModificationError
  | FSUtil.Error

export type DeleteError =
  | InvalidCandidateError
  | StaleRevisionError
  | WriteFailedError
  | ReadbackMismatchError
  | RollbackFailedError
  | ConcurrentModificationError
  | FSUtil.Error

export interface Interface {
  readonly propose: (input: Candidate) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<PluginAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/PluginAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const registry = yield* PluginAsset.Service
    const files = yield* FileMutation.Service
    const readBytes = (absolute: string) =>
      fs.readFile(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))
    const resolveTarget = (relativePath: string) =>
      PluginAssetPath.resolveSafeTarget(relativePath, mutation).pipe(
        Effect.mapError((error) =>
          error instanceof PluginAssetPath.PathValidationError || error instanceof LocationMutation.PathError
            ? new InvalidCandidateError({ reason: error.reason })
            : error,
        ),
      )

    const prepare = Effect.fnUntraced(function* (input: Candidate) {
      const parsed = PluginAsset.parseContent(input.content)
      if (parsed.kind === "invalid")
        return yield* new InvalidCandidateError({ reason: `Invalid plugin content: ${parsed.errorTag}` })
      if (parsed.value.name !== input.name || parsed.value.description !== input.description)
        return yield* new InvalidCandidateError({ reason: "Candidate name or description does not match its YAML" })

      const relativePath = yield* Effect.try({
        try: () => PluginAssetPath.validateRelativePath(path.basename(PluginAssetPath.nameToRelativePath(input.name))),
        catch: () => new InvalidCandidateError({ reason: "Invalid plugin name or path" }),
      })
      if (input.relativePath !== undefined && input.relativePath !== "" && input.relativePath !== relativePath)
        return yield* new InvalidCandidateError({ reason: "Candidate target does not match its name" })

      return { relativePath, declaration: parsed.value, target: yield* resolveTarget(relativePath) }
    })

    const rollback = Effect.fnUntraced(function* (
      target: LocationMutation.Target,
      relativePath: string,
      previous: Uint8Array | null,
      expected: Uint8Array | null,
    ) {
      const current = yield* readBytes(target.absolute).pipe(
        Effect.mapError(() => new RollbackFailedError({ relativePath, reason: "Cannot read the rollback target" })),
      )
      if (!sameBytes(current, expected)) return yield* new ConcurrentModificationError({ relativePath })

      if (previous === null) {
        yield* files
          .remove({ target })
          .pipe(
            Effect.mapError(
              () => new RollbackFailedError({ relativePath, reason: "Cannot remove the new plugin file" }),
            ),
          )
      }
      if (previous !== null) {
        yield* files
          .writeAtomic({ target, content: previous })
          .pipe(
            Effect.mapError(
              () => new RollbackFailedError({ relativePath, reason: "Cannot restore the previous plugin file" }),
            ),
          )
      }

      const restored = yield* readBytes(target.absolute).pipe(
        Effect.mapError(
          () => new RollbackFailedError({ relativePath, reason: "Cannot verify the restored plugin file" }),
        ),
      )
      if (!sameBytes(restored, previous))
        return yield* new RollbackFailedError({
          relativePath,
          reason: "Restored content does not match the original file",
        })
      yield* registry
        .reload()
        .pipe(
          Effect.mapError(
            () => new RollbackFailedError({ relativePath, reason: "Cannot reload the restored plugin registry" }),
          ),
        )
    })

    const propose = Effect.fn("PluginAssetService.propose")(function* (input: Candidate) {
      const prepared = yield* prepare(input)
      return yield* files.withLock([prepared.target.absolute])(
        Effect.gen(function* () {
          yield* registry.reload()
          const bytes = yield* readBytes(prepared.target.absolute)
          const existingName = yield* registry.findByName(input.name)
          const existingPath = yield* registry.getByPath(prepared.relativePath).pipe(Effect.option)
          return {
            relativePath: prepared.relativePath,
            exists: bytes !== null,
            revision: bytes === null ? null : Hash.sha256(Buffer.from(bytes)),
            nameConflict: existingName !== undefined && existingName.relativePath !== prepared.relativePath,
            pathConflict: bytes !== null && Option.isSome(existingPath) && existingPath.value.name !== input.name,
          } satisfies ProposeResult
        }),
      )
    })

    const apply = Effect.fn("PluginAssetService.apply")(function* (input: ApplyInput) {
      const prepared = yield* prepare(input.candidate)
      const relativePath = prepared.relativePath
      const target = prepared.target
      return yield* files.withLock([target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const previous = yield* readBytes(target.absolute)
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            if (input.baseRevision !== revision) return yield* new StaleRevisionError({ relativePath })
            if (previous !== null && !input.overwrite) return yield* new OverwriteRequiredError({ relativePath })

            // Compute the intended bytes before writing, so even the first failed readback can roll back safely.
            const expected = new TextEncoder().encode(input.candidate.content)
            const writtenRevision = Hash.sha256(Buffer.from(expected))
            yield* files
              .writeAtomic({ target, content: expected })
              .pipe(
                Effect.mapError(() => new WriteFailedError({ relativePath, reason: "Cannot write the plugin file" })),
              )

            return yield* Effect.gen(function* () {
              const bytes = yield* readBytes(target.absolute).pipe(
                Effect.mapError(
                  () => new WriteFailedError({ relativePath, reason: "Cannot read the written plugin file" }),
                ),
              )
              if (!sameBytes(bytes, expected)) return yield* new ReadbackMismatchError({ relativePath })
              yield* registry
                .reload()
                .pipe(
                  Effect.mapError(
                    () => new WriteFailedError({ relativePath, reason: "Cannot reload the plugin registry" }),
                  ),
                )
              const info = yield* registry
                .getByPath(relativePath)
                .pipe(Effect.mapError(() => new ReadbackMismatchError({ relativePath })))
              const declaration = prepared.declaration
              const hooks = declaration.hooks ?? []
              if (
                info.kind !== "plugin" ||
                info.relativePath !== relativePath ||
                info.revision !== writtenRevision ||
                info.content !== input.candidate.content ||
                info.name !== declaration.name ||
                info.description !== declaration.description ||
                info.version !== declaration.version ||
                info.category !== declaration.category ||
                info.author?.name !== declaration.author?.name ||
                info.author?.email !== declaration.author?.email ||
                info.source?.type !== declaration.source?.type ||
                info.source?.mcp?.name !== declaration.source?.mcp?.name ||
                info.source?.openapi?.url !== declaration.source?.openapi?.url ||
                info.hooks.length !== hooks.length ||
                info.hooks.some(
                  (hook, index) =>
                    hook.event !== hooks[index].event ||
                    hook.command !== hooks[index].command ||
                    !Object.is(hook.timeout, hooks[index].timeout),
                )
              )
                return yield* new ReadbackMismatchError({ relativePath })
              return info
            }).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  yield* rollback(target, relativePath, previous, expected)
                  return yield* Effect.fail(error)
                }),
              ),
            )
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("PluginAssetService.delete")(function* (input: DeleteInput) {
      const relativePath = yield* Effect.try({
        try: () => PluginAssetPath.validateRelativePath(input.relativePath),
        catch: () => new InvalidCandidateError({ reason: "Invalid plugin path" }),
      })
      const target = yield* resolveTarget(relativePath)
      return yield* files.withLock([target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const previous = yield* readBytes(target.absolute)
            if (previous === null) {
              if (input.baseRevision !== null) return yield* new StaleRevisionError({ relativePath })
              yield* registry.reload()
              return
            }
            if (input.baseRevision !== Hash.sha256(Buffer.from(previous)))
              return yield* new StaleRevisionError({ relativePath })

            yield* files
              .remove({ target })
              .pipe(
                Effect.mapError(() => new WriteFailedError({ relativePath, reason: "Cannot delete the plugin file" })),
              )
            yield* Effect.gen(function* () {
              if ((yield* readBytes(target.absolute)) !== null)
                return yield* new ConcurrentModificationError({ relativePath })
              yield* registry
                .reload()
                .pipe(
                  Effect.mapError(
                    () => new WriteFailedError({ relativePath, reason: "Cannot reload after plugin deletion" }),
                  ),
                )
              const present = yield* registry.getByPath(relativePath).pipe(Effect.option)
              if (Option.isSome(present)) return yield* new ReadbackMismatchError({ relativePath })
            }).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  yield* rollback(target, relativePath, previous, null)
                  return yield* Effect.fail(error)
                }),
              ),
            )
          }),
        ),
      )
    })

    return Service.of({ propose, apply, delete: deleteAsset })
  }),
)

export const layer = locationLayer

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [FSUtil.node, LocationMutation.node, PluginAsset.node, FileMutation.node],
})

function sameBytes(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
