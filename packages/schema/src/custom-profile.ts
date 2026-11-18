export * as CustomProfile from "./custom-profile.js"

import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect"
import { Composition } from "./composition.js"
import { McpScope } from "./mcp-scope.js"
import { optional } from "./schema.js"

export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("CustomProfile.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
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

export const McpBinding = Schema.declareConstructor<McpScope.McpServerBinding>()(
  [],
  () => (input) => {
    try {
      return Effect.succeed(McpScope.decodeBinding(input))
    } catch (error) {
      return Effect.fail(
        new SchemaIssue.InvalidValue(
          { message: error instanceof Error ? error.message : "Invalid MCP binding" },
          input,
        ),
      )
    }
  },
  {
    identifier: "CustomProfile.McpBinding",
    // 4.0.1 codegen note (R1b): the representation emitter special-cases the Json
    // representation, so the generated client treats mcpBindings as opaque JSON
    // values instead of failing on an unexpressible declaration. Server-side
    // strictness is unchanged (the run callback above + the toCodecJson link),
    // and client-side typing can be refined when upstream reviver plumbing lands.
    representation: { id: "effect/schema/Json", payload: null },
    // The declaration above is the strict boundary for in-process callers. JSON
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

export class Profile extends Schema.Class<Profile>("CustomProfile.Profile")(
  Schema.Struct({
    kind: Schema.Literal("custom-profile"),
    name: Name,
    description: Description,
    // No default: old root-less profiles retain their encoded identity.
    root: Composition.Root.pipe(optional),
    agents: Schema.Array(Composition.AgentRef).check(Schema.isMaxLength(16)),
    workflow: Schema.optional(Composition.WorkflowRef),
    bindings: Composition.strictBindings(Composition.Binding),
    presentation: Composition.Presentation,
    requestedCapabilities: Schema.Array(Schema.String),
    mcpBindings: Schema.Array(McpBinding).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed([])),
      Schema.withConstructorDefault(Effect.succeed([])),
    ),
  }).check(
    Schema.makeFilter((profile) => profile.root === undefined || profile.root.revision !== undefined, {
      message: "A saved builtin root must carry its captured revision",
      representation: { id: "aigcfroge/profileRootRevision", payload: {} },
      arbitraryConstraint: {},
      toCode: () => ({
        runtime:
          'Schema.makeFilter((profile) => profile.root === undefined || profile.root.revision !== undefined, { message: "A saved builtin root must carry its captured revision" })',
      }),
    }),
    Schema.makeFilter((profile) => profile.root !== undefined || profile.agents.length > 0, {
      message: "A root-less profile must contain at least one agent",
      representation: { id: "aigcfroge/profileAgentCardinality", payload: {} },
      arbitraryConstraint: {},
      toCode: () => ({
        runtime:
          'Schema.makeFilter((profile) => profile.root !== undefined || profile.agents.length > 0, { message: "A root-less profile must contain at least one agent" })',
      }),
    }),
  ),
) {}

const strictOptions = { errors: "all", onExcessProperty: "error" } as const

/**
 * Profile JSON codec boundary (HTTP wire). Under Effect 4.0.1 the JSON codec decodes
 * declared members through their encoded shape first, and without explicit parse options
 * excess keys are stripped before the strict declarative decoder runs. The strict options
 * must ride along on every decode of the JSON codec, so the boundary is exported as one
 * composed decoder rather than relying on call sites to remember the options.
 */
const profileJsonCodec = Schema.toCodecJson(Profile)
export const decodeProfileJson = Schema.decodeUnknownSync(profileJsonCodec, strictOptions)

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

export class AssetNotFoundError extends Schema.TaggedError<AssetNotFoundError>()("CustomProfile.NotFound", {
  relativePath: Schema.String,
}) {}

export class NameConflictError extends Schema.TaggedError<NameConflictError>()("CustomProfile.NameConflict", {
  name: Name,
}) {}

export class PathConflictError extends Schema.TaggedError<PathConflictError>()("CustomProfile.PathConflict", {
  relativePath: Schema.String,
}) {}

export class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()("CustomProfile.StaleRevision", {
  relativePath: Schema.String,
}) {}

export class OverwriteRequiredError extends Schema.TaggedError<OverwriteRequiredError>()(
  "CustomProfile.OverwriteRequired",
  { relativePath: Schema.String },
) {}

export class InvalidCandidateError extends Schema.TaggedError<InvalidCandidateError>()(
  "CustomProfile.InvalidCandidate",
  { reason: Schema.String },
) {}

export class WriteFailedError extends Schema.TaggedError<WriteFailedError>()("CustomProfile.WriteFailed", {
  relativePath: Schema.String,
  reason: Schema.String,
}) {}
