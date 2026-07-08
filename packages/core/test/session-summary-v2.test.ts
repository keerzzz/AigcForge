import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { V2Snapshot } from "@aigcfroge/core/session/v2-snapshot"
import { SessionSummary } from "@aigcfroge/core/session/summary"
import { ProjectV2 } from "@aigcfroge/core/project"
import { testEffect } from "./lib/effect"

// ── Mock V2Snapshot ────────────────────────────────────────────────
const snapshotMock = Layer.succeed(
  V2Snapshot.Service,
  V2Snapshot.Service.of({
    track: () => Effect.succeed("snap_mid"),
    restore: () => Effect.void,
    revert: () => Effect.void,
    diffFull: () =>
      Effect.succeed([
        { file: "test.ts", additions: 5, deletions: 2 },
      ]),
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
const testLayer = Layer.mergeAll(
  SessionSummary.defaultLayer,
  snapshotMock,
  sessionProjection,
) as never

const it = testEffect(testLayer)

describe("V2 SessionSummary", () => {
  it.effect("diff returns empty array when no messageID is provided", () =>
    Effect.gen(function* () {
      const svc = yield* SessionSummary.Service
      const result = yield* svc.diff({ sessionID: "msg_any" })
      expect(result).toEqual([])
    }),
  )

  it.effect("diff returns empty array for non-existent session", () =>
    Effect.gen(function* () {
      const svc = yield* SessionSummary.Service
      const result = yield* svc.diff({
        sessionID: "msg_nonexistent" as any,
        messageID: "msg_bogus" as any,
      })
      expect(result).toEqual([])
    }),
  )
})
