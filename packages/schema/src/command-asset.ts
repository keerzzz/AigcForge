export * as CommandAsset from "./command-asset.js"

import { Effect, Schema } from "effect"
import { AssetPlacement } from "./asset-placement.js"
import { optional } from "./schema.js"

export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("CommandAsset.Name"),
  Schema.annotate({ identifier: "CommandAsset.Name" }),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
  Schema.brand("CommandAsset.Description"),
  Schema.annotate({ identifier: "CommandAsset.Description" }),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("CommandAsset.Revision"),
  Schema.annotate({ identifier: "CommandAsset.Revision" }),
)
export type Revision = typeof Revision.Type

export const Invocation = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(200)),
  Schema.brand("CommandAsset.Invocation"),
  Schema.annotate({ identifier: "CommandAsset.Invocation" }),
)
export type Invocation = typeof Invocation.Type

export const Source = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100_000)),
  Schema.brand("CommandAsset.Source"),
  Schema.annotate({ identifier: "CommandAsset.Source" }),
)
export type Source = typeof Source.Type

export class Summary extends Schema.Class<Summary>("CommandAsset.Summary")(
  Schema.Struct({
    kind: Schema.Literal("command"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
  }).annotate({ identifier: "CommandAsset.Summary" }),
) {}

export class Info extends Schema.Class<Info>("CommandAsset.Info")(
  Schema.Struct({
    kind: Schema.Literal("command"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
    invocation: Invocation,
    args: optional(Schema.String),
    source: Source,
    target: optional(AssetPlacement.Target),
  }).annotate({ identifier: "CommandAsset.Info" }),
) {}

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

export class InvalidEntry extends Schema.Class<InvalidEntry>("CommandAsset.InvalidEntry")(
  Schema.Struct({
    relativePath: Schema.String,
    errorTag: InvalidErrorTag,
  }).annotate({ identifier: "CommandAsset.InvalidEntry" }),
) {}

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

export class Inspection extends Schema.Class<Inspection>("CommandAsset.Inspection")(
  Schema.Struct({
    relativePath: Schema.String,
    exists: Schema.Boolean,
    revision: BaseRevision,
    nameConflict: Schema.Boolean,
    pathConflict: Schema.Boolean,
    target: AssetPlacement.Target,
  }).annotate({ identifier: "CommandAsset.Inspection" }),
) {}

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("CommandAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("CommandAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("CommandAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("CommandAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "CommandAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "CommandAsset.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("CommandAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
