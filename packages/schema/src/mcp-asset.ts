export * as MCPAsset from "./mcp-asset.js"

import { Effect, Schema } from "effect"

export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("MCPAsset.Name"),
  Schema.annotate({ identifier: "MCPAsset.Name" }),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
  Schema.brand("MCPAsset.Description"),
  Schema.annotate({ identifier: "MCPAsset.Description" }),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("MCPAsset.Revision"),
  Schema.annotate({ identifier: "MCPAsset.Revision" }),
)
export type Revision = typeof Revision.Type

export const Command = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("MCPAsset.Command"),
  Schema.annotate({ identifier: "MCPAsset.Command" }),
)
export type Command = typeof Command.Type

export const ConfigJson = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100_000)),
  Schema.brand("MCPAsset.ConfigJson"),
  Schema.annotate({ identifier: "MCPAsset.ConfigJson" }),
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

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("MCPAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("MCPAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("MCPAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("MCPAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()("MCPAsset.OverwriteRequired", {
  relativePath: Schema.String,
}) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()("MCPAsset.InvalidCandidate", {
  reason: Schema.String,
}) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("MCPAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
