export * as SkillAssetService from "./skill-asset-service"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Candidate, Inspection, Revision } from "@omnixa/schema/skill-asset"
import { SkillAsset } from "./skill-asset"
import { FileMutation } from "./file-mutation"
import { SkillAssetPath } from "./skill-asset/path"
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
  "SkillAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("SkillAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "SkillAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("SkillAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "SkillAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()("SkillAssetService.RollbackFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "SkillAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("SkillAssetService.NotFound", {
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
  readonly apply: (input: ApplyInput) => Effect.Effect<SkillAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/SkillAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const registry = yield* SkillAsset.Service
    const files = yield* FileMutation.Service
    const readBytes = (absolute: string) =>
      fs.readFile(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))

    const resolveTarget = Effect.fnUntraced(function* (relativePath: string, reviewed?: AssetPlacement.Target) {
      if (!reviewed) {
        const target = yield* SkillAssetPath.resolveSafeTarget(relativePath, mutation, fs).pipe(
          Effect.mapError((error) =>
            error instanceof SkillAssetPath.PathValidationError || error instanceof LocationMutation.PathError
              ? new InvalidCandidateError({ reason: error.reason })
              : error,
          ),
        )
        return { owner: registry, target }
      }
      const owner = yield* registry.select(reviewed.scope)
      const mismatch = AssetPlacement.targetMismatch(owner.target, reviewed)
      if (mismatch) return yield* mismatch
      const target = yield* SkillAssetPath.resolveSelectedTarget(relativePath, owner.target, mutation, fs)
      return { owner, target }
    })

    const inspectOwner = Effect.fnUntraced(function* (
      input: Candidate,
      relativePath: string,
      prepared: {
        readonly owner: SkillAsset.Interface | SkillAsset.Selected
        readonly target: LocationMutation.Target
      },
    ) {
      yield* prepared.owner.reload()
      const bytes = yield* readBytes(prepared.target.absolute)
      const existingName = yield* prepared.owner.findByName(input.name)
      const existingPath = yield* prepared.owner
        .getByPath(relativePath)
        .pipe(Effect.catchTag("SkillAsset.NotFound", () => Effect.succeed(undefined)))
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
          () => new RollbackFailedError({ relativePath, reason: "Cannot verify the restored skill file" }),
        ),
      )
      if (!sameBytes(restored, previous))
        return yield* new RollbackFailedError({
          relativePath,
          reason: "Restored content differs from the original skill file",
        })
      yield* prepared.owner
        .reload()
        .pipe(Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })))
    })

    const propose = Effect.fn("SkillAssetService.propose")(
      function* (input: Candidate) {
        const relativePath = yield* Effect.try({
          try: () => candidatePath(input, false),
          catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
        })
        const prepared = yield* resolveTarget(relativePath)
        return yield* files.withLock([prepared.target.absolute])(inspectOwner(input, relativePath, prepared))
      },
      Effect.mapError((error) =>
        error instanceof AssetPlacement.PathError ||
        error instanceof AssetPlacement.TargetMismatchError ||
        error instanceof LocationMutation.PathError
          ? new InvalidCandidateError({ reason: failureMessage(error) })
          : error,
      ),
    )

    const inspect = Effect.fn("SkillAssetService.inspect")(function* (input: InspectInput) {
      const relativePath = yield* Effect.try({
        try: () => candidatePath(input.candidate, true),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const owner = yield* registry.select(input.scope)
      const prepared = yield* resolveTarget(relativePath, owner.target)
      return yield* files.withLock([prepared.target.absolute])(
        inspectOwner(input.candidate, relativePath, prepared).pipe(
          Effect.map((facts) => new Inspection({ ...facts, target: owner.target })),
        ),
      )
    })

    const apply = Effect.fn("SkillAssetService.apply")(function* (input: ApplyInput) {
      const relativePath = yield* Effect.try({
        try: () => candidatePath(input.candidate, true),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const initial = yield* resolveTarget(relativePath, input.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // Revalidate the owner after waiting for the shared absolute lock.
            const prepared = yield* resolveTarget(relativePath, input.target)
            yield* prepared.owner.reload()
            const previous = yield* readBytes(prepared.target.absolute)
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            if (input.baseRevision !== revision) return yield* new StaleRevisionError({ relativePath })
            if (previous !== null && !input.overwrite) return yield* new OverwriteRequiredError({ relativePath })

            const frontmatter = [
              "---",
              `name: ${yamlEscape(input.candidate.name)}`,
              `description: ${yamlEscape(input.candidate.description)}`,
              ...(input.candidate.slash ? ["slash: true"] : []),
              ...(input.candidate.triggers.length
                ? ["triggers:", ...input.candidate.triggers.map((value) => `- ${yamlEscape(value)}`)]
                : []),
              ...(input.candidate.tags.length
                ? ["tags:", ...input.candidate.tags.map((value) => `- ${yamlEscape(value)}`)]
                : []),
              "---",
              "",
            ].join("\n")
            // Intended bytes are known before the first readback, including a readback that fails.
            const expected = new TextEncoder().encode(frontmatter + input.candidate.content)
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
                info.kind !== "skill" ||
                info.relativePath !== relativePath ||
                info.revision !== writtenRevision ||
                info.content !== input.candidate.content ||
                info.name !== input.candidate.name ||
                info.description !== input.candidate.description ||
                info.slash !== input.candidate.slash ||
                info.triggers.length !== input.candidate.triggers.length ||
                info.triggers.some((value, index) => value !== input.candidate.triggers[index]) ||
                info.tags.length !== input.candidate.tags.length ||
                info.tags.some((value, index) => value !== input.candidate.tags[index])
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

    const deleteAsset = Effect.fn("SkillAssetService.delete")(function* (input: DeleteInput) {
      const relativePath = yield* Effect.try({
        try: () => SkillAssetPath.validateRelativePath(input.relativePath),
        catch: (error) => new InvalidCandidateError({ reason: failureMessage(error) }),
      })
      const initial = yield* resolveTarget(relativePath, input.target)
      return yield* files.withLock([initial.target.absolute])(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const prepared = yield* resolveTarget(relativePath, input.target)
            yield* prepared.owner.reload()
            const previous = yield* readBytes(prepared.target.absolute)
            const revision = previous === null ? null : Hash.sha256(Buffer.from(previous))
            if (input.baseRevision !== revision) return yield* new StaleRevisionError({ relativePath })
            if (previous === null) return

            yield* files
              .remove({ target: prepared.target })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))
            yield* Effect.gen(function* () {
              if ((yield* readBytes(prepared.target.absolute)) !== null)
                return yield* new ConcurrentModificationError({ relativePath })
              yield* prepared.owner
                .reload()
                .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))
              const present = yield* prepared.owner
                .getByPath(relativePath)
                .pipe(Effect.catchTag("SkillAsset.NotFound", () => Effect.succeed(undefined)))
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
  deps: [FSUtil.node, LocationMutation.node, SkillAsset.node, FileMutation.node],
})

function candidatePath(input: Candidate, reviewed: boolean) {
  const relativePath = SkillAssetPath.validateRelativePath(path.basename(SkillAssetPath.nameToRelativePath(input.name)))
  if (reviewed && input.relativePath !== relativePath)
    throw new InvalidCandidateError({ reason: "Candidate path does not match the reviewed skill name" })
  return relativePath
}

function sameBytes(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
