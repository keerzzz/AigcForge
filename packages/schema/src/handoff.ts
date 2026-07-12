import { Schema } from "effect"

export const Handoff = Schema.Struct({
  label: Schema.String,
  agent: Schema.String,
  prompt: Schema.String,
  send: Schema.Boolean.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Handoff" })
export type Handoff = typeof Handoff.Type
