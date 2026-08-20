import { Effect, Schema } from "effect"
import { Session } from "./session"
import { WorkflowAsset } from "./workflow-asset"

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

export const AllowedKind = Schema.Literals(["agent", "prompt", "skill", "workflow", "command"])
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

export class WorkflowRef extends Schema.Class<WorkflowRef>("Composition.WorkflowRef")({
  kind: Schema.Literal("workflow"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class CommandRef extends Schema.Class<CommandRef>("Composition.CommandRef")({
  kind: Schema.Literal("command"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class McpRef extends Schema.Class<McpRef>("Composition.McpRef")({
  kind: Schema.Literal("mcp"),
  relativePath: Schema.String,
  revision: Revision,
}) {}

export const AssetRef = Schema.Union([AgentRef, PromptRef, SkillRef, WorkflowRef, CommandRef])
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
  commands: Schema.optional(Schema.Array(CommandRef)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
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
  workflow: Schema.optional(WorkflowRef),
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

export class WorkflowInfo extends Schema.Class<WorkflowInfo>("Composition.WorkflowInfo")({
  name: Schema.String,
  description: Schema.String,
  relativePath: Schema.String,
  revision: Revision,
  steps: Schema.Array(WorkflowAsset.StepDef),
}) {}

export class CommandInfo extends Schema.Class<CommandInfo>("Composition.CommandInfo")({
  name: Schema.String,
  description: Schema.String,
  relativePath: Schema.String,
  revision: Revision,
  template: Schema.String,
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

export class CostPreview extends Schema.Class<CostPreview>("Composition.CostPreview")({
  estimatedTokens: Schema.Number,
  maxConcurrency: Schema.Number,
  effectiveToolCount: Schema.Number,
  agentCount: Schema.Number,
}) {}

export class Plan extends Schema.Class<Plan>("Composition.Plan")({
  version: Schema.Union([Schema.Literal(1), Schema.Literal(2)]),
  digest: Digest,
  valid: Schema.Boolean,
  input: CompositionInput,
  agent: Schema.optional(AgentInfo),
  agents: Schema.optional(Schema.Array(AgentInfo)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  workflow: Schema.optional(WorkflowInfo),
  commands: Schema.optional(Schema.Array(CommandInfo)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  instructions: Schema.Array(Instruction),
  skills: Schema.Array(SkillInfo),
  capabilities: Schema.Array(CapabilityInfo),
  costPreview: Schema.optional(CostPreview),
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

export class SnapshotDataV1 extends Schema.Class<SnapshotDataV1>("Composition.SnapshotDataV1")({
  agentID: Schema.String,
  instructions: Schema.Array(Instruction),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SkillInfo),
  tools: SnapshotToolInfo,
}) {}

export class SnapshotDataV2 extends Schema.Class<SnapshotDataV2>("Composition.SnapshotDataV2")({
  agents: Schema.Array(AgentInfo),
  workflow: Schema.optional(WorkflowInfo),
  commands: Schema.optional(Schema.Array(CommandInfo)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  instructions: Schema.Array(Instruction),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SkillInfo),
  tools: SnapshotToolInfo,
}) {}

export const SnapshotData = Schema.Union([SnapshotDataV1, SnapshotDataV2])
export type SnapshotData = typeof SnapshotData.Type

export class SnapshotV1 extends Schema.Class<SnapshotV1>("Composition.SnapshotV1")({
  version: Schema.Literal(1),
  digest: Digest,
  sessionID: Schema.optional(Schema.String),
  profilePath: Schema.optional(Schema.String),
  profileRevision: Schema.optional(Revision),
  createdAt: Schema.Finite,
  data: SnapshotDataV1,
}) {}

export class SnapshotV2 extends Schema.Class<SnapshotV2>("Composition.SnapshotV2")({
  version: Schema.Literal(2),
  digest: Digest,
  sessionID: Schema.optional(Schema.String),
  profilePath: Schema.optional(Schema.String),
  profileRevision: Schema.optional(Revision),
  createdAt: Schema.Finite,
  data: SnapshotDataV2,
}) {}

export const Snapshot = Schema.Union([SnapshotV1, SnapshotV2])
export type Snapshot = typeof Snapshot.Type

export class StartInput extends Schema.Class<StartInput>("Composition.StartInput")({
  sessionID: Schema.optional(Schema.String),
  composition: CompositionInput,
  expectedPlanDigest: Schema.optional(Digest),
  title: Schema.optional(Schema.String),
}) {}

export class UpgradeInput extends Schema.Class<UpgradeInput>("Composition.UpgradeInput")({
  sessionID: Schema.String,
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
