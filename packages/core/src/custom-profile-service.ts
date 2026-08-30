export * as CustomProfileService from "./custom-profile-service"

import yaml from "js-yaml"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { CustomProfile } from "./custom-profile"
import { FileMutation } from "./file-mutation"
import { CustomProfilePath } from "./custom-profile/path"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"
import { Hash } from "./util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "CustomProfileService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()(
  "CustomProfileService.StaleRevision",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "CustomProfileService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("CustomProfileService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedErrorClass<ReadbackMismatchError>()(
  "CustomProfileService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedErrorClass<RollbackFailedError>()(
  "CustomProfileService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedErrorClass<ConcurrentModificationError>()(
  "CustomProfileService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("CustomProfileService.NotFound", {
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
  candidate: SchemaCustomProfile.Candidate
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
  | NotFoundError
  | FSUtil.Error

export interface Interface {
  readonly propose: (
    candidate: SchemaCustomProfile.Candidate,
  ) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<CustomProfile.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<SchemaCustomProfile.DeleteResult, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CustomProfileService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locationMutation = yield* LocationMutation.Service
    const registry = yield* CustomProfile.Service
    const fileMutation = yield* FileMutation.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    const propose = Effect.fn("CustomProfileService.propose")(function* (input: SchemaCustomProfile.Candidate) {
      if (input.profile.name !== input.name) {
        return yield* new InvalidCandidateError({
          reason: `Candidate profile name '${input.profile.name}' does not match top-level candidate name '${input.name}'`,
        })
      }
      if (input.profile.description !== input.description) {
        return yield* new InvalidCandidateError({
          reason: `Candidate profile description does not match top-level candidate description`,
        })
      }

      let relativePath: string
      try {
        if (input.relativePath) {
          relativePath = CustomProfilePath.normalizeRelativePath(input.relativePath)
        } else {
          const relPath = CustomProfilePath.nameToRelativePath(input.name)
          CustomProfilePath.validateRelativePath(relPath)
          relativePath = `${input.name.normalize("NFKC").trim()}.yaml`
        }
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* CustomProfilePath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )
      const fileExists = yield* fs.exists(target.canonical)

      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(relativePath).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== relativePath
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
        const bytes = yield* fs
          .readFile(target.canonical)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
        if (!bytes) {
          return {
            relativePath,
            exists: false,
            revision: null,
            nameConflict,
            pathConflict,
          } satisfies ProposeResult
        }
        const currentRevision = Hash.sha256(Buffer.from(bytes))
        return {
          relativePath,
          exists: true,
          revision: currentRevision,
          nameConflict,
          pathConflict,
        } satisfies ProposeResult
      }

      return {
        relativePath,
        exists: false,
        revision: null,
        nameConflict,
        pathConflict,
      } satisfies ProposeResult
    })

    const apply = Effect.fn("CustomProfileService.apply")(function* (input: ApplyInput) {
      if (input.candidate.profile.name !== input.candidate.name) {
        return yield* new InvalidCandidateError({
          reason: `Candidate profile name '${input.candidate.profile.name}' does not match top-level candidate name '${input.candidate.name}'`,
        })
      }
      if (input.candidate.profile.description !== input.candidate.description) {
        return yield* new InvalidCandidateError({
          reason: `Candidate profile description does not match top-level candidate description`,
        })
      }

      let relativePath: string
      try {
        if (input.candidate.relativePath) {
          relativePath = CustomProfilePath.normalizeRelativePath(input.candidate.relativePath)
        } else {
          const relPath = CustomProfilePath.nameToRelativePath(input.candidate.name)
          CustomProfilePath.validateRelativePath(relPath)
          relativePath = `${input.candidate.name.normalize("NFKC").trim()}.yaml`
        }
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* CustomProfilePath.resolveSafeTarget(relativePath, locationMutation).pipe(
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

            const yamlDoc = Schema.encodeSync(SchemaCustomProfile.Profile)(input.candidate.profile)
            const content = yaml.dump(yamlDoc, { indent: 2, lineWidth: -1 })

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
                yield* new ConcurrentModificationError({ relativePath })
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

    const deleteProfile = Effect.fn("CustomProfileService.delete")(function* (input: DeleteInput) {
      let relativePath: string
      try {
        relativePath = CustomProfilePath.normalizeRelativePath(input.relativePath)
      } catch (e) {
        return yield* new InvalidCandidateError({
          reason: `Invalid path: ${failureMessage(e)}`,
        })
      }

      const target = yield* CustomProfilePath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.canonical)
            if (!fileExists) {
              yield* registry.reload()
              return yield* new NotFoundError({ relativePath })
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
              return yield* new NotFoundError({ relativePath })
            }
            const currentRevision = Hash.sha256(Buffer.from(currentBytes))

            if (input.baseRevision !== null && currentRevision !== input.baseRevision) {
              return yield* new StaleRevisionError({ relativePath })
            }

            const backupHash = currentRevision
            const rollbackDelete = () =>
              Effect.gen(function* () {
                const nowExists = yield* fs.exists(target.canonical)
                if (nowExists) {
                  const nowBytes = yield* fs
                    .readFile(target.canonical)
                    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))
                  if (nowBytes && Hash.sha256(Buffer.from(nowBytes)) !== backupHash) {
                    yield* new ConcurrentModificationError({ relativePath })
                  }
                }
                yield* fileMutation
                  .writeAtomic({ target, content: currentBytes })
                  .pipe(
                    Effect.mapError(
                      (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                    ),
                  )
                yield* registry
                  .reload()
                  .pipe(
                    Effect.mapError(
                      (error) => new RollbackFailedError({ relativePath, reason: failureMessage(error) }),
                    ),
                  )
              })

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

            // Verify absence on disk
            const stillExistsOnDisk = yield* fs.exists(target.canonical)
            if (stillExistsOnDisk) {
              yield* rollbackDelete()
              return yield* new WriteFailedError({
                relativePath,
                reason: `File ${relativePath} still exists on disk after remove`,
              })
            }

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

            // Verify absence in registry
            const inRegistry = yield* registry.getByPath(relativePath).pipe(Effect.option)
            if (Option.isSome(inRegistry)) {
              yield* rollbackDelete()
              return yield* new ConcurrentModificationError({ relativePath })
            }

            return new SchemaCustomProfile.DeleteResult({
              relativePath,
              // M0 Profile schema has no ProfileRef kind. Asset references are
              // queried by CompositionResolver; deleting a Profile cannot
              // currently leave another Profile with a valid ProfileRef.
              referencingProfiles: [],
            })
          }),
        ),
      )
    })

    return Service.of({
      propose,
      apply,
      delete: deleteProfile,
    } satisfies Interface)
  }),
)
