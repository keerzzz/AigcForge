export * as ConfigProvider from "./provider.js"

import { Schema } from "effect"
import { Money } from "../money.js"
import { Capabilities, Compatibility, Family, ID, VariantID } from "../model.js"
import { Provider } from "../provider.js"
import { Credential } from "../credential.js"
import { ModelSource } from "../model-source.js"
import { optional } from "../schema.js"

export const Settings = Schema.StructWithRest(
  Schema.Struct({
    timeout: Schema.Union([Schema.Finite, Schema.Literal(false)]).pipe(optional),
    headerTimeout: Schema.Union([Schema.Finite, Schema.Literal(false)]).pipe(optional),
    chunkTimeout: Schema.Union([Schema.Finite, Schema.Literal(false)]).pipe(optional),
    compaction: Provider.Compaction.pipe(optional),
    transport: Provider.Transport.pipe(optional),
  }),
  [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))],
).annotate({ identifier: "Config.Provider.Settings" })
export type Settings = typeof Settings.Type

export const ModelSettings = Schema.StructWithRest(
  Schema.Struct({
    compaction: Provider.Compaction.pipe(optional),
  }),
  [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))],
).annotate({ identifier: "Config.Model.Settings" })
export type ModelSettings = typeof ModelSettings.Type

const JsonRecord = Schema.Record(Schema.String, Schema.Json)

export const Overlays = {
  settings: Settings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: JsonRecord.pipe(optional),
}

const ModelOverlays = {
  settings: ModelSettings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: JsonRecord.pipe(optional),
}

export class Request extends Schema.Class<Request>("Config.Provider.Request")({
  headers: Overlays.headers,
  body: Overlays.body,
}) {}

class Cache extends Schema.Class<Cache>("Config.Model.Cost.Cache")({
  read: Money.USDPerMillionTokens.pipe(optional),
  write: Money.USDPerMillionTokens.pipe(optional),
}) {}

class Cost extends Schema.Class<Cost>("Config.Model.Cost")({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(optional),
  input: Money.USDPerMillionTokens,
  output: Money.USDPerMillionTokens,
  cache: Cache.pipe(optional),
}) {}

class Limit extends Schema.Class<Limit>("Config.Model.Limit")({
  context: Schema.Int.pipe(optional),
  input: Schema.Int.pipe(optional),
  output: Schema.Int.pipe(optional),
}) {}

export class Model extends Schema.Class<Model>("Config.Model")({
  modelID: ID.pipe(optional),
  family: Family.pipe(optional),
  name: Schema.String.pipe(optional),
  compatibility: Compatibility.pipe(optional),
  package: Schema.String.pipe(optional),
  ...ModelOverlays,
  // Partial: unset fields fall back to the base model's capabilities, then the defaults.
  capabilities: Capabilities.mapFields((fields) => ({
    tools: optional(fields.tools),
    input: optional(fields.input),
    output: optional(fields.output),
  }))
    .annotate({ identifier: "Config.Model.Capabilities" })
    .pipe(optional),
  variants: Schema.Struct({
    id: VariantID,
    ...ModelOverlays,
  }).pipe(Schema.Array, optional),
  cost: Schema.Union([Cost, Cost.pipe(Schema.Array)]).pipe(optional),
  quote: ModelSource.Quote.pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  limit: Limit.pipe(optional),
  seed: ModelSource.Seed.pipe(optional),
}) {}

export interface Adoption extends Schema.Schema.Type<typeof Adoption> {}
export const Adoption = Schema.Struct({
  phase: Schema.Literals(["draft", "applying", "ready"]),
  submissionID: Schema.String,
  targetDefinitionDigest: Schema.String,
  stage: Schema.Literals(["credential", "connection", "catalog", "complete"]),
  credentialAction: Schema.Literals(["keep", "use", "create"]),
  credentialID: Credential.ID.pipe(optional),
  credentialLabel: Schema.String.pipe(optional),
  activate: Schema.Boolean,
  addedModelIDs: Schema.Array(ID),
}).annotate({ identifier: "Config.Provider.Adoption" })

export class Info extends Schema.Class<Info>("Config.Provider")({
  canonical: Provider.ID.pipe(optional),
  name: Schema.String.pipe(optional),
  env: Schema.String.pipe(Schema.Array, optional),
  package: Schema.String.pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  adoption: Adoption.pipe(optional),
  discovery: ModelSource.Discovery.pipe(optional),
  ...Overlays,
  models: Schema.Record(Schema.String, Model).pipe(optional),
}) {}
