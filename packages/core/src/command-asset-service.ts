export * as CommandAssetService from "./command-asset-service"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Candidate, Inspection, Revision } from "@omnixa/schema/command-asset"
import { CommandAsset } from "./command-asset"
import { FileMutation } from "./file-mutation"
import { CommandAssetPath } from "./command-asset/path"
import { FSUtil } from "@omnixa/util/fs-util"
import { LocationMutation } from "./location-mutation"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Hash } from "@omnixa/util/hash"
import { yamlEscape } from "./util/yaml-escape"
import { AssetPlacement } from "./asset-placement"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "CommandAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("CommandAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "CommandAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("CommandAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "CommandAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()(
  "CommandAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "CommandAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("CommandAssetService.NotFound", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Not found: ${this.relativePath}`
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
  candidate: Candidate
  baseRevision: string | null
  overwrite: boolean
  target?: AssetPlacement.Target
}

export interface DeleteInput {
  relativePath: string
  baseRevision: string | null
  target?: AssetPlacement.Target
}

export interface InspectInput {
  candidate: Candidate
  scope: AssetPlacement.Scope
}

export type InspectError = InvalidCandidateError | AssetPlacement.Error

export type ApplyError =
  | InvalidCandidateError
  | StaleRevisionError
  | OverwriteRequiredError
  | WriteFailedError
  | ReadbackMismatchError
  | RollbackFailedError
  | ConcurrentModificationError
  | FSUtil.Error
  | AssetPlacement.Error

export type DeleteError =
  | InvalidCandidateError
  | StaleRevisionError
  | WriteFailedError
  | RollbackFailedError
  | ConcurrentModificationError
  | FSUtil.Error
  | AssetPlacement.Error

export interface Interface {
  readonly propose: (input: Candidate) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly inspect: (input: InspectInput) => Effect.Effect<Inspection, InspectError>
  readonly apply: (input: ApplyInput) => Effect.Effect<CommandAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/CommandAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const registry = yield* CommandAsset.Service
    const files = yield* FileMutation.Service
    const readBytes = (absolute: string) =>
      fs.readFile(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))

    const resolveTarget = Effect.fnUntraced(function* (relativePath: string, reviewed?: AssetPlacement.Target) {
      if (!reviewed) {
        const target = yield* CommandAssetPath.resolveSafeTarget(relativePath, mutation, fs).pipe(
          Effect.mapError((error) =>
            error instanceof CommandAssetPath.PathValidationError || error instanceof LocationMutation.PathError
              ? new InvalidCandidateError({ reason: error.reason })
              : error,
          ),
        )
        return { owner: registry, target }
      }
      const owner = yield* registry.select(reviewed.scope)
      const mismatch = AssetPlacement.targetMismatch(owner.target, reviewed)
      if (mismatch) return yield* mismatch
      const target = yield* CommandAssetPath.resolveSelectedTarget(relativePath, owner.target, mutation, fs)
      return { owner, target }
    })

    const inspectOwner = Effect.fnUntraced(function* (
      input: Candidate,
      relativePath: string,
      prepared: {
        readonly owner: CommandAsset.Interface | CommandAsset.Selected
        readonly target: LocationMutation.Target
      },
    ) {
      yield* prepared.owner.reload()
      const bytes = yield* readBytes(prepared.target.absolute)
      const existingName = yield* prepared.owner.findByName(input.name)
      const existingPath = yield* prepared.owner
        .getByPath(relativePath)
        .pipe(Effect.catchTag("CommandAsset.NotFound", () => Effect.succeed(undefined)))
      return {
        relativePath,
        exists: bytes !== null,
        revision: bytes === null ? null : Revision.make(Hash.sha256(Buffer.from(bytes))),
        nameConflict: existingName !== undefined && existingName.relativePath !== relativePath,
        pathConflict: existingPath !== undefined && existingPath.name !== input.name,
      }
    })

    const rollback = Effect.fnUntraced(function* (
      relativePath: string,
      reviewed: AssetPlacement.Target | undefined,
      previous: Uint8Array | null,
      expected: Uint8Array | null,
    ) {
      const prepared = yield* resolveTarget(relativePath, reviewed).pipe(
        Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })),
      )
      const current = yield* readBytes(prepared.target.absolute).pipe(
        Effect.mapError(() => new RollbackFailedError({ relativePath, reason: "Cannot read the rollback target" })),
      )
      if (!sameBytes(current, expected)) return yield* new ConcurrentModificationError({ relativePath })

      if (previous === null) {
        yield* files
          .remove({ target: prepared.target })
          .pipe(Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })))
      }
      if (previous !== null) {
        yield* files
          .writeAtomic({ target: prepared.target, content: previous })
          .pipe(Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })))
      }
      const restored = yield* readBytes(prepared.target.absolute).pipe(
        Effect.mapError(
          () => new RollbackFailedError({ relativePath, reason: "Cannot verify the restored command file" }),
        ),
      )
      if (!sameBytes(restored, previous))
        return yield* new RollbackFailedError({
          relativePath,
          reason: "Restored content differs from the original command file",
        })
      yield* prepared.owner
        .reload()
        .pipe(Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })))
    })

    const propose = Effect.fn("CommandAssetService.propose")(
      function* (input: Candidate) {
        const relativePath = yield* Effect.try({
          try: () => candidatePath(input, false),
          catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
        })
        const initial = yield* resolveTarget(relativePath)
        return yield* files.withLock([initial.target.absolute])(
          Effect.gen(function* () {
            const prepared = yield* resolveTarget(relativePath)
            return yield* inspectOwner(input, relativePath, prepared)
          }),
        )
      },
      Effect.mapError((error) =>
        error instanceof AssetPlacement.PathError ||
        error instanceof AssetPlacement.TargetMismatchError ||
        error instanceof LocationMutation.PathError
          ? new InvalidCandidateError({ reason: failureMessage(error) })
          : error,
      ),
    )

    const inspect = Effect.fn("CommandAssetService.inspect")(function* (input: InspectInput) {
      const relativePath = yield* Effect.try({
        try: () => candidatePath(input.candidate, true),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const owner = yield* registry.select(input.scope)
      const initial = yield* resolveTarget(relativePath, owner.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.gen(function* () {
          const prepared = yield* resolveTarget(relativePath, owner.target)
          return new Inspection({
            ...(yield* inspectOwner(input.candidate, relativePath, prepared)),
            target: owner.target,
          })
        }),
      )
    })

    const apply = Effect.fn("CommandAssetService.apply")(function* (input: ApplyInput) {
      const relativePath = yield* Effect.try({
        try: () => candidatePath(input.candidate, input.target !== undefined),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const initial = yield* resolveTarget(relativePath, input.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // The owner may have changed while this graph waited for another graph's transaction.
            const prepared = yield* resolveTarget(relativePath, input.target)
            yield* prepared.owner.reload()
            const previous = yield* readBytes(prepared.target.absolute)
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            if (input.baseRevision !== revision) return yield* new StaleRevisionError({ relativePath })
            if (previous !== null && !input.overwrite) return yield* new OverwriteRequiredError({ relativePath })

            const argsLine = input.candidate.args !== undefined ? `args: ${yamlEscape(input.candidate.args)}\n` : ""
            const frontmatter = `---\nkind: command\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}\ninvocation: ${yamlEscape(input.candidate.invocation)}\n${argsLine}---\n`
            // Hash intended bytes before the first readback, including a readback that fails.
            const expected = new TextEncoder().encode(frontmatter + input.candidate.source)
            const writtenRevision = Hash.sha256(Buffer.from(expected))
            yield* files
              .writeAtomic({ target: prepared.target, content: expected })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))

            return yield* Effect.gen(function* () {
              const bytes = yield* readBytes(prepared.target.absolute).pipe(
                Effect.mapError(
                  (error) =>
                    new WriteFailedError({ relativePath, reason: `Readback failed: ${failureMessage(error)}` }),
                ),
              )
              if (!sameBytes(bytes, expected)) return yield* new ReadbackMismatchError({ relativePath })
              yield* prepared.owner
                .reload()
                .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))
              const info = yield* prepared.owner
                .getByPath(relativePath)
                .pipe(Effect.mapError(() => new ReadbackMismatchError({ relativePath })))
              if (
                info.kind !== "command" ||
                info.relativePath !== relativePath ||
                info.revision !== writtenRevision ||
                info.name !== input.candidate.name ||
                info.description !== input.candidate.description ||
                info.invocation !== input.candidate.invocation ||
                info.args !== input.candidate.args ||
                info.source !== input.candidate.source ||
                (input.target
                  ? info.target === undefined || AssetPlacement.targetMismatch(input.target, info.target) !== undefined
                  : info.target !== undefined)
              )
                return yield* new ReadbackMismatchError({ relativePath })
              return info
            }).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  yield* rollback(relativePath, input.target, previous, expected)
                  return yield* error
                }),
              ),
            )
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("CommandAssetService.delete")(function* (input: DeleteInput) {
      const relativePath = yield* Effect.try({
        try: () => CommandAssetPath.validateRelativePath(input.relativePath),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const initial = yield* resolveTarget(relativePath, input.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const prepared = yield* resolveTarget(relativePath, input.target)
            yield* prepared.owner.reload()
            const previous = yield* readBytes(prepared.target.absolute).pipe(
              Effect.mapError(
                (error) =>
                  new WriteFailedError({ relativePath, reason: `Read before delete failed: ${failureMessage(error)}` }),
              ),
            )
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            // Old callers retain unconditional null revisions and idempotent deletion of a missing file.
            if (
              input.baseRevision !== revision &&
              (input.target !== undefined || (previous !== null && input.baseRevision !== null))
            )
              return yield* new StaleRevisionError({ relativePath })
            if (previous === null) return

            yield* files
              .remove({ target: prepared.target })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))
            yield* Effect.gen(function* () {
              const bytes = yield* readBytes(prepared.target.absolute).pipe(
                Effect.mapError(
                  (error) =>
                    new WriteFailedError({
                      relativePath,
                      reason: `Read after delete failed: ${failureMessage(error)}`,
                    }),
                ),
              )
              if (bytes !== null) return yield* new ConcurrentModificationError({ relativePath })
              yield* prepared.owner
                .reload()
                .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))
              const present = yield* prepared.owner
                .getByPath(relativePath)
                .pipe(Effect.catchTag("CommandAsset.NotFound", () => Effect.succeed(undefined)))
              if (present) return yield* new ConcurrentModificationError({ relativePath })
            }).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  yield* rollback(relativePath, input.target, previous, null)
                  return yield* error
                }),
              ),
            )
          }),
        ),
      )
    })

    return Service.of({ propose, inspect, apply, delete: deleteAsset })
  }),
)

export const layer = locationLayer

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [FSUtil.node, LocationMutation.node, CommandAsset.node, FileMutation.node],
})

function candidatePath(input: Candidate, reviewed: boolean) {
  const relativePath = CommandAssetPath.validateRelativePath(
    path.basename(CommandAssetPath.nameToRelativePath(input.name)),
  )
  if (reviewed && input.relativePath !== relativePath)
    throw new InvalidCandidateError({ reason: "Candidate path does not match the reviewed command name" })
  return relativePath
}

function sameBytes(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
