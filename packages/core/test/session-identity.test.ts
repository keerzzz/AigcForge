import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Composition } from "@omnixa/schema/composition"
import { SessionIdentity } from "@omnixa/schema/session-identity"
import { ProductMode } from "@omnixa/schema/product-mode"
import { Agent } from "@omnixa/schema/agent"
import { PermissionTier } from "@omnixa/schema/permission-tier"
import { Schedule } from "@omnixa/schema/schedule"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { AgentAsset } from "@omnixa/core/agent-asset"
import { CommandAsset } from "@omnixa/core/command-asset"
import { Git } from "@omnixa/core/git"
import { MCPAsset } from "@omnixa/core/mcp-asset"
import { MetaAgentService } from "@omnixa/core/meta-agent/service"
import { Permission } from "@omnixa/core/permission"
import { PluginAsset } from "@omnixa/core/plugin-asset"
import { PromptAsset } from "@omnixa/core/prompt-asset"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { WorkArtifact } from "@omnixa/core/session/artifact"
import { SessionComposition } from "@omnixa/core/session/composition"
import { ScheduleService } from "@omnixa/core/session/schedule-service"
import { SessionIdentityProjection } from "@omnixa/core/session/session-identity"
import { SessionStore } from "@omnixa/core/session/store"
import { Workspace } from "@omnixa/core/workspace"
import { SkillAsset } from "@omnixa/core/skill-asset"
// Schema WorkflowAsset uses the unaliased name in this test; the core owner needs the collision alias.
import { WorkflowAsset as WorkflowAssetOwner } from "@omnixa/core/workflow-asset"
import { WorkflowRun } from "@omnixa/core/workflow/workflow-run"
import { testEffect } from "./lib/effect"

const sessionInfo = (input: {
  id?: string
  mode?: ProductMode.ID
  /** null omits the field entirely — the historical-row case. */
  agent?: string | null
  model?: { id: string; providerID: string } | null
  permissionTier?: PermissionTier.ID
  presetCategoryId?: "it-development" | "video-creation" | "academic" | "general-office"
  workspaceID?: string
}) =>
  Schema.decodeUnknownSync(Session.Info)({
    id: input.id ?? "ses_identity_fixture",
    mode: input.mode ?? "coding",
    slug: "identity-fixture",
    version: "dev",
    projectID: "proj_identity",
    ...(input.agent === null ? {} : { agent: input.agent ?? "build" }),
    ...(input.model === null ? {} : { model: input.model ?? { id: "gpt-test", providerID: "omnixa" } }),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    title: "Identity fixture",
    location: {
      directory: "/tmp/omnixa-identity-fixture",
      ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
    },
    permissionTier: input.permissionTier ?? PermissionTier.Default,
    ...(input.presetCategoryId ? { presetCategoryId: input.presetCategoryId } : {}),
  })

const sessionLayer = (session: Session.Info | undefined) =>
  Layer.mock(SessionStore.Service, {
    get: () => Effect.succeed(session),
  })

const permissionLayer = (rules: Permission.Ruleset) =>
  Layer.mock(Permission.Service, {
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

/** A repo whose working-tree root differs from the session directory (subdirectory case). */
const gitLayer = (repo: { directory: string; branch?: string } | undefined) =>
  Layer.succeed(
    Git.Service,
    Git.Service.of({
      repo: {
        discover: () =>
          Effect.succeed(
            repo === undefined
              ? undefined
              : new Git.Repository({
                  worktree: AbsolutePath.make(repo.directory),
                  gitDirectory: AbsolutePath.make(`${repo.directory}/.git`),
                  commonDirectory: AbsolutePath.make(`${repo.directory}/.git`),
                }),
          ),
        clone: () => Effect.die("unused git.repo.clone"),
        create: () => Effect.die("unused git.repo.create"),
      },
      history: {
        branch: () => Effect.succeed(repo?.branch),
        head: () => Effect.succeed(undefined),
        defaultRemoteBranch: () => Effect.succeed(undefined),
        rootCommits: () => Effect.succeed([]),
      },
    } as unknown as Git.Interface),
  )

// The projection only reads each list's length. A sparse `never[]` keeps this
// fixture honest about that boundary without fabricating seven asset shapes.
const assets = (count: number) => Effect.succeed(new Array<never>(count))

const assetLayers = (counts: Partial<Record<SessionIdentity.AssetKind, number>> = {}) =>
  Layer.mergeAll(
    Layer.mock(PromptAsset.Service, { list: () => assets(counts.prompt ?? 0) }),
    Layer.mock(SkillAsset.Service, { list: () => assets(counts.skill ?? 0) }),
    Layer.mock(MCPAsset.Service, { list: () => assets(counts.mcp ?? 0) }),
    Layer.mock(CommandAsset.Service, { list: () => assets(counts.command ?? 0) }),
    Layer.mock(AgentAsset.Service, { list: () => assets(counts.agent ?? 0) }),
    Layer.mock(WorkflowAssetOwner.Service, { list: () => assets(counts.workflow ?? 0) }),
    Layer.mock(PluginAsset.Service, { list: () => assets(counts.plugin ?? 0) }),
  )

const workflowRunLayer = (run: WorkflowAsset.WorkflowRunInfo | undefined) =>
  Layer.mock(WorkflowRun.Service, {
    getBySession: () => Effect.succeed(run),
  })

const artifactOf = (revision: WorkflowAsset.Revision): WorkArtifact.ArtifactSnapshot => ({
  artifact: Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)({
    id: "art_identity_fixture",
    sessionID: "ses_identity_fixture",
    kind: "document",
    title: "Identity artifact",
    mediaType: "text/markdown",
    relativePath: "identity-artifact.md",
    status: "available",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }),
  revision,
})

const workArtifactLayer = (artifact: WorkArtifact.ArtifactSnapshot | undefined) =>
  Layer.mock(WorkArtifact.Service, {
    get: () => Effect.succeed(artifact),
  })

const assistantOwnerLayers = Layer.mergeAll(
  Layer.mock(ScheduleService.Service, {
    list: () => Effect.succeed([] as ReadonlyArray<Schedule.Info>),
  }),
  Layer.mock(ScheduleService.DeliveryService, {
    listInbox: () => Effect.succeed([] as ReadonlyArray<Schedule.Delivery>),
  }),
)

type ProjectionOptions = {
  readonly session?: Session.Info
  readonly rules?: Permission.Ruleset
  readonly snapshot?: Composition.Snapshot
  readonly repo?: { directory: string; branch?: string }
  readonly assetCounts?: Partial<Record<SessionIdentity.AssetKind, number>>
  readonly workflowRun?: WorkflowAsset.WorkflowRunInfo
  readonly artifact?: WorkArtifact.ArtifactSnapshot
  readonly coordination?: SessionIdentity.Coordination
}

const projectionLayer = (options: ProjectionOptions = {}) =>
  SessionIdentityProjection.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        sessionLayer(options.session ?? sessionInfo({})),
        permissionLayer(options.rules ?? askWildcard),
        Layer.mock(MetaAgentService.Service, {
          coordination: () =>
            Effect.succeed(
              options.coordination ?? {
                available: false,
                reasons: [{ code: SessionIdentity.ReasonCodes.metaNotSelected, severity: "info" }],
                selection: { agent: options.session?.agent ?? Agent.ID.make("build") },
              },
            ),
        }),
        gitLayer(options.repo),
        compositionLayer(options.snapshot ?? snapshotOf("a".repeat(64))),
        assetLayers(options.assetCounts),
        workflowRunLayer(options.workflowRun),
        workArtifactLayer(options.artifact),
        assistantOwnerLayers,
      ),
    ),
  )

const workflowRevision = Schema.decodeUnknownSync(WorkflowAsset.Revision)("2".repeat(64))
const artifactRevision = Schema.decodeUnknownSync(WorkflowAsset.Revision)("3".repeat(64))
const directArtifactRevision = Schema.decodeUnknownSync(WorkflowAsset.Revision)("4".repeat(64))
const workflowRun = Schema.decodeUnknownSync(WorkflowAsset.WorkflowRunInfo)({
  id: "run_identity_fixture",
  sessionID: "ses_identity_fixture",
  snapshotDigest: "1".repeat(64),
  workflowName: "identity-workflow",
  workflowRevision,
  status: "running",
  revision: 3,
  timeCreated: 1_700_000_000_000,
  timeUpdated: 1_700_000_000_001,
})

const it = testEffect(projectionLayer())
const itWorkspace = testEffect(projectionLayer({ session: sessionInfo({ workspaceID: "wrk_identity_fixture" }) }))

describe("SessionIdentityProjection", () => {
  it.effect("projects the session's own baseline permission verdict, not a re-derived one", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      expect(identity.permission.declaredTier).toBe(PermissionTier.Default)
      expect(identity.permission.effect).toBe("ask")
      expect(identity.mode).toBe("coding")
      expect(identity.agent).toBe("build")
      expect(identity.coordination).toEqual({
        available: false,
        reasons: [{ code: SessionIdentity.ReasonCodes.metaNotSelected, severity: "info" }],
        selection: { agent: Agent.ID.make("build") },
      })
      expect(identity.model).toEqual({ status: "ready", value: { providerID: "omnixa", modelID: "gpt-test" } })
    }),
  )

  itWorkspace.effect("passes workspaceID through Location when the session owner has it", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      expect(identity.location.directory).toBe(AbsolutePath.make("/tmp/omnixa-identity-fixture"))
      expect(identity.location.workspaceID).toBe(Workspace.ID.make("wrk_identity_fixture"))
    }),
  )

  it.effect("reports both VCS datums as missing for a non-Git location, and stays ready", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "coding") {
        throw new Error("expected a ready coding detail")
      }
      // ADR-23 §3: a non-Git Location reports `missing`, never an empty string and
      // never an unearned `ready`. Identity facts do not degrade the capability.
      expect(identity.detail.detail.vcs.branch.status).toBe("missing")
      expect(identity.detail.detail.vcs.worktree.status).toBe("missing")
      expect(identity.capability.health).toBe("ready")
      expect(identity.capability.reasons).toEqual([])
    }),
  )
})

describe("SessionIdentityProjection: coordination owner", () => {
  const coordination = Schema.decodeUnknownSync(SessionIdentity.Coordination)({
    available: true,
    reasons: [],
    selection: {
      agent: "meta",
      event: { id: "evt_identity_coordination", seq: 4 },
      compositionDigest: "c".repeat(64),
    },
  })
  const itMeta = testEffect(projectionLayer({ session: sessionInfo({ agent: "meta" }), coordination }))

  itMeta.effect("MP01 projects the Meta owner's selection and availability without aggregating mode health", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))
      expect(identity.coordination).toEqual(coordination)
      expect(identity.agent).toBe("meta")
      expect(identity.capability).toEqual({ health: "ready", reasons: [] })
    }),
  )
})

describe("SessionIdentityProjection: Chat detail", () => {
  const itChat = testEffect(
    projectionLayer({
      session: sessionInfo({ mode: "chat", presetCategoryId: "video-creation" }),
      assetCounts: { prompt: 2, skill: 1, plugin: 3 },
    }),
  )

  itChat.effect("counts the seven Location asset owners and never reads presetCategoryId", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "chat") {
        throw new Error("expected a ready chat detail")
      }
      expect(identity.detail.detail.assetCounts).toEqual([
        { kind: "prompt", count: 2 },
        { kind: "skill", count: 1 },
        { kind: "plugin", count: 3 },
      ])
      expect(JSON.stringify(identity)).not.toContain("video-creation")
      expect(identity.capability).toEqual({ health: "ready", reasons: [] })
    }),
  )
})

describe("SessionIdentityProjection: Work detail", () => {
  const itWorkflow = testEffect(
    projectionLayer({
      session: sessionInfo({ mode: "work", presetCategoryId: "general-office" }),
      workflowRun,
      artifact: artifactOf(artifactRevision),
    }),
  )

  itWorkflow.effect("takes workflow revision and artifact revision from the Work owners", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "work") {
        throw new Error("expected a ready work detail")
      }
      expect(identity.detail.detail.contract).toEqual({ source: "workflow", revision: workflowRevision })
      expect(identity.detail.detail.artifact).toEqual({ status: "ready", value: artifactRevision })
      expect(JSON.stringify(identity)).not.toContain("tool catalog")
    }),
  )

  const itAdHoc = testEffect(
    projectionLayer({
      session: sessionInfo({ mode: "work", presetCategoryId: "video-creation" }),
      artifact: artifactOf(directArtifactRevision),
    }),
  )

  itAdHoc.effect("reports ad-hoc when no durable workflow owner exists, even with compatibility metadata", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "work") {
        throw new Error("expected a ready work detail")
      }
      expect(identity.detail.detail.contract).toEqual({ source: "ad-hoc" })
      expect(identity.detail.detail.artifact).toEqual({ status: "ready", value: directArtifactRevision })
      expect(JSON.stringify(identity)).not.toContain("video-creation")
    }),
  )
})

describe("SessionIdentityProjection: Assistant detail", () => {
  const itAssistant = testEffect(projectionLayer({ session: sessionInfo({ mode: "assistant" }) }))

  itAssistant.effect("reads the real reminder owners and keeps Memory/KB explicitly M2-degraded", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "assistant") {
        throw new Error("expected a ready assistant detail")
      }
      expect(identity.detail.detail.scope).toEqual({ kind: "personal" })
      expect(identity.detail.detail.reminders).toEqual({ health: "ready", reasons: [] })
      expect(identity.detail.detail.memory).toEqual({
        health: "degraded",
        reasons: [{ code: SessionIdentity.ReasonCodes.assistantMemoryM2Pending, severity: "info" }],
      })
      expect(identity.detail.detail.knowledge).toEqual({
        health: "degraded",
        reasons: [{ code: SessionIdentity.ReasonCodes.assistantKbM2Pending, severity: "info" }],
      })
      expect(identity.capability).toEqual({
        health: "degraded",
        reasons: [
          { code: SessionIdentity.ReasonCodes.assistantMemoryM2Pending, severity: "info" },
          { code: SessionIdentity.ReasonCodes.assistantKbM2Pending, severity: "info" },
        ],
      })
    }),
  )
})

describe("SessionIdentityProjection: custom gate", () => {
  const itCustom = testEffect(
    projectionLayer({
      session: sessionInfo({ mode: "custom" }),
      rules: allowWildcard,
      snapshot: snapshotOf("b".repeat(64)),
    }),
  )

  itCustom.effect("exposes only the snapshot digest and the policy state, never snapshot contents", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

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
  const itNoAgent = testEffect(projectionLayer({ session: sessionInfo({ agent: null }) }))

  itNoAgent.effect("fails typed instead of fabricating an agent", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const error = yield* projection.project(Session.ID.make("ses_identity_fixture")).pipe(Effect.flip)
      expect(error._tag).toBe("SessionIdentity.IdentityFieldMissing")
    }),
  )
})

describe("SessionIdentityProjection: git-backed coding detail", () => {
  const itRepo = testEffect(
    projectionLayer({
      repo: {
        directory: "/tmp/omnixa-worktree",
        branch: "feature/x",
      },
    }),
  )

  itRepo.effect("takes branch and worktree from the git owner, not from the session directory", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      if (identity.detail.status !== "ready" || identity.detail.detail.source !== "coding") {
        throw new Error("expected a ready coding detail")
      }
      expect(identity.detail.detail.vcs.branch).toEqual({ status: "ready", value: "feature/x" })
      // The repo root, which is NOT the session directory (sessions may live in a subdirectory).
      expect(identity.detail.detail.vcs.worktree).toEqual({ status: "ready", value: "/tmp/omnixa-worktree" })
    }),
  )
})

describe("SessionIdentityProjection: a session with no model yet", () => {
  const itNoModel = testEffect(projectionLayer({ session: sessionInfo({ model: null }) }))

  itNoModel.effect("reports the model as missing without degrading the capability", () =>
    Effect.gen(function* () {
      const projection = yield* SessionIdentityProjection.Service
      const identity = yield* projection.project(Session.ID.make("ses_identity_fixture"))

      // A newly-created session has no model until its first prompt: the datum is
      // honest and, being an identity fact, does not contribute to the capability.
      expect(identity.model).toEqual({ status: "missing" })
      expect(identity.capability.health).toBe("ready")
      expect(identity.capability.reasons).toEqual([])
    }),
  )
})
