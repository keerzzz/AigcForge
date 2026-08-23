export * as Agent from "./agent"

import { Schema } from "effect"
import { Handoff } from "./handoff"
import { Model } from "./model"
import { Permission } from "./permission"
import { Provider } from "./provider"
import { PositiveInt, withStatics } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("AgentV2.ID"))
export type ID = typeof ID.Type

export const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])
export type Color = typeof Color.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  model: Model.Ref.pipe(Schema.optional),
  request: Provider.Request,
  system: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(Schema.optional),
  steps: PositiveInt.pipe(Schema.optional),
  permissions: Permission.Ruleset,
  attended: Schema.Boolean.pipe(Schema.optional),
  handoffs: Schema.mutable(Schema.Array(Handoff)),
  /** Asset provenance (ADR-20 §2.6): which bound file/revision produced this entry. */
  origin_relative_path: Schema.String.pipe(Schema.optional),
  origin_revision: Schema.String.pipe(Schema.optional),
})
  .annotate({ identifier: "AgentV2.Info" })
  .pipe(
    withStatics((schema) => ({
      empty: (id: ID) =>
        schema.make({ id, request: { headers: {}, body: {} }, mode: "all", hidden: false, permissions: [], attended: false, handoffs: [] }),
    })),
  )
