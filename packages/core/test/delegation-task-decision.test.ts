import { describe, expect } from "bun:test"
import { LLMClient } from "@aigcfroge/ai"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Instance } from "@aigcfroge/core/instance/service"
import { Job } from "@aigcfroge/core/job"
import { Git } from "@aigcfroge/core/git"
import { AppProcess } from "@aigcfroge/util/process"
import { KV } from "@aigcfroge/core/kv"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { Provider } from "@aigcfroge/core/provider"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { inArray, sql } from "drizzle-orm"
import { Context, Effect, Exit, Layer } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const layer = AppNodeBuilder.build(
  LayerNode.group([
    Git.node,
    AppProcess.node,
    DelegationExecution.node,
    FSUtil.node,
    DelegationService.node,
    Session.node,
    SessionComposition.node,
    SessionExecution.node,
    SessionStore.node,
    SessionTask.node,
    ScheduleService.node,
    Database.node,
    Project.node,
    Bus.node,
    KV.node,
    Job.node,
    Instance.node,
    LocationServiceMap.node,
    llmTest,
  ]),
  [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: true })),
    offlineModels,
    LayerNodePlatform.llmClient.replace(llmClient),
  ],
)
const it = testEffect(layer)

const setup = Effect.fnUntraced(function* (background = true) {
  const sessions = yield* Session.Service
  const tasks = yield* SessionTask.Service
  const service = yield* DelegationService.Service
  const execution = yield* DelegationExecution.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const parent = yield* createLegacySession({
    location: Location.Ref.make({ directory: AbsolutePath.make((yield* tmpdirScoped()).path) }),
    title: "Task decision parent",
    model: Model.Ref.make({ id: Model.ID.make("decision"), providerID: Provider.ID.make("test") }),
  })
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(parent.location)
  yield* Plugin.awaitActivation.pipe(Effect.provide(local))
  const worker = Agent.ID.make("task-decision-worker")
  yield* Agent.Service.use((agents) =>
    agents.transform((editor) =>
      editor.update(worker, (agent) => {
        agent.originKind = "builtin"
        agent.mode = "subagent"
      }),
    ),
  ).pipe(Effect.provide(local))
  // A staged revert keeps notifications pending without running the parent model.
  yield* bus.publish(SessionEvent.Synthetic, { sessionID: parent.id, text: "Staged revert boundary" })
  const boundary = (yield* sessions.context(parent.id)).find((message) => message.type === "synthetic")
  if (!boundary) return yield* Effect.die(new Error("Revert boundary missing"))
  yield* bus.publish(SessionEvent.RevertEvent.Staged, {
    sessionID: parent.id,
    revert: { messageID: boundary.id, files: [] },
  })
  const parentTask = (yield* tasks.append({
    sessionID: parent.id,
    tasks: [{ content: "Retain this decision", status: "in_progress", priority: "medium" }],
  })).at(-1)
  if (!parentTask) return yield* Effect.die(new Error("Parent Task missing"))
  const child = yield* createLegacySession({
    parentID: parent.id,
    title: "Queued child",
    agent: worker,
    model: parent.model,
  })
  const delegation = yield* service.create({ parentSessionID: parent.id, title: "Task decision" })
  const participant = yield* service.addParticipant({
    delegationID: delegation.id,
    provider: "internal",
    target: worker,
    role: "implementer",
    context: "fresh",
  })
  yield* service.bindParticipant({
    delegationID: delegation.id,
    participantID: participant.id,
    childSessionID: child.id,
  })
  const turn = yield* service.appendTurn({
    delegationID: delegation.id,
    kind: "task",
    delivery: "queue",
    participantIDs: [participant.id],
    origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
  })
  const state = yield* service.foldState(delegation.id)
  const delivery = [...(state?.deliveries.values() ?? [])].find((item) => item.turnID === turn.id)
  if (!delivery) return yield* Effect.die(new Error("Delivery missing"))
  const receipt = {
    delegationID: delegation.id,
    ...delivery,
    childSessionID: child.id,
    inputID: DelegationExecution.inputID(delegation.id, delivery),
  }
  yield* sessions.prompt({
    sessionID: child.id,
    id: receipt.inputID,
    text: "Require explicit reconciliation before executing",
    resume: false,
    metadata: {
      delegation: receipt,
      task: {
        parentTaskID: parentTask.id,
        parentTaskRevision: parentTask.revision,
        description: "Task decision",
        background,
      },
    },
  })
  return { sessions, tasks, service, execution, database, parent, child, parentTask, delegation, receipt }
})

describe("Delegation Task decision correction", () => {
  it.live("retains the first notification and receipt while a new execution owner applies close once", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.execution.recoverPending
      expect(yield* seed.tasks.get(seed.parent.id)).toMatchObject([
        { status: "failed", revision: seed.parentTask.revision + 1 },
      ])
      const notice = yield* seed.sessions.inbox(seed.parent.id)
      expect(notice).toHaveLength(1)
      const context = yield* Effect.context<Layer.Success<typeof layer>>()
      const owner = yield* Layer.build(
        Layer.fresh(DelegationExecution.layer).pipe(Layer.provide(Layer.succeedContext(context))),
      )
      const execution = Context.get(owner, DelegationExecution.Service)
      yield* execution.close({ delegationID: seed.delegation.id })
      const corrected = yield* seed.tasks.get(seed.parent.id)
      expect(corrected).toMatchObject([
        {
          status: "cancelled",
          revision: seed.parentTask.revision + 2,
          outputDigest: "Delegation closed before input delivery",
        },
      ])
      expect(yield* execution.wait(seed.receipt)).toMatchObject({ status: "recovery_required" })
      yield* execution.recoverPending
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(corrected)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(notice)
      expect(yield* seed.sessions.inbox(seed.child.id)).toEqual([])
      const llm = yield* TestLLM.Test
      expect(yield* llm.requests()).toEqual([])
    }),
  )

  it.live("protects a newer Task revision edited after recovery-required settlement", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.execution.recoverPending
      const edited = yield* seed.tasks.patch({
        sessionID: seed.parent.id,
        id: seed.parentTask.id,
        status: "failed",
        outputDigest: "Human decision retains this failure",
        expectedRevision: seed.parentTask.revision + 1,
      })
      if (edited === undefined) return yield* Effect.die(new Error("Task edit was not committed"))
      expect(edited).toMatchObject({ revision: seed.parentTask.revision + 2 })
      const notice = yield* seed.sessions.inbox(seed.parent.id)
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.execution.wait(seed.receipt)).toMatchObject({ status: "recovery_required" })
      yield* seed.execution.recoverPending
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([edited])
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(notice)
    }),
  )

  it.live("corrects a foreground Task whose unresolved input was removed before close", () =>
    Effect.gen(function* () {
      const seed = yield* setup(false)
      yield* seed.execution.recoverPending
      yield* seed.sessions.cancelInbox({ sessionID: seed.child.id, inboxID: seed.receipt.inputID })
      expect(
        yield* SessionInputResult.read(seed.database.db, {
          sessionID: seed.child.id,
          inputID: seed.receipt.inputID,
        }),
      ).toEqual({ status: "missing" })
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      const corrected = yield* seed.tasks.get(seed.parent.id)
      expect(corrected).toMatchObject([
        {
          status: "cancelled",
          revision: seed.parentTask.revision + 2,
          outputDigest: "Delegation owner closed this delivery",
        },
      ])
      expect(yield* seed.execution.wait(seed.receipt)).toMatchObject({ status: "recovery_required" })
      yield* seed.execution.recoverPending
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(corrected)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
    }),
  )

  it.live("does not claim a Task whose revision changed before the first settlement", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const edited = yield* seed.tasks.patch({
        sessionID: seed.parent.id,
        id: seed.parentTask.id,
        status: "in_progress",
        outputDigest: "Newer work owns this Task",
        expectedRevision: seed.parentTask.revision,
      })
      if (edited === undefined) return yield* Effect.die(new Error("Task edit was not committed"))
      expect(edited).toMatchObject({ revision: seed.parentTask.revision + 1 })
      yield* seed.execution.recoverPending
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.execution.wait(seed.receipt)).toMatchObject({ status: "recovery_required" })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([edited])
    }),
  )

  it.live("rolls back the first Task settlement when its real KV insert fails and recovers it once", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const published: string[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type || event.type === SessionTask.Event.TodoUpdated.type)
            published.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* seed.database.db
        .run(
          sql`
        CREATE TEMP TRIGGER fail_task_marker BEFORE INSERT ON kv
        WHEN NEW.key LIKE 'delegation:task-settlement:%'
        BEGIN SELECT RAISE(ABORT, 'Task marker failure'); END
      `,
        )
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        seed.database.db.run(sql`DROP TRIGGER IF EXISTS fail_task_marker`).pipe(Effect.orDie),
      )
      expect(yield* seed.execution.recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [seed.child.id],
        scanAvailable: true,
      })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([seed.parentTask])
      expect(yield* kv.scan({ prefix: "delegation:task-settlement:" })).toEqual({ entries: [] })
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      expect(published).toEqual([])
      yield* seed.database.db.run(sql`DROP TRIGGER fail_task_marker`).pipe(Effect.orDie)
      yield* seed.execution.recoverPending
      const settled = yield* seed.tasks.get(seed.parent.id)
      expect(settled).toMatchObject([{ status: "failed", revision: seed.parentTask.revision + 1 }])
      expect((yield* kv.scan({ prefix: "delegation:task-settlement:" })).entries).toHaveLength(1)
      expect(published).toEqual([SessionTask.Event.Updated.type, SessionTask.Event.TodoUpdated.type])
      yield* seed.execution.recoverPending
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(settled)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toHaveLength(1)
      expect(published).toHaveLength(2)
    }),
  )

  it.live("isolates one participant's real Task marker failure while another settles in the same recovery scan", () =>
    Effect.gen(function* () {
      const failed = yield* setup()
      const healthy = yield* setup()
      const store = yield* SessionStore.Service
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      yield* Effect.forEach([failed.child.id, healthy.child.id], store.claim, { discard: true })
      yield* store.countResume(failed.child.id)
      yield* store.countResume(failed.child.id)
      yield* store.countResume(healthy.child.id)
      const children = failed.database.db
        .select({ id: SessionTable.id, claim: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
        .from(SessionTable)
        .where(inArray(SessionTable.id, [failed.child.id, healthy.child.id]))
        .all()
        .pipe(Effect.orDie)
      const before = yield* children
      expect(before).toHaveLength(2)
      expect(before.find((child) => child.id === failed.child.id)).toMatchObject({
        claim: expect.any(Number),
        attempts: 2,
      })
      const published: string[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type || event.type === SessionTask.Event.TodoUpdated.type)
            published.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      // Select the failed Task through fixture data; the production notification hash remains opaque.
      yield* failed.database.db
        .run(sql`CREATE TEMP TABLE blocked_task_settlement (task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)`)
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* failed.database.db.run(sql`DROP TRIGGER IF EXISTS fail_one_task_marker`).pipe(Effect.orDie)
          yield* failed.database.db.run(sql`DROP TABLE IF EXISTS blocked_task_settlement`).pipe(Effect.orDie)
        }),
      )
      yield* failed.database.db
        .run(
          sql`INSERT INTO blocked_task_settlement (task_id, revision)
          VALUES (${failed.parentTask.id}, ${failed.parentTask.revision})`,
        )
        .pipe(Effect.orDie)
      yield* failed.database.db
        .run(
          sql`
        CREATE TEMP TRIGGER fail_one_task_marker BEFORE INSERT ON kv
        WHEN NEW.key LIKE 'delegation:task-settlement:%' AND EXISTS (
          SELECT 1 FROM task JOIN blocked_task_settlement ON task.id = blocked_task_settlement.task_id
          WHERE task.revision > blocked_task_settlement.revision
        )
        BEGIN SELECT RAISE(ABORT, 'Participant Task marker failure'); END
      `,
        )
        .pipe(Effect.orDie)
      expect(yield* failed.execution.recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [failed.child.id],
        scanAvailable: true,
      })
      expect(yield* failed.tasks.get(failed.parent.id)).toEqual([failed.parentTask])
      const settledHealthy = yield* healthy.tasks.get(healthy.parent.id)
      expect(settledHealthy).toMatchObject([{ status: "failed", revision: healthy.parentTask.revision + 1 }])
      expect((yield* children).find((child) => child.id === failed.child.id)).toEqual(
        before.find((child) => child.id === failed.child.id),
      )
      expect((yield* children).find((child) => child.id === healthy.child.id)).toMatchObject({
        claim: null,
        attempts: 0,
      })
      expect(yield* failed.sessions.inbox(failed.parent.id)).toEqual([])
      const healthyNotice = yield* healthy.sessions.inbox(healthy.parent.id)
      expect(healthyNotice).toHaveLength(1)
      expect((yield* kv.scan({ prefix: "delegation:task-settlement:" })).entries).toHaveLength(1)
      expect(published).toEqual([SessionTask.Event.Updated.type, SessionTask.Event.TodoUpdated.type])

      expect(yield* failed.execution.recoverPending).toMatchObject({ deferredChildren: [failed.child.id] })
      expect(yield* healthy.tasks.get(healthy.parent.id)).toEqual(settledHealthy)
      expect(yield* healthy.sessions.inbox(healthy.parent.id)).toEqual(healthyNotice)
      expect(published).toHaveLength(2)

      yield* failed.database.db.run(sql`DROP TRIGGER fail_one_task_marker`).pipe(Effect.orDie)
      expect(yield* failed.execution.recoverPending).toMatchObject({
        parents: [],
        deferredChildren: [],
        scanAvailable: true,
      })
      const settledFailed = yield* failed.tasks.get(failed.parent.id)
      expect(settledFailed).toMatchObject([{ status: "failed", revision: failed.parentTask.revision + 1 }])
      expect(yield* healthy.tasks.get(healthy.parent.id)).toEqual(settledHealthy)
      expect(yield* children).toEqual(
        expect.arrayContaining([
          { id: failed.child.id, claim: null, attempts: 0 },
          { id: healthy.child.id, claim: null, attempts: 0 },
        ]),
      )
      const failedNotice = yield* failed.sessions.inbox(failed.parent.id)
      expect(failedNotice).toHaveLength(1)
      expect(yield* healthy.sessions.inbox(healthy.parent.id)).toEqual(healthyNotice)
      const markers = yield* kv.scan({ prefix: "delegation:task-settlement:" })
      expect(markers.entries).toHaveLength(2)
      expect(published).toHaveLength(4)
      yield* failed.execution.recoverPending
      expect(yield* failed.tasks.get(failed.parent.id)).toEqual(settledFailed)
      expect(yield* healthy.tasks.get(healthy.parent.id)).toEqual(settledHealthy)
      expect(yield* failed.sessions.inbox(failed.parent.id)).toEqual(failedNotice)
      expect(yield* healthy.sessions.inbox(healthy.parent.id)).toEqual(healthyNotice)
      expect(yield* kv.scan({ prefix: "delegation:task-settlement:" })).toEqual(markers)
      expect(published).toHaveLength(4)
      const llm = yield* TestLLM.Test
      expect(yield* llm.requests()).toEqual([])
    }),
  )

  it.live("rolls back a cancellation correction and emits its Task events only after a retry commits", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.execution.recoverPending
      const kv = yield* KV.Service
      const before = yield* seed.tasks.get(seed.parent.id)
      const marker = yield* kv.scan({ prefix: "delegation:task-settlement:" })
      const notice = yield* seed.sessions.inbox(seed.parent.id)
      const bus = yield* Bus.Service
      const published: string[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type || event.type === SessionTask.Event.TodoUpdated.type)
            published.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* seed.database.db
        .run(
          sql`
        CREATE TEMP TRIGGER fail_task_marker BEFORE INSERT ON kv
        WHEN NEW.key LIKE 'delegation:task-settlement:%'
        BEGIN SELECT RAISE(ABORT, 'Task marker failure'); END
      `,
        )
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        seed.database.db.run(sql`DROP TRIGGER IF EXISTS fail_task_marker`).pipe(Effect.orDie),
      )
      expect(Exit.isFailure(yield* seed.execution.close({ delegationID: seed.delegation.id }).pipe(Effect.exit))).toBe(
        true,
      )
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(before)
      expect(yield* kv.scan({ prefix: "delegation:task-settlement:" })).toEqual(marker)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(notice)
      expect(published).toEqual([])
      yield* seed.database.db.run(sql`DROP TRIGGER fail_task_marker`).pipe(Effect.orDie)
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      const corrected = yield* seed.tasks.get(seed.parent.id)
      expect(corrected).toMatchObject([{ status: "cancelled", revision: seed.parentTask.revision + 2 }])
      expect(published).toEqual([SessionTask.Event.Updated.type, SessionTask.Event.TodoUpdated.type])
      expect(yield* seed.execution.wait(seed.receipt)).toMatchObject({ status: "recovery_required" })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(corrected)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(notice)
      expect(published).toHaveLength(2)
    }),
  )
})
