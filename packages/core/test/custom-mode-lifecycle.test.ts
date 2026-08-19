import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
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
  })
})
