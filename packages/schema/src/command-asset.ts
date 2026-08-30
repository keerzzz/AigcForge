export * as CommandAsset from "./command-asset"

import { Effect, Schema } from "effect"

export const Name = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length >= 1, {
      message: "Name must be at least 1 code point",
    }),
  ),
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 80, {
      message: "Name must be at most 80 code points",
    }),
  ),
  Schema.brand("CommandAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
      message: "Description must be at most 300 code points",
    }),
  ),
  Schema.brand("CommandAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("CommandAsset.Revision"),
)
export type Revision = typeof Revision.Type

export const Invocation = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length >= 1, {
      message: "Invocation must be at least 1 code point",
    }),
  ),
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 200, {
      message: "Invocation must be at most 200 code points",
    }),
  ),
  Schema.brand("CommandAsset.Invocation"),
)
export type Invocation = typeof Invocation.Type

export const Source = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, {
      message: "Source must be at most 100,000 UTF-8 bytes",
    }),
  ),
  Schema.brand("CommandAsset.Source"),
)
export type Source = typeof Source.Type

export class Summary extends Schema.Class<Summary>("CommandAsset.Summary")({
  kind: Schema.Literal("command"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("CommandAsset.Info")({
  kind: Schema.Literal("command"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  invocation: Invocation,
  args: Schema.optional(Schema.String),
  source: Source,
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("CommandAsset.Frontmatter")({
  kind: Schema.Literal("command"),
  name: Name,
  description: Description,
  invocation: Invocation,
  args: Schema.optional(Schema.String),
  source: Schema.optional(Source).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("" as Source)),
    Schema.withConstructorDefault(Effect.succeed("" as Source)),
  ),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("CommandAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

export class Candidate extends Schema.Class<Candidate>("CommandAsset.Candidate")({
  name: Name,
  description: Description,
  invocation: Invocation,
  args: Schema.optional(Schema.String),
  source: Source,
  relativePath: Schema.String,
}) {}

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("CommandAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("CommandAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("CommandAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("CommandAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "CommandAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "CommandAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("CommandAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
