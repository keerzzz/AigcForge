import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { computeDigest } from "@aigcfroge/core/composition/digest"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, SessionComposition.defaultLayer))

const sessionID = SessionV2.ID.make("ses_custom_snapshot_test")
const secondSessionID = SessionV2.ID.make("ses_custom_snapshot_copy_test")

const mockDigest = Schema.decodeUnknownSync(Composition.Digest)(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
)
const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function makeMockSnapshot(sid: string = sessionID): Composition.Snapshot {
  return new Composition.SnapshotV1({
    version: 1,
    digest: mockDigest,
    sessionID: sid,
    profilePath: "custom-profiles/reviewer.yaml",
    profileRevision: mockRevision,
    createdAt: 1700000000000,
    data: new Composition.SnapshotDataV1({
      agentID: "code-reviewer",
      instructions: [
        new Composition.Instruction({
          source: "platform",
          content: "You are a code review assistant.",
        }),
      ],
      prompts: [
        new Composition.SnapshotPromptData({
          relativePath: "prompts/review.md",
          revision: mockRevision,
          content: "Review this diff carefully.",
        }),
      ],
      skills: [
        new Composition.SkillInfo({
          name: "git-diff-analyzer",
          description: "Analyzes git diffs",
          relativePath: "skills/git-diff.md",
          revision: mockRevision,
        }),
      ],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [
          {
            placement: "/project",
            name: "read",
            digest: mockDigest,
            installationVersion: "0.1.0",
          },
        ],
        catalogDigest: mockDigest,
        catalog: ["read"],
      }),
    }),
  })
}

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "custom-test",
      mode: "custom",
      directory: "/project",
      title: "Custom Session",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const sortedFingerprints = [
  { placement: "/project", name: "glob", digest: mockDigest, installationVersion: "0.1.0" },
  { placement: "/project", name: "read", digest: mockDigest, installationVersion: "0.1.0" },
]

// Builds an internally consistent snapshot: catalogDigest recomputed over the
// fingerprints array, catalog equal to the sorted fingerprint names.
function makeConsistentSnapshot(options?: {
  sid?: string
  agentID?: string
  fingerprints?: typeof sortedFingerprints
  catalogDigest?: Composition.Digest
  catalog?: string[]
}): Composition.Snapshot {
  const fingerprints = options?.fingerprints ?? sortedFingerprints
  return new Composition.SnapshotV1({
    version: 1,
    digest: mockDigest,
    sessionID: options?.sid ?? sessionID,
    profilePath: "custom-profiles/reviewer.yaml",
    profileRevision: mockRevision,
    createdAt: 1700000000000,
    data: new Composition.SnapshotDataV1({
      agentID: options?.agentID ?? "code-reviewer",
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints,
        catalogDigest: options?.catalogDigest ?? computeDigest(fingerprints),
        catalog: options?.catalog ?? fingerprints.map((fingerprint) => fingerprint.name),
      }),
    }),
  })
}

describe("SessionComposition", () => {
  it.effect("attaches and reads immutable snapshot for a session", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const snapshot = makeMockSnapshot()

      yield* composition.attach(sessionID, snapshot)

      const retrieved = yield* composition.read(sessionID)
      expect(retrieved).toBeDefined()
      expect(retrieved?.version).toBe(1)
      expect(retrieved?.digest).toBe(mockDigest)
      expect(retrieved?.profilePath).toBe("custom-profiles/reviewer.yaml")
      expect(retrieved?.profileRevision).toBe(mockRevision)
      if (retrieved?.version === 1) {
        expect(retrieved?.data.agentID).toBe("code-reviewer")
        expect(retrieved?.data.prompts.length).toBe(1)
        expect(retrieved?.data.prompts[0].content).toBe("Review this diff carefully.")
        expect(retrieved?.data.skills.length).toBe(1)
        expect(retrieved?.data.tools.catalog).toEqual(["read"])
      }

      const exists = yield* composition.exists(sessionID)
      expect(exists).toBe(true)
    }),
  )

  it.effect("rejects duplicate attach for the same session (immutability)", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const snapshot = makeMockSnapshot()

      yield* composition.attach(sessionID, snapshot)

      const err = yield* composition.attach(sessionID, snapshot).pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionComposition.SnapshotAlreadyExistsError)
    }),
  )

  it.effect("copies snapshot from source session to target session", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      yield* db
        .insert(SessionTable)
        .values({
          id: secondSessionID,
          project_id: Project.ID.global,
          slug: "custom-copy-test",
          mode: "custom",
          directory: "/project",
          title: "Custom Copy Session",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)

      const composition = yield* SessionComposition.Service
      const snapshot = makeMockSnapshot()
      yield* composition.attach(sessionID, snapshot)

      const copied = yield* composition.copy(sessionID, secondSessionID)
      expect(copied.digest).toBe(mockDigest)
      expect(copied.sessionID).toBe(secondSessionID)

      const readCopied = yield* composition.read(secondSessionID)
      expect(readCopied?.digest).toBe(mockDigest)
      expect(readCopied?.sessionID).toBe(secondSessionID)
    }),
  )

  it.effect("cascades deletion when owning session is deleted", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const composition = yield* SessionComposition.Service
      const snapshot = makeMockSnapshot()
      yield* composition.attach(sessionID, snapshot)

      expect(yield* composition.exists(sessionID)).toBe(true)

      // Delete the session
      yield* db.delete(SessionTable).where(require("drizzle-orm").eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)

      expect(yield* composition.exists(sessionID)).toBe(false)
      expect(yield* composition.read(sessionID)).toBeUndefined()
    }),
  )

  it.effect("assertAgentAllowed passes for snapshot agent and rejects unauthorized agents", () =>
    Effect.gen(function* () {
      yield* setup
      const composition = yield* SessionComposition.Service
      const snapshot = makeMockSnapshot()
      yield* composition.attach(sessionID, snapshot)

      // Allowed agent
      yield* composition.assertAgentAllowed(sessionID, "code-reviewer")

      // Forbidden agent
      const err = yield* composition.assertAgentAllowed(sessionID, "other-agent").pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionComposition.AgentDelegationForbiddenError)
    }),
  )

  it.effect("returns SnapshotNotFoundError on get or assertAgentAllowed when snapshot does not exist", () =>
    Effect.gen(function* () {
      yield* setup
      const nonExistentID = SessionV2.ID.make("ses_non_existent")
      const composition = yield* SessionComposition.Service

      const getErr = yield* composition.get(nonExistentID).pipe(Effect.flip)
      expect(getErr).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)

      const assertErr = yield* composition.assertAgentAllowed(nonExistentID, "code-reviewer").pipe(Effect.flip)
      expect(assertErr).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)
    }),
  )

  it.effect("returns SnapshotDecodeError when snapshot row has invalid JSON or unsupported version", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const corruptSessionID = SessionV2.ID.make("ses_corrupt_snapshot")
      yield* db
        .insert(SessionTable)
        .values({
          id: corruptSessionID,
          project_id: Project.ID.global,
          slug: "corrupt",
          mode: "custom",
          directory: "/project",
          title: "Corrupt Snapshot",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)

      // Insert corrupt JSON
      yield* db.run(require("drizzle-orm").sql`
        INSERT INTO session_composition_snapshot (session_id, version, digest, profile_path, profile_revision, data, time_created)
        VALUES ('ses_corrupt_snapshot', 1, ${mockDigest}, 'custom-profiles/test.yaml', ${mockRevision}, 'invalid-json-data', 1000)
      `)

      const composition = yield* SessionComposition.Service
      const err = yield* composition.read(corruptSessionID).pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionComposition.SnapshotDecodeError)

      // Insert unsupported version
      const wrongVersionSessionID = SessionV2.ID.make("ses_wrong_version_snapshot")
      yield* db
        .insert(SessionTable)
        .values({
          id: wrongVersionSessionID,
          project_id: Project.ID.global,
          slug: "wrong-version",
          mode: "custom",
          directory: "/project",
          title: "Wrong Version Snapshot",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)

      yield* db.run(require("drizzle-orm").sql`
        INSERT INTO session_composition_snapshot (session_id, version, digest, profile_path, profile_revision, data, time_created)
        VALUES ('ses_wrong_version_snapshot', 2, ${mockDigest}, 'custom-profiles/test.yaml', ${mockRevision}, '{}', 1000)
      `)

      const verErr = yield* composition.read(wrongVersionSessionID).pipe(Effect.flip)
      expect(verErr).toBeInstanceOf(SessionComposition.SnapshotDecodeError)
    }),
  )

  describe("assertDependency", () => {
    it.effect("passes and returns the snapshot for an internally consistent row", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        const snapshot = makeConsistentSnapshot()
        yield* composition.attach(sessionID, snapshot)

        const verified = yield* composition.assertDependency(sessionID)
        expect(verified.digest).toBe(snapshot.digest)
        expect(verified.data.tools.catalog).toEqual(["glob", "read"])
      }),
    )

    it.effect("fails with SnapshotNotFoundError when no snapshot row exists", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        const err = yield* composition.assertDependency(SessionV2.ID.make("ses_no_snapshot_row")).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)
      }),
    )

    it.effect("fails with DependencyMissingError naming empty_agent_id", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        yield* composition.attach(sessionID, makeConsistentSnapshot({ agentID: "" }))

        const err = yield* composition.assertDependency(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("empty_agent_id")
        }
      }),
    )

    it.effect("fails with DependencyMissingError naming unsorted_tool_fingerprints", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        const fingerprints = [sortedFingerprints[1], sortedFingerprints[0]]
        yield* composition.attach(
          sessionID,
          makeConsistentSnapshot({ fingerprints, catalog: fingerprints.map((fingerprint) => fingerprint.name) }),
        )

        const err = yield* composition.assertDependency(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("unsorted_tool_fingerprints")
        }
      }),
    )

    it.effect("fails with DependencyMissingError naming empty_tool_catalog", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        yield* composition.attach(sessionID, makeConsistentSnapshot({ catalog: [] }))

        const err = yield* composition.assertDependency(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("empty_tool_catalog")
        }
      }),
    )

    it.effect("fails with DependencyMissingError naming tool_catalog_mismatch", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        yield* composition.attach(sessionID, makeConsistentSnapshot({ catalog: ["glob"] }))

        const err = yield* composition.assertDependency(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("tool_catalog_mismatch")
        }
      }),
    )

    it.effect("fails with DependencyMissingError naming tool_catalog_digest_mismatch", () =>
      Effect.gen(function* () {
        yield* setup
        const composition = yield* SessionComposition.Service
        const tamperedDigest = Schema.decodeUnknownSync(Composition.Digest)(
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        )
        yield* composition.attach(sessionID, makeConsistentSnapshot({ catalogDigest: tamperedDigest }))

        const err = yield* composition.assertDependency(sessionID).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("tool_catalog_digest_mismatch")
        }
      }),
    )
  })
})
