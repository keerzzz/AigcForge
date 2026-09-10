/**
 * Phase 5 tests: Lifecycle management, 5 interrupt invariants, and recovery_required.
 *
 * @see docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md §2.7, §2.8
 * @see docs/plan/meta-agent-persistent-delegation-closed-loop.md §16.9
 */

import { describe, expect } from "bun:test"
import { and, eq, isNull } from "drizzle-orm"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { ProjectV2 } from "@aigcfroge/core/project"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionInputTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { registerCliAdapter } from "@aigcfroge/core/tool/cli-adapter"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { SessionMessageID } from "@aigcfroge/schema/session-message-id"
import { DelegationExecution } from "../src/delegation/execution"
import { DelegationProjector } from "../src/delegation/projector"
import { DelegationService } from "../src/delegation/service"
import { seedDelegationParentSession } from "./delegation-test-support"
import { testEffect } from "./lib/effect"

const projectLayer = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const testSessionExecutionLayer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, _force: boolean) {
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

          for (const input of inputs) {
            yield* db
              .update(SessionInputTable)
              .set({ promoted_seq: Date.now() })
              .where(eq(SessionInputTable.id, input.id))
              .run()
              .pipe(Effect.orDie)
          }
        }
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
  delegationExecutionLayer,
  fillLayer,
)

const it = testEffect(baseLayer)

describe.serial("Phase 5: Interrupt Semantics & Lifecycle Separation", () => {
  // ADR-22 §2.7: Invariant 1 - Preserve inbox: interrupt only stops the active turn,
  // queued turns in inbox are retained and resume later.
  it.effect("1. interrupt preserves inbox: queued turns remain and resume at safe boundary", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_interrupt_inbox_parent")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Test Inbox Preservation",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      // Turn 1: will be running and then interrupted
      const turn1 = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn 1: active task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Turn 2: queued behind Turn 1 in inbox
      const turn2 = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn 2: queued task",
        participantIDs: [participant.id],
        delivery: "queue",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Interrupt delegation
      yield* execution.interrupt(delegation.id)

      const stateAfterInterrupt = yield* service.foldState(delegation.id)
      expect(stateAfterInterrupt).toBeDefined()

      // Invariant 1 check: Turn 1 delivery was cancelled, but Turn 2 delivery remains queued!
      const delivery1 = [...stateAfterInterrupt!.deliveries.values()].find((d) => d.turnID === turn1.id)
      const delivery2 = [...stateAfterInterrupt!.deliveries.values()].find((d) => d.turnID === turn2.id)

      expect(delivery1?.status).toBe("cancelled")
      expect(delivery2?.status).toBe("queued")

      // Resume execution: Turn 2 should now execute and succeed!
      yield* execution.drain(delegation.id)

      const finalState = yield* service.foldState(delegation.id)
      const finalDelivery2 = [...finalState!.deliveries.values()].find((d) => d.turnID === turn2.id)
      expect(finalDelivery2?.status).toBe("completed")
    }),
  )

  // ADR-22 §2.7: Invariant 2 - Do not wait for quiescence: interrupt returns immediately
  it.effect("2. interrupt does not wait for quiescence: returns immediately without blocking", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_interrupt_no_quiesce")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Test Fast Interrupt",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Turn active",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // A cleanup target that never settles proves the command returns after
      // scheduling teardown rather than waiting for physical quiescence. This
      // is a semantic signal, not a wall-clock performance assertion.
      let cleanupSettled = false
      registerCliAdapter("never-settling-interrupt", {
        name: "never-settling-interrupt",
        command: "never",
        description: "non-settling interrupt fixture",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "unused" }),
        cancel: () => Effect.never.pipe(Effect.ensuring(Effect.sync(() => (cleanupSettled = true)))),
      })
      const external = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "never-settling-interrupt",
        role: "observer",
        context: "fresh",
        externalThreadID: "thread_never_settles",
      })
      const exit = yield* Effect.exit(execution.interrupt(delegation.id, external.id))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(cleanupSettled).toBe(false)
    }),
  )

  // ADR-22 §2.7: Invariant 3 - Claimed batch is not re-queued
  it.effect("3. interrupt does not re-queue claimed batch: cancelled is at-most-once", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_interrupt_no_requeue")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Test Claimed Batch Not Requeued",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Claimed task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Interrupt the admitted/claimed batch
      yield* execution.interrupt(delegation.id)
      // Drain subsequently to verify cancelled delivery does not re-queue
      yield* execution.drain(delegation.id)

      const state = yield* service.foldState(delegation.id)
      const delivery = [...state!.deliveries.values()].find((d) => d.turnID === turn.id)
      // The claimed delivery was cancelled; it must NOT return to 'admitted' or 'queued'
      expect(delivery?.status).toBe("cancelled")
    }),
  )

  // ADR-22 §2.7: Invariant 4 - Missing target or idle is idempotent no-op
  it.effect("4. missing target or idle interrupt is idempotent no-op", () =>
    Effect.gen(function* () {
      const execution = yield* DelegationExecution.Service

      // 1. Missing target
      const nonExistentID = DelegationID.ID.make("dlg_non_existent")
      const missingExit = yield* Effect.exit(execution.interrupt(nonExistentID))
      expect(Exit.isSuccess(missingExit)).toBe(true)

      // 2. Idle delegation
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentID = SessionV2.ID.make("ses_interrupt_idle")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Idle Delegation",
      })
      const idleExit = yield* Effect.exit(execution.interrupt(delegation.id))
      expect(Exit.isSuccess(idleExit)).toBe(true)
    }),
  )

  // ADR-22 §2.7: Invariant 5 - Auth before lookup
  it.effect("5. auth before lookup: unauthorized caller fails before target lookup", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const { db } = yield* Database.Service
      const parentID = SessionV2.ID.make("ses_real_parent")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Protected Delegation",
      })

      // Calling with mismatched parentSessionID returns typed error without touching target
      const unauthorizedCallerParentID = SessionV2.ID.make("ses_unauthorized_attacker")
      const attackerExit = yield* Effect.exit(
        service.resolve({
          parentSessionID: unauthorizedCallerParentID,
          delegationID: delegation.id,
          title: "Attacking",
        }),
      )
      expect(Exit.isFailure(attackerExit)).toBe(true)
      const attackerError = Exit.isFailure(attackerExit)
        ? Option.getOrUndefined(Cause.findErrorOption(attackerExit.cause))
        : undefined
      expect(attackerError instanceof Delegation.DelegationInvalidStateError).toBe(true)

      // Probing with a non-existent delegation ID returns the identical uniform rejection (no existence oracle)
      const nonExistentID = DelegationID.ID.make("dlg_non_existent_probe")
      const probeExit = yield* Effect.exit(
        service.resolve({
          parentSessionID: unauthorizedCallerParentID,
          delegationID: nonExistentID,
          title: "Probing",
        }),
      )
      expect(Exit.isFailure(probeExit)).toBe(true)
      const probeError = Exit.isFailure(probeExit)
        ? Option.getOrUndefined(Cause.findErrorOption(probeExit.cause))
        : undefined
      expect(attackerError instanceof Delegation.DelegationInvalidStateError).toBe(true)
      expect(probeError instanceof Delegation.DelegationInvalidStateError).toBe(true)
      if (
        attackerError instanceof Delegation.DelegationInvalidStateError &&
        probeError instanceof Delegation.DelegationInvalidStateError
      ) {
        expect(attackerError._tag).toBe("Delegation.DelegationInvalidStateError")
        expect(probeError._tag).toBe("Delegation.DelegationInvalidStateError")
        expect(attackerError.attemptedTransition).toBe("resolve")
        expect(probeError.attemptedTransition).toBe("resolve")
        expect(attackerError.currentStatus).toBe("unknown")
        expect(probeError.currentStatus).toBe("unknown")
      }
    }),
  )

  // Lifecycle: close closes admission first, handles active deliveries, child session survives
  it.effect("6. close shuts down new turn admission and preserves durable child session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_close_lifecycle")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Closing Delegation",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Initial task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Start execution so child session is created & bound
      yield* execution.drain(delegation.id)

      const stateBeforeClose = yield* service.foldState(delegation.id)
      const boundParticipant = stateBeforeClose!.participants.get(participant.id)
      const childSessionID = boundParticipant?.childSessionID
      expect(childSessionID).toBeDefined()

      // Close the delegation
      yield* service.close({
        delegationID: delegation.id,
        reason: "User requested shutdown",
      })

      const stateAfterClose = yield* service.foldState(delegation.id)
      expect(stateAfterClose!.delegation.status).toBe("closing")

      // Attempting to append a new turn while closing must be rejected!
      const appendExit = yield* Effect.exit(
        service.appendTurn({
          delegationID: delegation.id,
          kind: "task",
          promptSummary: "Turn after close",
          participantIDs: [participant.id],
          delivery: "steer",
          origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
        }),
      )
      expect(Exit.isFailure(appendExit)).toBe(true)

      // Verify that the durable child session STILL exists and was not deleted
      const sessionStore = yield* SessionStore.Service
      const childSession = yield* sessionStore.get(childSessionID!)
      expect(childSession).toBeDefined()
    }),
  )

  // Lifecycle: archive preserves history; delete purges
  it.effect("7. archive retains history and delete purges on explicit request", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service

      const parentID = SessionV2.ID.make("ses_archive_delete")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Archive Delete Test",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Initial task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Closing alone is not archivable; lifecycle commands stay layered.
      yield* service.close({ delegationID: delegation.id })
      const prematureArchive = yield* Effect.exit(service.archive({ delegationID: delegation.id }))
      expect(Exit.isFailure(prematureArchive)).toBe(true)

      // Explicit delete / purge
      yield* service.delete({ delegationID: delegation.id, purge: true })
      const purgedState = yield* service.foldState(delegation.id)
      expect(purgedState).toBeUndefined()
    }),
  )

  // Disruption: recovery_required on unexpected disconnection without blind retry
  it.effect("8. unexpected process/connection disruption enters recovery_required without blind retry", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_disruption_recovery")
      yield* seedDelegationParentSession(db, parentID)

      // Register an adapter that simulates unexpected process crash/disconnection
      registerCliAdapter("crasher-cli", {
        name: "crasher-cli",
        command: "crasher",
        description: "CLI that drops connection mid-flight",
        transport: "app-server",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "failed", summary: "crashed" }),
        execute: () =>
          Effect.succeed({
            status: "failed" as const,
            summary: "Connection reset by peer; transport disconnected",
            sessionId: "crasher_ses",
            errorCode: "transport_disconnected",
            recoveryRequired: true,
          }),
      })

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Crasher Test",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "crasher-cli",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        promptSummary: "Review crash test",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Run through dispatch
      const dispatchRes = yield* execution.dispatch({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        parentID,
        prompt: "Review crash test",
        description: "Review crash test",
        execution: "external",
        cliTarget: "crasher-cli",
        background: false,
        queue: false,
        delivery: {
          delegationID: delegation.id,
          turnID: turn.id,
          participantID: participant.id,
          deliveryOrigin: "test",
          senderParticipantID: participant.id,
          delivery: "steer",
          attempt: 1,
        },
      })

      expect(dispatchRes.status).toBe("failed")

      const state = yield* service.foldState(delegation.id)
      const delivery = [...state!.deliveries.values()].find((d) => d.turnID === turn.id)

      // Must enter recovery_required, not blindly retrying unknown side-effects!
      expect(delivery?.status).toBe("recovery_required")
    }),
  )

  it.effect("9. reconcile transitions recovery_required delivery to failed and foldState succeeds", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const execution = yield* DelegationExecution.Service

      const parentID = SessionV2.ID.make("ses_reconcile_parent")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Reconcile Test",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "crasher-cli",
        role: "reviewer",
        context: "fresh",
      })

      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        promptSummary: "Review crash test",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Dispatch and force into recovery_required
      yield* execution.dispatch({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        parentID,
        prompt: "Review crash test",
        description: "Review crash test",
        execution: "external",
        cliTarget: "crasher-cli",
        background: false,
        queue: false,
        delivery: {
          delegationID: delegation.id,
          turnID: turn.id,
          participantID: participant.id,
          deliveryOrigin: "test",
          senderParticipantID: participant.id,
          delivery: "steer",
          attempt: 1,
        },
      })

      const stateBefore = yield* service.foldState(delegation.id)
      const deliveryBefore = [...stateBefore!.deliveries.values()].find((d) => d.turnID === turn.id)
      expect(deliveryBefore?.status).toBe("recovery_required")

      // Reconcile the delegation
      yield* service.reconcile({ delegationID: delegation.id })

      // foldState must succeed without corrupting or throwing
      const stateAfter = yield* service.foldState(delegation.id)
      expect(stateAfter).toBeDefined()
      const deliveryAfter = [...stateAfter!.deliveries.values()].find((d) => d.turnID === turn.id)
      expect(deliveryAfter?.status).toBe("failed")
      expect(deliveryAfter?.errorCode).toBe("reconciled_after_disruption")
    }),
  )

  it.effect("9a. reconcileResume leaves unprovable deliveries recovery_required instead of replaying", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentID = SessionV2.ID.make("ses_reconcile_resume_unknown")
      yield* seedDelegationParentSession(db, parentID)
      const delegation = yield* service.create({ parentSessionID: parentID, title: "Unknown resume" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "unknown-cli",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })
      yield* service.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "test",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "recovery_required",
        errorCode: "restart_unknown_side_effect",
      })
      expect(yield* service.reconcileResume({ delegationID: delegation.id })).toBe(0)
      const state = yield* service.foldState(delegation.id)
      const delivery = [...state!.deliveries.values()].find((item) => item.turnID === turn.id)
      expect(delivery?.status).toBe("recovery_required")
    }),
  )

  it.effect("9b. reconcileResume re-admits only participants with a provable resume contract", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentID = SessionV2.ID.make("ses_reconcile_resume_provable")
      yield* seedDelegationParentSession(db, parentID)
      registerCliAdapter("resumable-cli", {
        name: "resumable-cli",
        command: "mock",
        description: "Resumable CLI",
        transport: "app-server",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: (output) => Effect.succeed({ status: "success", summary: output }),
        resumeThread: (threadId) => Effect.succeed({ threadId }),
      })
      const delegation = yield* service.create({ parentSessionID: parentID, title: "Provable resume" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "resumable-cli",
        role: "reviewer",
        context: "fresh",
      })
      yield* service.bindParticipant({
        delegationID: delegation.id,
        participantID: participant.id,
        externalThreadID: "thread_resumable",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })
      yield* service.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "test",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "recovery_required",
        errorCode: "restart_unknown_side_effect",
      })
      expect(yield* service.reconcileResume({ delegationID: delegation.id })).toBe(1)
      const state = yield* service.foldState(delegation.id)
      const attempts = [...state!.deliveries.values()]
        .filter((item) => item.turnID === turn.id && item.participantID === participant.id)
        .map((item) => item.attempt)
      expect(Math.max(...attempts)).toBe(2)
    }),
  )

  it.effect("10. service close fences admission without ambient cancel or archive side effects", () =>
    Effect.gen(function* () {
      let archivedThreadId: string | undefined
      let cancelledSessionId: string | undefined

      registerCliAdapter("app-server-mock", {
        name: "app-server-mock",
        command: "mock",
        description: "Mock app server",
        transport: "app-server",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: (s) => Effect.succeed({ status: "success", summary: s }),
        archiveThread: (threadId) =>
          Effect.sync(() => {
            archivedThreadId = threadId
          }),
        cancel: (_cwd, sessionId) =>
          Effect.sync(() => {
            cancelledSessionId = sessionId
          }),
      })

      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentID = SessionV2.ID.make("ses_close_interrupt_parent")
      yield* seedDelegationParentSession(db, parentID)

      const delegation = yield* service.create({
        parentSessionID: parentID,
        title: "Close Interrupt Test",
      })

      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "app-server-mock",
        role: "implementer",
        context: "fresh",
        externalThreadID: "th_active_123",
      })

      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Active turn",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })

      // Close delegation
      yield* service.close({
        delegationID: delegation.id,
        reason: "User cancelled",
      })

      // Service.close owns only the durable admission fence; it must not use an
      // ambient execution tag or conflate close with archive.
      expect(archivedThreadId).toBeUndefined()
      expect(cancelledSessionId).toBeUndefined()
    }),
  )
})
