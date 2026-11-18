export * as PromptAsset from "./prompt-asset.js"

import { Schema } from "effect"
import { AssetPlacement } from "./asset-placement.js"
import { optional } from "./schema.js"

// -- Branded constrained strings --

export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("PromptAsset.Name"),
  Schema.annotate({ identifier: "PromptAsset.Name" }),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
  Schema.brand("PromptAsset.Description"),
  Schema.annotate({ identifier: "PromptAsset.Description" }),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("PromptAsset.Revision"),
  Schema.annotate({ identifier: "PromptAsset.Revision" }),
)
export type Revision = typeof Revision.Type

export const Template = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(100_000)),
  Schema.brand("PromptAsset.Template"),
  Schema.annotate({ identifier: "PromptAsset.Template" }),
)
export type Template = typeof Template.Type

// -- Schema.Class records --

export class Summary extends Schema.Class<Summary>("PromptAsset.Summary")(
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
  }).annotate({ identifier: "PromptAsset.Summary" }),
) {}

export class Info extends Schema.Class<Info>("PromptAsset.Info")(
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
    template: Template,
    target: optional(AssetPlacement.Target),
  }).annotate({ identifier: "PromptAsset.Info" }),
) {}

export class Frontmatter extends Schema.Class<Frontmatter>("PromptAsset.Frontmatter")({
  kind: Schema.Literal("prompt"),
  name: Name,
  description: Description,
}) {}

// errorTag for files the registry skipped: parse_error = no valid frontmatter
// could be parsed (gray-matter threw or returned empty data); bad_frontmatter =
// frontmatter parsed but failed schema validation; bad_template = the canonical
// Template validator rejected the body; name_conflict = duplicate name.
export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "bad_template", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("PromptAsset.InvalidEntry")(
  Schema.Struct({
    relativePath: Schema.String,
    errorTag: InvalidErrorTag,
  }).annotate({ identifier: "PromptAsset.InvalidEntry" }),
) {}

export class Candidate extends Schema.Class<Candidate>("PromptAsset.Candidate")({
  name: Name,
  description: Description,
  template: Template,
  relativePath: Schema.String,
}) {}

// -- BaseRevision: null for new files, Revision for existing --

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class Inspection extends Schema.Class<Inspection>("PromptAsset.Inspection")(
  Schema.Struct({
    relativePath: Schema.String,
    exists: Schema.Boolean,
    revision: BaseRevision,
    nameConflict: Schema.Boolean,
    pathConflict: Schema.Boolean,
    target: AssetPlacement.Target,
  }).annotate({ identifier: "PromptAsset.Inspection" }),
) {}

// -- Errors --

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("PromptAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("PromptAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("PromptAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("PromptAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "PromptAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()("PromptAsset.InvalidCandidate", {
  reason: Schema.String,
}) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("PromptAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
