import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { Permission } from "@aigcfroge/schema/permission"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionIdentityProjection } from "@aigcfroge/core/session/session-identity"
import { SessionStore } from "@aigcfroge/core/session/store"
import { testEffect } from "./lib/effect"

const sessionInfo = (input: {
  id?: string
  mode?: ProductMode.ID
  /** null omits the field entirely — the historical-row case. */
  agent?: string | null
  model?: { id: string; providerID: string } | null
  permissionTier?: PermissionTier.ID
}) =>
  Schema.decodeUnknownSync(SessionV2.Info)({
    id: input.id ?? "ses_identity_fixture",
    mode: input.mode ?? "coding",
    slug: "identity-fixture",
    version: "dev",
    projectID: "proj_identity",
    ...(input.agent === null ? {} : { agent: input.agent ?? "build" }),
    ...(input.model === null ? {} : { model: input.model ?? { id: "gpt-test", providerID: "aigcfroge" } }),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    title: "Identity fixture",
    location: { directory: "/tmp/aigcfroge-identity-fixture" },
    permissionTier: input.permissionTier ?? PermissionTier.Default,
  })

const sessionLayer = (session: SessionV2.Info | undefined) =>
  Layer.mock(SessionStore.Service, {
    get: () => Effect.succeed(session),
  })

const permissionLayer = (rules: Permission.Ruleset) =>
  Layer.mock(PermissionV2.Service, {
    effectiveRules: () => Effect.succeed(rules),
  })

const snapshotOf = (digest: string) =>
  new Composition.SnapshotV1({
    version: 1,
    digest: Composition.Digest.make(digest),
    sessionID: "ses_identity_fixture",
    createdAt: 1_700_000_000_000,
    data: new Composition.SnapshotDataV1({
      agentID: "meta",
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [],
        catalogDigest: Composition.Digest.make("d".repeat(64)),
        catalog: [],
      }),
    }),
  })

const compositionLayer = (snapshot: Composition.Snapshot) =>
  Layer.mock(SessionComposition.Service, {
    get: () => Effect.succeed(snapshot),
  })

const askWildcard: Permission.Ruleset = [{ action: "*", resource: "*", effect: "ask" }]
const allowWildcard: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]

const projectionLayer = (
  session: SessionV2.Info | undefined,
  rules: Permission.Ruleset,
  snapshot?: Composition.Snapshot,
) =>
  SessionIdentityProjection.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        sessionLayer(session),
        permissionLayer(rules),
        // Only consulted for custom sessions; a default keeps the other cases honest.
        compositionLayer(snapshot ?? snapshotOf("a".repeat(64))),
      ),
    ),
  )

const it = testEffect(projectionLayer(sessionInfo({}), askWildcard))

describe("SessionIdentityProjection", () => {
  it.effect("projects the session's own baseline permission verdict, not a re-derived one", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(SessionV2.ID.make("ses_identity_fixture"))

      expect(identity.permission.declaredTier).toBe(PermissionTier.Default)
      expect(identity.permission.effect).toBe("ask")
      expect(identity.mode).toBe("coding")
      expect(identity.agent).toBe("build")
      expect(identity.model).toEqual({ providerID: "aigcfroge", modelID: "gpt-test" })
    }),
  )

  it.effect("keeps a coding session ready while its VCS datum is missing (identity facts do not degrade)", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(SessionV2.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "coding") {
        throw new Error("expected a ready coding detail")
      }
      expect(identity.detail.detail.vcs.branch.status).toBe("missing")
      expect(identity.detail.detail.vcs.worktree.status).toBe("ready")
      expect(identity.capability.health).toBe("ready")
      expect(identity.capability.reasons).toEqual([])
    }),
  )
})

describe("SessionIdentityProjection: historical session without a detail owner", () => {
  const itHistoric = testEffect(projectionLayer(sessionInfo({ mode: "chat" }), askWildcard))

  itHistoric.effect("reports typed missing and folds mode-detail-not-projected into the capability", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(SessionV2.ID.make("ses_identity_fixture"))

      expect(identity.detail.status).toBe("missing")
      if (identity.detail.status !== "missing") throw new Error("expected a missing detail")
      expect(identity.detail.reason).toBe(SessionIdentity.ReasonCodes.modeDetailNotProjected)
      expect(identity.capability.health).toBe("degraded")
      expect(identity.capability.reasons.map((reason) => reason.code)).toEqual([
        SessionIdentity.ReasonCodes.modeDetailNotProjected,
      ])
    }),
  )

  itHistoric.effect("does not fabricate asset counts for a chat session with no asset owner", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(SessionV2.ID.make("ses_identity_fixture"))

      expect(JSON.stringify(identity)).not.toContain("assetCounts")
    }),
  )
})

describe("SessionIdentityProjection: custom gate", () => {
  const itCustom = testEffect(
    projectionLayer(sessionInfo({ mode: "custom" }), allowWildcard, snapshotOf("b".repeat(64))),
  )

  itCustom.effect("exposes only the snapshot digest and the policy state, never snapshot contents", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(SessionV2.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "custom") {
        throw new Error("expected a ready custom detail")
      }
      // Branded digest: build the expected value through its schema (plain strings
      // do not satisfy `toEqual`'s expected-side type).
      expect(identity.detail.detail.snapshot).toEqual({ digest: Composition.Digest.make("b".repeat(64)) })
      // The kill switch is off in tests, so the policy contributor is blocked and
      // the top capability must be blocked with EXACTLY that reason — no padding.
      expect(identity.detail.detail.policy.health).toBe("blocked")
      expect(identity.capability.health).toBe("blocked")
      expect(identity.capability.reasons.map((reason) => reason.code)).toEqual([
        SessionIdentity.ReasonCodes.customModeDisabled,
      ])
    }),
  )
})

describe("SessionIdentityProjection: rows missing a required identity field", () => {
  const itNoAgent = testEffect(projectionLayer(sessionInfo({ agent: null }), askWildcard))

  itNoAgent.effect("fails typed instead of fabricating an agent", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const error = yield* projection.project(SessionV2.ID.make("ses_identity_fixture")).pipe(Effect.flip)
      expect(error._tag).toBe("SessionIdentity.IdentityFieldMissing")
    }),
  )
})
