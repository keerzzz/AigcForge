export * as ProviderDefinition from "./provider-definition.js"

import { Schema, Struct } from "effect"
import { ConfigProvider } from "./config/provider.js"
import { Connection } from "./connection.js"
import { Credential } from "./credential.js"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { AbsolutePath, optional } from "./schema.js"

export interface Target extends Schema.Schema.Type<typeof Target> {}
export const Target = Schema.Struct({
  scope: Schema.Literals(["global", "project", "explicit"]),
  path: AbsolutePath,
}).annotate({ identifier: "ProviderDefinition.Target" })

export interface TargetRevision extends Schema.Schema.Type<typeof TargetRevision> {}
export const TargetRevision = Schema.Struct({
  ...Target.fields,
  /** null is an expected-absence revision, rather than an unreadable file. */
  digest: Schema.NullOr(Schema.String),
  preferred: Schema.Boolean,
  writable: Schema.Boolean,
  message: Schema.String.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.TargetRevision" })

export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Source = Schema.Struct({
  scope: Schema.Literals(["global", "project", "explicit", "virtual"]),
  path: AbsolutePath.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.Source" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  providerID: Provider.ID,
  source: Source,
  target: TargetRevision.pipe(optional),
  definition: ConfigProvider.Info,
  /** Paths omitted from definition because their stored values may contain secrets. */
  redactedPaths: Schema.Array(Schema.Array(Schema.String)),
  inherited: Schema.Array(Source),
  connections: Schema.Array(Connection.Info),
  activeConnection: Connection.Info.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.Info" })

export interface List extends Schema.Schema.Type<typeof List> {}
export const List = Schema.Struct({
  targets: Schema.Array(TargetRevision),
  definitions: Schema.Array(Info),
}).annotate({ identifier: "ProviderDefinition.List" })

export interface Editable extends Schema.Schema.Type<typeof Editable> {}
export const Editable = Schema.Struct(Struct.omit(ConfigProvider.Info.fields, ["adoption"])).annotate({
  identifier: "ProviderDefinition.Editable",
  parseOptions: { onExcessProperty: "error" },
})

const ProviderField = Schema.Literals([
  "canonical",
  "name",
  "env",
  "package",
  "disabled",
  "settings",
  "headers",
  "body",
  "models",
  "discovery",
])
const ModelField = Schema.Literals([
  "modelID",
  "family",
  "name",
  "compatibility",
  "package",
  "settings",
  "headers",
  "body",
  "capabilities",
  "variants",
  "cost",
  "quote",
  "disabled",
  "limit",
  "seed",
])

export const UnsetPath = Schema.Union([
  Schema.Tuple([ProviderField]),
  Schema.Tuple([Schema.Literals(["settings", "headers", "body", "discovery"]), Schema.String]),
  Schema.Tuple([Schema.Literal("discovery"), Schema.Literal("list"), Schema.Literals(["protocol", "url"])]),
  Schema.Tuple([Schema.Literal("models"), Schema.String]),
  Schema.Tuple([Schema.Literal("models"), Schema.String, ModelField]),
  Schema.Tuple([
    Schema.Literal("models"),
    Schema.String,
    Schema.Literal("quote"),
    Schema.Literals(["validFrom", "validUntil", "source", "observedAt"]),
  ]),
  Schema.Tuple([
    Schema.Literal("models"),
    Schema.String,
    Schema.Literals(["settings", "headers", "body", "capabilities", "limit", "compatibility"]),
    Schema.String,
  ]),
]).annotate({ identifier: "ProviderDefinition.UnsetPath" })
export type UnsetPath = Schema.Schema.Type<typeof UnsetPath>

export interface Patch extends Schema.Schema.Type<typeof Patch> {}
export const Patch = Schema.Struct({
  /** Missing fields retain their authored values. Object fields are patched recursively. */
  set: Editable.pipe(optional),
  unset: Schema.Array(UnsetPath).pipe(optional),
}).annotate({ identifier: "ProviderDefinition.Patch", parseOptions: { onExcessProperty: "error" } })

export const CredentialAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("keep") }),
  Schema.Struct({ type: Schema.Literal("use"), credentialID: Credential.ID }),
  Schema.Struct({
    type: Schema.Literal("create"),
    /** Omit a key when resuming an adoption whose credential was already created. */
    key: Schema.String.pipe(optional),
    label: Schema.String.pipe(optional),
    activate: Schema.Boolean.pipe(optional),
  }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "ProviderDefinition.CredentialAction" })
export type CredentialAction = Schema.Schema.Type<typeof CredentialAction>

export interface SaveInput extends Schema.Schema.Type<typeof SaveInput> {}
export const SaveInput = Schema.Struct({
  providerID: Provider.ID,
  submissionID: Schema.String,
  target: Target,
  expectedDigest: Schema.NullOr(Schema.String),
  patch: Patch,
  credential: CredentialAction,
}).annotate({ identifier: "ProviderDefinition.SaveInput", parseOptions: { onExcessProperty: "error" } })

/** One strict admission decoder for direct calls; HTTP uses PayloadParseOptions. */
export const decodeSave = Schema.decodeUnknownSync(SaveInput, { onExcessProperty: "error", errors: "all" })

export interface DefinitionResult extends Schema.Schema.Type<typeof DefinitionResult> {}
export const DefinitionResult = Schema.Struct({
  status: Schema.Literals(["saved", "unchanged", "failed", "conflict"]),
  target: TargetRevision.pipe(optional),
  message: Schema.String.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.DefinitionResult" })

export interface CredentialResult extends Schema.Schema.Type<typeof CredentialResult> {}
export const CredentialResult = Schema.Struct({
  status: Schema.Literals(["kept", "created", "used", "pending", "failed", "skipped"]),
  credentialID: Credential.ID.pipe(optional),
  message: Schema.String.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.CredentialResult" })

export interface CatalogResult extends Schema.Schema.Type<typeof CatalogResult> {}
export const CatalogResult = Schema.Struct({
  status: Schema.Literals(["ready", "pending", "unavailable", "failed"]),
  message: Schema.String.pipe(optional),
}).annotate({ identifier: "ProviderDefinition.CatalogResult" })

export interface SaveResult extends Schema.Schema.Type<typeof SaveResult> {}
export const SaveResult = Schema.Struct({
  providerID: Provider.ID,
  submissionID: Schema.String,
  definition: DefinitionResult,
  credential: CredentialResult,
  catalog: CatalogResult,
  info: Info.pipe(optional),
  addedModelIDs: Schema.Array(Model.ID),
}).annotate({ identifier: "ProviderDefinition.SaveResult" })

export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}
export const RemoveInput = Schema.Struct({
  providerID: Provider.ID,
  target: Target,
  expectedDigest: Schema.NullOr(Schema.String),
}).annotate({ identifier: "ProviderDefinition.RemoveInput", parseOptions: { onExcessProperty: "error" } })

export const decodeRemove = Schema.decodeUnknownSync(RemoveInput, { onExcessProperty: "error", errors: "all" })

export interface RemoveResult extends Schema.Schema.Type<typeof RemoveResult> {}
export const RemoveResult = Schema.Struct({
  providerID: Provider.ID,
  definition: DefinitionResult,
  inherited: Schema.Array(Source),
}).annotate({ identifier: "ProviderDefinition.RemoveResult" })
