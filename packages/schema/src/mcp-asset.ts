export * as MCPAsset from "./mcp-asset"

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
  Schema.brand("MCPAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
      message: "Description must be at most 300 code points",
    }),
  ),
  Schema.brand("MCPAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("MCPAsset.Revision"),
)
export type Revision = typeof Revision.Type

export const Command = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length >= 1, {
      message: "Command must be at least 1 code point",
    }),
  ),
  Schema.brand("MCPAsset.Command"),
)
export type Command = typeof Command.Type

export const ConfigJson = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, {
      message: "Config JSON must be at most 100,000 UTF-8 bytes",
    }),
  ),
  Schema.brand("MCPAsset.ConfigJson"),
)
export type ConfigJson = typeof ConfigJson.Type

export class Summary extends Schema.Class<Summary>("MCPAsset.Summary")({
  kind: Schema.Literal("mcp"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("MCPAsset.Info")({
  kind: Schema.Literal("mcp"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  command: Command,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  configJson: ConfigJson,
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("MCPAsset.Frontmatter")({
  kind: Schema.Literal("mcp"),
  name: Name,
  description: Description,
  command: Command,
  args: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
    Schema.withConstructorDefault(Effect.succeed({})),
  ),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("MCPAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

export class Candidate extends Schema.Class<Candidate>("MCPAsset.Candidate")({
  name: Name,
  description: Description,
  command: Command,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  configJson: ConfigJson,
  relativePath: Schema.String,
}) {}

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("MCPAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("MCPAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("MCPAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("MCPAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "MCPAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "MCPAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("MCPAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
