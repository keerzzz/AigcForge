export * as SessionRevert from "./revert"

import { Context, Effect, Layer, Schema } from "effect"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionMessage } from "./message"
import { V2Snapshot } from "./v2-snapshot"

export const RevertInput = Schema.Struct({
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
})
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<SessionSchema.Info>
  readonly unrevert: (input: { sessionID: SessionSchema.ID }) => Effect.Effect<SessionSchema.Info>
  readonly cleanup: (session: SessionSchema.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionRevert") {}

function revert(store: SessionStore.Interface, snap: V2Snapshot.Interface): Interface["revert"] {
  return Effect.fn("V2SessionRevert.revert")(function* (input: RevertInput) {
    const session = yield* store.get(input.sessionID).pipe(Effect.orDie)
    if (!session) return yield* Effect.die(`Session not found: ${input.sessionID}`)

    // Load context to find the assistant message for this user message
    const msgs = yield* store.context(input.sessionID).pipe(Effect.orDie)

    // Find the assistant message produced in response to the target user message
    const assistantMsg = msgs.find(
      (m): m is Extract<SessionMessage.Message, { type: "assistant" }> =>
        m.type === "assistant" && m.snapshot?.start != null,
    )

    if (!assistantMsg?.snapshot?.start) return session

    // Capture current state before reverting (for unrevert)
    const currentSnapshot = yield* snap.track()

    // Restore to the state before the assistant's changes
    yield* snap.restore(assistantMsg.snapshot.start)

    // Compute diff between current state and restored state
    const diffs = currentSnapshot ? yield* snap.diffFull(assistantMsg.snapshot.start, currentSnapshot) : []

    // Store revert info
    yield* store.setRevert({
      sessionID: input.sessionID,
      revert: { messageID: input.messageID, snapshot: currentSnapshot },
      summary: {
        additions: diffs.reduce((sum, d) => sum + d.additions, 0),
        deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
        files: diffs.length,
      },
    })

    const updated = yield* store.get(input.sessionID).pipe(Effect.orDie)
    return updated!
  }) as Interface["revert"]
}

function unrevert(store: SessionStore.Interface, snap: V2Snapshot.Interface): Interface["unrevert"] {
  return Effect.fn("V2SessionRevert.unrevert")(function* (input: { sessionID: SessionSchema.ID }) {
    const session = yield* store.get(input.sessionID).pipe(Effect.orDie)
    if (!session) return yield* Effect.die(`Session not found: ${input.sessionID}`)
    if (!session.revert?.snapshot) return session

    yield* snap.restore(session.revert.snapshot)
    yield* store.clearRevert(input.sessionID)

    const updated = yield* store.get(input.sessionID).pipe(Effect.orDie)
    return updated!
  }) as Interface["unrevert"]
}

function cleanup(_store: SessionStore.Interface): Interface["cleanup"] {
  return Effect.fn("V2SessionRevert.cleanup")(function* (_session: SessionSchema.Info) {
    // V2 cleanup is a no-op — messages are immutable event-sourced data.
    // The session's revert marker is cleared via clearRevert.
    // Actual message cleanup requires project V2 replay which is outside
    // the scope of this service.
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const snap = yield* V2Snapshot.Service
    return Service.of({
      revert: revert(store, snap),
      unrevert: unrevert(store, snap),
      cleanup: cleanup(store),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStore.defaultLayer))
