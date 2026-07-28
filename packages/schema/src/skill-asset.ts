export * as SkillAsset from "./skill-asset"

import { Schema } from "effect"

// -- Constrained strings (对齐原生 SkillV2 命名空间) --

export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 80, { message: "Name must be at most 80 code points" })),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
    message: "Description must be at most 300 code points",
  })),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("SkillAsset.Revision"),
)
export type Revision = typeof Revision.Type

// -- Schema.Class records --

export class Summary extends Schema.Class<Summary>("SkillAsset.Summary")({
  kind: Schema.Literal("skill"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("SkillAsset.Info")({
  kind: Schema.Literal("skill"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  slash: Schema.Boolean,
  content: Schema.String,
  triggers: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
}) {}

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

export class InvalidEntry extends Schema.Class<InvalidEntry>("SkillAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

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

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("SkillAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("SkillAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("SkillAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("SkillAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "SkillAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "SkillAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("SkillAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
