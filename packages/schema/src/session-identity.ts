export * as SessionIdentity from "./session-identity"

import { Schema } from "effect"
import { Composition } from "./composition"
import { Location } from "./location"
import { Permission } from "./permission"
import { PermissionTier } from "./permission-tier"
import { ProductMode } from "./product-mode"
import { Project } from "./project"
import { SessionID } from "./session-id"
import { WorkflowAsset } from "./workflow-asset"

// ── §2 status vocabulary (ADR-23) ────────────────────────────────────────────
// Two layers, one rule: a datum that is not `ready` degrades the capability it
// contributes to; `blocked` is policy-level and independent of data.

/**
 * Datum-level availability. `ready` carries `value`. `missing` means the owner
 * has no data for this session (e.g. a historical session that predates the
 * detail owner). `unsupported` means the datum is deferred by design and always
 * carries a stable reason code (e.g. WorkPreset revision before S9A).
 */
export const DatumStatus = Schema.Literals(["ready", "missing", "unsupported"]).annotate({
  identifier: "SessionIdentity.DatumStatus",
})
export type DatumStatus = typeof DatumStatus.Type

/**
 * Capability-level health. `blocked` is fail-closed by policy (custom kill
 * switch, capability header mismatch); `degraded` always carries typed reasons.
 */
export const CapabilityHealth = Schema.Literals(["ready", "degraded", "blocked"]).annotate({
  identifier: "SessionIdentity.CapabilityHealth",
})
export type CapabilityHealth = typeof CapabilityHealth.Type

/**
 * Stable protocol reason codes: kebab-case, never localized. Display text is a
 * consumer concern resolved through i18n; this code is the contract.
 */
export const ReasonCode = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
  Schema.brand("SessionIdentity.ReasonCode"),
)
export type ReasonCode = typeof ReasonCode.Type

/** Stable protocol action codes for recovery entry points, same rules as reason codes. */
export const ActionCode = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
  Schema.brand("SessionIdentity.ActionCode"),
)
export type ActionCode = typeof ActionCode.Type

export const ReasonSeverity = Schema.Literals(["info", "warning", "critical"]).annotate({
  identifier: "SessionIdentity.ReasonSeverity",
})
export type ReasonSeverity = typeof ReasonSeverity.Type

export const Reason = Schema.Struct({
  code: ReasonCode,
  severity: ReasonSeverity,
  action: Schema.optional(ActionCode),
}).annotate({ identifier: "SessionIdentity.Reason" })
export type Reason = typeof Reason.Type

/** The reason codes this projection emits today. Extending is additive; renaming is a protocol break. */
const code = (value: string): ReasonCode => Schema.decodeSync(ReasonCode)(value)
export const ReasonCodes = {
  modeDetailNotProjected: code("mode-detail-not-projected"),
  workPresetRevisionPending: code("work-preset-revision-pending"),
  assistantRemindersUnavailable: code("assistant-reminders-unavailable"),
  assistantMemoryM2Pending: code("assistant-memory-m2-pending"),
  assistantKbM2Pending: code("assistant-kb-m2-pending"),
  customModeDisabled: code("custom-mode-disabled"),
} as const

export const Capability = Schema.Struct({
  health: CapabilityHealth,
  reasons: Schema.Array(Reason),
}).annotate({ identifier: "SessionIdentity.Capability" })
export type Capability = typeof Capability.Type

/**
 * Wraps a value schema in the datum availability union. The `ready` branch is
 * the only one that carries a value, so consumers cannot mistake absence for an
 * empty string or an inferred default.
 */
export const datum = <S extends Schema.Top>(value: S, identifier: string) =>
  Schema.Union([
    Schema.Struct({ status: Schema.Literal("ready"), value }).annotate({ identifier: `${identifier}.Ready` }),
    Schema.Struct({ status: Schema.Literal("missing") }).annotate({ identifier: `${identifier}.Missing` }),
    Schema.Struct({ status: Schema.Literal("unsupported"), reason: ReasonCode }).annotate({
      identifier: `${identifier}.Unsupported`,
    }),
  ]).annotate({ identifier })

// ── §4.1 work contract (D3, three-way by source) ────────────────────────────
// WorkflowAsset already owns a real revision (YAML SHA-256), so workflow-sourced
// sessions are ready today. The preset revision is a S9A schema field; until it
// lands the preset branch reports `unsupported` with a stable reason instead of
// pretending the whole contract is unavailable. Ad-hoc sessions say so.

export const PresetRevision = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), revision: WorkflowAsset.Revision }).annotate({
    identifier: "SessionIdentity.PresetRevision.Ready",
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), reason: ReasonCode }).annotate({
    identifier: "SessionIdentity.PresetRevision.Unsupported",
  }),
]).annotate({ identifier: "SessionIdentity.PresetRevision" })
export type PresetRevision = typeof PresetRevision.Type

export const WorkContract = Schema.Union([
  Schema.Struct({ source: Schema.Literal("workflow"), revision: WorkflowAsset.Revision }).annotate({
    identifier: "SessionIdentity.WorkContract.Workflow",
  }),
  Schema.Struct({ source: Schema.Literal("preset"), revision: PresetRevision }).annotate({
    identifier: "SessionIdentity.WorkContract.Preset",
  }),
  Schema.Struct({ source: Schema.Literal("ad-hoc") }).annotate({
    identifier: "SessionIdentity.WorkContract.AdHoc",
  }),
]).annotate({ identifier: "SessionIdentity.WorkContract" })
export type WorkContract = typeof WorkContract.Type

// ── §4.2 mode details (five discriminants) ───────────────────────────────────

export const AssetKind = Schema.Literals(["prompt", "skill", "mcp", "command", "agent", "workflow", "plugin"]).annotate(
  {
    identifier: "SessionIdentity.AssetKind",
  },
)
export type AssetKind = typeof AssetKind.Type

export const AssetCount = Schema.Struct({
  kind: AssetKind,
  count: Schema.Finite,
}).annotate({ identifier: "SessionIdentity.AssetCount" })
export type AssetCount = typeof AssetCount.Type

export const AssistantScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("personal") }).annotate({
    identifier: "SessionIdentity.AssistantScope.Personal",
  }),
  Schema.Struct({ kind: Schema.Literal("project"), projectID: Project.ID }).annotate({
    identifier: "SessionIdentity.AssistantScope.Project",
  }),
]).annotate({ identifier: "SessionIdentity.AssistantScope" })
export type AssistantScope = typeof AssistantScope.Type

/** Reference-only: the digest points into the composition snapshot store. No instruction or credential content exists on this type. */
export const SnapshotRef = Schema.Struct({
  digest: Composition.Digest,
}).annotate({ identifier: "SessionIdentity.SnapshotRef" })
export type SnapshotRef = typeof SnapshotRef.Type

export const ModeDetail = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("coding"),
    vcs: Schema.Struct({
      branch: datum(Schema.String, "SessionIdentity.Coding.Branch"),
      worktree: datum(Schema.String, "SessionIdentity.Coding.Worktree"),
    }).annotate({ identifier: "SessionIdentity.Coding.Vcs" }),
  }).annotate({ identifier: "SessionIdentity.ModeDetail.Coding" }),
  Schema.Struct({
    source: Schema.Literal("chat"),
    assetCounts: Schema.Array(AssetCount),
  }).annotate({ identifier: "SessionIdentity.ModeDetail.Chat" }),
  Schema.Struct({
    source: Schema.Literal("work"),
    contract: WorkContract,
    artifact: datum(WorkflowAsset.Revision, "SessionIdentity.Work.Artifact"),
  }).annotate({ identifier: "SessionIdentity.ModeDetail.Work" }),
  Schema.Struct({
    source: Schema.Literal("assistant"),
    scope: AssistantScope,
    reminders: Capability,
    memory: Capability,
    knowledge: Capability,
  }).annotate({ identifier: "SessionIdentity.ModeDetail.Assistant" }),
  Schema.Struct({
    source: Schema.Literal("custom"),
    snapshot: SnapshotRef,
    policy: Capability,
  }).annotate({ identifier: "SessionIdentity.ModeDetail.Custom" }),
]).annotate({ identifier: "SessionIdentity.ModeDetail" })
export type ModeDetail = typeof ModeDetail.Type

/** Historical sessions may predate their detail owner; absence is typed, never a fabricated detail. */
export const ModeDetailAvailability = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), detail: ModeDetail }).annotate({
    identifier: "SessionIdentity.ModeDetailAvailability.Ready",
  }),
  Schema.Struct({ status: Schema.Literal("missing"), reason: ReasonCode }).annotate({
    identifier: "SessionIdentity.ModeDetailAvailability.Missing",
  }),
]).annotate({ identifier: "SessionIdentity.ModeDetailAvailability" })
export type ModeDetailAvailability = typeof ModeDetailAvailability.Type

// ── §4.3 identity projection ─────────────────────────────────────────────────

const IdentityStruct = Schema.Struct({
  sessionID: SessionID.ID,
  mode: ProductMode.ID,
  location: Location.Ref,
  projectID: Project.ID,
  agent: Schema.String,
  /**
   * A session legitimately carries no model until its first prompt sets one, so
   * `model` is a datum (S6 amendment, Owner ruling 2026-09-15). It is an
   * **identity fact and does NOT contribute** to the aggregation rule: a
   * newly-created session would otherwise show a degraded capability for every
   * Header, drowning the real signals. `agent` stays required — a session with no
   * agent is corrupt data, not a normal state.
   */
  model: datum(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }).annotate({ identifier: "SessionIdentity.Model" }),
    "SessionIdentity.ModelRef",
  ),
  permission: Schema.Struct({
    declaredTier: PermissionTier.ID,
    /** Redacted summary computed by the existing PermissionEffective owner; the projection never re-derives authorization. */
    effect: Permission.Effect,
  }).annotate({ identifier: "SessionIdentity.Permission" }),
  capability: Capability,
  detail: ModeDetailAvailability,
})
export type IdentityStruct = typeof IdentityStruct.Type

/**
 * Reason codes of every contributing datum/capability that is not ready — the
 * ADR-23 §1 contribution map. Coding VCS, work artifact, and chat asset counts
 * are identity facts, NOT contributors: absence there is a normal state, not a
 * degradation.
 */
const contributorCodes = (identity: IdentityStruct): Array<ReasonCode> => {
  if (identity.detail.status === "missing") return [identity.detail.reason]
  const codes: Array<ReasonCode> = []
  const detail = identity.detail.detail
  if (
    detail.source === "work" &&
    detail.contract.source === "preset" &&
    detail.contract.revision.status === "unsupported"
  ) {
    codes.push(detail.contract.revision.reason)
  }
  if (detail.source === "assistant") {
    for (const capability of [detail.reminders, detail.memory, detail.knowledge]) {
      if (capability.health !== "ready") codes.push(...capability.reasons.map((reason) => reason.code))
    }
  }
  if (detail.source === "custom" && detail.policy.health !== "ready") {
    codes.push(...detail.policy.reasons.map((reason) => reason.code))
  }
  return codes
}

/**
 * Health floor implied by contributors: a blocked contributor forces the top
 * capability to blocked; any other non-ready contributor only forces degraded.
 */
const contributorFloor = (identity: IdentityStruct): CapabilityHealth => {
  if (identity.detail.status === "ready") {
    const detail = identity.detail.detail
    if (detail.source === "assistant") {
      const capabilities = [detail.reminders, detail.memory, detail.knowledge]
      if (capabilities.some((capability) => capability.health === "blocked")) return "blocked"
    }
    if (detail.source === "custom" && detail.policy.health === "blocked") return "blocked"
  }
  return "degraded"
}

const HEALTH_ORDER: Record<CapabilityHealth, 0 | 1 | 2> = { ready: 0, degraded: 1, blocked: 2 }

export const Identity = IdentityStruct.pipe(
  Schema.check(
    Schema.makeFilter(
      (identity: IdentityStruct) => {
        if (identity.detail.status !== "ready") return true
        return identity.detail.detail.source === identity.mode
      },
      { message: "Mode detail source must match the identity mode" },
    ),
  ),
  Schema.check(
    Schema.makeFilter(
      (identity: IdentityStruct) => {
        const codes = contributorCodes(identity)
        if (codes.length === 0) return true
        if (identity.capability.health === "ready") return false
        if (HEALTH_ORDER[identity.capability.health] < HEALTH_ORDER[contributorFloor(identity)]) return false
        const folded = new Set(identity.capability.reasons.map((reason) => reason.code))
        return codes.every((reasonCode) => folded.has(reasonCode))
      },
      {
        message:
          "Capability must fold non-ready contributors: health at the contributor floor (degraded, or blocked when a contributor is blocked) with every contributor reason code folded into reasons",
      },
    ),
  ),
).annotate({ identifier: "SessionIdentity.Identity" })
export type Identity = typeof Identity.Type
