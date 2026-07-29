import { Schema } from "effect"

export const CaptureSource = Schema.Struct({
  sessionID: Schema.String,
  messageID: Schema.String,
})
export type CaptureSource = Schema.Schema.Type<typeof CaptureSource>

export * as SessionCapture from "./session-capture"
