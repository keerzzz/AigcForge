export * as PromptAssetService from "./prompt-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Candidate, Inspection, Revision } from "@omnixa/schema/prompt-asset"
import { PromptAsset } from "./prompt-asset"
import { FileMutation } from "./file-mutation"
import { PromptAssetPath } from "./prompt-asset/path"
import { FSUtil } from "@omnixa/util/fs-util"
import { LocationMutation } from "./location-mutation"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Hash } from "@omnixa/util/hash"
import { Bus } from "./bus"
import { yamlEscape } from "./util/yaml-escape"
import { AssetPlacement } from "./asset-placement"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** M2 埋点（PRD §12）：资产落盘成功时上报，payload 不含正文。Work 与 Chat 入口共用。 */
export const Event = {
  AssetSaved: Bus.ephemeral({
    type: "work.asset_saved",
    schema: {
      relativePath: Schema.String,
    },
  }),
}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "PromptAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("PromptAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "PromptAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("PromptAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "PromptAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()(
  "PromptAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "PromptAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PromptAssetService.NotFound", {
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
  readonly apply: (input: ApplyInput) => Effect.Effect<PromptAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/PromptAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const registry = yield* PromptAsset.Service
    const files = yield* FileMutation.Service
    const eventsOpt = yield* Effect.serviceOption(Bus.Service)
    const readBytes = (absolute: string) =>
      fs.readFile(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))

    const resolveTarget = Effect.fnUntraced(function* (relativePath: string, reviewed?: AssetPlacement.Target) {
      if (!reviewed) {
        const target = yield* PromptAssetPath.resolveSafeTarget(relativePath, mutation, fs).pipe(
          Effect.mapError((error) =>
            error instanceof PromptAssetPath.PathValidationError || error instanceof LocationMutation.PathError
              ? new InvalidCandidateError({ reason: error.reason })
              : error,
          ),
        )
        return { owner: registry, target }
      }
      const owner = yield* registry.select(reviewed.scope)
      const mismatch = AssetPlacement.targetMismatch(owner.target, reviewed)
      if (mismatch) return yield* mismatch
      const target = yield* PromptAssetPath.resolveSelectedTarget(relativePath, owner.target, mutation, fs)
      return { owner, target }
    })

    const inspectOwner = Effect.fnUntraced(function* (
      input: Candidate,
      relativePath: string,
      prepared: {
        readonly owner: PromptAsset.Interface | PromptAsset.Selected
        readonly target: LocationMutation.Target
      },
    ) {
      yield* prepared.owner.reload()
      const bytes = yield* readBytes(prepared.target.absolute)
      const existingName = yield* prepared.owner.findByName(input.name)
      const existingPath = yield* prepared.owner
        .getByPath(relativePath)
        .pipe(Effect.catchTag("PromptAsset.NotFound", () => Effect.succeed(undefined)))
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
          () => new RollbackFailedError({ relativePath, reason: "Cannot verify the restored prompt file" }),
        ),
      )
      if (!sameBytes(restored, previous))
        return yield* new RollbackFailedError({
          relativePath,
          reason: "Restored content differs from the original prompt file",
        })
      yield* prepared.owner
        .reload()
        .pipe(Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })))
    })

    const propose = Effect.fn("PromptAssetService.propose")(
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

    const inspect = Effect.fn("PromptAssetService.inspect")(function* (input: InspectInput) {
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

    const apply = Effect.fn("PromptAssetService.apply")(function* (input: ApplyInput) {
      const relativePath = yield* Effect.try({
        try: () => candidatePath(input.candidate, input.target !== undefined),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const initial = yield* resolveTarget(relativePath, input.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // Recompute placement after waiting for another Location graph's transaction.
            const prepared = yield* resolveTarget(relativePath, input.target)
            yield* prepared.owner.reload()
            const previous = yield* readBytes(prepared.target.absolute)
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            if (input.baseRevision !== revision) return yield* new StaleRevisionError({ relativePath })
            if (previous !== null && !input.overwrite) return yield* new OverwriteRequiredError({ relativePath })

            const frontmatter = `---\nkind: prompt\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}\n---\n`
            // Establish rollback ownership before any readback, including one that fails.
            const expected = new TextEncoder().encode(frontmatter + input.candidate.template)
            const writtenRevision = Hash.sha256(Buffer.from(expected))
            yield* files
              .writeAtomic({ target: prepared.target, content: expected })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))

            const info = yield* Effect.gen(function* () {
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
                info.kind !== "prompt" ||
                info.relativePath !== relativePath ||
                info.revision !== writtenRevision ||
                info.name !== input.candidate.name ||
                info.description !== input.candidate.description ||
                info.template !== input.candidate.template ||
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

            if (Option.isSome(eventsOpt)) {
              yield* eventsOpt.value.publish(Event.AssetSaved, { relativePath })
            }
            return info
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("PromptAssetService.delete")(function* (input: DeleteInput) {
      const relativePath = yield* Effect.try({
        try: () => PromptAssetPath.validateRelativePath(input.relativePath),
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
            // Legacy null revisions remain unconditional; missing legacy files remain idempotent.
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
                .pipe(Effect.catchTag("PromptAsset.NotFound", () => Effect.succeed(undefined)))
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
  deps: [FSUtil.node, LocationMutation.node, PromptAsset.node, FileMutation.node],
})

function candidatePath(input: Candidate, reviewed: boolean) {
  const relativePath = PromptAssetPath.validateRelativePath(
    path.basename(PromptAssetPath.nameToRelativePath(input.name)),
  )
  if (reviewed && input.relativePath !== relativePath)
    throw new InvalidCandidateError({ reason: "Candidate path does not match the reviewed prompt name" })
  return relativePath
}

function sameBytes(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
