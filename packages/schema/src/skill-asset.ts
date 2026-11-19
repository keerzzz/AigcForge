export * as SkillAsset from "./skill-asset.js"

import { Schema } from "effect"
import { AssetPlacement } from "./asset-placement.js"
import { optional } from "./schema.js"

// -- Constrained strings (对齐原生 SkillV2 命名空间) --

export const Name = Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(80)))
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(Schema.check(Schema.isMaxLength(300)))
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("SkillAsset.Revision"),
  Schema.annotate({ identifier: "SkillAsset.Revision" }),
)
export type Revision = typeof Revision.Type

// -- Schema.Class records --

export class Summary extends Schema.Class<Summary>("SkillAsset.Summary")(
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
  }).annotate({ identifier: "SkillAsset.Summary" }),
) {}

export class Info extends Schema.Class<Info>("SkillAsset.Info")(
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
    slash: Schema.Boolean,
    content: Schema.String,
    triggers: Schema.Array(Schema.String),
    tags: Schema.Array(Schema.String),
    target: optional(AssetPlacement.Target),
  }).annotate({ identifier: "SkillAsset.Info" }),
) {}

// 对齐原生 SkillV2 frontmatter（SkillV2.frontmatter = { name?, description?, slash? }）
export class Frontmatter extends Schema.Class<Frontmatter>("SkillAsset.Frontmatter")({
  name: Schema.optional(Name),
  description: Schema.optional(Description),
  slash: Schema.optional(Schema.Boolean),
  triggers: Schema.optional(Schema.Array(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
}) {}

// -- InvalidEntry & errors 沿用 PromptAsset 模式 --

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("SkillAsset.InvalidEntry")(
  Schema.Struct({
    relativePath: Schema.String,
    errorTag: InvalidErrorTag,
  }).annotate({ identifier: "SkillAsset.InvalidEntry" }),
) {}

export class Candidate extends Schema.Class<Candidate>("SkillAsset.Candidate")({
  name: Name,
  description: Description,
  slash: Schema.Boolean,
  content: Schema.String,
  triggers: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  relativePath: Schema.String,
}) {}

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class Inspection extends Schema.Class<Inspection>("SkillAsset.Inspection")(
  Schema.Struct({
    relativePath: Schema.String,
    exists: Schema.Boolean,
    revision: BaseRevision,
    nameConflict: Schema.Boolean,
    pathConflict: Schema.Boolean,
    target: AssetPlacement.Target,
  }).annotate({ identifier: "SkillAsset.Inspection" }),
) {}

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("SkillAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("SkillAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("SkillAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("SkillAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "SkillAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()("SkillAsset.InvalidCandidate", {
  reason: Schema.String,
}) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("SkillAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
