export * as CustomProfile from "./custom-profile"

import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect"
import { Composition } from "./composition"
import { McpScope } from "./mcp-scope"

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
  Schema.brand("CustomProfile.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
      message: "Description must be at most 300 code points",
    }),
  ),
  Schema.brand("CustomProfile.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("CustomProfile.Revision"),
)
export type Revision = typeof Revision.Type

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

// The JSON codec link's target is what actually decodes wire JSON, and it runs
// *before* the link's own getters — so a target that strips unknown keys defeats
// the canonical decoder no matter what the getters do. Plain `McpServerBinding`
// strips them, which is why a `headers: { Authorization: ... }` smuggled through
// `POST /custom-profile/apply` was silently dropped and answered 200: exactly the
// silent-swallow `McpScope`'s strict options exist to prevent. Measured, not
// assumed — patching the getter leaves it admitted, and removing the link makes
// every decode fail `Expected null`.
const StrictMcpServerBinding = McpScope.McpServerBinding.annotate({
  parseOptions: { onExcessProperty: "error" },
})

const McpBinding = Schema.declareConstructor<McpScope.McpServerBinding>()(
  [],
  () => (input) => {
    try {
      return Effect.succeed(McpScope.decodeBinding(input))
    } catch (error) {
      return Effect.fail(
        new SchemaIssue.InvalidValue(Option.some(input), {
          message: error instanceof Error ? error.message : "Invalid MCP binding",
        }),
      )
    }
  },
  {
    identifier: "CustomProfile.McpBinding",
    // The declaration above is the strict boundary for in-process callers. JSON
    // input goes through this link instead, so the link target has to carry the
    // same strictness; it also tells OpenAPI tooling the wire shape, without
    // which Schema's declaration fallback becomes `null` and contaminates
    // unrelated SDK types.
    toCodecJson: () =>
      Schema.link<McpScope.McpServerBinding>()(StrictMcpServerBinding, {
        decode: SchemaGetter.transform((value) => value),
        encode: SchemaGetter.transform((value) => value),
      }),
  },
)

export class Profile extends Schema.Class<Profile>("CustomProfile.Profile")({
  kind: Schema.Literal("custom-profile"),
  name: Name,
  description: Description,
  agents: Schema.Array(Composition.AgentRef).pipe(
    Schema.check(
      Schema.makeFilter<readonly unknown[]>((input) => input.length >= 1 && input.length <= 16, {
        message: "Profile must contain between 1 and 16 agents",
      }),
    ),
  ),
  workflow: Schema.optional(Composition.WorkflowRef),
  bindings: Schema.Record(Composition.Consumer, Composition.Binding),
  presentation: Composition.Presentation,
  requestedCapabilities: Schema.Array(Schema.String),
  mcpBindings: Schema.Array(McpBinding).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
}) {}

const strictOptions = { errors: "all", onExcessProperty: "error" } as const

/**
 * Profile persistence boundary: each MCP entry delegates to the canonical strict
 * decoder, so secret-bearing or structurally invalid fields fail before a
 * Profile/Candidate/HTTP boundary can normalize or silently strip them.
 */
export const decodeProfile = Schema.decodeUnknownSync(Profile, strictOptions)

export class Summary extends Schema.Class<Summary>("CustomProfile.Summary")({
  kind: Schema.Literal("custom-profile"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class DeleteResult extends Schema.Class<DeleteResult>("CustomProfile.DeleteResult")({
  relativePath: Schema.String,
  referencingProfiles: Schema.Array(Summary),
}) {}

export class Info extends Schema.Class<Info>("CustomProfile.Info")({
  kind: Schema.Literal("custom-profile"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  profile: Profile,
  rawYaml: Schema.optional(Schema.String),
}) {}

export class Candidate extends Schema.Class<Candidate>("CustomProfile.Candidate")({
  name: Name,
  description: Description,
  relativePath: Schema.String,
  profile: Profile,
}) {}

export const InvalidErrorTag = Schema.Literals([
  "parse_error",
  "bad_yaml",
  "name_conflict",
  "invalid_cardinality",
  "disallowed_kind",
])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("CustomProfile.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

// -- Errors --

export class AssetNotFoundError extends Schema.TaggedErrorClass<AssetNotFoundError>()("CustomProfile.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()("CustomProfile.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedErrorClass<PathConflictError>()("CustomProfile.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedErrorClass<StaleRevisionError>()("CustomProfile.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedErrorClass<OverwriteRequiredError>()(
  "CustomProfile.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedErrorClass<InvalidCandidateError>()(
  "CustomProfile.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedErrorClass<WriteFailedError>()("CustomProfile.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
