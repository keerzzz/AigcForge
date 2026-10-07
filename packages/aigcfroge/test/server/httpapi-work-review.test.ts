import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { ScopedGrantTable } from "@aigcfroge/core/grant/sql"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { MessageTable, SessionInputTable, SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { WorkReviewService } from "@aigcfroge/core/session/work-review-service"
import { Hash } from "@aigcfroge/core/util/hash"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { WorkContract } from "@aigcfroge/schema/work-contract"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { WorkReviewUnavailableError } from "@aigcfroge/server/errors"
import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "node:path"
import { AppLayer } from "../../src/effect/app-runtime"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer } from "./httpapi-layer"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

// Reuse the SDK fixture's production HttpApi + NodeHttpServer.layerTest, not a probe
// group or a mocked review owner. Do not enable AIGCFROGE_V2_RUNTIME for these tests.
const it = testEffect(
  Layer.mergeAll(httpApiLayer, AppLayer, LocationServiceMap.layer, EventV2.defaultLayer).pipe(
    Layer.provide(state),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          AIGCFROGE_SERVER_USERNAME: "aigcfroge",
          AIGCFROGE_SERVER_PASSWORD: "work-review-http-test",
        }),
      ),
    ),
  ),
)
const authorization = `Basic ${Buffer.from("aigcfroge:work-review-http-test").toString("base64")}`
// HttpApiEndpoint uses JSON codecs; optional fields can be encoded as null.
const SessionInfoJson = Schema.toCodecJson(Session.Info)
const ArtifactRecordJson = Schema.toCodecJson(WorkArtifact.ArtifactRecord)
const ReviewResponse = Schema.toCodecJson(Schema.Struct({ data: WorkReview.ReadResult }))
const TransitionResponse = Schema.toCodecJson(Schema.Struct({ data: WorkReview.Ready }))
const ReviewUnavailableJson = Schema.toCodecJson(WorkReviewUnavailableError)
const reviewJson = Schema.encodeSync(Schema.toCodecJson(WorkReview.Review))
const project = () => tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
const reviewPath = (sessionID: string) => `/api/session/${sessionID}/work-review`
const applyPath = (sessionID: string) => `/session/${sessionID}/work-artifact/apply`

const request = Effect.fn("WorkReviewHttpTest.request")(function* (
  directory: string,
  route: string,
  body?: unknown,
  credential: string | null = authorization,
  method: "GET" | "POST" | "PATCH" = body === undefined ? "GET" : "POST",
) {
  const input = HttpClientRequest.make(method)(route).pipe(
    HttpClientRequest.setHeaders({
      "x-aigcfroge-directory": encodeURIComponent(directory),
      ...(credential === null ? {} : { authorization: credential }),
    }),
  )
  const response = yield* (body === undefined ? Effect.succeed(input) : HttpClientRequest.bodyJson(input, body)).pipe(
    Effect.flatMap(HttpClient.execute),
  )
  return {
    status: response.status,
    headers: response.headers,
    body: yield* response.headers["content-type"]?.includes("application/json") ? response.json : response.text,
  }
})

const createSession = Effect.fn("WorkReviewHttpTest.createSession")(function* (
  directory: string,
  mode: ProductMode.GenericSessionMode = "work",
) {
  // The production create path must write WorkContract; never seed review metadata.
  const response = yield* request(directory, "/session", {
    mode,
    title: "HTTP work review",
    metadata: { httpReviewMarker: "preserve me" },
  })
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(SessionInfoJson)(response.body)
})

const applyArtifact = Effect.fn("WorkReviewHttpTest.applyArtifact")(function* (
  directory: string,
  sessionID: SessionID,
  relativePath = "report.md",
  content = "# Review artifact\n",
) {
  const response = yield* request(directory, applyPath(sessionID), {
    title: "Review artifact",
    relativePath,
    content,
    overwrite: false,
  })
  expect(response.status).toBe(200)
  const artifact = yield* Schema.decodeUnknownEffect(ArtifactRecordJson)(response.body)
  expect(artifact.sessionID).toBe(sessionID)
  expect(artifact.relativePath).toBe(relativePath)
  expect(artifact.status).toBe("available")
  const bytes = yield* (yield* FileSystem.FileSystem).readFileString(path.join(directory, relativePath))
  expect(bytes).toBe(content)
  return {
    artifactID: artifact.id,
    expectedArtifactRevision: Schema.decodeUnknownSync(WorkflowAsset.Revision)(Hash.sha256(bytes)),
  }
})

const getReview = Effect.fn("WorkReviewHttpTest.getReview")(function* (directory: string, sessionID: SessionID) {
  const response = yield* request(directory, reviewPath(sessionID))
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(ReviewResponse)(response.body)).data
})

const transition = Effect.fn("WorkReviewHttpTest.transition")(function* (
  directory: string,
  sessionID: SessionID,
  command: unknown,
) {
  const response = yield* request(directory, reviewPath(sessionID), command)
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(TransitionResponse)(response.body)).data
})

const storedSession = Effect.fn("WorkReviewHttpTest.storedSession")(function* (sessionID: SessionID) {
  const row = yield* (yield* Database.Service).db
    .select()
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
  if (!row) throw new Error("Expected the HTTP-created Session in SQLite")
  return row
})

function expectError(response: { status: number; body: unknown }, status: number, tag: string) {
  expect(response.status).toBe(status)
  expect(response.body).toMatchObject({ _tag: tag })
}

// The only direct review write is deliberate corruption, after a real producer write.
const corruptStoredReview = Effect.fn("WorkReviewHttpTest.corruptStoredReview")(function* (
  sessionID: SessionID,
  review: unknown,
) {
  const row = yield* storedSession(sessionID)
  yield* (yield* Database.Service).db
    .update(SessionTable)
    .set({ metadata: { ...row.metadata, workReview: review } })
    .where(eq(SessionTable.id, sessionID))
})

describe("WorkReview through production HttpApi (AI-TDD-S06; generated SDK is a separate mainline gate)", () => {
  it.live("R01/R03: current create persists an ad-hoc WorkContract and GET distinguishes no review", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const row = yield* storedSession(session.id)
      expect(Schema.decodeUnknownSync(WorkContract.Snapshot)(row.metadata?.workContract)).toMatchObject({
        source: "ad-hoc",
        contractVersion: 1,
      })
      expect(row.metadata?.workReview).toBeUndefined()
      expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
      const current = yield* request(directory, `/session/${session.id}`)
      expect(current.status).toBe(200)
      expect(Schema.decodeUnknownSync(SessionInfoJson)(current.body).workReview).toBeUndefined()
    }),
  )

  it.live("R01/R02/R05/R11: real apply and the complete lifecycle agree with SQLite and the current Session GET", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      const database = yield* Database.Service
      const grants = yield* database.db.select().from(ScopedGrantTable)
      const steps = [
        { action: "submit", state: "open" },
        { action: "request_changes", state: "fix_requested" },
        { action: "respond", state: "responded" },
        { action: "re_review", state: "open" },
        { action: "approve", state: "resolved" },
        { action: "reopen", state: "open" },
      ]
      yield* Effect.forEach(steps, (step, index) =>
        Effect.gen(function* () {
          const ready = yield* transition(directory, session.id, {
            action: step.action,
            expectedReviewRevision: index,
            ...(step.action === "respond" ? {} : target),
          })
          expect(ready.review).toMatchObject({
            state: step.state,
            revision: index + 1,
            artifactID: target.artifactID,
            artifactRevision: target.expectedArtifactRevision,
          })
          expect(ready.current).toBe(true)
          expect(ready.artifact).toEqual({
            artifactID: target.artifactID,
            artifactRevision: target.expectedArtifactRevision,
          })
          expect(yield* getReview(directory, session.id)).toEqual(ready)
          const row = yield* storedSession(session.id)
          expect(row.metadata?.workReview).toEqual(ready.review)
          expect(row.metadata?.httpReviewMarker).toBe("preserve me")
          expect(row.metadata).not.toHaveProperty("workReviewVersion")
          const current = yield* request(directory, `/session/${session.id}`)
          expect(current.status).toBe(200)
          expect(current.body).toMatchObject({ workReview: reviewJson(ready.review) })
          const canonical = yield* request(directory, `/api/session/${session.id}`)
          expect(canonical.status).toBe(200)
          expect(canonical.body).toMatchObject({ data: { workReview: reviewJson(ready.review) } })
        }),
      )
      const oldApprove = yield* request(directory, reviewPath(session.id), {
        action: "approve",
        expectedReviewRevision: 5,
        ...target,
      })
      expectError(oldApprove, 409, "ConflictError")
      expect(yield* getReview(directory, session.id)).toMatchObject({
        review: { state: "open", revision: 6, reopenedFrom: "resolved" },
      })
      expect(yield* database.db.select().from(ScopedGrantTable)).toEqual(grants)
      expect(
        yield* database.db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, session.id)),
      ).toEqual([])
      expect(
        yield* database.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.session_id, session.id)),
      ).toEqual([])
      expect(yield* database.db.select().from(MessageTable).where(eq(MessageTable.session_id, session.id))).toEqual([])
    }),
  )

  it.live("R03: default create accepts the existing preset, workflow and ad-hoc WorkContract draft shapes", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const contracts = [
        { source: "ad-hoc", contractVersion: 1 },
        { source: "workflow", contractVersion: 1, workflowID: "http-draft", revision: Hash.sha256("workflow draft") },
        {
          source: "preset",
          contractVersion: 1,
          presetID: "http-draft",
          revision: Hash.sha256("preset draft"),
          output: { outputType: "markdown", artifact: { title: "Draft", filename: "draft.md" } },
        },
      ]
      yield* Effect.forEach(contracts, (draft) =>
        Effect.gen(function* () {
          const contract = Schema.decodeUnknownSync(WorkContract.Snapshot)(draft)
          const created = yield* request(directory, "/session", {
            mode: "work",
            title: "Existing draft contract",
            metadata: { workContract: contract },
          })
          expect(created.status).toBe(200)
          const session = Schema.decodeUnknownSync(SessionInfoJson)(created.body)
          expect((yield* storedSession(session.id)).metadata?.workContract).toEqual(contract)
          expect((yield* request(directory, `/session/${session.id}`)).body).toMatchObject({
            workContract: Schema.encodeSync(Schema.toCodecJson(WorkContract.Snapshot))(contract),
          })
          expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
        }),
      )
      const malformed = yield* request(directory, "/session", {
        mode: "work",
        metadata: { workContract: { source: "preset", contractVersion: 1 } },
      })
      expect(malformed.status).toBe(400)
    }),
  )

  it.live("R02/R13: default create rejects forged review/artifact; PATCH rejects all three frozen owner keys", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const approved = yield* transition(directory, session.id, {
        action: "approve",
        expectedReviewRevision: 1,
        ...target,
      })
      const database = yield* Database.Service
      const before = yield* storedSession(session.id)
      const ids = yield* database.db.select({ id: SessionTable.id }).from(SessionTable)
      yield* Effect.forEach(["workReview", "workArtifact", "workContract"], (key) =>
        Effect.gen(function* () {
          expect(before.metadata?.[key]).toBeDefined()
          yield* Effect.forEach([before.metadata?.[key], null], (value) =>
            Effect.gen(function* () {
              // workContract is a supported draft input at creation, but frozen by PATCH.
              if (key !== "workContract") {
                const created = yield* request(directory, "/session", {
                  mode: "work",
                  metadata: { [key]: value },
                })
                expect(created.status).toBe(400)
              }
              const patched = yield* request(
                directory,
                `/session/${session.id}`,
                {
                  title: "Must not partially update",
                  metadata: { [key]: value },
                },
                authorization,
                "PATCH",
              )
              expect(patched.status).toBe(400)
              const row = yield* storedSession(session.id)
              expect(row.title).toBe(before.title)
              expect(row.metadata).toEqual(before.metadata)
              expect(yield* getReview(directory, session.id)).toEqual(approved)
            }),
          )
        }),
      )
      expect(yield* database.db.select({ id: SessionTable.id }).from(SessionTable)).toEqual(ids)
    }),
  )

  it.live(
    "R03/R11: ordinary title and metadata updates preserve an approved review and its frozen contract/artifact",
    () =>
      Effect.gen(function* () {
        const directory = yield* project()
        const session = yield* createSession(directory)
        const target = yield* applyArtifact(directory, session.id)
        yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
        const approved = yield* transition(directory, session.id, {
          action: "approve",
          expectedReviewRevision: 1,
          ...target,
        })
        const before = yield* storedSession(session.id)
        yield* Effect.forEach(
          [
            { title: "Retitled after approval" },
            { metadata: { ordinaryNote: "Updated after approval" } },
            { metadata: {} },
          ],
          (body) =>
            Effect.gen(function* () {
              const updated = yield* request(directory, `/session/${session.id}`, body, authorization, "PATCH")
              expect(updated.status).toBe(200)
              expect(Schema.decodeUnknownSync(SessionInfoJson)(updated.body).workReview).toEqual(approved.review)
              const row = yield* storedSession(session.id)
              expect(row.title).toBe("Retitled after approval")
              expect(row.metadata?.workReview).toEqual(approved.review)
              expect(row.metadata?.workArtifact).toEqual(before.metadata?.workArtifact)
              expect(row.metadata?.workContract).toEqual(before.metadata?.workContract)
              expect(yield* getReview(directory, session.id)).toEqual(approved)
              expect((yield* request(directory, `/session/${session.id}`)).body).toMatchObject({
                workReview: reviewJson(approved.review),
              })
              expect((yield* request(directory, `/api/session/${session.id}`)).body).toMatchObject({
                data: { workReview: reviewJson(approved.review) },
              })
            }),
        )
      }),
  )

  it.live("R04: concurrent commands at one revision have exactly one winner and a typed 409 loser", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const responses = yield* Effect.all(
        ["approve", "request_changes"].map((action) =>
          request(directory, reviewPath(session.id), { action, expectedReviewRevision: 1, ...target }),
        ),
        { concurrency: "unbounded" },
      )
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      const winner = responses.find((response) => response.status === 200)
      const loser = responses.find((response) => response.status === 409)
      if (!winner || !loser) throw new Error("Expected one successful command and one conflict")
      expectError(loser, 409, "ConflictError")
      const ready = Schema.decodeUnknownSync(TransitionResponse)(winner.body).data
      expect(ready.review.revision).toBe(2)
      expect(yield* getReview(directory, session.id)).toEqual(ready)
      expect((yield* storedSession(session.id)).metadata?.workReview).toEqual(ready.review)
    }),
  )

  it.live("R05/R09: artifact IDs from another Session or Location cannot be submitted or approved", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const elsewhere = yield* project()
      const session = yield* createSession(directory)
      const sibling = yield* createSession(directory)
      const foreign = yield* createSession(elsewhere)
      const target = yield* applyArtifact(directory, session.id, "owner.md")
      const siblingTarget = yield* applyArtifact(directory, sibling.id, "sibling.md")
      const foreignTarget = yield* applyArtifact(elsewhere, foreign.id, "foreign.md")
      yield* Effect.forEach([siblingTarget, foreignTarget], (other) =>
        Effect.gen(function* () {
          const denied = yield* request(directory, reviewPath(session.id), {
            action: "submit",
            expectedReviewRevision: 0,
            ...other,
          })
          expectError(denied, 409, "ConflictError")
          expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
        }),
      )
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      yield* Effect.forEach([siblingTarget, foreignTarget], (other) =>
        Effect.gen(function* () {
          const denied = yield* request(directory, reviewPath(session.id), {
            action: "approve",
            expectedReviewRevision: 1,
            ...other,
          })
          expectError(denied, 409, "ConflictError")
        }),
      )
      expect(yield* getReview(directory, session.id)).toMatchObject({ review: { state: "open", revision: 1 } })
      expect(yield* getReview(directory, sibling.id)).toEqual({ status: "none" })
      expect(yield* getReview(elsewhere, foreign.id)).toEqual({ status: "none" })
    }),
  )

  it.live("R09/R15: apply follows persisted Session placement, not request directory hints or a fabricated ACL", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const elsewhere = yield* project()
      const session = yield* createSession(directory)
      const response = yield* request(
        elsewhere,
        `${applyPath(session.id)}?directory=${encodeURIComponent(elsewhere)}`,
        {
          title: "Persisted owner",
          relativePath: "owned.md",
          content: "# Owner\n",
          overwrite: false,
        },
      )
      expect(response.status).toBe(200)
      const artifact = Schema.decodeUnknownSync(ArtifactRecordJson)(response.body)
      const fs = yield* FileSystem.FileSystem
      expect(yield* fs.readFileString(path.join(directory, "owned.md"))).toBe("# Owner\n")
      expect(yield* fs.exists(path.join(elsewhere, "owned.md"))).toBe(false)
      // Existing authenticated Session management permits this operator to address
      // the Session in its URL; the directory hint is not a reviewer identity.
      const ready = yield* transition(elsewhere, session.id, {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: artifact.id,
        expectedArtifactRevision: Hash.sha256("# Owner\n"),
      })
      expect(yield* getReview(directory, session.id)).toEqual(ready)
      expect(yield* getReview(elsewhere, session.id)).toEqual(ready)
      const conflict = yield* request(elsewhere, applyPath(session.id), {
        title: "Overwrite denied",
        relativePath: "owned.md",
        content: "replacement",
        overwrite: false,
      })
      expectError(conflict, 409, "ConflictError")
      expect(JSON.stringify(conflict.body)).not.toContain(directory)
      expect(yield* fs.readFileString(path.join(directory, "owned.md"))).toBe("# Owner\n")
    }),
  )

  it.live(
    "R02/R15: forged actor, owner, state, timestamps, metadata and placement are rejected before a valid submit",
    () =>
      Effect.gen(function* () {
        const directory = yield* project()
        const session = yield* createSession(directory)
        const target = yield* applyArtifact(directory, session.id)
        const forged = [
          { actor: "reviewer" },
          { owner: "administrator" },
          { state: "resolved" },
          { nextState: "resolved" },
          { updatedAt: 1 },
          { createdAt: 1 },
          { timestamp: 1 },
          { revision: 100 },
          { metadata: { workReview: { state: "resolved", revision: 100 } } },
          { location: { directory } },
          { sessionID: "ses_other" },
        ]
        yield* Effect.forEach(forged, (extra) =>
          Effect.gen(function* () {
            const denied = yield* request(directory, reviewPath(session.id), {
              action: "submit",
              expectedReviewRevision: 0,
              ...target,
              ...extra,
            })
            expectError(denied, 400, "InvalidRequestError")
            expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
          }),
        )
        yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
        yield* transition(directory, session.id, { action: "request_changes", expectedReviewRevision: 1, ...target })
        const responseWithBinding = yield* request(directory, reviewPath(session.id), {
          action: "respond",
          expectedReviewRevision: 2,
          ...target,
        })
        expectError(responseWithBinding, 400, "InvalidRequestError")
        expect(yield* getReview(directory, session.id)).toMatchObject({
          review: { state: "fix_requested", revision: 2 },
        })
        expect(
          yield* transition(directory, session.id, { action: "respond", expectedReviewRevision: 2 }),
        ).toMatchObject({
          review: { state: "responded", revision: 3 },
        })
      }),
  )

  it.live("R02/R13: malformed actions, revisions and bindings cannot initialize a review", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      const valid = { action: "submit", expectedReviewRevision: 0, ...target }
      const malformed = [
        null,
        [],
        {},
        { ...valid, action: "delete" },
        { ...valid, expectedReviewRevision: -1 },
        { ...valid, expectedReviewRevision: 0.5 },
        { ...valid, expectedReviewRevision: "0" },
        { action: "submit", ...target },
        { action: "submit", expectedReviewRevision: 0 },
        { ...valid, artifactID: "" },
        { ...valid, expectedArtifactRevision: "not-a-hash" },
      ]
      yield* Effect.forEach(malformed, (body) =>
        Effect.gen(function* () {
          expectError(yield* request(directory, reviewPath(session.id), body), 400, "InvalidRequestError")
        }),
      )
      expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
      expect((yield* storedSession(session.id)).metadata?.workReview).toBeUndefined()
    }),
  )

  it.live("R02/R05: illegal state changes and stale content hashes do not advance the review revision", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      expectError(
        yield* request(directory, reviewPath(session.id), {
          action: "approve",
          expectedReviewRevision: 0,
          ...target,
        }),
        400,
        "InvalidRequestError",
      )
      const ready = yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      yield* Effect.forEach(["submit", "respond", "reopen", "re_review"], (action) =>
        Effect.gen(function* () {
          expectError(
            yield* request(directory, reviewPath(session.id), {
              action,
              expectedReviewRevision: 1,
              ...(action === "respond" ? {} : target),
            }),
            400,
            "InvalidRequestError",
          )
        }),
      )
      expectError(
        yield* request(directory, reviewPath(session.id), {
          action: "approve",
          expectedReviewRevision: 1,
          ...target,
          expectedArtifactRevision: Hash.sha256("not the current file"),
        }),
        409,
        "ConflictError",
      )
      expect(yield* getReview(directory, session.id)).toEqual(ready)
    }),
  )

  it.live("R09: a non-Work Session is forbidden and missing Sessions have typed 404 responses", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory, "coding")
      const command = {
        action: "submit",
        expectedReviewRevision: 0,
        artifactID: "art_missing",
        expectedArtifactRevision: Hash.sha256("missing"),
      }
      expectError(yield* request(directory, reviewPath(session.id)), 403, "ForbiddenError")
      expectError(yield* request(directory, reviewPath(session.id), command), 403, "ForbiddenError")
      expectError(
        yield* request(directory, applyPath(session.id), {
          title: "Wrong mode",
          relativePath: "denied.md",
          content: "not written",
          overwrite: false,
        }),
        403,
        "ForbiddenError",
      )
      const missing = "ses_http_work_review_missing"
      expectError(yield* request(directory, reviewPath(missing)), 404, "SessionNotFoundError")
      expectError(yield* request(directory, reviewPath(missing), command), 404, "SessionNotFoundError")
      expectError(
        yield* request(directory, applyPath(missing), {
          title: "Missing",
          relativePath: "denied.md",
          content: "not written",
          overwrite: false,
        }),
        404,
        "SessionNotFoundError",
      )
      expect(yield* (yield* FileSystem.FileSystem).exists(path.join(directory, "denied.md"))).toBe(false)
    }),
  )

  it.live("R15: missing or wrong credentials yield 401 on both review methods and artifact apply", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      const command = { action: "submit", expectedReviewRevision: 0, ...target }
      yield* Effect.forEach([null, `Basic ${Buffer.from("aigcfroge:wrong").toString("base64")}`], (credential) =>
        Effect.gen(function* () {
          const get = yield* request(directory, reviewPath(session.id), undefined, credential)
          expectError(get, 401, "UnauthorizedError")
          expect(get.headers["www-authenticate"]).toContain("Basic")
          expectError(yield* request(directory, reviewPath(session.id), command, credential), 401, "UnauthorizedError")
          expectError(
            yield* request(directory, reviewPath("ses_missing"), undefined, credential),
            401,
            "UnauthorizedError",
          )
          const apply = yield* request(
            directory,
            applyPath(session.id),
            {
              title: "Unauthenticated",
              relativePath: "denied.md",
              content: "not written",
              overwrite: false,
            },
            credential,
          )
          // The existing instance Authorization contract is UnauthorizedNoContent.
          expect(apply.status).toBe(401)
          expect(apply.body).toBe("")
          expect(apply.headers["www-authenticate"]).toContain("Basic")
        }),
      )
      expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
      expect(yield* (yield* FileSystem.FileSystem).exists(path.join(directory, "denied.md"))).toBe(false)
      expect(yield* transition(directory, session.id, command)).toMatchObject({
        review: { state: "open", revision: 1 },
      })
    }),
  )

  it.live("R03/R13: corrupt persisted reviews are unavailable, never treated as expected revision zero", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      const ready = yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      yield* Effect.forEach(["revision", "artifactID"], (missing) =>
        Effect.gen(function* () {
          const corrupt = Object.fromEntries(Object.entries(ready.review).filter(([key]) => key !== missing))
          yield* corruptStoredReview(session.id, corrupt)
          expect(yield* getReview(directory, session.id)).toMatchObject({
            status: "unavailable",
            reason: "corrupt_review",
          })
          expectError(
            yield* request(directory, reviewPath(session.id), {
              action: "submit",
              expectedReviewRevision: 0,
              ...target,
            }),
            400,
            "InvalidRequestError",
          )
          expect((yield* storedSession(session.id)).metadata?.workReview).toEqual(corrupt)
        }),
      )
    }),
  )
  ;["invalid JSON", "bad shape"].forEach((corruption) => {
    ;["get", "transition", "apply"].forEach((endpoint) => {
      it.live(`R09: raw metadata ${corruption} is a typed safe failure on ${endpoint}`, () =>
        Effect.gen(function* () {
          const directory = yield* project()
          const session = yield* createSession(directory)
          const target = yield* applyArtifact(directory, session.id)
          yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
          const before = yield* storedSession(session.id)
          const database = yield* Database.Service
          const fs = yield* FileSystem.FileSystem
          // Restore only the test's deliberate corruption, including when the RED assertion fails.
          yield* Effect.addFinalizer(() =>
            database.db
              .update(SessionTable)
              .set({ metadata: before.metadata })
              .where(eq(SessionTable.id, session.id))
              .pipe(Effect.orDie),
          )
          const privateValue = `${directory}/private/raw-metadata private-metadata-body-sentinel`
          yield* Effect.forEach(
            corruption === "invalid JSON"
              ? [`{"privateValue":${JSON.stringify(privateValue)}`]
              : [JSON.stringify([privateValue]), JSON.stringify(privateValue), "true", "42", "null"],
            (raw) =>
              Effect.gen(function* () {
                // Bypass Drizzle's JSON encoder, not the production HTTP or domain implementation.
                yield* database.db
                  .update(SessionTable)
                  .set({ metadata: sql`${raw}` })
                  .where(eq(SessionTable.id, session.id))
                const response = yield* request(
                  directory,
                  endpoint === "apply" ? applyPath(session.id) : reviewPath(session.id),
                  endpoint === "get"
                    ? undefined
                    : endpoint === "transition"
                      ? { action: "approve", expectedReviewRevision: 1, ...target }
                      : {
                          title: "Must not be written",
                          relativePath: "blocked.md",
                          content: "Must not be written",
                          overwrite: false,
                        },
                )
                // Corruption must remain a declared error/read result, never a 500 defect or an empty review.
                if (endpoint === "get" && corruption === "bad shape") {
                  expect(response.status).toBe(200)
                  expect(Schema.decodeUnknownSync(ReviewResponse)(response.body).data).toEqual({
                    status: "unavailable",
                    reason: "corrupt_review",
                  })
                }
                if (endpoint !== "apply" && corruption === "invalid JSON") {
                  expectError(response, 503, "WorkReviewUnavailableError")
                  expect(response.body).toMatchObject({
                    message: "Work review storage is unavailable",
                    code: "storage",
                  })
                }
                if (endpoint === "apply" || (endpoint === "transition" && corruption === "bad shape")) {
                  expectError(response, 409, "ConflictError")
                  expect(response.body).toMatchObject({
                    message: "Work artifact is unavailable",
                    resource: "work-artifact",
                  })
                }
                expect(JSON.stringify(response.body)).not.toContain(directory)
                expect(JSON.stringify(response.body)).not.toContain("/private/raw-metadata")
                expect(JSON.stringify(response.body)).not.toContain("private-metadata-body-sentinel")
                expect(JSON.stringify(response.body)).not.toContain("SyntaxError")
                expect(JSON.stringify(response.body)).not.toContain("Drizzle")
                // A raw projection avoids re-triggering the very decoder failure under test.
                const stored = yield* database.db
                  .select({ metadata: sql<string>`${SessionTable.metadata}` })
                  .from(SessionTable)
                  .where(eq(SessionTable.id, session.id))
                  .get()
                expect(stored?.metadata).toBe(raw)
                expect(yield* fs.readFileString(path.join(directory, "report.md"))).toBe("# Review artifact\n")
                expect(yield* fs.exists(path.join(directory, "blocked.md"))).toBe(false)
              }),
          )
        }),
      )
    })
  })

  it.live("R07: replacing the Location service scope preserves the review through real HTTP, SQLite and files", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      const ready = yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const locations = yield* LocationServiceMap
      const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
      const owners = Effect.gen(function* () {
        return { artifacts: yield* WorkArtifact.Service, reviews: yield* WorkReviewService.Service }
      })
      // Release the borrow before invalidation; otherwise LayerMap cannot close its owner scope.
      const before = yield* owners.pipe(Effect.provide(locations.get(ref)), Effect.scoped)
      yield* locations.invalidate(ref)
      const after = yield* owners.pipe(Effect.provide(locations.get(ref)), Effect.scoped)
      expect(after.artifacts).not.toBe(before.artifacts)
      expect(after.reviews).not.toBe(before.reviews)
      expect(yield* getReview(directory, session.id)).toEqual(ready)
      expect((yield* request(directory, `/session/${session.id}`)).body).toMatchObject({
        workReview: reviewJson(ready.review),
      })
      expect(
        yield* transition(directory, session.id, { action: "approve", expectedReviewRevision: 1, ...target }),
      ).toMatchObject({
        review: { state: "resolved", revision: 2 },
        current: true,
      })
    }),
  )

  it.live("R08/R09: deleted files and escaping symlinks invalidate approval without exposing paths or contents", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const elsewhere = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const approved = yield* transition(directory, session.id, {
        action: "approve",
        expectedReviewRevision: 1,
        ...target,
      })
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(path.join(directory, "report.md"))
      expect(yield* getReview(directory, session.id)).toMatchObject({
        status: "unavailable",
        reason: "artifact_unavailable",
      })
      const missing = yield* request(directory, reviewPath(session.id), {
        action: "reopen",
        expectedReviewRevision: 2,
        ...target,
      })
      expectError(missing, 409, "ConflictError")
      yield* fs.writeFileString(path.join(elsewhere, "secret.md"), "private-review-body-sentinel")
      yield* fs.symlink(path.join(elsewhere, "secret.md"), path.join(directory, "report.md"))
      const unavailable = yield* getReview(directory, session.id)
      expect(unavailable).toMatchObject({ status: "unavailable", reason: "artifact_unavailable" })
      const denied = yield* request(directory, reviewPath(session.id), {
        action: "reopen",
        expectedReviewRevision: 2,
        ...target,
      })
      expectError(denied, 409, "ConflictError")
      ;[missing.body, unavailable, denied.body].forEach((body) => {
        expect(JSON.stringify(body)).not.toContain(directory)
        expect(JSON.stringify(body)).not.toContain(elsewhere)
        expect(JSON.stringify(body)).not.toContain("private-review-body-sentinel")
      })
      expect((yield* storedSession(session.id)).metadata?.workReview).toEqual(approved.review)
      const invalidPath = yield* request(directory, applyPath(session.id), {
        title: "Traversal",
        relativePath: "../escape.md",
        content: "private-review-body-sentinel",
        overwrite: false,
      })
      expectError(invalidPath, 400, "InvalidRequestError")
      expect(JSON.stringify(invalidPath.body)).not.toContain(directory)
      expect(JSON.stringify(invalidPath.body)).not.toContain("private-review-body-sentinel")
    }),
  )

  it.live("R14: a different artifact with the same hash cannot inherit approval and can be explicitly reopened", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const first = yield* applyArtifact(directory, session.id, "a.md")
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...first })
      yield* transition(directory, session.id, { action: "approve", expectedReviewRevision: 1, ...first })
      const second = yield* applyArtifact(directory, session.id, "b.md")
      expect(second.artifactID).not.toBe(first.artifactID)
      expect(second.expectedArtifactRevision).toBe(first.expectedArtifactRevision)
      expect(yield* getReview(directory, session.id)).toMatchObject({
        status: "ready",
        current: false,
        artifact: { artifactID: second.artifactID },
        review: { state: "resolved", revision: 2, artifactID: first.artifactID },
      })
      expect(
        yield* transition(directory, session.id, { action: "reopen", expectedReviewRevision: 2, ...second }),
      ).toMatchObject({
        current: true,
        review: { state: "open", revision: 3, artifactID: second.artifactID },
      })
      expectError(
        yield* request(directory, reviewPath(session.id), {
          action: "approve",
          expectedReviewRevision: 1,
          ...first,
        }),
        409,
        "ConflictError",
      )
      expect(
        yield* transition(directory, session.id, { action: "approve", expectedReviewRevision: 3, ...second }),
      ).toMatchObject({
        current: true,
        review: { state: "resolved", revision: 4, artifactID: second.artifactID },
      })
    }),
  )

  it.live("R17: stale open can re-review the real replacement; unchanged open cannot bypass the lifecycle", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const first = yield* applyArtifact(directory, session.id, "a.md")
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...first })
      const second = yield* applyArtifact(directory, session.id, "b.md", "# Revised artifact\n")
      expect(yield* getReview(directory, session.id)).toMatchObject({
        current: false,
        review: { state: "open", revision: 1 },
      })
      expect(
        yield* transition(directory, session.id, { action: "re_review", expectedReviewRevision: 1, ...second }),
      ).toMatchObject({
        current: true,
        review: { state: "open", revision: 2, artifactID: second.artifactID },
      })
      expectError(
        yield* request(directory, reviewPath(session.id), {
          action: "re_review",
          expectedReviewRevision: 2,
          ...second,
        }),
        400,
        "InvalidRequestError",
      )
      expectError(
        yield* request(directory, reviewPath(session.id), {
          action: "approve",
          expectedReviewRevision: 1,
          ...first,
        }),
        409,
        "ConflictError",
      )
      expect(
        yield* transition(directory, session.id, { action: "approve", expectedReviewRevision: 2, ...second }),
      ).toMatchObject({
        current: true,
        review: { state: "resolved", revision: 3, artifactID: second.artifactID },
      })
    }),
  )

  it.live("R16: racing apply and approve never transfers approval to the replacement artifact", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id, "a.md")
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const responses = yield* Effect.all(
        [
          request(directory, applyPath(session.id), {
            title: "Replacement",
            relativePath: "b.md",
            content: "# Review artifact\n",
            overwrite: false,
          }),
          request(directory, reviewPath(session.id), { action: "approve", expectedReviewRevision: 1, ...target }),
        ],
        { concurrency: "unbounded" },
      )
      expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true)
      expect(responses.some((response) => response.status === 200)).toBe(true)
      const current = yield* getReview(directory, session.id)
      if (responses[0].status === 200) {
        const replacement = Schema.decodeUnknownSync(ArtifactRecordJson)(responses[0].body)
        expect(current).toMatchObject({
          status: "ready",
          current: false,
          artifact: { artifactID: replacement.id },
          review: { artifactID: target.artifactID },
        })
        expect(yield* (yield* FileSystem.FileSystem).readFileString(path.join(directory, "b.md"))).toBe(
          "# Review artifact\n",
        )
      }
      if (responses[1].status === 200) expect(current).toMatchObject({ review: { state: "resolved", revision: 2 } })
      yield* Effect.forEach(
        responses.filter((response) => response.status === 409),
        (response) => Effect.sync(() => expectError(response, 409, "ConflictError")),
      )
    }),
  )

  it.live("R06/R09: artifact binding failure returns safe 503 and only a successful recovery can start review", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const database = yield* Database.Service
      yield* database.db.run(`
        CREATE TEMP TRIGGER http_work_artifact_binding_failure
        BEFORE UPDATE OF metadata ON session
        WHEN json_extract(NEW.metadata, '$.workArtifact') IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, '/private/artifact-store private-artifact-storage-sentinel');
        END
      `)
      yield* Effect.addFinalizer(() =>
        database.db.run("DROP TRIGGER IF EXISTS http_work_artifact_binding_failure").pipe(Effect.orDie),
      )
      const input = {
        title: "Recoverable artifact",
        relativePath: "recoverable.md",
        content: "# Recoverable artifact\n",
        overwrite: false,
      }
      const failed = yield* request(directory, applyPath(session.id), input)
      expectError(failed, 503, "ServiceUnavailableError")
      expect(JSON.stringify(failed.body)).not.toContain("/private/artifact-store")
      expect(JSON.stringify(failed.body)).not.toContain("private-artifact-storage-sentinel")
      expect(JSON.stringify(failed.body)).not.toContain(directory)
      expect((yield* storedSession(session.id)).metadata?.workArtifact).toBeUndefined()
      expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
      yield* database.db.run("DROP TRIGGER http_work_artifact_binding_failure")
      // File I/O and SQLite are not one transaction. Explicit overwrite repairs
      // the real file if the failed bind left it in place; do not fabricate a pointer.
      const recovered = yield* request(directory, applyPath(session.id), { ...input, overwrite: true })
      expect(recovered.status).toBe(200)
      const artifact = Schema.decodeUnknownSync(ArtifactRecordJson)(recovered.body)
      expect(yield* (yield* FileSystem.FileSystem).readFileString(path.join(directory, input.relativePath))).toBe(
        input.content,
      )
      expect(
        yield* transition(directory, session.id, {
          action: "submit",
          expectedReviewRevision: 0,
          artifactID: artifact.id,
          expectedArtifactRevision: Hash.sha256(input.content),
        }),
      ).toMatchObject({ current: true, review: { state: "open", revision: 1, artifactID: artifact.id } })
    }),
  )

  it.live(
    "R06/R09: a real SQLite write failure maps to safe 503, preserves metadata, and can be retried after recovery",
    () =>
      Effect.gen(function* () {
        const directory = yield* project()
        const session = yield* createSession(directory)
        const target = yield* applyArtifact(directory, session.id)
        const database = yield* Database.Service
        const before = yield* storedSession(session.id)
        yield* database.db.run(`
        CREATE TEMP TRIGGER http_work_review_storage_failure
        BEFORE UPDATE OF metadata ON session
        WHEN json_extract(NEW.metadata, '$.workReview') IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, '/private/review-store private-storage-body-sentinel');
        END
      `)
        yield* Effect.addFinalizer(() =>
          database.db.run("DROP TRIGGER IF EXISTS http_work_review_storage_failure").pipe(Effect.orDie),
        )
        const command = { action: "submit", expectedReviewRevision: 0, ...target }
        const failed = yield* request(directory, reviewPath(session.id), command)
        expectError(failed, 503, "WorkReviewUnavailableError")
        expect(Schema.decodeUnknownSync(ReviewUnavailableJson)(failed.body).committedRevision).toBeUndefined()
        expect(JSON.stringify(failed.body)).not.toContain("/private/review-store")
        expect(JSON.stringify(failed.body)).not.toContain("private-storage-body-sentinel")
        expect(JSON.stringify(failed.body)).not.toContain(directory)
        expect((yield* storedSession(session.id)).metadata).toEqual(before.metadata)
        expect(yield* getReview(directory, session.id)).toEqual({ status: "none" })
        yield* database.db.run("DROP TRIGGER http_work_review_storage_failure")
        expect(yield* transition(directory, session.id, command)).toMatchObject({
          review: { state: "open", revision: 1 },
        })
      }),
  )

  it.live("R06/R16: post-commit artifact binding changes report committedRevision and recover as stale over HTTP", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const session = yield* createSession(directory)
      const target = yield* applyArtifact(directory, session.id)
      yield* transition(directory, session.id, { action: "submit", expectedReviewRevision: 0, ...target })
      const database = yield* Database.Service
      const trigger = `http_work_review_postcheck_${Hash.sha256(session.id).slice(0, 16)}`
      yield* Effect.addFinalizer(() => database.db.run(`DROP TRIGGER IF EXISTS ${trigger}`).pipe(Effect.orDie))
      // Mutate this Session's binding in the real transaction, then let the real
      // Artifact postcheck detect it after commit. The state guard prevents recursion.
      yield* database.db.run(`
          CREATE TEMP TRIGGER ${trigger}
          AFTER UPDATE OF metadata ON session
          WHEN NEW.id = '${session.id.replaceAll("'", "''")}'
            AND json_extract(OLD.metadata, '$.workReview.state') = 'open'
            AND json_extract(NEW.metadata, '$.workReview.state') = 'resolved'
            AND json_extract(NEW.metadata, '$.workReview.revision') = 2
          BEGIN
            UPDATE session
            SET metadata = json_set(
              metadata,
              '$.workArtifact.artifact.id',
              json_extract(metadata, '$.workArtifact.artifact.id') || '-postcheck'
            )
            WHERE id = NEW.id;
          END;
        `)
      const command = { action: "approve", expectedReviewRevision: 1, ...target }
      const failed = yield* request(directory, reviewPath(session.id), command)
      expectError(failed, 503, "WorkReviewUnavailableError")
      expect(Schema.decodeUnknownSync(ReviewUnavailableJson)(failed.body)).toMatchObject({
        code: "storage",
        committedRevision: 2,
      })
      expect(JSON.stringify(failed.body)).not.toContain(directory)
      const stored = yield* storedSession(session.id)
      expect(stored.metadata?.workReview).toMatchObject({
        state: "resolved",
        revision: 2,
        artifactID: target.artifactID,
        artifactRevision: target.expectedArtifactRevision,
      })
      expect(stored.metadata?.workArtifact).toMatchObject({
        artifact: { id: `${target.artifactID}-postcheck`, sessionID: session.id },
        revision: target.expectedArtifactRevision,
      })
      expect(yield* getReview(directory, session.id)).toMatchObject({
        status: "ready",
        current: false,
        review: { state: "resolved", revision: 2, artifactID: target.artifactID },
        artifact: {
          artifactID: `${target.artifactID}-postcheck`,
          artifactRevision: target.expectedArtifactRevision,
        },
      })
      expectError(yield* request(directory, reviewPath(session.id), command), 409, "ConflictError")
      expect((yield* storedSession(session.id)).metadata).toEqual(stored.metadata)
    }),
  )

  it.live(
    "R06/R12: notification failure reports committedRevision and authoritative GET recovers the committed review",
    () =>
      Effect.gen(function* () {
        const directory = yield* project()
        const session = yield* createSession(directory)
        const target = yield* applyArtifact(directory, session.id)
        const off = yield* (yield* EventV2.Service).listen((event) => {
          if (event.type !== WorkReviewService.Event.Updated.type) return Effect.void
          return Effect.die("/private/review-notifier private-notification-body-sentinel")
        })
        yield* Effect.addFinalizer(() => off)
        const failed = yield* request(directory, reviewPath(session.id), {
          action: "submit",
          expectedReviewRevision: 0,
          ...target,
        })
        expectError(failed, 503, "WorkReviewUnavailableError")
        expect(failed.body).toMatchObject({ code: "notification", committedRevision: 1 })
        expect(JSON.stringify(failed.body)).not.toContain("/private/review-notifier")
        expect(JSON.stringify(failed.body)).not.toContain("private-notification-body-sentinel")
        yield* off
        const ready = yield* getReview(directory, session.id)
        expect(ready).toMatchObject({ status: "ready", current: true, review: { state: "open", revision: 1 } })
        expect((yield* storedSession(session.id)).metadata?.workReview).toEqual(
          Schema.decodeUnknownSync(WorkReview.Ready)(ready).review,
        )
        expectError(
          yield* request(directory, reviewPath(session.id), {
            action: "submit",
            expectedReviewRevision: 0,
            ...target,
          }),
          409,
          "ConflictError",
        )
      }),
  )

  it.live("R10: production OpenAPI declares canonical identifiers and typed HTTP errors", () =>
    Effect.gen(function* () {
      const directory = yield* project()
      const response = yield* request(directory, "/doc")
      expect(response.status).toBe(200)
      const operation = Schema.Struct({
        operationId: Schema.String,
        responses: Schema.Record(Schema.String, Schema.Unknown),
      })
      const document = Schema.decodeUnknownSync(
        Schema.Struct({
          paths: Schema.Record(Schema.String, Schema.Unknown),
        }),
      )(response.body)
      const route = Schema.decodeUnknownSync(Schema.Struct({ get: operation, post: operation }))(
        document.paths["/api/session/{sessionID}/work-review"],
      )
      expect(route.get.operationId).toBe("v2.session.workReview.get")
      expect(route.post.operationId).toBe("v2.session.workReview.transition")
      expect(Object.keys(route.get.responses)).toEqual(
        expect.arrayContaining(["200", "400", "401", "403", "404", "409", "503"]),
      )
      expect(Object.keys(route.post.responses)).toEqual(
        expect.arrayContaining(["200", "400", "401", "403", "404", "409", "503"]),
      )
      expect(response.body).toHaveProperty("components.schemas.WorkReviewUnavailableError.properties.committedRevision")
    }),
  )
})
