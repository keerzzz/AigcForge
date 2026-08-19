import { Schema } from "effect"
import { Session } from "./session"

// Branded types
export const Digest = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Composition.Digest"),
)
export type Digest = typeof Digest.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Composition.Revision"),
)
export type Revision = typeof Revision.Type

export const AllowedKind = Schema.Literals(["agent", "prompt", "skill"])
export type AllowedKind = typeof AllowedKind.Type

export class AgentRef extends Schema.Class<AgentRef>("Composition.AgentRef")({
  kind: Schema.Literal("agent"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class PromptRef extends Schema.Class<PromptRef>("Composition.PromptRef")({
  kind: Schema.Literal("prompt"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class SkillRef extends Schema.Class<SkillRef>("Composition.SkillRef")({
  kind: Schema.Literal("skill"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class McpRef extends Schema.Class<McpRef>("Composition.McpRef")({
  kind: Schema.Literal("mcp"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export const AssetRef = Schema.Union([AgentRef, PromptRef, SkillRef])
export type AssetRef = typeof AssetRef.Type

export const Consumer = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => /^(orchestrator|agents\/[a-zA-Z0-9_-]+)$/.test(input), {
      message: "Consumer must be 'orchestrator' or 'agents/<agentId>'",
    }),
  ),
  Schema.brand("Composition.Consumer"),
)
export type Consumer = typeof Consumer.Type

export class Binding extends Schema.Class<Binding>("Composition.Binding")({
  prompts: Schema.Array(PromptRef),
  skills: Schema.Array(SkillRef),
}) {}

export const DiagnosticSeverity = Schema.Literals(["info", "warning", "error", "blocking"])
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type

export class Diagnostic extends Schema.Class<Diagnostic>("Composition.Diagnostic")({
  severity: DiagnosticSeverity,
  code: Schema.String,
  message: Schema.String,
  path: Schema.optional(Schema.String),
  asset: Schema.optional(AssetRef),
}) {}

export const HealthStatus = Schema.Literals(["healthy", "degraded", "broken"])
export type HealthStatus = typeof HealthStatus.Type

export class StaleRevision extends Schema.Class<StaleRevision>("Composition.StaleRevision")({
  kind: Schema.String,
  relativePath: Schema.String,
  expectedRevision: Revision,
  currentRevision: Revision,
}) {}

export class Health extends Schema.Class<Health>("Composition.Health")({
  status: HealthStatus,
  diagnostics: Schema.Array(Diagnostic),
  staleRevisions: Schema.Array(StaleRevision),
}) {}

export const CompositionSource = Schema.Literals(["temporary", "profile"])
export type CompositionSource = typeof CompositionSource.Type

export const Presentation = Schema.Literal("native")
export type Presentation = typeof Presentation.Type

export class TemporaryInput extends Schema.Class<TemporaryInput>("Composition.TemporaryInput")({
  source: Schema.Literal("temporary"),
  profilePath: Schema.optional(Schema.String),
  profileRevision: Schema.optional(Revision),
  agents: Schema.Array(AgentRef),
  bindings: Schema.Record(Consumer, Binding),
  presentation: Presentation,
  requestedCapabilities: Schema.Array(Schema.String),
}) {}

export class ProfileInput extends Schema.Class<ProfileInput>("Composition.ProfileInput")({
  source: Schema.Literal("profile"),
  profilePath: Schema.String,
  profileRevision: Revision,
}) {}

export const CompositionInput = Schema.Union([TemporaryInput, ProfileInput])
export type CompositionInput = typeof CompositionInput.Type

export class FreezeInput extends Schema.Class<FreezeInput>("Composition.FreezeInput")({
  input: CompositionInput,
  sessionID: Schema.optional(Schema.String),
}) {}

export class AgentInfo extends Schema.Class<AgentInfo>("Composition.AgentInfo")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Instruction extends Schema.Class<Instruction>("Composition.Instruction")({
  source: Schema.String,
  content: Schema.String,
}) {}

export class SkillInfo extends Schema.Class<SkillInfo>("Composition.SkillInfo")({
  name: Schema.String,
  description: Schema.String,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export const CapabilityStatus = Schema.Literals(["effective", "denied", "unsupported"])
export type CapabilityStatus = typeof CapabilityStatus.Type

export class CapabilityInfo extends Schema.Class<CapabilityInfo>("Composition.CapabilityInfo")({
  id: Schema.String,
  status: CapabilityStatus,
  reason: Schema.optional(Schema.String),
}) {}

export class Plan extends Schema.Class<Plan>("Composition.Plan")({
  version: Schema.Literal(1),
  digest: Digest,
  valid: Schema.Boolean,
  input: CompositionInput,
  agent: Schema.optional(AgentInfo),
  instructions: Schema.Array(Instruction),
  skills: Schema.Array(SkillInfo),
  capabilities: Schema.Array(CapabilityInfo),
  diagnostics: Schema.Array(Diagnostic),
}) {}

export class SnapshotToolInfo extends Schema.Class<SnapshotToolInfo>("Composition.SnapshotToolInfo")({
  fingerprints: Schema.Array(
    Schema.Struct({
      placement: Schema.String,
      name: Schema.String,
      digest: Digest,
      installationVersion: Schema.String,
    }),
  ),
  catalogDigest: Digest,
  catalog: Schema.Array(Schema.String),
}) {}

export class SnapshotPromptData extends Schema.Class<SnapshotPromptData>("Composition.SnapshotPromptData")({
  relativePath: Schema.String,
  revision: Revision,
  content: Schema.String,
}) {}

export class SnapshotData extends Schema.Class<SnapshotData>("Composition.SnapshotData")({
  agentID: Schema.String,
  instructions: Schema.Array(Instruction),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SkillInfo),
  tools: SnapshotToolInfo,
}) {}

export class Snapshot extends Schema.Class<Snapshot>("Composition.Snapshot")({
  version: Schema.Literal(1),
  digest: Digest,
  sessionID: Schema.optional(Schema.String),
  profilePath: Schema.optional(Schema.String),
  profileRevision: Schema.optional(Revision),
  createdAt: Schema.Finite,
  data: SnapshotData,
}) {}

export class StartInput extends Schema.Class<StartInput>("Composition.StartInput")({
  sessionID: Schema.optional(Schema.String),
  composition: CompositionInput,
  expectedPlanDigest: Schema.optional(Digest),
  title: Schema.optional(Schema.String),
}) {}

export class StartResponse extends Schema.Class<StartResponse>("Composition.StartResponse")({
  session: Session.Info,
  snapshot: Snapshot,
}) {}

export class ResolveError extends Schema.TaggedErrorClass<ResolveError>()("Composition.ResolveError", {
  code: Schema.String,
  message: Schema.String,
  diagnostics: Schema.optional(Schema.Array(Diagnostic)),
}) {}

export * as Composition from "./composition"

