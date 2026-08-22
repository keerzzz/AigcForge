import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Result, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { AgentV2 } from "@aigcfroge/core/agent"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionTable, SessionCompositionSnapshotTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const mockDigest = Schema.decodeUnknownSync(Composition.Digest)(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
)
const otherDigest = Schema.decodeUnknownSync(Composition.Digest)(
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
)
const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function makeMockSnapshot(sessionID: string, digest = mockDigest): Composition.Snapshot {
  return new Composition.SnapshotV1({
    version: 1,
    digest,
    sessionID,
    profilePath: "custom-profiles/reviewer.yaml",
    profileRevision: mockRevision,
    createdAt: 1700000000000,
    data: new Composition.SnapshotDataV1({
      agentID: "code-reviewer",
      instructions: [
        new Composition.Instruction({
          source: "agent:code-reviewer",
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

const mockCompositionInput: Composition.CompositionInput = new Composition.TemporaryInput({
  source: "temporary",
  agents: [
    new Composition.AgentRef({
      kind: "agent",
      relativePath: "agents/code-reviewer.md",
      revision: mockRevision,
    }),
  ],
  bindings: {
    [Schema.decodeUnknownSync(Composition.Consumer)("orchestrator")]: new Composition.Binding({
      prompts: [
        new Composition.PromptRef({
          kind: "prompt",
          relativePath: "prompts/review.md",
          revision: mockRevision,
        }),
      ],
      skills: [
        new Composition.SkillRef({
          kind: "skill",
          relativePath: "skills/git-diff.md",
          revision: mockRevision,
        }),
      ],
    }),
  },
  presentation: "native",
  requestedCapabilities: ["workspace.read"],
})

let nextFreezeDigest = mockDigest

const assertTypedConflict = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return
  const found = Cause.findFail(exit.cause)
  expect(Result.isSuccess(found)).toBe(true)
  if (Result.isSuccess(found)) expect(found.success.error).toBeInstanceOf(SessionV2.PromptConflictError)
}

const mockResolver = Layer.succeed(
  CompositionResolver.Service,
  CompositionResolver.Service.of({
    resolve: () => Effect.die("not implemented"),
    checkHealth: () => Effect.die("not implemented"),
    findReferencingProfiles: () => Effect.succeed([]),
    freeze: (input) => Effect.succeed(makeMockSnapshot(input.sessionID ?? "ses_test", nextFreezeDigest)),
  }),
)

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(SessionExecution.noopLayer),
  Layer.provide(mockResolver),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    SessionComposition.defaultLayer,
    mockResolver,
    sessions,
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Phase B: Atomic Custom Session Start and V2 Runtime Policy", () => {

  it.effect("creates an atomic custom session and persists snapshot in transaction", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service
      const { db } = yield* Database.Service

      const sid = SessionV2.ID.create()
      const { session, snapshot } = yield* sessionSvc.createCustom({
        id: sid,
        location,
        composition: mockCompositionInput,
        title: "Test Custom Session",
      })

      // Check session info
      expect(session.id).toBe(sid)
      expect(session.mode).toBe("custom")
      expect(session.agent).toBe(AgentV2.ID.make("meta"))
      expect(session.title).toBe("Test Custom Session")

      // Check snapshot
      expect(snapshot.sessionID).toBe(sid)
      expect(snapshot.digest).toBe(mockDigest)
      if (snapshot.version === 1) {
        expect(snapshot.data.agentID).toBe("code-reviewer")
      }

      // Verify DB rows exist for both session and snapshot
      const sessionRow = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sid)).get().pipe(Effect.orDie)
      expect(sessionRow).toBeDefined()
      expect(sessionRow?.mode).toBe("custom")

      const snapshotRow = yield* db
        .select()
        .from(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, sid))
        .get()
        .pipe(Effect.orDie)
      expect(snapshotRow).toBeDefined()
      expect(snapshotRow?.digest).toBe(mockDigest)

      // Verify SessionComposition service reads it
      const readSnapshot = yield* sessionComposition.get(sid)
      expect(readSnapshot.digest).toBe(mockDigest)
    }),
  )

  it.effect("rejects expectedPlanDigest mismatch with stale_composition_plan error", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const sid = SessionV2.ID.create()
      const err = yield* sessionSvc
        .createCustom({
          id: sid,
          location,
          composition: mockCompositionInput,
          expectedPlanDigest: otherDigest,
        })
        .pipe(Effect.flip)

      expect(err).toBeInstanceOf(Composition.ResolveError)
      if (err instanceof Composition.ResolveError) {
        expect(err.code).toBe("stale_composition_plan")
      }
    }),
  )

  it.effect("exact retry with identical sessionID and matching digest is idempotent", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const sid = SessionV2.ID.create()
      const first = yield* sessionSvc.createCustom({
        id: sid,
        location,
        composition: mockCompositionInput,
      })

      const second = yield* sessionSvc.createCustom({
        id: sid,
        location,
        composition: mockCompositionInput,
      })

      expect(second.session.id).toBe(first.session.id)
      expect(second.snapshot.digest).toBe(first.snapshot.digest)
      expect(yield* sessionSvc.list({ mode: "custom" })).toHaveLength(1)
    }),
  )

  it.effect("conflict retry with same ID but mismatched digest fails with PromptConflictError", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const sid = SessionV2.ID.create()
      yield* sessionSvc.createCustom({
        id: sid,
        location,
        composition: mockCompositionInput,
      })

      // Simulate modified composition resulting in different digest
      nextFreezeDigest = otherDigest
      const err = yield* sessionSvc
        .createCustom({
          id: sid,
          location,
          composition: mockCompositionInput,
        })
        .pipe(Effect.flip)

      expect(err).toBeInstanceOf(SessionV2.PromptConflictError)
    }),
  )

  it.effect("conflict retry with existing non-custom session fails with PromptConflictError", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const sid = SessionV2.ID.create()
      yield* sessionSvc.create({
        id: sid,
        location,
        mode: "coding",
      })

      const err = yield* sessionSvc
        .createCustom({
          id: sid,
          location,
          composition: mockCompositionInput,
        })
        .pipe(Effect.flip)

      expect(err).toBeInstanceOf(SessionV2.PromptConflictError)
    }),
  )

  it.effect("prompt succeeds on custom session when snapshot exists", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const sid = SessionV2.ID.create()
      yield* sessionSvc.createCustom({
        id: sid,
        location,
        composition: mockCompositionInput,
      })

      const admitted = yield* sessionSvc.prompt({
        sessionID: sid,
        prompt: Prompt.make({ text: "Hello custom agent" }),
        resume: false,
      })

      expect(admitted.sessionID).toBe(sid)
      if ("prompt" in admitted) {
        expect(admitted.prompt).toEqual({ text: "Hello custom agent" })
      } else {
        expect(true).toBe(false)
      }
    }),
  )

  it.effect("prompt and resume fail with SnapshotNotFoundError when custom session has no snapshot", () =>
    Effect.gen(function* () {
      const sessionSvc = yield* SessionV2.Service
      const { db } = yield* Database.Service

      // Directly insert an orphaned custom session row with no snapshot
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)

      const orphanID = SessionV2.ID.make("ses_orphan_custom")
      yield* db
        .insert(SessionTable)
        .values({
          id: orphanID,
          project_id: ProjectV2.ID.global,
          slug: "orphan",
          mode: "custom",
          directory: "/project",
          title: "Orphan Custom Session",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const promptErr = yield* sessionSvc
        .prompt({
          sessionID: orphanID,
          prompt: Prompt.make({ text: "Should fail" }),
          resume: false,
        })
        .pipe(Effect.flip)

      expect(promptErr).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)

      const resumeErr = yield* sessionSvc.resume(orphanID).pipe(Effect.flip)
      expect(resumeErr).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)
    }),
  )

  it.effect("pure policy helpers classify custom mode as V2 runtime", () =>
    Effect.gen(function* () {
      expect(ProductModePolicy.isV2Mode("custom")).toBe(true)
      expect(ProductModePolicy.shouldUseV2Runtime("custom", false)).toBe(true)
      expect(ProductModePolicy.shouldUseV2Runtime("custom", true)).toBe(true)
      expect(ProductModePolicy.isV2Mode("coding")).toBe(false)
      expect(ProductModePolicy.shouldUseV2Runtime("coding", false)).toBe(false)
      expect(ProductModePolicy.shouldUseV2Runtime("coding", true)).toBe(true)
    }),
  )
})

describe("Custom child delegation gate and snapshot reconciliation (MEDIUM-4)", () => {
  it.effect("defaults an omitted child agent to the parent snapshot's frozen agentID", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      const child = yield* sessionSvc.create({ parentID: parent.session.id, location })

      expect(child.parentID).toBe(parent.session.id)
      expect(child.mode).toBe("custom")
      expect(child.agent).toBe(AgentV2.ID.make("code-reviewer"))
      const childSnapshot = yield* sessionComposition.get(child.id)
      expect(childSnapshot.digest).toBe(parent.snapshot.digest)
    }),
  )

  it.effect("accepts an explicit child agent matching the parent snapshot", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      const child = yield* sessionSvc.create({
        parentID: parent.session.id,
        agent: AgentV2.ID.make("code-reviewer"),
        location,
      })

      expect(child.mode).toBe("custom")
      expect(child.agent).toBe(AgentV2.ID.make("code-reviewer"))
    }),
  )

  it.effect("rejects a mismatching child agent with typed AgentDelegationForbiddenError", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      const childID = SessionV2.ID.create()
      const err = yield* sessionSvc
        .create({
          id: childID,
          parentID: parent.session.id,
          agent: AgentV2.ID.make("intruder-agent"),
          location,
        })
        .pipe(Effect.flip)

      // Effect.flip only observes typed failures; a defect would fail the test.
      expect(err).toBeInstanceOf(SessionComposition.AgentDelegationForbiddenError)
      if (err instanceof SessionComposition.AgentDelegationForbiddenError) {
        expect(err.allowedAgentID).toBe("code-reviewer")
      }

      // The typed rejection happens before projection: no session row exists.
      const missing = yield* sessionSvc.get(childID).pipe(Effect.flip)
      expect(missing).toBeInstanceOf(SessionV2.NotFoundError)
    }),
  )

  it.effect("fails typed with SnapshotNotFoundError when the custom parent lost its snapshot row", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const { db } = yield* Database.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      yield* db
        .delete(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, parent.session.id))
        .run()
        .pipe(Effect.orDie)

      const err = yield* sessionSvc.create({ parentID: parent.session.id, location }).pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)
    }),
  )

  it.effect("concurrent child create and custom start with identical digest reconcile to one session and snapshot", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      const childID = SessionV2.ID.create()

      const [createExit, customExit] = yield* Effect.all(
        [
          sessionSvc.create({ id: childID, parentID: parent.session.id, location }).pipe(Effect.exit),
          sessionSvc.createCustom({ id: childID, location, composition: mockCompositionInput }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      // Exact retry under the projection race: both calls reconcile.
      expect(Exit.isSuccess(createExit)).toBe(true)
      expect(Exit.isSuccess(customExit)).toBe(true)

      const customSessions = yield* sessionSvc.list({ mode: "custom" })
      expect(customSessions.filter((info) => info.id === childID)).toHaveLength(1)
      const snapshot = yield* sessionComposition.get(childID)
      expect(snapshot.digest).toBe(mockDigest)
    }),
  )

  it.effect("concurrent child create and custom start with conflicting digests fail typed, never defective", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service

      const parent = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })
      nextFreezeDigest = otherDigest
      const childID = SessionV2.ID.create()

      const [createExit, customExit] = yield* Effect.all(
        [
          sessionSvc.create({ id: childID, parentID: parent.session.id, location }).pipe(Effect.exit),
          sessionSvc.createCustom({ id: childID, location, composition: mockCompositionInput }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      // Whichever side loses the projection race must fail with a typed
      // PromptConflictError — never a defect (the old orDie behavior), never
      // SnapshotAlreadyExistsError. (A create that observes the recorded
      // session adopts it per the Session ID reuse invariant, so both-succeed
      // is a legal outcome too.)
      assertTypedConflict(createExit)
      assertTypedConflict(customExit)

      const customSessions = yield* sessionSvc.list({ mode: "custom" })
      expect(customSessions.filter((info) => info.id === childID)).toHaveLength(1)
      const snapshot = yield* sessionComposition.get(childID)
      expect([mockDigest, otherDigest]).toContain(snapshot.digest)
    }),
  )
})

describe("Same-profile session independence (MEDIUM-5)", () => {
  it.effect("same profile started twice yields independent snapshot rows with equal digest", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service
      const { db } = yield* Database.Service

      const first = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput, title: "First" })
      const second = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput, title: "Second" })

      expect(first.session.id).not.toBe(second.session.id)
      expect(first.snapshot.digest).toBe(second.snapshot.digest)

      // Rows attach independently per session: re-attaching the first fails on
      // its own row without touching the second.
      const reattach = yield* sessionComposition.attach(first.session.id, first.snapshot).pipe(Effect.flip)
      expect(reattach).toBeInstanceOf(SessionComposition.SnapshotAlreadyExistsError)

      // Mutating one row out of band leaves the other row untouched.
      yield* db.run(
        sql`UPDATE session_composition_snapshot SET data = json_set(data, '$.agentID', 'tampered-agent') WHERE session_id = ${first.session.id}`,
      )
      const tampered = yield* sessionComposition.get(first.session.id)
      if (tampered.version === 1) {
        expect(tampered.data.agentID).toBe("tampered-agent")
      }
      const untouched = yield* sessionComposition.get(second.session.id)
      if (untouched.version === 1) {
        expect(untouched.data.agentID).toBe("code-reviewer")
      }
      expect(untouched.digest).toBe(first.snapshot.digest)
    }),
  )
})
