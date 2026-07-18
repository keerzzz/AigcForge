export * as PromptAssetService from "./prompt-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset"
import { PromptAsset } from "./prompt-asset"
import { FileMutation } from "./file-mutation"
import { nameToRelativePath, resolveOwnerRoot, validateRelativePath } from "./prompt-asset/path"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"

function yamlEscape(value: string): string {
  // YAML double-quoted string: escape \, ", \n, \t
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`
}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "PromptAssetService.InvalidCandidate",
  { reason: Schema.String },
) {}

export class PermissionDeniedError extends Schema.TaggedErrorClass<PermissionDeniedError>()(
  "PromptAssetService.PermissionDenied",
  { action: Schema.String, resource: Schema.String },
) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()(
  "PromptAssetService.StaleRevision",
  { relativePath: Schema.String },
) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "PromptAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()(
  "PromptAssetService.WriteFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {}

export class ReadbackMismatchError extends Schema.TaggedErrorClass<ReadbackMismatchError>()(
  "PromptAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {}

export class RollbackFailedError extends Schema.TaggedErrorClass<RollbackFailedError>()(
  "PromptAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {}

export class ConcurrentModificationError extends Schema.TaggedErrorClass<ConcurrentModificationError>()(
  "PromptAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {}

export interface ProposeResult {
  readonly relativePath: string
  readonly exists: boolean
  readonly revision: string | null
  readonly nameConflict: boolean
  readonly pathConflict: boolean
}

export interface ApplyInput {
  candidate: SchemaPromptAsset.Candidate
  baseRevision: string | null
  overwrite: boolean
}

export interface Interface {
  readonly propose: (input: SchemaPromptAsset.Candidate) => Effect.Effect<ProposeResult, InvalidCandidateError>
  readonly apply: (input: ApplyInput) => Effect.Effect<PromptAsset.Info, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PromptAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const registry = yield* PromptAsset.Service
    const fileMutation = yield* FileMutation.Service

    const ownerRoot = resolveOwnerRoot(location.directory)
    const locks = KeyedMutex.makeUnsafe<string>()

    const propose = Effect.fn("PromptAssetService.propose")(function* (input: SchemaPromptAsset.Candidate) {
      let filename: string
      try {
        const relPath = nameToRelativePath(input.name)
        validateRelativePath(relPath)
        filename = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${(e as Error).message}` })
      }

      const fullPath = path.join(ownerRoot, filename)
      const fileExists = yield* fs.exists(fullPath).pipe(Effect.catch(() => Effect.succeed(false)))

      // Check registry for name/path conflicts with already-loaded assets
      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(filename).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== filename
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
        const bytes = yield* fs.readFile(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined as unknown as never)))
        const currentRevision = bytes ? Hash.sha256(Buffer.from(bytes)) : null
        return {
          relativePath: filename,
          exists: true,
          revision: currentRevision,
          nameConflict,
          pathConflict,
        } satisfies ProposeResult
      }

      return {
        relativePath: filename,
        exists: false,
        revision: null,
        nameConflict,
        pathConflict,
      } satisfies ProposeResult
    })

    const apply = Effect.fn("PromptAssetService.apply")(function* (input: ApplyInput) {
      // 1. Validate candidate and resolve path
      let relativePath: string
      try {
        const relPath = nameToRelativePath(input.candidate.name)
        validateRelativePath(relPath)
        relativePath = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${(e as Error).message}` })
      }

      const fullPath = path.join(ownerRoot, relativePath)
      const resource = relativePath

      // Acquire target-level lock for the full transaction
      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // 2. Read current state
            const fileExists = yield* fs.exists(fullPath).pipe(Effect.catch(() => Effect.succeed(false)))
            const currentBytes: Uint8Array | null = fileExists
              ? yield* fs.readFile(fullPath).pipe(
                  Effect.catch(() => Effect.succeed(undefined as unknown as never)),
                )
              : null
            const currentRevision = currentBytes ? Hash.sha256(Buffer.from(currentBytes)) : null

            // 3. CAS: compare baseRevision with current
            const isNew = input.baseRevision === null
            if (isNew && fileExists) {
              return yield* new StaleRevisionError({ relativePath })
            }
            if (!isNew && !fileExists) {
              return yield* new StaleRevisionError({ relativePath })
            }
            if (currentRevision !== null && input.baseRevision !== null && currentRevision !== input.baseRevision) {
              return yield* new StaleRevisionError({ relativePath })
            }

            // 4. Overwrite check
            if (fileExists && !input.overwrite) {
              return yield* new OverwriteRequiredError({ relativePath })
            }

            // 5. Serialize and write atomically
            const frontmatter = `---\nkind: prompt\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}\n---\n`
            const content = frontmatter + input.candidate.template

            const writeResult = yield* fileMutation.writeAtomic({ target: { canonical: fullPath, resource }, content }).pipe(
              Effect.catch((err) =>
                Effect.fail(new WriteFailedError({ relativePath, reason: (err as Error).message })),
              ),
            )

            const writtenBytes = yield* fs.readFile(fullPath).pipe(
              Effect.catch((err) =>
                Effect.fail(new WriteFailedError({ relativePath, reason: `readback failed: ${(err as Error).message}` })),
              ),
            )
            const writtenRevision = Hash.sha256(Buffer.from(writtenBytes))

            // 6. Reload registry and readback
            yield* registry.reload()

            const info = yield* registry.getByPath(relativePath).pipe(
              Effect.catch(() => Effect.fail(new ReadbackMismatchError({ relativePath }))),
            )

            // 7. Verify revision matches
            if (info.revision !== writtenRevision) {
              // Rollback: restore old bytes if no external modification
              if (currentBytes) {
                const nowBytes = yield* fs.readFile(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined as unknown as never)))
                if (nowBytes && Hash.sha256(Buffer.from(nowBytes)) === writtenRevision) {
                  yield* fileMutation.writeAtomic({ target: { canonical: fullPath, resource }, content: currentBytes }).pipe(
                    Effect.catch((err) =>
                      Effect.fail(new RollbackFailedError({ relativePath, reason: (err as Error).message })),
                    ),
                  )
                  yield* registry.reload()
                }
                return yield* new ReadbackMismatchError({ relativePath })
              }
              // New file that failed readback: delete if our bytes are still there
              const nowBytes = yield* fs.readFile(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined as unknown as never)))
              if (nowBytes && Hash.sha256(Buffer.from(nowBytes)) === writtenRevision) {
                yield* fs.remove(fullPath).pipe(Effect.catch(() => Effect.void))
                yield* registry.reload()
              }
              return yield* new ReadbackMismatchError({ relativePath })
            }

            return info
          }),
        ),
      )
    })

    return Service.of({ propose, apply })
  }),
)

export const layer = locationLayer
