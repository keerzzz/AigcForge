export * as SessionIdentityProjection from "./session-identity"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { AgentAsset } from "../agent-asset"
import { CommandAsset } from "../command-asset"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { Git } from "../git"
import { MCPAsset } from "../mcp-asset"
import { PermissionV2 } from "../permission"
import { PluginAsset } from "../plugin-asset"
import { ProductModePolicy } from "../product-mode-policy"
import { PromptAsset } from "../prompt-asset"
import { SessionV2 } from "../session"
import { WorkArtifact } from "./artifact"
import { SessionComposition } from "./composition"
import { ScheduleService } from "./schedule-service"
import { SessionStore } from "./store"
import { SkillAsset } from "../skill-asset"
import { WorkflowAsset } from "../workflow-asset"
import { WorkflowRun } from "../workflow/workflow-run"

/**
 * Read-only SessionProductIdentity projection (ADR-23, S6).
 *
 * It composes existing owners and never re-derives their decisions:
 *  - common fields come from the session row (`SessionStore`);
 *  - `permission.effect` is the session's own baseline rule — `Permission.effectiveRules`
 *    is the owner the tool gate itself uses, and the wildcard verdict
 *    (`evaluate("*", "*", rules)`) is the effect an unlisted action resolves to.
 *    The projection authorizes nothing and copies no algorithm.
 *
 * Mode detail is only claimed where an owner exists TODAY:
 *  - `coding`: both datums come from the git owner — `worktree` is the repo's
 *    working-tree root (which differs from the session directory when a session
 *    lives in a subdirectory) and `branch` is the owner's symbolic-ref read. A
 *    non-Git Location reports BOTH as `missing`, per ADR-23 §3 — never an empty
 *    string and never an unearned `ready`.
 *  - `custom`: snapshot digest plus policy health from the kill switch, both real.
 *  - `chat`: counts come from the seven Location-scoped asset owners; no session
 *    metadata or catalog digest participates.
 *  - `work`: the contract comes from the durable Work contract snapshot when present,
 *    with the WorkflowRun owner retained as a legacy fallback. Artifact identity/revision
 *    comes from WorkArtifact's in-memory owner. `presetCategoryId` is never used as identity.
 *  - `assistant`: the current owner contract is personal schedules/reminders;
 *    Memory and Knowledge remain typed M2-degraded. Project scope is not emitted
 *    because no owner currently persists it.
 */
export interface Interface {
  readonly project: (sessionID: SessionV2.ID) => Effect.Effect<
    SessionIdentity.Identity,
    // SnapshotDecodeError is the composition owner's own failure and is passed
    // through rather than swallowed: a corrupt snapshot is not "no snapshot".
    SessionV2.NotFoundError | IdentityFieldMissing | SnapshotUnavailable | SessionComposition.SnapshotDecodeError
  >
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionIdentityProjection") {}

/** A session with no agent is corrupt data, not a normal state: the projection refuses it. */
export class IdentityFieldMissing extends Schema.TaggedErrorClass<IdentityFieldMissing>()(
  "SessionIdentity.IdentityFieldMissing",
  { sessionID: SessionV2.ID, field: Schema.String },
  { httpApiStatus: 409 },
) {}

/** A custom session whose composition snapshot is gone: an explicit failure, not a fabricated digest. */
export class SnapshotUnavailable extends Schema.TaggedErrorClass<SnapshotUnavailable>()(
  "SessionIdentity.SnapshotUnavailable",
  { sessionID: SessionV2.ID, reason: Schema.String },
  { httpApiStatus: 404 },
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionStore.Service
    const permission = yield* PermissionV2.Service
    const composition = yield* SessionComposition.Service
    const git = yield* Git.Service
    const prompts = yield* Effect.serviceOption(PromptAsset.Service)
    const skills = yield* Effect.serviceOption(SkillAsset.Service)
    const mcps = yield* Effect.serviceOption(MCPAsset.Service)
    const commands = yield* Effect.serviceOption(CommandAsset.Service)
    const agents = yield* Effect.serviceOption(AgentAsset.Service)
    const workflows = yield* Effect.serviceOption(WorkflowAsset.Service)
    const plugins = yield* Effect.serviceOption(PluginAsset.Service)
    const runs = yield* Effect.serviceOption(WorkflowRun.Service)
    const artifacts = yield* Effect.serviceOption(WorkArtifact.Service)
    const schedules = yield* Effect.serviceOption(ScheduleService.Service)
    const deliveries = yield* Effect.serviceOption(ScheduleService.DeliveryService)

    const capability = (
      health: SessionIdentity.CapabilityHealth,
      reasons: ReadonlyArray<SessionIdentity.Reason>,
    ): SessionIdentity.Capability => ({ health, reasons: [...reasons] })

    const resolveDetail = Effect.fnUntraced(function* (session: SessionV2.Info) {
      const notProjected = SessionIdentity.ReasonCodes.modeDetailNotProjected
      const missing = () => ({
        capability: capability("degraded", [{ code: notProjected, severity: "info" as const }]),
        detail: { status: "missing" as const, reason: notProjected },
      })

      if (session.mode === "coding") {
        const repo = yield* git.find(session.location.directory)
        if (!repo) {
          // Non-Git Location: ADR-23 §3 — absent VCS identity is `missing`, and an
          // identity fact never degrades the capability.
          return {
            capability: capability("ready", []),
            detail: {
              status: "ready" as const,
              detail: {
                source: "coding" as const,
                vcs: { branch: { status: "missing" as const }, worktree: { status: "missing" as const } },
              },
            },
          }
        }
        const branchName = yield* git.branch(repo.directory)
        return {
          capability: capability("ready", []),
          detail: {
            status: "ready" as const,
            detail: {
              source: "coding" as const,
              vcs: {
                branch:
                  branchName === undefined
                    ? { status: "missing" as const }
                    : { status: "ready" as const, value: branchName },
                // The owner's working-tree root, not the session directory.
                worktree: { status: "ready" as const, value: repo.directory },
              },
            },
          },
        }
      }

      if (session.mode === "chat") {
        if (
          Option.isNone(prompts) ||
          Option.isNone(skills) ||
          Option.isNone(mcps) ||
          Option.isNone(commands) ||
          Option.isNone(agents) ||
          Option.isNone(workflows) ||
          Option.isNone(plugins)
        ) {
          return missing()
        }
        const [promptList, skillList, mcpList, commandList, agentList, workflowList, pluginList] = yield* Effect.all([
          prompts.value.list(),
          skills.value.list(),
          mcps.value.list(),
          commands.value.list(),
          agents.value.list(),
          workflows.value.list(),
          plugins.value.list(),
        ])
        const assetCounts = [
          { kind: "prompt" as const, count: promptList.length },
          { kind: "skill" as const, count: skillList.length },
          { kind: "mcp" as const, count: mcpList.length },
          { kind: "command" as const, count: commandList.length },
          { kind: "agent" as const, count: agentList.length },
          { kind: "workflow" as const, count: workflowList.length },
          { kind: "plugin" as const, count: pluginList.length },
        ].filter((item) => item.count > 0)
        return {
          capability: capability("ready", []),
          detail: { status: "ready" as const, detail: { source: "chat" as const, assetCounts } },
        }
      }

      if (session.mode === "work") {
        const run = Option.isSome(runs) ? yield* runs.value.getBySession(session.id) : undefined
        const artifact = Option.isSome(artifacts) ? yield* artifacts.value.get(session.id) : undefined
        const contract = session.workContract
          ? session.workContract.source === "preset"
            ? {
                source: "preset" as const,
                revision: { status: "ready" as const, revision: session.workContract.revision },
              }
            : session.workContract.source === "workflow"
              ? { source: "workflow" as const, revision: session.workContract.revision }
              : { source: "ad-hoc" as const }
          : run
            ? { source: "workflow" as const, revision: run.workflowRevision }
            : { source: "ad-hoc" as const }
        return {
          capability: capability("ready", []),
          detail: {
            status: "ready" as const,
            detail: {
              source: "work" as const,
              contract,
              artifact: artifact
                ? { status: "ready" as const, value: artifact.revision }
                : { status: "missing" as const },
            },
          },
        }
      }

      if (session.mode === "assistant") {
        const reminders =
          Option.isSome(schedules) && Option.isSome(deliveries)
            ? yield* Effect.all([schedules.value.list(session.id), deliveries.value.listInbox(session.id)]).pipe(
                Effect.as(capability("ready", [])),
              )
            : capability("degraded", [
                { code: SessionIdentity.ReasonCodes.assistantRemindersUnavailable, severity: "warning" },
              ])
        const memory = capability("degraded", [
          { code: SessionIdentity.ReasonCodes.assistantMemoryM2Pending, severity: "info" },
        ])
        const knowledge = capability("degraded", [
          { code: SessionIdentity.ReasonCodes.assistantKbM2Pending, severity: "info" },
        ])
        const reasons = [reminders, memory, knowledge].flatMap((item) => item.reasons)
        return {
          capability: capability(reminders.health === "blocked" ? "blocked" : "degraded", reasons),
          detail: {
            status: "ready" as const,
            detail: {
              source: "assistant" as const,
              scope: { kind: "personal" as const },
              reminders,
              memory,
              knowledge,
            },
          },
        }
      }

      if (session.mode === "custom") {
        const snapshot = yield* composition
          .get(session.id)
          .pipe(
            Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
              Effect.fail(new SnapshotUnavailable({ sessionID: session.id, reason: error.message })),
            ),
          )
        const policy: SessionIdentity.Capability = ProductModePolicy.isCustomModeEnabled()
          ? { health: "ready", reasons: [] }
          : capability("blocked", [{ code: SessionIdentity.ReasonCodes.customModeDisabled, severity: "warning" }])
        return {
          // A blocked policy contributor forces the top capability to blocked with the
          // same reason folded in — never padded with other reasons.
          capability: policy.health === "blocked" ? policy : capability("ready", []),
          detail: {
            status: "ready" as const,
            detail: { source: "custom" as const, snapshot: { digest: snapshot.digest }, policy },
          },
        }
      }

      return missing()
    })

    const project = Effect.fn("SessionIdentityProjection.project")(function* (sessionID: SessionV2.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionV2.NotFoundError({ sessionID })

      // `agent` is required: a session with no agent is corrupt data. `model` is a
      // datum — a session legitimately has none until its first prompt.
      const agent = session.agent === undefined ? undefined : String(session.agent)
      if (agent === undefined) return yield* new IdentityFieldMissing({ sessionID, field: "agent" })
      const model = session.model

      // Baseline posture only: the wildcard verdict of the session's own effective
      // ruleset. A specific action may resolve differently, and this is not an
      // authorization for anything in particular.
      const rules = yield* permission.effectiveRules(sessionID)
      const effect = PermissionV2.evaluate("*", "*", rules).effect

      const resolved = yield* resolveDetail(session)

      // Decode through the contract instead of asserting a literal: the identity
      // schema carries the aggregation rule as a filter, so this makes ADR-23's
      // rule enforce itself at runtime — a projection that contradicts it dies
      // here rather than shipping an inconsistent capability to consumers.
      return yield* Schema.decodeUnknownEffect(SessionIdentity.Identity)({
        sessionID: session.id,
        mode: session.mode,
        location: {
          directory: session.location.directory,
          ...(session.location.workspaceID ? { workspaceID: session.location.workspaceID } : {}),
        },
        projectID: session.projectID,
        agent,
        model:
          model === undefined
            ? { status: "missing" as const }
            : { status: "ready" as const, value: { providerID: String(model.providerID), modelID: String(model.id) } },
        permission: { declaredTier: session.permissionTier ?? PermissionTier.Default, effect },
        capability: resolved.capability,
        detail: resolved.detail,
      }).pipe(
        Effect.catchTag("SchemaError", (error) =>
          Effect.die(new Error(`Session identity projection violated its contract: ${error.message}`)),
        ),
      )
    })

    return { project } satisfies Interface
  }),
)
