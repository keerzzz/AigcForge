export * as SessionShareV2 from "./share-v2"

import { Context, Effect, Layer, DateTime } from "effect"
import { SessionV2 } from "../session"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"

/**
 * Share scope: what content from the source session to share.
 *
 * - `reference`: only the source session ID (lightest; target agent reads on demand)
 * - `output`: the last assistant message text (the "result")
 * - `full`: the entire projected conversation history
 */
export type ShareScope = "reference" | "output" | "full"

export interface ShareInput {
  readonly sourceSessionID: SessionSchema.ID
  readonly targetSessionID: SessionSchema.ID
  readonly scope: ShareScope
  readonly trigger?: boolean
}

export interface Interface {
  readonly share: (input: ShareInput) => Effect.Effect<void, SessionV2.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionShare") {}

/** Exported for share-summary.ts to use without duplicating. */
export function formatMessages(messages: SessionMessage.Message[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    switch (msg.type) {
      case "user":
        lines.push(`[User] ${msg.text}`)
        break
      case "assistant":
        for (const part of msg.content) {
          if (part.type === "text") lines.push(`[Assistant] ${part.text}`)
        }
        break
      case "system":
        lines.push(`[System] ${msg.text}`)
        break
      case "synthetic":
        lines.push(`[Synthetic] ${msg.text}`)
        break
      case "shell":
        lines.push(`[Shell] ${msg.command}`)
        break
    }
  }
  return lines.join("\n\n")
}

function lastAssistantText(messages: SessionMessage.Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.type === "assistant") {
      const texts = msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text)
      if (texts.length > 0) return texts.join("\n")
    }
  }
  return undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const events = yield* EventV2.Service

    const share = Effect.fn("SessionShareV2.share")(function* (input: ShareInput) {
      // Validate both sessions exist
      yield* sessions.get(input.sourceSessionID)
      yield* sessions.get(input.targetSessionID)

      let text: string
      switch (input.scope) {
        case "reference":
          text = `[Shared reference] Source session: ${input.sourceSessionID}. Use the session.read tool to inspect its history.`
          break
        case "output": {
          const msgs = yield* sessions.messages({ sessionID: input.sourceSessionID, order: "asc" }).pipe(
            Effect.catch((e) => Effect.die(e instanceof Error ? e : new Error(String(e)))),
          )
          const output = lastAssistantText(msgs)
          if (!output) {
            text = `[Shared output] Source session ${input.sourceSessionID} has no assistant output yet.`
          } else {
            text = `[Shared output from session ${input.sourceSessionID}]\n\n${output}`
          }
          break
        }
        case "full": {
          const msgs = yield* sessions.context(input.sourceSessionID).pipe(
            Effect.catch((e) => Effect.die(e instanceof Error ? e : new Error(String(e)))),
          )
          text = `[Shared history from session ${input.sourceSessionID}]\n\n${formatMessages(msgs)}`
          break
        }
      }

      // Publish a Synthetic event into the target session timeline.
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: input.targetSessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text,
      })

      // Optionally trigger a drain so the target agent runs a turn over the shared content.
      if (input.trigger === true) {
        yield* sessions.resume(input.targetSessionID).pipe(
          Effect.catch((e) => Effect.die(e instanceof Error ? e : new Error(String(e)))),
        )
      }
    })

    return Service.of({ share })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provideMerge(SessionV2.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
  ),
)
