export * as Agent from "./agent.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Handoff } from "./handoff.js"
import { optional } from "./schema.js"
import { Model } from "./model.js"
import { Permission } from "./permission.js"
import { Provider } from "./provider.js"
import { ProductMode } from "./product-mode.js"
import { PositiveInt, statics } from "./schema.js"

const Updated = ephemeral({ type: "agent.updated", schema: {} })

export const ID = Schema.String.pipe(Schema.brand("Agent.ID"), Schema.annotate({ identifier: "Agent.ID" }))
export type ID = typeof ID.Type

export const Name = Schema.String.pipe(Schema.brand("Agent.Name"))
export type Name = typeof Name.Type

export const Color = Schema.String.annotate({ identifier: "Agent.Color" })
export type Color = typeof Color.Type

export class Card extends Schema.Class<Card>("Agent.Card")({
  capabilities: Schema.Array(Schema.String),
  constraints: Schema.Array(Schema.String),
  protocol: optional(Schema.String.check(Schema.isPattern(/\S/))),
}) {}

export class CardIssue extends Schema.Class<CardIssue>("Agent.CardIssue")({
  _tag: Schema.Literal("InvalidCard"),
  reason: Schema.Literals(["invalid_shape", "empty_protocol"]),
}) {}

export const CardValue = Schema.Union([Card, CardIssue]).annotate({ identifier: "Agent.CardValue" })
export type CardValue = typeof CardValue.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  model: Model.Selection.pipe(optional),
  request: Provider.Request,
  system: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  card: optional(CardValue),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(optional),
  steps: PositiveInt.pipe(optional),
  permissions: Permission.Ruleset,
  attended: optional(Schema.Boolean),
  handoffs: Schema.Array(Handoff),
  /** The defining producer's origin; omitted by historical frozen definitions. */
  originKind: optional(Schema.Literals(["builtin", "user"])),
  /** Core's ordinary directory projection; not an execution grant or stored agent setting. */
  ordinaryModes: optional(Schema.Array(ProductMode.ID)),
  /** Asset provenance (ADR-20 §2.6): which bound file/revision produced this entry. */
  originRelativePath: optional(Schema.String),
  originRevision: optional(Schema.String),
})
  .annotate({ identifier: "Agent.Info" })
  .pipe(
    statics((schema) => ({
      default: (id: ID) =>
        ({
          id,
          name: Name.make(id),
          request: { settings: {}, headers: {}, body: {} },
          mode: "primary",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "memory_delete", resource: "*", effect: "ask" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
          ],
          handoffs: [],
        }) satisfies Info,
      empty: (id: ID) =>
        schema.make({
          id,
          name: Name.make(id),
          request: { settings: {}, headers: {}, body: {} },
          mode: "all",
          hidden: false,
          permissions: [],
          attended: false,
          handoffs: [],
        }),
    })),
  )

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
