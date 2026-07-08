import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { V2Snapshot } from "@aigcfroge/core/session/v2-snapshot"
import { SessionRevert } from "@aigcfroge/core/session/revert"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { testEffect } from "./lib/effect"

// ── Mock V2Snapshot ────────────────────────────────────────────────
const snapshotMock = Layer.succeed(
  V2Snapshot.Service,
  V2Snapshot.Service.of({
    track: () => Effect.succeed("snap_before"),
    restore: () => Effect.void,
    revert: () => Effect.void,
    diffFull: () => Effect.succeed([]),
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
  SessionRevert.defaultLayer,
  snapshotMock,
  sessionProjection,
) as never

const it = testEffect(testLayer)

describe("V2 SessionRevert", () => {
  it.effect("revert returns session info when session does not exist", () =>
    Effect.gen(function* () {
      const svc = yield* SessionRevert.Service
      const result = yield* svc.revert({
        sessionID: "msg_nonexistent" as any,
        messageID: "msg_bogus" as any,
      })
      expect(result).toBeUndefined()
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
})
