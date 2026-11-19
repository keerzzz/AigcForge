export * as AgentAsset from "./agent-asset.js"

import { Effect, Schema } from "effect"
import { Handoff } from "./handoff.js"
import { Agent } from "./agent.js"
import { optional } from "./schema.js"

export const Handoffs = Schema.mutable(Schema.Array(Handoff)).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed([])),
  Schema.withConstructorDefault(Effect.succeed([])),
)
export type Handoffs = typeof Handoffs.Type

export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("AgentAsset.Name"),
  Schema.annotate({ identifier: "AgentAsset.Name" }),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
  Schema.brand("AgentAsset.Description"),
  Schema.annotate({ identifier: "AgentAsset.Description" }),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("AgentAsset.Revision"),
  Schema.annotate({ identifier: "AgentAsset.Revision" }),
)
export type Revision = typeof Revision.Type

export const Config = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100_000)),
  Schema.brand("AgentAsset.Config"),
  Schema.annotate({ identifier: "AgentAsset.Config" }),
)
export type Config = typeof Config.Type

export const Source = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100_000)),
  Schema.brand("AgentAsset.Source"),
  Schema.annotate({ identifier: "AgentAsset.Source" }),
)
export type Source = typeof Source.Type

export class Summary extends Schema.Class<Summary>("AgentAsset.Summary")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  mode: optional(Agent.Info.fields.mode),
  hidden: optional(Schema.Boolean),
  disabled: optional(Schema.Boolean),
}) {}

export const WarningCode = Schema.Literals(["wildcard_allow", "dangerous_allow"])
export type WarningCode = typeof WarningCode.Type

export class Warning extends Schema.Class<Warning>("AgentAsset.Warning")({
  code: WarningCode,
  action: Schema.String,
  resource: Schema.String,
}) {}

export class Info extends Schema.Class<Info>("AgentAsset.Info")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  config: Config,
  source: Source,
  handoffs: Handoffs,
  card: optional(Agent.CardValue),
}) {}

export class ApplyResult extends Schema.Class<ApplyResult>("AgentAsset.ApplyResult")({
  asset: Info,
  warnings: Schema.Array(Warning),
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("AgentAsset.Frontmatter")({
  kind: Schema.Literal("agent"),
  name: Name,
  description: Description,
  config: Schema.optional(Config).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("" as Config)),
    Schema.withConstructorDefault(Effect.succeed("" as Config)),
  ),
  handoffs: Schema.optional(Handoffs).pipe(Schema.withConstructorDefault(Effect.succeed([]))),
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

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("AgentAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("AgentAsset.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("AgentAsset.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("AgentAsset.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "AgentAsset.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()("AgentAsset.InvalidCandidate", {
  reason: Schema.String,
}) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("AgentAsset.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
