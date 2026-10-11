import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { SqlError } from "effect/unstable/sql/SqlError"
import { Database } from "../database/database"
import { Location } from "../location"
import { WorkArtifact } from "./artifact"
import { SessionTable } from "./sql"
import { WorkReviewMachine } from "./work-review"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"

export class ReviewError extends Schema.TaggedErrorClass<ReviewError>()("WorkReview.Error", {
  code: Schema.Literals([
    "not_found",
    "wrong_scope",
    "wrong_mode",
    "invalid_action",
    "conflict",
    "stale_artifact",
    "illegal_transition",
    "artifact_unavailable",
    "corrupt_review",
    "storage",
    "notification",
  ]),
  reason: Schema.String,
  committedRevision: Schema.optional(Schema.Int),
}) {
  override get message() {
    return this.reason
  }
}

export const Event = {
  Updated: EventV2.define({
    type: "work.review.updated",
    schema: {
      sessionID: SessionSchema.ID,
      revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      review: WorkReview.Review,
    },
  }),
}

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<WorkReview.ReadResult, ReviewError>
  readonly transition: (
    sessionID: SessionSchema.ID,
    command: WorkReview.Command,
  ) => Effect.Effect<WorkReview.Ready, ReviewError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/WorkReviewService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const artifacts = yield* WorkArtifact.Service
    const events = yield* EventV2.Service

    // Preserve SQL NULL versus the JSON text "null"; the latter is corrupt metadata, not an absent record.
    const fields = {
      directory: SessionTable.directory,
      workspace_id: SessionTable.workspace_id,
      mode: SessionTable.mode,
      metadata: sql<string | null>`${SessionTable.metadata}`,
    }

    const requireSession = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select(fields)
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(
          Effect.mapError(() => new ReviewError({ code: "storage", reason: "Review storage is unavailable" })),
          Effect.catchDefect(() => new ReviewError({ code: "storage", reason: "Review storage is unavailable" })),
        )
      if (!row) return yield* new ReviewError({ code: "not_found", reason: "Session was not found" })
      if (row.directory !== location.directory || (row.workspace_id ?? undefined) !== location.workspaceID) {
        return yield* new ReviewError({ code: "wrong_scope", reason: "Session belongs to another Location" })
      }
      if (row.mode !== "work")
        return yield* new ReviewError({ code: "wrong_mode", reason: "Review requires a Work session" })
      return row
    })

    const get = Effect.fn("WorkReviewService.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* requireSession(sessionID)
      const review = storedReview(row.metadata)
      if (review === null) return new WorkReview.Unavailable({ status: "unavailable", reason: "corrupt_review" })
      return yield* artifacts.get(sessionID).pipe(
        Effect.map((snapshot): WorkReview.ReadResult => {
          if (!snapshot) {
            if (review === undefined) return new WorkReview.None({ status: "none" })
            return new WorkReview.Unavailable({ status: "unavailable", reason: "artifact_missing", review })
          }
          const artifact = new WorkReview.Binding({
            artifactID: snapshot.artifact.id,
            artifactRevision: snapshot.revision,
          })
          if (review === undefined) return new WorkReview.None({ status: "none", artifact })
          return new WorkReview.Ready({
            status: "ready",
            review,
            artifact,
            current: WorkReviewMachine.isVerdictCurrent(review, artifact),
          })
        }),
        Effect.catchTag("WorkArtifact.Unavailable", () =>
          Effect.succeed(new WorkReview.Unavailable({ status: "unavailable", reason: "artifact_unavailable", review })),
        ),
        Effect.mapError(artifactError),
      )
    })

    const transition = Effect.fn("WorkReviewService.transition")(function* (
      sessionID: SessionSchema.ID,
      input: WorkReview.Command,
    ) {
      const decoded = Schema.decodeUnknownOption(WorkReview.Command)(input)
      if (Option.isNone(decoded))
        return yield* new ReviewError({ code: "invalid_action", reason: "Invalid review command" })
      const command = decoded.value
      yield* requireSession(sessionID)
      const committedRevision = yield* Ref.make<number | undefined>(undefined)
      const result = yield* artifacts
        .withCurrent(sessionID, (snapshot) =>
          Effect.gen(function* () {
            if (!snapshot)
              return yield* new ReviewError({
                code: "artifact_unavailable",
                reason: "No available artifact is bound to this Session",
              })
            const artifact = new WorkReview.Binding({
              artifactID: snapshot.artifact.id,
              artifactRevision: snapshot.revision,
            })
            const at = (yield* DateTime.nowAsDate).getTime()
            return yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const row = yield* tx.select(fields).from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
                  if (!row) return yield* new ReviewError({ code: "not_found", reason: "Session was not found" })
                  if (
                    row.directory !== location.directory ||
                    (row.workspace_id ?? undefined) !== location.workspaceID
                  ) {
                    return yield* new ReviewError({
                      code: "wrong_scope",
                      reason: "Session belongs to another Location",
                    })
                  }
                  if (row.mode !== "work")
                    return yield* new ReviewError({ code: "wrong_mode", reason: "Review requires a Work session" })
                  const current = storedReview(row.metadata)
                  if (current === null)
                    return yield* new ReviewError({ code: "corrupt_review", reason: "Stored review is invalid" })
                  if ((current?.revision ?? 0) !== command.expectedReviewRevision) {
                    return yield* new ReviewError({
                      code: "conflict",
                      reason: "Review revision changed; reload before trying another command",
                    })
                  }
                  if (
                    command.action !== "respond" &&
                    (command.artifactID !== artifact.artifactID ||
                      command.expectedArtifactRevision !== artifact.artifactRevision)
                  ) {
                    return yield* new ReviewError({
                      code: "stale_artifact",
                      reason: "Artifact identity or content changed; reload before reviewing",
                    })
                  }
                  const next = WorkReviewMachine.transition(
                    current,
                    command.action === "respond"
                      ? { kind: "respond", at }
                      : {
                          kind: command.action,
                          artifactID: artifact.artifactID,
                          artifactRevision: artifact.artifactRevision,
                          at,
                        },
                  )
                  if (!next.ok)
                    return yield* new ReviewError({
                      code: next.error.reason === "artifact_mismatch" ? "stale_artifact" : "illegal_transition",
                      reason: "Review action is not valid for the current state or artifact binding",
                    })
                  const updated = yield* tx
                    .update(SessionTable)
                    .set({
                      metadata: sql`json_set(coalesce(${SessionTable.metadata}, '{}'), '$.workReview', json(${JSON.stringify(next.review)}))`,
                      time_updated: at,
                    })
                    .where(
                      and(
                        eq(SessionTable.id, sessionID),
                        current
                          ? sql`json_extract(${SessionTable.metadata}, '$.workReview.revision') = ${command.expectedReviewRevision}`
                          : sql`json_type(${SessionTable.metadata}, '$.workReview') is null`,
                        sql`json_extract(${SessionTable.metadata}, '$.workArtifact.artifact.id') = ${snapshot.artifact.id}`,
                      ),
                    )
                    .returning({ id: SessionTable.id })
                    .get()
                  if (!updated)
                    return yield* new ReviewError({
                      code: "conflict",
                      reason: "Review or artifact binding changed during the command",
                    })
                  return new WorkReview.Ready({
                    status: "ready",
                    review: next.review,
                    artifact,
                    current: WorkReviewMachine.isVerdictCurrent(next.review, artifact),
                  })
                }),
              )
              .pipe(
                Effect.mapError(storageError),
                Effect.tap((value) => Ref.set(committedRevision, value.review.revision)),
              )
          }),
        )
        .pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const revision = yield* Ref.get(committedRevision)
              if (revision !== undefined)
                return yield* new ReviewError({
                  code: "storage",
                  reason: "Review was saved but the artifact could not be revalidated; reload the authoritative state",
                  committedRevision: revision,
                })
              return yield* error instanceof ReviewError ? error : artifactError(error)
            }),
          ),
        )
      yield* events
        .publish(Event.Updated, { sessionID, revision: result.review.revision, review: result.review }, { location })
        .pipe(
          Effect.catchCause(
            () =>
              new ReviewError({
                code: "notification",
                reason: "Review was saved but its notification failed; reload the authoritative state",
                committedRevision: result.review.revision,
              }),
          ),
        )
      return result
    })

    return Service.of({ get, transition })
  }),
)

function storedReview(metadata: string | null) {
  if (metadata === null) return undefined
  const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(
    Option.getOrUndefined(Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(metadata)),
  )
  if (Option.isNone(record)) return null
  if (!Object.hasOwn(record.value, "workReview")) return undefined
  const decoded = Schema.decodeUnknownOption(WorkReview.Review)(record.value.workReview)
  return Option.isSome(decoded) ? decoded.value : null
}

function storageError(error: unknown): ReviewError {
  if (error instanceof ReviewError) return error
  if (
    error instanceof SqlError &&
    ["LockTimeoutError", "SerializationError", "DeadlockError"].includes(error.reason._tag)
  ) {
    return new ReviewError({
      code: "conflict",
      reason: "Review storage changed concurrently; reload before another command",
    })
  }
  return new ReviewError({ code: "storage", reason: "Review could not be saved" })
}

function artifactError(error: unknown): ReviewError {
  if (error instanceof WorkArtifact.ConflictError)
    return new ReviewError({ code: "conflict", reason: "Artifact changed concurrently; reload before another command" })
  if (error instanceof WorkArtifact.NotFoundError)
    return new ReviewError({ code: "not_found", reason: "Session was not found" })
  if (error instanceof WorkArtifact.ScopeError)
    return new ReviewError({ code: "wrong_scope", reason: "Artifact belongs to another Session or Location" })
  if (error instanceof WorkArtifact.StorageError)
    return new ReviewError({ code: "storage", reason: "Artifact storage is unavailable" })
  return new ReviewError({ code: "artifact_unavailable", reason: "Artifact is not available for this command" })
}

export * as WorkReviewService from "./work-review-service"
