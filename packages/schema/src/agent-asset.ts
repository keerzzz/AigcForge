export * as AgentAsset from "./agent-asset"

import { Effect, Schema } from "effect"

export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 80, { message: "Name must be at most 80 code points" })),
  Schema.brand("AgentAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => [...input].length <= 300, {
    message: "Description must be at most 300 code points",
  })),
  Schema.brand("AgentAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("AgentAsset.Revision"),
)
export type Revision = typeof Revision.Type

export const Config = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, {
    message: "Config must be at most 100,000 UTF-8 bytes",
  })),
  Schema.brand("AgentAsset.Config"),
)
export type Config = typeof Config.Type

export const Source = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, {
    message: "Source must be at most 100,000 UTF-8 bytes",
  })),
  Schema.brand("AgentAsset.Source"),
)
export type Source = typeof Source.Type

export class Summary extends Schema.Class<Summary>("AgentAsset.Summary")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("AgentAsset.Info")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  config: Config,
  source: Source,
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("AgentAsset.Frontmatter")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  config: Schema.optional(Config).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("" as Config)),
    Schema.withConstructorDefault(Effect.succeed("" as Config)),
  ),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("AgentAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

export class Candidate extends Schema.Class<Candidate>("AgentAsset.Candidate")({
  name: Name,
  description: Description,
  config: Config,
  source: Source,
  relativePath: Schema.String,
}) {}

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("AgentAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("AgentAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("AgentAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("AgentAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "AgentAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "AgentAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("AgentAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
