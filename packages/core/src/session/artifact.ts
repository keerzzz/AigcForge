export * as WorkArtifact from "./artifact"

import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { and, eq, sql } from "drizzle-orm"
import path from "path"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Database } from "../database/database"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { Location } from "../location"
import { FileMutation } from "../file-mutation"
import { LocationMutation } from "../location-mutation"
import { FSUtil } from "../fs-util"
import { Identifier } from "../id/id"
import { Hash } from "../util/hash"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

/** The recoverable record points to a real Location file; it never owns document bytes. */
export const ArtifactRecord = Schema.Struct({
  id: Schema.String.annotate({ description: "稳定 Artifact ID" }),
  sessionID: SessionSchema.ID,
  kind: Schema.Literal("document").annotate({ description: "M1 固定" }),
  title: Schema.String,
  mediaType: Schema.Literal("text/markdown"),
  relativePath: Schema.String.annotate({ description: "相对 Session Location，规范化后不得越界" }),
  status: Schema.Literals(["available", "missing"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkArtifact.ArtifactRecord" })
export type ArtifactRecord = typeof ArtifactRecord.Type

export const Event = {
  ArtifactApplied: EventV2.define({
    type: "work.artifact_applied",
    schema: {
      sessionID: SessionSchema.ID,
      artifactID: Schema.String,
    },
  }),
}

export class PathValidationError extends Schema.TaggedErrorClass<PathValidationError>()("WorkArtifact.PathValidation", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("WorkArtifact.Conflict", {
  relativePath: Schema.String,
  reason: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.reason ?? "The artifact target already exists or changed; reload before retrying"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("WorkArtifact.NotFound", {
  sessionID: SessionSchema.ID,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class ScopeError extends Schema.TaggedErrorClass<ScopeError>()("WorkArtifact.Scope", {
  sessionID: SessionSchema.ID,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("WorkArtifact.Unavailable", {
  sessionID: SessionSchema.ID,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("WorkArtifact.Storage", {
  sessionID: SessionSchema.ID,
  phase: Schema.Literals(["read", "bind", "publish"]),
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export type ReadError = NotFoundError | ScopeError | UnavailableError | StorageError | ConflictError

export interface ApplyInput {
  readonly sessionID: SessionSchema.ID
  readonly title: string
  readonly relativePath: string
  readonly content: string
  readonly overwrite?: boolean
}

export interface ApplyResult {
  readonly artifact: ArtifactRecord
  readonly existed: boolean
}

/** Recoverable identity and content revision; document bytes remain owned by the filesystem. */
export class ArtifactSnapshot extends Schema.Class<ArtifactSnapshot>("WorkArtifact.ArtifactSnapshot")({
  artifact: ArtifactRecord,
  revision: WorkflowAsset.Revision,
}) {}

export interface Interface {
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PathValidationError | ReadError | FSUtil.Error>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ArtifactSnapshot | undefined, ReadError>
  readonly withCurrent: <A, E, R>(
    sessionID: SessionSchema.ID,
    use: (snapshot: ArtifactSnapshot | undefined) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReadError, R>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkArtifact") {}

// A Session can change its target path; the file lock alone cannot serialize its binding.
const sessions = KeyedMutex.makeUnsafe<SessionSchema.ID>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const locationMutation = yield* LocationMutation.Service
    const fileMutation = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service

    const readBinding = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select({
          directory: SessionTable.directory,
          workspaceID: SessionTable.workspace_id,
          mode: SessionTable.mode,
          // Read raw JSON so corrupt storage becomes a typed failure, not a Drizzle decoder defect.
          metadata: sql<string | null>`${SessionTable.metadata}`,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(
          Effect.mapError(
            () => new StorageError({ sessionID, phase: "read", reason: "Artifact storage could not be read" }),
          ),
          Effect.catchDefect(
            () => new StorageError({ sessionID, phase: "read", reason: "Artifact storage could not be read" }),
          ),
        )
      if (!row) return yield* new NotFoundError({ sessionID, reason: "The Session does not exist" })
      if (row.mode !== "work") return yield* new ScopeError({ sessionID, reason: "Artifacts require a Work Session" })
      if (row.directory !== location.directory || (row.workspaceID ?? undefined) !== location.workspaceID) {
        return yield* new ScopeError({ sessionID, reason: "The Session does not belong to this Location" })
      }
      const metadata = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(
        row.metadata === null
          ? {}
          : Option.getOrUndefined(Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(row.metadata)),
      )
      if (Option.isNone(metadata)) {
        return yield* new UnavailableError({ sessionID, reason: "The stored artifact metadata is invalid" })
      }
      if (!Object.hasOwn(metadata.value, "workArtifact")) return { row, reference: undefined }
      const reference = Schema.decodeUnknownOption(ArtifactSnapshot, { onExcessProperty: "error" })(
        metadata.value.workArtifact,
      )
      if (
        Option.isNone(reference) ||
        reference.value.artifact.sessionID !== sessionID ||
        reference.value.artifact.id.trim() === "" ||
        reference.value.artifact.status !== "available" ||
        pathReason(reference.value.artifact.relativePath)
      ) {
        return yield* new UnavailableError({ sessionID, reason: "The stored artifact binding is invalid" })
      }
      return { row, reference: reference.value }
    })

    const resolve = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, relativePath: string) {
      return yield* Effect.gen(function* () {
        const root = yield* fs.realPath(location.directory)
        const target = yield* locationMutation.resolve({ path: relativePath.replaceAll("\\", "/") })
        if (target.externalDirectory || !FSUtil.contains(root, target.canonical)) {
          return yield* new UnavailableError({ sessionID, reason: "The artifact path is outside this Location" })
        }
        return target
      }).pipe(
        Effect.mapError(
          () =>
            new UnavailableError({ sessionID, reason: "The artifact path is unavailable or outside this Location" }),
        ),
        Effect.catchDefect(
          () =>
            new UnavailableError({ sessionID, reason: "The artifact path is unavailable or outside this Location" }),
        ),
      )
    })

    const readCurrent = Effect.fnUntraced(function* (reference: ArtifactSnapshot, target: FileMutation.Target) {
      const sessionID = reference.artifact.sessionID
      const current = yield* resolve(sessionID, reference.artifact.relativePath)
      if (current.canonical !== target.canonical) {
        return yield* new UnavailableError({ sessionID, reason: "The artifact path changed while being read" })
      }
      const info = yield* fs
        .stat(current.canonical)
        .pipe(
          Effect.mapError(() => new UnavailableError({ sessionID, reason: "The bound artifact file is unavailable" })),
        )
      if (info.type !== "File") {
        return yield* new UnavailableError({ sessionID, reason: "The bound artifact is not a regular file" })
      }
      const bytes = yield* fs
        .readFile(current.canonical)
        .pipe(
          Effect.mapError(
            () => new UnavailableError({ sessionID, reason: "The bound artifact file could not be read" }),
          ),
        )
      if ((yield* resolve(sessionID, reference.artifact.relativePath)).canonical !== current.canonical) {
        return yield* new UnavailableError({ sessionID, reason: "The artifact path changed while being read" })
      }
      return new ArtifactSnapshot({
        artifact: reference.artifact,
        revision: Schema.decodeUnknownSync(WorkflowAsset.Revision)(Hash.sha256(bytes)),
      })
    })

    const withCurrent: Interface["withCurrent"] = (sessionID, use) =>
      sessions
        .withLock(sessionID)(
          Effect.gen(function* () {
            const before = yield* readBinding(sessionID)
            if (!before.reference) {
              const result = yield* use(undefined)
              if ((yield* readBinding(sessionID)).reference) {
                return yield* new ConflictError({
                  relativePath: "",
                  reason: "The artifact binding changed during the operation; reload its current state",
                })
              }
              return result
            }
            const target = yield* resolve(sessionID, before.reference.artifact.relativePath)
            return yield* fileMutation.withTarget(target, () =>
              Effect.gen(function* () {
                const locked = yield* readBinding(sessionID)
                if (!locked.reference || !sameBinding(before.reference, locked.reference)) {
                  return yield* new ConflictError({
                    relativePath: target.resource,
                    reason: "The artifact binding changed before the operation; reload its current state",
                  })
                }
                const snapshot = yield* readCurrent(locked.reference, target)
                const result = yield* use(snapshot)
                // The callback may already have committed. A failed postcheck is recoverable, not a rollback claim.
                const after = yield* readBinding(sessionID)
                if (!after.reference || !sameBinding(locked.reference, after.reference)) {
                  return yield* new ConflictError({
                    relativePath: target.resource,
                    reason: "The artifact binding changed during the operation; reload its current state",
                  })
                }
                if ((yield* readCurrent(after.reference, target)).revision !== snapshot.revision) {
                  return yield* new ConflictError({
                    relativePath: target.resource,
                    reason: "The artifact content changed during the operation; reload its current state",
                  })
                }
                return result
              }),
            )
          }),
        )
        .pipe(Effect.withSpan("WorkArtifact.withCurrent"))

    const get = Effect.fn("WorkArtifact.get")((sessionID: SessionSchema.ID) => withCurrent(sessionID, Effect.succeed))

    const apply = Effect.fn("WorkArtifact.apply")(function* (input: ApplyInput) {
      const reason = pathReason(input.relativePath)
      if (reason) return yield* new PathValidationError({ relativePath: input.relativePath, reason })
      const result = yield* sessions.withLock(input.sessionID)(
        Effect.gen(function* () {
          const before = yield* readBinding(input.sessionID)
          const target = yield* resolve(input.sessionID, input.relativePath).pipe(
            Effect.mapError(
              () =>
                new PathValidationError({
                  relativePath: input.relativePath,
                  reason: "Path is unavailable or outside the Session Location",
                }),
            ),
          )
          return yield* fileMutation.withTarget(target, (writer) =>
            Effect.gen(function* () {
              const locked = yield* readBinding(input.sessionID)
              if (
                !sameBinding(before.reference, locked.reference) ||
                (yield* resolve(input.sessionID, input.relativePath)).canonical !== target.canonical
              ) {
                return yield* new ConflictError({
                  relativePath: target.resource,
                  reason: "The artifact target changed before writing; reload its current state",
                })
              }
              const written = input.overwrite
                ? yield* writer.writeAtomic(input.content)
                : yield* writer
                    .create(input.content)
                    .pipe(
                      Effect.catchTag(
                        "FileMutation.TargetExistsError",
                        () => new ConflictError({ relativePath: input.relativePath }),
                      ),
                    )
              const now = yield* DateTime.nowAsDate
              const reference = new ArtifactSnapshot({
                artifact: {
                  id: Identifier.create("art", "ascending"),
                  sessionID: input.sessionID,
                  kind: "document",
                  title: input.title,
                  mediaType: "text/markdown",
                  relativePath: target.resource,
                  status: "available",
                  createdAt: now.getTime(),
                  updatedAt: now.getTime(),
                },
                revision: Schema.decodeUnknownSync(WorkflowAsset.Revision)(Hash.sha256(input.content)),
              })
              if ((yield* readCurrent(reference, target)).revision !== reference.revision) {
                return yield* new ConflictError({
                  relativePath: target.resource,
                  reason: "The artifact file changed after writing; reload its current state",
                })
              }
              const updated = yield* db
                .update(SessionTable)
                .set({
                  metadata: sql`json_set(coalesce(${SessionTable.metadata}, '{}'), '$.workArtifact', json(${JSON.stringify(reference)}))`,
                })
                .where(
                  and(
                    eq(SessionTable.id, input.sessionID),
                    eq(SessionTable.directory, location.directory),
                    eq(SessionTable.mode, "work"),
                    sql`${SessionTable.workspace_id} IS ${location.workspaceID ?? null}`,
                    sql`(${SessionTable.metadata} IS NULL OR json_type(${SessionTable.metadata}) = 'object')`,
                    sql`json_type(${SessionTable.metadata}, '$.workArtifact') IS json_type(${locked.row.metadata}, '$.workArtifact')`,
                    sql`json_extract(${SessionTable.metadata}, '$.workArtifact') IS json_extract(${locked.row.metadata}, '$.workArtifact')`,
                  ),
                )
                .returning({ id: SessionTable.id })
                .pipe(
                  Effect.mapError(
                    () =>
                      new StorageError({
                        sessionID: input.sessionID,
                        phase: "bind",
                        reason:
                          "The file was written but its artifact reference could not be stored; reload before retrying",
                      }),
                  ),
                  Effect.catchDefect(
                    () =>
                      new StorageError({
                        sessionID: input.sessionID,
                        phase: "bind",
                        reason:
                          "The file was written but its artifact reference could not be stored; reload before retrying",
                      }),
                  ),
                )
              if (updated.length !== 1) {
                return yield* new ConflictError({
                  relativePath: target.resource,
                  reason: "The file was written but the Session binding changed; reload before retrying",
                })
              }
              const after = yield* readBinding(input.sessionID)
              if (
                !sameBinding(reference, after.reference) ||
                (yield* readCurrent(reference, target)).revision !== reference.revision
              ) {
                return yield* new ConflictError({
                  relativePath: target.resource,
                  reason: "The artifact changed after binding; reload its current state",
                })
              }
              return { artifact: reference.artifact, existed: written.existed }
            }).pipe(Effect.uninterruptible),
          )
        }),
      )
      // Notify after releasing coordination so observers can safely perform authoritative reads.
      yield* events.publish(Event.ArtifactApplied, { sessionID: input.sessionID, artifactID: result.artifact.id }).pipe(
        Effect.catchDefect(
          () =>
            new StorageError({
              sessionID: input.sessionID,
              phase: "publish",
              reason: "The artifact reference was stored but its notification failed; reload its current state",
            }),
        ),
      )
      return result
    })

    return Service.of({ apply, get, withCurrent })
  }),
)

function pathReason(relativePath: string) {
  if (relativePath.trim() === "") return "Path must not be empty"
  if (relativePath.includes("\0")) return "Path must not contain a null byte"
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath))
    return "Path must be relative to the location"
  if (relativePath.split(/[\\/]/).includes("..")) return "Path must not escape the location"
  return undefined
}

function sameBinding(left: ArtifactSnapshot | undefined, right: ArtifactSnapshot | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const locationLayer = layer.pipe(
  Layer.provide(LocationMutation.locationLayer),
  Layer.provide(FileMutation.locationLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
