import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { SessionV2 } from "@aigcfroge/core/session"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { V2Snapshot } from "@aigcfroge/core/session/v2-snapshot"
import { SessionRevert } from "@aigcfroge/core/session/revert"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionMessageTable } from "@aigcfroge/core/session/sql"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { testEffect } from "./lib/effect"

// ── Mock V2Snapshot ────────────────────────────────────────────────
// `restoreCalls` records which snapshot the service asked to restore, so a test
// can assert the *target* of a revert instead of only that a revert happened.
const restoreCalls: string[] = []
// Per-snapshot diffs, so the persisted summary shows WHICH snapshot it was computed
// against. `revert()` calls `diffFull(target, current)`, so a summary derived from the
// wrong turn is visible in additions/deletions/files rather than only in `restoreCalls`.
const diffsBySnapshot: Record<string, V2Snapshot.FileDiff[]> = {
  snap_turn_1: [
    { file: "one.txt", additions: 1, deletions: 10 },
    { file: "two.txt", additions: 1, deletions: 10 },
  ],
  snap_turn_3: [{ file: "three.txt", additions: 3, deletions: 30 }],
}
const snapshotMock = Layer.succeed(
  V2Snapshot.Service,
  V2Snapshot.Service.of({
    track: () => Effect.succeed("snap_before"),
    restore: (snapshot) =>
      Effect.sync(() => {
        restoreCalls.push(snapshot)
      }),
    revert: () => Effect.void,
    diffFull: (from) => Effect.succeed(diffsBySnapshot[from] ?? []),
  }),
)

// ── Session infrastructure ─────────────────────────────────────────
const sessionProjection = Layer.mergeAll(
  SessionStore.defaultLayer,
  SessionProjector.defaultLayer,
  EventV2.defaultLayer,
  Database.defaultLayer,
  ProjectV2.defaultLayer,
)

// ── Layer under test ───────────────────────────────────────────────
// `sessionProjection` is merged, not just provided, so a test can seed the
// projection tables through `Database.Service` instead of mocking the read model.
const testLayer = SessionRevert.defaultLayer.pipe(
  Layer.provide(snapshotMock),
  Layer.provideMerge(sessionProjection),
  Layer.provideMerge(SessionV2.defaultLayer),
)

const it = testEffect(testLayer)

// ── Turn fixtures ──────────────────────────────────────────────────
// Messages are event-sourced, and `SessionRevert` reads them back through
// `store.context`. Seeding the projection rows directly keeps turn order and
// per-turn snapshot ids deterministic without driving a full runner.
const created = DateTime.makeUnsafe(0)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }

const userMessage = (id: string, text: string) =>
  SessionMessage.User.make({ id: SessionMessage.ID.make(id), type: "user", text, time: { created } })

const assistantMessage = (id: string, snapshot: string) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: "build",
    model,
    content: [],
    snapshot: { start: snapshot },
    time: { created },
  })

// Three complete turns, each assistant carrying its own start snapshot.
const turnRows = (sessionID: SessionV2.ID, prefix: string) =>
  [
    userMessage(`${prefix}_user_1`, "first"),
    assistantMessage(`${prefix}_asst_1`, "snap_turn_1"),
    userMessage(`${prefix}_user_2`, "second"),
    assistantMessage(`${prefix}_asst_2`, "snap_turn_2"),
    userMessage(`${prefix}_user_3`, "third"),
    assistantMessage(`${prefix}_asst_3`, "snap_turn_3"),
  ].map((message, seq) => {
    const { id: _, type, ...data } = encodeMessage(message)
    return {
      id: message.id,
      session_id: sessionID,
      type,
      seq,
      time_created: DateTime.toEpochMillis(created),
      data,
    }
  })

const seedThreeTurns = Effect.fn("SessionRevertTest.seedThreeTurns")(function* (directory: string, prefix: string) {
  const session = yield* (yield* SessionV2.Service).create({ location: { directory: AbsolutePath.make(directory) } })
  const { db } = yield* Database.Service
  yield* db.insert(SessionMessageTable).values(turnRows(session.id, prefix)).run().pipe(Effect.orDie)
  return { session, targetUserID: SessionMessage.ID.make(`${prefix}_user_3`) }
})

describe("V2 SessionRevert", () => {
  it.effect("revert returns session info when session does not exist", () =>
    Effect.gen(function* () {
      const svc = yield* SessionRevert.Service
      const result = yield* svc
        .revert({
          sessionID: SessionV2.ID.make("ses_nonexistent"),
          messageID: SessionMessage.ID.make("msg_bogus"),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }),
  )

  it.effect("unrevert without prior revert returns session unchanged", () =>
    Effect.gen(function* () {
      const svc = yield* SessionRevert.Service
      const session = yield* (yield* SessionV2.Service).create({
        location: { directory: AbsolutePath.make("/tmp/unrevert-test") },
      })
      const result = yield* svc.unrevert({ sessionID: session.id })
      expect(result.id).toBe(session.id)
    }),
  )

  it.effect("revert restores the snapshot of the turn that owns the target user message", () =>
    Effect.gen(function* () {
      restoreCalls.length = 0
      const seeded = yield* seedThreeTurns("/tmp/revert-target-test", "msg_target")
      const updated = yield* (yield* SessionRevert.Service).revert({
        sessionID: seeded.session.id,
        messageID: seeded.targetUserID,
      })
      // Asserted before `restoreCalls` on purpose: the summary is the derived fact that
      // reaches the user (the dock's file count), so it should be what fails first when the
      // wrong snapshot is chosen. Turn 1's diff would be 2 files / 2 additions / 20 deletions.
      expect(updated.summary).toEqual({ additions: 3, deletions: 30, files: 1 })
      expect(restoreCalls).toEqual(["snap_turn_3"])
      expect(updated.revert?.messageID).toBe(seeded.targetUserID)
    }),
  )

  it.effect("revert returns a decodable session after writing the revert marker", () =>
    Effect.gen(function* () {
      const seeded = yield* seedThreeTurns("/tmp/revert-decode-test", "msg_decode")
      const exit = yield* (yield* SessionRevert.Service)
        .revert({ sessionID: seeded.session.id, messageID: seeded.targetUserID })
        .pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("revert refuses to restore when the target turn captured no snapshot", () =>
    Effect.gen(function* () {
      restoreCalls.length = 0
      // Turn 2's assistant has no `snapshot.start` — the runner never tracked one. Scanning
      // on to turn 3's snapshot would restore a LATER state and silently leave turn 2's
      // edits in place, so "the state before this turn" is unknowable and nothing may be
      // written to disk.
      const session = yield* (yield* SessionV2.Service).create({
        location: { directory: AbsolutePath.make("/tmp/revert-gap-test") },
      })
      const { db } = yield* Database.Service
      const rows = [
        userMessage("msg_gap_user_1", "first"),
        assistantMessage("msg_gap_asst_1", "snap_turn_1"),
        userMessage("msg_gap_user_2", "second"),
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make("msg_gap_asst_2"),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          time: { created },
        }),
        userMessage("msg_gap_user_3", "third"),
        assistantMessage("msg_gap_asst_3", "snap_turn_3"),
      ].map((message, seq) => {
        const { id: _, type, ...data } = encodeMessage(message)
        return {
          id: message.id,
          session_id: session.id,
          type,
          seq,
          time_created: DateTime.toEpochMillis(created),
          data,
        }
      })
      yield* db.insert(SessionMessageTable).values(rows).run().pipe(Effect.orDie)

      const result = yield* (yield* SessionRevert.Service).revert({
        sessionID: session.id,
        messageID: SessionMessage.ID.make("msg_gap_user_2"),
      })

      expect(restoreCalls).toEqual([])
      // No marker either: refusing has to leave the session exactly as it was.
      expect(result.revert).toBeUndefined()
    }),
  )
})
