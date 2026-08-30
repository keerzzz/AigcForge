import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
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
      prompts: [],
      skills: [],
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
  bindings: {},
  presentation: "native",
  requestedCapabilities: [],
})

let nextFreezeDigest = mockDigest

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

// The busy guard is exercised through the SessionExecution seam: only the
// designated session id reports active work.
const busySessionID = SessionV2.ID.make("ses_upgrade_busy")
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    isActive: (sessionID) => Effect.succeed(sessionID === busySessionID),
  }),
)

const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(execution),
  Layer.provide(mockResolver),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    execution,
    SessionComposition.defaultLayer,
    mockResolver,
    sessions,
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Custom Mode Upgrade", () => {
  it.effect("freezes the new composition into a fresh session and leaves the source untouched", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service

      const source = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput, title: "Source" })

      nextFreezeDigest = otherDigest
      const upgraded = yield* sessionSvc.upgradeCustom({
        sessionID: source.session.id,
        composition: mockCompositionInput,
        title: "Upgraded",
      })

      expect(upgraded.session.id).not.toBe(source.session.id)
      expect(upgraded.session.mode).toBe("custom")
      expect(upgraded.session.title).toBe("Upgraded")
      expect(upgraded.session.location.directory).toBe(source.session.location.directory)
      expect(upgraded.snapshot.digest).toBe(otherDigest)

      // The source session and its frozen snapshot row are never mutated by an
      // upgrade: the old session stays readable for frozen replay.
      const reloadedSource = yield* sessionSvc.get(source.session.id)
      expect(reloadedSource.mode).toBe("custom")
      const sourceSnapshot = yield* sessionComposition.get(source.session.id)
      expect(sourceSnapshot.digest).toBe(mockDigest)

      // The upgraded session is fully functional against its own snapshot.
      const admitted = yield* sessionSvc.prompt({
        sessionID: upgraded.session.id,
        prompt: Prompt.make({ text: "Hello upgraded agent" }),
        resume: false,
      })
      expect(admitted.sessionID).toBe(upgraded.session.id)
    }),
  )

  it.effect("rejects upgrade for a non-custom source session with typed UpgradeSourceModeError", () =>
    Effect.gen(function* () {
      const sessionSvc = yield* SessionV2.Service
      const plain = yield* sessionSvc.create({ location, mode: "coding" })

      const err = yield* sessionSvc
        .upgradeCustom({ sessionID: plain.id, composition: mockCompositionInput })
        .pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionV2.UpgradeSourceModeError)
      if (err instanceof SessionV2.UpgradeSourceModeError) {
        expect(err.mode).toBe("coding")
      }
    }),
  )

  it.effect("rejects upgrade for an unknown session with NotFoundError", () =>
    Effect.gen(function* () {
      const sessionSvc = yield* SessionV2.Service
      const err = yield* sessionSvc
        .upgradeCustom({ sessionID: SessionV2.ID.make("ses_upgrade_missing"), composition: mockCompositionInput })
        .pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionV2.NotFoundError)
    }),
  )

  it.effect("rejects upgrade while the source session is actively running (typed SessionBusyError)", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const sessionComposition = yield* SessionComposition.Service

      yield* sessionSvc.createCustom({ id: busySessionID, location, composition: mockCompositionInput })

      const err = yield* sessionSvc
        .upgradeCustom({ sessionID: busySessionID, composition: mockCompositionInput })
        .pipe(Effect.flip)
      expect(err).toBeInstanceOf(SessionV2.SessionBusyError)

      // Fail-closed without side effects: no new session, source snapshot intact.
      const customSessions = yield* sessionSvc.list({ mode: "custom" })
      expect(customSessions).toHaveLength(1)
      const snapshot = yield* sessionComposition.get(busySessionID)
      expect(snapshot.digest).toBe(mockDigest)
    }),
  )

  it.effect("propagates a stale expectedPlanDigest as ResolveError", () =>
    Effect.gen(function* () {
      nextFreezeDigest = mockDigest
      const sessionSvc = yield* SessionV2.Service
      const source = yield* sessionSvc.createCustom({ location, composition: mockCompositionInput })

      const err = yield* sessionSvc
        .upgradeCustom({
          sessionID: source.session.id,
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
})
