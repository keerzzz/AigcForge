export * as MetaAgentID from "./meta-agent-id"

import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("mag")).pipe(
  Schema.brand("MetaAgentID"),
  withStatics((schema) => {
    const create = () => schema.make("mag_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type
