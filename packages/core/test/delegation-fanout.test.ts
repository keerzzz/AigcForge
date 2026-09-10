/**
 * Phase 4 RED tests: Multi-participant fan-out, evidence appending, and revision review barrier.
 *
 * Implements ADR-22 (§2.5, §2.6, §2.7, §2.8) and Plan §16.8 / §844.
 * Exercises real production seams using testEffect and standard layers.
 */

import { describe, expect } from "bun:test"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Deferred, Effect, Exit, Layer } from "effect"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { RevisionDigest } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID } from "@aigcfroge/schema/delegation-id"
import { DelegationEvent } from "../src/delegation/event"
import { DelegationService } from "../src/delegation/service"
import { DelegationProjector } from "../src/delegation/projector"
import { DelegationExecution } from "../src/delegation/execution"
import { foldDelegation } from "../src/delegation/fold"
import { evaluateReviewBarrier, canComplete } from "../src/delegation/review"
import { calculateRevisionDigest } from "../src/delegation/digest"
import { DelegationParser } from "../src/tool/delegation-parser"
import { EventTable } from "../src/event/sql"
import { SessionInputTable, SessionMessageTable } from "../src/session/sql"
import { SessionRunCoordinator } from "../src/session/run-coordinator"
import { SessionMessageID } from "@aigcfroge/schema/session-message-id"
import { SessionSchema } from "../src/session/schema"
import { pollWithTimeout, testEffect } from "./lib/effect"
import { seedDelegationParentSession } from "./delegation-test-support"

let mockRunnerFailure: string | undefined = undefined

function assertDefined<T>(value: T | undefined, label: string): asserts value is T {
  expect(value).toBeDefined()
  if (value === undefined) throw new Error(label)
}

export const setMockRunnerFailure = (err?: string) => {
  mockRunnerFailure = err
}

const testSessionExecutionLayer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, _force: boolean) {
        if (mockRunnerFailure) {
          return yield* Effect.fail(
            new SessionRunner.SnapshotDriftError({
              sessionID,
              reason: mockRunnerFailure,
            }),
          )
        }

        // 1. Consume pending unpromoted inputs from SessionInputTable (proves child inbox consumption)
        const inputs = yield* db
          .select()
          .from(SessionInputTable)
          .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq)))
          .all()
          .pipe(Effect.orDie)

        if (inputs.length > 0) {
          const assistantMsgId = SessionMessageID.ID.make(
            `msg_asst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          )
          const lastInput = inputs[inputs.length - 1]
          const promptText = lastInput?.prompt?.text ?? "Work done"
          const assistantText = `Implemented changes for: ${promptText}`

          // 2. Insert real assistant message into SessionMessageTable
          const data = {
            agent: "build",
            model: { id: "test", providerID: "test" },
            content: [{ type: "text", id: "p1", text: assistantText }],
            time: { created: Date.now() },
          } satisfies Omit<(typeof SessionMessage.Assistant)["Encoded"], "type" | "id">
          yield* db
            .insert(SessionMessageTable)
            .values({
              id: assistantMsgId,
              session_id: sessionID,
              type: "assistant",
              seq: Date.now(),
              time_created: Date.now(),
              data,
            })
            .run()
            .pipe(Effect.orDie)

          // 3. Mark consumed inputs as promoted in SessionInputTable
          for (const input of inputs) {
            yield* db
              .update(SessionInputTable)
              .set({ promoted_seq: Date.now() })
              .where(eq(SessionInputTable.id, input.id))
              .run()
              .pipe(Effect.orDie)
          }
        }

        return yield* Effect.void
      }),
    })

    return SessionExecution.Service.of({
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      isActive: coordinator.isActive,
    })
  }),
).pipe(Layer.provide(Database.defaultLayer))

const projectLayer = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const rootServices = Layer.mergeAll(
  Database.defaultLayer,
  EventV2.defaultLayer,
  BackgroundJob.defaultLayer,
  SessionStore.defaultLayer,
  SessionProjector.defaultLayer,
  SessionComposition.defaultLayer,
  testSessionExecutionLayer,
  TaskDriver.runtimeLayer,
  projectLayer,
)

const sessionsLayer = SessionV2.layer.pipe(Layer.provide(rootServices))
const metaAgentLayer = MetaAgentService.layer.pipe(Layer.provide(rootServices))
const delegationProjectorLayer = DelegationProjector.layer.pipe(Layer.provide(rootServices))
const delegationServiceLayer = DelegationService.layer.pipe(Layer.provide(rootServices))

const delegationExecutionLayer = DelegationExecution.layer.pipe(
  Layer.provide(delegationServiceLayer),
  Layer.provide(sessionsLayer),
  Layer.provide(rootServices),
)

const fillLayer = TaskDriverFill.layer.pipe(
  Layer.provide(sessionsLayer),
  Layer.provide(delegationExecutionLayer),
  Layer.provide(rootServices),
  Layer.provide(metaAgentLayer),
  Layer.provide(delegationServiceLayer),
  Layer.provideMerge(TaskDriver.runtimeLayer),
)

const baseLayer = Layer.mergeAll(
  rootServices,
  sessionsLayer,
  metaAgentLayer,
  delegationProjectorLayer,
  delegationServiceLayer,
  fillLayer,
  delegationExecutionLayer,
)

const it = testEffect(baseLayer)

const makeParentSession = Effect.fn("Test.makeParentSession")(function* () {
  const { db } = yield* Database.Service
  const parentSessionID = SessionV2.ID.create()
  yield* seedDelegationParentSession(db, parentSessionID)
  return parentSessionID
})

const dummyCommitSha = "917881a45e622a4434d7528c4915cc5f77ee3005"

describe("Phase 4: Multi-Participant Fan-Out, Evidence Appending, and Review Barrier (TDD RED)", () => {
  it.effect("1. fan-out: appends a Turn to Build and Codex participants generating independent deliveries", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Auth implementation and review" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Implement OAuth login and review",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      expect(turn.seq).toBe(1)
      expect(turn.participantIDs).toEqual([build.id, codex.id])
      expect(turn.status).toBe("admitted")

      const state = yield* service.foldState(dlg.id)
      expect(state).toBeDefined()
      expect(state!.turns.size).toBe(1)

      const buildDelivery = [...state!.deliveries.values()].find((d) => d.participantID === build.id)
      const codexDelivery = [...state!.deliveries.values()].find((d) => d.participantID === codex.id)

      expect(buildDelivery).toBeDefined()
      expect(buildDelivery!.status).toBe("admitted")
      expect(buildDelivery!.attempt).toBe(1)
      expect(buildDelivery!.senderParticipantID).toBe(build.id)

      expect(codexDelivery).toBeDefined()
      expect(codexDelivery!.status).toBe("admitted")
      expect(codexDelivery!.attempt).toBe(1)
      expect(codexDelivery!.senderParticipantID).toBe(build.id)
    }),
  )

  it.effect("2. partial failure: preserves independent delivery outcomes when one participant fails", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Partial failure isolation" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Run build and codex in parallel",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      // Build starts and completes successfully
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: build.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "started",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: build.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
        summary: "Build finished with 0 errors",
      })

      // Codex starts and fails (e.g. CLI crash)
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "started",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "failed",
        errorCode: "process_crashed",
        summary: "Codex process crashed",
      })

      const state = yield* service.foldState(dlg.id)
      expect(state).toBeDefined()

      const buildDelivery = [...state!.deliveries.values()].find((d) => d.participantID === build.id)
      const codexDelivery = [...state!.deliveries.values()].find((d) => d.participantID === codex.id)

      // Invariant: One participant's failure must NOT overwrite another participant's success
      expect(buildDelivery!.status).toBe("completed")
      expect(codexDelivery!.status).toBe("failed")

      // Invariant: Turn status reflects partial completion, not total failure
      expect(state!.turns.get(turn.id)?.status).toBe("partially_completed")

      // Invariant: Delegation remains running so that failed delivery can be retried; failure is not fatal to the entire delegation
      expect(state!.delegation.status).toBe("running")
    }),
  )

  it.effect("3. retry: advances attempt from failed state and rejects retrying completed delivery", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Retry attempt test" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Test retry progression",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      // Build completes on attempt 1
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: build.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
        summary: "Build succeeded",
      })

      // Codex fails on attempt 1
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "failed",
        errorCode: "timeout",
        summary: "Codex timed out",
      })

      // Retry Codex on attempt 2 from failed state -> must succeed
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 2,
        status: "started",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 2,
        status: "completed",
        summary: "Codex retry succeeded",
      })

      const state = yield* service.foldState(dlg.id)
      const codexDelivery = [...state!.deliveries.values()].find((d) => d.participantID === codex.id)
      expect(codexDelivery!.attempt).toBe(2)
      expect(codexDelivery!.status).toBe("completed")

      // Attempting to retry Build (which is already completed) must fail closed
      const invalidRetry = yield* service
        .recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: build.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 2,
          status: "started",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(invalidRetry)).toBe(true)
    }),
  )

  it.effect("4a. idempotency: identical evidenceDigest, same participants, and same origin reuses existing Turn", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Evidence deduplication test" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const evidenceDigest = "ev_auth_schema_hash_abc123"
      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Implement schema",
        evidenceDigest,
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const { db } = yield* Database.Service
      const eventsBefore = yield* db
        .select({ id: EventTable.id, type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, dlg.id))

      // Duplicate submission with identical evidenceDigest and participants
      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Implement schema (duplicate call)",
        evidenceDigest,
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      // Invariant: Must return existing turn without creating duplicate deliveries or advancing seq
      expect(turn2.id).toBe(turn1.id)
      expect(turn2.seq).toBe(turn1.seq)

      // Invariant: Must not publish duplicate durable events to EventTable
      const eventsAfter = yield* db
        .select({ id: EventTable.id, type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, dlg.id))
      expect(eventsAfter.length).toBe(eventsBefore.length)
      expect(eventsAfter.map((e) => e.id)).toEqual(eventsBefore.map((e) => e.id))

      const state = yield* service.foldState(dlg.id)
      expect(state!.turns.size).toBe(1)
      expect(state!.deliveries.size).toBe(2)
    }),
  )

  it.effect("4b. counter-example: different evidenceDigest with identical prompt creates a new Turn", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Distinct evidence creates new turn" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Fix authentication flaw",
        evidenceDigest: "ev_digest_v1",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Fix authentication flaw",
        evidenceDigest: "ev_digest_v2",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      expect(turn2.id).not.toBe(turn1.id)
      expect(turn2.seq).toBe(2)

      const state = yield* service.foldState(dlg.id)
      expect(state!.turns.size).toBe(2)
    }),
  )

  it.effect("4c. counter-example: same evidenceDigest with different deliveryOrigin creates a new Turn", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Distinct origin creates new turn" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Shared evidence test",
        evidenceDigest: "ev_shared_digest",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta_agent", senderParticipantID: build.id },
      })

      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Shared evidence test",
        evidenceDigest: "ev_shared_digest",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "user_steer", senderParticipantID: build.id },
      })

      // Invariant: Different origin indicates distinct dispatch intent; must not erroneously merge
      expect(turn2.id).not.toBe(turn1.id)
      expect(turn2.seq).toBe(2)
    }),
  )

  it.effect("4d. counter-example: same evidenceDigest across different Delegations remains strictly isolated", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const child1 = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Child 1",
      })
      const child2 = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Child 2",
      })

      const dlg1 = yield* service.create({ parentSessionID, title: "Delegation 1" })
      const dlg2 = yield* service.create({ parentSessionID, title: "Delegation 2" })

      const p1 = yield* service.addParticipant({
        delegationID: dlg1.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: child1.id,
      })
      const p2 = yield* service.addParticipant({
        delegationID: dlg2.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: child2.id,
      })

      const turn1 = yield* service.appendTurn({
        delegationID: dlg1.id,
        kind: "task",
        promptSummary: "Isolate evidence",
        evidenceDigest: "ev_cross_delegation",
        participantIDs: [p1.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: p1.id },
      })
      const turn2 = yield* service.appendTurn({
        delegationID: dlg2.id,
        kind: "task",
        promptSummary: "Isolate evidence",
        evidenceDigest: "ev_cross_delegation",
        participantIDs: [p2.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: p2.id },
      })

      expect(turn1.delegationID).toBe(dlg1.id)
      expect(turn2.delegationID).toBe(dlg2.id)
      expect(turn1.id).not.toBe(turn2.id)

      const state1 = yield* service.foldState(dlg1.id)
      const state2 = yield* service.foldState(dlg2.id)
      expect(state1!.turns.size).toBe(1)
      expect(state2!.turns.size).toBe(1)
    }),
  )

  it.live(
    "5a. steer runtime: promotes at safe provider boundary during active execution without killing tool execution",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service
        const background = yield* BackgroundJob.Service
        const execution = yield* DelegationExecution.Service
        const { db } = yield* Database.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Implementer Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Steer active execution test" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })

        // Simulate active tool execution on the child session via BackgroundJob + Deferred
        const toolRunning = yield* Deferred.make<void>()
        yield* background.start({
          id: childSession.id,
          type: "task",
          run: Deferred.await(toolRunning).pipe(Effect.as("tool completed")),
        })

        expect(yield* TaskDriver.isRunning(childSession.id)).toBe(true)

        // Append turn with steer intent while tool is actively running
        const steerTurn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Steer instruction while tool is active",
          participantIDs: [build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        expect(steerTurn.delivery).toBe("steer")

        // Trigger coordinator to drain/evaluate steer while tool is active
        yield* execution.drain(dlg.id)

        // Invariant 1: The active tool execution MUST NOT be forcibly interrupted or killed by steer
        expect(yield* TaskDriver.isRunning(childSession.id)).toBe(true)

        // Invariant 2: Steer input enters the child session inbox in SessionInputTable at safe boundary
        const inputs = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childSession.id))
        expect(inputs.some((row) => row.delivery === "steer")).toBe(true)

        // Invariant 3: Delivery has been registered as started (status running) by the coordinator
        const stateDuringRunning = yield* service.foldState(dlg.id)
        const steerDeliveryRunning = [...stateDuringRunning!.deliveries.values()].find((d) => d.turnID === steerTurn.id)
        expect(steerDeliveryRunning!.status).toBe("running")

        // Complete the tool execution so session yields to safe provider boundary
        yield* Deferred.succeed(toolRunning, undefined)
        const toolOutcome = yield* background.wait({ id: childSession.id })
        expect(toolOutcome?.info?.status).toBe("completed")

        // The completion watcher must wake the coordinator automatically; no
        // second manual drain is allowed in this assertion.
        const stateAfter = yield* pollWithTimeout(
          service.foldState(dlg.id).pipe(
            Effect.map((state) => {
              const delivery = [...(state?.deliveries.values() ?? [])].find((d) => d.turnID === steerTurn.id)
              return delivery?.status === "completed" ? state : undefined
            }),
          ),
          "steer delivery was not auto-settled after the child became idle",
        )

        // Invariant 4: Steer delivery settles to completed after safe boundary
        const steerDeliveryAfter = [...stateAfter.deliveries.values()].find((d) => d.turnID === steerTurn.id)
        assertDefined(steerDeliveryAfter, "steer delivery disappeared after completion")
        expect(steerDeliveryAfter.status).toBe("completed")
        expect(stateAfter.turns.get(steerTurn.id)?.status).toBe("completed")
      }),
  )

  it.live(
    "5b. queue runtime: remains pending during active execution and only promotes when child session is idle",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service
        const background = yield* BackgroundJob.Service
        const execution = yield* DelegationExecution.Service
        const { db } = yield* Database.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Implementer Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Queue idle execution test" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })

        const toolRunning = yield* Deferred.make<void>()
        yield* background.start({
          id: childSession.id,
          type: "task",
          run: Deferred.await(toolRunning).pipe(Effect.as("initial work finished")),
        })

        // Append queue delivery while child is active
        const queueTurn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Queued background instruction",
          participantIDs: [build.id],
          delivery: "queue",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        expect(queueTurn.delivery).toBe("queue")
        expect(queueTurn.status).toBe("queued")
        expect(yield* TaskDriver.isRunning(childSession.id)).toBe(true)

        // Trigger coordinator to drain while child session is busy
        yield* execution.drain(dlg.id)

        // Invariant 1: While child session is actively running, queue remains pending in queued state
        const stateWhileRunning = yield* service.foldState(dlg.id)
        const queueDelivery = [...stateWhileRunning!.deliveries.values()].find((d) => d.turnID === queueTurn.id)
        expect(queueDelivery!.status).toBe("queued")

        // Resolve running job so session reaches idle boundary
        yield* Deferred.succeed(toolRunning, undefined)
        yield* background.wait({ id: childSession.id })
        expect(yield* TaskDriver.isRunning(childSession.id)).toBe(false)

        // The idle watcher must promote and settle the queued delivery without a
        // second manual drain. This is the production wake path under test.
        const stateFinal = yield* pollWithTimeout(
          service.foldState(dlg.id).pipe(
            Effect.map((state) => {
              const delivery = [...(state?.deliveries.values() ?? [])].find((d) => d.turnID === queueTurn.id)
              return delivery?.status === "completed" ? state : undefined
            }),
          ),
          "queued delivery was not auto-promoted after the child became idle",
        )

        // Invariant 3: Queue input entered the child session's inbox
        const inputs = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childSession.id))
        expect(inputs.some((row) => row.delivery === "queue")).toBe(true)

        // Invariant 4: Queued delivery and Turn settle to completed
        const queueDeliveryFinal = [...stateFinal.deliveries.values()].find((d) => d.turnID === queueTurn.id)
        assertDefined(queueDeliveryFinal, "queued delivery disappeared after completion")
        expect(queueDeliveryFinal.status).toBe("completed")
        expect(stateFinal.turns.get(queueTurn.id)?.status).toBe("completed")
      }),
  )

  it.effect("5c. cold resume runtime: reconstructs execution when child session has no active activation", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      const execution = yield* DelegationExecution.Service
      const { db } = yield* Database.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Cold Child Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Cold resume test" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      // Child session has no active fiber (cold start / exited process)
      expect(yield* TaskDriver.isRunning(childSession.id)).toBe(false)

      const sessionsBefore = yield* sessions.list()

      const turn = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Cold resume turn",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      expect(turn.status).toBe("admitted")

      // Invariant 1: Coordinator resumes execution on cold child session
      yield* execution.drain(dlg.id)
      yield* background.wait({ id: childSession.id })

      // Invariant 2: Delivery completes and child session activation is settled
      const stateFinal = yield* service.foldState(dlg.id)
      const deliveryFinal = [...stateFinal!.deliveries.values()].find((d) => d.turnID === turn.id)
      expect(deliveryFinal!.status).toBe("completed")
      expect(stateFinal!.turns.get(turn.id)?.status).toBe("completed")

      // Invariant 3: Bound to original child session without creating duplicate sessions
      const sessionsAfter = yield* sessions.list()
      expect(sessionsAfter.length).toBe(sessionsBefore.length)

      // Invariant 4: Admitted prompt enters child session inbox
      const inputs = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, childSession.id))
      expect(inputs.some((row) => row.session_id === childSession.id)).toBe(true)
    }),
  )

  it.effect("6a. target rejection: fails closed when appending a turn to a closing delegation", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Closing delegation rejection" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Turn to transition draft -> running",
        participantIDs: [build.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      yield* events.publish(DelegationEvent.Closing, {
        delegationID: dlg.id,
        reason: "User closed task",
        timestamp: Date.now(),
      })

      const appendToClosing = yield* service
        .appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Post-close prompt",
          participantIDs: [build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(appendToClosing)).toBe(true)
    }),
  )

  it.effect("6b. target rejection: fails closed when appending a turn to an archived delegation", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Archived delegation rejection" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      // Cancel then archive
      yield* events.publish(DelegationEvent.Cancelled, {
        delegationID: dlg.id,
        reason: "Cancelled before archiving",
        timestamp: Date.now(),
      })
      yield* events.publish(DelegationEvent.Archived, {
        delegationID: dlg.id,
        timestamp: Date.now(),
      })

      const appendToArchived = yield* service
        .appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Post-archive prompt",
          participantIDs: [build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(appendToArchived)).toBe(true)
    }),
  )

  it.effect("6c. target rejection: fails closed when targeting an unknown participant or duplicate participants", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Target validation" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      // Unknown participant fails
      const appendUnknown = yield* service
        .appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Unknown target",
          participantIDs: [ParticipantID.make("par_unknown_ghost")],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(appendUnknown)).toBe(true)

      // Duplicate participant in same turn fails
      const appendDuplicate = yield* service
        .appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Duplicate target",
          participantIDs: [build.id, build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(appendDuplicate)).toBe(true)
    }),
  )

  it.effect("6d. target no-op: cancelling an idle or missing background target is an idempotent no-op", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Idle Session",
      })

      // ADR-22 §2.7 item 4: Missing or idle target is idempotent no-op
      const cancelResult = yield* TaskDriver.cancel(childSession.id).pipe(Effect.exit)
      expect(Exit.isSuccess(cancelResult)).toBe(true)
    }),
  )

  it.effect(
    "7. revision snapshot: implementer settle sets revision digest, reviewer recordRevision is rejected fail-closed, and subsequent review does not mutate digest",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Implementer Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Revision solidifying test" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })
        const codex = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "external",
          target: "codex",
          role: "reviewer",
          context: "fresh",
        })

        const turn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Implement revision R1",
          participantIDs: [build.id, codex.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        const commitSha = dummyCommitSha
        const normalizedDiff =
          "--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-export const auth = false\n+export const auth = true\n"
        const revisionDigest = RevisionDigest.make(calculateRevisionDigest({ commitSha, normalizedDiff }))

        // 1. Build implementer records revision -> succeeds
        yield* service.recordRevision({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: build.id,
          commitSha,
          revisionDigest,
          changeKind: "rework",
        })

        const stateAfterBuild = yield* service.foldState(dlg.id)
        expect(stateAfterBuild!.delegation.latestRevisionDigest).toBe(revisionDigest)

        // 2. Negative invariant: Reviewer attempting to call recordRevision must fail closed!
        const reviewerRevisionAttempt = yield* service
          .recordRevision({
            delegationID: dlg.id,
            turnID: turn.id,
            participantID: codex.id,
            commitSha,
            revisionDigest: RevisionDigest.make(`rev_${"f".repeat(64)}`),
            changeKind: "rework",
          })
          .pipe(Effect.exit)

        expect(Exit.isFailure(reviewerRevisionAttempt)).toBe(true)

        // Invariant: latestRevisionDigest must remain strictly the implementer's digest
        const stateAfterNegative = yield* service.foldState(dlg.id)
        expect(stateAfterNegative!.delegation.latestRevisionDigest).toBe(revisionDigest)

        // 3. Codex reviewer records a review -> cannot change latestRevisionDigest
        yield* service.recordReview({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: codex.id,
          reviewedRevisionDigest: revisionDigest,
          verdict: "approved",
          findings: [],
          summary: "Auth logic approved",
        })

        const stateAfterReview = yield* service.foldState(dlg.id)
        expect(stateAfterReview!.delegation.latestRevisionDigest).toBe(revisionDigest)
      }),
  )

  it.effect(
    "8a. review envelope parser: malformed JSON, missing digest, or unknown verdict fail closed as invalid",
    () =>
      Effect.sync(() => {
        const validDigest = `rev_${"a".repeat(64)}`

        // 1. Malformed JSON within <review>
        const malformed = DelegationParser.parseDelegationResult("<review>{ not valid json</review>")
        expect(malformed?.review?.status).toBe("invalid")

        // 2. Missing reviewed_revision_digest
        const missingDigest = DelegationParser.parseDelegationResult(
          `<review>{"kind": "aigcfroge.review.v1", "verdict": "approved", "findings": []}</review>`,
        )
        expect(missingDigest?.review?.status).toBe("invalid")

        // 3. Unknown verdict
        const unknownVerdict = DelegationParser.parseDelegationResult(
          `<review>{"kind": "aigcfroge.review.v1", "reviewed_revision_digest": "${validDigest}", "verdict": "looks_good", "findings": []}</review>`,
        )
        expect(unknownVerdict?.review?.status).toBe("invalid")

        // 4. Invalid finding severity
        const invalidSeverity = DelegationParser.parseDelegationResult(
          `<review>{"kind": "aigcfroge.review.v1", "reviewed_revision_digest": "${validDigest}", "verdict": "approved", "findings": [{"file": "a.ts", "line": 1, "severity": "catastrophic", "summary": "oops"}]}</review>`,
        )
        expect(invalidSeverity?.review?.status).toBe("invalid")

        // 5. Valid envelope parses successfully
        const valid = DelegationParser.parseDelegationResult(
          `<review>{"kind": "aigcfroge.review.v1", "reviewed_revision_digest": "${validDigest}", "verdict": "approved", "findings": [{"file": "a.ts", "line": 1, "severity": "blocking", "summary": "ok"}]}</review>`,
        )
        expect(valid?.review?.status).toBe("valid")
        if (valid?.review?.status === "valid") {
          expect(valid.review.envelope.reviewed_revision_digest).toBe(validDigest)
          expect(valid.review.envelope.verdict).toBe("approved")
        }
      }),
  )

  it.effect("8b. review barrier: valid envelope with stale revision digest fails review barrier", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Review barrier stale digest" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Test review envelope",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const revisionDigest = RevisionDigest.make(`rev_${"a".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest,
        changeKind: "rework",
      })

      // Reviewer submits review for a stale digest
      const staleDigest = RevisionDigest.make(`rev_${"b".repeat(64)}`)
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn.id,
        participantID: codex.id,
        reviewedRevisionDigest: staleDigest,
        verdict: "approved",
        findings: [],
        summary: "Stale approval",
      })

      const state = yield* service.foldState(dlg.id)
      const barrier = evaluateReviewBarrier({
        participants: [...state!.participants.values()],
        reviews: state!.reviews,
        latestRevisionDigest: state!.delegation.latestRevisionDigest,
        revisions: state!.revisions,
        rejectionBlocked: state!.delegation.rejectionBlocked,
      })

      // Invariant: Stale revision digest must NOT pass review barrier
      expect(barrier.passed).toBe(false)
      expect(state!.delegation.status).not.toBe("approved")
    }),
  )

  it.effect("9. multi-round: two-round append/review/repair lifecycle converges through review barrier", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Two-round append/review/repair" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      // ── Round 1 ──
      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Round 1: Initial implementation",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const r1Digest = RevisionDigest.make(`rev_${"1".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r1Digest,
        changeKind: "rework",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: build.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
      })

      // Codex reviews R1 with changes_requested
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: codex.id,
        reviewedRevisionDigest: r1Digest,
        verdict: "changes_requested",
        findings: [{ file: "auth.ts", line: 10, severity: "blocking", summary: "Missing null check" }],
        summary: "Changes requested on R1",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
      })

      const stateR1 = yield* service.foldState(dlg.id)
      expect(stateR1!.delegation.status).toBe("changes_requested")
      expect(
        canComplete({
          participants: [...stateR1!.participants.values()],
          reviews: stateR1!.reviews,
          latestRevisionDigest: stateR1!.delegation.latestRevisionDigest,
          revisions: stateR1!.revisions,
          rejectionBlocked: stateR1!.delegation.rejectionBlocked,
          deliveries: [...stateR1!.deliveries.values()],
          turns: [...stateR1!.turns.values()],
        }),
      ).toBe(false)

      // ── Round 2 ──
      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Round 2: Fix null check",
        evidenceDigest: "ev_fix_null_check",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const r2Digest = RevisionDigest.make(`rev_${"2".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r2Digest,
        changeKind: "rework",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: build.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
      })

      // Invariant: Before Codex reviews R2, barrier must fail! R1's verdict cannot satisfy R2.
      const stateR2PendingReview = yield* service.foldState(dlg.id)
      expect(stateR2PendingReview!.delegation.status).not.toBe("approved")

      // Codex reviews R2 with approved
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: codex.id,
        reviewedRevisionDigest: r2Digest,
        verdict: "approved",
        findings: [],
        summary: "R2 fixes verified",
      })
      yield* service.recordDelivery({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: codex.id,
        deliveryOrigin: "meta",
        senderParticipantID: build.id,
        attempt: 1,
        status: "completed",
      })

      const stateR2Approved = yield* service.foldState(dlg.id)
      expect(stateR2Approved!.delegation.status).toBe("approved")
      expect(
        canComplete({
          participants: [...stateR2Approved!.participants.values()],
          reviews: stateR2Approved!.reviews,
          latestRevisionDigest: stateR2Approved!.delegation.latestRevisionDigest,
          revisions: stateR2Approved!.revisions,
          rejectionBlocked: stateR2Approved!.delegation.rejectionBlocked,
          deliveries: [...stateR2Approved!.deliveries.values()],
          turns: [...stateR2Approved!.turns.values()],
        }),
      ).toBe(true)
      yield* service.close({ delegationID: dlg.id, reason: "two-round workflow complete" })
      yield* service.complete({ delegationID: dlg.id, summary: "Build and Codex approved the latest revision" })
      expect((yield* service.foldState(dlg.id))?.delegation.status).toBe("archived")
    }),
  )

  it.effect("10. copyability: formatting_only is conservatively downgraded to rework and not copied (G3)", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Conservative formatting_only copyability" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Initial build",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })

      const r1 = RevisionDigest.make(`rev_${"1".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r1,
        changeKind: "rework",
      })
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: codex.id,
        reviewedRevisionDigest: r1,
        verdict: "approved",
        findings: [],
      })

      // Turn 2: Build applies formatter
      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Format code",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })
      const r2 = RevisionDigest.make(`rev_${"2".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r2,
        changeKind: "formatting_only",
      })

      const state = yield* service.foldState(dlg.id)
      const barrier = evaluateReviewBarrier({
        participants: [...state!.participants.values()],
        reviews: state!.reviews,
        latestRevisionDigest: r2,
        revisions: state!.revisions,
        rejectionBlocked: state!.delegation.rejectionBlocked,
      })

      // Invariant: formatting_only is conservatively treated as rework in this phase; approval does NOT copy
      expect(barrier.passed).toBe(false)
    }),
  )

  it.effect("11. sticky rejection: rejected verdict persists across revisions until explicit retraction (G4)", () =>
    Effect.gen(function* () {
      const parentSessionID = yield* makeParentSession()
      const service = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build Implementer Session",
      })

      const dlg = yield* service.create({ parentSessionID, title: "Sticky rejection blocker" })
      const build = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const codex = yield* service.addParticipant({
        delegationID: dlg.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })

      const turn1 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Vulnerable code",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })
      const r1 = RevisionDigest.make(`rev_${"1".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r1,
        changeKind: "rework",
      })

      // Codex rejects R1
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn1.id,
        participantID: codex.id,
        reviewedRevisionDigest: r1,
        verdict: "rejected",
        findings: [{ file: "auth.ts", line: 1, severity: "blocking", summary: "Critical SQL injection" }],
        summary: "Rejected due to critical security risk",
      })

      const stateAfterRejection = yield* service.foldState(dlg.id)
      expect(stateAfterRejection!.delegation.rejectionBlocked).toBe(true)

      // Turn 2: Build attempts to fix with R2
      const turn2 = yield* service.appendTurn({
        delegationID: dlg.id,
        kind: "task",
        promptSummary: "Fix SQL injection",
        participantIDs: [build.id, codex.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
      })
      const r2 = RevisionDigest.make(`rev_${"2".repeat(64)}`)
      yield* service.recordRevision({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: build.id,
        commitSha: dummyCommitSha,
        revisionDigest: r2,
        changeKind: "rework",
      })
      yield* service.recordReview({
        delegationID: dlg.id,
        turnID: turn2.id,
        participantID: codex.id,
        reviewedRevisionDigest: r2,
        verdict: "approved",
        findings: [],
      })

      // Invariant: Rejection is sticky across revisions! Even though Codex approved R2, barrier must fail until retracted.
      const stateAfterR2 = yield* service.foldState(dlg.id)
      expect(stateAfterR2!.delegation.rejectionBlocked).toBe(true)
      expect(
        evaluateReviewBarrier({
          participants: [...stateAfterR2!.participants.values()],
          reviews: stateAfterR2!.reviews,
          latestRevisionDigest: r2,
          revisions: stateAfterR2!.revisions,
          rejectionBlocked: stateAfterR2!.delegation.rejectionBlocked,
        }).passed,
      ).toBe(false)

      // Retract rejection explicitly
      yield* service.retractRejection({
        delegationID: dlg.id,
        participantID: codex.id,
        reason: "Security vulnerability confirmed resolved",
      })

      const stateAfterRetraction = yield* service.foldState(dlg.id)
      expect(stateAfterRetraction!.delegation.rejectionBlocked).toBe(false)
      expect(
        evaluateReviewBarrier({
          participants: [...stateAfterRetraction!.participants.values()],
          reviews: stateAfterRetraction!.reviews,
          latestRevisionDigest: r2,
          revisions: stateAfterRetraction!.revisions,
          rejectionBlocked: stateAfterRetraction!.delegation.rejectionBlocked,
        }).passed,
      ).toBe(true)
    }),
  )

  it.effect(
    "12. completion order & G6 compatibility: arbitrary delivery completion converges and no-reviewer delegations do not deadlock",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Implementer Session",
        })

        // G6 compatibility: delegation without reviewer must pass barrier upon implementer completion
        const dlgSolo = yield* service.create({ parentSessionID, title: "Solo build task" })
        const buildSolo = yield* service.addParticipant({
          delegationID: dlgSolo.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })

        const turnSolo = yield* service.appendTurn({
          delegationID: dlgSolo.id,
          kind: "task",
          promptSummary: "Solo task without reviewer",
          participantIDs: [buildSolo.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: buildSolo.id },
        })
        yield* service.recordDelivery({
          delegationID: dlgSolo.id,
          turnID: turnSolo.id,
          participantID: buildSolo.id,
          deliveryOrigin: "meta",
          senderParticipantID: buildSolo.id,
          attempt: 1,
          status: "completed",
        })

        const stateSolo = yield* service.foldState(dlgSolo.id)
        expect(stateSolo!.delegation.status).toBe("approved")
        expect(
          canComplete({
            participants: [...stateSolo!.participants.values()],
            reviews: stateSolo!.reviews,
            latestRevisionDigest: stateSolo!.delegation.latestRevisionDigest,
            revisions: stateSolo!.revisions,
            rejectionBlocked: stateSolo!.delegation.rejectionBlocked,
            deliveries: [...stateSolo!.deliveries.values()],
            turns: [...stateSolo!.turns.values()],
          }),
        ).toBe(true)
      }),
  )

  it.effect(
    "13. replay consistency: incremental fold and cold full-replay fold produce identical canonical state",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const { db } = yield* Database.Service
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Implementer Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Replay consistency check" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })
        const codex = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "external",
          target: "codex",
          role: "reviewer",
          context: "fresh",
        })

        const turn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Build and review turn",
          participantIDs: [build.id, codex.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        const r1 = RevisionDigest.make(`rev_${"c".repeat(64)}`)
        yield* service.recordRevision({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: build.id,
          commitSha: dummyCommitSha,
          revisionDigest: r1,
          changeKind: "rework",
        })
        yield* service.recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: build.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 1,
          status: "completed",
        })
        yield* service.recordReview({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: codex.id,
          reviewedRevisionDigest: r1,
          verdict: "approved",
          findings: [{ file: "auth.ts", line: 5, severity: "note", summary: "Looks clean" }],
        })
        yield* service.recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: codex.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 1,
          status: "completed",
        })

        // Fetch incremental fold state
        const incrementalState = yield* service.foldState(dlg.id)
        expect(incrementalState).toBeDefined()

        // Fetch raw events from Database EventTable for replay
        const rawRows = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, dlg.id))
          .orderBy(asc(EventTable.seq))
          .all()
        const events = rawRows.map((row) =>
          EventV2.decodeSerialized({
            id: row.id,
            type: row.type,
            aggregateID: row.aggregate_id,
            seq: row.seq,
            data: row.data,
          }),
        )

        // Cold replay fold
        const replayedState = foldDelegation(events)
        expect(replayedState).toBeDefined()

        // ── Full Canonical Projection Deep Comparison ──
        // 1. Delegation metadata
        expect(replayedState!.delegation.id).toBe(incrementalState!.delegation.id)
        expect(replayedState!.delegation.parentSessionID).toBe(incrementalState!.delegation.parentSessionID)
        expect(replayedState!.delegation.title).toBe(incrementalState!.delegation.title)
        expect(replayedState!.delegation.status).toBe(incrementalState!.delegation.status)
        expect(replayedState!.delegation.latestRevisionDigest).toBe(incrementalState!.delegation.latestRevisionDigest)
        expect(replayedState!.delegation.rejectionBlocked).toBe(incrementalState!.delegation.rejectionBlocked)
        expect(replayedState!.delegation.rejectionReason).toBe(incrementalState!.delegation.rejectionReason)

        // 2. Participants deep comparison
        expect(replayedState!.participants.size).toBe(incrementalState!.participants.size)
        for (const [id, incP] of incrementalState!.participants) {
          const repP = replayedState!.participants.get(id)
          expect(repP).toBeDefined()
          expect(repP!.id).toBe(incP.id)
          expect(repP!.delegationID).toBe(incP.delegationID)
          expect(repP!.provider).toBe(incP.provider)
          expect(repP!.target).toBe(incP.target)
          expect(repP!.role).toBe(incP.role)
          expect(repP!.context).toBe(incP.context)
          expect(repP!.phase).toBe(incP.phase)
          expect(repP!.childSessionID).toBe(incP.childSessionID)
          expect(repP!.externalThreadID).toBe(incP.externalThreadID)
        }

        // 3. Turns deep comparison
        expect(replayedState!.turns.size).toBe(incrementalState!.turns.size)
        for (const [id, incT] of incrementalState!.turns) {
          const repT = replayedState!.turns.get(id)
          expect(repT).toBeDefined()
          expect(repT!.id).toBe(incT.id)
          expect(repT!.delegationID).toBe(incT.delegationID)
          expect(repT!.seq).toBe(incT.seq)
          expect(repT!.kind).toBe(incT.kind)
          expect(repT!.status).toBe(incT.status)
          expect(repT!.promptSummary).toBe(incT.promptSummary)
          expect(repT!.evidenceDigest).toBe(incT.evidenceDigest)
          expect(repT!.revisionDigest).toBe(incT.revisionDigest)
          expect(repT!.participantIDs).toEqual(incT.participantIDs)
          expect(repT!.delivery).toBe(incT.delivery)
        }

        // 4. Deliveries deep comparison
        expect(replayedState!.deliveries.size).toBe(incrementalState!.deliveries.size)
        for (const [key, incD] of incrementalState!.deliveries) {
          const repD = replayedState!.deliveries.get(key)
          expect(repD).toBeDefined()
          expect(repD!.turnID).toBe(incD.turnID)
          expect(repD!.participantID).toBe(incD.participantID)
          expect(repD!.deliveryOrigin).toBe(incD.deliveryOrigin)
          expect(repD!.senderParticipantID).toBe(incD.senderParticipantID)
          expect(repD!.attempt).toBe(incD.attempt)
          expect(repD!.status).toBe(incD.status)
          expect(repD!.summary).toBe(incD.summary)
          expect(repD!.errorCode).toBe(incD.errorCode)
        }

        // 5. Reviews deep comparison
        expect(replayedState!.reviews).toEqual(incrementalState!.reviews)

        // 6. Revisions deep comparison
        expect(replayedState!.revisions).toEqual(incrementalState!.revisions)
      }),
  )

  it.effect(
    "14. DelegationExecution.isActive & interrupt: reflects in-flight tasks and reliably cancels pending/running deliveries",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service
        const background = yield* BackgroundJob.Service
        const execution = yield* DelegationExecution.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Interrupt Test Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Interrupt and isActive test" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })

        // Initially inactive
        expect(yield* execution.isActive(dlg.id)).toBe(false)

        // Simulate active background job
        const jobLatch = yield* Deferred.make<void>()
        yield* background.start({
          id: childSession.id,
          type: "task",
          run: Deferred.await(jobLatch).pipe(Effect.as("done")),
        })

        // Invariant 1: isActive reflects running child session
        expect(yield* execution.isActive(dlg.id)).toBe(true)

        // Append steer turn
        const turn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Interruptable steer turn",
          participantIDs: [build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        yield* execution.drain(dlg.id)

        const stateBeforeInterrupt = yield* service.foldState(dlg.id)
        const runningDelivery = [...stateBeforeInterrupt!.deliveries.values()].find((d) => d.turnID === turn.id)
        expect(runningDelivery!.status).toBe("running")

        // Invariant 2: interrupt cancels running delivery and background job
        yield* execution.interrupt(dlg.id)

        const stateAfterInterrupt = yield* service.foldState(dlg.id)
        const cancelledDelivery = [...stateAfterInterrupt!.deliveries.values()].find((d) => d.turnID === turn.id)
        expect(cancelledDelivery!.status).toBe("cancelled")
        expect(stateAfterInterrupt!.turns.get(turn.id)?.status).toBe("cancelled")

        // Clean up latch
        yield* Deferred.succeed(jobLatch, undefined).pipe(Effect.ignore)

        // Invariant 3: Idempotent no-op on already cancelled / idle delegation
        const secondInterrupt = yield* execution.interrupt(dlg.id).pipe(Effect.exit)
        expect(Exit.isSuccess(secondInterrupt)).toBe(true)

        // Invariant 4: Interrupt on non-existent delegation is an idempotent no-op
        const nonExistentDlgID = DelegationID.ID.make("dlg_nonexistent")
        const nonExistentInterrupt = yield* execution.interrupt(nonExistentDlgID).pipe(Effect.exit)
        expect(Exit.isSuccess(nonExistentInterrupt)).toBe(true)
      }),
  )

  it.effect(
    "15. fail-closed delivery error handling: runner failure records delivery_failed and preserves partial completion",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Build Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Fail-closed error handling" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })
        const codex = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "external",
          target: "codex",
          role: "reviewer",
          context: "fresh",
        })

        const turn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Multi-participant with one failure",
          participantIDs: [build.id, codex.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        // Build completes successfully
        yield* service.recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: build.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 1,
          status: "completed",
          summary: "Build succeeded",
        })

        // Codex encounters fail-closed error
        yield* service.recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: codex.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 1,
          status: "failed",
          summary: "Codex CLI adapter process exited with code 1",
          errorCode: "CLI_ADAPTER_ERROR",
        })

        const state = yield* service.foldState(dlg.id)
        expect(state).toBeDefined()

        // Invariant 1: Multi-participant with 1 failure settles Turn to partially_completed (ADR-22 §2.6)
        const foldedTurn = state!.turns.get(turn.id)
        expect(foldedTurn?.status).toBe("partially_completed")

        // Invariant 2: Failed delivery is retryable (advances attempt to 2)
        yield* service.recordDelivery({
          delegationID: dlg.id,
          turnID: turn.id,
          participantID: codex.id,
          deliveryOrigin: "meta",
          senderParticipantID: build.id,
          attempt: 2,
          status: "started",
        })
        const stateAfterRetry = yield* service.foldState(dlg.id)
        const codexDelivery2 = [...stateAfterRetry!.deliveries.values()].find(
          (d) => d.turnID === turn.id && d.participantID === codex.id,
        )
        expect(codexDelivery2?.attempt).toBe(2)
        expect(codexDelivery2?.status).toBe("running")
      }),
  )

  it.effect(
    "16. steer idempotency & duplicate prevention: multiple drains do not duplicate SessionInputTable rows",
    () =>
      Effect.gen(function* () {
        const parentSessionID = yield* makeParentSession()
        const service = yield* DelegationService.Service
        const sessions = yield* SessionV2.Service
        const background = yield* BackgroundJob.Service
        const execution = yield* DelegationExecution.Service
        const { db } = yield* Database.Service

        const childSession = yield* sessions.create({
          parentID: parentSessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          title: "Idempotency Session",
        })

        const dlg = yield* service.create({ parentSessionID, title: "Steer idempotency test" })
        const build = yield* service.addParticipant({
          delegationID: dlg.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })

        // Active task on child session
        const taskLatch = yield* Deferred.make<void>()
        yield* background.start({
          id: childSession.id,
          type: "task",
          run: Deferred.await(taskLatch).pipe(Effect.as("work done")),
        })

        const turn = yield* service.appendTurn({
          delegationID: dlg.id,
          kind: "task",
          promptSummary: "Idempotent steer prompt",
          participantIDs: [build.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: build.id },
        })

        // First drain: admits steer into SessionInputTable
        yield* execution.drain(dlg.id)

        const inputsAfterFirstDrain = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childSession.id))
        expect(inputsAfterFirstDrain.length).toBe(1)

        // Second drain while delivery is running: MUST NOT admit duplicate row
        yield* execution.drain(dlg.id)

        const inputsAfterSecondDrain = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childSession.id))
        expect(inputsAfterSecondDrain.length).toBe(1)

        // Complete the task and drain to finish
        yield* Deferred.succeed(taskLatch, undefined)
        yield* background.wait({ id: childSession.id })
        yield* execution.drain(dlg.id)
        yield* background.wait({ id: childSession.id })

        const stateFinal = yield* service.foldState(dlg.id)
        const deliveryFinal = [...stateFinal!.deliveries.values()].find((d) => d.turnID === turn.id)
        expect(deliveryFinal!.status).toBe("completed")

        // Total input rows remain exactly 1
        const inputsFinal = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childSession.id))
        expect(inputsFinal.length).toBe(1)
      }),
  )
})
