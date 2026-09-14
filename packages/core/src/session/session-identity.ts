export * as SessionIdentityProjection from "./session-identity"

import { Context, Effect, Layer, Schema } from "effect"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { Git } from "../git"
import { PermissionV2 } from "../permission"
import { ProductModePolicy } from "../product-mode-policy"
import { SessionV2 } from "../session"
import { SessionComposition } from "./composition"
import { SessionStore } from "./store"

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
 *  - `chat` (asset counts), `work` (contract/artifact) and `assistant`
 *    (scope/reminders) have no owning contract yet, so they report the typed
 *    `mode-detail-not-projected` and the aggregation rule degrades their capability.
 *    Fabricating zero counts, an empty asset list or a ready reminder state is not an
 *    option; those owners belong to S9A/S9B.
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

    const capability = (
      health: SessionIdentity.CapabilityHealth,
      reasons: ReadonlyArray<SessionIdentity.Reason>,
    ): SessionIdentity.Capability => ({ health, reasons: [...reasons] })

    const resolveDetail = Effect.fnUntraced(function* (session: SessionV2.Info) {
      const notProjected = SessionIdentity.ReasonCodes.modeDetailNotProjected

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

      return {
        capability: capability("degraded", [{ code: notProjected, severity: "info" }]),
        detail: { status: "missing" as const, reason: notProjected },
      }
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
        location: { directory: session.location.directory },
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
