import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionMessage } from "../src/session-message"

describe("SessionMessage assistant termination transport", () => {
  for (const type of ["interrupted", "unknown"] as const) {
    test(`round trips ${type} errors without classifying the message text`, () => {
      const encoded = {
        id: "msg_termination_transport",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", id: "text-partial", text: "Partial" }],
        finish: "error",
        error: { type, message: "Provider turn interrupted" },
        time: { created: 1, completed: 2 },
      }
      const codec = Schema.toCodecJson(SessionMessage.Assistant)
      const decoded = Schema.decodeUnknownSync(codec)(encoded)

      expect(decoded.error).toMatchObject(encoded.error)
      expect(Schema.encodeSync(codec)(decoded)).toMatchObject(encoded)
    })
  }
})
