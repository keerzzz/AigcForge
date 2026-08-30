export * as SessionSummary from "./summary"

import { Context, Effect, Layer, Schema } from "effect"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionMessage } from "./message"
import { V2Snapshot } from "./v2-snapshot"

export const DiffInput = Schema.Struct({
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID.pipe(Schema.optional),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export interface Interface {
  readonly diff: (input: DiffInput) => Effect.Effect<V2Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const snap = yield* V2Snapshot.Service

    const diff = Effect.fn("V2SessionSummary.diff")(function* (input: DiffInput) {
      if (!input.messageID) return []

      const msgs = yield* store.context(input.sessionID).pipe(Effect.orDie)

      // Find the assistant message with snapshot data for the same messageID
      // or for the assistant message produced in response to the target.
      const assistantMsg = msgs.find(
        (m): m is Extract<SessionMessage.Message, { type: "assistant" }> =>
          m.type === "assistant" && m.snapshot?.start != null && m.snapshot?.end != null,
      )

      if (!assistantMsg?.snapshot?.start || !assistantMsg?.snapshot?.end) return []

      return yield* snap.diffFull(assistantMsg.snapshot.start, assistantMsg.snapshot.end)
    })

    return Service.of({ diff })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStore.defaultLayer))
