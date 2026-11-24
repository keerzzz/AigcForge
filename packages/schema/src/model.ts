export * as Model from "./model.js"

import { Schema } from "effect"
import { optional, statics } from "./schema.js"
import { Provider } from "./provider.js"
import { ModelSource, Family, Compatibility, Capabilities, Cost } from "./model-source.js"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(Schema.brand("Model.ID"), Schema.annotate({ identifier: "Model.ID" }))
export type ID = typeof ID.Type

const Updated = ephemeral({ type: "model.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export const VariantID = Schema.String.pipe(Schema.brand("Model.VariantID"))
export type VariantID = typeof VariantID.Type

export const Ref = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  variant: VariantID.pipe(optional),
})
  .annotate({ identifier: "Model.Ref" })
  .pipe(
    statics((schema) => ({
      parse: (input: string) => {
        const providerEnd = input.indexOf("/")
        if (providerEnd <= 0) throw new Error(`Invalid model reference: ${input}`)
        const providerID = input.slice(0, providerEnd)
        const variantStart = input.indexOf("#", providerEnd + 1)
        const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
        const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
        if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#"))))
          throw new Error(`Invalid model reference: ${input}`)
        return schema.make({
          providerID: Provider.ID.make(providerID),
          id: ID.make(id),
          ...(variant ? { variant: VariantID.make(variant) } : {}),
        })
      },
    })),
  )
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

// Group shorthand has no physical reference separators; display names remain free text.
export const GroupID = Schema.NonEmptyString.check(Schema.isPattern(/^[^/#]+$/u)).pipe(
  Schema.brand("Model.GroupID"),
  Schema.annotate({ identifier: "Model.GroupID" }),
)
export type GroupID = typeof GroupID.Type

export class GroupRef extends Schema.Class<GroupRef>("Model.GroupRef")({
  type: Schema.Literal("group"),
  groupID: GroupID,
}) {}

export const Selection = Schema.Union([Ref, GroupRef])
  .annotate({ identifier: "Model.Selection" })
  .pipe(
    statics(() => ({
      parse: (input: string): Selection =>
        input.startsWith("group:") && !input.includes("/")
          ? new GroupRef({ type: "group", groupID: GroupID.make(input.slice(6)) })
          : Ref.parse(input),
      isGroup: (input: Selection): input is GroupRef => "type" in input && input.type === "group",
    })),
  )
export type Selection = Ref | GroupRef

export { Family, ReasoningField, MaxTokensField, Compatibility, Capabilities, Cost } from "./model-source.js"

export const Settings = Schema.StructWithRest(
  Schema.Struct({
    compaction: Provider.Compaction.pipe(optional),
  }),
  // Provider packages may define arbitrary model-level options beyond Omnixa's shared compaction policy.
  [Schema.Record(Schema.String, Schema.Any)],
).annotate({ identifier: "Model.Settings" })
export type Settings = typeof Settings.Type

export const Overlays = {
  settings: Settings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: Schema.Record(Schema.String, Schema.Any).pipe(optional),
}

export interface Variant extends Schema.Schema.Type<typeof Variant> {}
export const Variant = Schema.Struct({
  id: VariantID,
  ...Overlays,
}).annotate({ identifier: "Model.Variant" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  modelID: ID,
  providerID: Provider.ID,
  canonical: Provider.ID.pipe(optional),
  family: Family.pipe(optional),
  name: Schema.String,
  compatibility: Compatibility.pipe(optional),
  metadata: ModelSource.Metadata.pipe(optional),
  origins: ModelSource.Origins.pipe(optional),
  package: Provider.Package.pipe(optional),
  ...Overlays,
  capabilities: Capabilities,
  variants: Schema.Array(Variant),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(optional),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: "Model.Info" })
  .pipe(
    statics(() => ({
      default: (providerID: Provider.ID, id: ID) =>
        ({
          id,
          modelID: id,
          providerID,
          name: id,
          capabilities: Capabilities.default(),
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 200_000, output: 32_000 },
        }) satisfies Info,
    })),
  )
