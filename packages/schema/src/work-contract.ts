export * as WorkContract from "./work-contract"

import { Schema } from "effect"
import { WorkflowAsset } from "./workflow-asset"
import { WorkPreset } from "./work-preset"

/** Version of the durable Work execution contract, not the prompt or UI revision. */
export const ContractVersion = Schema.Literal(1).annotate({ identifier: "WorkContract.Version" })
export type ContractVersion = typeof ContractVersion.Type

export const Output = Schema.Struct({
  outputType: WorkPreset.OutputType,
  artifact: WorkPreset.ArtifactSpec,
}).annotate({ identifier: "WorkContract.Output" })
export type Output = typeof Output.Type

export const Preset = Schema.Struct({
  source: Schema.Literal("preset"),
  contractVersion: ContractVersion,
  presetID: Schema.String,
  revision: WorkPreset.Revision,
  output: Output,
}).annotate({ identifier: "WorkContract.Preset" })
export type Preset = typeof Preset.Type

export const Workflow = Schema.Struct({
  source: Schema.Literal("workflow"),
  contractVersion: ContractVersion,
  workflowID: Schema.String,
  revision: WorkflowAsset.Revision,
  output: Schema.optional(Output),
}).annotate({ identifier: "WorkContract.Workflow" })
export type Workflow = typeof Workflow.Type

export const AdHoc = Schema.Struct({
  source: Schema.Literal("ad-hoc"),
  contractVersion: ContractVersion,
  output: Schema.optional(Output),
}).annotate({ identifier: "WorkContract.AdHoc" })
export type AdHoc = typeof AdHoc.Type

export const Snapshot = Schema.Union([Preset, Workflow, AdHoc]).annotate({ identifier: "WorkContract.Snapshot" })
export type Snapshot = typeof Snapshot.Type
