export * as ConfigCommandV1 from "./command.js"

import { Schema } from "effect"
import { optional } from "../../schema.js"

export const Info = Schema.Struct({
  template: Schema.String,
  description: optional(Schema.String),
  agent: optional(Schema.String),
  model: optional(Schema.String),
  variant: optional(Schema.String),
  subtask: optional(Schema.Boolean),
})
export type Info = Schema.Schema.Type<typeof Info>
