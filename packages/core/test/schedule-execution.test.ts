import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Context, DateTime, Effect, Exit, Layer, Scope, Stream } from "effect"
import { LLMClient, LanguageModel } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Database } from "@aigcfroge/core/database/database"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationFold } from "@aigcfroge/core/delegation/fold"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Instance } from "@aigcfroge/core/instance/service"
import { Job } from "@aigcfroge/core/job"
import { KV } from "@aigcfroge/core/kv"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { Model } from "@aigcfroge/core/model"
import { Permission } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { ScheduleExecution } from "@aigcfroge/core/session/schedule-execution"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { TaskTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskOperation } from "@aigcfroge/core/session/task-operation"
import { Event } from "@aigcfroge/schema/event"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Schedule } from "@aigcfroge/schema/schedule"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const testLayer = AppNodeBuilder.build(
  LayerNode.group([
    ScheduleExecution.node,
    ScheduleService.node,
    ScheduleService.deliveryNode,
    Session.node,
    SessionTask.node,
    SessionGoal.node,
    DelegationService.node,
    DelegationExecution.node,
    Database.node,
    Bus.node,
    SessionStore.node,
    SessionInbox.node,
    SessionExecution.node,
    MetaAgentService.node,
    Job.node,
    KV.node,
    LocationServiceMap.node,
    Instance.node,
    Project.node,
    llmTest,
  ]),
  [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: true })),
    offlineModels,
    LayerNodePlatform.llmClient.replace(llmClient),
    SessionRunnerModel.node.replace(
      Layer.succeed(SessionRunnerModel.Service, {
        resolve: () =>
          Effect.succeed(
            SessionRunnerModel.resolved(
              LanguageModel.make({ id: "schedule", provider: "test", route: OpenAIChat.route }),
              {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              },
            ),
          ),
      }),
    ),
  ],
)
const it = testEffect(testLayer)
const model = Model.Ref.make({ id: Model.ID.make("schedule"), providerID: Provider.ID.make("test") })
const worker = Agent.ID.make("explore")

const setup = Effect.fnUntraced(function* (legacy = false) {
  const sessions = yield* Session.Service
  const location = Location.Ref.make({ directory: AbsolutePath.make((yield* tmpdirScoped()).path) })
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(location)
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@aigcfroge/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provide(local))
  yield* Agent.Service.use((agents) =>
    agents.transform((editor) =>
      editor.update(worker, (agent) => {
        agent.model = model
      }),
    ),
  ).pipe(Effect.provide(local))
  const parent = legacy
    ? yield* createLegacySession({
        location,
        title: "Scheduled legacy source",
        mode: ProductMode.ID.make("coding"),
        agent: Agent.defaultID,
        model,
      })
    : yield* sessions.create({
        location,
        title: "Scheduled root source",
        mode: ProductMode.ID.make("coding"),
        agent: Agent.ID.make("meta"),
        model,
        executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
      })
  const bus = yield* Bus.Service
  yield* bus.publish(SessionEvent.Synthetic, {
    sessionID: parent.id,
    text: "Preserve scheduled notices at this boundary",
  })
  const boundary = (yield* sessions.context(parent.id)).find((message) => message.type === "synthetic")
  if (!boundary) return yield* Effect.die(new Error("Revert boundary missing"))
  yield* bus.publish(SessionEvent.RevertEvent.Staged, {
    sessionID: parent.id,
    revert: { messageID: boundary.id, files: [] },
  })
  const database = yield* Database.Service
  return {
    parent,
    sessions,
    bus,
    schedules: yield* ScheduleService.Service,
    runtime: yield* ScheduleExecution.Service,
    tasks: yield* SessionTask.Service,
    db: database.db,
    llm: yield* TestLLM.Test,
    delegations: yield* DelegationService.Service,
    execution: yield* DelegationExecution.Service,
  }
})

const reserveRoot = Effect.fnUntraced(function* () {
  const fixture = yield* setup()
  const target = yield* createLegacySession({
    location: fixture.parent.location,
    title: "Existing scheduled target",
    mode: ProductMode.ID.make("chat"),
    agent: Agent.defaultID,
    model,
  })
  const task = (yield* fixture.tasks.append({
    sessionID: fixture.parent.id,
    tasks: [{ content: "Scheduled root anchor", status: "pending", priority: "medium" }],
  }))[0]
  if (!task) return yield* Effect.die(new Error("Source Task missing"))
  const created = yield* fixture.schedules.createRule(
    new Schedule.Create({
      sessionID: fixture.parent.id,
      kind: "prompt",
      content: "Saved scheduled work",
      timezone: "UTC",
      recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
      target: new Schedule.ExistingTarget({ policy: "existing", sessionID: target.id }),
    }),
    Agent.ID.make("meta"),
  )
  yield* fixture.schedules.bindTask(created.id, task.id)
  const rule = yield* fixture.schedules.getRule(created.id)
  if (!rule) return yield* Effect.die(new Error("Schedule rule missing"))
  const run = yield* fixture.schedules.claimOccurrence(rule.id, rule.nextDueAt ?? 0, "keeper")
  if (!run) return yield* Effect.die(new Error("Occurrence missing"))
  const reserved = yield* fixture.tasks.reserveOperation({
    sessionID: fixture.parent.id,
    request: new SessionTask.OperationRequest({
      operationID: run.operationID,
      inputID: run.inputID,
      taskID: task.id,
      expectedRevision: task.revision,
      target: new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
      prompt: run.snapshot.content,
      description: run.snapshot.content,
      delivery: "queue",
      resume: false,
    }),
    source: new SessionTask.OperationScheduleSource({
      type: "schedule_occurrence",
      sessionID: fixture.parent.id,
      agent: Agent.ID.make("meta"),
      scheduleID: rule.id,
      occurrenceID: run.id,
      revision: run.ruleRevision,
    }),
    selection: new SessionTask.OperationSelection({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }),
    sourceLocation: fixture.parent.location,
    sourceMode: fixture.parent.mode ?? ProductMode.ID.make("coding"),
  })
  return {
    ...fixture,
    target,
    task,
    rule,
    run,
    operation: reserved.operation,
    ref: { sessionID: fixture.parent.id, operationID: run.operationID },
  }
})

const settleRoot = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof reserveRoot>>,
  text = "Saved terminal text",
) {
  return yield* fixture.tasks.advanceOperation({
    ...fixture.ref,
    change: new SessionTask.OperationChange({
      phase: "settled",
      result: new SessionTask.OperationResultRef({
        sessionID: fixture.target.id,
        inputID: fixture.run.inputID,
        sharedInputs: [fixture.run.inputID],
        resultEventID: Event.ID.create(),
        text,
        digest: SessionTask.OperationDigest.make(
          CompositionDigest.computeDigest({ text, inputID: fixture.run.inputID }),
        ),
      }),
    }),
  })
})

const queuedLegacy = Effect.fnUntraced(function* () {
  const fixture = yield* setup(true)
  const task = (yield* fixture.tasks.append({
    sessionID: fixture.parent.id,
    tasks: [
      {
        content: "Retained scheduled child",
        status: "scheduled",
        priority: "medium",
        agentID: worker,
        recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
      },
    ],
  }))[0]
  if (!task) return yield* Effect.die(new Error("Scheduled source Task missing"))
  const rule = (yield* fixture.schedules.listRules(fixture.parent.id)).find((item) => item.taskID === task.id)
  if (!rule) return yield* Effect.die(new Error("Original Task write did not project its Schedule rule"))
  const run = yield* fixture.schedules.claimOccurrence(rule.id, rule.nextDueAt ?? 0, "keeper")
  if (!run?.targetSessionID) return yield* Effect.die(new Error("Legacy occurrence missing its child identity"))
  const source = new Permission.OperationSource({
    type: "operation",
    sessionID: fixture.parent.id,
    operationID: run.operationID,
  })
  const claimed = yield* fixture.tasks.patch(
    {
      sessionID: fixture.parent.id,
      id: task.id,
      expectedRevision: task.revision,
      status: "in_progress",
      expect: ["scheduled"],
    },
    {
      claim: source,
      commit: (saved) =>
        fixture.schedules
          .advanceOccurrence(run.id, new Schedule.OccurrenceChange({ taskRevision: saved.revision }))
          .pipe(Effect.asVoid, Effect.orDie),
    },
  )
  if (!claimed) return yield* Effect.die(new Error("Legacy Task claim missing"))
  const route = yield* fixture.delegations.internalParticipant({
    occurrenceID: run.id,
    agent: worker,
    actor: Agent.defaultID,
  })
  const child = yield* createLegacySession({
    id: run.targetSessionID,
    parentID: fixture.parent.id,
    title: "Queued scheduled child",
    agent: worker,
    model,
  })
  yield* fixture.delegations.bindParticipant({
    delegationID: route.delegationID,
    participantID: route.participantID,
    childSessionID: child.id,
  })
  const state = yield* fixture.delegations.foldState(route.delegationID)
  const delivery = [...(state?.deliveries.values() ?? [])].find((item) => item.turnID === route.turnID)
  if (!delivery) return yield* Effect.die(new Error("Scheduled delivery missing"))
  const receipt = {
    delegationID: route.delegationID,
    ...delivery,
    childSessionID: child.id,
    inputID: DelegationFold.inputID(route.delegationID, delivery),
  }
  expect(receipt.inputID).toBe(run.inputID)
  yield* fixture.sessions.prompt({
    sessionID: child.id,
    id: receipt.inputID,
    text: run.snapshot.content,
    delivery: "queue",
    resume: false,
    metadata: {
      delegation: receipt,
      task: {
        parentTaskID: claimed.id,
        parentTaskRevision: claimed.revision,
        description: run.snapshot.content,
        background: true,
        source,
      },
    },
  })
  const admitted = yield* fixture.schedules.advanceOccurrence(
    run.id,
    new Schedule.OccurrenceChange({
      status: "admitted",
      receipt,
      actorAgent: Agent.defaultID,
      admission: new Schedule.Admission({
        targetSessionID: child.id,
        inputID: receipt.inputID,
        operationID: run.operationID,
        taskID: claimed.id,
        taskRevision: claimed.revision,
        admittedAt: (yield* DateTime.nowAsDate).getTime(),
      }),
    }),
  )
  return { ...fixture, task: claimed, rule, run: admitted, child, receipt }
})

describe("Schedule execution consumes original owners", () => {
  it.live("runOnce admits the original scheduled child and observes its receipt without another model runner", () =>
    Effect.gen(function* () {
      const fixture = yield* setup(true)
      const task = (yield* fixture.tasks.append({
        sessionID: fixture.parent.id,
        tasks: [
          {
            content: "Run the scheduled child",
            status: "scheduled",
            priority: "medium",
            agentID: worker,
            recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
          },
        ],
      }))[0]
      if (!task) return yield* Effect.die(new Error("Scheduled Task missing"))
      const rule = (yield* fixture.schedules.listRules(fixture.parent.id)).find((item) => item.taskID === task.id)
      if (!rule) return yield* Effect.die(new Error("Task Schedule rule missing"))
      yield* fixture.llm.push(TestLLM.text("Scheduled child result", "schedule-runtime"))
      const claimed = yield* fixture.runtime.runOnce(rule.id, rule.revision)
      const receipt = yield* pollWithTimeout(
        fixture.schedules.occurrence(claimed.id).pipe(Effect.map((run) => run?.receipt)),
        "Scheduled occurrence did not admit its original child",
        "10 seconds",
      )
      const result = yield* awaitWithTimeout(
        fixture.execution.wait(receipt),
        "Scheduled child did not complete",
        "10 seconds",
      )
      expect(result).toMatchObject({
        status: "completed",
        text: "Scheduled child result",
        sourceSettlement: "completed",
      })
      expect(yield* fixture.runtime.reconcile(claimed.id)).toMatchObject({
        status: "completed",
        sourceSettlement: "completed",
      })
      expect(yield* fixture.sessions.get(receipt.childSessionID)).toMatchObject({
        parentID: fixture.parent.id,
        mode: fixture.parent.mode,
        agent: worker,
      })
      expect(receipt.inputID).toBe(claimed.inputID)
      expect(yield* fixture.schedules.runs(rule.id)).toHaveLength(1)
      expect(yield* fixture.llm.requests()).toHaveLength(1)
      return undefined
    }),
  )

  it.live("projects the original root result and source CAS once with one canonical full-text notice", () =>
    Effect.gen(function* () {
      const fixture = yield* reserveRoot()
      const text = "完整结果🙂" + "x".repeat(5000)
      const saved = yield* settleRoot(fixture, text)
      const run = yield* fixture.runtime.reconcile(fixture.run.id)
      expect(run).toMatchObject({
        status: "completed",
        sourceSettlement: "completed",
        output: text,
        result: saved.result,
      })
      expect(saved.sourceSettlement).toBe("settled")
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBeUndefined()
      const notices = yield* fixture.sessions.inbox(fixture.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]?.id).toBe(TaskOperation.notificationID(fixture.ref))
      expect(JSON.stringify(notices)).toContain(text)
      const events = yield* fixture.bus.log({ aggregateID: fixture.parent.id }).pipe(Stream.runCollect)
      expect(yield* fixture.runtime.reconcile(fixture.run.id)).toEqual(run)
      expect(yield* fixture.sessions.inbox(fixture.parent.id)).toEqual(notices)
      expect(yield* fixture.bus.log({ aggregateID: fixture.parent.id }).pipe(Stream.runCollect)).toEqual(events)
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("preserves an edited source Task while releasing the completed occurrence after a source CAS conflict", () =>
    Effect.gen(function* () {
      const fixture = yield* reserveRoot()
      yield* fixture.db
        .update(TaskTable)
        .set({ content: "User revision", revision: (fixture.operation.taskRevision ?? 0) + 1 })
        .where(eq(TaskTable.id, fixture.task.id))
        .run()
        .pipe(Effect.orDie)
      const saved = yield* settleRoot(fixture)
      const run = yield* fixture.runtime.reconcile(fixture.run.id)
      expect(saved.sourceSettlement).toBe("conflict")
      expect(run).toMatchObject({ status: "completed", sourceSettlement: "conflict", result: saved.result })
      expect((yield* fixture.tasks.get(fixture.parent.id))[0]?.content).toBe("User revision")
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBeUndefined()
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("keeps a saved completion when cancellation arrives before the occurrence observes it", () =>
    Effect.gen(function* () {
      const fixture = yield* reserveRoot()
      yield* settleRoot(fixture)
      expect(yield* fixture.runtime.cancelRun(fixture.run.id)).toMatchObject({
        status: "completed",
        sourceSettlement: "completed",
      })
      expect((yield* fixture.tasks.get(fixture.parent.id))[0]?.status).toBe("completed")
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("cancels an unadmitted root operation through its original Task lifecycle", () =>
    Effect.gen(function* () {
      const fixture = yield* reserveRoot()
      expect(yield* fixture.runtime.cancelRun(fixture.run.id)).toMatchObject({
        status: "cancelled",
        sourceSettlement: "cancelled",
      })
      expect(yield* fixture.tasks.operation(fixture.ref)).toMatchObject({
        phase: "cancelled",
        cancelIntent: true,
        sourceSettlement: "settled",
      })
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toHaveLength(0)
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.status).toBe("pending")
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live(
    "keeps an unresolved operation cancellation occupied until the original owner records its terminal outcome",
    () =>
      Effect.gen(function* () {
        const fixture = yield* reserveRoot()
        yield* fixture.tasks.advanceOperation({
          ...fixture.ref,
          change: new SessionTask.OperationChange({ phase: "admitted" }),
        })
        const pending = yield* fixture.runtime.cancelRun(fixture.run.id)
        expect(pending).toMatchObject({
          status: "recovery_required",
          cancelRequested: true,
          error: { code: "cancellation_pending" },
        })
        expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBe(fixture.run.id)
        expect(yield* fixture.runtime.reconcile(fixture.run.id)).toEqual(pending)
        yield* fixture.tasks.advanceOperation({
          ...fixture.ref,
          change: new SessionTask.OperationChange({ phase: "cancelled" }),
        })
        expect(yield* fixture.runtime.reconcile(fixture.run.id)).toMatchObject({
          status: "cancelled",
          sourceSettlement: "cancelled",
        })
        expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBeUndefined()
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
  )

  it.live("a recreated runtime consumes a saved terminal operation without re-admitting its input", () =>
    Effect.gen(function* () {
      const fixture = yield* reserveRoot()
      yield* settleRoot(fixture)
      const context = yield* Effect.context<Layer.Success<typeof testLayer>>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const reopened = yield* Layer.buildWithScope(
        Layer.fresh(ScheduleExecution.layer).pipe(Layer.provide(Layer.succeedContext(context))),
        scope,
      )
      yield* Context.get(reopened, ScheduleExecution.Service).recover()
      const run = yield* fixture.schedules.occurrence(fixture.run.id)
      expect(run).toMatchObject({ status: "completed", sourceSettlement: "completed" })
      expect(yield* fixture.schedules.runs(fixture.rule.id)).toHaveLength(1)
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toHaveLength(0)
      yield* Context.get(reopened, ScheduleExecution.Service).recover()
      expect(yield* fixture.schedules.occurrence(fixture.run.id)).toEqual(run)
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("uses the original legacy child dispatcher and receipt for a scheduled completion", () =>
    Effect.gen(function* () {
      const fixture = yield* queuedLegacy()
      yield* fixture.llm.push(TestLLM.text("Original child full result", "schedule-child"))
      yield* fixture.execution.dispatch({
        delegationID: fixture.receipt.delegationID,
        turnID: fixture.receipt.turnID,
        prompt: fixture.run.snapshot.content,
      })
      const result = yield* awaitWithTimeout(
        fixture.execution.wait(fixture.receipt),
        "Scheduled child receipt did not settle",
        "10 seconds",
      )
      expect(result).toMatchObject({
        status: "completed",
        text: "Original child full result",
        sourceSettlement: "completed",
      })
      const run = yield* fixture.runtime.reconcile(fixture.run.id)
      expect(run).toMatchObject({ status: "completed", output: result.text, sourceSettlement: "completed" })
      expect((yield* fixture.sessions.get(fixture.child.id)).parentID).toBe(fixture.parent.id)
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.status).toBe("pending")
      expect(yield* fixture.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("accepts the original cancelled legacy receipt when its queued InputResult is missing", () =>
    Effect.gen(function* () {
      const fixture = yield* queuedLegacy()
      const run = yield* fixture.runtime.cancelRun(fixture.run.id)
      expect(run).toMatchObject({ status: "cancelled", sourceSettlement: "cancelled" })
      expect(
        yield* SessionInputResult.read(fixture.db, { sessionID: fixture.child.id, inputID: fixture.receipt.inputID }),
      ).toMatchObject({ status: "missing" })
      expect(yield* fixture.sessions.inbox(fixture.child.id)).toHaveLength(0)
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBeUndefined()
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.status).toBe("pending")
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("releases a recovered legacy occurrence only after the original close records cancellation", () =>
    Effect.gen(function* () {
      const fixture = yield* queuedLegacy()
      yield* fixture.execution.recover({
        kind: "delegation",
        ...fixture.receipt,
        parentSessionID: fixture.parent.id,
        description: fixture.run.snapshot.content,
      })
      expect(yield* fixture.runtime.reconcile(fixture.run.id)).toMatchObject({
        status: "recovery_required",
        sourceSettlement: "pending",
      })
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBe(fixture.run.id)
      const cancelled = yield* fixture.runtime.cancelRun(fixture.run.id)
      expect(cancelled).toMatchObject({ status: "cancelled", sourceSettlement: "cancelled" })
      expect(yield* fixture.execution.wait(fixture.receipt)).toMatchObject({
        status: "cancelled",
        sourceSettlement: "cancelled",
      })
      expect((yield* fixture.schedules.getRule(fixture.rule.id))?.activeOccurrenceID).toBeUndefined()
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  )
})
