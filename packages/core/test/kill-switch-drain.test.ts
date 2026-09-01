import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, LayerMap } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { layer as sessionExecutionLocalLayer } from "@aigcfroge/core/session/execution/local"
import { SessionInput } from "@aigcfroge/core/session/input"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { computeDigest } from "@aigcfroge/core/composition/digest"
import { Composition } from "@aigcfroge/schema/composition"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

// D12 (S3) RED: the custom kill switch must gate the real SessionExecutionLocal
// drain — the single SessionRunner.run call site that resume and wake both
// funnel through. Admission is already gated; this pins the resume/wake/provider
// leg: with the flag off, resume fails typed with zero provider work and the
// pending inbox row stays pending; with the flag back on, the same session
// drains normally (the recording runner is invoked).

const runCalls: string[] = []
const mockRunner = Layer.succeed(
  SessionRunner.Service,
  SessionRunner.Service.of({
    run: (input) => Effect.sync(() => runCalls.push(input.sessionID)),
  }),
)

const sessionID = SessionV2.ID.make("ses_killswitch_drain")
const messageID = SessionMessage.ID.make("msg_killswitch_pending")

const location = Location.layer({ directory: AbsolutePath.make("/workspace") }).pipe(
  Layer.provide(Project.defaultLayer),
)
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))

// Fake LocationServiceMap whose only consumed member is `get`; the drain
// provides its result around SessionRunner.Service.use. `LayerMap.make` builds
// the exact runtime shape (rcMap/get/contextEffect/invalidate) without booting
// any location services.
const fakeLocationLayer = Layer.effect(
  LocationServiceMap,
  Effect.gen(function* () {
    // LayerMap is invariant in its layer-type parameter, so the lookup-shaped
    // map is not assignable to LocationServiceMap's declared Self even though
    // the runtime shapes are identical (the drain only calls `.get`).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return (yield* LayerMap.make((_ref: Location.Ref) => mockRunner)) as never
  }),
)

const execution = sessionExecutionLocalLayer.pipe(
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(fakeLocationLayer),
)

const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(execution),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    sessionComposition,
    location,
    execution,
    sessions,
  ),
)

// Self-consistent V1 snapshot fixture (assertDependency requires the catalog to
// equal the sorted fingerprint names and the digest to recompute).
const mockToolFingerprints = ["glob", "grep", "read"].map((name, index) => ({
  placement: "/workspace",
  name,
  digest: Composition.Digest.make(String(index).repeat(64)),
  installationVersion: "local",
}))
const mockCatalogDigest = computeDigest(mockToolFingerprints)
const mockSnapshot = new Composition.SnapshotV1({
  version: 1,
  digest: Composition.Digest.make("a".repeat(64)),
  sessionID,
  createdAt: Date.now(),
  data: new Composition.SnapshotDataV1({
    agentID: "meta",
    instructions: [],
    prompts: [],
    skills: [],
    tools: new Composition.SnapshotToolInfo({
      fingerprints: mockToolFingerprints,
      catalogDigest: mockCatalogDigest,
      catalog: ["glob", "grep", "read"],
    }),
  }),
})

const setupCustomSession = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/workspace"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: AbsolutePath.make("/workspace"),
      title: "kill-switch drain",
      version: "test",
      mode: "custom",
      agent: "meta",
      time_created: Date.now(),
      time_updated: Date.now(),
    })
    .run()
    .pipe(Effect.orDie)
  yield* (yield* SessionComposition.Service).attach(sessionID, mockSnapshot)
})

const admitPendingSkill = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  yield* SessionInput.admitSkill(db, events, { id: messageID, sessionID, skill: "test-skill" })
})

const pendingCount = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  return rows.filter((row) => row.promoted_seq === null).length
})

describe("D12 kill switch at the drain (SessionExecutionLocal)", () => {
  it.effect("resume on an existing custom session fails typed with the flag off; drains once back on", () =>
    Effect.gen(function* () {
      const savedFlag = process.env["AIGCFROGE_CUSTOM_MODE"]
      delete process.env["AIGCFROGE_CUSTOM_MODE"]
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (savedFlag === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
          else process.env["AIGCFROGE_CUSTOM_MODE"] = savedFlag
        }),
      )
      yield* setupCustomSession
      yield* admitPendingSkill
      const execution = yield* SessionExecution.Service
      runCalls.length = 0

      // Flag off: resume fails typed, no provider work, pending input intact.
      const exit = yield* execution.resume(sessionID).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause)
        expect(error._tag).toBe("Some")
        if (error._tag === "Some") {
          expect(error.value instanceof ProductModePolicy.UnsupportedProductModeError).toBe(true)
        }
      }
      expect(runCalls).toHaveLength(0)
      expect(yield* pendingCount).toBe(1)

      // Flag back on: the same session drains normally.
      process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
      const exitOn = yield* execution.resume(sessionID).pipe(Effect.exit)
      expect(Exit.isSuccess(exitOn)).toBe(true)
      if (Exit.isFailure(exitOn)) throw Cause.squash(exitOn.cause)
      expect(runCalls).toEqual([sessionID])
      expect(yield* pendingCount).toBe(1)
    }),
  )
})
