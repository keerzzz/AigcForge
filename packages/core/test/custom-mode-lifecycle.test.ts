import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import fs from "fs/promises"
import path from "path"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { computeDigest } from "@aigcfroge/core/composition/digest"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project, ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { ProjectSchema } from "@aigcfroge/core/project/schema"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable, SessionCompositionSnapshotTable } from "@aigcfroge/core/session/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionTask } from "@aigcfroge/core/session/task"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { Config } from "@aigcfroge/core/config"
import { Composition } from "@aigcfroge/schema/composition"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const location = Location.layer({ directory: AbsolutePath.make("/workspace") }).pipe(
  Layer.provide(Project.defaultLayer),
)

const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.succeed([]),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    effectiveRules: () => Effect.succeed([]),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

const mockDigest = Composition.Digest.make("1".repeat(64))
const mockCatalogDigest = Composition.Digest.make("2".repeat(64))

const mockSnapshot = (sessionID: SessionV2.ID, allowedAgentID: string = "custom-coder") =>
  new Composition.Snapshot({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: 1000,
    data: new Composition.SnapshotData({
      agentID: allowedAgentID,
      instructions: [
        new Composition.Instruction({ source: "custom.agent.md", content: "Custom System Instructions" }),
      ],
      prompts: [],
      skills: [
        new Composition.SkillInfo({
          name: "test-skill",
          description: "Skill for testing",
          relativePath: ".aigcfroge/skills/test-skill/SKILL.md",
          revision: Composition.Revision.make("3".repeat(64)),
        }),
      ],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [],
        catalogDigest: mockCatalogDigest,
        catalog: ["read", "glob", "grep"],
      }),
    }),
  })

// Internally consistent snapshot for tests that exercise assertDependency:
// catalogDigest recomputed over the fingerprints array, catalog equal to the
// sorted fingerprint names. (The legacy mockSnapshot above is deliberately NOT
// consistent — never run assertDependency against it.)
const frozenDigest = Composition.Digest.make("4".repeat(64))
const frozenFingerprints = [
  { placement: "/workspace", name: "glob", digest: Composition.Digest.make("5".repeat(64)), installationVersion: "0.1.0" },
  { placement: "/workspace", name: "read", digest: Composition.Digest.make("6".repeat(64)), installationVersion: "0.1.0" },
]
const frozenSnapshot = (sessionID: SessionV2.ID, profilePath?: string) =>
  new Composition.Snapshot({
    version: 1,
    digest: frozenDigest,
    sessionID,
    profilePath,
    createdAt: 1000,
    data: new Composition.SnapshotData({
      agentID: "custom-coder",
      instructions: [new Composition.Instruction({ source: "custom.agent.md", content: "Frozen System Instructions" })],
      prompts: [
        new Composition.SnapshotPromptData({
          relativePath: "prompts/review.md",
          revision: Composition.Revision.make("3".repeat(64)),
          content: "Frozen prompt content captured at freeze time.",
        }),
      ],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: frozenFingerprints,
        catalogDigest: computeDigest(frozenFingerprints),
        catalog: frozenFingerprints.map((fingerprint) => fingerprint.name),
      }),
    }),
  })

const insertCustomSession = Effect.fnUntraced(function* (sessionID: SessionV2.ID, slug: string) {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectSchema.ID.make(`proj_${slug}`), worktree: AbsolutePath.make("/workspace"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      slug,
      version: "1.0.0",
      project_id: ProjectV2.ID.make(`proj_${slug}`),
      directory: AbsolutePath.make("/workspace"),
      title: "Custom Session",
      mode: "custom",
      agent: AgentV2.ID.make("meta"),
      time_created: Date.now(),
      time_updated: Date.now(),
    })
    .run()
    .pipe(Effect.orDie)
})

const sessions = SessionV2.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      EventV2.defaultLayer,
      Database.defaultLayer,
      SessionStore.defaultLayer,
      Project.defaultLayer,
      sessionComposition,
      SessionExecution.noopLayer,
    ),
  ),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionTask.defaultLayer,
    sessionComposition,
    location,
    permission,
    config,
    AgentV2.layer,
    ToolRegistry.defaultLayer,
    sessions,
  ),
)

describe("Custom Mode Lifecycle: Resume, Fork, Move, & Drift Isolation", () => {
  describe("Resume & Snapshot Reconstitution", () => {
    it.effect("reconstitutes snapshot accurately from database on session reload", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_custom_resume_1")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_life_1"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: sessionID,
          slug: "life-slug-1",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_life_1"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        const snapshot = mockSnapshot(sessionID, "custom-coder")
        yield* comp.attach(sessionID, snapshot)

        // Read snapshot back from store
        const loaded = yield* comp.get(sessionID)
        expect(loaded.digest).toBe(snapshot.digest)
        expect(loaded.data.agentID).toBe("custom-coder")
        expect(loaded.data.instructions.length).toBe(1)
        expect(loaded.data.instructions[0].content).toBe("Custom System Instructions")
        expect(loaded.data.skills.length).toBe(1)
        expect(loaded.data.skills[0].name).toBe("test-skill")
        expect(loaded.data.tools.catalog).toEqual(["read", "glob", "grep"])
      }),
    )

    it.effect("fails closed with SnapshotNotFoundError when custom snapshot is missing", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_missing_snap")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_life_2"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: sessionID,
          slug: "life-slug-2",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_life_2"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        const result = yield* comp.get(sessionID).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") {
          const err = yield* comp.get(sessionID).pipe(Effect.flip)
          expect(err._tag).toBe("SessionComposition.SnapshotNotFoundError")
        }
      }),
    )

    it.effect("fails closed with SnapshotDecodeError when snapshot data in DB is corrupted", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_corrupt_snap")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_life_3"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: sessionID,
          slug: "life-slug-3",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_life_3"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        // Insert malformed data into snapshot table
        yield* db.insert(SessionCompositionSnapshotTable).values({
          session_id: sessionID,
          version: 1,
          digest: "not-a-valid-sha256-hex-digest-at-all",
          data: sql`'{"invalid_field": 123}'`,
          time_created: Date.now(),
        }).run().pipe(Effect.orDie)

        const result = yield* comp.get(sessionID).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") {
          const err = yield* comp.get(sessionID).pipe(Effect.flip)
          expect(err._tag).toBe("SessionComposition.SnapshotDecodeError")
        }
      }),
    )

    it.effect("resume rejects an orphaned custom session (no snapshot row) with typed SnapshotNotFoundError", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const sessionID = SessionV2.ID.make("ses_orphan_resume")
        yield* insertCustomSession(sessionID, "life-orphan-resume")

        // Foreign resume id: a custom session without its frozen snapshot must
        // fail closed with a typed error, never run with a widened tool set.
        const err = yield* sessionService.resume(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)
      }),
    )

    it.effect("resume of a non-custom session never consults the snapshot store", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_plain_resume")

        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectSchema.ID.make("proj_life_plain"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({
            id: sessionID,
            slug: "life-plain-resume",
            version: "1.0.0",
            project_id: ProjectV2.ID.make("proj_life_plain"),
            directory: AbsolutePath.make("/workspace"),
            title: "Plain Session",
            mode: "coding",
            agent: AgentV2.ID.make("coder"),
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
          .pipe(Effect.orDie)

        // No snapshot row exists and none is required: the fail-closed gate is
        // scoped to custom sessions (noop execution makes resume a pure gate
        // check here).
        yield* sessionService.resume(sessionID)
      }),
    )
  })

  describe("Child Session Snapshot Inheritance (Fork & Delegation)", () => {
    it.effect("copies exact immutable snapshot from parent custom session to child", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const rootSessionID = SessionV2.ID.make("ses_life_parent")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_life_4"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "life-slug-4",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_life_4"),
          directory: AbsolutePath.make("/workspace"),
          title: "Root Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        const parentSnapshot = mockSnapshot(rootSessionID, "custom-coder")
        yield* comp.attach(rootSessionID, parentSnapshot)

        // Create child session (e.g. from delegation or fork)
        const childSession = yield* sessionService.create({
          id: SessionV2.ID.make("ses_life_child"),
          parentID: rootSessionID,
          agent: AgentV2.ID.make("custom-coder"),
          location: { directory: AbsolutePath.make("/workspace") },
        })

        // Child session inherits identical snapshot digest and data
        const childSnapshot = yield* comp.get(childSession.id)
        expect(childSnapshot.digest).toBe(parentSnapshot.digest)
        expect(childSnapshot.data.agentID).toBe("custom-coder")
        expect(childSnapshot.data.skills).toEqual(parentSnapshot.data.skills)
        expect(childSnapshot.data.instructions).toEqual(parentSnapshot.data.instructions)
        expect(childSnapshot.data.tools.catalog).toEqual(parentSnapshot.data.tools.catalog)
      }),
    )
  })

  describe("On-Disk Profile Drift Isolation", () => {
    it.effect("preserves frozen snapshot in DB even if source files or external state change", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_drift_iso")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_life_5"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: sessionID,
          slug: "life-slug-5",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_life_5"),
          directory: AbsolutePath.make("/workspace"),
          title: "Frozen Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        const originalSnapshot = mockSnapshot(sessionID, "custom-coder")
        yield* comp.attach(sessionID, originalSnapshot)

        // Subsequent session snapshot reads remain strictly identical to frozen snapshot
        const snapshot1 = yield* comp.get(sessionID)
        const snapshot2 = yield* comp.get(sessionID)

        expect(snapshot1.digest).toBe(originalSnapshot.digest)
        expect(snapshot2.digest).toBe(originalSnapshot.digest)
        expect(snapshot1.createdAt).toBe(originalSnapshot.createdAt)
      }),
    )

    it.live("serves the frozen snapshot and resume path from DB after the on-disk profile is deleted", () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        const profileDir = path.join(root.path, "custom-profiles")
        const profilePath = path.join(profileDir, "reviewer.yaml")
        yield* Effect.promise(() => fs.mkdir(path.join(profileDir, "prompts"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(profilePath, "agents: [reviewer]\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(profileDir, "prompts", "review.md"), "Review this diff."))

        const comp = yield* SessionComposition.Service
        const sessionService = yield* SessionV2.Service
        const sessionID = SessionV2.ID.make("ses_profile_deleted")
        yield* insertCustomSession(sessionID, "life-profile-deleted")
        yield* comp.attach(sessionID, frozenSnapshot(sessionID, profilePath))

        // Profile is gone from disk after the session started.
        yield* Effect.promise(() => fs.rm(profileDir, { recursive: true, force: true }))
        expect(yield* Effect.promise(() => Bun.file(profilePath).exists())).toBe(false)

        // Snapshot is a DB row: reads are served from the freeze, not the disk.
        const loaded = yield* comp.get(sessionID)
        expect(loaded.digest).toBe(frozenDigest)
        expect(loaded.profilePath).toBe(profilePath)
        expect(loaded.data.prompts[0].content).toBe("Frozen prompt content captured at freeze time.")
        expect(loaded.data.instructions[0].content).toBe("Frozen System Instructions")

        // Session and history remain readable, and the resume admission gate
        // validates the DB snapshot only (noop execution stops before the
        // runner; the runner's own snapshot read is covered elsewhere).
        expect((yield* sessionService.get(sessionID)).id).toBe(sessionID)
        expect(yield* sessionService.messages({ sessionID })).toEqual([])
        yield* sessionService.resume(sessionID)
      }),
    )

    it.live("zero-drift: modifying the on-disk profile after start never alters the served snapshot", () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        const profileDir = path.join(root.path, "custom-profiles")
        const profilePath = path.join(profileDir, "reviewer.yaml")
        yield* Effect.promise(() => fs.mkdir(profileDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(profilePath, "agents: [reviewer]\n"))

        const comp = yield* SessionComposition.Service
        const sessionService = yield* SessionV2.Service
        const sessionID = SessionV2.ID.make("ses_profile_modified")
        yield* insertCustomSession(sessionID, "life-profile-modified")
        yield* comp.attach(sessionID, frozenSnapshot(sessionID, profilePath))

        // Real on-disk modification after start: rewritten and new files.
        yield* Effect.promise(() => fs.writeFile(profilePath, "agents: [someone-else]\n# rewritten"))
        yield* Effect.promise(() => fs.writeFile(path.join(profileDir, "extra.md"), "late addition"))

        // INTENTIONAL SEMANTICS (do not "fix"): a started custom session is a
        // frozen replay. The served snapshot content and digest are pinned at
        // freeze time, and assertDependency validates internal consistency of
        // the stored row — never the on-disk state. Drift detection across
        // freeze boundaries is a separate planned concern.
        const loaded = yield* comp.get(sessionID)
        expect(loaded.digest).toBe(frozenDigest)
        expect(loaded.data.agentID).toBe("custom-coder")
        expect(loaded.data.prompts[0].content).toBe("Frozen prompt content captured at freeze time.")
        yield* comp.assertDependency(sessionID)
        yield* sessionService.resume(sessionID)
      }),
    )
  })
})
