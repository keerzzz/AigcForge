import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionGoalTable, SessionInboxTable, SessionInputResultTable, SessionTable } from "@aigcfroge/core/session/sql"
import { TaskOperation } from "@aigcfroge/core/session/task-operation"
import { Agent } from "@aigcfroge/schema/agent"
import { Event } from "@aigcfroge/schema/event"
import { Model } from "@aigcfroge/schema/model"
import { Money } from "@aigcfroge/schema/money"
import { Project } from "@aigcfroge/schema/project"
import { Provider } from "@aigcfroge/schema/provider"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { SessionEvent } from "@aigcfroge/schema/session-event"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { Shell } from "@aigcfroge/schema/shell"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Hash } from "@aigcfroge/util/hash"
import { testEffect } from "./lib/effect"

const testLayer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, MetaAgentService.node, SessionInbox.node, SessionGoal.node, SessionProjector.node]),
  [Bus.node.replace(Bus.configured({ persist: true }))],
)
const it = testEffect(testLayer)

const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const usage = { input: 3, output: 4, reasoning: 2, cache: { read: 1, write: 0 } }
const model = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })

const setup = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const metas = yield* MetaAgentService.Service
  const goals = yield* SessionGoal.Service
  const inbox = yield* SessionInbox.Service
  const sessionID = Session.ID.create()
  const projectID = Project.ID.make("proj_goal_test")
  const meta = yield* metas.create({ title: "Goal test", agent: "meta", model: { id: "test", providerID: "test" } })
  yield* database.db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make("/goal-test"), sandboxes: [] }).run().pipe(Effect.orDie)
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID,
    location: { directory: AbsolutePath.make("/goal-test") },
    slug: sessionID,
    version: "test",
    agent: Agent.ID.make("meta"),
    controller: new Session.RootController({ kind: "root", metaAgentID: meta.id, rootSessionID: sessionID }),
  })
  yield* metas.attach({ metaID: meta.id, sessionID, role: "orchestrator" })
  return { db: database.db, bus, metas, goals, inbox, sessionID, projectID, meta }
})

const conditions = () => [SessionGoal.Condition.make({ id: "command", kind: "command_result", command: "bun test goal", cwd: "/goal-test", exit: 0, outputIncludes: ["passed"] })] as const

const start = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof setup>>, budget: SessionGoal.Budget = {}, required: SessionGoal.CreateInput["conditions"] = conditions()) {
  const goal = yield* fixture.goals.set({ sessionID: fixture.sessionID, objective: "Ship the accepted implementation", conditions: required, budget })
  const result = yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: goal.id })
  if (!result.round) return yield* Effect.die(new Error("Goal did not reserve its first round"))
  return { goal, round: result.round }
})

const deliver = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof setup>>, round: SessionGoal.RoundRef) {
  yield* SessionInbox.promote(fixture.db, fixture.bus, fixture.sessionID, "input", undefined, { anchorInputID: round.inputID })
})

const request = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof setup>>, assistantMessageID = SessionMessage.ID.create()) {
  const refs = yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, assistantMessageID, kind: "coordinator" })
  yield* fixture.bus.publish(SessionEvent.Step.Started, { sessionID: fixture.sessionID, assistantMessageID, agent: Agent.ID.make("meta"), model, started: Date.now() })
  return { refs, assistantMessageID }
})

const complete = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof setup>>, round: SessionGoal.RoundRef, assistantMessageID: SessionMessage.ID) {
  yield* fixture.bus.publish(SessionEvent.Text.Started, { sessionID: fixture.sessionID, assistantMessageID, ordinal: 0 })
  yield* fixture.bus.publish(SessionEvent.Text.Ended, { sessionID: fixture.sessionID, assistantMessageID, ordinal: 0, text: "Completed this round" })
  yield* fixture.bus.publish(SessionEvent.Step.Ended, { sessionID: fixture.sessionID, assistantMessageID, finish: "stop", cost: Money.USD.zero, tokens: zero, needsContinuation: false })
  yield* fixture.bus.publish(SessionEvent.Step.Completed, { sessionID: fixture.sessionID, assistantMessageID, resultAnchorInputID: round.inputID })
})

const command = Effect.fnUntraced(function* (fixture: Effect.Success<ReturnType<typeof setup>>, assistantMessageID: SessionMessage.ID, input: { command?: string; producerName?: string; started?: number } = {}) {
  const id = "call_" + Shell.ID.create()
  const shell = Shell.CommandResult.make({ id: Shell.ID.create(), command: input.command ?? "bun test goal", cwd: "/goal-test", exit: 0,
    timeout: false, truncated: false, outputDigest: Hash.sha256("passed"), started: input.started ?? Date.now(), completed: Date.now() })
  yield* fixture.bus.publish(SessionEvent.Tool.Input.Started, { sessionID: fixture.sessionID, assistantMessageID, id, name: input.producerName ?? "shell" })
  yield* fixture.bus.publish(SessionEvent.Tool.Input.Ended, { sessionID: fixture.sessionID, assistantMessageID, id, text: JSON.stringify({ command: shell.command }) })
  yield* fixture.bus.publish(SessionEvent.Tool.Called, { sessionID: fixture.sessionID, assistantMessageID, id, input: { command: shell.command }, executed: false })
  const event = yield* fixture.bus.publish(SessionEvent.Tool.Success, { sessionID: fixture.sessionID, assistantMessageID, id, executed: false,
    content: [{ type: "text", text: "passed" }], metadata: { commandResult: Schema.encodeSync(Shell.CommandResult)(shell) } })
  yield* fixture.goals.observeTool(event.id)
  return event
})

describe("SessionGoal persisted owner", () => {
  it.live("rejects another Session's Goal ID while preserving its original owner and contents", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const first = yield* start(fixture)
    const original = yield* fixture.db.select().from(SessionGoalTable).where(eq(SessionGoalTable.id, first.goal.id)).get().pipe(Effect.orDie)
    const sessionID = Session.ID.create()
    const meta = yield* fixture.metas.create({ title: "Other Goal owner", agent: "meta", model: { id: "test", providerID: "test" } })
    yield* fixture.bus.publish(SessionEvent.Created, {
      sessionID, projectID: fixture.projectID, location: { directory: AbsolutePath.make("/goal-test") }, slug: sessionID, version: "test", agent: Agent.ID.make("meta"),
      controller: new Session.RootController({ kind: "root", metaAgentID: meta.id, rootSessionID: sessionID }),
    })
    yield* fixture.metas.attach({ metaID: meta.id, sessionID, role: "orchestrator" })
    expect(yield* fixture.goals.set({ sessionID, goalID: first.goal.id, objective: "Other Session objective", conditions: conditions(), budget: {} }).pipe(Effect.flip))
      .toMatchObject({ reason: "goal_conflict", sessionID, goalID: first.goal.id })
    expect(yield* fixture.db.select().from(SessionGoalTable).where(eq(SessionGoalTable.id, first.goal.id)).get().pipe(Effect.orDie)).toEqual(original)
    expect(yield* fixture.goals.list(sessionID)).toHaveLength(0)
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: first.goal.id }))?.objective).toBe(first.goal.objective)
  }))

  it.live("preserves one active Goal, exact retry, explicit revision and canonical reload", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const first = yield* start(fixture)
    const retried = yield* fixture.goals.set({ sessionID: fixture.sessionID, goalID: first.goal.id, objective: first.goal.objective, conditions: first.goal.conditions, budget: first.goal.budget })
    expect(retried.id).toBe(first.goal.id)
    expect(yield* fixture.goals.set({ sessionID: fixture.sessionID, objective: "Other", conditions: conditions(), budget: {} }).pipe(Effect.flip)).toMatchObject({ reason: "active_goal_exists" })
    const paused = yield* fixture.goals.pause({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 1 })
    expect(paused.status).toBe("paused")
    expect(paused.pauseReason).toBe("user")
    expect(paused.pauseVersion).toBe(1)
    const edited = yield* fixture.goals.edit({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 1, objective: "Revised objective" })
    expect(edited.revision).toBe(2)
    expect(yield* fixture.goals.edit({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 1, objective: "stale" }).pipe(Effect.flip)).toMatchObject({ reason: "stale_revision" })
    const reloaded = yield* SessionGoal.make()
    expect(yield* reloaded.get({ sessionID: fixture.sessionID, goalID: first.goal.id })).toMatchObject({ id: first.goal.id, objective: "Revised objective", status: "paused", revision: 2, rounds: [first.round] })
    const other = yield* fixture.goals.set({ sessionID: fixture.sessionID, objective: "Other", conditions: conditions(), budget: {} })
    expect(yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 2 }).pipe(Effect.flip)).toMatchObject({ reason: "active_goal_exists" })
    yield* fixture.goals.cancel({ sessionID: fixture.sessionID, goalID: other.id, expectedRevision: 1 })
    expect((yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 2 })).status).toBe("active")
  }))

  it.live("admits one stable synthetic round under concurrent wake and service reconstruction", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const goal = yield* fixture.goals.set({ sessionID: fixture.sessionID, objective: "Persistent round", conditions: conditions(), budget: {} })
    const competing = yield* Effect.all(Array.from({ length: 6 }, () => fixture.goals.advance({ sessionID: fixture.sessionID, goalID: goal.id })), { concurrency: "unbounded" })
    expect(competing.filter((result) => result.state === "admitted")).toHaveLength(1)
    const saved = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: goal.id })
    expect(saved?.rounds).toHaveLength(1)
    expect(saved?.accounting.rounds).toBe(1)
    expect(yield* fixture.db.select().from(SessionInboxTable).where(eq(SessionInboxTable.session_id, fixture.sessionID)).all().pipe(Effect.orDie)).toHaveLength(1)
    const rebuilt = yield* SessionGoal.make()
    expect((yield* rebuilt.advance({ sessionID: fixture.sessionID, goalID: goal.id })).state).toBe("waiting")
    expect(yield* rebuilt.recover()).toEqual([fixture.sessionID])
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: goal.id }))?.rounds).toHaveLength(1)
  }))

  it.live("blocks queued delivery after agent switch and requires an explicit Meta resume", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture)
    yield* fixture.db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, fixture.sessionID)).run().pipe(Effect.orDie)
    expect(yield* fixture.goals.beforeRoundDelivery({ sessionID: fixture.sessionID, inputID: started.round.inputID })).toBe(false)
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.pauseCode).toBe("agent_changed")
    yield* fixture.db.update(SessionTable).set({ agent: "meta" }).where(eq(SessionTable.id, fixture.sessionID)).run().pipe(Effect.orDie)
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).state).toBe("blocked")
    yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    expect(yield* fixture.goals.beforeRoundDelivery({ sessionID: fixture.sessionID, inputID: started.round.inputID })).toBe(true)
  }))

  it.live("deduplicates logical Steps and individually counts physical retries and missing usage", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { attempts: 2, tokens: 100 })
    yield* deliver(fixture, started.round)
    const first = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: first.refs, usage })
    yield* fixture.goals.settleAttempt({ refs: first.refs, usage })
    const retried = yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, assistantMessageID: first.assistantMessageID, kind: "coordinator" })
    yield* fixture.goals.settleAttempt({ refs: retried })
    const goal = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(goal?.accounting).toMatchObject({ rounds: 1, coordinator: { steps: 1, attempts: 2, recordedTokens: 10, unknownAttempts: 1 } })
    expect(goal?.pauseReason).toBe("budget")
    expect(goal?.pauseCode).toBe("budget_unverified")
    expect((yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })).status).toBe("paused")
    expect(yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, assistantMessageID: first.assistantMessageID, kind: "coordinator" }).pipe(Effect.flip)).toMatchObject({ _tag: "SessionGoal.BudgetError" })
    yield* fixture.goals.settleAttempt({ refs: retried, usage })
    yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    expect(yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, assistantMessageID: first.assistantMessageID, kind: "coordinator" }).pipe(Effect.flip)).toMatchObject({ reason: "attempt_budget" })
  }))

  it.live("counts compaction separately and excludes an unrelated title request", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture)
    yield* deliver(fixture, started.round)
    expect(yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, kind: "auxiliary" })).toEqual([])
    const compaction = yield* fixture.goals.beforeAttempt({ sessionID: fixture.sessionID, kind: "compaction" })
    yield* fixture.goals.settleAttempt({ refs: compaction, usage })
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.accounting).toMatchObject({ coordinator: { steps: 0, attempts: 0 }, compaction: { steps: 0, attempts: 1, recordedTokens: 10 }, auxiliary: { attempts: 0 } })
  }))

  it.live("P3 reuses the saved physical attempt identity and rejects conflicting known usage", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { attempts: 2, tokens: 100 })
    yield* deliver(fixture, started.round)
    const assistantMessageID = SessionMessage.ID.create()
    const input = { sessionID: fixture.sessionID, assistantMessageID, kind: "coordinator" as const, attemptID: "gatt_stable_primary" }
    const refs = yield* fixture.goals.beforeAttempt(input)
    expect(yield* fixture.goals.beforeAttempt(input)).toEqual(refs)
    expect(refs).toEqual([{ sessionID: fixture.sessionID, goalID: started.goal.id, attemptID: input.attemptID }])
    yield* fixture.goals.settleAttempt({ refs })
    yield* fixture.goals.settleAttempt({ refs, usage })
    yield* fixture.goals.settleAttempt({ refs, usage })
    const conflict = yield* fixture.goals.settleAttempt({ refs, usage: { ...usage, output: usage.output + 1 } }).pipe(Effect.flip)
    expect(conflict).toMatchObject({ _tag: "SessionGoal.Error", reason: "usage_conflict" })
    const goal = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(goal?.accounting.coordinator).toMatchObject({ steps: 1, attempts: 1, recordedTokens: 10, unknownAttempts: 0 })
    expect(goal?.attempts).toMatchObject([{ id: input.attemptID, assistantMessageID, usage }])
  }))

  it.live("requires complete token settlement before completed and preserves cancellation after unknown usage", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { tokens: 100 })
    yield* deliver(fixture, started.round)
    const attempt = yield* request(fixture)
    yield* command(fixture, attempt.assistantMessageID)
    const pending = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(pending?.satisfiedConditionIDs).toEqual(["command"])
    expect(pending?.status).toBe("active")
    expect(pending?.accounting.coordinator.pendingAttempts).toBe(1)
    yield* fixture.goals.settleAttempt({ refs: attempt.refs })
    yield* complete(fixture, started.round, attempt.assistantMessageID)
    const unknown = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(unknown).toMatchObject({ status: "paused", pauseReason: "budget", pauseCode: "budget_unverified" })
    expect(unknown?.accounting.coordinator.unknownAttempts).toBe(1)
    if (!unknown) return yield* Effect.die(new Error("missing Goal"))
    const confirmed = yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1,
      evidenceIDs: unknown.evidence.map((item) => item.id), evidenceSetDigest: unknown.evidenceSetDigest })
    expect(confirmed.status).toBe("paused")
    expect(confirmed.pauseCode).toBe("budget_unverified")
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).state).toBe("blocked")
    yield* fixture.goals.settleAttempt({ refs: attempt.refs, usage })
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.status).toBe("completed")
    expect(yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 }).pipe(Effect.flip)).toMatchObject({ reason: "terminal" })
    const next = yield* start(fixture, { tokens: 100 })
    yield* deliver(fixture, next.round)
    const cancelledAttempt = yield* request(fixture)
    yield* fixture.goals.cancel({ sessionID: fixture.sessionID, goalID: next.goal.id, expectedRevision: 1 })
    yield* fixture.goals.settleAttempt({ refs: cancelledAttempt.refs })
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: next.goal.id }))?.status).toBe("cancelled")
  }))

  it.live("requires every exact command producer and preserves stale-revision evidence for explicit human reuse", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const goal = yield* fixture.goals.set({ sessionID: fixture.sessionID, objective: "Two verifications", conditions: [
      ...conditions(), SessionGoal.Condition.make({ id: "accept", kind: "human_acceptance", description: "Confirm the generated implementation" }),
    ], budget: {} })
    const round = (yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: goal.id })).round
    if (!round) return yield* Effect.die(new Error("missing round"))
    yield* deliver(fixture, round)
    const attempt = yield* request(fixture)
    yield* command(fixture, attempt.assistantMessageID, { command: "bun test unrelated" })
    yield* command(fixture, attempt.assistantMessageID, { producerName: "other" })
    yield* command(fixture, attempt.assistantMessageID, { started: 0 })
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: goal.id }))?.evidence).toHaveLength(0)
    const real = yield* command(fixture, attempt.assistantMessageID)
    yield* fixture.goals.observeTool(real.id)
    yield* fixture.goals.settleAttempt({ refs: attempt.refs, usage })
    yield* complete(fixture, round, attempt.assistantMessageID)
    const observed = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: goal.id })
    expect(observed?.evidence).toHaveLength(1)
    expect(observed?.currentEvidenceIDs).toEqual(observed?.evidence.map((item) => item.id))
    expect(observed?.satisfiedConditionIDs).toEqual(["command"])
    expect(observed?.status).toBe("active")
    const edited = yield* fixture.goals.edit({ sessionID: fixture.sessionID, goalID: goal.id, expectedRevision: 1, objective: "Review revision 2" })
    expect(edited.evidence).toHaveLength(1)
    expect(edited.satisfiedConditionIDs).toEqual([])
    expect(edited.currentEvidenceIDs).toEqual([])
    expect(yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: goal.id, expectedRevision: 1, evidenceIDs: observed?.evidence.map((item) => item.id) ?? [], evidenceSetDigest: observed?.evidenceSetDigest ?? goal.evidenceSetDigest }).pipe(Effect.flip)).toMatchObject({ reason: "stale_revision" })
    const accepted = yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: goal.id, expectedRevision: 2, evidenceIDs: edited.evidence.map((item) => item.id), evidenceSetDigest: observed?.evidenceSetDigest ?? goal.evidenceSetDigest })
    expect(accepted.status).toBe("completed")
    expect(accepted.satisfiedConditionIDs).toEqual(["command", "accept"])
    expect(accepted.currentEvidenceIDs).toEqual(observed?.currentEvidenceIDs ?? [])
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: goal.id })).reason).toBe("completed")
  }))

  it.live("waits for saved workers and keeps the original model Tool actor", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture)
    yield* deliver(fixture, started.round)
    const coordinator = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: coordinator.refs, usage })
    yield* complete(fixture, started.round, coordinator.assistantMessageID)
    const targetSessionID = Session.ID.create()
    yield* fixture.bus.publish(SessionEvent.Created, { sessionID: targetSessionID, projectID: fixture.projectID, location: { directory: AbsolutePath.make("/goal-test") }, slug: targetSessionID, version: "test" })
    const operationID = SessionTask.OperationID.create()
    const workerInputID = SessionMessage.ID.create()
    const operation = SessionTask.OperationInfo.make({
      sourceSessionID: fixture.sessionID,
      sourceLocation: { directory: AbsolutePath.make("/goal-test") },
      sourceMode: "coding",
      operationID,
      inputID: workerInputID,
      targetSessionID,
      requestDigest: SessionTask.OperationDigest.make("a".repeat(64)),
      request: SessionTask.OperationRequest.make({ operationID, inputID: workerInputID, target: { type: "existing_root", sessionID: targetSessionID }, prompt: "Worker", files: undefined, delivery: "queue", resume: false }),
      source: SessionTask.OperationToolSource.make({ type: "model_tool", sessionID: fixture.sessionID, agent: Agent.ID.make("meta"), messageID: coordinator.assistantMessageID, id: "call_task" }),
      selection: SessionTask.OperationSelection.make({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }),
      reservationSeq: Event.Seq.make(0),
      goalRounds: [started.round],
      phase: "running",
      cancelIntent: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    yield* TaskOperation.store(fixture.db, operation, 0)
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).reason).toBe("worker_running")
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.rounds).toHaveLength(1)
    expect(operation.source.type).toBe("model_tool")
    yield* TaskOperation.store(fixture.db, SessionTask.OperationInfo.make({ ...operation, phase: "settled" }), 1)
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).state).toBe("admitted")
  }))

  it.live("requires accurate Schedule pause authorization and never resurrects terminal Goals", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture)
    const paused = yield* fixture.goals.pause({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    const input = { sessionID: fixture.sessionID, goalID: started.goal.id, scheduleID: "schedule", occurrenceID: "occurrence", revision: 1 }
    expect((yield* fixture.goals.scheduleWake(input)).state).toBe("blocked")
    expect((yield* fixture.goals.scheduleWake({ ...input, userResume: { goalRevision: 1, pauseVersion: paused.pauseVersion + 1 } })).state).toBe("blocked")
    const authorized = yield* fixture.goals.scheduleWake({ ...input, userResume: { goalRevision: 1, pauseVersion: paused.pauseVersion } })
    expect(authorized.state).toBe("waiting")
    yield* fixture.goals.cancel({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    expect((yield* fixture.goals.scheduleWake(input)).reason).toBe("cancelled")
  }))

  it.live("restores a pre-admission reservation without copying a round and preserves unknown dispatch recovery", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { tokens: 100 })
    yield* fixture.db.delete(SessionInboxTable).where(eq(SessionInboxTable.id, started.round.inputID)).run().pipe(Effect.orDie)
    const reconstructed = yield* SessionGoal.make()
    const recovered = yield* reconstructed.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(recovered.round?.inputID).toBe(started.round.inputID)
    expect((yield* reconstructed.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.rounds).toHaveLength(1)
    yield* deliver(fixture, started.round)
    yield* request(fixture)
    expect(yield* reconstructed.recover()).toEqual([])
    const paused = yield* reconstructed.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(paused?.pauseCode).toBe("budget_unverified")
    expect((yield* reconstructed.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })).status).toBe("paused")
    expect(yield* fixture.db.select().from(SessionGoalTable).where(and(eq(SessionGoalTable.session_id, fixture.sessionID), eq(SessionGoalTable.id, started.goal.id))).all().pipe(Effect.orDie)).toHaveLength(1)
  }))

  it.live("continues an unfinished Goal from a completed round after owner reconstruction", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture)
    yield* deliver(fixture, started.round)
    const first = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: first.refs, usage })
    yield* complete(fixture, started.round, first.assistantMessageID)
    const rebuilt = yield* SessionGoal.make()
    expect(yield* rebuilt.recover()).toEqual([fixture.sessionID])
    const saved = yield* rebuilt.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(saved?.status).toBe("active")
    expect(saved?.rounds).toHaveLength(2)
    expect(saved?.rounds[0]).toMatchObject({ inputID: started.round.inputID, outcome: "completed" })
    expect(saved?.accounting.coordinator).toMatchObject({ steps: 1, attempts: 1, recordedTokens: 10 })
    expect(yield* SessionInputResult.read(fixture.db, { sessionID: fixture.sessionID, inputID: started.round.inputID })).toMatchObject({
      status: "completed", assistant: { id: first.assistantMessageID },
    })
    expect(yield* fixture.inbox.list(fixture.sessionID)).toMatchObject([{ id: saved?.rounds[1]?.inputID, delivery: "queue" }])
    expect(yield* rebuilt.recover()).toEqual([fixture.sessionID])
    expect((yield* rebuilt.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.rounds).toEqual(saved?.rounds)
    expect(yield* fixture.inbox.list(fixture.sessionID)).toHaveLength(1)
  }))

  it.live("waits for human acceptance after recovering a completed round", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, {}, [SessionGoal.Condition.make({
      id: "accept", kind: "human_acceptance", description: "Confirm the completed implementation",
    })])
    yield* deliver(fixture, started.round)
    const first = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: first.refs, usage })
    yield* complete(fixture, started.round, first.assistantMessageID)
    const rebuilt = yield* SessionGoal.make()
    expect(yield* rebuilt.recover()).toEqual([])
    expect(yield* fixture.inbox.list(fixture.sessionID)).toEqual([])
    expect(yield* rebuilt.get({ sessionID: fixture.sessionID, goalID: started.goal.id })).toMatchObject({
      status: "active", rounds: [started.round], satisfiedConditionIDs: [],
    })
    expect((yield* rebuilt.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).reason).toBe("human_acceptance_required")
  }))

  it.live("applies the saved round budget when recovering a completed round", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { rounds: 1 })
    yield* deliver(fixture, started.round)
    const first = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: first.refs, usage })
    yield* complete(fixture, started.round, first.assistantMessageID)
    const rebuilt = yield* SessionGoal.make()
    expect(yield* rebuilt.recover()).toEqual([])
    expect(yield* rebuilt.get({ sessionID: fixture.sessionID, goalID: started.goal.id })).toMatchObject({
      status: "paused", pauseReason: "budget", pauseCode: "round_budget", rounds: [started.round],
      accounting: { coordinator: { attempts: 1, recordedTokens: 10 } },
    })
    expect(yield* fixture.inbox.list(fixture.sessionID)).toEqual([])
    expect(yield* rebuilt.recover()).toEqual([])
  }))

  it.effect("keeps active elapsed time across pause and resume without counting paused time", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, { activeMilliseconds: 100 })
    yield* TestClock.adjust("40 millis")
    const paused = yield* fixture.goals.pause({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    expect(paused.accounting.activeMilliseconds).toBe(40)
    yield* TestClock.adjust("1 hour")
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.accounting.activeMilliseconds).toBe(40)
    yield* fixture.goals.resume({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1 })
    yield* TestClock.adjust("60 millis")
    expect((yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })).reason).toBe("time_budget")
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.accounting.activeMilliseconds).toBe(100)
  }))

  it.live("counts one shared worker request with explicit attribution and preserves its work after Goal pause", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const operationIDs = [SessionTask.OperationID.create(), SessionTask.OperationID.create()] as const
    const firstOperation = new SessionTask.OperationReadonlyRef({ sourceSessionID: fixture.sessionID, operationID: operationIDs[0] })
    const secondOperation = new SessionTask.OperationReadonlyRef({ sourceSessionID: fixture.sessionID, operationID: operationIDs[1] })
    const first = yield* start(fixture, {}, [SessionGoal.Condition.make({ ...conditions()[0], operation: firstOperation })])
    yield* fixture.goals.pause({ sessionID: fixture.sessionID, goalID: first.goal.id, expectedRevision: 1 })
    const second = yield* start(fixture, {}, [SessionGoal.Condition.make({ ...conditions()[0], operation: secondOperation })])
    const workerID = Session.ID.create()
    yield* fixture.bus.publish(SessionEvent.Created, { sessionID: workerID, projectID: fixture.projectID, location: { directory: AbsolutePath.make("/goal-test") }, slug: workerID, version: "test" })
    const operations = yield* Effect.forEach([first.round, second.round], (round, index) => Effect.gen(function* () {
      const operationID = operationIDs[index]
      if (operationID === undefined) return yield* Effect.die(new Error("missing operation ID"))
      const inputID = SessionMessage.ID.create()
      const operation = SessionTask.OperationInfo.make({ sourceSessionID: fixture.sessionID,
        sourceLocation: { directory: AbsolutePath.make("/goal-test") }, sourceMode: "coding", operationID, inputID,
        targetSessionID: workerID, requestDigest: SessionTask.OperationDigest.make("a".repeat(64)),
        request: SessionTask.OperationRequest.make({ operationID, inputID, target: { type: "existing_root", sessionID: workerID }, prompt: "Worker", files: undefined, delivery: "steer", resume: false }),
        source: SessionTask.OperationToolSource.make({ type: "model_tool", sessionID: fixture.sessionID, agent: Agent.ID.make("meta"), messageID: SessionMessage.ID.create(), id: "worker" }),
        selection: SessionTask.OperationSelection.make({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }), reservationSeq: Event.Seq.make(0), goalRounds: [round], phase: "prepared", cancelIntent: false,
        prepared: new SessionTask.OperationPrepared({ payload: { text: "Worker" }, delivery: "steer", digest: TaskOperation.payloadDigest({ text: "Worker" }, "steer") }),
        createdAt: Date.now(), updatedAt: Date.now() })
      yield* TaskOperation.store(fixture.db, operation, 0)
      yield* fixture.inbox.admit({ id: inputID, sessionID: workerID,
        item: { type: "user", delivery: "steer", payload: { text: "Worker" } },
        operation: new SessionTask.OperationReadonlyRef({ sourceSessionID: fixture.sessionID, operationID }) })
      return operation
    }))
    yield* SessionInbox.promote(fixture.db, fixture.bus, workerID, "input", undefined, { anchorInputID: operations[0].inputID })
    const assistantMessageID = SessionMessage.ID.create()
    const refs = yield* fixture.goals.beforeAttempt({ sessionID: workerID, assistantMessageID, kind: "coordinator" })
    expect(refs).toHaveLength(2)
    yield* fixture.goals.settleAttempt({ refs, usage })
    const saved = yield* fixture.goals.list(fixture.sessionID)
    expect(saved).toHaveLength(2)
    expect(saved.every((goal) => goal.accounting.worker.steps === 1 && goal.accounting.worker.attempts === 1 && goal.accounting.worker.recordedTokens === 10 && goal.accounting.worker.sharedTokens === 10)).toBe(true)
    expect(new Set(saved.flatMap((goal) => goal.attempts.map((attempt) => attempt.id))).size).toBe(1)
    expect(saved.flatMap((goal) => goal.attempts).every((attempt) => attempt.rounds.length === 2)).toBe(true)
    expect(saved.find((goal) => goal.id === first.goal.id)?.status).toBe("paused")
    expect((yield* fixture.db.select().from(SessionInputResultTable).where(eq(SessionInputResultTable.session_id, workerID)).all().pipe(Effect.orDie))).toHaveLength(2)
    expect(saved.find((goal) => goal.id === first.goal.id)?.attempts[0]?.operations).toEqual([firstOperation])
    expect(saved.find((goal) => goal.id === second.goal.id)?.attempts[0]?.operations).toEqual([secondOperation])
    yield* fixture.bus.publish(SessionEvent.Step.Started, { sessionID: workerID, assistantMessageID, agent: Agent.ID.make("build"), model, started: Date.now() })
    yield* command({ ...fixture, sessionID: workerID }, assistantMessageID)
    const completed = yield* fixture.goals.list(fixture.sessionID)
    expect(completed.every((goal) => goal.status === "completed")).toBe(true)
    expect(completed.find((goal) => goal.id === first.goal.id)?.evidence[0]?.operation).toEqual(firstOperation)
    expect(completed.find((goal) => goal.id === second.goal.id)?.evidence[0]?.operation).toEqual(secondOperation)
  }))

  for (const operationCount of [1, 2]) {
    it.live(`attributes ${operationCount} worker operation memberships to their exact Goal conditions`, () => Effect.gen(function* () {
      const fixture = yield* setup()
      const workerID = Session.ID.create()
      const revision = WorkflowAsset.Revision.make(Hash.sha256("expected artifact"))
      const firstOperation = new SessionTask.OperationReadonlyRef({ sourceSessionID: fixture.sessionID, operationID: SessionTask.OperationID.create() })
      const references = [firstOperation, ...Array.from({ length: operationCount - 1 }, () =>
        new SessionTask.OperationReadonlyRef({ sourceSessionID: fixture.sessionID, operationID: SessionTask.OperationID.create() }))]
      const started = yield* start(fixture, {}, [
        SessionGoal.Condition.make({ ...conditions()[0], id: firstOperation.operationID, operation: firstOperation }),
        ...references.slice(1).map((operation) => SessionGoal.Condition.make({ ...conditions()[0], id: operation.operationID, operation })),
        ...references.map((operation) => SessionGoal.Condition.make({ id: "artifact:" + operation.operationID, kind: "artifact", operation,
          sessionID: workerID, artifactID: "artifact", revision, relativePath: "result.md" })),
      ])
      yield* deliver(fixture, started.round)
      yield* fixture.bus.publish(SessionEvent.Created, { sessionID: workerID, projectID: fixture.projectID,
        location: { directory: AbsolutePath.make("/goal-test") }, slug: workerID, version: "test", agent: Agent.ID.make("build") })
      const inputs = yield* Effect.forEach(references, (operationRef) => Effect.gen(function* () {
        const inputID = SessionMessage.ID.create()
        const operationID = operationRef.operationID
        yield* TaskOperation.store(fixture.db, SessionTask.OperationInfo.make({ sourceSessionID: fixture.sessionID,
          sourceLocation: { directory: AbsolutePath.make("/goal-test") }, sourceMode: "coding", operationID, inputID,
          targetSessionID: workerID, requestDigest: SessionTask.OperationDigest.make("a".repeat(64)),
          request: SessionTask.OperationRequest.make({ operationID, inputID, target: { type: "existing_root", sessionID: workerID }, prompt: "Worker", files: undefined, delivery: "steer", resume: false }),
          source: SessionTask.OperationToolSource.make({ type: "model_tool", sessionID: fixture.sessionID, agent: Agent.ID.make("meta"), messageID: SessionMessage.ID.create(), id: "worker" }),
          selection: SessionTask.OperationSelection.make({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }), reservationSeq: Event.Seq.make(0), goalRounds: [started.round], phase: "prepared", cancelIntent: false,
          prepared: new SessionTask.OperationPrepared({ payload: { text: "Worker" }, delivery: "steer", digest: TaskOperation.payloadDigest({ text: "Worker" }, "steer") }),
          createdAt: Date.now(), updatedAt: Date.now() }), 0)
        yield* fixture.inbox.admit({ id: inputID, sessionID: workerID, item: { type: "user", delivery: "steer", payload: { text: "Worker" } }, operation: operationRef })
        return inputID
      }))
      const anchorInputID = inputs[0]
      if (!anchorInputID) return yield* Effect.die(new Error("missing worker input"))
      yield* SessionInbox.promote(fixture.db, fixture.bus, workerID, "input", undefined, { anchorInputID })
      const assistantMessageID = SessionMessage.ID.create()
      const refs = yield* fixture.goals.beforeAttempt({ sessionID: workerID, assistantMessageID, kind: "coordinator" })
      yield* fixture.bus.publish(SessionEvent.Step.Started, { sessionID: workerID, assistantMessageID, agent: Agent.ID.make("build"), model, started: Date.now() })
      yield* command({ ...fixture, sessionID: workerID }, assistantMessageID)
      yield* fixture.goals.settleAttempt({ refs, usage })
      yield* complete({ ...fixture, sessionID: workerID }, { ...started.round, sessionID: workerID, inputID: anchorInputID }, assistantMessageID)
      const artifact: WorkArtifact.ArtifactSnapshot = { artifact: { id: "artifact", sessionID: workerID, kind: "document", title: "Result",
        mediaType: "text/markdown", relativePath: "result.md", status: "available", createdAt: Date.now(), updatedAt: Date.now() }, revision }
      yield* fixture.goals.observeArtifact(workerID).pipe(Effect.provide(Layer.mock(WorkArtifact.Service)({
        get: () => Effect.succeed({ ...artifact, revision: WorkflowAsset.Revision.make(Hash.sha256("other artifact")) }),
      })))
      expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.evidence).toHaveLength(operationCount)
      yield* fixture.goals.observeArtifact(workerID).pipe(Effect.provide(Layer.mock(WorkArtifact.Service)({
        get: (sessionID) => {
          expect(sessionID).toBe(workerID)
          return Effect.succeed(artifact)
        },
      })))
      const goal = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
      expect(goal?.status).toBe("completed")
      expect(goal?.attempts).toHaveLength(1)
      expect(goal?.attempts[0]?.operations).toHaveLength(operationCount)
      expect(goal?.attempts[0]?.operations).toEqual(expect.arrayContaining(references))
      expect(goal?.attempts[0]?.operation).toEqual(operationCount === 1 ? firstOperation : undefined)
      expect(goal?.evidence).toHaveLength(operationCount * 2)
      expect(goal?.evidence.map((item) => item.operation)).toEqual(expect.arrayContaining(references))
      expect(goal?.evidence.every((item) => item.operations?.length === operationCount)).toBe(true)
      expect(goal?.evidence.filter((item) => item.kind === "artifact").map((item) => item.operation)).toEqual(expect.arrayContaining(references))
      expect(goal?.accounting.worker).toMatchObject({ steps: 1, attempts: 1, recordedTokens: 10 })
    }))
  }

  it.live("MP04 reuses the immutable artifact evidence only after explicit revision confirmation", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const artifact: WorkArtifact.ArtifactSnapshot = { artifact: { id: "existing_artifact", sessionID: fixture.sessionID, kind: "document", title: "Pinned result",
      mediaType: "text/markdown", relativePath: "result.md", status: "available", createdAt: 0, updatedAt: 0 },
      revision: WorkflowAsset.Revision.make(Hash.sha256("pinned result")) }
    const started = yield* start(fixture, {}, [
      SessionGoal.Condition.make({ id: "artifact", kind: "artifact", sessionID: fixture.sessionID, artifactID: artifact.artifact.id,
        revision: artifact.revision, relativePath: artifact.artifact.relativePath }),
      SessionGoal.Condition.make({ id: "accept", kind: "human_acceptance", description: "Accept the pinned result" }),
    ])
    yield* deliver(fixture, started.round)
    const attempt = yield* request(fixture)
    yield* fixture.goals.settleAttempt({ refs: attempt.refs, usage })
    yield* complete(fixture, started.round, attempt.assistantMessageID)
    const layer = Layer.mock(WorkArtifact.Service)({ get: () => Effect.succeed(artifact) })
    yield* fixture.goals.observeArtifact(fixture.sessionID).pipe(Effect.provide(layer))
    const observed = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    if (!observed) return yield* Effect.die(new Error("missing Goal"))
    expect(observed.evidence).toHaveLength(1)
    expect(observed.currentEvidenceIDs).toEqual([observed.evidence[0].id])
    expect(observed.satisfiedConditionIDs).toEqual(["artifact"])
    const encoded = Schema.encodeSync(SessionGoal.Info)(observed)
    const historical = Object.fromEntries(Object.entries(encoded).filter(([key]) => key !== "currentEvidenceIDs"))
    expect(Schema.decodeUnknownSync(SessionGoal.Info)(historical).currentEvidenceIDs).toEqual([])
    const edited = yield* fixture.goals.edit({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: 1, objective: "Recheck the same result" })
    const next = yield* fixture.goals.advance({ sessionID: fixture.sessionID, goalID: started.goal.id })
    if (!next.round) return yield* Effect.die(new Error("missing second round"))
    yield* deliver(fixture, next.round)
    yield* fixture.goals.observeArtifact(fixture.sessionID).pipe(Effect.provide(layer))
    const repeated = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    expect(repeated?.evidence).toEqual(observed.evidence)
    expect(repeated?.currentEvidenceIDs).toEqual([])
    expect(repeated?.satisfiedConditionIDs).toEqual([])
    const accepted = yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: started.goal.id, expectedRevision: edited.revision,
      evidenceIDs: observed.currentEvidenceIDs, evidenceSetDigest: observed.evidenceSetDigest })
    expect(accepted.status).toBe("completed")
    expect(accepted.currentEvidenceIDs).toEqual(observed.currentEvidenceIDs)
    expect(accepted.evidenceSetDigest).toBe(observed.evidenceSetDigest)
    yield* fixture.goals.observeArtifact(fixture.sessionID).pipe(Effect.provide(layer))
    expect((yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.evidence).toEqual(accepted.evidence)
    expect((yield* fixture.goals.list(fixture.sessionID))[0].currentEvidenceIDs).toEqual(accepted.currentEvidenceIDs)
    const rebuilt = yield* SessionGoal.make()
    expect((yield* rebuilt.get({ sessionID: fixture.sessionID, goalID: started.goal.id }))?.currentEvidenceIDs).toEqual(accepted.currentEvidenceIDs)
  }))

  it.live("MP04 confirmation round-trips the projected current evidence after historical human acceptance", () => Effect.gen(function* () {
    const fixture = yield* setup()
    const started = yield* start(fixture, {}, [
      ...conditions(), SessionGoal.Condition.make({ id: "second", kind: "command_result", command: "bun test second", cwd: "/goal-test", exit: 0, outputIncludes: ["passed"] }),
      SessionGoal.Condition.make({ id: "accept", kind: "human_acceptance", description: "Accept the current evidence set" }),
    ])
    yield* deliver(fixture, started.round)
    const attempt = yield* request(fixture)
    yield* command(fixture, attempt.assistantMessageID)
    const first = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    if (!first) return yield* Effect.die(new Error("missing Goal"))
    yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: first.id, expectedRevision: first.revision,
      evidenceIDs: first.currentEvidenceIDs, evidenceSetDigest: first.evidenceSetDigest })
    yield* command(fixture, attempt.assistantMessageID, { command: "bun test second" })
    const current = yield* fixture.goals.get({ sessionID: fixture.sessionID, goalID: started.goal.id })
    if (!current) return yield* Effect.die(new Error("missing current Goal"))
    expect(current.evidence).toHaveLength(3)
    expect(current.currentEvidenceIDs).toHaveLength(2)
    expect(current.evidence.filter((item) => item.kind === "human_acceptance").every((item) => !current.currentEvidenceIDs.includes(item.id))).toBe(true)
    const accepted = yield* fixture.goals.confirm({ sessionID: fixture.sessionID, goalID: current.id, expectedRevision: current.revision,
      evidenceIDs: current.currentEvidenceIDs, evidenceSetDigest: current.evidenceSetDigest })
    expect(accepted.status).toBe("completed")
    expect(accepted.currentEvidenceIDs).toEqual(current.currentEvidenceIDs)
    expect(accepted.evidenceSetDigest).toBe(current.evidenceSetDigest)
  }))
})
