export * as AgentAssetService from "./agent-asset-service"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { AgentAsset as SchemaAgentAsset } from "@aigcfroge/schema/agent-asset"
import { AgentAsset } from "./agent-asset"
import { FileMutation } from "./file-mutation"
import { AgentAssetPath } from "./agent-asset/path"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"
import { Hash } from "./util/hash"
import { KeyedMutex } from "./effect/keyed-mutex"
import { PermissionEffective } from "./permission/effective"
import { parseAgentAssetConfig } from "./agent/asset-bridge"
import { yamlEscape } from "./util/yaml-escape"

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "AgentAssetService.InvalidCandidate",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()(
  "AgentAssetService.StaleRevision",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Stale revision for ${this.relativePath}`
  }
}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "AgentAssetService.OverwriteRequired",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Overwrite required for ${this.relativePath}`
  }
}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("AgentAssetService.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Write failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ReadbackMismatchError extends Schema.TaggedErrorClass<ReadbackMismatchError>()(
  "AgentAssetService.ReadbackMismatch",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Readback mismatch for ${this.relativePath}`
  }
}

export class RollbackFailedError extends Schema.TaggedErrorClass<RollbackFailedError>()(
  "AgentAssetService.RollbackFailed",
  { relativePath: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Rollback failed for ${this.relativePath}: ${this.reason}`
  }
}

export class ConcurrentModificationError extends Schema.TaggedErrorClass<ConcurrentModificationError>()(
  "AgentAssetService.ConcurrentModification",
  { relativePath: Schema.String },
) {
  override get message() {
    return `Concurrent modification of ${this.relativePath}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("AgentAssetService.NotFound", {
  relativePath: Schema.String,
}) {
  override get message() {
    return `Not found: ${this.relativePath}`
  }
}

export type WarningCode = "wildcard_allow" | "dangerous_allow"

export interface Warning {
  readonly code: WarningCode
  readonly action: string
  readonly resource: string
}

export interface ProposeResult {
  readonly relativePath: string
  readonly exists: boolean
  readonly revision: string | null
  readonly nameConflict: boolean
  readonly pathConflict: boolean
  readonly warnings: ReadonlyArray<Warning>
}

export interface ApplyResult {
  readonly asset: AgentAsset.Info
  readonly warnings: ReadonlyArray<Warning>
}

export interface ApplyInput {
  candidate: SchemaAgentAsset.Candidate
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
    input: SchemaAgentAsset.Candidate,
  ) => Effect.Effect<ProposeResult, InvalidCandidateError | FSUtil.Error>
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, ApplyError>
  readonly delete: (input: DeleteInput) => Effect.Effect<void, DeleteError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/AgentAssetService") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locationMutation = yield* LocationMutation.Service
    const registry = yield* AgentAsset.Service
    const fileMutation = yield* FileMutation.Service

    const locks = KeyedMutex.makeUnsafe<string>()

    // Import-time disclosure, never a rejection. The judgement is "how broad is
    // the declaration", not "is the action read-only": a `{read, "*"}` allow is
    // the one asset-declared allow the attended custom ceiling still honours
    // verbatim (ADR-20 §2.6 rewrites only non-whitelist allows to `ask`), so
    // silencing it would warn exactly where the runtime already protects and
    // stay quiet where it does not. Narrow allows (`{read, "src/**"}`) do not
    // warn. Both action lists come from `permission/effective.ts` — the ruled
    // single source; never copy them here.
    const warningsFor = (config: string): ReadonlyArray<Warning> => {
      const permissions = parseAgentAssetConfig(config)?.permissions ?? []
      return permissions.flatMap((rule): ReadonlyArray<Warning> => {
        if (rule.effect !== "allow") return []
        if (PermissionEffective.isDangerousAction(rule.action)) {
          return [{ code: "dangerous_allow" as const, action: rule.action, resource: rule.resource } satisfies Warning]
        }
        if (rule.action === "*" || rule.resource === "*") {
          return [{ code: "wildcard_allow" as const, action: rule.action, resource: rule.resource } satisfies Warning]
        }
        return []
      })
    }

    const propose = Effect.fn("AgentAssetService.propose")(function* (input: SchemaAgentAsset.Candidate) {
      let filename: string
      try {
        const relPath = AgentAssetPath.nameToRelativePath(input.name)
        AgentAssetPath.validateRelativePath(relPath)
        filename = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* AgentAssetPath.resolveSafeTarget(filename, locationMutation).pipe(
        Effect.mapError((error) => new InvalidCandidateError({ reason: failureMessage(error) })),
      )
      const fileExists = yield* fs.exists(target.canonical)

      const existingName = yield* registry.findByName(input.name)
      const existingPath = yield* registry.getByPath(filename).pipe(Effect.option)
      const nameConflict = existingName !== undefined && existingName.relativePath !== filename
      const pathConflict = Option.isSome(existingPath) && existingPath.value.name !== input.name

      if (fileExists) {
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
            warnings: warningsFor(input.config),
          } satisfies ProposeResult
        }
        const currentRevision = Hash.sha256(Buffer.from(bytes))
        return {
          relativePath: filename,
          exists: true,
          revision: currentRevision,
          nameConflict,
          pathConflict,
          warnings: warningsFor(input.config),
        } satisfies ProposeResult
      }

      return {
        relativePath: filename,
        exists: false,
        revision: null,
        nameConflict,
        pathConflict,
        warnings: warningsFor(input.config),
      } satisfies ProposeResult
    })

    const apply = Effect.fn("AgentAssetService.apply")(function* (input: ApplyInput) {
      let relativePath: string
      try {
        const relPath = AgentAssetPath.nameToRelativePath(input.candidate.name)
        AgentAssetPath.validateRelativePath(relPath)
        relativePath = path.basename(relPath)
      } catch (e) {
        return yield* new InvalidCandidateError({ reason: `Invalid name or path: ${failureMessage(e)}` })
      }

      const target = yield* AgentAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
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

            const configLine = input.candidate.config ? `config: ${yamlEscape(input.candidate.config)}\n` : ""
            const frontmatter = `---\nkind: agent\nname: ${yamlEscape(input.candidate.name)}\ndescription: ${yamlEscape(input.candidate.description)}\n${configLine}---\n`
            const content = frontmatter + input.candidate.source

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

            return { asset: info, warnings: warningsFor(input.candidate.config) }
          }),
        ),
      )
    })

    const deleteAsset = Effect.fn("AgentAssetService.delete")(function* (input: DeleteInput) {
      let relativePath: string
      try {
        relativePath = AgentAssetPath.validateRelativePath(input.relativePath)
      } catch (e) {
        return yield* new InvalidCandidateError({
          reason: `Invalid path: ${failureMessage(e)}`,
        })
      }

      const target = yield* AgentAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
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
