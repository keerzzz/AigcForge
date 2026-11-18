export * as MetaAgentID from "./meta-agent-id.js"

import { Schema } from "effect"
import { descending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartingWith("mag")).pipe(
  Schema.brand("MetaAgentID"),
  statics((schema) => {
    const create = () => schema.make("mag_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type
