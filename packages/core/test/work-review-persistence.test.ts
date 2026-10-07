import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { SessionV2 } from "@aigcfroge/core/session"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { WorkReviewService } from "@aigcfroge/core/session/work-review-service"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { WorkReviewFixture } from "./fixture/work-review"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

it.live("AI-TDD-S06-R07: Review and artifact rebuild from SQLite and real files after scope disposal", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const saved = yield* Effect.gen(function* () {
      const session = yield* (yield* SessionV2.Service).create({ location: yield* Location.Service, mode: "work" })
      const artifact = yield* WorkArtifact.Service
      const applied = yield* artifact.apply({
        sessionID: session.id,
        relativePath: "saved.md",
        title: "Saved",
        content: "durable",
      })
      const snapshot = yield* artifact.get(session.id)
      if (!snapshot) throw new Error("Artifact was not bound")
      const review = yield* (yield* WorkReviewService.Service).transition(session.id, {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: applied.artifact.id,
        expectedArtifactRevision: snapshot.revision,
      })
      return { sessionID: session.id, review }
    }).pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/storage.sqlite`)), Effect.scoped)
    yield* Effect.gen(function* () {
      const review = yield* WorkReviewService.Service
      expect(yield* review.get(saved.sessionID)).toEqual(saved.review)
      expect((yield* (yield* SessionV2.Service).get(saved.sessionID)).workReview).toEqual(saved.review.review)
      const approved = yield* review.transition(saved.sessionID, {
        action: "approve",
        expectedReviewRevision: 1,
        artifactID: saved.review.artifact.artifactID,
        expectedArtifactRevision: saved.review.artifact.artifactRevision,
      })
      expect(approved.review).toMatchObject({ revision: 2, state: "resolved" })
    }).pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/storage.sqlite`)), Effect.scoped)
  }),
)

it.live("AI-TDD-S06-R03/R12: stale Session updates cannot overwrite or remove owned Review metadata", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    yield* Effect.gen(function* () {
      const session = yield* (yield* SessionV2.Service).create({ location: yield* Location.Service, mode: "work" })
      const db = (yield* Database.Service).db
      const artifacts = yield* WorkArtifact.Service
      const applied = yield* artifacts.apply({
        sessionID: session.id,
        relativePath: "owned.md",
        title: "Owned",
        content: "owned",
      })
      const artifact = yield* artifacts.get(session.id)
      if (!artifact) throw new Error("Artifact was not bound")
      const review = yield* (yield* WorkReviewService.Service).transition(session.id, {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: applied.artifact.id,
        expectedArtifactRevision: artifact.revision,
      })
      const old = {
        id: session.id,
        mode: "work" as const,
        slug: session.slug,
        projectID: session.projectID,
        directory: session.location.directory,
        title: "Renamed",
        version: session.version,
        time: { created: 1, updated: 2 },
        metadata: { note: "changed" },
      }
      yield* (yield* EventV2.Service).publish(SessionV1.Event.Updated, { sessionID: session.id, info: old })
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get()
      expect(row?.metadata?.workReview).toEqual(review.review)
      expect(row?.metadata?.workArtifact).toBeDefined()
      expect(row?.metadata?.workContract).toEqual({ source: "ad-hoc", contractVersion: 1 })
      expect(row?.metadata?.note).toBe("changed")
      expect(yield* (yield* WorkReviewService.Service).get(session.id)).toEqual(review)
    }).pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/storage.sqlite`)))
  }),
)

it.live("AI-TDD-S06-R04: separate SQLite scopes share the same review CAS", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const saved = yield* Effect.gen(function* () {
      const session = yield* (yield* SessionV2.Service).create({ location: yield* Location.Service, mode: "work" })
      const artifacts = yield* WorkArtifact.Service
      const applied = yield* artifacts.apply({
        sessionID: session.id,
        relativePath: "cas.md",
        title: "CAS",
        content: "cas",
      })
      const artifact = yield* artifacts.get(session.id)
      if (!artifact) throw new Error("Artifact was not bound")
      const review = yield* (yield* WorkReviewService.Service).transition(session.id, {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: applied.artifact.id,
        expectedArtifactRevision: artifact.revision,
      })
      return { sessionID: session.id, review }
    }).pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/storage.sqlite`)), Effect.scoped)
    const connections: Array<Database.Interface["db"]> = []
    const results = yield* Effect.all(
      ["approve", "request_changes"].map((action) =>
        Effect.gen(function* () {
          connections.push((yield* Database.Service).db)
          return yield* (yield* WorkReviewService.Service)
            .transition(saved.sessionID, {
              action: action === "approve" ? "approve" : "request_changes",
              expectedReviewRevision: 1,
              artifactID: saved.review.artifact.artifactID,
              expectedArtifactRevision: saved.review.artifact.artifactRevision,
            })
            .pipe(
              Effect.match({
                onSuccess: (value) => value.review.revision,
                onFailure: (error) => ({
                  code: error.code,
                  reason: error.reason,
                  committedRevision: error.committedRevision,
                }),
              }),
            )
        }).pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/storage.sqlite`)), Effect.scoped),
      ),
      { concurrency: "unbounded" },
    )
    expect(connections).toHaveLength(2)
    expect(connections[0]).not.toBe(connections[1])
    expect(results.filter((value) => value === 2)).toHaveLength(1)
    expect(results.filter((value) => typeof value !== "number" && value.code !== "conflict")).toEqual([])
    expect(results.map((value) => (typeof value === "number" ? value : value.code))).toContain("conflict")
  }),
)
