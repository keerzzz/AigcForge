export * as ModelGroup from "./model-group.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { ModelSource } from "./model-source.js"
import { ProviderDefinition } from "./provider-definition.js"
import { optional } from "./schema.js"

export { Target, TargetRevision, Source } from "./provider-definition.js"

const Weight = Schema.Finite.check(Schema.isGreaterThan(0))

export const Strategy = Schema.Literals(["order", "rotate", "weight", "fast", "cheap", "smart", "usage", "pace", "free", "expiring", "drain"])
  .annotate({ identifier: "ModelGroup.Strategy" })
export type Strategy = typeof Strategy.Type

export interface Member extends Schema.Schema.Type<typeof Member> {}
export const Member = Schema.Struct({
  ...Model.Ref.fields,
  weight: Weight.pipe(optional),
  /** Omitted uses the active connection; an explicit empty list has no candidates. */
  connections: Schema.Array(
    Schema.Struct({
      ref: ModelSource.ConnectionRef,
      weight: Weight.pipe(optional),
    }),
  ).pipe(optional),
}).annotate({ identifier: "ModelGroup.Member" })

export class Definition extends Schema.Class<Definition>("ModelGroup.Definition")({
  name: Schema.String,
  enabled: Schema.Boolean,
  members: Schema.Array(Member),
  strategy: Strategy,
  affinity: Schema.Literals(["turn", "session", "off"]),
}) {}

export class BehaviorSnapshot extends Schema.Class<BehaviorSnapshot>("ModelGroup.BehaviorSnapshot")({
  groupID: Model.GroupID,
  members: Definition.fields.members,
  strategy: Definition.fields.strategy,
  affinity: Definition.fields.affinity,
  behaviorDigest: Schema.String,
}) {}

const Editable = Schema.Struct(Definition.fields).mapFields((fields) => ({
  name: fields.name.pipe(optional),
  enabled: fields.enabled.pipe(optional),
  members: fields.members.pipe(optional),
  strategy: fields.strategy.pipe(optional),
  affinity: fields.affinity.pipe(optional),
}))

export class Patch extends Schema.Class<Patch>("ModelGroup.Patch")(
  Schema.Struct({ set: Editable.pipe(optional) }).annotate({ parseOptions: { onExcessProperty: "error" } }),
) {}

export const Unavailable = Schema.Literals(["missing", "disabled", "empty"]).annotate({
  identifier: "ModelGroup.Unavailable",
})
export type Unavailable = typeof Unavailable.Type

export class Current extends Schema.Class<Current>("ModelGroup.Current")({
  groupID: Model.GroupID,
  definition: Definition.pipe(optional),
  source: ProviderDefinition.Source.pipe(optional),
  behavior: BehaviorSnapshot.pipe(optional),
  unavailable: Unavailable.pipe(optional),
}) {}

export class Authored extends Schema.Class<Authored>("ModelGroup.Authored")({
  groupID: Model.GroupID,
  definition: Definition,
  source: ProviderDefinition.Source,
  target: ProviderDefinition.TargetRevision.pipe(optional),
  inherited: Schema.Array(ProviderDefinition.Source),
}) {}

export class Read extends Schema.Class<Read>("ModelGroup.Read")({
  targets: Schema.Array(ProviderDefinition.TargetRevision),
  definitions: Schema.Array(Authored),
  effective: Schema.Array(Current),
  defaultSelection: Model.Selection.pipe(optional),
}) {}

export class SaveInput extends Schema.Class<SaveInput>("ModelGroup.SaveInput")(
  Schema.Struct({
    groupID: Model.GroupID,
    target: ProviderDefinition.Target,
    expectedDigest: Schema.NullOr(Schema.String),
    patch: Patch,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
) {}

export class RemoveInput extends Schema.Class<RemoveInput>("ModelGroup.RemoveInput")(
  Schema.Struct({
    groupID: Model.GroupID,
    target: ProviderDefinition.Target,
    expectedDigest: Schema.NullOr(Schema.String),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
) {}

export class SaveResult extends Schema.Class<SaveResult>("ModelGroup.SaveResult")({
  groupID: Model.GroupID,
  definition: ProviderDefinition.DefinitionResult,
  readback: Read.pipe(optional),
}) {}

export class RemoveResult extends Schema.Class<RemoveResult>("ModelGroup.RemoveResult")({
  groupID: Model.GroupID,
  definition: ProviderDefinition.DefinitionResult,
  inherited: Schema.Array(ProviderDefinition.Source),
  readback: Read.pipe(optional),
}) {}

export const decodeSave = Schema.decodeUnknownSync(SaveInput, { onExcessProperty: "error", errors: "all" })
export const decodeRemove = Schema.decodeUnknownSync(RemoveInput, { onExcessProperty: "error", errors: "all" })
