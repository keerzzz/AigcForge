export * as ConfigFormatterV1 from "./formatter.js"

import { Schema } from "effect"
import { optional } from "../../schema.js"

export const Entry = Schema.Struct({
  disabled: optional(Schema.Boolean),
  command: optional(Schema.Array(Schema.String)),
  environment: optional(Schema.Record(Schema.String, Schema.String)),
  extensions: optional(Schema.Array(Schema.String)),
})

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
export type Info = Schema.Schema.Type<typeof Info>
