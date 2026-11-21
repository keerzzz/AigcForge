import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { Session } from "./session.js"
import { optional } from "./schema.js"
import { WorkflowAsset } from "./workflow-asset.js"
import { Location } from "./location.js"
import { Model } from "./model.js"
import { ModelGroup } from "./model-group.js"
import { AssetPlacement } from "./asset-placement.js"

// Branded types
export const Digest = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Composition.Digest"),
  Schema.annotate({ identifier: "Composition.Digest" }),
)
export type Digest = typeof Digest.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Composition.Revision"),
)
export type Revision = typeof Revision.Type

export const AllowedKind = Schema.Literals(["agent", "prompt", "skill", "workflow", "command", "mcp"])
export type AllowedKind = typeof AllowedKind.Type

export class BuiltinRoot extends Schema.Class<BuiltinRoot>("Composition.BuiltinRoot")({
  source: Schema.Literal("builtin"),
  id: Schema.Literals(["build", "plan", "meta"]),
  // Previews select an identity; the adopted input carries its captured revision.
  revision: Revision.pipe(optional),
}) {}

export class AgentRef extends Schema.Class<AgentRef>("Composition.AgentRef")({
  kind: Schema.Literal("agent"),
  relativePath: Schema.String,
  revision: Revision,
  target: Schema.Never.pipe(optional),
}) {}

export class AssetRoot extends Schema.Class<AssetRoot>("Composition.AssetRoot")({
  ...AgentRef.fields,
  source: Schema.Literal("asset"),
  id: Agent.ID,
}) {}

export const Root = Schema.Union([BuiltinRoot, AssetRoot])
export type Root = typeof Root.Type

export class PromptRef extends Schema.Class<PromptRef>("Composition.PromptRef")({
  kind: Schema.Literal("prompt"),
  relativePath: Schema.String,
  revision: Revision,
  target: AssetPlacement.Target.pipe(optional),
}) {}

export class SkillRef extends Schema.Class<SkillRef>("Composition.SkillRef")({
  kind: Schema.Literal("skill"),
  relativePath: Schema.String,
  revision: Revision,
  target: AssetPlacement.Target.pipe(optional),
}) {}

export class WorkflowRef extends Schema.Class<WorkflowRef>("Composition.WorkflowRef")({
  kind: Schema.Literal("workflow"),
  relativePath: Schema.String,
  revision: Revision,
  target: Schema.Never.pipe(optional),
}) {}

export class CommandRef extends Schema.Class<CommandRef>("Composition.CommandRef")({
  kind: Schema.Literal("command"),
  relativePath: Schema.String,
  revision: Revision,
  target: AssetPlacement.Target.pipe(optional),
}) {}

export class McpRef extends Schema.Class<McpRef>("Composition.McpRef")({
  kind: Schema.Literal("mcp"),
  relativePath: Schema.String,
  revision: Revision,
  target: Schema.Never.pipe(optional),
}) {}

export const AssetRef = Schema.Union([AgentRef, PromptRef, SkillRef, WorkflowRef, CommandRef, McpRef])
export type AssetRef = typeof AssetRef.Type

// Pure-JS SHA-256 (FIPS 180-4) used for legacy consumer identities in browsers and Core.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  const h: [number, number, number, number, number, number, number, number] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  return h.map((word) => word.toString(16).padStart(8, "0")).join("")
}

/** Returns the stable binding key from an agent name and POSIX asset path. */
export function consumerKeyForAgent(name: string, relativePath: string): string {
  const trimmed = name.trim()

  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return `agents/${trimmed}`
  const base = relativePath.replace(/\/+$/, "").split("/").at(-1) ?? relativePath
  const stem = base.length > 3 && base.endsWith(".md") ? base.slice(0, -3) : base

  const sanitized = stem.replaceAll(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "")

  if (sanitized) return `agents/${sanitized}`

  return `agents/${sha256Hex(`${relativePath}:${name}`).slice(0, 12)}`
}

export const ConsumerKey = Schema.String.pipe(Schema.check(Schema.isPattern(/^(orchestrator|agents\/[a-zA-Z0-9_-]+)$/)))

export const Consumer = ConsumerKey.pipe(Schema.brand("Composition.Consumer"))
export type Consumer = typeof Consumer.Type

/**
 * Effect 4.0.1 Record semantics silently drop entries whose key fails the key schema's
 * refinement (beta.83 failed the decode instead). Composition bindings must fail
 * closed: an unknown consumer is smuggled input, so the decoded key set is
 * re-validated explicitly after decoding with plain string keys.
 */
export const strictBindings = <B extends Schema.Top>(value: B) =>
  Schema.Record(Schema.String, value).pipe(
    Schema.check(
      Schema.makeFilter<Readonly<Record<string, unknown>>>(
        (input) => Object.keys(input).every((key) => /^(orchestrator|agents\/[a-zA-Z0-9_-]+)$/.test(key)),
        {
          message: "Consumer must be 'orchestrator' or 'agents/<agentId>'",
          representation: { id: "aigcfroge/strictConsumerKeys", payload: {} },
          arbitraryConstraint: {} as Record<string, unknown>,
          // Effect 4.0.1 promise-client codegen inlines custom filters; the runtime
          // expression must be self-contained in the generated file's scope.
          toCode: () => ({
            runtime:
              "Schema.makeFilter((input) => Object.keys(input).every((key) => /^(orchestrator|agents\\/[a-zA-Z0-9_-]+)$/.test(key)), { message: \"Consumer must be 'orchestrator' or 'agents/<agentId>'\" })",
          }),
        },
      ),
    ),
  )

export class Binding extends Schema.Class<Binding>("Composition.Binding")({
  prompts: Schema.Array(PromptRef),
  skills: Schema.Array(SkillRef),
  commands: Schema.Array(CommandRef).pipe(
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
  target: AssetPlacement.Target.pipe(optional),
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
  // No default: adding a root while decoding would change historical input digests.
  root: Root.pipe(optional),
  agents: Schema.Array(AgentRef),
  workflow: Schema.optional(WorkflowRef),
  bindings: strictBindings(Binding),
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
  sessionID: Schema.String.pipe(optional),
}) {}

export class AgentInfo extends Schema.Class<AgentInfo>("Composition.AgentInfo")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  relativePath: Schema.String,
  revision: Revision,
  consumerKey: Schema.optional(ConsumerKey),
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
  target: AssetPlacement.Target.pipe(optional),
  // S5 snapshot fidelity: freeze the CommandAsset identity under the asset's own
  // field names, so nothing has to translate on the way in or out. `source` is
  // the command body — it used to be frozen as `template`, which had no reader
  // anywhere (the `command.template` in asset-migration is the V1 config shape,
  // not this class), so that name is gone rather than kept alongside a duplicate.
  //
  // `invocation` is the single legacy discriminator: `CommandAsset.Invocation`
  // requires at least one code point, so a freeze can never produce "". A
  // snapshot written before these fields existed decodes to "" and must fail
  // closed in the runtime instead of inheriting execution ability (D6). There is
  // deliberately no constructor default — new code must supply it, otherwise
  // omitting the field would silently forge that legacy marker, which is the
  // mistake `withDecodingDefaultKey({})` made for `bindings` (D5-A).
  invocation: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  args: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
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
  target: AssetPlacement.Target.pipe(optional),
}) {}

export const CapabilityStatus = Schema.Literals(["effective", "denied", "unsupported"])
export type CapabilityStatus = typeof CapabilityStatus.Type

export class CapabilityInfo extends Schema.Class<CapabilityInfo>("Composition.CapabilityInfo")({
  id: Schema.String,
  status: CapabilityStatus,
  reason: Schema.optional(Schema.String),
}) {}

export class CostPreview extends Schema.Class<CostPreview>("Composition.CostPreview")({
  estimatedTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  maxConcurrency: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(WorkflowAsset.MAX_PARALLEL),
  ),
  effectiveToolCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  agentCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

/** Runtime MCP connection projection; never persisted in a Snapshot. */
export const McpConnectionHealth = Schema.Literals([
  "connecting",
  "ready",
  "degraded",
  "offline",
  "auth-required",
  "revoked",
])
export type McpConnectionHealth = typeof McpConnectionHealth.Type

export class McpRequestedInfo extends Schema.Class<McpRequestedInfo>("Composition.McpRequestedInfo")({
  serverName: Schema.String,
  ref: McpRef,
  credentialRef: Schema.optional(Schema.String),
}) {}

export const McpCredentialStatus = Schema.Literals(["not-required", "available", "missing", "expired", "revoked"])
export type McpCredentialStatus = typeof McpCredentialStatus.Type

export class McpEffectiveInfo extends Schema.Class<McpEffectiveInfo>("Composition.McpEffectiveInfo")({
  serverName: Schema.String,
  ref: McpRef,
  credentialRef: Schema.optional(Schema.String),
  credentialStatus: McpCredentialStatus,
  health: McpConnectionHealth,
  tools: Schema.Array(Schema.String),
}) {}

export class McpDeniedInfo extends Schema.Class<McpDeniedInfo>("Composition.McpDeniedInfo")({
  serverName: Schema.String,
  ref: McpRef,
  credentialRef: Schema.optional(Schema.String),
  reason: Schema.String,
  health: Schema.optional(McpConnectionHealth),
  credentialStatus: Schema.optional(McpCredentialStatus),
}) {}

export class McpPlan extends Schema.Class<McpPlan>("Composition.McpPlan")({
  requested: Schema.Array(McpRequestedInfo),
  effective: Schema.Array(McpEffectiveInfo),
  denied: Schema.Array(McpDeniedInfo),
}) {}

export class Plan extends Schema.Class<Plan>("Composition.Plan")({
  version: Schema.Union([Schema.Literal(1), Schema.Literal(2)]),
  digest: Digest,
  valid: Schema.Boolean,
  input: CompositionInput,
  agent: Schema.optional(AgentInfo),
  orchestrator: Agent.Info.pipe(optional),
  agents: Schema.optional(Schema.Array(AgentInfo)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  workflow: Schema.optional(Schema.NullOr(WorkflowInfo)),
  commands: Schema.Array(CommandInfo).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  instructions: Schema.Array(Instruction),
  skills: Schema.Array(SkillInfo),
  capabilities: Schema.Array(CapabilityInfo),
  costPreview: Schema.optional(CostPreview),
  mcp: McpPlan.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(new McpPlan({ requested: [], effective: [], denied: [] }))),
    Schema.withConstructorDefault(Effect.succeed(new McpPlan({ requested: [], effective: [], denied: [] }))),
  ),
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
  // Historical snapshots omitted the captured definitions. A new freeze must
  // supply them; missing capture cannot authorize future execution.
  capture: Schema.Array(Schema.Json).pipe(optional),
}) {}

export class SnapshotExecutorData extends Schema.Class<SnapshotExecutorData>("Composition.SnapshotExecutorData")({
  id: Agent.ID,
  relativePath: Schema.String,
  revision: Revision,
  info: Agent.Info,
  groupBehavior: ModelGroup.BehaviorSnapshot.pipe(optional),
}) {}

export class SnapshotSkillData extends Schema.Class<SnapshotSkillData>("Composition.SnapshotSkillData")({
  ...SkillInfo.fields,
  // Optional only for historical reads. Missing content differs from a frozen
  // empty body and must block execution rather than reread the current asset.
  content: Schema.String.pipe(optional),
}) {}

export class SnapshotPromptData extends Schema.Class<SnapshotPromptData>("Composition.SnapshotPromptData")({
  relativePath: Schema.String,
  revision: Revision,
  content: Schema.String,
  target: AssetPlacement.Target.pipe(optional),
}) {}

export class SnapshotBindingData extends Schema.Class<SnapshotBindingData>("Composition.SnapshotBindingData")({
  instructions: Schema.Array(Instruction).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SnapshotSkillData),
  commands: Schema.Array(CommandInfo),
}) {}

export class SnapshotMcpBinding extends Schema.Class<SnapshotMcpBinding>("Composition.SnapshotMcpBinding")({
  serverName: Schema.String,
  ref: McpRef,
  credentialRef: Schema.optional(Schema.String),
  // Historical snapshots lack connection identity. New freezes supply it;
  // execution must reject absence rather than adopt the current transport.
  transportFingerprint: Schema.String.pipe(optional),
}) {}

export class SnapshotMcpTool extends Schema.Class<SnapshotMcpTool>("Composition.SnapshotMcpTool")({
  canonicalName: Schema.String,
  serverName: Schema.String,
  ref: McpRef,
}) {}

export class SnapshotMcpInfo extends Schema.Class<SnapshotMcpInfo>("Composition.SnapshotMcpInfo")({
  bindings: Schema.Array(SnapshotMcpBinding),
  tools: Schema.Array(SnapshotMcpTool),
}) {}

export class SnapshotDataV1 extends Schema.Class<SnapshotDataV1>("Composition.SnapshotDataV1")({
  // Optional for historical snapshots whose source must be recovered from durable lifecycle facts.
  sourceLocation: Location.Ref.pipe(optional),
  agentID: Schema.String,
  instructions: Schema.Array(Instruction),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SnapshotSkillData),
  tools: SnapshotToolInfo,
}) {}

export class SnapshotDataV2 extends Schema.Class<SnapshotDataV2>("Composition.SnapshotDataV2")({
  // Copied unchanged when a Session moves or forks; asset paths remain relative to this source.
  sourceLocation: Location.Ref.pipe(optional),
  root: Root.pipe(optional),
  agents: Schema.Array(AgentInfo),
  // Root configuration is independent of the user Agent pool. Historical
  // snapshots without an explicit root retain their original Meta contract.
  orchestrator: Agent.Info.pipe(optional),
  groupBehavior: ModelGroup.BehaviorSnapshot.pipe(optional),
  // Old snapshots remain readable without frozen executor configurations.
  // New freezes supply one per agent; execution must reject missing entries.
  executors: Schema.Array(SnapshotExecutorData).pipe(optional),
  workflow: Schema.optional(Schema.NullOr(WorkflowInfo)),
  bindings: Schema.optional(strictBindings(SnapshotBindingData)),
  maxConcurrency: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(WorkflowAsset.MAX_PARALLEL),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(1)), Schema.withConstructorDefault(Effect.succeed(1))),
  commands: Schema.Array(CommandInfo).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  instructions: Schema.Array(Instruction),
  prompts: Schema.Array(SnapshotPromptData),
  skills: Schema.Array(SnapshotSkillData),
  tools: SnapshotToolInfo,
  mcp: SnapshotMcpInfo.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(new SnapshotMcpInfo({ bindings: [], tools: [] }))),
    Schema.withConstructorDefault(Effect.succeed(new SnapshotMcpInfo({ bindings: [], tools: [] }))),
  ),
}) {}

export const SnapshotData = Schema.Union([SnapshotDataV1, SnapshotDataV2])
export type SnapshotData = typeof SnapshotData.Type

export class SnapshotV1 extends Schema.Class<SnapshotV1>("Composition.SnapshotV1")({
  version: Schema.Literal(1),
  digest: Digest,
  sessionID: Schema.String.pipe(optional),
  profilePath: Schema.String.pipe(optional),
  profileRevision: Revision.pipe(optional),
  createdAt: Schema.Finite,
  data: SnapshotDataV1,
}) {}

export class SnapshotV2 extends Schema.Class<SnapshotV2>("Composition.SnapshotV2")({
  version: Schema.Literal(2),
  digest: Digest,
  sessionID: Schema.String.pipe(optional),
  profilePath: Schema.String.pipe(optional),
  profileRevision: Revision.pipe(optional),
  createdAt: Schema.Finite,
  data: SnapshotDataV2,
}) {}

export const Snapshot = Schema.Union([SnapshotV1, SnapshotV2])
export type Snapshot = typeof Snapshot.Type

export class SnapshotReference extends Schema.Class<SnapshotReference>("Composition.SnapshotReference")({
  sessionID: Session.ID,
  digest: Digest,
  profilePath: Schema.String.pipe(optional),
  title: Schema.String.pipe(optional),
  createdAt: Schema.Finite,
}) {}

export class StartInput extends Schema.Class<StartInput>("Composition.StartInput")({
  sessionID: Schema.optional(Schema.String),
  composition: CompositionInput,
  expectedPlanDigest: Schema.optional(Digest),
  title: Schema.optional(Schema.String),
  model: Model.Selection.pipe(optional),
  executorPreference: Schema.optional(Session.ExecutorPreference),
}) {}

export class UpgradeInput extends Schema.Class<UpgradeInput>("Composition.UpgradeInput")({
  sessionID: Schema.String,
  composition: CompositionInput,
  expectedPlanDigest: Schema.optional(Digest),
  title: Schema.optional(Schema.String),
  model: Model.Selection.pipe(optional),
  executorPreference: Schema.optional(Session.ExecutorPreference),
}) {}

export class StartResponse extends Schema.Class<StartResponse>("Composition.StartResponse")({
  session: Session.Info,
  snapshot: Snapshot,
}) {}

export class ResolveError extends Schema.TaggedError<ResolveError>()("Composition.ResolveError", {
  code: Schema.String,
  message: Schema.String,
  diagnostics: Schema.optional(Schema.Array(Diagnostic)),
}) {}

/**
 * The one comparison behind "every `mcp_` name in the frozen catalog has a
 * matching registration identity". Both the Snapshot loader and the pre-turn
 * drift guard must use THIS function, not their own sort.
 *
 * `catalog` is stored in `localeCompare` order (the resolver sorts fingerprints
 * that way), so the audit list has to be ordered by the same comparator. Sorting
 * one side with the default comparator instead diverges on legal canonical names
 * — `mcp_git_list-files` vs `mcp_git_list_files` order differently under the two
 * — and turns a healthy session into a permanent false-positive drift failure.
 */
export const mcpAuditMatchesCatalog = (input: {
  readonly catalog: ReadonlyArray<string>
  readonly auditToolNames: ReadonlyArray<string>
}) => {
  const catalogMcpTools = input.catalog.filter((name) => name.startsWith("mcp_"))
  const auditMcpTools = input.auditToolNames.toSorted((a, b) => a.localeCompare(b))
  return {
    catalogMcpTools,
    auditMcpTools,
    matches:
      catalogMcpTools.length === auditMcpTools.length &&
      catalogMcpTools.every((name, index) => name === auditMcpTools[index]),
  }
}

export * as Composition from "./composition.js"
