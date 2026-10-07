import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer } from "effect"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { WorkReviewService } from "@aigcfroge/core/session/work-review-service"
import { WorkReviewFixture } from "./fixture/work-review"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const fixture = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    return yield* effect.pipe(Effect.provide(WorkReviewFixture.layer(tmp.path, `${tmp.path}/review.sqlite`)))
  })

const setup = Effect.gen(function* () {
  const location = yield* Location.Service
  const session = yield* (yield* SessionV2.Service).create({ location, mode: "work" })
  const artifacts = yield* WorkArtifact.Service
  const applied = yield* artifacts.apply({
    sessionID: session.id,
    relativePath: "result.md",
    title: "Result",
    content: "first revision",
  })
  const snapshot = yield* artifacts.get(session.id)
  if (!snapshot) throw new Error("Artifact producer did not return its applied content")
  return { session, applied, snapshot, review: yield* WorkReviewService.Service, artifacts }
})

const submit = (value: Effect.Success<typeof setup>) =>
  value.review.transition(value.session.id, {
    action: "submit",
    expectedReviewRevision: 0,
    artifactID: value.applied.artifact.id,
    expectedArtifactRevision: value.snapshot.revision,
  })

const binding = (value: WorkReview.Ready, action: "approve" | "request_changes" | "re_review" | "reopen") => ({
  action,
  expectedReviewRevision: value.review.revision,
  artifactID: value.artifact.artifactID,
  expectedArtifactRevision: value.artifact.artifactRevision,
})

describe("AI-TDD-S06 WorkReview producer", () => {
  it.live("R01/R03: submit writes one review and preserves unrelated metadata", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const db = (yield* Database.Service).db
        yield* db
          .update(SessionTable)
          .set({ metadata: sql`json_set(coalesce(${SessionTable.metadata}, '{}'), '$.note', 'keep')` })
          .where(eq(SessionTable.id, value.session.id))
          .run()
        expect(yield* value.review.get(value.session.id)).toEqual({ status: "none" })
        const result = yield* submit(value)
        expect(result.status).toBe("ready")
        expect(result.review).toMatchObject({ state: "open", revision: 1, artifactID: value.applied.artifact.id })
        expect(yield* value.review.get(value.session.id)).toEqual(result)
        expect((yield* (yield* SessionV2.Service).get(value.session.id)).workReview).toEqual(result.review)
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, value.session.id)).get()
        expect(row?.metadata?.workReview).toEqual(result.review)
        expect(row?.metadata?.note).toBe("keep")
      }),
    ),
  )

  it.live("R02/R04: explicit lifecycle increments only successful commands and rejects an old approve", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const first = yield* submit(value)
        const changes = yield* value.review.transition(value.session.id, binding(first, "request_changes"))
        const responded = yield* value.review.transition(value.session.id, {
          action: "respond",
          expectedReviewRevision: 2,
        })
        expect(changes.review.state).toBe("fix_requested")
        expect(responded.review.state).toBe("responded")
        const rereview = yield* value.review.transition(value.session.id, binding(responded, "re_review"))
        const approved = yield* value.review.transition(value.session.id, binding(rereview, "approve"))
        expect(approved.review).toMatchObject({ state: "resolved", revision: 5 })
        const reopened = yield* value.review.transition(value.session.id, binding(approved, "reopen"))
        expect(reopened.review).toMatchObject({ state: "open", revision: 6, reopenedFrom: "resolved" })
        expect(
          (yield* value.review.transition(value.session.id, binding(rereview, "approve")).pipe(Effect.flip)).code,
        ).toBe("conflict")
        expect(yield* value.review.get(value.session.id)).toEqual(reopened)
      }),
    ),
  )

  it.live("R04: two commands with one expected version yield one success and one conflict", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        const effects = ["approve", "request_changes"].map((action) =>
          value.review
            .transition(value.session.id, binding(opened, action === "approve" ? "approve" : "request_changes"))
            .pipe(Effect.exit),
        )
        const results = yield* Effect.all(effects, { concurrency: "unbounded" })
        expect(results.filter(Exit.isSuccess)).toHaveLength(1)
        const failed = results.find(Exit.isFailure)
        if (!failed) throw new Error("A concurrent command should conflict")
        const error = Cause.squash(failed.cause)
        expect(error).toBeInstanceOf(WorkReviewService.ReviewError)
        if (error instanceof WorkReviewService.ReviewError) expect(error.code).toBe("conflict")
        const current = yield* value.review.get(value.session.id)
        expect(current.status === "ready" && current.review.revision).toBe(2)
      }),
    ),
  )

  it.live("R03/R13: missing required stored binding is unavailable, not revision zero", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        const db = (yield* Database.Service).db
        yield* db
          .update(SessionTable)
          .set({ metadata: sql`json_remove(${SessionTable.metadata}, '$.workReview.revision')` })
          .where(eq(SessionTable.id, value.session.id))
          .run()
        expect(yield* value.review.get(value.session.id)).toMatchObject({
          status: "unavailable",
          reason: "corrupt_review",
        })
        expect((yield* submit(value).pipe(Effect.flip)).code).toBe("corrupt_review")
        expect(opened.review.revision).toBe(1)
      }),
    ),
  )

  it.live("R05: a foreign artifact cannot become the reviewed object and approve issues no grant", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        expect(
          (yield* value.review
            .transition(value.session.id, { ...binding(opened, "approve"), artifactID: "art_foreign" })
            .pipe(Effect.flip)).code,
        ).toBe("stale_artifact")
        const types: string[] = []
        const off = yield* (yield* EventV2.Service).listen((event) =>
          Effect.sync(() => {
            types.push(event.type)
          }),
        )
        yield* Effect.addFinalizer(() => off)
        yield* value.review.transition(value.session.id, binding(opened, "approve"))
        expect(types).toEqual(["work.review.updated"])
      }),
    ),
  )

  it.live("R06: failed metadata writes do not increment or fabricate an approval", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        const db = (yield* Database.Service).db
        yield* db.run(
          "CREATE TEMP TRIGGER reject_review BEFORE UPDATE ON session BEGIN SELECT RAISE(FAIL, 'injected write failure'); END",
        )
        const failed = yield* value.review.transition(value.session.id, binding(opened, "approve")).pipe(Effect.exit)
        yield* db.run("DROP TRIGGER reject_review")
        expect(Exit.isFailure(failed)).toBe(true)
        expect(yield* value.review.get(value.session.id)).toEqual(opened)
      }),
    ),
  )

  it.live("R06/R12: a failed notification is explicit and authoritative GET explains the persisted revision", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        const off = yield* (yield* EventV2.Service).listen((event) =>
          event.type === "work.review.updated" ? Effect.die(new Error("notification unavailable")) : Effect.void,
        )
        const failure = yield* value.review.transition(value.session.id, binding(opened, "approve")).pipe(Effect.flip)
        yield* off
        expect(failure.code).toBe("notification")
        expect(failure.committedRevision).toBe(2)
        expect(yield* value.review.get(value.session.id)).toMatchObject({
          status: "ready",
          review: { state: "resolved", revision: 2 },
        })
      }),
    ),
  )

  it.live("R08: changed content becomes stale and a missing file is explicitly unavailable", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        yield* value.review.transition(value.session.id, binding(opened, "approve"))
        const location = yield* Location.Service
        const fs = yield* FSUtil.Service
        yield* fs.writeFileString(`${location.directory}/result.md`, "external edit")
        expect(yield* value.review.get(value.session.id)).toMatchObject({ status: "ready", current: false })
        yield* fs.remove(`${location.directory}/result.md`)
        expect(yield* value.review.get(value.session.id)).toMatchObject({
          status: "unavailable",
          reason: "artifact_unavailable",
        })
      }),
    ),
  )

  it.live("R14/R17: same bytes with a new artifact identity require explicit re-review", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        expect(
          (yield* value.review.transition(value.session.id, binding(opened, "re_review")).pipe(Effect.flip)).code,
        ).toBe("illegal_transition")
        const second = yield* value.artifacts.apply({
          sessionID: value.session.id,
          relativePath: "replacement.md",
          title: "Replacement",
          content: "first revision",
        })
        const snapshot = yield* value.artifacts.get(value.session.id)
        if (!snapshot) throw new Error("Replacement artifact is missing")
        expect(second.artifact.id).not.toBe(opened.review.artifactID)
        expect(snapshot.revision).toBe(opened.review.artifactRevision)
        const stale = yield* value.review.get(value.session.id)
        expect(stale).toMatchObject({ status: "ready", current: false })
        expect(
          (yield* value.review.transition(value.session.id, binding(opened, "approve")).pipe(Effect.flip)).code,
        ).toBe("stale_artifact")
        const rebound = yield* value.review.transition(value.session.id, {
          action: "re_review",
          expectedReviewRevision: 1,
          artifactID: second.artifact.id,
          expectedArtifactRevision: snapshot.revision,
        })
        expect(rebound.review).toMatchObject({ state: "open", revision: 2, artifactID: second.artifact.id })
        expect((yield* value.review.transition(value.session.id, binding(rebound, "approve"))).review.state).toBe(
          "resolved",
        )
      }),
    ),
  )

  it.live("R17: stale open rejects re_review of an unavailable replacement without changing revision or binding", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const opened = yield* submit(value)
        const replacement = yield* value.artifacts.apply({
          sessionID: value.session.id,
          relativePath: "replacement.md",
          title: "Replacement",
          content: "replacement revision",
        })
        const stale = yield* value.review.get(value.session.id)
        if (stale.status !== "ready") throw new Error("Expected a readable stale open review")
        expect(stale.current).toBe(false)
        expect(stale.review).toEqual(opened.review)
        expect(stale.review).toMatchObject({ state: "open", revision: 1 })
        expect(stale.artifact.artifactID).toBe(replacement.artifact.id)
        const db = (yield* Database.Service).db
        const before = yield* db.select().from(SessionTable).where(eq(SessionTable.id, value.session.id)).get()
        expect(before?.metadata?.workArtifact).toMatchObject({ artifact: { id: replacement.artifact.id } })
        const location = yield* Location.Service
        yield* (yield* FSUtil.Service).remove(`${location.directory}/${replacement.artifact.relativePath}`)
        const rejected = yield* value.review.transition(value.session.id, binding(stale, "re_review")).pipe(Effect.flip)
        expect(rejected.code).toBe("artifact_unavailable")
        expect(rejected.committedRevision).toBeUndefined()
        expect(yield* value.review.get(value.session.id)).toMatchObject({
          status: "unavailable",
          reason: "artifact_unavailable",
          review: { ...opened.review },
        })
        const after = yield* db.select().from(SessionTable).where(eq(SessionTable.id, value.session.id)).get()
        expect(after?.metadata?.workReview).toEqual({ ...opened.review })
        expect(after?.metadata?.workArtifact).toEqual(before?.metadata?.workArtifact)
      }),
    ),
  )

  it.live(
    "R17: stale expected revision rejects re_review of an available replacement without changing its binding",
    () =>
      fixture(
        Effect.gen(function* () {
          const value = yield* setup
          const opened = yield* submit(value)
          const approved = yield* value.review.transition(value.session.id, binding(opened, "approve"))
          const reopened = yield* value.review.transition(value.session.id, binding(approved, "reopen"))
          const replacement = yield* value.artifacts.apply({
            sessionID: value.session.id,
            relativePath: "replacement.md",
            title: "Replacement",
            content: "replacement revision",
          })
          const stale = yield* value.review.get(value.session.id)
          if (stale.status !== "ready") throw new Error("Expected a readable stale open review")
          expect(stale.current).toBe(false)
          expect(stale.review).toEqual(reopened.review)
          expect(stale.review).toMatchObject({ state: "open", revision: 3 })
          expect(stale.artifact.artifactID).toBe(replacement.artifact.id)
          const db = (yield* Database.Service).db
          const before = yield* db.select().from(SessionTable).where(eq(SessionTable.id, value.session.id)).get()
          expect(before?.metadata?.workArtifact).toMatchObject({ artifact: { id: replacement.artifact.id } })
          const rejected = yield* value.review
            .transition(value.session.id, {
              ...binding(stale, "re_review"),
              expectedReviewRevision: opened.review.revision,
            })
            .pipe(Effect.flip)
          expect(rejected.code).toBe("conflict")
          expect(rejected.committedRevision).toBeUndefined()
          expect(yield* value.review.get(value.session.id)).toEqual(stale)
          const after = yield* db.select().from(SessionTable).where(eq(SessionTable.id, value.session.id)).get()
          expect(after?.metadata?.workReview).toEqual({ ...reopened.review })
          expect(after?.metadata?.workArtifact).toEqual(before?.metadata?.workArtifact)
        }),
      ),
  )

  it.live("R09: wrong mode, missing Session and foreign Location fail closed", () =>
    fixture(
      Effect.gen(function* () {
        const value = yield* setup
        const location = yield* Location.Service
        const coding = yield* (yield* SessionV2.Service).create({ location, mode: "coding" })
        expect((yield* value.review.get(coding.id).pipe(Effect.flip)).code).toBe("wrong_mode")
        expect((yield* value.review.get(SessionV2.ID.make("ses_missing_review")).pipe(Effect.flip)).code).toBe(
          "not_found",
        )
        const foreign = yield* WorkReviewService.Service.pipe(
          Effect.provide(
            WorkReviewService.layer.pipe(
              Layer.fresh,
              Layer.provide(
                Layer.succeed(Location.Service, { ...location, directory: AbsolutePath.make("/elsewhere") }),
              ),
            ),
          ),
        )
        expect((yield* foreign.get(value.session.id).pipe(Effect.flip)).code).toBe("wrong_scope")
      }),
    ),
  )
})

it.live("AI-TDD-S06-R16: concurrent apply and approve never carry approval to another artifact", () =>
  fixture(
    Effect.gen(function* () {
      const value = yield* setup
      const opened = yield* submit(value)
      const outcomes = yield* Effect.all(
        {
          approval: value.review.transition(value.session.id, binding(opened, "approve")).pipe(Effect.exit),
          replacement: value.artifacts
            .apply({
              sessionID: value.session.id,
              relativePath: "result.md",
              title: "New target",
              content: "different reviewed content",
              overwrite: true,
            })
            .pipe(Effect.exit),
        },
        { concurrency: "unbounded" },
      )
      if (Exit.isFailure(outcomes.replacement)) throw Cause.squash(outcomes.replacement.cause)
      const current = yield* value.review.get(value.session.id)
      if (current.status !== "ready") throw new Error("Concurrent apply/approve must leave a readable review")
      const artifact = yield* value.artifacts.get(value.session.id)
      if (!artifact) throw new Error("Current artifact is unavailable")
      expect(artifact.artifact).toEqual(outcomes.replacement.value.artifact)
      expect(artifact.artifact.id).not.toBe(opened.artifact.artifactID)
      expect(artifact.revision).not.toBe(opened.artifact.artifactRevision)
      expect(current.artifact).toMatchObject({
        artifactID: artifact.artifact.id,
        artifactRevision: artifact.revision,
      })
      expect(current.review).toMatchObject({
        artifactID: opened.review.artifactID,
        artifactRevision: opened.review.artifactRevision,
      })
      expect(current.current).toBe(false)
      const location = yield* Location.Service
      expect(yield* (yield* FSUtil.Service).readFileString(`${location.directory}/result.md`)).toBe(
        "different reviewed content",
      )
      const row = yield* (yield* Database.Service).db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, value.session.id))
        .get()
      expect(row?.metadata?.workArtifact).toEqual({ artifact: artifact.artifact, revision: artifact.revision })
      expect(row?.metadata?.workReview).toEqual({ ...current.review })
      // Apply wins coordination: the old command must fail before changing the open review.
      if (Exit.isFailure(outcomes.approval)) {
        const error = Cause.squash(outcomes.approval.cause)
        if (!(error instanceof WorkReviewService.ReviewError)) throw error
        expect(error.code).toBe("stale_artifact")
        expect(error.committedRevision).toBeUndefined()
        expect(current.review).toEqual(opened.review)
        expect(current.review).toMatchObject({ state: "open", revision: 1 })
        return
      }
      // Approve wins coordination: its valid A verdict remains historical and is stale for B.
      expect(outcomes.approval.value.current).toBe(true)
      expect(outcomes.approval.value.artifact).toEqual(opened.artifact)
      expect(outcomes.approval.value.review).toMatchObject({ state: "resolved", revision: 2 })
      expect(current.review).toEqual(outcomes.approval.value.review)
    }),
  ),
)

it.live("AI-TDD-S06-R02/R15: the producer rejects forged actor/state fields", () =>
  fixture(
    Effect.gen(function* () {
      const value = yield* setup
      const opened = yield* submit(value)
      const forged = { ...binding(opened, "approve"), actor: "admin", state: "resolved" }
      const error = yield* value.review.transition(value.session.id, forged).pipe(Effect.flip)
      expect(error.code).toBe("invalid_action")
      expect(yield* value.review.get(value.session.id)).toEqual(opened)
    }),
  ),
)

it.live("AI-TDD-S06-R06/R16: a content change after DB commit is explicit recoverable partial completion", () =>
  fixture(
    Effect.gen(function* () {
      const value = yield* setup
      const opened = yield* submit(value)
      const location = yield* Location.Service
      const fs = yield* FSUtil.Service
      // Inject an external writer between the real DB commit and Artifact's real postcheck.
      const disturbed = WorkReviewService.layer.pipe(
        Layer.fresh,
        Layer.provide(
          Layer.mock(WorkArtifact.Service, {
            get: (sessionID) => value.artifacts.get(sessionID),
            withCurrent: (sessionID, use) =>
              value.artifacts.withCurrent(sessionID, (snapshot) =>
                use(snapshot).pipe(
                  Effect.tap(() =>
                    fs
                      .writeFileString(`${location.directory}/result.md`, "external post-commit change")
                      .pipe(Effect.orDie),
                  ),
                ),
              ),
          }),
        ),
      )
      const review = yield* WorkReviewService.Service.pipe(Effect.provide(disturbed))
      const result = yield* review.transition(value.session.id, binding(opened, "approve")).pipe(Effect.flip)
      expect(result).toMatchObject({ code: "storage", committedRevision: 2 })
      expect(yield* value.review.get(value.session.id)).toMatchObject({
        status: "ready",
        current: false,
        review: { revision: 2, state: "resolved" },
      })
    }),
  ),
)
