/**
 * Phase 2 RED tests: internal Build participant seams (ADR-22 §5.2.1 / Plan §16.6).
 *
 * The tests in this file exercise only existing production seams. Resolver and
 * TaskTool end-to-end behavior is covered by the companion aigcfroge test;
 * these tests must not reimplement that resolver by selecting a row in the
 * projection and then calling appendTurn with the selected id.
 */

import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Layer, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentStepTable } from "@aigcfroge/core/meta-agent/sql"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { DelegationService } from "../src/delegation/service"
import { DelegationProjector } from "../src/delegation/projector"
import { DelegationEvent } from "../src/delegation/event"
import { DelegationParticipantTable, DelegationTable } from "../src/delegation/sql"
import { testEffect } from "./lib/effect"
import { seedDelegationParentSession } from "./delegation-test-support"

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
  SessionExecution.noopLayer,
  TaskDriver.runtimeLayer,
  projectLayer,
)

const sessionsLayer = SessionV2.layer.pipe(Layer.provide(rootServices))
const metaAgentLayer = MetaAgentService.layer.pipe(Layer.provide(rootServices))
const delegationProjectorLayer = DelegationProjector.layer.pipe(Layer.provide(rootServices))
const delegationServiceLayer = DelegationService.layer.pipe(Layer.provide(rootServices))

const fillLayer = TaskDriverFill.layer.pipe(
  Layer.provide(sessionsLayer),
  Layer.provide(rootServices),
  Layer.provide(metaAgentLayer),
  Layer.provideMerge(TaskDriver.runtimeLayer),
)

const baseLayer = Layer.mergeAll(
  rootServices,
  sessionsLayer,
  metaAgentLayer,
  delegationProjectorLayer,
  delegationServiceLayer,
  fillLayer,
)

const it = testEffect(baseLayer)
const decodeRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))

function assertDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined()
}

describe("Phase 2: Internal Build Participant (TDD RED)", () => {
  const parentSessionID = SessionV2.ID.make("ses_parent_p2")
  const secondParentSessionID = SessionV2.ID.make("ses_parent_p2_other")

  it.effect("1. binds a Build participant to a child Session owned by the delegation parent", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Child Build Session",
      })
      const delegation = yield* delegationService.create({
        parentSessionID,
        title: "Build feature task",
      })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      expect(delegation.parentSessionID).toBe(parentSessionID)
      expect(delegation.status).toBe("draft")
      expect(participant.role).toBe("implementer")

      const sessionRows = yield* db.select().from(SessionTable).where(eq(SessionTable.id, childSession.id))
      expect(sessionRows).toHaveLength(1)
      expect(sessionRows[0]?.parent_id).toBe(parentSessionID)

      const storedParticipant = yield* db
        .select()
        .from(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.id, participant.id))
      expect(storedParticipant).toHaveLength(1)
      expect(storedParticipant[0]?.child_session_id).toBe(childSession.id)

      const state = yield* delegationService.foldState(delegation.id)
      expect(state?.participants.get(participant.id)?.childSessionID).toBe(childSession.id)
    }),
  )

  it.effect("2. appending a second Turn preserves the participant child Session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Child Build Session",
      })
      const delegation = yield* delegationService.create({ parentSessionID, title: "Two-turn task" })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      const turn1 = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "First instruction",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })
      const turn2 = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Second instruction",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      expect(turn1.seq).toBe(1)
      expect(turn2.seq).toBe(2)
      const state = yield* delegationService.foldState(delegation.id)
      expect(state?.participants.get(participant.id)?.childSessionID).toBe(childSession.id)
      expect(state?.turns.size).toBe(2)
    }),
  )

  it.effect("3. rejects binding a child Session from another parent delegation", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* seedDelegationParentSession(db, secondParentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Child A",
      })
      const delegationA = yield* delegationService.create({ parentSessionID, title: "Delegation A" })
      const delegationB = yield* delegationService.create({
        parentSessionID: secondParentSessionID,
        title: "Delegation B",
      })
      yield* delegationService.addParticipant({
        delegationID: delegationA.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })

      const result = yield* delegationService
        .addParticipant({
          delegationID: delegationB.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: childSession.id,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
    }),
  )

  it.effect("4. preserves explicit queue delivery while a BackgroundJob is running", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Background child",
      })
      const delegation = yield* delegationService.create({ parentSessionID, title: "Background queue test" })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn 1",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      const done = yield* Deferred.make<void>()
      yield* background.start({
        id: childSession.id,
        type: "task",
        run: Deferred.await(done).pipe(Effect.as("background result")),
      })
      expect((yield* background.get(childSession.id))?.status).toBe("running")

      const extended = yield* TaskDriver.extendBackground({
        parentID: parentSessionID,
        sessionID: childSession.id,
        prompt: "queued background work",
        description: "Queued turn",
      })
      expect(extended).toBe(true)

      const turn2 = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn 2",
        participantIDs: [participant.id],
        delivery: "queue",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })
      expect(turn2.delivery).toBe("queue")
      expect((yield* delegationService.foldState(delegation.id))?.turns.get(turn2.id)?.delivery).toBe("queue")

      yield* Deferred.succeed(done, undefined)
      yield* background.cancel(childSession.id)
    }),
  )

  it.effect("5. a settled BackgroundJob permits a new Turn on the same child Session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Settled background child",
      })
      const delegation = yield* delegationService.create({ parentSessionID, title: "Settled background test" })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const turn1 = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Background turn 1",
        participantIDs: [participant.id],
        delivery: "queue",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      yield* background.start({
        id: childSession.id,
        type: "task",
        run: Effect.succeed("result of turn 1"),
      })
      expect((yield* background.wait({ id: childSession.id })).info?.status).toBe("completed")
      yield* delegationService.recordDelivery({
        delegationID: delegation.id,
        turnID: turn1.id,
        participantID: participant.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "completed",
        summary: "result of turn 1",
      })

      const turn2 = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Background turn 2",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })
      expect(turn2.seq).toBe(2)
      const state = yield* delegationService.foldState(delegation.id)
      expect(state?.participants.get(participant.id)?.childSessionID).toBe(childSession.id)
      expect(state?.turns.size).toBe(2)
    }),
  )

  it.effect("6. records Build delivery lifecycle as canonical EventV2 facts", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Build delivery child",
      })
      const delegation = yield* delegationService.create({ parentSessionID, title: "Delivery lifecycle" })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      const turn = yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn 1",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      yield* delegationService.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "started",
      })
      const started = yield* DelegationProjector.readEvents(db, delegation.id)
      expect(started.some((event) => event.type === DelegationEvent.DeliveryStarted.type)).toBe(true)

      yield* delegationService.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "completed",
        summary: "Build succeeded",
      })
      const completed = yield* DelegationProjector.readEvents(db, delegation.id)
      expect(completed.some((event) => event.type === DelegationEvent.DeliveryCompleted.type)).toBe(true)
    }),
  )

  it.effect("7. keeps the child-session recursion predicate enabled", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/tmp/test-delegation") }),
        title: "Child session",
      })
      expect(yield* TaskDriver.isChildSession(childSession.id)).toBe(true)
      expect(yield* TaskDriver.isChildSession(parentSessionID)).toBe(false)
    }),
  )

  it.effect("8. parent interrupt does not complete or archive the Delegation and preserves inbox", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const sessions = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const childSession = yield* sessions.create({
        parentID: parentSessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
        title: "Interrupt child",
      })
      const delegation = yield* delegationService.create({ parentSessionID, title: "Interrupt test" })
      const participant = yield* delegationService.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childSession.id,
      })
      yield* delegationService.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn before interrupt",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      const done = yield* Deferred.make<void>()
      yield* background.start({
        id: childSession.id,
        type: "task",
        run: Deferred.await(done).pipe(Effect.as("in-flight work")),
      })
      yield* sessions.prompt({
        sessionID: childSession.id,
        prompt: { text: "pending child input" },
        resume: false,
      })
      const inputsBefore = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, childSession.id))

      yield* sessions.interrupt(parentSessionID)

      const state = yield* delegationService.foldState(delegation.id)
      expect(state?.delegation.status).not.toBe("archived")
      expect(state?.delegation.status).not.toBe("completed")
      const inputsAfter = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, childSession.id))
      expect(inputsAfter.length).toBe(inputsBefore.length)

      yield* Deferred.succeed(done, undefined)
      yield* background.cancel(childSession.id)
    }),
  )

  it.effect("9. excludes cancelled Delegations from the active projection candidate set", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      const events = yield* EventV2.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const first = yield* delegationService.create({ parentSessionID, title: "Active task 1" })
      const participant = yield* delegationService.addParticipant({
        delegationID: first.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      yield* delegationService.appendTurn({
        delegationID: first.id,
        kind: "task",
        promptSummary: "Activity turn 1",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      const activeRows = yield* db
        .select()
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentSessionID))
      expect(activeRows).toHaveLength(1)
      expect(activeRows[0]?.status).not.toBe("cancelled")

      yield* events.publish(DelegationEvent.Cancelled, {
        delegationID: first.id,
        timestamp: Date.now(),
      })
      yield* DelegationProjector.rebuild(db, first.id)

      const cancelled = yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, first.id))
      expect(cancelled[0]?.status).toBe("cancelled")
    }),
  )

  it.effect("10. isolates explicit Turn appends between coexisting Delegations", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationService = yield* DelegationService.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const delegationA = yield* delegationService.create({ parentSessionID, title: "Delegation A" })
      const participantA = yield* delegationService.addParticipant({
        delegationID: delegationA.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const delegationB = yield* delegationService.create({ parentSessionID, title: "Delegation B" })
      const participantB = yield* delegationService.addParticipant({
        delegationID: delegationB.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      expect(delegationA.id).not.toBe(delegationB.id)
      yield* delegationService.appendTurn({
        delegationID: delegationA.id,
        kind: "task",
        promptSummary: "Turn for A",
        participantIDs: [participantA.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participantA.id },
      })
      yield* delegationService.appendTurn({
        delegationID: delegationB.id,
        kind: "task",
        promptSummary: "Turn 1 for B",
        participantIDs: [participantB.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participantB.id },
      })
      yield* delegationService.appendTurn({
        delegationID: delegationB.id,
        kind: "task",
        promptSummary: "Turn 2 for B",
        participantIDs: [participantB.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participantB.id },
      })

      const stateA = yield* delegationService.foldState(delegationA.id)
      const stateB = yield* delegationService.foldState(delegationB.id)
      expect(stateA?.turns.size).toBe(1)
      expect(stateB?.turns.size).toBe(2)
    }),
  )

  it.effect("11. keeps delegationID and turnID in the output contract without deliveryID", () =>
    Effect.gen(function* () {
      const outputFields = TaskTool.Output.fields
      expect("sessionID" in outputFields).toBe(true)
      expect("output" in outputFields).toBe(true)
      expect("delegationID" in outputFields).toBe(true)
      expect("turnID" in outputFields).toBe(true)
      expect("deliveryID" in outputFields).toBe(false)

      const decoded = decodeRecord(
        Schema.decodeUnknownSync(TaskTool.Output)({
          sessionID: "ses_child_p2",
          output: "Build completed successfully",
          delegationID: "dlg_sample_123",
          turnID: "trn_sample_456",
        }),
      )
      expect(decoded.delegationID).toBe("dlg_sample_123")
      expect(decoded.turnID).toBe("trn_sample_456")
      expect(decoded.deliveryID).toBeUndefined()
    }),
  )

  it.effect("12. settles the MetaAgentStep created for an internal delegation", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const metaAgent = yield* MetaAgentService.Service
      yield* seedDelegationParentSession(db, parentSessionID)

      const parentMeta = yield* metaAgent.create({
        title: "Meta parent",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai" },
      })
      yield* metaAgent.attach({
        metaID: parentMeta.id,
        sessionID: parentSessionID,
        role: "orchestrator",
      })
      const child = yield* TaskDriver.createChild({
        parentID: parentSessionID,
        agent: AgentV2.ID.make("build"),
      })

      const initialSteps = yield* db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(eq(MetaAgentStepTable.meta_agent_session_id, parentSessionID), eq(MetaAgentStepTable.engine, "build")),
        )
      expect(initialSteps.length).toBeGreaterThan(0)
      const targetStep = initialSteps[0]
      assertDefined(targetStep)
      expect(targetStep.status).toBe("running")

      yield* TaskDriver.delegate({
        sessionID: child.id,
        parentID: parentSessionID,
        prompt: "echo done",
      }).pipe(Effect.exit)

      const settledRows = yield* db.select().from(MetaAgentStepTable).where(eq(MetaAgentStepTable.id, targetStep.id))
      expect(settledRows).toHaveLength(1)
      const settledStep = settledRows[0]
      assertDefined(settledStep)
      expect(settledStep.status).not.toBe("running")
      expect(["completed", "failed"]).toContain(settledStep.status)
    }),
  )
})
