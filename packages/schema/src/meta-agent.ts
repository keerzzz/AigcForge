export * as MetaAgent from "./meta-agent"

import { Schema } from "effect"
import { Agent } from "./agent"
import { Model } from "./model"
import { DateTimeUtcFromMillis } from "./schema"
import { MetaAgentID } from "./meta-agent-id"

export const ID = MetaAgentID.ID
export type ID = MetaAgentID.ID

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  agent: Agent.ID,
  model: Model.Ref,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "MetaAgent.Info" })
