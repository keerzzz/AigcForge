export * as WorkflowAsset from "./workflow-asset"

import { Effect, Schema } from "effect"

export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 80, { message: "Name must be at most 80 code points" })),
  Schema.brand("WorkflowAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 300, {
    message: "Description must be at most 300 code points",
  })),
  Schema.brand("WorkflowAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("WorkflowAsset.Revision"),
)
export type Revision = typeof Revision.Type

export class StepDef extends Schema.Class<StepDef>("WorkflowAsset.StepDef")({
  id: Schema.String,
  name: Schema.String,
  agent: Schema.String,
  input: Schema.Unknown,
  next: Schema.optional(Schema.String),
  branches: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  parallel: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class Summary extends Schema.Class<Summary>("WorkflowAsset.Summary")({
  kind: Schema.Literal("workflow"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("WorkflowAsset.Info")({
  kind: Schema.Literal("workflow"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  version: Schema.String,
  triggers: Schema.Array(Schema.String),
  steps: Schema.Array(StepDef),
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("WorkflowAsset.Frontmatter")({
  kind: Schema.Literal("workflow"),
  name: Schema.String,
  description: Schema.String,
  version: Schema.String,
  triggers: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  steps: Schema.Array(StepDef),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("WorkflowAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}
