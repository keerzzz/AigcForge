export * as ConfigModel from "./model.js"

import { Schema, SchemaGetter } from "effect"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { optional } from "../schema.js"

const ProviderID = Provider.ID.check(Schema.isPattern(/^[^/#]+$/u))
const ModelID = Model.ID.check(Schema.isPattern(/^[^#]+$/u))
const VariantID = Model.VariantID.check(Schema.isPattern(/^[^#]+$/u))

const Explicit = Schema.Struct({
  providerID: ProviderID,
  model: ModelID,
  variant: VariantID.pipe(optional),
})

const Short = Schema.String.check(Schema.isPattern(/^[^/#]+\/[^#]+(?:#[^#]+)?$/u))
const GroupShort = Schema.String.check(Schema.isPattern(/^group:[^/#]+$/u))
// Config normalization returns records for both shorthand forms.
const Group = Schema.Struct(Model.GroupRef.fields)
const Normalized = Schema.Union([Explicit, Group])

export type Selection = Schema.Schema.Type<typeof Normalized>
export const Selection = Schema.Union([GroupShort, Short, Explicit, Group])
  .pipe(
    Schema.decodeTo(Normalized, {
      decode: SchemaGetter.transform((input) => (typeof input === "string" ? parse(input) : input)),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  )
  .annotate({ identifier: "Config.ModelSelection" })

function parse(input: string): Selection {
  const ref = Model.Selection.parse(input)
  if (Model.Selection.isGroup(ref)) return ref
  return {
    providerID: ref.providerID,
    model: ref.id,
    ...(ref.variant ? { variant: ref.variant } : {}),
  }
}
