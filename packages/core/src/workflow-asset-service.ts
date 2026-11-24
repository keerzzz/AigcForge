export * as WorkflowAssetService from "./workflow-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Candidate, StepDef, validateGraph } from "@omnixa/schema/workflow-asset"
import { FSUtil } from "@omnixa/util/fs-util"
import { Hash } from "@omnixa/util/hash"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { FileMutation } from "./file-mutation"
import { LocationMutation } from "./location-mutation"
import { WorkflowAsset } from "./workflow-asset"
import { WorkflowAssetPath } from "./workflow-asset/path"

const sameSteps = Schema.toEquivalence(Schema.Array(StepDef))

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "WorkflowAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("WorkflowAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "WorkflowAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("WorkflowAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "WorkflowAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()(
  "WorkflowAssetService.RollbackFailed",
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
  "WorkflowAssetService.ConcurrentModification",
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
  readonly apply: (input: ApplyInput) => Effect.Effect<WorkflowAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/WorkflowAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const registry = yield* WorkflowAsset.Service
    const files = yield* FileMutation.Service
    const readBytes = (absolute: string) =>
      fs.readFile(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))
    const resolveTarget = (relativePath: string) =>
      WorkflowAssetPath.resolveSafeTarget(relativePath, mutation).pipe(
        Effect.mapError((error) =>
          error instanceof WorkflowAssetPath.PathValidationError || error instanceof LocationMutation.PathError
            ? new InvalidCandidateError({ reason: error.reason })
            : error,
        ),
      )

    const prepare = Effect.fnUntraced(function* (input: Candidate) {
      if (new TextEncoder().encode(input.content).length > 100_000)
        return yield* new InvalidCandidateError({ reason: "Workflow content exceeds maximum 100000 UTF-8 bytes." })
      const parsed = WorkflowAsset.parseContent(input.content)
      if (parsed.kind === "invalid")
        return yield* new InvalidCandidateError({ reason: `Invalid workflow content: ${parsed.errorTag}` })
      if (parsed.value.name !== input.name || parsed.value.description !== input.description)
        return yield* new InvalidCandidateError({ reason: "Candidate name or description does not match its YAML" })

      const graph = validateGraph(parsed.value.steps)
      if (!graph.valid)
        return yield* new InvalidCandidateError({
          reason: `Invalid workflow graph: ${graph.errors.map((error) => error.message).join("; ")}`,
        })

      const relativePath = yield* Effect.try({
        try: () =>
          WorkflowAssetPath.validateRelativePath(path.basename(WorkflowAssetPath.nameToRelativePath(input.name))),
        catch: () => new InvalidCandidateError({ reason: "Invalid workflow name or path" }),
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
              () => new RollbackFailedError({ relativePath, reason: "Cannot remove the new workflow file" }),
            ),
          )
      }
      if (previous !== null) {
        yield* files
          .writeAtomic({ target, content: previous })
          .pipe(
            Effect.mapError(
              () => new RollbackFailedError({ relativePath, reason: "Cannot restore the previous workflow file" }),
            ),
          )
      }

      const restored = yield* readBytes(target.absolute).pipe(
        Effect.mapError(
          () => new RollbackFailedError({ relativePath, reason: "Cannot verify the restored workflow file" }),
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
            () => new RollbackFailedError({ relativePath, reason: "Cannot reload the restored workflow registry" }),
          ),
        )
    })

    const propose = Effect.fn("WorkflowAssetService.propose")(function* (input: Candidate) {
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

    const apply = Effect.fn("WorkflowAssetService.apply")(function* (input: ApplyInput) {
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
                Effect.mapError(() => new WriteFailedError({ relativePath, reason: "Cannot write the workflow file" })),
              )

            return yield* Effect.gen(function* () {
              const bytes = yield* readBytes(target.absolute).pipe(
                Effect.mapError(
                  () => new WriteFailedError({ relativePath, reason: "Cannot read the written workflow file" }),
                ),
              )
              if (!sameBytes(bytes, expected)) return yield* new ReadbackMismatchError({ relativePath })
              yield* registry
                .reload()
                .pipe(
                  Effect.mapError(
                    () => new WriteFailedError({ relativePath, reason: "Cannot reload the workflow registry" }),
                  ),
                )
              const info = yield* registry
                .getByPath(relativePath)
                .pipe(Effect.mapError(() => new ReadbackMismatchError({ relativePath })))
              const declaration = prepared.declaration
              const triggers = declaration.triggers ?? []
              if (
                info.kind !== "workflow" ||
                info.relativePath !== relativePath ||
                info.revision !== writtenRevision ||
                info.content !== input.candidate.content ||
                info.name !== declaration.name ||
                info.description !== declaration.description ||
                info.version !== declaration.version ||
                info.triggers.length !== triggers.length ||
                info.triggers.some((trigger, index) => trigger !== triggers[index]) ||
                !sameSteps(info.steps, declaration.steps)
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

    const deleteAsset = Effect.fn("WorkflowAssetService.delete")(function* (input: DeleteInput) {
      const relativePath = yield* Effect.try({
        try: () => WorkflowAssetPath.validateRelativePath(input.relativePath),
        catch: () => new InvalidCandidateError({ reason: "Invalid workflow path" }),
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
                Effect.mapError(
                  () => new WriteFailedError({ relativePath, reason: "Cannot delete the workflow file" }),
                ),
              )
            yield* Effect.gen(function* () {
              if ((yield* readBytes(target.absolute)) !== null)
                return yield* new ConcurrentModificationError({ relativePath })
              yield* registry
                .reload()
                .pipe(
                  Effect.mapError(
                    () => new WriteFailedError({ relativePath, reason: "Cannot reload after workflow deletion" }),
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
  deps: [FSUtil.node, LocationMutation.node, WorkflowAsset.node, FileMutation.node],
})

function sameBytes(left: Uint8Array | null, right: Uint8Array | null) {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}
