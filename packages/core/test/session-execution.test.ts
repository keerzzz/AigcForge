import type { FileSystem } from "@aigcfroge/core/filesystem"
import { describe, expect, test } from "bun:test"
import { AIError, TransportError } from "@aigcfroge/ai"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Instance } from "@aigcfroge/core/instance/service"
import { Job } from "@aigcfroge/core/job"
import { Git } from "@aigcfroge/core/git"
import { AppProcess } from "@aigcfroge/util/process"
import { KV } from "@aigcfroge/core/kv"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import type { LocationServices } from "@aigcfroge/core/location-services"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRestart } from "@aigcfroge/core/session/execution/restart"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@aigcfroge/core/delegation/sql"
import { EventTable } from "@aigcfroge/core/event/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionRunner } from "@aigcfroge/core/session/runner/index"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ScheduleExecution } from "@aigcfroge/core/session/schedule-execution"
import { SessionInboxTable, SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskOperation } from "@aigcfroge/core/session/task-operation"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { Agent } from "@aigcfroge/schema/agent"
import { Event } from "@aigcfroge/schema/event"
import { Model } from "@aigcfroge/schema/model"
import { Money } from "@aigcfroge/schema/money"
import { Provider } from "@aigcfroge/schema/provider"
import { Schedule } from "@aigcfroge/schema/schedule"
import { SessionAttempt } from "@aigcfroge/schema/session-attempt"
import { Credential } from "@aigcfroge/schema/credential"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Hash } from "@aigcfroge/util/hash"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, LayerMap, Scope, Stream } from "effect"
import { asc, eq, inArray, sql } from "drizzle-orm"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { withCustomMode } from "./lib/product-mode"

const nodes = LayerNode.group([
  Git.node,
  AppProcess.node,
  Database.node,
  Bus.node,
  SessionStore.node,
  SessionTask.node,
  ScheduleService.node,
  SessionInbox.node,
  SessionGoal.node,
  Job.node,
  KV.node,
  Session.node,
  SessionComposition.node,
  DelegationService.node,
  FSUtil.node,
])
const it = testEffect(AppNodeBuilder.build(nodes))

describe("SessionExecution lifecycle", () => {
  for (const outcome of ["failed", "interrupted", "shutdown"] as const) {
    it.effect(`resolves admitted input from production execution ${outcome}`, () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const sessionID = Session.ID.create()
        const inputID = SessionMessage.ID.create()
        yield* seedSessions(database, [sessionID])
        yield* inbox.admit({
          id: inputID,
          sessionID,
          item: { type: "synthetic", payload: { text: "Run" }, delivery: "steer" },
        })
        const promoted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const context = yield* buildExecution(scope, () =>
          Effect.gen(function* () {
            yield* SessionInbox.promote(database.db, bus, sessionID, "steer", undefined, { anchorInputID: inputID })
            yield* Deferred.succeed(promoted, undefined)
            if (outcome !== "failed") return yield* Effect.never
            yield* Deferred.await(release)
            return yield* new AIError({
              reason: new TransportError({ message: "Disconnected", transport: "http", operation: "request" }),
            })
          }),
        )
        const execution = Context.get(context, SessionExecution.Service)
        const run = yield* execution.resume(sessionID).pipe(Effect.forkIn(scope))
        yield* Deferred.await(promoted)
        expect(yield* SessionInputResult.read(database.db, { sessionID, inputID })).toMatchObject({
          status: "processing",
          sharedInputs: [inputID],
        })
        if (outcome === "failed") yield* Deferred.succeed(release, undefined)
        if (outcome === "interrupted") yield* execution.interrupt(sessionID)
        if (outcome === "shutdown") yield* Scope.close(scope, Exit.void)
        yield* Fiber.await(run)
        yield* execution.awaitIdle(sessionID)
        const result = yield* SessionInputResult.read(database.db, { sessionID, inputID })
        expect(result).toMatchObject({ status: outcome === "shutdown" ? "processing" : outcome })
        if (outcome === "failed") expect(result).toMatchObject({ error: { type: "provider.transport" } })
      }),
    )
  }

  test("classifies success and typed failure terminals", () => {
    expect(SessionExecution.terminal(Exit.succeed(undefined))).toEqual({ type: "succeeded" })
    expect(
      SessionExecution.terminal(
        Exit.fail(
          new AIError({
            reason: new TransportError({ message: "Disconnected", transport: "http", operation: "request" }),
          }),
        ),
      ),
    ).toEqual({ type: "failed", error: { type: "provider.transport", message: "Disconnected" } })
  })

  test("defaults owner-scope interruption to shutdown and preserves explicit reasons", () => {
    const interrupted = Effect.runSyncExit(Effect.interrupt)
    expect(SessionExecution.terminal(interrupted)).toEqual({ type: "interrupted", reason: "shutdown" })
    expect(SessionExecution.terminal(interrupted, "user")).toEqual({ type: "interrupted", reason: "user" })
  })

  it.effect("the sweep only lists claimed top-level Sessions", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const parent = Session.ID.make("ses_recover_parent")
      const child = Session.ID.make("ses_recover_child")
      const idle = Session.ID.make("ses_recover_idle")
      yield* seedSessions(database, [parent], { time_suspended: Date.now() })
      yield* seedSessions(database, [idle])
      // Children recover through background Job records, never through the root claim sweep.
      yield* seedSessions(database, [child], { time_suspended: Date.now(), parent_id: parent })

      expect(yield* store.listSuspended()).toEqual([parent])

      // The sweep clears orphaned child claims outright; parents keep theirs.
      yield* store.releaseChildClaims([])
      expect(yield* claims(database)).toEqual({ [parent]: true, [child]: false, [idle]: false })
    }),
  )

  it.effect("claims at execution start, releases on completion, and preserves through teardown", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const interrupted = Session.ID.make("ses_claim_interrupted")
      const completed = Session.ID.make("ses_claim_completed")
      yield* seedSessions(database, [interrupted, completed])

      // Each drain signals once it runs; the claim commits before the drain starts.
      const interruptedRunning = yield* Deferred.make<void>()
      const completedRunning = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID }) =>
        sessionID === completed
          ? Deferred.succeed(completedRunning, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Deferred.succeed(interruptedRunning, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const completedActive = execution.isActive(completed)
      expect(yield* completedActive).toBe(false)
      yield* execution.resume(interrupted).pipe(Effect.forkScoped)
      const completing = yield* execution.resume(completed).pipe(Effect.forkIn(scope))
      yield* Deferred.await(interruptedRunning)
      yield* Deferred.await(completedRunning)

      // The write-ahead claim exists WHILE the turns run — no shutdown hook involved.
      expect(yield* claims(database)).toEqual({ [interrupted]: true, [completed]: true })
      expect(yield* completedActive).toBe(true)
      expect(yield* execution.isActive(interrupted)).toBe(true)

      // A drain that finishes on its own releases its claim.
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(completing)
      yield* execution.awaitIdle(completed)
      expect((yield* claims(database))[completed]).toBe(false)
      expect(yield* completedActive).toBe(false)
      expect(yield* execution.isActive(interrupted)).toBe(true)

      // Teardown interruption (graceful twin of an unclean death) preserves the claim
      // for the next server start.
      yield* Scope.close(scope, Exit.void)
      expect((yield* claims(database))[interrupted]).toBe(true)
      expect(yield* execution.isActive(interrupted)).toBe(false)
    }),
  )

  it.effect("a user interrupt releases the claim so the turn never resurrects", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_claim_user_cancel")
      yield* seedSessions(database, [sessionID])

      const draining = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () =>
        Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(draining)
      expect((yield* claims(database))[sessionID]).toBe(true)

      expect(yield* execution.interrupt(sessionID)).toBeTrue()
      yield* execution.awaitIdle(sessionID)
      expect((yield* claims(database))[sessionID]).toBe(false)
    }),
  )

  it.effect("reports an idle interrupt as a no-op", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_idle_cancel")
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.never)
      const execution = Context.get(context, SessionExecution.Service)

      expect(yield* execution.interrupt(sessionID)).toBeFalse()
      expect(yield* execution.active).not.toContain(sessionID)
      expect(yield* execution.isActive(sessionID)).toBe(false)
    }),
  )

  it.effect("does not resume a user-cancelled background child whose notification was not admitted", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const parent = Session.ID.make("ses_cancelled_background_parent")
      const child = Session.ID.make("ses_cancelled_background_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent })

      const running = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
      const context = yield* buildExecution(
        scope,
        () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
        undefined,
        jobs,
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "general",
          description: "Cancelled inspection",
        },
        run: execution.resume(child).pipe(Effect.as("unused")),
      })
      yield* jobs.background(child)
      yield* Deferred.await(running)
      expect(yield* execution.interrupt(child)).toBeTrue()
      yield* execution.awaitIdle(child)
      expect((yield* jobs.wait({ id: child })).info?.status).toBe("cancelled")
      expect(yield* jobs.pendingBackground).toMatchObject([{ id: child, status: "cancelled" }])
      expect((yield* claims(database))[child]).toBe(false)
      yield* Scope.close(scope, Exit.void)

      const restartedScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(restartedScope, Exit.void))
      const restartedJobs = yield* Job.make.pipe(Scope.provide(restartedScope))
      const drained: Session.ID[] = []
      const restarted = yield* buildExecution(
        restartedScope,
        ({ sessionID }) => Effect.sync(() => void drained.push(sessionID)),
        undefined,
        restartedJobs,
      )
      yield* Context.get(restarted, SessionRestart.Service).resumeSuspendedSessions
      yield* Context.get(restarted, SessionExecution.Service).awaitIdle(parent)
      expect(drained).toEqual([parent])
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        { payload: { text: expect.stringContaining("Subagent cancelled"), metadata: { state: "cancelled" } } },
      ])
      expect(yield* restartedJobs.pendingBackground).toEqual([])
    }),
  )

  it.effect("starts every claimed execution without waiting for earlier drains to finish", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionIDs = Array.from({ length: 5 }, (_, index) => Session.ID.make(`ses_resume_concurrent_${index}`))
      yield* seedSessions(database, sessionIDs, { time_suspended: Date.now() })

      const fourStarted = yield* Deferred.make<void>()
      const started: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID }) =>
        Effect.sync(() => {
          started.push(sessionID)
          if (started.length === 4) Deferred.doneUnsafe(fourStarted, Effect.void)
        }).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const restart = Context.get(context, SessionRestart.Service)
      yield* restart.resumeSuspendedSessions.pipe(Effect.forkIn(scope))
      yield* Deferred.await(fourStarted)

      expect([...(yield* execution.active)].toSorted()).toEqual(sessionIDs.toSorted())
    }),
  )

  it.effect("resumes each claimed Session at most once", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const first = Session.ID.make("ses_resume_first")
      const second = Session.ID.make("ses_resume_second")
      yield* seedSessions(database, [first, second], { time_suspended: Date.now() })

      const drained: string[] = []
      const bothDraining = yield* Deferred.make<void>()
      const continued: SessionEvent.Synthetic[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID }) =>
        Effect.sync(() => {
          drained.push(sessionID)
          if (drained.length === 2) Deferred.doneUnsafe(bothDraining, Effect.void)
        }),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const restart = Context.get(context, SessionRestart.Service)
      yield* bus.project(SessionEvent.Synthetic, (event) => Effect.sync(() => void continued.push(event)))

      // The sweep forks resumed drains, so completion is observed through the executions.
      yield* restart.resumeSuspendedSessions
      yield* Deferred.await(bothDraining)
      yield* Effect.forEach([first, second], execution.awaitIdle, { discard: true })
      expect(drained.toSorted()).toEqual([first, second])
      expect(continued.map((event) => event.data).toSorted((a, b) => a.sessionID.localeCompare(b.sessionID))).toEqual(
        [first, second].map((sessionID) => ({
          sessionID,
          text: "The server restarted while you were working. Continue from where you left off without repeating completed work.",
          description: "Continuing after restart",
          metadata: { notice: "restart" },
        })),
      )
      // Drains completed naturally, so claims are released and counters reset.
      expect(yield* claims(database)).toEqual({ [first]: false, [second]: false })
      expect(yield* attempts(database, first)).toBe(0)

      yield* restart.resumeSuspendedSessions
      expect(drained.length).toBe(2)
      expect(continued.length).toBe(2)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.live("resumes a claimed root after reopening retained Delegation history with persistence disabled", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const parent = Session.ID.create()
      const child = Session.ID.create()
      const backgroundChild = Session.ID.create()
      const root = Session.ID.create()
      const delegationID = DelegationID.ID.create()
      const graph = (persist: boolean) =>
        AppNodeBuilder.build(nodes, [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.configured({ path: `${directory.path}/restart.db` })),
          Bus.node.replace(Bus.configured({ persist })),
        ])
      const retained = (database: Database.Service["Service"]) =>
        Effect.all({
          children: database.db
            .select({ id: SessionTable.id, claim: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
            .from(SessionTable)
            .where(inArray(SessionTable.id, [child, backgroundChild]))
            .orderBy(asc(SessionTable.id))
            .all()
            .pipe(Effect.orDie),
          delegation: database.db
            .select()
            .from(DelegationTable)
            .where(eq(DelegationTable.id, delegationID))
            .get()
            .pipe(Effect.orDie),
          participants: database.db
            .select()
            .from(DelegationParticipantTable)
            .where(eq(DelegationParticipantTable.delegation_id, delegationID))
            .all()
            .pipe(Effect.orDie),
          turns: database.db
            .select()
            .from(DelegationTurnTable)
            .where(eq(DelegationTurnTable.delegation_id, delegationID))
            .all()
            .pipe(Effect.orDie),
          events: database.db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, delegationID))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie),
        })
      const before = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const store = yield* SessionStore.Service
        const delegations = yield* DelegationService.Service
        const jobs = yield* Job.Service
        expect(bus.retainsEvents).toBeTrue()
        yield* seedSessions(database, [parent, root], { mode: "coding" })
        yield* seedSessions(database, [child, backgroundChild], { mode: "coding", parent_id: parent })
        yield* delegations.create({ delegationID, parentSessionID: parent, title: "Retained worker" })
        const participant = yield* delegations.addParticipant({
          delegationID,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          childSessionID: child,
        })
        const backgroundParticipant = yield* delegations.addParticipant({
          delegationID,
          provider: "internal",
          target: "review",
          role: "reviewer",
          context: "fresh",
          childSessionID: backgroundChild,
        })
        // Delivery admission can survive a crash before its Session input or Job marker is written.
        yield* delegations.appendTurn({
          delegationID,
          kind: "task",
          delivery: "queue",
          participantIDs: [participant.id, backgroundParticipant.id],
          origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
        })
        expect((yield* delegations.foldState(delegationID))?.deliveries.size).toBe(2)
        yield* Effect.forEach([child, backgroundChild], store.claim, { discard: true })
        yield* store.countResume(child)
        yield* store.countResume(child)
        yield* store.countResume(backgroundChild)
        const job = yield* jobs.start({
          id: `delegation:${backgroundParticipant.id}`,
          type: "delegation",
          notificationID: SessionMessage.ID.create(),
          recovery: {
            kind: "delegation",
            delegationID,
            participantID: backgroundParticipant.id,
            childSessionID: backgroundChild,
            parentSessionID: parent,
            description: "Retained worker",
          },
          run: Effect.succeed("Outcome awaiting retained-history reconciliation"),
        })
        yield* jobs.wait({ id: job.id })
        yield* jobs.background(job.id)
        expect(yield* jobs.pendingBackground).toMatchObject([{ status: "completed" }])
        yield* store.claim(root)
        expect(yield* store.listSuspended()).toEqual([root])
        return { state: yield* retained(database), background: yield* jobs.pendingBackground }
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph(true))))

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const store = yield* SessionStore.Service
        const jobs = yield* Job.Service
        expect(bus.retainsEvents).toBeFalse()
        expect(yield* retained(database)).toEqual(before.state)
        expect(yield* jobs.pendingBackground).toEqual(before.background)
        expect(yield* store.listSuspended()).toEqual([root])
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const started = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const drained: Session.ID[] = []
        const context = yield* buildExecution(scope, (input) =>
          Effect.sync(() => void drained.push(input.sessionID)).pipe(
            Effect.andThen(input.sessionID === root ? Deferred.succeed(started, undefined) : Effect.void),
            Effect.andThen(Deferred.await(finish)),
          ),
        )
        const execution = Context.get(context, SessionExecution.Service)
        const restart = Context.get(context, SessionRestart.Service)
        yield* restart.resumeSuspendedSessions
        yield* awaitWithTimeout(Deferred.await(started), "Claimed root was not resumed after persistence was disabled")
        expect(yield* attempts(database, root)).toBe(1)
        expect(drained).toEqual([root])
        yield* Deferred.succeed(finish, undefined)
        yield* execution.awaitIdle(root)
        yield* restart.resumeSuspendedSessions
        expect(drained).toEqual([root])
        expect(yield* claims(database)).toEqual({
          [parent]: false,
          [child]: true,
          [backgroundChild]: true,
          [root]: false,
        })
        expect(yield* attempts(database, root)).toBe(0)
        expect(yield* retained(database)).toEqual(before.state)
        expect(yield* jobs.pendingBackground).toEqual(before.background)
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph(false))))
    }),
  )

  for (const config of [
    { mode: "coding", custom: "false", active: true, idle: false },
    { mode: "coding", custom: "true", active: true, idle: false },
    { mode: "custom", custom: "false", active: false, idle: false },
    { mode: "custom", custom: "true", active: true, idle: false },
    { mode: "coding", custom: "false", active: false, idle: true },
    { mode: "coding", custom: "true", active: false, idle: true },
    { mode: "custom", custom: "true", active: false, idle: true },
  ] as const) {
    for (const persist of [false, true]) {
      it.live(
        `reconciles or defers Delegation claims and markers: persist=${persist}, mode=${config.mode}, Custom=${config.custom}, idle=${config.idle}`,
        () =>
          withCustomMode(
            config.custom,
            Effect.gen(function* () {
              const directory = yield* tmpdirScoped()
              const parent = Session.ID.create()
              const child = Session.ID.create()
              const root = Session.ID.create()
              const delegationID = DelegationID.ID.create()
              const graph = (retainsEvents: boolean) =>
                AppNodeBuilder.build(nodes, [
                  Global.node.replace(tempGlobalLayer),
                  Database.node.replace(Database.configured({ path: `${directory.path}/configuration-restart.db` })),
                  Bus.node.replace(Bus.configured({ persist: retainsEvents })),
                ])
              const retained = (database: Database.Service["Service"]) =>
                Effect.all({
                  child: database.db
                    .select({
                      id: SessionTable.id,
                      mode: SessionTable.mode,
                      claim: SessionTable.time_suspended,
                      attempts: SessionTable.resume_attempts,
                    })
                    .from(SessionTable)
                    .where(eq(SessionTable.id, child))
                    .get()
                    .pipe(Effect.orDie),
                  delegation: database.db
                    .select()
                    .from(DelegationTable)
                    .where(eq(DelegationTable.id, delegationID))
                    .get()
                    .pipe(Effect.orDie),
                  participants: database.db
                    .select()
                    .from(DelegationParticipantTable)
                    .where(eq(DelegationParticipantTable.delegation_id, delegationID))
                    .all()
                    .pipe(Effect.orDie),
                  turns: database.db
                    .select()
                    .from(DelegationTurnTable)
                    .where(eq(DelegationTurnTable.delegation_id, delegationID))
                    .all()
                    .pipe(Effect.orDie),
                  events: database.db
                    .select()
                    .from(EventTable)
                    .where(eq(EventTable.aggregate_id, delegationID))
                    .orderBy(asc(EventTable.seq))
                    .all()
                    .pipe(Effect.orDie),
                })
              // Persist an enabled-era binding and marker before reopening under the selected configuration.
              const before = yield* withCustomMode(
                "true",
                Effect.gen(function* () {
                  const database = yield* Database.Service
                  const bus = yield* Bus.Service
                  const store = yield* SessionStore.Service
                  const delegations = yield* DelegationService.Service
                  const jobs = yield* Job.Service
                  expect(bus.retainsEvents).toBeTrue()
                  yield* seedSessions(database, [root], { mode: "coding" })
                  // Binding validates that the Delegation parent and child share their product mode.
                  yield* seedSessions(database, [parent], { mode: config.mode })
                  yield* seedSessions(database, [child], { mode: config.mode, parent_id: parent })
                  yield* delegations.create({
                    delegationID,
                    parentSessionID: parent,
                    title: "Recovery configuration participant",
                  })
                  const participant = yield* delegations.addParticipant({
                    delegationID,
                    provider: "internal",
                    target: "build",
                    role: "implementer",
                    context: "fresh",
                    childSessionID: child,
                  })
                  const turn = yield* delegations.appendTurn({
                    delegationID,
                    kind: "task",
                    delivery: "queue",
                    participantIDs: [participant.id],
                    origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
                  })
                  const state = yield* delegations.foldState(delegationID)
                  expect(state?.deliveries.size).toBe(1)
                  if (config.idle) {
                    const delivery = [...(state?.deliveries.values() ?? [])].find((entry) => entry.turnID === turn.id)
                    if (!delivery) return yield* Effect.die(new Error("Missing idle recovery delivery"))
                    const inbox = yield* SessionInbox.Service
                    // Admit the real inbox item without waking the child; cold recovery must not replay it.
                    yield* inbox.admit({
                      id: DelegationExecution.inputID(delegationID, delivery),
                      sessionID: child,
                      item: {
                        type: "user",
                        payload: {
                          text: "Retain this idle child input for reconciliation",
                          metadata: { delegation: { delegationID, ...delivery } },
                        },
                        delivery: "queue",
                      },
                    })
                  }
                  const recovery = {
                    kind: "delegation" as const,
                    delegationID,
                    participantID: participant.id,
                    childSessionID: child,
                    parentSessionID: parent,
                    description: "Recovery configuration participant",
                  }
                  const job = yield* jobs.start({
                    id: `delegation:${participant.id}`,
                    type: "delegation",
                    notificationID: SessionMessage.ID.create(),
                    recovery,
                    run: Effect.succeed("Old completed outcome awaiting reconciliation"),
                  })
                  yield* jobs.wait({ id: job.id })
                  yield* jobs.background(job.id)
                  yield* Effect.forEach([child, root], store.claim, { discard: true })
                  yield* store.countResume(child)
                  yield* store.countResume(child)
                  return {
                    recovery,
                    state: yield* retained(database),
                    marker: yield* jobs.pendingBackground,
                    input: yield* SessionInbox.list(database.db, child),
                  }
                }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph(true)))),
              )

              yield* Effect.gen(function* () {
                const database = yield* Database.Service
                const bus = yield* Bus.Service
                const store = yield* SessionStore.Service
                const jobs = yield* Job.Service
                const reconciles = persist && config.idle
                expect(bus.retainsEvents).toBe(persist)
                expect((yield* store.get(child))?.mode).toBe(config.mode)
                expect((yield* store.get(root))?.mode).toBe("coding")
                expect(yield* retained(database)).toEqual(before.state)
                expect(before.state.child).toMatchObject({ claim: expect.any(Number), attempts: 2 })
                expect(yield* jobs.pendingBackground).toEqual(before.marker)
                expect(before.marker).toMatchObject([{ status: "completed", recovery: { childSessionID: child } }])
                const activeStarted = yield* Deferred.make<void>()
                const rootStarted = yield* Deferred.make<void>()
                const rootFinish = yield* Deferred.make<void>()
                const drained: Session.ID[] = []
                const scope = yield* Scope.make()
                yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
                // The model drain is an observer stub; disabled or cold/unverified children must not reach it.
                const context = yield* buildExecution(scope, (input) =>
                  Effect.gen(function* () {
                    drained.push(input.sessionID)
                    if (input.sessionID === child && !config.active)
                      return yield* Effect.die(new Error("Disabled or cold child reached the model drain"))
                    if (input.sessionID === child) {
                      yield* Deferred.succeed(activeStarted, undefined)
                      return yield* Effect.never
                    }
                    if (input.sessionID === root) {
                      yield* Deferred.succeed(rootStarted, undefined)
                      yield* Deferred.await(rootFinish)
                      return
                    }
                    return yield* Effect.die(new Error("Unexpected Delegation parent drain"))
                  }),
                )
                const execution = Context.get(context, SessionExecution.Service)
                const restart = Context.get(context, SessionRestart.Service)
                const recoveryExecution = Context.get(context, DelegationExecution.Service)
                if (!config.active && !config.idle) {
                  expect(yield* execution.resume(child).pipe(Effect.flip)).toMatchObject({
                    _tag: "UnsupportedProductModeError",
                    mode: "custom",
                  })
                  yield* execution.wake(child)
                  yield* execution.awaitIdle(child)
                  expect(drained).toEqual([])
                }
                const active = config.active ? yield* execution.resume(child).pipe(Effect.forkIn(scope)) : undefined
                if (active) {
                  yield* awaitWithTimeout(
                    Deferred.await(activeStarted),
                    "Delegation child did not become locally active",
                  )
                }
                expect(yield* execution.isActive(child)).toBe(config.active)
                expect(yield* recoveryExecution.recover(before.recovery)).toMatchObject({
                  status: reconciles ? "reconciled" : "deferred",
                  childSessionID: child,
                })
                expect(yield* recoveryExecution.recoverPending).toMatchObject({
                  parents: [],
                  deferredChildren: reconciles ? [] : [child],
                  scanAvailable: true,
                })
                const recovered = yield* retained(database)
                if (reconciles) {
                  expect(recovered.child).toMatchObject({ claim: null, attempts: 0 })
                  const delegations = yield* DelegationService.Service
                  const state = yield* delegations.foldState(delegationID)
                  expect([...(state?.deliveries.values() ?? [])]).toMatchObject([
                    { status: "recovery_required", errorCode: "session_input_unverified" },
                  ])
                }
                if (!reconciles) expect(recovered).toEqual(before.state)
                // A reopened marker has no process-local Job; Restart owns its durable ACK.
                expect(yield* jobs.pendingBackground).toEqual(before.marker)
                yield* restart.resumeSuspendedSessions
                yield* awaitWithTimeout(
                  Deferred.await(rootStarted),
                  "Claimed Coding root was blocked by Delegation recovery",
                )
                expect(yield* attempts(database, root)).toBe(1)
                expect(yield* attempts(database, child)).toBe(reconciles ? 0 : 2)
                expect(drained).toEqual(config.active ? [child, root] : [root])
                expect(yield* jobs.pendingBackground).toEqual(reconciles ? [] : before.marker)
                yield* Deferred.succeed(rootFinish, undefined)
                yield* execution.awaitIdle(root)
                yield* restart.resumeSuspendedSessions
                expect(drained).toEqual(config.active ? [child, root] : [root])
                expect(yield* execution.isActive(child)).toBe(config.active)
                expect(yield* claims(database)).toEqual({ [parent]: false, [child]: !reconciles, [root]: false })
                expect(yield* attempts(database, root)).toBe(0)
                expect(yield* retained(database)).toEqual(recovered)
                expect(yield* jobs.pendingBackground).toEqual(reconciles ? [] : before.marker)
                expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
                expect(yield* SessionInbox.list(database.db, child)).toEqual(before.input)
                yield* Scope.close(scope, Exit.void)
                if (active) yield* Fiber.await(active)
                expect(yield* execution.isActive(child)).toBeFalse()
                expect(yield* retained(database)).toEqual(recovered)
                expect(yield* jobs.pendingBackground).toEqual(reconciles ? [] : before.marker)
              }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph(persist))))
            }),
          ),
      )
    }
  }

  it.effect("defers child claims when the Delegation recovery table is unavailable while resuming roots", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const root = Session.ID.create()
      const child = Session.ID.create()
      yield* seedSessions(database, [root])
      yield* seedSessions(database, [child], { parent_id: root })
      yield* Effect.forEach([root, child], store.claim, { discard: true })
      yield* store.countResume(child)
      yield* database.db.run(sql`DROP TABLE delegation_participant`).pipe(Effect.orDie)
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const started = yield* Deferred.make<void>()
      const drained: Session.ID[] = []
      const context = yield* buildExecution(scope, (input) =>
        Effect.sync(() => void drained.push(input.sessionID)).pipe(
          Effect.andThen(input.sessionID === root ? Deferred.succeed(started, undefined) : Effect.void),
        ),
      )
      expect(yield* Context.get(context, DelegationExecution.Service).recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [],
        scanAvailable: false,
      })
      const restart = Context.get(context, SessionRestart.Service)
      yield* restart.resumeSuspendedSessions
      yield* awaitWithTimeout(Deferred.await(started), "Root recovery was blocked by the unavailable Delegation scan")
      yield* Context.get(context, SessionExecution.Service).awaitIdle(root)
      yield* restart.resumeSuspendedSessions
      expect(drained).toEqual([root])
      expect(yield* claims(database)).toEqual({ [root]: false, [child]: true })
      expect(yield* attempts(database, child)).toBe(1)
    }),
  )

  for (const mixed of [false, true]) {
    it.effect(`preserves ${mixed ? "mixed" : "pure"} Delegation recovery interruption before resuming roots`, () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const store = yield* SessionStore.Service
        const root = Session.ID.create()
        yield* seedSessions(database, [root])
        yield* store.claim(root)
        const cause = mixed
          ? Cause.combine(
              Cause.interrupt(),
              Cause.fail(
                new Delegation.DelegationInvalidStateError({
                  delegationID: DelegationID.ID.create(),
                  currentStatus: "unavailable",
                  attemptedTransition: "read",
                  reason: "Interrupted recovery",
                }),
              ),
            )
          : Cause.interrupt()
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const drained: Session.ID[] = []
        const context = yield* buildExecution(scope, (input) =>
          Effect.sync(() => void drained.push(input.sessionID)),
        ).pipe(
          Effect.provide(Layer.mock(DelegationService.Service, { list: () => Effect.failCause(cause) })),
          Effect.provide(
            AppNodeBuilder.build(Bus.node, [
              Bus.node.replace(Bus.configured({ persist: true })),
              Database.node.replace(Layer.succeed(Database.Service, database)),
            ]),
          ),
        )
        const exit = yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions.pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true)
        expect(drained).toEqual([])
        expect(yield* claims(database)).toEqual({ [root]: true })
        expect(yield* attempts(database, root)).toBe(0)
      }),
    )
  }

  it.effect("preserves disabled Custom recovery claims and budgets while ordinary Sessions resume", () =>
    withCustomMode(
      "false",
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const custom = Session.ID.create()
        const ordinary = Session.ID.create()
        yield* seedSessions(database, [custom], {
          mode: "custom",
          time_suspended: Date.now(),
          resume_attempts: 2,
        })
        yield* seedSessions(database, [ordinary], { time_suspended: Date.now() })
        const before = yield* bus.log({ aggregateID: custom }).pipe(Stream.runCollect)
        const drained: Session.ID[] = []
        const ordinaryStarted = yield* Deferred.make<void>()
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const context = yield* buildExecution(
          scope,
          ({ sessionID }) =>
            Effect.sync(() => void drained.push(sessionID)).pipe(
              Effect.andThen(Deferred.succeed(ordinaryStarted, undefined)),
            ),
          { maxAttempts: 2 },
        )
        const execution = Context.get(context, SessionExecution.Service)
        const restart = Context.get(context, SessionRestart.Service)
        expect(yield* execution.resume(custom).pipe(Effect.flip)).toMatchObject({
          _tag: "UnsupportedProductModeError",
          mode: "custom",
        })
        yield* execution.wake(custom)
        yield* execution.awaitIdle(custom)
        expect(yield* bus.log({ aggregateID: custom }).pipe(Stream.runCollect)).toEqual(before)
        yield* restart.resumeSuspendedSessions
        yield* Deferred.await(ordinaryStarted)
        yield* execution.awaitIdle(ordinary)
        yield* restart.resumeSuspendedSessions
        expect(drained).toEqual([ordinary])
        expect(yield* attempts(database, custom)).toBe(2)
        expect((yield* claims(database))[custom]).toBeTrue()
        expect(yield* bus.log({ aggregateID: custom }).pipe(Stream.runCollect)).toEqual(before)
        yield* withCustomMode("true", restart.resumeSuspendedSessions)
        expect(yield* attempts(database, custom)).toBe(0)
        expect((yield* claims(database))[custom]).toBeFalse()
        expect(drained).toEqual([ordinary])
      }),
    ),
  )

  it.effect("terminalizes a turn that exhausts its resume budget instead of crash-looping", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const sessionID = Session.ID.make("ses_resume_exhausted")
      // A claim from a dead process, already resumed twice without completing.
      yield* seedSessions(database, [sessionID], { time_suspended: Date.now(), resume_attempts: 2 })

      const drained: string[] = []
      const failures: SessionEvent.Execution.Failed[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID: id }) => Effect.sync(() => void drained.push(id)), {
        maxAttempts: 2,
      })
      const restart = Context.get(context, SessionRestart.Service)
      yield* bus.project(SessionEvent.Execution.Failed, (event) => Effect.sync(() => void failures.push(event)))

      yield* restart.resumeSuspendedSessions
      expect(drained).toEqual([])
      expect(failures.map((event) => event.data.error.type)).toEqual(["aborted"])
      // The terminal released the claim and reset the counter atomically.
      expect(yield* claims(database)).toEqual({ [sessionID]: false })
      expect(yield* attempts(database, sessionID)).toBe(0)
    }),
  )

  it.effect("counts every resume durably and never consumes the claim it recovers", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_resume_counted")
      yield* seedSessions(database, [sessionID], { time_suspended: Date.now() })

      const draining = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      // The drain never terminalizes (mirrors a process that will die mid-turn).
      const context = yield* buildExecution(scope, () =>
        Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const restart = Context.get(context, SessionRestart.Service)
      yield* restart.resumeSuspendedSessions.pipe(Effect.forkIn(scope))
      yield* Deferred.await(draining)

      // The attempt is durable before the drain runs, and the claim is held
      // throughout: a crash anywhere in the resume path leaves both intact.
      expect(yield* attempts(database, sessionID)).toBe(1)
      expect((yield* claims(database))[sessionID]).toBe(true)

      // Teardown (a graceful shutdown's interrupt) preserves both, so the next
      // boot counts attempt 2 against the same turn.
      yield* Scope.close(scope, Exit.void)
      expect((yield* claims(database))[sessionID]).toBe(true)
      expect(yield* attempts(database, sessionID)).toBe(1)
    }),
  )

  it.effect("the sweep leaves Sessions already draining in this process untouched", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const sessionID = Session.ID.make("ses_resume_local_active")
      yield* seedSessions(database, [sessionID])

      const draining = yield* Deferred.make<void>()
      const continued: SessionEvent.Synthetic[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () =>
        Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const restart = Context.get(context, SessionRestart.Service)
      yield* bus.project(SessionEvent.Synthetic, (event) => Effect.sync(() => void continued.push(event)))

      // A live local turn holds a claim; the sweep must not count, continue, or terminalize it.
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(draining)
      yield* restart.resumeSuspendedSessions

      expect(continued).toEqual([])
      expect(yield* attempts(database, sessionID)).toBe(0)
      expect((yield* claims(database))[sessionID]).toBe(true)
    }),
  )
})

describe("SessionRestart background recovery", () => {
  it.effect("retains disabled Custom shell notifications until recovery is enabled", () =>
    withCustomMode(
      "false",
      Effect.gen(function* () {
        const database = yield* Database.Service
        const store = yield* SessionStore.Service
        const jobs = yield* Job.Service
        const sessionID = Session.ID.create()
        yield* seedSessions(database, [sessionID], { mode: "custom" })
        yield* seedBackground(jobs, sessionID, [
          { id: "custom-shell-recovery", shellID: "custom-shell-recovery", command: "inspect" },
        ])
        const pending = yield* jobs.pendingBackground
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const restarted = yield* Job.make.pipe(Scope.provide(scope))
        const context = yield* buildExecution(
          scope,
          () => Effect.die(new Error("Idle shell owner must not execute")),
          undefined,
          restarted,
        )
        const restart = Context.get(context, SessionRestart.Service)
        yield* restart.resumeSuspendedSessions
        expect(yield* restarted.pendingBackground).toEqual(pending)
        expect(yield* SessionInbox.list(database.db, sessionID)).toEqual([])
        expect(yield* store.context(sessionID)).toEqual([])
        yield* withCustomMode("true", restart.resumeSuspendedSessions)
        expect(yield* restarted.pendingBackground).toEqual([])
        expect(yield* SessionInbox.list(database.db, sessionID)).toMatchObject([
          { payload: { metadata: { source: "shell", state: "cancelled" } } },
        ])
      }),
    ),
  )

  it.effect("keeps shell owners idle until a user prompt delivers recovered notices exactly once", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const parent = Session.ID.make("ses_background_recovery_parent")
      const child = Session.ID.make("ses_background_recovery_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, time_suspended: Date.now() })
      yield* seedBackground(jobs, parent, [
        { id: "sh_background_orphan", shellID: "sh_background_orphan", command: "sleep 60" },
      ])
      yield* seedBackground(jobs, child, [{ id: "call-child-shell", shellID: "sh_child_orphan", command: "sleep 30" }])

      expect(yield* store.listSuspended()).toEqual([])
      expect(yield* jobs.pendingBackground).toHaveLength(2)

      const drained: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) =>
          Effect.sync(() => void drained.push(sessionID)).pipe(
            Effect.andThen(SessionInbox.promote(database.db, bus, sessionID, "steer")),
            Effect.asVoid,
          ),
        undefined,
        restarted,
      )
      const restart = Context.get(context, SessionRestart.Service)
      const execution = Context.get(context, SessionExecution.Service)
      yield* restart.resumeSuspendedSessions
      yield* Effect.forEach([parent, child], execution.awaitIdle, { discard: true })

      expect(drained).toEqual([])
      expect(yield* SessionInbox.list(database.db, parent)).toHaveLength(1)
      expect(yield* SessionInbox.list(database.db, child)).toHaveLength(1)
      expect(yield* restarted.pendingBackground).toEqual([])
      yield* restart.resumeSuspendedSessions
      expect(drained).toEqual([])
      expect(yield* SessionInbox.list(database.db, parent)).toHaveLength(1)
      expect(yield* SessionInbox.list(database.db, child)).toHaveLength(1)

      yield* seedInbox(database, parent, ["steer"])
      yield* seedInbox(database, child, ["steer"])
      yield* execution.wake(parent)
      yield* execution.wake(child)
      yield* Effect.forEach([parent, child], execution.awaitIdle, { discard: true })
      expect(drained.toSorted()).toEqual([parent, child].toSorted())
      expect((yield* store.context(parent)).filter((message) => message.type === "synthetic")).toMatchObject([
        {
          type: "synthetic",
          description: "sleep 60",
          text: expect.stringContaining("server restarted"),
          metadata: {
            source: "shell",
            jobID: "sh_background_orphan",
            shellID: "sh_background_orphan",
            state: "cancelled",
          },
        },
      ])
      expect((yield* store.context(child)).filter((message) => message.type === "synthetic")).toMatchObject([
        {
          type: "synthetic",
          metadata: {
            source: "shell",
            jobID: "call-child-shell",
            shellID: "sh_child_orphan",
            state: "cancelled",
          },
        },
      ])
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
      expect(yield* SessionInbox.list(database.db, child)).toEqual([])
      expect(yield* claims(database)).toEqual({ [parent]: false, [child]: false })
      expect(yield* restarted.pendingBackground).toEqual([])

      yield* restart.resumeSuspendedSessions
      expect(drained).toHaveLength(2)
      expect((yield* store.context(parent)).filter((message) => message.type === "synthetic")).toHaveLength(1)
      expect((yield* store.context(child)).filter((message) => message.type === "synthetic")).toHaveLength(1)
    }),
  )

  it.effect("preserves locally running background work", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const jobs = yield* Job.Service
      const parent = Session.ID.make("ses_background_existing_parent")
      yield* seedSessions(database, [parent])
      yield* seedBackground(jobs, parent, [{ id: "call-running-shell", shellID: "sh_running", command: "sleep 60" }])

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.void)
      const restart = Context.get(context, SessionRestart.Service)
      yield* restart.resumeSuspendedSessions

      expect((yield* store.context(parent)).filter((message) => message.type === "synthetic")).toEqual([])
      expect(yield* jobs.get("call-running-shell")).toMatchObject({ status: "running" })
      expect(yield* jobs.pendingBackground).toHaveLength(1)
    }),
  )

  it.effect("wakes the owner for a silent shell failure persisted before its completion notification", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const sessionID = Session.ID.make("ses_background_completed_shell")
      yield* seedSessions(database, [sessionID])
      const complete = yield* Deferred.make<string>()
      yield* jobs.start({
        id: "call-completed-shell",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID,
          shellID: "sh_completed",
          command: "exit 7",
        },
        run: Deferred.await(complete),
      })
      yield* jobs.background("call-completed-shell")
      yield* Deferred.succeed(complete, "Exited with code 7")
      yield* jobs.wait({ id: "call-completed-shell" })

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const drained: Session.ID[] = []
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) => Effect.sync(() => void drained.push(sessionID)),
        undefined,
        restarted,
      )
      yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions
      yield* Context.get(context, SessionExecution.Service).awaitIdle(sessionID)

      expect(drained).toEqual([])
      const inbox = yield* SessionInbox.list(database.db, sessionID)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: '<shell id="call-completed-shell" state="completed" command="exit 7">\nExited with code 7\n</shell>',
          },
        },
      ])
      expect(inbox[0]).toHaveProperty("payload.metadata", {
        source: "shell",
        jobID: "call-completed-shell",
        shellID: "sh_completed",
        state: "completed",
      })
      expect(yield* restarted.pendingBackground).toEqual([])
    }),
  )

  for (const delivered of [false, true]) {
    it.effect(`does not duplicate a shell notification already ${delivered ? "delivered" : "admitted"}`, () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const jobs = yield* Job.Service
        const sessions = yield* Session.Service
        const sessionID = Session.ID.make("ses_shell_notification_retry")
        yield* seedSessions(database, [sessionID])
        yield* seedBackground(jobs, sessionID, [
          { id: "call-shell-notified", shellID: "sh_notified", command: "echo done" },
        ])
        const background = (yield* jobs.pendingBackground)[0]
        if (!background) return yield* Effect.die(new Error("background record missing"))
        yield* sessions.synthetic({
          id: background.notificationID,
          sessionID,
          text: "Command already completed",
          metadata: { source: "shell", shellID: "sh_notified", state: "completed" },
          resume: false,
        })
        if (delivered) yield* SessionInbox.promote(database.db, bus, sessionID, "steer")

        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
        const context = yield* buildExecution(scope, () => Effect.void, undefined, restarted)
        yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions

        expect(yield* restarted.pendingBackground).toEqual([])
        expect(yield* SessionInbox.list(database.db, sessionID)).toHaveLength(delivered ? 0 : 1)
        yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
        const messages = (yield* sessions.messages({ sessionID })).filter((message) => message.type !== "idle")
        expect(messages).toMatchObject([
          {
            id: background.notificationID,
            type: "synthetic",
            text: "Command already completed",
            metadata: { state: "completed" },
          },
        ])
      }),
    )
  }

  it.effect("acknowledges recovery markers when their owning session is deleted", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const sessionID = Session.ID.make("ses_background_deleted")
      yield* seedSessions(database, [sessionID])
      yield* seedBackground(jobs, sessionID, [{ id: "call-deleted-shell", shellID: "sh_deleted", command: "sleep 60" }])
      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(scope, () => Effect.void, undefined, restarted)
      yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions

      expect(yield* restarted.pendingBackground).toEqual([])
    }),
  )

  it.effect("delivers cancellation at the resumed parent's next step", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const store = yield* SessionStore.Service
      const bus = yield* Bus.Service
      const parent = Session.ID.make("ses_background_claimed_parent")
      yield* seedSessions(database, [parent], { time_suspended: Date.now() })
      yield* seedBackground(jobs, parent, [{ id: "call-claimed-shell", shellID: "sh_claimed", command: "sleep 60" }])

      const observed = yield* Deferred.make<string[]>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) =>
          SessionInbox.promote(database.db, bus, sessionID, "steer").pipe(
            Effect.andThen(store.context(sessionID)),
            Effect.orDie,
            Effect.flatMap((messages) =>
              Deferred.succeed(
                observed,
                messages.filter((message) => message.type === "synthetic").map((message) => message.text),
              ),
            ),
            Effect.asVoid,
          ),
        undefined,
        restarted,
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions
      expect(yield* Deferred.await(observed)).toEqual([
        "The server restarted while you were working. Continue from where you left off without repeating completed work.",
        expect.stringContaining("Command cancelled because the server restarted"),
      ])
      yield* execution.awaitIdle(parent)
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
      expect((yield* claims(database))[parent]).toBe(false)
    }),
  )

  it.effect("does not bypass a claimed owner's restart budget for a shell notice", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const sessionID = Session.ID.make("ses_shell_recovery_exhausted")
      yield* seedSessions(database, [sessionID], { time_suspended: Date.now(), resume_attempts: 2 })
      yield* seedBackground(jobs, sessionID, [
        { id: "call-exhausted-shell", shellID: "sh_exhausted", command: "sleep 60" },
      ])

      const drained: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Scope.provide(scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) => Effect.sync(() => void drained.push(sessionID)),
        { maxAttempts: 2 },
        restarted,
      )
      const restart = Context.get(context, SessionRestart.Service)
      const execution = Context.get(context, SessionExecution.Service)
      yield* restart.resumeSuspendedSessions
      yield* execution.awaitIdle(sessionID)

      expect(drained).toEqual([])
      expect(yield* claims(database)).toEqual({ [sessionID]: false })
      expect(yield* attempts(database, sessionID)).toBe(0)
      expect(yield* SessionInbox.list(database.db, sessionID)).toMatchObject([
        { payload: { metadata: { source: "shell", state: "cancelled" } } },
      ])
      expect(yield* restarted.pendingBackground).toEqual([])
      yield* restart.resumeSuspendedSessions
      expect(drained).toEqual([])
    }),
  )

  for (const shellFirst of [false, true]) {
    for (const resumeAttempts of [1, 2]) {
      it.effect(
        `recovers a child's shell ${shellFirst ? "before" : "after"} its job record without bypassing attempt ${resumeAttempts + 1}`,
        () =>
          Effect.gen(function* () {
            const database = yield* Database.Service
            const jobs = yield* Job.Service
            const bus = yield* Bus.Service
            const store = yield* SessionStore.Service
            const parent = Session.ID.make("ses_shell_child_parent")
            const child = Session.ID.make("ses_shell_child")
            yield* seedSessions(database, [parent])
            yield* seedSessions(database, [child], {
              parent_id: parent,
              time_suspended: Date.now(),
              resume_attempts: resumeAttempts,
            })
            const shell = seedBackground(jobs, child, [
              { id: "call-child-shell", shellID: "sh_child", command: "sleep 60" },
            ])
            if (shellFirst) yield* shell
            yield* jobs.start({
              id: child,
              type: "subagent",
              recovery: {
                kind: "subagent",
                parentSessionID: parent,
                childSessionID: child,
                agent: "explore",
                description: "Inspect recovery",
              },
              run: Effect.never,
            })
            yield* jobs.background(child)
            if (!shellFirst) yield* shell
            expect((yield* jobs.pendingBackground).map((job) => job.recovery.kind)).toEqual(
              shellFirst ? ["shell", "subagent"] : ["subagent", "shell"],
            )

            const observed = yield* Deferred.make<{ attempts: number | undefined; notices: string[] }>()
            const release = yield* Deferred.make<void>()
            const parentWoken = yield* Deferred.make<void>()
            const drained: Session.ID[] = []
            const scope = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
            const restarted = yield* Job.make.pipe(Scope.provide(scope))
            const context = yield* buildExecution(
              scope,
              ({ sessionID }) =>
                Effect.gen(function* () {
                  drained.push(sessionID)
                  yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
                  if (sessionID === parent) {
                    yield* Deferred.succeed(parentWoken, undefined)
                    return
                  }
                  yield* Deferred.succeed(observed, {
                    attempts: yield* attempts(database, sessionID),
                    notices: (yield* store.context(sessionID))
                      .filter((message) => message.type === "synthetic")
                      .map((message) => message.text),
                  })
                  yield* Deferred.await(release)
                }),
              { maxAttempts: 2 },
              restarted,
            )
            const restart = Context.get(context, SessionRestart.Service)
            const execution = Context.get(context, SessionExecution.Service)
            yield* restart.resumeSuspendedSessions

            if (resumeAttempts < 2) {
              expect(yield* Deferred.await(observed)).toEqual({
                attempts: 2,
                notices: [
                  expect.stringContaining("The server restarted while you were working"),
                  expect.stringContaining("Command cancelled because the server restarted"),
                ],
              })
              expect(drained).toEqual([child])
              expect(yield* execution.active).not.toContain(parent)
              expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
            }
            yield* Deferred.succeed(release, undefined)
            yield* Deferred.await(parentWoken)
            yield* Effect.forEach([parent, child], execution.awaitIdle, { discard: true })
            expect(drained).toEqual(resumeAttempts < 2 ? [child, parent] : [parent])
            expect((yield* store.context(parent)).filter((message) => message.type === "synthetic")).toMatchObject([
              { metadata: { source: "subagent", childID: child, state: resumeAttempts < 2 ? "completed" : "error" } },
            ])
            expect(yield* claims(database)).toEqual({ [parent]: false, [child]: false })
            expect(yield* attempts(database, child)).toBe(0)
            expect(yield* restarted.pendingBackground).toEqual([])

            yield* restart.resumeSuspendedSessions
            expect(drained).toHaveLength(resumeAttempts < 2 ? 2 : 1)
          }),
      )
    }
  }

  it.effect("resumes a background subagent and notifies its parent exactly once", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = Session.ID.make("ses_subagent_recovery_parent")
      const child = Session.ID.make("ses_subagent_recovery_child")
      const unrelated = Session.ID.make("ses_subagent_unrelated_child")
      yield* seedSessions(database, [parent], { time_suspended: Date.now(), resume_attempts: 1 })
      yield* seedSessions(database, [child, unrelated], { parent_id: parent, time_suspended: Date.now() })
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Inspect recovery",
        },
        run: Effect.never,
      })
      yield* jobs.background(child)

      const resumed = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const parentResumed = yield* Deferred.make<void>()
      const parentWoken = yield* Deferred.make<void>()
      const drained: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) =>
          Effect.gen(function* () {
            drained.push(sessionID)
            if (sessionID === child) {
              yield* Deferred.succeed(resumed, undefined)
              yield* Deferred.await(release)
              return
            }
            yield* Deferred.succeed(
              drained.filter((id) => id === parent).length === 1 ? parentResumed : parentWoken,
              undefined,
            )
          }),
        undefined,
        restarted,
      )
      const restart = Context.get(context, SessionRestart.Service)
      const execution = Context.get(context, SessionExecution.Service)
      yield* restart.resumeSuspendedSessions
      yield* Deferred.await(resumed)
      yield* Deferred.await(parentResumed)
      yield* execution.awaitIdle(parent)

      yield* restart.resumeSuspendedSessions
      expect(drained.toSorted()).toEqual([child, parent].toSorted())
      expect(yield* claims(database)).toEqual({ [parent]: false, [child]: true, [unrelated]: false })
      expect(yield* attempts(database, child)).toBe(1)
      expect(yield* restarted.get(child)).toMatchObject({ status: "running" })

      yield* Deferred.succeed(release, undefined)
      yield* Deferred.await(parentWoken)
      expect(drained.filter((id) => id === child)).toHaveLength(1)
      expect(drained.filter((id) => id === parent)).toHaveLength(2)
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        {
          payload: {
            description: "Inspect recovery",
            metadata: { source: "subagent", childID: child, agent: "explore", state: "completed" },
          },
        },
      ])
      expect(yield* restarted.pendingBackground).toEqual([])
      yield* restart.resumeSuspendedSessions
      expect(yield* SessionInbox.list(database.db, parent)).toHaveLength(1)
    }),
  )

  it.effect("delivers a subagent result persisted before restart without rerunning the child", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = Session.ID.make("ses_subagent_completed_parent")
      const child = Session.ID.make("ses_subagent_completed_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent })
      const complete = yield* Deferred.make<string>()
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Completed inspection",
        },
        run: Deferred.await(complete),
      })
      yield* jobs.background(child)
      yield* Deferred.succeed(complete, "Recovered result")
      yield* jobs.wait({ id: child })

      const parentWoken = yield* Deferred.make<void>()
      const drained: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) =>
          Effect.sync(() => void drained.push(sessionID)).pipe(
            Effect.andThen(Deferred.succeed(parentWoken, undefined)),
          ),
        undefined,
        restarted,
      )
      yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions
      yield* Deferred.await(parentWoken)

      expect(drained).toEqual([parent])
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        { payload: { text: expect.stringContaining("Recovered result"), metadata: { state: "completed" } } },
      ])
      expect(yield* restarted.pendingBackground).toEqual([])
    }),
  )

  it.effect("retains a subagent completion marker when synthetic admission conflicts", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const admission = yield* SessionInbox.Service
      const jobs = yield* Job.Service
      const sessions = yield* Session.Service
      const parent = Session.ID.make("ses_completion_conflict_parent")
      const child = Session.ID.make("ses_completion_conflict_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent })
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Completed inspection",
        },
        run: Effect.succeed("Recovered result"),
      })
      yield* jobs.wait({ id: child })
      yield* jobs.background(child)
      const marker = (yield* jobs.pendingBackground)[0]
      if (!marker) return yield* Effect.die(new Error("background record missing"))
      yield* admission.admit({
        id: marker.notificationID,
        sessionID: parent,
        item: { type: "user", payload: { text: "User input" }, delivery: "steer" },
      })

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.die(new Error("Admission must not wake the parent")))
      const exit = yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions.pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.SyntheticConflictError)
      expect(yield* jobs.pendingBackground).toEqual([marker])
      expect(yield* sessions.inbox(parent)).toMatchObject([{ type: "user", payload: { text: "User input" } }])
    }),
  )

  for (const resumeAttempts of [1, 2]) {
    it.effect(`honors a suspended parent's restart budget after ${resumeAttempts} attempts before notifying it`, () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const jobs = yield* Job.Service
        const parent = Session.ID.make("ses_subagent_budget_parent")
        const children = [
          Session.ID.make("ses_subagent_budget_child_1"),
          Session.ID.make("ses_subagent_budget_child_2"),
        ]
        yield* seedSessions(database, [parent], { time_suspended: Date.now(), resume_attempts: resumeAttempts })
        yield* seedSessions(database, children, { parent_id: parent })
        const complete = yield* Deferred.make<string>()
        for (const child of children) {
          yield* jobs.start({
            id: child,
            type: "subagent",
            recovery: {
              kind: "subagent",
              parentSessionID: parent,
              childSessionID: child,
              agent: "explore",
              description: "Completed inspection",
            },
            run: Deferred.await(complete),
          })
          yield* jobs.background(child)
        }
        yield* Deferred.succeed(complete, "Recovered result")
        yield* Effect.forEach(children, (id) => jobs.wait({ id }), { discard: true })

        const draining = yield* Deferred.make<number | undefined>()
        const release = yield* Deferred.make<void>()
        const drained: Session.ID[] = []
        const continued: Session.ID[] = []
        yield* bus.project(SessionEvent.Synthetic, (event) =>
          Effect.sync(() => void continued.push(event.data.sessionID)),
        )
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const restarted = yield* Job.make.pipe(Scope.provide(scope))
        const context = yield* buildExecution(
          scope,
          ({ sessionID }) =>
            Effect.gen(function* () {
              drained.push(sessionID)
              yield* Deferred.succeed(draining, yield* attempts(database, sessionID))
              yield* Deferred.await(release)
            }),
          { maxAttempts: 2 },
          restarted,
        )
        const restart = Context.get(context, SessionRestart.Service)
        const execution = Context.get(context, SessionExecution.Service)
        yield* restart.resumeSuspendedSessions

        if (resumeAttempts < 2) {
          expect(yield* Deferred.await(draining)).toBe(2)
          expect(drained).toEqual([parent])
          expect(continued).toEqual([parent])
          yield* Deferred.succeed(release, undefined)
          yield* execution.awaitIdle(parent)
        }
        if (resumeAttempts === 2) {
          expect(drained).toEqual([])
          expect(continued).toEqual([])
        }
        expect((yield* claims(database))[parent]).toBe(false)
        expect(yield* attempts(database, parent)).toBe(0)
        expect(yield* SessionInbox.list(database.db, parent)).toHaveLength(2)
        expect(yield* restarted.pendingBackground).toEqual([])
        yield* restart.resumeSuspendedSessions
        expect(drained).toHaveLength(resumeAttempts < 2 ? 1 : 0)
      }),
    )
  }

  it.effect("terminalizes a recovered subagent that exhausts its resume budget", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = Session.ID.make("ses_subagent_exhausted_parent")
      const child = Session.ID.make("ses_subagent_exhausted_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, time_suspended: Date.now(), resume_attempts: 2 })
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Exhausted inspection",
        },
        run: Effect.never,
      })
      yield* jobs.background(child)

      const parentWoken = yield* Deferred.make<void>()
      const drained: Session.ID[] = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const restarted = yield* Job.make.pipe(Effect.provideService(Scope.Scope, scope))
      const context = yield* buildExecution(
        scope,
        ({ sessionID }) =>
          Effect.sync(() => void drained.push(sessionID)).pipe(
            Effect.andThen(Deferred.succeed(parentWoken, undefined)),
          ),
        { maxAttempts: 2 },
        restarted,
      )
      yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions
      yield* Deferred.await(parentWoken)

      expect(drained).toEqual([parent])
      expect((yield* claims(database))[child]).toBe(false)
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        {
          payload: {
            text: expect.stringContaining("will not be resumed automatically"),
            metadata: { source: "subagent", childID: child, state: "error" },
          },
        },
      ])
      expect(yield* restarted.pendingBackground).toEqual([])
    }),
  )
})

describe("SessionExecution interrupt continuation", () => {
  it.effect("resumes only steering input after an interrupt with continue", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_continue_steer")
      yield* seedSessions(database, [sessionID])
      yield* seedInbox(database, sessionID, ["steer", "queue"])

      const draining = yield* Deferred.make<void>()
      const drains: Array<{ force: boolean; promotable?: SessionInbox.Promotable }> = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, (input) =>
        Effect.suspend(() => {
          drains.push({ force: input.force, promotable: input.promotable })
          if (drains.length > 1) return Effect.void
          return Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never))
        }),
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(draining)

      yield* execution.interrupt(sessionID, { resume: true })
      yield* execution.awaitIdle(sessionID)

      // The successor drain is steer-scoped: queued next-turn work stays parked.
      expect(drains).toEqual([
        { force: true, promotable: "input" },
        { force: false, promotable: "steer" },
      ])
    }),
  )

  it.effect("stays parked after an interrupt with continue when only queued work remains", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_continue_parked")
      yield* seedSessions(database, [sessionID])
      yield* seedInbox(database, sessionID, ["queue"])

      const draining = yield* Deferred.make<void>()
      const drains: Array<SessionInbox.Promotable | undefined> = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, (input) =>
        Effect.suspend(() => {
          drains.push(input.promotable)
          return Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never))
        }),
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(draining)

      yield* execution.interrupt(sessionID, { resume: true })
      yield* execution.awaitIdle(sessionID)

      expect(drains).toEqual(["input"])
      expect(yield* execution.active).toEqual(new Set())
    }),
  )

  it.effect("an idle interrupt with continue resumes pending steers", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_continue_idle")
      yield* seedSessions(database, [sessionID])
      yield* seedInbox(database, sessionID, ["steer"])

      const drains: Array<{ force: boolean; promotable?: SessionInbox.Promotable }> = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, (input) =>
        Effect.sync(() => void drains.push({ force: input.force, promotable: input.promotable })),
      )
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.interrupt(sessionID, { resume: true })
      yield* execution.awaitIdle(sessionID)

      expect(drains).toEqual([{ force: false, promotable: "steer" }])
    }),
  )

  it.effect("an interrupt with continue resumes a queued compaction next in line", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_continue_compaction")
      yield* seedSessions(database, [sessionID])
      yield* seedInbox(database, sessionID, [{ delivery: "queue", type: "compaction" }])

      const draining = yield* Deferred.make<void>()
      const drains: Array<{ force: boolean; promotable?: SessionInbox.Promotable }> = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, (input) =>
        Effect.suspend(() => {
          drains.push({ force: input.force, promotable: input.promotable })
          if (drains.length > 1) return Effect.void
          return Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never))
        }),
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* execution.resume(sessionID).pipe(Effect.forkScoped)
      yield* Deferred.await(draining)

      yield* execution.interrupt(sessionID, { resume: true })
      yield* execution.awaitIdle(sessionID)

      // Control work is housekeeping, not next-turn input: continue runs it.
      expect(drains).toEqual([
        { force: true, promotable: "input" },
        { force: false, promotable: "steer" },
      ])
    }),
  )

  it.effect("keeps a control item parked behind a queued prompt on continue", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = Session.ID.make("ses_continue_control_behind")
      yield* seedSessions(database, [sessionID])
      yield* seedInbox(database, sessionID, ["queue", { delivery: "queue", type: "compaction" }])

      const drains: Array<{ force: boolean; promotable?: SessionInbox.Promotable }> = []
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, (input) =>
        Effect.sync(() => void drains.push({ force: input.force, promotable: input.promotable })),
      )
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.interrupt(sessionID, { resume: true })
      yield* execution.awaitIdle(sessionID)

      // The queued prompt is next in line; the compaction behind it waits its turn.
      expect(drains).toEqual([])
    }),
  )
})

function seedBackground(
  jobs: Job.Interface,
  sessionID: Session.ID,
  background: ReadonlyArray<{ readonly id: string; readonly shellID: string; readonly command: string }>,
) {
  return Effect.forEach(
    background,
    (job) =>
      Effect.gen(function* () {
        yield* jobs.start({
          id: job.id,
          type: "shell",
          recovery: { kind: "shell", sessionID, shellID: job.shellID, command: job.command },
          run: Effect.never,
        })
        yield* jobs.background(job.id)
      }),
    { discard: true },
  )
}

/** Plain deliveries seed user prompts; objects seed control items. */
function seedInbox(
  database: Database.Service["Service"],
  sessionID: Session.ID,
  items: ReadonlyArray<
    SessionInbox.Delivery | { readonly delivery: SessionInbox.Delivery; readonly type: "compaction" }
  >,
) {
  return database.db
    .insert(SessionInboxTable)
    .values(
      items.map((item, index) => {
        const entry = typeof item === "string" ? { delivery: item, type: "user" as const } : item
        return {
          id: SessionMessage.ID.create(),
          session_id: sessionID,
          type: entry.type,
          payload: entry.type === "user" ? { text: "queued prompt" } : {},
          delivery: entry.delivery,
          enqueued_seq: index + 1,
        }
      }),
    )
    .run()
    .pipe(Effect.orDie)
}

describe("SessionRestart Meta ownership boot", () => {
  for (const boundary of ["reserved", "created", "admitted", "result-saved", "unknown"] as const) {
    it.live(`MP03 boot recovers the original Task operation at ${boundary} without copying admission`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const source = Session.ID.create()
        const target = Session.ID.create()
        const ordinary = Session.ID.create()
        const operationID = SessionTask.OperationID.create()
        const inputID = SessionMessage.ID.create()
        const model = Model.Ref.make({ id: Model.ID.make("restart"), providerID: Provider.ID.make("test") })
        const graph = AppNodeBuilder.build(LayerNode.group([nodes, MetaAgentService.node]), [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.configured({ path: `${directory.path}/operation-restart.db` })),
          Bus.node.replace(Bus.configured({ persist: true })),
          offlineModels,
        ])
        const before = yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const bus = yield* Bus.Service
          const sessions = yield* Session.Service
          const tasks = yield* SessionTask.Service
          const inbox = yield* SessionInbox.Service
          const store = yield* SessionStore.Service
          const metas = yield* MetaAgentService.Service
          const meta = yield* metas.create({ title: "Boot operation owner", agent: "meta", model })
          yield* seedSessions(database, [ordinary], { mode: "coding", directory: directory.path })
          yield* seedSessions(database, [target], { mode: "chat", directory: directory.path, agent: "build" })
          yield* seedSessions(database, [source], {
            mode: "coding",
            directory: directory.path,
            agent: "meta",
            model,
            controller: new SessionSchema.RootController({ kind: "root", rootSessionID: source, metaAgentID: meta.id }),
            permission: [{ action: "task", resource: "*", effect: "allow" }],
          })
          yield* metas.attach({ metaID: meta.id, sessionID: source, role: "orchestrator" })
          const capability = yield* metas.assertCoordination(source, { agent: Agent.ID.make("meta"), tool: "task" })
          yield* tasks.reserveOperation({
            sessionID: source,
            targetSessionID: target,
            request: new SessionTask.OperationRequest({
              operationID,
              inputID,
              target:
                boundary === "created"
                  ? new SessionTask.OperationNewRootTarget({
                      type: "new_root",
                      mode: "chat",
                      agent: Agent.ID.make("build"),
                    })
                  : new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: target }),
              prompt: "Saved raw Task request",
              delivery: "queue",
              resume: false,
            }),
            source: new SessionTask.OperationUserSource({
              type: "user_coordination",
              sessionID: source,
              agent: Agent.ID.make("meta"),
            }),
            selection: new SessionTask.OperationSelection({
              agent: Agent.ID.make("meta"),
              seq: capability.selection.event?.seq ?? Event.Seq.make(0),
              eventID: capability.selection.event?.id,
              compositionDigest: capability.selection.compositionDigest,
            }),
            sourceLocation: { directory: AbsolutePath.make(directory.path) },
            sourceMode: "coding",
          })
          yield* tasks.attachOperationTask({ sessionID: source, operationID })
          const payload = SessionInbox.UserPayload.make({ text: "Frozen prepared body 🚀" })
          if (boundary !== "reserved")
            yield* tasks.advanceOperation({
              sessionID: source,
              operationID,
              change: new SessionTask.OperationChange({
                phase: boundary === "created" ? "created" : "prepared",
                prepared: new SessionTask.OperationPrepared({
                  payload,
                  delivery: "queue",
                  digest: TaskOperation.payloadDigest(payload, "queue"),
                }),
              }),
            })
          if (boundary === "admitted" || boundary === "result-saved" || boundary === "unknown") {
            yield* inbox.admit({
              id: inputID,
              sessionID: target,
              item: { type: "user", payload, delivery: "queue" },
              operation: new SessionTask.OperationReadonlyRef({ sourceSessionID: source, operationID }),
            })
            yield* SessionInbox.promote(database.db, bus, target, "input", undefined, { anchorInputID: inputID })
            yield* store.claim(target)
          }
          if (boundary === "result-saved") {
            const assistantMessageID = SessionMessage.ID.create()
            yield* bus.publish(SessionEvent.Step.Started, {
              sessionID: target,
              assistantMessageID,
              agent: Agent.ID.make("build"),
              model,
              started: (yield* DateTime.nowAsDate).getTime(),
            })
            yield* bus.publish(SessionEvent.Text.Started, { sessionID: target, assistantMessageID, ordinal: 0 })
            yield* bus.publish(SessionEvent.Text.Ended, {
              sessionID: target,
              assistantMessageID,
              ordinal: 0,
              text: "Complete retained Task result 🚀\nSecond line",
            })
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: target,
              assistantMessageID,
              finish: "stop",
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              needsContinuation: false,
            })
            yield* bus.publish(SessionEvent.Step.Completed, {
              sessionID: target,
              assistantMessageID,
              resultAnchorInputID: inputID,
            })
            yield* bus.publish(SessionEvent.Synthetic, { sessionID: source, text: "Hold the saved result notice" })
            const anchor = (yield* sessions.context(source)).findLast((message) => message.type === "synthetic")
            if (!anchor) return yield* Effect.die(new Error("Source revert boundary missing"))
            yield* bus.publish(SessionEvent.RevertEvent.Staged, {
              sessionID: source,
              revert: { messageID: anchor.id, files: [] },
            })
          }
          if (boundary === "unknown")
            yield* tasks.advanceOperation({
              sessionID: source,
              operationID,
              change: new SessionTask.OperationChange({
                phase: "recovery_required",
                error: new SessionTask.OperationError({
                  code: "external_result_unknown",
                  message: "The retained target outcome requires explicit reconciliation",
                }),
              }),
            })
          yield* store.claim(ordinary)
          const operation = yield* tasks.operation({ sessionID: source, operationID })
          if (!operation) return yield* Effect.die(new Error("Saved Task operation missing"))
          return {
            operation,
            input: yield* SessionInputResult.read(database.db, { sessionID: target, inputID }),
            sessions: (yield* sessions.list()).data.map((session) => session.id).toSorted(),
          }
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const sessions = yield* Session.Service
          const tasks = yield* SessionTask.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const ordinaryStarted = yield* Deferred.make<void>()
          const targetStarted = yield* Deferred.make<void>()
          const drained: Session.ID[] = []
          const context = yield* buildExecution(scope, (input) =>
            Effect.gen(function* () {
              drained.push(input.sessionID)
              if (input.sessionID === ordinary) return yield* Deferred.succeed(ordinaryStarted, undefined)
              if (input.sessionID === target) yield* Deferred.succeed(targetStarted, undefined)
              return yield* Effect.never
            }),
          )
          const execution = Context.get(context, SessionExecution.Service)
          const restart = Context.get(context, SessionRestart.Service)
          expect(yield* tasks.operation({ sessionID: source, operationID })).toEqual(before.operation)
          yield* restart.resumeSuspendedSessions
          yield* awaitWithTimeout(
            Deferred.await(ordinaryStarted),
            "Ordinary claimed root did not resume during Task recovery",
          )
          yield* execution.awaitIdle(ordinary)
          if (boundary === "admitted")
            yield* awaitWithTimeout(Deferred.await(targetStarted), "The original admitted Task claim did not resume")
          if (boundary === "reserved")
            yield* pollWithTimeout(
              tasks
                .operation({ sessionID: source, operationID })
                .pipe(Effect.map((operation) => (operation?.phase === "admitted" ? operation : undefined))),
              "Reserved Task operation did not recover its original input",
              "10 seconds",
            )
          const operation = yield* tasks.operation({ sessionID: source, operationID })
          expect(operation?.requestDigest).toBe(before.operation.requestDigest)
          expect(operation?.targetSessionID).toBe(target)
          expect((yield* sessions.list()).data.map((session) => session.id).toSorted()).toEqual(before.sessions)
          expect(yield* tasks.operations({ sessionID: source })).toHaveLength(1)
          if (boundary === "reserved" || boundary === "created") {
            expect(operation?.phase).toBe("admitted")
            expect(yield* sessions.inbox(target)).toMatchObject([
              {
                id: inputID,
                type: "user",
                payload: { text: boundary === "reserved" ? "Saved raw Task request" : "Frozen prepared body 🚀" },
                delivery: "queue",
              },
            ])
          }
          if (boundary === "admitted" || boundary === "unknown") {
            expect(operation?.admission).toEqual(before.operation.admission)
            expect(yield* sessions.inbox(target)).toHaveLength(0)
            expect(yield* SessionInputResult.read(database.db, { sessionID: target, inputID })).toEqual(before.input)
          }
          if (boundary === "result-saved") {
            expect(operation).toMatchObject({
              phase: "settled",
              sourceSettlement: "settled",
              result: { sessionID: target, inputID, text: "Complete retained Task result 🚀\nSecond line" },
            })
            expect(yield* SessionInputResult.read(database.db, { sessionID: target, inputID })).toEqual(before.input)
            expect(
              (yield* sessions.inbox(source)).filter(
                (item) => item.id === TaskOperation.notificationID({ sessionID: source, operationID }),
              ),
            ).toHaveLength(1)
          }
          if (boundary === "unknown") expect(operation).toEqual(before.operation)
          expect(yield* attempts(database, target)).toBe(boundary === "admitted" ? 1 : 0)
          yield* restart.resumeSuspendedSessions
          expect(drained.filter((id) => id === ordinary)).toHaveLength(1)
          expect(drained.filter((id) => id === target)).toHaveLength(boundary === "admitted" ? 1 : 0)
          expect(yield* tasks.operations({ sessionID: source })).toHaveLength(1)
          if (boundary === "result-saved")
            expect(
              (yield* sessions.inbox(source)).filter(
                (item) => item.id === TaskOperation.notificationID({ sessionID: source, operationID }),
              ),
            ).toHaveLength(1)
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
      }),
    )
  }
  for (const boundary of ["started-only", "ended-without-step", "settled-step"] as const) {
    it.live(`P3 reopens the original SQLite attempt and saved Goal refs at ${boundary}`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const sessionID = Session.ID.create()
        const assistantMessageID = SessionMessage.ID.create()
        const attemptID = "gatt_" + Hash.sha256(JSON.stringify([sessionID, assistantMessageID, 0]))
        const selection = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("restart-group") })
        const model = Model.Ref.parse("restart-provider/catalog-model")
        const usage = { input: 9, output: 4, reasoning: 2, cache: { read: 1, write: 0 } }
        const summary = { cost: Money.USD.make(5), tokens: usage, unknownPriceAttempts: 1, missingUsageAttempts: 0 }
        const graph = AppNodeBuilder.build(LayerNode.group([nodes, MetaAgentService.node, SessionProjector.node]), [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.configured({ path: `${directory.path}/physical-restart.db` })),
          Bus.node.replace(Bus.configured({ persist: true })),
          offlineModels,
        ])
        const before = yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const bus = yield* Bus.Service
          const metas = yield* MetaAgentService.Service
          const goals = yield* SessionGoal.Service
          const store = yield* SessionStore.Service
          const meta = yield* metas.create({ title: "Physical recovery owner", agent: "meta", model: selection })
          yield* seedSessions(database, [sessionID], {
            mode: "coding",
            directory: directory.path,
            agent: "meta",
            model: selection,
            controller: new SessionSchema.RootController({
              kind: "root",
              rootSessionID: sessionID,
              metaAgentID: meta.id,
            }),
          })
          yield* metas.attach({ metaID: meta.id, sessionID, role: "orchestrator" })
          const goal = yield* goals.set({
            sessionID,
            objective: "Preserve the saved physical attempt",
            budget: {},
            conditions: [
              SessionGoal.Condition.make({
                id: "command",
                kind: "command_result",
                command: "bun test restart",
                cwd: directory.path,
                exit: 0,
                outputIncludes: ["passed"],
              }),
            ],
          })
          const advanced = yield* goals.advance({ sessionID, goalID: goal.id })
          if (advanced.round === undefined)
            return yield* Effect.die(new Error("Recovery Goal did not reserve its round"))
          yield* SessionInbox.promote(database.db, bus, sessionID, "input", undefined, {
            anchorInputID: advanced.round.inputID,
          })
          const refs = yield* goals.beforeAttempt({
            sessionID,
            inputID: advanced.round.inputID,
            assistantMessageID,
            attemptID,
            kind: "coordinator",
          })
          expect(refs).toHaveLength(1)
          yield* bus.publish(SessionEvent.Attempt.Started, {
            sessionID,
            assistantMessageID,
            ...new SessionAttempt.Started({
              ordinal: 0,
              attemptID,
              agent: Agent.ID.make("meta"),
              selection,
              behaviorDigest: "saved-behavior-digest",
              model,
              apiModelID: "provider-api-model",
              connection: { type: "credential", id: Credential.ID.make("saved-connection") },
              quote: { status: "unknown" },
              goalRefs: refs,
              transition: "initial",
              started: 10,
            }),
          })
          if (boundary !== "started-only")
            yield* bus.publish(SessionEvent.Attempt.Ended, {
              sessionID,
              assistantMessageID,
              ordinal: 0,
              terminal: new SessionAttempt.Terminal({
                status: "completed",
                ended: 20,
                outputStarted: false,
                finish: "stop",
                usage,
                cost: summary.cost,
                delivery: "accepted",
              }),
            })
          if (boundary === "settled-step") {
            yield* goals.settleAttempt({ refs, usage })
            yield* bus.publish(SessionEvent.Step.Ended, { sessionID, assistantMessageID, finish: "stop", ...summary })
            yield* bus.publish(SessionEvent.Step.Completed, {
              sessionID,
              assistantMessageID,
              resultAnchorInputID: advanced.round.inputID,
            })
          }
          yield* store.claim(sessionID)
          const saved = yield* goals.get({ sessionID, goalID: goal.id })
          const assistant = (yield* store.context(sessionID)).find((message) => message.type === "assistant")
          if (saved === undefined || assistant === undefined)
            return yield* Effect.die(new Error("Recovery setup did not persist its Goal or Assistant"))
          return { goalID: goal.id, round: advanced.round, rounds: saved.rounds, refs, assistant }
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

        const after = yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const goals = yield* SessionGoal.Service
          const store = yield* SessionStore.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const drained: Session.ID[] = []
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const context = yield* buildExecution(scope, (input) =>
            Effect.sync(() => {
              drained.push(input.sessionID)
            }).pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.andThen(Deferred.await(release))),
          )
          const execution = Context.get(context, SessionExecution.Service)
          const restart = Context.get(context, SessionRestart.Service)
          yield* restart.resumeSuspendedSessions
          if (boundary !== "settled-step")
            yield* awaitWithTimeout(Deferred.await(started), "Reopened attempt owner did not resume")
          yield* restart.resumeSuspendedSessions
          const messages = yield* store.context(sessionID)
          const assistant = messages.find(
            (message): message is SessionMessage.Assistant => message.type === "assistant",
          )
          if (assistant?.attempts === undefined)
            return yield* Effect.die(new Error("Reopened physical receipt disappeared"))
          expect(assistant.attempts).toHaveLength(1)
          expect(assistant.attempts[0]).toMatchObject({
            ordinal: 0,
            attemptID,
            selection,
            behaviorDigest: "saved-behavior-digest",
            model,
            apiModelID: "provider-api-model",
            goalRefs: before.refs,
          })
          expect(assistant.attempts[0].terminal).toMatchObject(
            boundary === "started-only"
              ? { status: "interrupted", outputStarted: false, delivery: "unknown" }
              : { status: "completed", usage, cost: summary.cost, delivery: "accepted" },
          )
          const goal = yield* goals.get({ sessionID, goalID: before.goalID })
          expect(goal?.rounds).toEqual(before.rounds)
          expect(goal?.attempts).toHaveLength(1)
          expect(goal?.attempts[0]).toMatchObject({ id: attemptID, assistantMessageID })
          expect(goal?.attempts[0].settledAt).toBeDefined()
          expect(goal?.attempts[0].usage).toEqual(boundary === "started-only" ? undefined : usage)
          expect(goal?.accounting.coordinator.unknownAttempts).toBe(boundary === "started-only" ? 1 : 0)
          expect(yield* store.get(sessionID)).toMatchObject(
            boundary === "started-only" ? { cost: 0, unknownPriceAttempts: 1, missingUsageAttempts: 1 } : summary,
          )
          const events = yield* database.db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, sessionID))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)
          expect(events.filter((event) => event.type === "session.attempt.started.1")).toHaveLength(1)
          expect(events.filter((event) => event.type === "session.attempt.ended.1")).toHaveLength(1)
          expect(
            events.filter((event) => event.type === "session.step.ended.1" || event.type === "session.step.failed.1"),
          ).toHaveLength(1)
          expect(events.filter((event) => event.type === "session.step.completed.1")).toHaveLength(
            boundary === "settled-step" ? 1 : 0,
          )
          expect(drained).toEqual(boundary === "settled-step" ? [] : [sessionID])
          if (boundary === "settled-step") expect(assistant).toEqual(before.assistant)
          if (boundary !== "settled-step") {
            yield* Deferred.succeed(release, undefined)
            yield* execution.awaitIdle(sessionID)
          }
          return {
            assistant,
            goal,
            session: yield* store.get(sessionID),
            receiptEvents: events.filter(
              (event) => event.type.startsWith("session.attempt.") || event.type.startsWith("session.step."),
            ),
          }
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const goals = yield* SessionGoal.Service
          const store = yield* SessionStore.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const drained: Session.ID[] = []
          const context = yield* buildExecution(scope, (input) =>
            Effect.sync(() => {
              drained.push(input.sessionID)
            }),
          )
          yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions
          expect(drained).toEqual([])
          expect((yield* store.context(sessionID)).find((message) => message.type === "assistant")).toEqual(
            after.assistant,
          )
          expect((yield* goals.get({ sessionID, goalID: before.goalID }))?.attempts).toEqual(after.goal?.attempts)
          expect((yield* goals.get({ sessionID, goalID: before.goalID }))?.rounds).toEqual(after.goal?.rounds)
          expect(yield* store.get(sessionID)).toEqual(after.session)
          const events = yield* database.db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, sessionID))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)
          expect(
            events.filter(
              (event) => event.type.startsWith("session.attempt.") || event.type.startsWith("session.step."),
            ),
          ).toEqual(after.receiptEvents)
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
      }),
    )
  }

  for (const boundary of ["pre-admission", "unknown-attempt"] as const) {
    it.live(`MP03 boot preserves the original Goal round at ${boundary} and resumes an ordinary root`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const source = Session.ID.create()
        const ordinary = Session.ID.create()
        const model = Model.Ref.make({ id: Model.ID.make("restart"), providerID: Provider.ID.make("test") })
        const graph = AppNodeBuilder.build(LayerNode.group([nodes, MetaAgentService.node, SessionGoal.node]), [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.configured({ path: `${directory.path}/goal-restart.db` })),
          Bus.node.replace(Bus.configured({ persist: true })),
          offlineModels,
        ])
        const before = yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const bus = yield* Bus.Service
          const metas = yield* MetaAgentService.Service
          const goals = yield* SessionGoal.Service
          const store = yield* SessionStore.Service
          const meta = yield* metas.create({ title: "Boot Goal owner", agent: "meta", model })
          yield* seedSessions(database, [ordinary], { mode: "coding", directory: directory.path })
          yield* seedSessions(database, [source], {
            mode: "coding",
            directory: directory.path,
            agent: "meta",
            model,
            controller: new SessionSchema.RootController({ kind: "root", rootSessionID: source, metaAgentID: meta.id }),
          })
          yield* metas.attach({ metaID: meta.id, sessionID: source, role: "orchestrator" })
          const goal = yield* goals.set({
            sessionID: source,
            objective: "Continue the saved Goal objective",
            conditions: [
              SessionGoal.Condition.make({
                id: "command",
                kind: "command_result",
                command: "bun test boot",
                cwd: directory.path,
                exit: 0,
                outputIncludes: ["passed"],
              }),
            ],
            budget: {},
          })
          const started = yield* goals.advance({ sessionID: source, goalID: goal.id })
          if (!started.round) return yield* Effect.die(new Error("Goal round reservation missing"))
          if (boundary === "pre-admission")
            yield* database.db
              .delete(SessionInboxTable)
              .where(eq(SessionInboxTable.id, started.round.inputID))
              .run()
              .pipe(Effect.orDie)
          if (boundary === "unknown-attempt") {
            yield* SessionInbox.promote(database.db, bus, source, "input", undefined, {
              anchorInputID: started.round.inputID,
            })
            expect(
              yield* goals.beforeAttempt({
                sessionID: source,
                inputID: started.round.inputID,
                assistantMessageID: SessionMessage.ID.create(),
                kind: "coordinator",
              }),
            ).toHaveLength(1)
            yield* store.claim(source)
          }
          yield* store.claim(ordinary)
          const saved = yield* goals.get({ sessionID: source, goalID: goal.id })
          if (!saved) return yield* Effect.die(new Error("Saved Goal missing"))
          return {
            goal: saved,
            round: started.round,
            input: yield* SessionInputResult.read(database.db, { sessionID: source, inputID: started.round.inputID }),
          }
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const goals = yield* SessionGoal.Service
          const sessions = yield* Session.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const ordinaryStarted = yield* Deferred.make<void>()
          const goalStarted = yield* Deferred.make<void>()
          const drained: Session.ID[] = []
          const context = yield* buildExecution(scope, (input) =>
            Effect.gen(function* () {
              drained.push(input.sessionID)
              if (input.sessionID === ordinary) return yield* Deferred.succeed(ordinaryStarted, undefined)
              if (input.sessionID === source) yield* Deferred.succeed(goalStarted, undefined)
              return yield* Effect.never
            }),
          )
          const execution = Context.get(context, SessionExecution.Service)
          const restart = Context.get(context, SessionRestart.Service)
          expect((yield* goals.get({ sessionID: source, goalID: before.goal.id }))?.rounds).toEqual(before.goal.rounds)
          yield* restart.resumeSuspendedSessions
          yield* awaitWithTimeout(
            Deferred.await(ordinaryStarted),
            "Ordinary claimed root did not resume during Goal recovery",
          )
          yield* execution.awaitIdle(ordinary)
          if (boundary === "pre-admission") {
            const admitted = yield* pollWithTimeout(
              SessionInbox.find(database.db, before.round.inputID),
              "Boot did not restore the reserved Goal input",
              "5 seconds",
            )
            expect(admitted).toMatchObject({ id: before.round.inputID, sessionID: source, type: "synthetic" })
            expect(JSON.stringify(admitted)).toContain(before.goal.objective)
            yield* awaitWithTimeout(Deferred.await(goalStarted), "The recovered Goal input was not woken")
          }
          if (boundary === "unknown-attempt") {
            expect(yield* goals.get({ sessionID: source, goalID: before.goal.id })).toMatchObject({
              status: "paused",
              pauseReason: "recovery_required",
              pauseCode: "attempt_settlement_unknown",
            })
            expect(
              yield* SessionInputResult.read(database.db, { sessionID: source, inputID: before.round.inputID }),
            ).toEqual(before.input)
            expect(yield* attempts(database, source)).toBe(0)
          }
          yield* restart.resumeSuspendedSessions
          const after = yield* goals.get({ sessionID: source, goalID: before.goal.id })
          expect(after?.rounds).toEqual(before.goal.rounds)
          expect(after?.accounting.rounds).toBe(before.goal.accounting.rounds)
          expect(yield* goals.list(source)).toHaveLength(1)
          expect(drained.filter((id) => id === ordinary)).toHaveLength(1)
          expect(drained.filter((id) => id === source)).toHaveLength(boundary === "pre-admission" ? 1 : 0)
          expect((yield* sessions.inbox(source)).filter((item) => item.id === before.round.inputID)).toHaveLength(
            boundary === "pre-admission" ? 1 : 0,
          )
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
      }),
    )
  }

  for (const boundary of ["result-saved", "unknown"] as const) {
    it.live(`MP03 boot reconciles the original Schedule occurrence at ${boundary} without a second execution`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const source = Session.ID.create()
        const target = Session.ID.create()
        const ordinary = Session.ID.create()
        const model = Model.Ref.make({ id: Model.ID.make("restart"), providerID: Provider.ID.make("test") })
        const graph = AppNodeBuilder.build(LayerNode.group([nodes, MetaAgentService.node]), [
          Global.node.replace(tempGlobalLayer),
          Database.node.replace(Database.configured({ path: `${directory.path}/occurrence-restart.db` })),
          Bus.node.replace(Bus.configured({ persist: true })),
          offlineModels,
        ])
        const before = yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const bus = yield* Bus.Service
          const sessions = yield* Session.Service
          const metas = yield* MetaAgentService.Service
          const schedules = yield* ScheduleService.Service
          const tasks = yield* SessionTask.Service
          const inbox = yield* SessionInbox.Service
          const store = yield* SessionStore.Service
          const meta = yield* metas.create({ title: "Boot occurrence owner", agent: "meta", model })
          yield* seedSessions(database, [ordinary], { mode: "coding", directory: directory.path })
          yield* seedSessions(database, [target], { mode: "chat", directory: directory.path, agent: "build" })
          yield* seedSessions(database, [source], {
            mode: "coding",
            directory: directory.path,
            agent: "meta",
            model,
            controller: new SessionSchema.RootController({ kind: "root", rootSessionID: source, metaAgentID: meta.id }),
            permission: [{ action: "task", resource: "*", effect: "allow" }],
          })
          yield* metas.attach({ metaID: meta.id, sessionID: source, role: "orchestrator" })
          const task = (yield* tasks.append({
            sessionID: source,
            tasks: [{ content: "Original scheduled Task", status: "pending", priority: "medium" }],
          }))[0]
          if (!task) return yield* Effect.die(new Error("Schedule source Task missing"))
          const created = yield* schedules.createRule(
            new Schedule.Create({
              sessionID: source,
              kind: "prompt",
              content: "Original occurrence body",
              recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
              timezone: "UTC",
              target: new Schedule.ExistingTarget({ policy: "existing", sessionID: target }),
            }),
            Agent.ID.make("meta"),
          )
          yield* schedules.bindTask(created.id, task.id)
          const rule = yield* schedules.getRule(created.id)
          if (!rule) return yield* Effect.die(new Error("Saved Schedule rule missing"))
          const run = yield* schedules.claimOccurrence(rule.id, rule.nextDueAt ?? 0, "boot-keeper")
          if (!run) return yield* Effect.die(new Error("Saved occurrence missing"))
          const capability = yield* metas.assertCoordination(source, { agent: Agent.ID.make("meta"), tool: "task" })
          yield* tasks.reserveOperation({
            sessionID: source,
            request: new SessionTask.OperationRequest({
              operationID: run.operationID,
              inputID: run.inputID,
              taskID: task.id,
              expectedRevision: task.revision,
              target: new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: target }),
              prompt: run.snapshot.content,
              delivery: "queue",
              resume: false,
            }),
            source: new SessionTask.OperationScheduleSource({
              type: "schedule_occurrence",
              sessionID: source,
              agent: Agent.ID.make("meta"),
              scheduleID: rule.id,
              occurrenceID: run.id,
              revision: run.ruleRevision,
            }),
            selection: new SessionTask.OperationSelection({
              agent: Agent.ID.make("meta"),
              seq: capability.selection.event?.seq ?? Event.Seq.make(0),
              eventID: capability.selection.event?.id,
              compositionDigest: capability.selection.compositionDigest,
            }),
            sourceLocation: { directory: AbsolutePath.make(directory.path) },
            sourceMode: "coding",
          })
          const operation = yield* tasks.attachOperationTask({ sessionID: source, operationID: run.operationID })
          const payload = SessionInbox.UserPayload.make({ text: run.snapshot.content })
          yield* tasks.advanceOperation({
            sessionID: source,
            operationID: run.operationID,
            change: new SessionTask.OperationChange({
              phase: "prepared",
              prepared: new SessionTask.OperationPrepared({
                payload,
                delivery: "queue",
                digest: TaskOperation.payloadDigest(payload, "queue"),
              }),
            }),
          })
          yield* inbox.admit({
            id: run.inputID,
            sessionID: target,
            item: { type: "user", payload, delivery: "queue" },
            operation: new SessionTask.OperationReadonlyRef({ sourceSessionID: source, operationID: run.operationID }),
          })
          yield* SessionInbox.promote(database.db, bus, target, "input", undefined, { anchorInputID: run.inputID })
          yield* schedules.advanceOccurrence(
            run.id,
            new Schedule.OccurrenceChange({
              status: "admitted",
              taskRevision: operation.taskRevision,
              admission: new Schedule.Admission({
                targetSessionID: target,
                inputID: run.inputID,
                operationID: run.operationID,
                taskID: task.id,
                taskRevision: operation.taskRevision,
                admittedAt: (yield* DateTime.nowAsDate).getTime(),
              }),
            }),
          )
          yield* store.claim(target)
          if (boundary === "result-saved") {
            const assistantMessageID = SessionMessage.ID.create()
            yield* bus.publish(SessionEvent.Step.Started, {
              sessionID: target,
              assistantMessageID,
              agent: Agent.ID.make("build"),
              model,
              started: (yield* DateTime.nowAsDate).getTime(),
            })
            yield* bus.publish(SessionEvent.Text.Started, { sessionID: target, assistantMessageID, ordinal: 0 })
            yield* bus.publish(SessionEvent.Text.Ended, {
              sessionID: target,
              assistantMessageID,
              ordinal: 0,
              text: "Complete saved occurrence result 🚀",
            })
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: target,
              assistantMessageID,
              finish: "stop",
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              needsContinuation: false,
            })
            yield* bus.publish(SessionEvent.Step.Completed, {
              sessionID: target,
              assistantMessageID,
              resultAnchorInputID: run.inputID,
            })
            yield* database.db
              .update(TaskTable)
              .set({ content: "User edited scheduled Task", revision: (operation.taskRevision ?? task.revision) + 1 })
              .where(eq(TaskTable.id, task.id))
              .run()
              .pipe(Effect.orDie)
            yield* bus.publish(SessionEvent.Synthetic, { sessionID: source, text: "Hold the saved occurrence notice" })
            const anchor = (yield* sessions.context(source)).findLast((message) => message.type === "synthetic")
            if (!anchor) return yield* Effect.die(new Error("Occurrence source revert boundary missing"))
            yield* bus.publish(SessionEvent.RevertEvent.Staged, {
              sessionID: source,
              revert: { messageID: anchor.id, files: [] },
            })
          }
          if (boundary === "unknown") {
            yield* tasks.advanceOperation({
              sessionID: source,
              operationID: run.operationID,
              change: new SessionTask.OperationChange({
                phase: "recovery_required",
                error: new SessionTask.OperationError({
                  code: "external_result_unknown",
                  message: "The occurrence target outcome requires explicit reconciliation",
                }),
              }),
            })
            yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ status: "recovery_required" }))
            const paused = yield* schedules.pauseRule(rule.id, rule.revision)
            yield* schedules.resumeRule(rule.id, paused.revision)
          }
          yield* store.claim(ordinary)
          return {
            rule: yield* schedules.getRule(rule.id),
            run: yield* schedules.occurrence(run.id),
            operation: yield* tasks.operation({ sessionID: source, operationID: run.operationID }),
            input: yield* SessionInputResult.read(database.db, { sessionID: target, inputID: run.inputID }),
          }
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
        if (!before.rule || !before.run || !before.operation)
          return yield* Effect.die(new Error("Retained occurrence facts missing"))

        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const schedules = yield* ScheduleService.Service
          const tasks = yield* SessionTask.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const ordinaryStarted = yield* Deferred.make<void>()
          const drained: Session.ID[] = []
          const context = yield* buildExecution(scope, (input) =>
            Effect.gen(function* () {
              drained.push(input.sessionID)
              if (input.sessionID === ordinary) return yield* Deferred.succeed(ordinaryStarted, undefined)
              return yield* Effect.never
            }),
          )
          const execution = Context.get(context, SessionExecution.Service)
          const restart = Context.get(context, SessionRestart.Service)
          const run = before.run
          const rule = before.rule
          if (!run || !rule) return yield* Effect.die(new Error("Cold occurrence identity missing"))
          const scheduleRecovery = Context.get(
            yield* Layer.buildWithScope(ScheduleExecution.layer, scope).pipe(Effect.provide(context)),
            ScheduleExecution.Service,
          )
          yield* scheduleRecovery.recover()
          yield* restart.resumeSuspendedSessions
          yield* awaitWithTimeout(
            Deferred.await(ordinaryStarted),
            "Ordinary claimed root did not resume during occurrence recovery",
          )
          yield* execution.awaitIdle(ordinary)
          if (boundary === "result-saved") {
            expect(yield* schedules.occurrence(run.id)).toMatchObject({
              status: "completed",
              sourceSettlement: "conflict",
              output: "Complete saved occurrence result 🚀",
              result: { sessionID: target, inputID: run.inputID },
            })
            expect((yield* schedules.getRule(rule.id))?.activeOccurrenceID).toBeUndefined()
            expect((yield* tasks.get(source))[0]?.content).toBe("User edited scheduled Task")
          }
          if (boundary === "unknown") {
            expect(yield* schedules.occurrence(run.id)).toEqual(before.run)
            expect((yield* schedules.getRule(rule.id))?.activeOccurrenceID).toBe(run.id)
            expect(
              yield* schedules.claimOccurrence(
                rule.id,
                (rule.nextDueAt ?? run.scheduledAt) + 60_000,
                "second-boot-occurrence",
              ),
            ).toBeUndefined()
            expect(yield* tasks.operation({ sessionID: source, operationID: run.operationID })).toEqual(
              before.operation,
            )
          }
          expect(yield* SessionInputResult.read(database.db, { sessionID: target, inputID: run.inputID })).toEqual(
            before.input,
          )
          expect(yield* attempts(database, target)).toBe(0)
          yield* scheduleRecovery.recover()
          yield* restart.resumeSuspendedSessions
          expect(yield* schedules.runs(rule.id)).toHaveLength(1)
          expect(drained.filter((id) => id === ordinary)).toHaveLength(1)
          expect(drained.filter((id) => id === target)).toHaveLength(0)
          expect((yield* schedules.getRule(rule.id))?.revision).toBe(rule.revision)
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
      }),
    )
  }
})

function seedSessions(
  database: Database.Service["Service"],
  sessionIDs: ReadonlyArray<Session.ID>,
  values: Partial<
    Pick<
      typeof SessionTable.$inferInsert,
      | "time_suspended"
      | "resume_attempts"
      | "parent_id"
      | "mode"
      | "directory"
      | "agent"
      | "controller"
      | "permission"
      | "model"
    >
  > = {},
) {
  return Effect.gen(function* () {
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values(
        sessionIDs.map((id) => ({
          id,
          project_id: Project.ID.global,
          slug: id,
          directory: "/project",
          title: id,
          version: "test",
          ...values,
        })),
      )
      .run()
      .pipe(Effect.orDie)
  })
}

function claims(database: Database.Service["Service"]) {
  return database.db
    .select({ id: SessionTable.id, claimed: SessionTable.time_suspended })
    .from(SessionTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.id, row.claimed !== null]))),
    )
}

function attempts(database: Database.Service["Service"], sessionID: Session.ID) {
  return database.db
    .select({ attempts: SessionTable.resume_attempts })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.attempts),
    )
}

/** Builds the local execution layer plus the restart actions against the test harness services. */
function buildExecution(
  scope: Scope.Closeable,
  drain: (input: Parameters<SessionRunner.Interface["drain"]>[0]) => Effect.Effect<void, SessionRunner.RunError>,
  options?: SessionRestart.Options,
  overrideJobs?: Job.Interface,
) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const jobs = overrideJobs ?? (yield* Job.Service)
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const compositions = yield* SessionComposition.Service
    const delegations = yield* DelegationService.Service
    const schedules = yield* ScheduleService.Service
    const goals = yield* SessionGoal.Service
    const git = yield* Git.Service
    const processes = yield* AppProcess.Service
    const sessionLayer = Layer.effect(
      Session.Service,
      Effect.gen(function* () {
        const execution = yield* SessionExecution.Service
        return Session.Service.of({
          ...sessions,
          synthetic: (input) =>
            sessions
              .synthetic({ ...input, resume: false })
              .pipe(Effect.tap(() => (input.resume === false ? Effect.void : execution.wake(input.sessionID)))),
        })
      }),
    )
    const runner = Layer.succeed(
      SessionRunner.Service,
      SessionRunner.Service.of({
        drain: (input) => drain(input).pipe(Effect.as(SessionRunner.DrainResult.Complete())),
      }),
    )
    const locations = Layer.effect(
      LocationServiceMap.Service,
      LayerMap.make(
        () =>
          // The local execution test only needs the Session runner from the Location graph.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          runner as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      ),
    )
    return yield* Layer.buildWithScope(
      SessionRestart.layer(options).pipe(
        Layer.provide(Layer.mock(WorkflowExecution.Service, { reconcilePending: Effect.succeed([]) })),
        Layer.provideMerge(DelegationExecution.layer),
        Layer.provideMerge(sessionLayer),
        Layer.provideMerge(Layer.fresh(SessionExecution.layer)),
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(Bus.Service, bus)),
        Layer.provide(Layer.succeed(SessionStore.Service, store)),
        Layer.provide(Layer.succeed(Job.Service, jobs)),
        Layer.provide(Layer.succeed(KV.Service, kv)),
        Layer.provide(Layer.succeed(DelegationService.Service, delegations)),
        Layer.provide(Layer.succeed(ScheduleService.Service, schedules)),
        Layer.provide(Layer.succeed(SessionGoal.Service, goals)),
        Layer.provide(Layer.succeed(Git.Service, git)),
        Layer.provide(Layer.succeed(AppProcess.Service, processes)),
        Layer.provide(Layer.succeed(SessionComposition.Service, compositions)),
        // Do not reuse the outer harness's selector with its already-captured Location map.
        Layer.provide(
          AppNodeBuilder.build(Instance.node, [LocationServiceMap.node.replace(locations)]).pipe(Layer.fresh),
        ),
      ),
      scope,
    )
  })
}
