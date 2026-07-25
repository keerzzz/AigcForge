export * as SkillAssetService from "./skill-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SkillAsset as SchemaSkillAsset } from "@aigcfroge/schema/skill-asset"
import { SkillAsset } from "./skill-asset"
import { FileMutation } from "./file-mutation"
import { SkillAssetPath } from "./skill-asset/path"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"
import { Hash } from "./util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "SkillAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class PermissionDeniedError extends Schema.TaggedErrorClass<PermissionDeniedError>()(
  "SkillAssetService.PermissionDenied",
  { action: Schema.String, resource: Schema.String },
) {
  override get message() {
    return `Permission denied for ${this.action} on ${this.resource}`
  }
}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()(
  "SkillAssetService.StaleRevision",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "SkillAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()(
  "SkillAssetService.WriteFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedErrorClass<ReadbackMismatchError>()(
  "SkillAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedErrorClass<RollbackFailedError>()(
  "SkillAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedErrorClass<ConcurrentModificationError>()(
  "SkillAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "SkillAssetService.NotFound",
  { relativePath: Schema.String },
) {
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
  candidate: SchemaSkillAsset.Candidate
  baseRevision: string | null
  overwrite: boolean
}

export interface DeleteInput {
  relativePath: string
  baseRevision: string | null
}

export interface Interface {
  readonly propose: (input: SchemaSkillAsset.Candidate) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<SkillAsset.Info, unknown>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SkillAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locationMutation = yield* LocationMutation.Service
    const registry = yield* SkillAsset.Service
    const fileMutation = yield* FileMutation.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    const propose = Effect.fn("SkillAssetService.propose")(function* (input: SchemaSkillAsset.Candidate) {
      let filename: string
      try {
        const relPath = SkillAssetPath.nameToRelativePath(input.name)
        SkillAssetPath.validateRelativePath(relPath)
        filename = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* SkillAssetPath.resolveSafeTarget(filename, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )
      const fileExists = yield* fs.exists(target.canonical)

      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(filename).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== filename
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
        const bytes = yield* fs.readFile(target.canonical).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        )
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

    const apply = Effect.fn("SkillAssetService.apply")(function* (input: ApplyInput) {
      let relativePath: string
      try {
        const relPath = SkillAssetPath.nameToRelativePath(input.candidate.name)
        SkillAssetPath.validateRelativePath(relPath)
        relativePath = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* SkillAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.canonical)
            const currentBytes: Uint8Array | null = fileExists ? yield* fs.readFile(target.canonical) : null
            const currentRevision = currentBytes ? Hash.sha256(Buffer.from(currentBytes)) : null

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

            if (fileExists && !input.overwrite) {
              return yield* new OverwriteRequiredError({ relativePath })
            }

            let frontmatter = `---\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}`
            if (input.candidate.slash) frontmatter += `\nslash: true`
            frontmatter += `\n---\n`
            const content = frontmatter + input.candidate.content

            yield* fileMutation.writeAtomic({ target, content }).pipe(
              Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })),
            )

            const writtenBytes = yield* fs.readFile(target.canonical).pipe(
              Effect.catch((err) =>
                Effect.fail(new WriteFailedError({ relativePath, reason: `readback failed: ${failureMessage(err)}` })),
              ),
            )
            const writtenRevision = Hash.sha256(Buffer.from(writtenBytes))

            const rollback = Effect.fnUntraced(function* () {
              const nowBytes = yield* fs.readFile(target.canonical).pipe(
                Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
              )
              if (!nowBytes || Hash.sha256(Buffer.from(nowBytes)) !== writtenRevision) {
                return yield* new ConcurrentModificationError({ relativePath })
              }

              if (currentBytes !== null) {
                yield* fileMutation.writeAtomic({ target, content: currentBytes }).pipe(
                  Effect.mapError(
                    (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                  ),
                )
              } else {
                yield* fs.remove(target.canonical).pipe(
                  Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
                  Effect.mapError(
                    (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                  ),
                )
              }
              yield* registry.reload().pipe(
                Effect.mapError(
                  (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                ),
              )
            })

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

            return info
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("SkillAssetService.delete")(function* (input: DeleteInput) {
      let relativePath: string
      try {
        relativePath = SkillAssetPath.validateRelativePath(input.relativePath)
      } catch (e) {
        return yield* new InvalidCandidateError({
          reason: `Invalid path: ${failureMessage(e)}`,
        })
      }

      const target = yield* SkillAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.canonical)
            if (!fileExists) {
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
            if (currentBytes === null) {
              yield* registry.reload()
              return
            }
            const currentRevision = Hash.sha256(Buffer.from(currentBytes))

            if (input.baseRevision !== null && currentRevision !== input.baseRevision) {
              return yield* new StaleRevisionError({ relativePath })
            }

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

            const backupHash = currentRevision
            const rollbackDelete = () =>
              Effect.gen(function* () {
                const nowExists = yield* fs.exists(target.canonical)
                if (nowExists) {
                  const nowBytes = yield* fs.readFile(target.canonical).pipe(
                    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
                  )
                  if (nowBytes && Hash.sha256(Buffer.from(nowBytes)) !== backupHash) {
                    return yield* new ConcurrentModificationError({ relativePath })
                  }
                }
                yield* fileMutation.writeAtomic({ target, content: currentBytes }).pipe(
                  Effect.mapError(
                    (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                  ),
                )
              })

            yield* registry.reload().pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
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
