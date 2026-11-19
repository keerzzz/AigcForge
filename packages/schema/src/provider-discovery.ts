export * as ProviderDiscovery from "./provider-discovery.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { ModelSource } from "./model-source.js"
import { Provider } from "./provider.js"
import { ProviderDefinition } from "./provider-definition.js"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export interface Inventory extends Schema.Schema.Type<typeof Inventory> {}
export const Inventory = Schema.Struct({
  identity: ModelSource.Identity,
  complete: Schema.Boolean,
  digest: Schema.String,
  observedAt: Schema.Finite,
  models: Schema.Array(Schema.Struct({ id: Model.ID, metadata: ModelSource.Metadata })),
}).annotate({ identifier: "ProviderDiscovery.Inventory" })

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  providerID: Provider.ID,
  identity: ModelSource.Identity.pipe(optional),
  phase: Schema.Literals(["idle", "fetching", "ready", "failed", "partial", "disabled"]),
  lastAttemptAt: Schema.Finite.pipe(optional),
  lastSuccessAt: Schema.Finite.pipe(optional),
  cachePersisted: Schema.Boolean,
  error: Schema.Struct({
    kind: Schema.Literals(["auth", "network", "timeout", "invalid", "incomplete", "cache"]),
    message: Schema.String,
  }).pipe(optional),
  generation: Schema.Int,
}).annotate({ identifier: "ProviderDiscovery.Status" })

export interface Managed extends Schema.Schema.Type<typeof Managed> {}
export const Managed = Schema.Struct({
  ref: Model.Ref,
  modelID: Model.ID,
  metadata: ModelSource.Metadata,
  origins: ModelSource.Origins,
  seed: ModelSource.Seed.pipe(optional),
  membership: Schema.Literals(["present", "absent", "unknown"]),
}).annotate({ identifier: "ProviderDiscovery.Managed" })

export interface Read extends Schema.Schema.Type<typeof Read> {}
export const Read = Schema.Struct({
  status: Status,
  inventory: Inventory.pipe(optional),
  candidates: Schema.Array(
    Schema.Struct({
      id: Model.ID,
      metadata: ModelSource.Metadata,
      managedRefs: Schema.Array(Model.Ref),
      membership: Schema.Literals(["present", "absent", "unknown"]),
    }),
  ),
  managed: Schema.Array(Managed),
}).annotate({ identifier: "ProviderDiscovery.Read" })

export interface GetInput extends Schema.Schema.Type<typeof GetInput> {}
export const GetInput = Schema.Struct({
  providerID: Provider.ID,
  connection: ModelSource.ConnectionRef.pipe(optional),
}).annotate({ identifier: "ProviderDiscovery.GetInput" })

export const PreviewDefinition = Schema.Union([
  Schema.Struct({ type: Schema.Literal("new"), definition: ProviderDefinition.Editable }),
  Schema.Struct({
    type: Schema.Literal("stored"),
    target: ProviderDefinition.Target,
    expectedDigest: Schema.NullOr(Schema.String),
    patch: ProviderDefinition.Patch,
  }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "ProviderDiscovery.PreviewDefinition" })
export type PreviewDefinition = Schema.Schema.Type<typeof PreviewDefinition>

export const PreviewCredential = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({ type: Schema.Literal("key"), key: Schema.String }),
  Schema.Struct({ type: Schema.Literal("connection"), connection: ModelSource.ConnectionRef }),
  Schema.Struct({ type: Schema.Literal("active") }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "ProviderDiscovery.PreviewCredential" })
export type PreviewCredential = Schema.Schema.Type<typeof PreviewCredential>

export interface PreviewInput extends Schema.Schema.Type<typeof PreviewInput> {}
export const PreviewInput = Schema.Struct({
  providerID: Provider.ID,
  definition: PreviewDefinition,
  credential: PreviewCredential,
  list: ModelSource.Discovery.fields.list,
}).annotate({ identifier: "ProviderDiscovery.PreviewInput" })

export interface RefreshInput extends Schema.Schema.Type<typeof RefreshInput> {}
export const RefreshInput = Schema.Struct({ ...GetInput.fields, force: Schema.Boolean.pipe(optional) }).annotate({
  identifier: "ProviderDiscovery.RefreshInput",
})

const Updated = ephemeral({
  type: "provider.discovery.updated",
  schema: { providerID: Provider.ID, connection: ModelSource.ConnectionRef.pipe(optional) },
})
export const Event = { Updated, Definitions: inventory(Updated) }

export const decodePreview = Schema.decodeUnknownSync(PreviewInput, { onExcessProperty: "error", errors: "all" })
