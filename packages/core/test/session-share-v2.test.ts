import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { testEffect } from "./lib/effect"

const testLayer = SessionShareV2.defaultLayer as never

const it = testEffect(testLayer)

describe("SessionShareV2", () => {
  it.effect("share with reference scope injects synthetic message", () =>
    Effect.gen(function* () {
      const share = yield* SessionShareV2.Service
      const sessions = yield* SessionV2.Service
      const source = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-src") },
      })
      const target = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-tgt") },
      })
      yield* share.share({
        sourceSessionID: source.id,
        targetSessionID: target.id,
        scope: "reference",
      })
      const msgs = yield* sessions.messages({ sessionID: target.id })
      const synthetic = msgs.find((m) => m.type === "synthetic")
      expect(synthetic).toBeDefined()
      expect((synthetic as any)?.text).toContain(source.id)
    }),
  )

  it.effect("share with output scope injects last assistant text", () =>
    Effect.gen(function* () {
      const share = yield* SessionShareV2.Service
      const sessions = yield* SessionV2.Service
      const source = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-out-src") },
      })
      const target = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-out-tgt") },
      })
      yield* share.share({
        sourceSessionID: source.id,
        targetSessionID: target.id,
        scope: "output",
      })
      const msgs = yield* sessions.messages({ sessionID: target.id })
      const synthetic = msgs.find((m) => m.type === "synthetic")
      expect(synthetic).toBeDefined()
      // Source has no assistant output yet, so the text should mention that
      expect((synthetic as any)?.text).toContain("no assistant output")
    }),
  )

  it.effect("share with full scope injects conversation history", () =>
    Effect.gen(function* () {
      const share = yield* SessionShareV2.Service
      const sessions = yield* SessionV2.Service
      const source = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-full-src") },
      })
      const target = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-full-tgt") },
      })
      yield* share.share({
        sourceSessionID: source.id,
        targetSessionID: target.id,
        scope: "full",
      })
      const msgs = yield* sessions.messages({ sessionID: target.id })
      const synthetic = msgs.find((m) => m.type === "synthetic")
      expect(synthetic).toBeDefined()
      expect((synthetic as any)?.text).toContain("Shared history")
    }),
  )

  it.effect("share fails when source session does not exist", () =>
    Effect.gen(function* () {
      const share = yield* SessionShareV2.Service
      const sessions = yield* SessionV2.Service
      const target = yield* sessions.create({
        location: { directory: AbsolutePath.make("/tmp/share-fail-tgt") },
      })
      const result = yield* share.share({
        sourceSessionID: "ses_nonexistent" as any,
        targetSessionID: target.id,
        scope: "reference",
      }).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
    }),
  )
})
