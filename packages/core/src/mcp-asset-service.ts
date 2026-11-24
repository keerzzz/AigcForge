export * as MCPAssetService from "./mcp-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import type { Candidate } from "@omnixa/schema/mcp-asset"
import { MCPAsset } from "./mcp-asset"
import { FileMutation } from "./file-mutation"
import { MCPAssetPath } from "./mcp-asset/path"
import { FSUtil } from "@omnixa/util/fs-util"
import { LocationMutation } from "./location-mutation"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Hash } from "@omnixa/util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"
import { yamlEscape } from "./util/yaml-escape"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "MCPAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("MCPAssetService.StaleRevision", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "MCPAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("MCPAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedError<ReadbackMismatchError>()(
  "MCPAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedError<RollbackFailedError>()("MCPAssetService.RollbackFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedError<ConcurrentModificationError>()(
  "MCPAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("MCPAssetService.NotFound", {
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
  readonly propose: (input: Candidate) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<MCPAsset.Info, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/MCPAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locationMutation = yield* LocationMutation.Service
    const registry = yield* MCPAsset.Service
    const fileMutation = yield* FileMutation.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    const propose = Effect.fn("MCPAssetService.propose")(function* (input: Candidate) {
      let filename: string
      try {
        const relPath = MCPAssetPath.nameToRelativePath(input.name)
        MCPAssetPath.validateRelativePath(relPath)
        filename = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* MCPAssetPath.resolveSafeTarget(filename, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )
      const fileExists = yield* fs.exists(target.absolute)

      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(filename).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== filename
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
        const bytes = yield* fs
          .readFile(target.absolute)
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

    const apply = Effect.fn("MCPAssetService.apply")(function* (input: ApplyInput) {
      let relativePath: string
      try {
        const relPath = MCPAssetPath.nameToRelativePath(input.candidate.name)
        MCPAssetPath.validateRelativePath(relPath)
        relativePath = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      if (input.candidate.relativePath !== "" && input.candidate.relativePath !== relativePath)
        return yield* new InvalidCandidateError({ reason: "Candidate target does not match its name" })

      const target = yield* MCPAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.absolute)
            const currentBytes: Uint8Array | null = fileExists ? yield* fs.readFile(target.absolute) : null
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

            const argsYaml = `[${input.candidate.args.map(yamlEscape).join(", ")}]`
            // Use the same JSON flow mapping as legacy MCP import, preserving every environment key and value.
            const frontmatter = `---\nkind: mcp\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}\ncommand: ${yamlEscape(input.candidate.command)}\nargs: ${argsYaml}\nenv: ${JSON.stringify(input.candidate.env)}\n---\n`
            const content = frontmatter + input.candidate.configJson

            yield* fileMutation
              .writeAtomic({ target, content })
              .pipe(Effect.mapError((error) => new WriteFailedError({ relativePath, reason: failureMessage(error) })))

            const writtenBytes = yield* fs
              .readFile(target.absolute)
              .pipe(
                Effect.mapError(
                  (err) => new WriteFailedError({ relativePath, reason: `readback failed: ${failureMessage(err)}` }),
                ),
              )
            const writtenRevision = Hash.sha256(Buffer.from(writtenBytes))

            const rollback = Effect.fnUntraced(function* () {
              const nowBytes = yield* fs
                .readFile(target.absolute)
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
                yield* fs.remove(target.absolute).pipe(
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
            if (
              info.revision !== writtenRevision ||
              info.relativePath !== relativePath ||
              info.name !== input.candidate.name ||
              info.description !== input.candidate.description ||
              info.command !== input.candidate.command ||
              info.configJson !== input.candidate.configJson ||
              info.args.length !== input.candidate.args.length ||
              info.args.some((value, index) => value !== input.candidate.args[index]) ||
              Object.keys(info.env).length !== Object.keys(input.candidate.env).length ||
              Object.entries(input.candidate.env).some(
                ([key, value]) => !Object.hasOwn(info.env, key) || info.env[key] !== value,
              )
            ) {
              yield* rollback()
              return yield* new ReadbackMismatchError({ relativePath })
            }

            return info
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("MCPAssetService.delete")(function* (input: DeleteInput) {
      let relativePath: string
      try {
        relativePath = MCPAssetPath.validateRelativePath(input.relativePath)
      } catch (e) {
        return yield* new InvalidCandidateError({
          reason: `Invalid path: ${failureMessage(e)}`,
        })
      }

      const target = yield* MCPAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )

      return yield* locks.withLock(relativePath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.absolute)
            if (!fileExists) {
              yield* registry.reload()
              return
            }

            const currentBytes = yield* fs.readFile(target.absolute).pipe(
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
              Effect.mapError(
                (err) =>
                  new WriteFailedError({
                    relativePath,
                    reason: failureMessage(err),
                  }),
              ),
            )

            const backupHash = currentRevision
            const rollbackDelete = () =>
              Effect.gen(function* () {
                const nowExists = yield* fs.exists(target.absolute)
                if (nowExists) {
                  const nowBytes = yield* fs
                    .readFile(target.absolute)
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

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [FSUtil.node, LocationMutation.node, MCPAsset.node, FileMutation.node],
})
