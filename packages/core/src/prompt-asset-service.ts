export * as PromptAssetService from "./prompt-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset" // Schema namespace; local/core PromptAsset uses the unaliased name.
import { PromptAsset } from "./prompt-asset"
import { FileMutation } from "./file-mutation"
import { PromptAssetPath } from "./prompt-asset/path"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"
import { Hash } from "./util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"
import { EventV2 } from "./event"
import { yamlEscape } from "./util/yaml-escape"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** M2 埋点（PRD §12）：资产落盘成功时上报，payload 不含正文。Work 与 Chat 入口共用。 */
export const Event = {
  AssetSaved: EventV2.define({
    type: "work.asset_saved",
    schema: {
      relativePath: Schema.String,
    },
  }),
}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "PromptAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()(
  "PromptAssetService.StaleRevision",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "PromptAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("PromptAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedErrorClass<ReadbackMismatchError>()(
  "PromptAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedErrorClass<RollbackFailedError>()(
  "PromptAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedErrorClass<ConcurrentModificationError>()(
  "PromptAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PromptAssetService.NotFound", {
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
  candidate: SchemaPromptAsset.Candidate
  baseRevision: string | null
  overwrite: boolean
}

export interface DeleteInput {
  relativePath: string
  baseRevision: string | null
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
  | RollbackFailedError
  | ConcurrentModificationError
  | FSUtil.Error

export interface Interface {
  readonly propose: (
    input: SchemaPromptAsset.Candidate,
  ) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<PromptAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PromptAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locationMutation = yield* LocationMutation.Service
    const registry = yield* PromptAsset.Service
    const fileMutation = yield* FileMutation.Service
    const events = yield* EventV2.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    const propose = Effect.fn("PromptAssetService.propose")(function* (input: SchemaPromptAsset.Candidate) {
      let filename: string
      try {
        const relPath = PromptAssetPath.nameToRelativePath(input.name)
        PromptAssetPath.validateRelativePath(relPath)
        filename = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* PromptAssetPath.resolveSafeTarget(filename, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )
      const fileExists = yield* fs.exists(target.canonical)

      // Check registry for name/path conflicts with already-loaded assets
      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(filename).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== filename
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
        // Tolerate a TOCTOU delete between exists and read; treat as not-exists.
        const bytes = yield* fs
          .readFile(target.canonical)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
        if (!bytes) {
          return {
            relativePath: filename,
            exists: false,
            revision: null,
            nameConflict,
            pathConflict,
          } satisfies ProposeResult
        }
        const currentRevision = Hash.sha256(Buffer.from(bytes))
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
        const relPath = PromptAssetPath.nameToRelativePath(input.candidate.name)
        PromptAssetPath.validateRelativePath(relPath)
        relativePath = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* PromptAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      // Acquire target-level lock for the full transaction
      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // 2. Read current state
            const fileExists = yield* fs.exists(target.canonical)
            const currentBytes: Uint8Array | null = fileExists ? yield* fs.readFile(target.canonical) : null
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

            yield* fileMutation
              .writeAtomic({ target, content })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))

            const writtenBytes = yield* fs
              .readFile(target.canonical)
              .pipe(
                Effect.catch((err) =>
                  Effect.fail(
                    new WriteFailedError({ relativePath, reason: `readback failed: ${failureMessage(err)}` }),
                  ),
                ),
              )
            const writtenRevision = Hash.sha256(Buffer.from(writtenBytes))

            const rollback = Effect.fnUntraced(function* () {
              const nowBytes = yield* fs
                .readFile(target.canonical)
                .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
              if (!nowBytes || Hash.sha256(Buffer.from(nowBytes)) !== writtenRevision) {
                return yield* new ConcurrentModificationError({ relativePath })
              }

              if (currentBytes !== null) {
                yield* fileMutation
                  .writeAtomic({ target, content: currentBytes })
                  .pipe(
                    Effect.mapError(
                      (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                    ),
                  )
              } else {
                yield* fs.remove(target.canonical).pipe(
                  Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
                  Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })),
                )
              }
              yield* registry
                .reload()
                .pipe(
                  Effect.mapError((error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) })),
                )
            })

            // 6. Reload registry and verify the written asset is its canonical readback.
            const readback = yield* registry
              .reload()
              .pipe(Effect.andThen(registry.getByPath(relativePath)), Effect.option)
            if (Option.isNone(readback)) {
              yield* rollback()
              return yield* new ReadbackMismatchError({ relativePath })
            }

            const info = readback.value
            if (info.revision !== writtenRevision) {
              yield* rollback()
              return yield* new ReadbackMismatchError({ relativePath })
            }

            yield* events.publish(Event.AssetSaved, { relativePath })
            return info
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("PromptAssetService.delete")(function* (input: DeleteInput) {
      // 1. Validate + normalize path(用 normalized 返回值,非 raw input)
      let relativePath: string
      try {
        relativePath = PromptAssetPath.validateRelativePath(input.relativePath)
      } catch (e) {
        return yield* new InvalidCandidateError({
          reason: `Invalid path: ${failureMessage(e)}`,
        })
      }

      const target = yield* PromptAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      // Acquire target-level lock for the full transaction(用 normalized relativePath 作 key)
      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // 2. Read current bytes(readFile 失败:NotFound 视幂等成功,其他报 WriteFailed)
            const fileExists = yield* fs.exists(target.canonical)
            if (!fileExists) {
              // 幂等 delete:文件不存在视为成功(REST DELETE 语义,M6)
              // 仍 reload 清理 registry 可能的陈旧条目(N2)
              yield* registry.reload()
              return
            }

            const currentBytes = yield* fs.readFile(target.canonical).pipe(
              Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
              Effect.mapError(
                (error) =>
                  new WriteFailedError({
                    relativePath,
                    reason: `read before delete failed: ${failureMessage(error)}`,
                  }),
              ),
            )
            // currentBytes 为 null 仅在 TOCTOU 文件被并发删时,视幂等成功
            if (currentBytes === null) {
              yield* registry.reload()
              return
            }
            const currentRevision = Hash.sha256(Buffer.from(currentBytes))

            // 3. CAS:baseRevision != null 时必须校验;baseRevision === null = 强删(delete 独有语义)
            if (input.baseRevision !== null && currentRevision !== input.baseRevision) {
              return yield* new StaleRevisionError({ relativePath })
            }

            // 4. Atomic remove via fileMutation(幂等:NotFound 视成功,M4/M5/M6)
            yield* fileMutation.remove({ target }).pipe(
              Effect.catch((err) =>
                Effect.fail(
                  new WriteFailedError({
                    relativePath,
                    reason: failureMessage(err),
                  }),
                ),
              ),
            )

            // 5. Reload registry — on failure restore the backup bytes so the delete
            //    is fully reversible (the plan requires a proper delete transaction).
            const backupHash = currentRevision
            const rollbackDelete = () =>
              Effect.gen(function* () {
                // If the file now exists with different content than our backup,
                // an external concurrent modification happened — do not overwrite.
                const nowExists = yield* fs.exists(target.canonical)
                if (nowExists) {
                  const nowBytes = yield* fs
                    .readFile(target.canonical)
                    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))
                  if (nowBytes && Hash.sha256(Buffer.from(nowBytes)) !== backupHash) {
                    return yield* new ConcurrentModificationError({ relativePath })
                  }
                }
                yield* fileMutation
                  .writeAtomic({ target, content: currentBytes })
                  .pipe(
                    Effect.mapError(
                      (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                    ),
                  )
              })

            yield* registry.reload().pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  // Restore backup on reload failure (file is deleted, registry stale)
                  yield* rollbackDelete()
                  return yield* Effect.fail(
                    new WriteFailedError({
                      relativePath,
                      reason: `reload after delete failed: ${failureMessage(error)}`,
                    }),
                  )
                }),
              ),
            )

            // Confirm absence: if the registry still has the relativePath, another
            // writer recreated the file concurrently — restore our backup.
            const stillInRegistry = yield* registry.getByPath(relativePath).pipe(Effect.option)
            if (Option.isSome(stillInRegistry)) {
              yield* rollbackDelete()
              return yield* new ConcurrentModificationError({ relativePath })
            }
          }),
        ),
      )
    })

    return Service.of({ propose, apply, delete: deleteAsset })
  }),
)

export const layer = locationLayer
