export * as PromptAsset from "./prompt-asset"

import { Schema } from "effect"

// -- Branded constrained strings --

export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 80, { message: "Name must be at most 80 code points" })),
  Schema.brand("PromptAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 300, {
    message: "Description must be at most 300 code points",
  })),
  Schema.brand("PromptAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("PromptAsset.Revision"),
)
export type Revision = typeof Revision.Type

export const Template = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, {
    message: "Template must be at most 100,000 UTF-8 bytes",
  })),
  Schema.brand("PromptAsset.Template"),
)
export type Template = typeof Template.Type

// -- Schema.Class records --

export class Summary extends Schema.Class<Summary>("PromptAsset.Summary")({
  kind: Schema.Literal("prompt"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("PromptAsset.Info")({
  kind: Schema.Literal("prompt"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  template: Template,
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("PromptAsset.Frontmatter")({
  kind: Schema.Literal("prompt"),
  name: Name,
  description: Description,
}) {}

export class Candidate extends Schema.Class<Candidate>("PromptAsset.Candidate")({
  name: Name,
  description: Description,
  template: Template,
  relativePath: Schema.String,
}) {}

// -- BaseRevision: null for new files, Revision for existing --

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

// -- Errors --

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("PromptAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("PromptAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("PromptAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("PromptAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "PromptAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "PromptAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("PromptAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
