import { describe, expect } from "bun:test"
import { AIError, InvalidRequestError, LanguageModel, LLMClient } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { App } from "@aigcfroge/core/app"
import { Bus } from "@aigcfroge/core/bus"
import { Config } from "@aigcfroge/core/config"
import { Database } from "@aigcfroge/core/database/database"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationReceipt } from "@aigcfroge/core/delegation/receipt"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Job } from "@aigcfroge/core/job"
import { Git } from "@aigcfroge/core/git"
import { AppProcess } from "@aigcfroge/util/process"
import { KV } from "@aigcfroge/core/kv"
import { Instance } from "@aigcfroge/core/instance/service"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { MetaAgentStepTable } from "@aigcfroge/core/meta-agent/sql"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Provider } from "@aigcfroge/core/provider"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRestart } from "@aigcfroge/core/session/execution/restart"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { SessionTable, SessionInboxTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Tool } from "@aigcfroge/core/tool"
import { CliAdapter } from "@aigcfroge/core/tool/cli-adapter"
import { CodexAppServer } from "@aigcfroge/core/tool/codex-app-server"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import type { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, type TurnID } from "@aigcfroge/schema/delegation-id"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { eq, sql } from "drizzle-orm"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { CompositionFixture } from "./lib/composition"
import { withCustomMode } from "./lib/product-mode"

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const nodes = LayerNode.group([
  Git.node,
  AppProcess.node,
  FSUtil.node,
  DelegationExecution.node,
  DelegationService.node,
  SessionRestart.node,
  LocationServiceMap.node,
  Session.node,
  SessionComposition.node,
  SessionStore.node,
  SessionTask.node,
  ScheduleService.node,
  SessionExecution.node,
  Database.node,
  Project.node,
  Bus.node,
  Job.node,
  KV.node,
  Instance.node,
  llmTest,
])
const replacements = [
  Global.node.replace(tempGlobalLayer),
  Bus.node.replace(Bus.configured({ persist: true })),
  offlineModels,
  LayerNodePlatform.llmClient.replace(llmClient),
  SessionRunnerModel.node.replace(
    Layer.succeed(SessionRunnerModel.Service, {
      resolve: () =>
        Effect.succeed(
          SessionRunnerModel.resolved(
            LanguageModel.make({ id: "delegation", provider: "test", route: OpenAIChat.route }),
            {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              cost: [],
              limit: { context: 200_000, output: 32_000 },
            },
          ),
        ),
    }),
  ),
] satisfies LayerNode.Replacements
const layer = AppNodeBuilder.build(nodes, replacements)
const it = testEffect(layer)
const model = Model.Ref.make({ id: Model.ID.make("delegation"), providerID: Provider.ID.make("test") })
const worker = Agent.ID.make("delegation-worker")

const externalRecoveryFixture = (
  characters = 5000,
  background = false,
  agent = Agent.defaultID,
  acceptedSteer = false,
  queuePhase?: "pending" | "bound",
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped("aigcfroge-external-recovery-workspace-")
    const databaseDirectory = yield* tmpdirScoped("aigcfroge-external-recovery-database-")
    const databasePath = `${databaseDirectory.path}/external-recovery.sqlite`
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
    const text = "MC06_RECOVERED_" + "x".repeat(characters)
    const reads: { cwd: string; threadID: string; turnID: string; modelProvider: string; cliVersion: string }[] = []
    const result = {
      status: "success" as const,
      summary: text,
      sessionId: "persistent-thread",
      turnId: "persistent-turn",
    }
    const previous = CliAdapter.getCliAdapter("codex")
    const adapter: CliAdapter.CliAdapterValue<Error> = {
      ...CodexAppServer.adapter,
      command: "mc06-controlled-peer",
      execute: () => Effect.die(new Error("Recovery must not execute another external turn")),
      readResult: (input) =>
        Effect.sync(() => {
          reads.push(input)
          return result
        }),
    }
    CliAdapter.registerCliAdapter("codex", {
      ...adapter,
      forCommand: (command) => ({ ...adapter, command }),
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => CliAdapter.registerCliAdapter("codex", previous ?? CodexAppServer.adapter)),
    )
    yield* Effect.promise(() =>
      Bun.write(
        `${directory.path}/aigcfroge.json`,
        JSON.stringify({ cli_agents: { codex: { command: adapter.command, transport: "app-server" } } }),
      ),
    )
    const open = (scope: Scope.Scope) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AppNodeBuilder.build(LayerNode.group([nodes, WorkflowExecution.node, WorkflowRun.node, SessionInbox.node]), [
            ...replacements,
            Database.node.replace(Database.configured({ path: databasePath })),
          ]),
        )
        const local = yield* Context.get(context, LocationServiceMap.Service).contextEffect(location)
        yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
        if (agent === "meta")
          yield* useOfflineCatalog([
            {
              info: Provider.Info.make({
                ...Provider.Info.empty(model.providerID),
                activation: "enabled",
                package: "@aigcfroge/ai/providers/openai/responses",
              }),
              models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
            },
          ]).pipe(Effect.provideContext(local))
        return {
          sessions: Context.get(context, Session.Service),
          create: (input: Parameters<typeof createLegacySession>[0]) =>
            createLegacySession(input).pipe(Effect.provideContext(context)),
          execution: Context.get(context, DelegationExecution.Service),
          service: Context.get(context, DelegationService.Service),
          tasks: Context.get(context, SessionTask.Service),
          database: Context.get(context, Database.Service),
          bus: Context.get(context, Bus.Service),
          kv: Context.get(context, KV.Service),
          store: Context.get(context, SessionStore.Service),
          runner: Context.get(context, SessionExecution.Service),
          restart: Context.get(context, SessionRestart.Service),
          llm: Context.get(context, TestLLM.Test),
          hooks: Context.get(local, PluginHooks.Service),
          files: Context.get(context, FSUtil.Service),
        }
      }).pipe(Effect.provideService(Scope.Scope, scope))
    const originalScope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
    const original = yield* open(originalScope)
    const parent = yield* agent === "meta"
      ? original.sessions.create({
          location,
          title: "External recovery Meta parent",
          agent,
          model,
          executorPreference: new SessionSchema.ExecutorPreference({ agent: Agent.defaultID, model }),
        })
      : original.create({ location, title: "External recovery parent", agent, model })
    yield* original.sessions.prompt({ sessionID: parent.id, text: "Recover the original external Task", resume: false })
    yield* SessionInbox.promote(original.database.db, original.bus, parent.id, "steer")
    const parentTask = (yield* original.tasks.append({
      sessionID: parent.id,
      tasks: [{ content: "Preserve the external result", status: "in_progress", priority: "medium" }],
    })).at(-1)
    if (!parentTask) return yield* Effect.die(new Error("External recovery Task missing"))
    const delegation = yield* original.service.create({ parentSessionID: parent.id, title: "External recovery" })
    const participant = yield* original.service.addParticipant({
      delegationID: delegation.id,
      provider: "codex",
      target: "codex",
      role: "implementer",
      context: "fresh",
    })
    yield* original.service.bindParticipant({
      delegationID: delegation.id,
      participantID: participant.id,
      externalThreadID: result.sessionId,
    })
    const predecessor = queuePhase
      ? yield* original.service.appendTurn({
          delegationID: delegation.id,
          kind: "task",
          delivery: "steer",
          participantIDs: [participant.id],
          origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
        })
      : undefined
    const turn = yield* original.service.appendTurn({
      delegationID: delegation.id,
      kind: "task",
      delivery: queuePhase ? "queue" : "steer",
      participantIDs: [participant.id],
      origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
    })
    const source = { sessionID: parent.id, assistantMessageID: SessionMessage.ID.create(), id: "mc06-recovery-task" }
    const input = {
      description: "Preserve the external result",
      prompt: "Return the original result",
      subagent_type: "codex",
      cli_target: "codex",
      execution_type: "external-cli",
      ...(acceptedSteer ? { command: "steer" } : { attended: true }),
      ...(background ? { background: true } : {}),
      ...(queuePhase ? { command: "append", delegation_id: delegation.id, participant_id: participant.id } : {}),
    }
    yield* original.bus.publish(SessionEvent.Step.Started, {
      sessionID: parent.id,
      assistantMessageID: source.assistantMessageID,
      agent,
      model,
      started: 0,
    })
    yield* original.bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: "task" })
    yield* original.bus.publish(SessionEvent.Tool.Input.Ended, { ...source, text: JSON.stringify(input) })
    yield* original.bus.publish(SessionEvent.Tool.Called, { ...source, input, executed: false })
    yield* original.bus.publish(SessionEvent.Step.Streamed, {
      sessionID: parent.id,
      assistantMessageID: source.assistantMessageID,
    })
    const binding = new DelegationReceipt.Binding({
      kind: "external-cli",
      delegationID: delegation.id,
      participantID: participant.id,
      turnID: turn.id,
      deliveryOrigin: "parent-task",
      senderParticipantID: participant.id,
      attempt: 1,
      parentSessionID: parent.id,
      source: { type: "tool", messageID: source.assistantMessageID, id: source.id },
      location,
      agent,
      target: "codex",
      transport: "app-server",
      command: adapter.command,
      parentTaskID: parentTask.id,
      parentTaskRevision: parentTask.revision,
      externalThreadID: result.sessionId,
      ...(queuePhase ? { execution: "queued" as const } : { externalTurnID: result.turnId }),
      model: "fixture-external",
      modelProvider: "fixture",
      cliVersion: "0.162.1",
      ...(background ? { background: true } : {}),
    })
    if (predecessor) {
      const previousTask = (yield* original.tasks.append({
        sessionID: parent.id,
        tasks: [{ content: "Completed physical predecessor", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!previousTask) return yield* Effect.die(new Error("Predecessor Task missing"))
      const previousSource = { ...source, assistantMessageID: SessionMessage.ID.create(), id: "mc06-predecessor-task" }
      const previousBinding = new DelegationReceipt.Binding({
        ...binding,
        turnID: predecessor.id,
        source: { type: "tool", messageID: previousSource.assistantMessageID, id: previousSource.id },
        parentTaskID: previousTask.id,
        parentTaskRevision: previousTask.revision,
        background: false,
        externalTurnID: "predecessor-native-turn",
      })
      yield* original.kv.set(
        DelegationReceipt.key(previousBinding),
        Schema.encodeSync(DelegationReceipt.Binding)(previousBinding),
      )
      yield* original.bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID: previousSource.assistantMessageID,
        agent,
        model,
        started: 0,
      })
      const previousInput = { ...input, background: false, prompt: "Return only the predecessor result" }
      yield* original.bus.publish(SessionEvent.Tool.Input.Started, { ...previousSource, name: "task" })
      yield* original.bus.publish(SessionEvent.Tool.Input.Ended, {
        ...previousSource,
        text: JSON.stringify(previousInput),
      })
      yield* original.bus.publish(SessionEvent.Tool.Called, {
        ...previousSource,
        input: previousInput,
        executed: false,
      })
      yield* original.bus.publish(SessionEvent.Step.Streamed, {
        sessionID: parent.id,
        assistantMessageID: previousSource.assistantMessageID,
      })
      yield* original.service.recordDelivery({ ...previousBinding, status: "started" })
      yield* original.service.recordDelivery({
        ...previousBinding,
        status: "completed",
        summary: "MC06_PREDECESSOR_ONLY",
      })
      yield* original.tasks.patch({
        sessionID: parent.id,
        id: previousTask.id,
        expectedRevision: previousTask.revision,
        expect: ["in_progress"],
        status: "completed",
        outputDigest: "MC06_PREDECESSOR_ONLY",
      })
      const previousResult = DelegationReceipt.response(
        new DelegationReceipt.External({
          ...previousBinding,
          externalThreadID: result.sessionId,
          externalTurnID: "predecessor-native-turn",
        }),
        previousTask.id,
        { status: "completed", text: "MC06_PREDECESSOR_ONLY" },
      )
      if (!isReadonlyArrayNonEmpty(previousResult.content))
        return yield* Effect.die(new Error("Predecessor result missing"))
      yield* original.bus.publish(SessionEvent.Tool.Success, {
        ...previousSource,
        content: previousResult.content,
        metadata: previousResult.metadata,
        executed: false,
      })
    }
    yield* original.kv.set(DelegationReceipt.key(binding), Schema.encodeSync(DelegationReceipt.Binding)(binding))
    if (!acceptedSteer && !queuePhase) yield* original.service.recordDelivery({ ...binding, status: "started" })
    yield* original.store.claim(parent.id)
    const readCall = (opened: typeof original) =>
      opened.sessions
        .message({ sessionID: parent.id, messageID: source.assistantMessageID })
        .pipe(
          Effect.flatMap((message) =>
            message?.type === "assistant"
              ? Effect.succeed(message.content.find((part) => part.type === "tool" && part.id === source.id))
              : Effect.die(new Error("Original assistant was not preserved")),
          ),
        )
    const reopen = Effect.gen(function* () {
      yield* Scope.close(originalScope, Exit.void)
      const reopenedScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(reopenedScope, Exit.void))
      return yield* open(reopenedScope)
    })
    const acknowledge = Effect.gen(function* () {
      const ack = DelegationReceipt.response(
        queuePhase
          ? Schema.decodeUnknownSync(DelegationReceipt.Pending)(binding)
          : new DelegationReceipt.External({
              ...binding,
              externalThreadID: result.sessionId,
              externalTurnID: result.turnId,
            }),
        parentTask.id,
        { status: queuePhase ? "queued" : "running", text: "" },
      )
      if (!isReadonlyArrayNonEmpty(ack.content)) return yield* Effect.die(new Error("Background ACK has no content"))
      yield* original.bus.publish(SessionEvent.Tool.Success, {
        ...source,
        content: ack.content,
        metadata: ack.metadata,
        executed: false,
      })
      if (queuePhase === "bound") {
        const started = new DelegationReceipt.Binding({ ...binding, externalTurnID: result.turnId })
        yield* original.kv.set(DelegationReceipt.key(started), Schema.encodeSync(DelegationReceipt.Binding)(started))
        yield* original.service.recordDelivery({ ...started, status: "started" })
      }
    })
    return { original, parent, parentTask, binding, source, text, reads, result, readCall, reopen, acknowledge }
  })

for (const phase of ["pending", "bound"] as const)
  testEffect(Layer.empty).live(`MC06 R3b cold ${phase} queue preserves its ACK and resolves only its own result`, () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture(60_000, true, Agent.ID.make("meta"), false, phase)
      yield* f.acknowledge
      const reopened = yield* f.reopen
      expect(reopened.database).not.toBe(f.original.database)
      const before = yield* f.readCall(reopened)
      expect(before).toMatchObject({ state: { status: "completed", metadata: { status: "queued" } } })
      if (before?.type !== "tool" || before.state.status !== "completed")
        return yield* Effect.die(new Error("Original queued ACK missing"))
      const ack = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(
        before.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      )
      expect(ack).not.toHaveProperty("externalTurnID")
      const previous = (yield* reopened.sessions.context(f.parent.id))
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "mc06-predecessor-task")
      expect(previous).toMatchObject({ state: { status: "completed" } })
      yield* reopened.execution.recoverPending
      const notifications = (yield* reopened.sessions.inbox(f.parent.id)).filter((input) => input.type === "synthetic")
      expect(notifications).toHaveLength(1)
      const notification = notifications[0]
      if (notification?.type !== "synthetic")
        return yield* Effect.die(new Error("Queued recovery notification missing"))
      const result = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(
        notification.payload.text,
      )
      expect(result).toMatchObject({
        turnID: f.binding.turnID,
        parentTaskID: f.parentTask.id,
        status: phase === "bound" ? "completed" : "recovery_required",
      })
      expect(result.output).not.toContain("MC06_PREDECESSOR_ONLY")
      if (phase === "pending") {
        expect(result).not.toHaveProperty("externalTurnID")
        expect(f.reads).toEqual([])
      }
      if (phase === "bound") {
        expect(result.output).toBe(f.text)
        expect(result.externalTurnID).toBe(f.result.turnId)
        expect(f.reads).toEqual([
          {
            cwd: f.parent.location.directory,
            threadID: f.result.sessionId,
            turnID: f.result.turnId,
            modelProvider: "fixture",
            cliVersion: "0.162.1",
          },
        ])
      }
      expect(yield* f.readCall(reopened)).toEqual(before)
      expect((yield* reopened.tasks.get(f.parent.id)).find((task) => task.id === f.parentTask.id)).toMatchObject({
        status: phase === "bound" ? "completed" : "failed",
        revision: f.parentTask.revision + 1,
      })
      yield* reopened.execution.recoverPending
      expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual(notifications)
      yield* reopened.llm.push(TestLLM.text("Consumed the queued recovery outcome", "mc06-r3b-recovered-parent"))
      yield* reopened.restart.resumeSuspendedSessions
      yield* awaitWithTimeout(reopened.llm.wait(1), "Queued recovery result was not consumed")
      yield* awaitWithTimeout(reopened.runner.awaitIdle(f.parent.id), "Queued recovery parent did not settle")
      expect(JSON.stringify((yield* reopened.llm.requests())[0]?.messages)).toContain(result.output)
      const receipts = (yield* reopened.database.db
        .select()
        .from(MetaAgentStepTable)
        .where(eq(MetaAgentStepTable.meta_agent_session_id, f.parent.id))).filter(
        (row) => row.type === "receipt" && row.tool_call_id === f.source.id,
      )
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({
        event_type: SessionEvent.InboxDelivered.type,
        status: phase === "bound" ? "completed" : "failed",
        provenance: { externalReceipt: { turnID: f.binding.turnID } },
      })
      const events = yield* reopened.bus.log({ aggregateID: f.parent.id }).pipe(Stream.runCollect)
      expect(
        events.filter(
          (event) =>
            !Bus.isSynced(event) &&
            event.type === SessionEvent.Tool.Success.type &&
            Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)(event.data).id === f.source.id,
        ),
      ).toHaveLength(1)
      const messages = yield* reopened.sessions.context(f.parent.id)
      yield* reopened.execution.recoverPending
      expect(yield* reopened.sessions.context(f.parent.id)).toEqual(messages)
      expect(f.reads).toHaveLength(phase === "bound" ? 1 : 0)
      expect(yield* f.readCall(reopened)).toEqual(before)
    }),
  )

for (const phase of ["queued", "missing-notice", "notified"] as const)
  testEffect(Layer.empty).live("MC06 precise interrupt cancels the proven cold queue at " + phase + " once", () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture(5000, true, Agent.ID.make("meta"), false, "pending")
      yield* f.acknowledge
      const reopened = yield* f.reopen
      const retainedSummary = "The predecessor stopped while this external input remained unsent"
      if (phase === "notified") yield* reopened.execution.recoverPending
      if (phase === "missing-notice") {
        yield* reopened.service.recordDelivery({
          ...f.binding,
          status: "recovery_required",
          summary: retainedSummary,
        })
        expect(
          yield* reopened.tasks.patch({
            sessionID: f.parent.id,
            id: f.parentTask.id,
            expectedRevision: f.parentTask.revision,
            expect: ["in_progress"],
            status: "failed",
            outputDigest: retainedSummary,
          }),
        ).toMatchObject({ status: "failed", revision: f.parentTask.revision + 1 })
      }
      const before = {
        call: yield* f.readCall(reopened),
        tasks: yield* reopened.tasks.get(f.parent.id),
        inbox: yield* reopened.sessions.inbox(f.parent.id),
        binding: yield* reopened.kv.get(DelegationReceipt.key(f.binding)),
        state: yield* reopened.service.foldState(f.binding.delegationID),
      }
      if (!before.state) return yield* Effect.die(new Error("The original delegation was not retained"))
      const input = {
        delegationID: f.binding.delegationID,
        participantID: f.binding.participantID,
        turnID: f.binding.turnID,
      }
      yield* reopened.execution.interrupt(input)
      const state = yield* reopened.service.foldState(f.binding.delegationID)
      expect(
        [...(state?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === f.binding.turnID),
      ).toMatchObject({ status: "cancelled", attempt: f.binding.attempt })
      expect(
        [...(state?.deliveries.values() ?? [])].filter((delivery) => delivery.turnID !== f.binding.turnID),
      ).toEqual([...before.state.deliveries.values()].filter((delivery) => delivery.turnID !== f.binding.turnID))
      expect(state?.participants.get(f.binding.participantID)).toEqual(
        before.state.participants.get(f.binding.participantID),
      )
      expect(yield* f.readCall(reopened)).toEqual(before.call)
      expect(yield* reopened.kv.get(DelegationReceipt.key(f.binding))).toEqual(before.binding)
      const afterTasks = yield* reopened.tasks.get(f.parent.id)
      if (phase === "queued") {
        expect(afterTasks.find((task) => task.id === f.parentTask.id)).toMatchObject({
          status: "cancelled",
          revision: f.parentTask.revision + 1,
        })
        expect(afterTasks.filter((task) => task.id !== f.parentTask.id)).toEqual(
          before.tasks.filter((task) => task.id !== f.parentTask.id),
        )
      }
      if (phase !== "queued") expect(afterTasks).toEqual(before.tasks)
      const afterInbox = yield* reopened.sessions.inbox(f.parent.id)
      const notice = afterInbox.find((item) => item.type === "synthetic")
      if (notice?.type !== "synthetic")
        return yield* Effect.die(new Error("The precise cancellation lost its original result"))
      const output = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(notice.payload.text)
      expect(output).toMatchObject({
        turnID: f.binding.turnID,
        parentTaskID: f.parentTask.id,
        execution: "queued",
        status: phase === "queued" ? "cancelled" : "recovery_required",
      })
      expect(output).not.toHaveProperty("externalTurnID")
      if (phase === "notified") expect(afterInbox).toEqual(before.inbox)
      if (phase === "missing-notice") expect(output.output).toBe(retainedSummary)
      const events = yield* reopened.bus.log({ aggregateID: f.binding.delegationID }).pipe(Stream.runCollect)
      yield* reopened.execution.interrupt(input)
      expect(yield* reopened.bus.log({ aggregateID: f.binding.delegationID }).pipe(Stream.runCollect)).toEqual(events)
      expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual(afterInbox)
      expect(yield* reopened.tasks.get(f.parent.id)).toEqual(afterTasks)
      expect(yield* f.readCall(reopened)).toEqual(before.call)
      const prompt = `MC06_FRESH_TASK_${phase}`
      const nativeTurnID = `fresh-native-turn-${phase}`
      const text = `MC06_FRESH_RESULT_${phase}`
      const starts: { prompt: string; cwd: string; resumeId?: string }[] = []
      const task = (yield* reopened.tasks.append({
        sessionID: f.parent.id,
        tasks: [{ content: "Execute the new explicitly admitted Task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!task) return yield* Effect.die(new Error("The fresh Task was not admitted"))
      const turn = yield* reopened.service.appendTurn({
        delegationID: f.binding.delegationID,
        kind: "task",
        delivery: "steer",
        participantIDs: [f.binding.participantID],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: f.binding.participantID },
      })
      const source = {
        sessionID: f.parent.id,
        assistantMessageID: SessionMessage.ID.create(),
        id: `mc06-fresh-task-${phase}`,
      }
      const request = {
        description: task.content,
        prompt,
        subagent_type: "codex",
        cli_target: "codex",
        execution_type: "external-cli",
        attended: true,
        command: "append",
        delegation_id: f.binding.delegationID,
        participant_id: f.binding.participantID,
      }
      yield* reopened.bus.publish(SessionEvent.Step.Started, {
        sessionID: f.parent.id,
        assistantMessageID: source.assistantMessageID,
        agent: Agent.ID.make(f.binding.agent),
        model,
        started: 0,
      })
      yield* reopened.bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: "task" })
      yield* reopened.bus.publish(SessionEvent.Tool.Input.Ended, { ...source, text: JSON.stringify(request) })
      yield* reopened.bus.publish(SessionEvent.Tool.Called, { ...source, input: request, executed: false })
      yield* reopened.bus.publish(SessionEvent.Step.Streamed, {
        sessionID: f.parent.id,
        assistantMessageID: source.assistantMessageID,
      })
      const receipts = yield* reopened.execution.dispatch({
        delegationID: f.binding.delegationID,
        turnID: turn.id,
        prompt,
        task: {
          parentTaskID: task.id,
          parentTaskRevision: task.revision,
          description: task.content,
          background: false,
          source: { type: "tool", messageID: source.assistantMessageID, id: source.id },
        },
        external: {
          agent: Agent.ID.make(f.binding.agent),
          onPermission: () => Effect.succeed("deny"),
          onText: () => Effect.void,
          adapter: {
            ...CodexAppServer.adapter,
            command: f.binding.command,
            execute: (invocation) =>
              Effect.gen(function* () {
                starts.push({ prompt: invocation.prompt, cwd: invocation.cwd, resumeId: invocation.resumeId })
                if (!invocation.onThread || !invocation.onTurn)
                  return yield* Effect.die(new Error("The fresh execution lost its native binding callbacks"))
                yield* invocation.onThread({
                  threadID: f.result.sessionId,
                  cwd: f.binding.location.directory,
                  model: "fixture-external",
                  modelProvider: "fixture",
                  cliVersion: "0.162.1",
                })
                yield* invocation.onTurn(nativeTurnID)
                return {
                  status: "success" as const,
                  summary: text,
                  sessionId: f.result.sessionId,
                  turnId: nativeTurnID,
                }
              }),
          },
        },
      })
      expect(receipts).toHaveLength(1)
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.External)(receipts[0])
      expect(receipt).toMatchObject({
        turnID: turn.id,
        source: { type: "tool", messageID: source.assistantMessageID, id: source.id },
        externalThreadID: f.result.sessionId,
        externalTurnID: nativeTurnID,
      })
      const result = yield* reopened.execution.wait(receipt)
      expect(result).toEqual({ status: "completed", text })
      const response = DelegationReceipt.response(receipt, task.id, result)
      if (!isReadonlyArrayNonEmpty(response.content))
        return yield* Effect.die(new Error("The fresh Task result was lost"))
      yield* reopened.bus.publish(SessionEvent.Tool.Success, {
        ...source,
        content: response.content,
        metadata: response.metadata,
        executed: false,
      })
      const finalTasks = yield* reopened.tasks.get(f.parent.id)
      expect(finalTasks.find((value) => value.id === task.id)).toMatchObject({
        status: "completed",
        revision: task.revision + 1,
        outputDigest: text,
      })
      expect(finalTasks.filter((value) => value.id !== task.id)).toEqual([...afterTasks])
      expect(starts).toEqual([{ prompt, cwd: f.binding.location.directory, resumeId: f.result.sessionId }])
      expect(yield* f.readCall(reopened)).toEqual(before.call)
      expect(yield* reopened.kv.get(DelegationReceipt.key(f.binding))).toEqual(before.binding)
      expect(f.reads).toEqual([])
      expect(yield* reopened.llm.requests()).toEqual([])
    }),
  )

testEffect(Layer.empty).live("MC06 precise interrupt refuses unknown native start without changing retained rows", () =>
  Effect.gen(function* () {
    const f = yield* externalRecoveryFixture(5000, true, Agent.ID.make("meta"), false, "pending")
    yield* f.acknowledge
    const key = DelegationReceipt.key(f.binding)
    yield* f.original.kv.set(
      key,
      Schema.encodeSync(DelegationReceipt.Binding)(
        new DelegationReceipt.Binding({ ...f.binding, execution: "start_unknown" }),
      ),
    )
    const reopened = yield* f.reopen
    const before = {
      call: yield* f.readCall(reopened),
      tasks: yield* reopened.tasks.get(f.parent.id),
      inbox: yield* reopened.sessions.inbox(f.parent.id),
      binding: yield* reopened.kv.get(key),
      state: yield* reopened.service.foldState(f.binding.delegationID),
      events: yield* reopened.bus.log({ aggregateID: f.binding.delegationID }).pipe(Stream.runCollect),
    }
    expect(
      yield* reopened.execution
        .interrupt({
          delegationID: f.binding.delegationID,
          participantID: f.binding.participantID,
          turnID: f.binding.turnID,
        })
        .pipe(Effect.flip),
    ).toMatchObject({ attemptedTransition: "interrupt" })
    expect(yield* reopened.service.foldState(f.binding.delegationID)).toEqual(before.state)
    expect(yield* reopened.bus.log({ aggregateID: f.binding.delegationID }).pipe(Stream.runCollect)).toEqual(
      before.events,
    )
    expect(yield* f.readCall(reopened)).toEqual(before.call)
    expect(yield* reopened.tasks.get(f.parent.id)).toEqual(before.tasks)
    expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual(before.inbox)
    expect(yield* reopened.kv.get(key)).toEqual(before.binding)
    expect(f.reads).toEqual([])
    expect(yield* reopened.llm.requests()).toEqual([])
  }),
)

for (const acknowledged of [false, true])
  testEffect(Layer.empty).live(
    `MC06-R2 cold recovery with ACK ${acknowledged} restores one complete result without executing`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalRecoveryFixture(60_000, true)
        const receipt = new DelegationReceipt.External({
          ...f.binding,
          externalThreadID: f.result.sessionId,
          externalTurnID: f.result.turnId,
        })
        if (acknowledged) yield* f.acknowledge
        const reopened = yield* f.reopen
        const before = yield* f.readCall(reopened)
        yield* reopened.execution.recoverPending
        expect(f.reads).toHaveLength(1)
        expect(yield* reopened.execution.wait(receipt)).toEqual({ status: "completed", text: f.text })
        const pending = (yield* reopened.sessions.inbox(f.parent.id)).filter((input) => input.type === "synthetic")
        expect(pending).toHaveLength(acknowledged ? 1 : 0)
        if (acknowledged) {
          expect(yield* f.readCall(reopened)).toEqual(before)
          expect(pending[0]?.payload).toMatchObject({ text: expect.stringContaining(f.text) })
        }
        yield* reopened.execution.recoverPending
        expect(f.reads).toHaveLength(1)
        yield* reopened.llm.push(TestLLM.text("Consumed the complete recovered background result", "mc06-r2-cold"))
        yield* reopened.restart.resumeSuspendedSessions
        yield* awaitWithTimeout(reopened.llm.wait(1), "Cold background result was not consumed")
        yield* awaitWithTimeout(reopened.runner.awaitIdle(f.parent.id), "Recovered background parent did not settle")
        const requests = yield* reopened.llm.requests()
        expect(requests).toHaveLength(1)
        // Foreground fallback follows ToolOutput truncation; the full body remains available to wait.
        if (acknowledged) expect(JSON.stringify(requests[0]?.messages)).toContain(f.text)
        const messages = yield* reopened.sessions.context(f.parent.id)
        expect(
          messages.filter((message) => message.type === "synthetic" && message.metadata?.externalReceipt !== undefined),
        ).toHaveLength(acknowledged ? 1 : 0)
        yield* reopened.execution.recoverPending
        expect(f.reads).toHaveLength(1)
        expect(yield* reopened.sessions.context(f.parent.id)).toEqual(messages)
      }),
  )

for (const status of ["failed", "cancelled", "recovery_required"] as const)
  testEffect(Layer.empty).live(
    `MC06-R2 cold recovery delivers the retained ${status} result without reading Codex`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalRecoveryFixture(5000, true, Agent.ID.make("meta"))
        yield* f.acknowledge
        const summary = `Retained ${status} outcome before notification admission`
        yield* f.original.service.recordDelivery({ ...f.binding, status, summary })
        yield* f.original.tasks.patch({
          sessionID: f.parent.id,
          id: f.parentTask.id,
          expectedRevision: f.parentTask.revision,
          expect: ["in_progress"],
          status: status === "cancelled" ? "cancelled" : "failed",
          outputDigest: summary,
        })
        const reopened = yield* f.reopen
        const before = { call: yield* f.readCall(reopened), tasks: yield* reopened.tasks.get(f.parent.id) }
        yield* reopened.execution.recoverPending
        const pending = (yield* reopened.sessions.inbox(f.parent.id)).filter((input) => input.type === "synthetic")
        expect(pending).toHaveLength(1)
        const notice = pending[0]
        if (notice?.type !== "synthetic") return yield* Effect.die(new Error("Retained terminal notification missing"))
        const result = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(notice.payload.text)
        expect(result).toMatchObject({
          status,
          output: expect.stringContaining(summary),
          parentTaskID: f.parentTask.id,
        })
        expect(f.reads).toEqual([])
        expect(yield* f.readCall(reopened)).toEqual(before.call)
        expect(yield* reopened.tasks.get(f.parent.id)).toEqual(before.tasks)
        if (!f.parent.controller) return yield* Effect.die(new Error("Cold recovery Meta owner missing"))
        const receipts = reopened.database.db
          .select()
          .from(MetaAgentStepTable)
          .where(eq(MetaAgentStepTable.meta_agent_session_id, f.parent.id))
        expect((yield* receipts).filter((row) => row.type === "receipt")).toHaveLength(0)
        yield* reopened.execution.recoverPending
        expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual(pending)
        yield* reopened.llm.push(TestLLM.text("Consumed the retained failure outcome", "mc06-r2-retained-failure"))
        yield* reopened.restart.resumeSuspendedSessions
        yield* awaitWithTimeout(reopened.llm.wait(1), "Retained failure notification did not reach parent")
        yield* awaitWithTimeout(reopened.runner.awaitIdle(f.parent.id), "Failure-notified parent did not settle")
        expect(JSON.stringify((yield* reopened.llm.requests())[0]?.messages)).toContain(summary)
        expect(f.reads).toEqual([])
        const completedReceipts = (yield* receipts).filter((row) => row.type === "receipt")
        expect(completedReceipts).toHaveLength(1)
        expect(completedReceipts).toMatchObject([
          {
            event_type: SessionEvent.InboxDelivered.type,
            tool_call_id: f.source.id,
            status: "failed",
            provenance: { externalReceipt: { delegationID: f.binding.delegationID, turnID: f.binding.turnID } },
          },
        ])
        yield* reopened.execution.recoverPending
        expect((yield* receipts).filter((row) => row.type === "receipt")).toEqual(completedReceipts)
        expect(yield* reopened.llm.requests()).toHaveLength(1)
      }),
  )

testEffect(Layer.empty).live("MC06-R2 unreadable background result does not defer unrelated parent work", () =>
  Effect.gen(function* () {
    const f = yield* externalRecoveryFixture(5000, true)
    yield* f.acknowledge
    f.result.summary = ""
    const reopened = yield* f.reopen
    const result = yield* reopened.execution.recoverPending
    expect(result.deferredParents ?? []).not.toContain(f.parent.id)
    expect(yield* f.readCall(reopened)).toMatchObject({
      state: { status: "completed", metadata: { status: "running" } },
    })
    expect((yield* reopened.tasks.get(f.parent.id))[0]).toMatchObject({
      status: "in_progress",
      revision: f.parentTask.revision,
    })
    expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual([])
    expect(f.reads).toHaveLength(1)
    expect(yield* reopened.llm.requests()).toEqual([])
  }),
)

for (const checkpoint of ["external", "delivery", "task", "accepted-steer"] as const)
  testEffect(Layer.empty).live(
    `${checkpoint === "accepted-steer" ? "MC06 R3a" : "MC06-R1"} reopens the ${checkpoint} checkpoint before parent Tool.Success and consumes its full body once`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalRecoveryFixture(5000, false, Agent.defaultID, checkpoint === "accepted-steer")
        if (checkpoint === "delivery" || checkpoint === "task")
          yield* f.original.service.recordDelivery({
            ...f.binding,
            status: "completed",
            summary: f.text.slice(0, 4096),
          })
        if (checkpoint === "task")
          yield* f.original.tasks.patch({
            sessionID: f.parent.id,
            id: f.parentTask.id,
            expectedRevision: f.parentTask.revision,
            expect: ["in_progress"],
            status: "completed",
            outputDigest: f.text.slice(0, 4096),
          })
        const reopened = yield* f.reopen
        expect(reopened.database).not.toBe(f.original.database)
        expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: "running" } })
        expect(f.reads).toEqual([])
        expect(yield* reopened.llm.requests()).toEqual([])
        const hooked: string[] = []
        yield* reopened.hooks.register("tool", "execute.after", (event) =>
          Effect.sync(() => {
            if (event.tool !== "task" || event.status !== "completed") return
            hooked.push(event.id)
            event.result = { ...event.result, metadata: { ...event.result.metadata, recoveredHook: true } }
          }),
        )
        yield* reopened.execution.recoverPending
        const call = yield* f.readCall(reopened)
        expect(call).toMatchObject({ state: { status: "completed" } })
        if (call?.type !== "tool" || call.state.status !== "completed")
          return yield* Effect.die(new Error("Original external Tool.Success was not recovered"))
        const output = call.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(output)).toMatchObject({
          status: "completed",
          output: f.text,
          parentTaskID: f.parentTask.id,
          externalThreadID: f.result.sessionId,
          externalTurnID: f.result.turnId,
        })
        const receipt = Schema.decodeUnknownSync(DelegationReceipt.External)(call.state.metadata?.externalReceipt)
        expect(call.state.metadata?.recoveredHook).toBe(true)
        expect(hooked).toEqual([f.source.id])
        expect(yield* reopened.execution.wait(receipt)).toEqual({ status: "completed", text: f.text })
        expect(f.reads).toEqual([
          {
            cwd: f.parent.location.directory,
            threadID: f.result.sessionId,
            turnID: f.result.turnId,
            modelProvider: "fixture",
            cliVersion: "0.162.1",
          },
        ])
        yield* reopened.execution.recoverPending
        expect(yield* f.readCall(reopened)).toEqual(call)
        expect(f.reads).toHaveLength(1)
        expect(hooked).toHaveLength(1)
        expect((yield* reopened.tasks.get(f.parent.id))[0]).toMatchObject({
          status: "completed",
          revision: f.parentTask.revision + 1,
          outputDigest: f.text.slice(0, 4096),
        })
        yield* reopened.llm.push(TestLLM.text("Consumed the recovered external result", "mc06-recovered-parent"))
        yield* reopened.restart.resumeSuspendedSessions
        yield* awaitWithTimeout(reopened.llm.wait(1), "Recovered parent request did not start", "10 seconds")
        yield* awaitWithTimeout(reopened.runner.awaitIdle(f.parent.id), "Recovered parent did not finish", "10 seconds")
        const requests = yield* reopened.llm.requests()
        expect(requests).toHaveLength(1)
        expect(JSON.stringify(requests[0]?.messages)).toContain(f.text)
        expect((yield* reopened.sessions.list({ parentID: f.parent.id })).data).toEqual([])
        yield* reopened.execution.recoverPending
        yield* reopened.restart.resumeSuspendedSessions
        expect(f.reads).toHaveLength(1)
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        const events = yield* reopened.bus.log({ aggregateID: f.parent.id }).pipe(Stream.runCollect)
        expect(
          events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Tool.Success.type),
        ).toHaveLength(1)
      }),
    30_000,
  )

for (const file of ["retained", "missing", "foreign"] as const)
  testEffect(Layer.empty).live(`MC06-R1 resolves a truncated result using its ${file} complete output file`, () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture(60_000)
      const reopened = yield* f.reopen
      yield* reopened.execution.recoverPending
      const call = yield* f.readCall(reopened)
      if (call?.type !== "tool" || call.state.status !== "completed")
        return yield* Effect.die(new Error("External result was not recovered"))
      expect(call.state.metadata?.truncated).toBe(true)
      const path = call.state.metadata?.outputPath
      if (typeof path !== "string") return yield* Effect.die(new Error("Complete output file missing"))
      const saved = yield* reopened.files.readFileString(path)
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(saved).output).toBe(f.text)
      if (file === "missing") yield* reopened.files.remove(path)
      if (file === "foreign") {
        const saved = Schema.decodeUnknownSync(Schema.fromJsonString(DelegationReceipt.Output))(
          yield* reopened.files.readFileString(path),
        )
        yield* reopened.files.writeFileString(path, JSON.stringify({ ...saved, externalTurnID: "foreign-turn" }))
      }
      const receipt = Schema.decodeUnknownSync(DelegationReceipt.External)(call.state.metadata?.externalReceipt)
      const beforeRead = {
        tasks: yield* reopened.tasks.get(f.parent.id),
        inbox: yield* reopened.sessions.inbox(f.parent.id),
        events: yield* Effect.forEach([f.parent.id, receipt.delegationID], (aggregateID) =>
          reopened.bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
        deliveries: yield* reopened.service.listTurns(receipt.delegationID),
        requests: yield* reopened.llm.requests(),
        reads: f.reads.slice(),
      }
      const sources = yield* reopened.execution.readSources(receipt.delegationID)
      const source = sources.find(
        (source) =>
          source.turnID === receipt.turnID &&
          source.participantID === receipt.participantID &&
          source.attempt === receipt.attempt,
      )
      if (!source) return yield* Effect.die(new Error("Public delivery source is missing"))
      expect(source.source).toEqual(receipt.source)
      const result = yield* reopened.execution.readResult(source)
      expect(result.available).toBe(file === "retained")
      if (file === "retained") expect(result.text).toBe(f.text)
      if (file === "retained") {
        const key = DelegationReceipt.key(receipt)
        const savedBinding = yield* reopened.kv.get(key)
        if (savedBinding === undefined) return yield* Effect.die(new Error("Recovered binding is missing"))
        const binding = Schema.decodeUnknownSync(DelegationReceipt.Binding)(savedBinding)
        yield* Effect.forEach(
          [
            new DelegationReceipt.Binding({ ...binding, delegationID: DelegationID.ID.create() }),
            new DelegationReceipt.Binding({ ...binding, externalThreadID: "foreign-thread" }),
            new DelegationReceipt.Binding({ ...binding, externalTurnID: "foreign-turn" }),
          ],
          (foreign) =>
            Effect.gen(function* () {
              yield* reopened.kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(foreign))
              const changed = (yield* reopened.execution.readSources(receipt.delegationID)).find(
                (value) =>
                  value.turnID === receipt.turnID &&
                  value.participantID === receipt.participantID &&
                  value.attempt === receipt.attempt,
              )
              expect(changed?.source).toBeUndefined()
              expect(changed?.parentTaskID).toBeUndefined()
              expect(changed?.externalThreadID).toBeUndefined()
              expect(changed?.externalTurnID).toBeUndefined()
              expect((yield* reopened.execution.readResult(source)).available).toBe(false)
            }).pipe(Effect.ensuring(reopened.kv.set(key, savedBinding))),
        )
        expect((yield* reopened.execution.readResult(source)).text).toBe(f.text)
      }
      expect(yield* reopened.tasks.get(f.parent.id)).toEqual(beforeRead.tasks)
      expect(yield* reopened.sessions.inbox(f.parent.id)).toEqual(beforeRead.inbox)
      expect(
        yield* Effect.forEach([f.parent.id, receipt.delegationID], (aggregateID) =>
          reopened.bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
      ).toEqual(beforeRead.events)
      expect(yield* reopened.service.listTurns(receipt.delegationID)).toEqual(beforeRead.deliveries)
      expect(yield* reopened.llm.requests()).toEqual(beforeRead.requests)
      expect(f.reads).toEqual(beforeRead.reads)
      expect(yield* f.readCall(reopened)).toEqual(call)
      if (file === "retained")
        expect(yield* reopened.execution.wait(receipt)).toEqual({ status: "completed", text: f.text })
      if (file !== "retained")
        expect(yield* reopened.execution.wait(receipt).pipe(Effect.flip)).toMatchObject({
          _tag: "Delegation.DelegationInvalidStateError",
        })
      expect(f.reads).toHaveLength(1)
      expect(yield* reopened.llm.requests()).toEqual([])
      expect(yield* f.readCall(reopened)).toEqual(call)
    }),
  )

for (const status of ["failed", "cancelled"] as const)
  testEffect(Layer.empty).live(`MC06-R1 preserves an original ${status} parent tool and Task after reopening`, () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture()
      yield* f.original.service.recordDelivery({ ...f.binding, status, summary: "Original terminal outcome" })
      yield* f.original.tasks.patch({
        sessionID: f.parent.id,
        id: f.parentTask.id,
        expectedRevision: f.parentTask.revision,
        expect: ["in_progress"],
        status,
      })
      yield* f.original.bus.publish(SessionEvent.Tool.Failed, {
        ...f.source,
        error: { type: status === "cancelled" ? "aborted" : "unknown", message: "Original terminal outcome" },
        executed: false,
      })
      const reopened = yield* f.reopen
      const before = {
        call: yield* f.readCall(reopened),
        tasks: yield* reopened.tasks.get(f.parent.id),
        deliveries: yield* reopened.service.listTurns(f.binding.delegationID),
      }
      expect(before.call).toMatchObject({ state: { status: "error" } })
      yield* reopened.execution.recoverPending
      yield* reopened.execution.recoverPending
      expect(yield* f.readCall(reopened)).toEqual(before.call)
      expect(yield* reopened.tasks.get(f.parent.id)).toEqual(before.tasks)
      expect(yield* reopened.service.listTurns(f.binding.delegationID)).toEqual(before.deliveries)
      expect(f.reads).toEqual([])
      expect(yield* reopened.llm.requests()).toEqual([])
    }),
  )

for (const field of ["sessionId", "turnId"] as const)
  testEffect(Layer.empty).live(`MC06-R1 refuses a cold result carrying a foreign ${field}`, () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture()
      f.result[field] = "foreign-result"
      const reopened = yield* f.reopen
      yield* reopened.execution.recoverPending
      expect(f.reads).toHaveLength(1)
      expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: "running" } })
      expect((yield* reopened.tasks.get(f.parent.id))[0]).toMatchObject({
        status: "in_progress",
        revision: f.parentTask.revision,
      })
      const events = yield* reopened.bus.log({ aggregateID: f.parent.id }).pipe(Stream.runCollect)
      expect(events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Tool.Success.type)).toEqual(
        [],
      )
      expect(yield* reopened.llm.requests()).toEqual([])
    }),
  )

testEffect(Layer.empty).live("MC06-R1 defers the claimed parent until its external result can be read", () =>
  Effect.gen(function* () {
    const f = yield* externalRecoveryFixture()
    f.result.summary = ""
    const reopened = yield* f.reopen
    expect(yield* reopened.execution.recoverPending).toMatchObject({ deferredParents: [f.parent.id] })
    yield* reopened.restart.resumeSuspendedSessions
    expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: "running" } })
    expect(yield* reopened.llm.requests()).toEqual([])
    expect(yield* reopened.store.listSuspended()).toContain(f.parent.id)
    f.result.summary = f.text
    yield* reopened.llm.push(TestLLM.text("Consumed the recovered external result", "mc06-read-recovered"))
    yield* reopened.restart.resumeSuspendedSessions
    yield* awaitWithTimeout(reopened.llm.wait(1), "Parent did not resume after result recovery", "10 seconds")
    yield* awaitWithTimeout(reopened.runner.awaitIdle(f.parent.id), "Recovered parent did not finish", "10 seconds")
    expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: "completed" } })
    expect(JSON.stringify((yield* reopened.llm.requests())[0]?.messages)).toContain(f.text)
    expect(yield* reopened.llm.requests()).toHaveLength(1)
  }),
)

testEffect(Layer.empty).live("MC06-R1 refuses a changed Location binding before reading external state", () =>
  Effect.gen(function* () {
    const f = yield* externalRecoveryFixture()
    yield* f.original.kv.set(
      DelegationReceipt.key(f.binding),
      Schema.encodeSync(DelegationReceipt.Binding)(
        new DelegationReceipt.Binding({
          ...f.binding,
          location: Location.Ref.make({ directory: AbsolutePath.make(`${f.parent.location.directory}/foreign`) }),
        }),
      ),
    )
    const reopened = yield* f.reopen
    yield* reopened.execution.recoverPending
    expect(f.reads).toEqual([])
    expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: "running" } })
    expect((yield* reopened.tasks.get(f.parent.id))[0]).toMatchObject({ status: "in_progress" })
    expect(yield* reopened.llm.requests()).toEqual([])
  }),
)

for (const target of ["task", "tool", "delivery"] as const)
  testEffect(Layer.empty).live(`MC06-R1 preserves a ${target} cancelled while finalizing a cold result`, () =>
    Effect.gen(function* () {
      const f = yield* externalRecoveryFixture()
      const reopened = yield* f.reopen
      yield* reopened.hooks.register("tool", "execute.after", (event) => {
        if (event.tool !== "task" || event.status !== "completed") return Effect.void
        if (target === "delivery")
          return reopened.service.recordDelivery({ ...f.binding, status: "cancelled" }).pipe(Effect.orDie)
        if (target === "task")
          return reopened.tasks
            .patch({
              sessionID: f.parent.id,
              id: f.parentTask.id,
              status: "cancelled",
              expectedRevision: f.parentTask.revision,
              expect: ["in_progress"],
            })
            .pipe(Effect.orDie, Effect.asVoid)
        return reopened.bus
          .publish(SessionEvent.Tool.Failed, {
            ...f.source,
            error: { type: "aborted", message: "Cancelled during result processing" },
            executed: false,
          })
          .pipe(Effect.asVoid)
      })
      expect(yield* reopened.execution.recoverPending).toMatchObject({ scanAvailable: true })
      expect(f.reads).toHaveLength(1)
      expect(yield* f.readCall(reopened)).toMatchObject({ state: { status: target === "tool" ? "error" : "running" } })
      const events = yield* reopened.bus.log({ aggregateID: f.parent.id }).pipe(Stream.runCollect)
      expect(events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Tool.Success.type)).toEqual(
        [],
      )
      expect(yield* reopened.llm.requests()).toEqual([])
      if (target === "delivery")
        expect((yield* reopened.service.listTurns(f.binding.delegationID))[0]?.status).toBe("cancelled")
    }),
  )

for (const scenario of [
  { checkpoint: "external", change: "task" },
  { checkpoint: "task", change: "task" },
  { checkpoint: "task", change: "tool" },
  { checkpoint: "task", change: "revision" },
] as const)
  testEffect(Layer.empty).live(
    `MC06-R1 rejects a ${scenario.change} change at the success commit after the ${scenario.checkpoint} checkpoint`,
    () =>
      Effect.gen(function* () {
        const f = yield* externalRecoveryFixture()
        if (scenario.checkpoint === "task") {
          yield* f.original.service.recordDelivery({
            ...f.binding,
            status: "completed",
            summary: f.text.slice(0, 4096),
          })
          yield* f.original.tasks.patch({
            sessionID: f.parent.id,
            id: f.parentTask.id,
            status: "completed",
            outputDigest: f.text.slice(0, 4096),
          })
        }
        const reopened = yield* f.reopen
        const publish = reopened.bus.publish
        // Interleave the real cancellation immediately before the real Bus transaction,
        // after recovery has finished its snapshot checks and Task writeback.
        const intercept: Bus.Interface["publish"] = (definition, data, options) =>
          Effect.gen(function* () {
            if (definition.type === SessionEvent.Tool.Success.type) {
              if (scenario.change === "tool")
                yield* publish(SessionEvent.Tool.Failed, {
                  ...f.source,
                  error: { type: "aborted", message: "Cancelled at the result commit" },
                  executed: false,
                })
              if (scenario.change !== "tool")
                yield* reopened.tasks
                  .patch({
                    sessionID: f.parent.id,
                    id: f.parentTask.id,
                    status: scenario.change === "revision" ? "completed" : "cancelled",
                    ...(scenario.change === "revision" ? { outputDigest: "A newer Task result" } : {}),
                  })
                  .pipe(Effect.orDie)
            }
            return yield* publish(definition, data, options)
          })
        Object.assign(reopened.bus, { publish: intercept })
        yield* Effect.addFinalizer(() => Effect.sync(() => Object.assign(reopened.bus, { publish })))
        const recovery = yield* reopened.execution.recoverPending
        expect(recovery.parents).not.toContain(f.parent.id)
        expect(yield* f.readCall(reopened)).toMatchObject({
          state: { status: scenario.change === "tool" ? "error" : "running" },
        })
        const events = yield* reopened.bus.log({ aggregateID: f.parent.id }).pipe(Stream.runCollect)
        expect(events.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.Tool.Success.type)).toEqual(
          [],
        )
        expect(yield* reopened.llm.requests()).toEqual([])
      }),
  )

const setup = (context: "fresh" | "fork" = "fresh", options: { custom?: boolean; snapshot?: boolean } = {}) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const sessions = yield* Session.Service
    const parent = yield* createLegacySession({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
      title: "Delegation parent",
      model,
    })
    const locations = yield* LocationServiceMap.Service
    const local = locations.get(parent.location)
    yield* Plugin.awaitActivation.pipe(Effect.provide(local))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) =>
        editor.update(worker, (agent) => {
          agent.originKind = "builtin"
          agent.mode = "subagent"
          agent.model = model
        }),
      ),
    ).pipe(Effect.provide(local))
    const compositions = yield* SessionComposition.Service
    const agents = yield* Agent.Service.pipe(Effect.provide(local))
    if (options.custom) {
      const registry = yield* Tool.Service.pipe(Effect.provide(local))
      const tools = yield* registry.snapshot()
      const app = yield* App.Metadata
      if (options.snapshot !== false)
        yield* CompositionFixture.attach(
          parent.id,
          Agent.Info.make({
            ...Agent.Info.empty(worker),
            name: Agent.Name.make("frozen-delegation-worker"),
            mode: "subagent",
            model,
            permissions: [{ action: "read", resource: "*", effect: "allow" }],
          }),
          {
            tools: CompositionDigest.captureTools(tools.catalog, String(parent.location.directory), app.version),
          },
        )
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ mode: "custom", agent: "meta" })
        .where(eq(SessionTable.id, parent.id))
        .run()
        .pipe(Effect.orDie)
    }
    const llm = yield* TestLLM.Test
    const service = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const delegation = yield* service.create({ parentSessionID: parent.id, title: "Persistent worker" })
    const participant = yield* service.addParticipant({
      delegationID: delegation.id,
      provider: "internal",
      target: worker,
      role: "implementer",
      context,
    })
    const append = (prompt: string, delivery: Delegation.DeliveryIntent = "queue") =>
      service
        .appendTurn({
          delegationID: delegation.id,
          kind: "task",
          participantIDs: [participant.id],
          delivery,
          promptSummary: "Task summary",
          origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
        })
        .pipe(Effect.tap((turn) => execution.dispatch({ delegationID: delegation.id, turnID: turn.id, prompt })))
    const receipt = (turnID: TurnID) =>
      service
        .foldState(delegation.id)
        .pipe(
          Effect.map((state) => [...(state?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === turnID)),
        )
    const wait = (turnID: TurnID, status: Delegation.DeliveryStatus) =>
      Bus.Service.use((bus) =>
        bus.log({ aggregateID: delegation.id, follow: true }).pipe(
          Stream.mapEffect(() => receipt(turnID)),
          Stream.filter((delivery) => delivery?.status === status),
          Stream.runHead,
          Effect.flatMap((result) =>
            Option.isSome(result) && result.value
              ? Effect.succeed(result.value)
              : Effect.die(new Error("Delegation result log closed")),
          ),
        ),
      ).pipe((effect) => awaitWithTimeout(effect, `Delivery did not become ${status}`, "10 seconds"))
    const child = service
      .getParticipant({ delegationID: delegation.id, participantID: participant.id })
      .pipe(
        Effect.flatMap((participant) =>
          participant?.childSessionID
            ? sessions.get(participant.childSessionID)
            : Effect.die(new Error("Participant child missing")),
        ),
      )
    const recovery = (childSessionID: Session.ID) => ({
      kind: "delegation" as const,
      delegationID: delegation.id,
      participantID: participant.id,
      childSessionID,
      parentSessionID: parent.id,
      description: delegation.title,
    })
    return {
      sessions,
      parent,
      agents,
      compositions,
      service,
      execution,
      delegation,
      participant,
      llm,
      append,
      receipt,
      wait,
      child,
      recovery,
    }
  })

const admitQueuedTask = Effect.fnUntraced(function* (options: { custom?: boolean } = {}) {
  const seed = yield* setup("fresh", options)
  const tasks = yield* SessionTask.Service
  const parentTask = (yield* tasks.append({
    sessionID: seed.parent.id,
    tasks: [{ content: "Recoverable Task", status: "in_progress", priority: "medium" }],
  })).at(-1)
  if (!parentTask) return yield* Effect.die(new Error("Parent Task missing"))
  const child = yield* createLegacySession({ parentID: seed.parent.id, title: "Queued child", agent: worker, model })
  yield* seed.service.bindParticipant({
    delegationID: seed.delegation.id,
    participantID: seed.participant.id,
    childSessionID: child.id,
  })
  const turn = yield* seed.service.appendTurn({
    delegationID: seed.delegation.id,
    kind: "task",
    delivery: "queue",
    participantIDs: [seed.participant.id],
    origin: { deliveryOrigin: "meta", senderParticipantID: seed.participant.id },
  })
  const delivery = yield* seed.receipt(turn.id)
  if (!delivery) return yield* Effect.die(new Error("Delivery missing"))
  const receipt = {
    delegationID: seed.delegation.id,
    ...delivery,
    childSessionID: child.id,
    inputID: DelegationExecution.inputID(seed.delegation.id, delivery),
  }
  yield* seed.sessions.prompt({
    sessionID: child.id,
    id: receipt.inputID,
    text: "Retain this task until explicit reconciliation",
    resume: false,
    metadata: {
      delegation: receipt,
      task: {
        parentTaskID: parentTask.id,
        parentTaskRevision: parentTask.revision,
        description: "Recoverable Task",
        background: true,
      },
    },
  })
  return { seed, tasks, parentTask, child, receipt }
})

describe("DelegationExecution authoritative Session results", () => {
  it.live("dispatches a Custom worker from the frozen pool after the live registry removes it", () =>
    Effect.gen(function* () {
      const seed = yield* setup("fresh", { custom: true })
      yield* seed.agents.transform((editor) => editor.remove(worker))
      yield* seed.llm.push(TestLLM.text("Frozen delegation result", "frozen-delegation"))
      const turn = yield* seed.append("Use the frozen worker")
      yield* seed.wait(turn.id, "completed")
      const child = yield* seed.child
      expect(child).toMatchObject({ parentID: seed.parent.id, mode: "custom", agent: worker, model })
      expect((yield* seed.compositions.selectAgent(child.id, worker)).info.name).toBe(
        Agent.Name.make("frozen-delegation-worker"),
      )
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Custom delivery missing"))
      expect(
        yield* seed.execution.wait({
          delegationID: seed.delegation.id,
          ...delivery,
          childSessionID: child.id,
          inputID: DelegationExecution.inputID(seed.delegation.id, delivery),
        }),
      ).toEqual({ status: "completed", text: "Frozen delegation result" })
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }).pipe((effect) => withCustomMode("true", effect)),
  )

  it.live("forks a Custom child with its explicit frozen executor and retains parent history", () =>
    Effect.gen(function* () {
      const seed = yield* setup("fork", { custom: true })
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      yield* seed.sessions.prompt({ sessionID: seed.parent.id, text: "Frozen parent context", resume: false })
      yield* SessionInbox.promote(database.db, bus, seed.parent.id, "steer")
      yield* seed.agents.transform((editor) => editor.remove(worker))
      yield* seed.llm.push(TestLLM.text("Custom fork result", "custom-fork"))
      const turn = yield* seed.append("Forked Custom task")
      yield* seed.wait(turn.id, "completed")
      const child = yield* seed.child
      expect(child).toMatchObject({
        parentID: seed.parent.id,
        mode: "custom",
        agent: worker,
        attended: false,
        fork: { sessionID: seed.parent.id },
      })
      expect((yield* seed.compositions.selectAgent(child.id, worker)).info.model).toEqual(model)
      expect((yield* seed.llm.requests())[0]?.messages).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Frozen parent context" }] },
        { role: "user", content: [{ type: "text", text: "Forked Custom task" }] },
      ])
    }).pipe((effect) => withCustomMode("true", effect)),
  )

  it.live("checks the whole Custom fanout pool before creating a child or admitting an input", () =>
    Effect.gen(function* () {
      const seed = yield* setup("fresh", { custom: true })
      const outsider = Agent.ID.make("live-only-delegation-worker")
      yield* seed.agents.transform((editor) =>
        editor.update(outsider, (agent) => {
          agent.mode = "subagent"
          agent.model = model
        }),
      )
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: outsider,
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const before = yield* seed.sessions.list()
      const state = yield* seed.service.foldState(seed.delegation.id)
      expect(
        yield* seed.execution
          .dispatch({
            delegationID: seed.delegation.id,
            turnID: turn.id,
            prompt: "Do not execute a partial Custom fanout",
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(SessionComposition.AgentDelegationForbiddenError)
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.service.foldState(seed.delegation.id)).toEqual(state)
      const database = yield* Database.Service
      expect(yield* database.db.select().from(SessionInboxTable).all()).toHaveLength(0)
      const jobs = yield* Job.Service
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      expect(yield* seed.llm.requests()).toHaveLength(0)
    }).pipe((effect) => withCustomMode("true", effect)),
  )

  it.live("fails Custom dispatch without a snapshot before creating or waking its child", () =>
    Effect.gen(function* () {
      const seed = yield* setup("fresh", { custom: true, snapshot: false })
      const before = yield* seed.sessions.list()
      expect(yield* seed.append("Missing frozen composition").pipe(Effect.flip)).toBeInstanceOf(
        SessionComposition.SnapshotNotFoundError,
      )
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(
        (yield* seed.service.getParticipant({
          delegationID: seed.delegation.id,
          participantID: seed.participant.id,
        }))?.childSessionID,
      ).toBeUndefined()
      expect(yield* seed.llm.requests()).toEqual([])
    }).pipe((effect) => withCustomMode("true", effect)),
  )

  it.live("preserves disabled Custom delegation recovery before settlement or child claim cleanup", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const task = yield* admitQueuedTask({ custom: true })
        const database = yield* Database.Service
        const store = yield* SessionStore.Service
        yield* database.db
          .update(SessionTable)
          .set({ time_suspended: Date.now(), resume_attempts: 1 })
          .where(eq(SessionTable.id, task.child.id))
          .run()
          .pipe(Effect.orDie)
        const before = yield* task.seed.service.foldState(task.seed.delegation.id)
        const pending = yield* task.seed.sessions.inbox(task.child.id)
        yield* withCustomMode(
          "false",
          Effect.gen(function* () {
            expect(yield* task.seed.execution.recoverPending).toMatchObject({
              parents: [],
              deferredChildren: [task.child.id],
              scanAvailable: true,
            })
            yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions)
          }),
        )
        expect(yield* task.seed.service.foldState(task.seed.delegation.id)).toEqual(before)
        expect(yield* task.tasks.get(task.seed.parent.id)).toEqual([task.parentTask])
        expect(yield* task.seed.sessions.inbox(task.child.id)).toEqual(pending)
        expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toEqual([])
        expect(yield* task.seed.llm.requests()).toEqual([])
        expect(
          yield* database.db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.id, task.child.id))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({ time_suspended: expect.any(Number), resume_attempts: 1 })
        expect(yield* store.get(task.child.id)).toBeDefined()
        expect((yield* task.seed.execution.recoverPending).parents).toEqual([task.seed.parent.id])
        expect(yield* task.tasks.get(task.seed.parent.id)).toMatchObject([{ status: "failed" }])
        expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(1)
      }),
    ),
  )

  it.live("recovers a pending Task notice and wakes its idle parent without repeating child work", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([task.seed.parent.id])
      const settled = yield* task.tasks.get(task.seed.parent.id)
      expect(settled[0]).toMatchObject({ status: "failed", revision: task.parentTask.revision + 1 })
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([task.seed.parent.id])
      expect(yield* task.tasks.get(task.seed.parent.id)).toEqual(settled)
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(1)
      yield* task.seed.llm.push(TestLLM.text("Recovered notice received", "parent-recovery"))
      yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions)
      yield* awaitWithTimeout(task.seed.llm.wait(1), "Idle parent was not woken")
      yield* SessionExecution.Service.use((execution) => execution.awaitIdle(task.seed.parent.id))
      expect(
        (yield* task.seed.sessions.context(task.seed.parent.id)).filter((message) => message.type === "synthetic"),
      ).toHaveLength(1)
      expect(yield* task.seed.sessions.inbox(task.child.id)).toMatchObject([{ id: task.receipt.inputID }])
      yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions)
      expect(yield* task.seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("does not revive a cancelled or removed Task notice during later recovery", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      yield* task.seed.execution.recoverPending
      const notice = (yield* task.seed.sessions.inbox(task.seed.parent.id))[0]
      if (!notice) return yield* Effect.die(new Error("Task notice missing"))
      yield* task.seed.sessions.cancelInbox({ sessionID: task.seed.parent.id, inboxID: notice.id })
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([])
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(0)
      const removed = yield* admitQueuedTask()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Synthetic, { sessionID: removed.seed.parent.id, text: "Revert boundary" })
      const boundary = (yield* removed.seed.sessions.context(removed.seed.parent.id)).find(
        (message) => message.type === "synthetic",
      )
      if (!boundary) return yield* Effect.die(new Error("Revert boundary missing"))
      yield* removed.seed.execution.recoverPending
      yield* bus.publish(SessionEvent.RevertEvent.Committed, { sessionID: removed.seed.parent.id, to: boundary.id })
      expect((yield* removed.seed.execution.recoverPending).parents).toEqual([])
      expect(yield* removed.seed.sessions.inbox(removed.seed.parent.id)).toHaveLength(0)
      expect(yield* task.seed.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("corrects a recovery-required Task on close while preserving its first receipt and notice", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      yield* task.seed.execution.recoverPending
      const notice = (yield* task.seed.sessions.inbox(task.seed.parent.id))[0]
      if (!notice) return yield* Effect.die(new Error("Task notice missing"))
      yield* task.seed.llm.push(TestLLM.text("Closure received", "parent-closure"))
      yield* task.seed.execution.close({ delegationID: task.seed.delegation.id })
      yield* awaitWithTimeout(task.seed.llm.wait(1), "Parent was not woken after closure")
      yield* SessionExecution.Service.use((execution) => execution.awaitIdle(task.seed.parent.id))
      expect(yield* task.seed.receipt(task.receipt.turnID)).toMatchObject({ status: "cancelled", attempt: 1 })
      expect(yield* task.seed.sessions.inbox(task.child.id)).toEqual([])
      const corrected = yield* task.tasks.get(task.seed.parent.id)
      expect(corrected).toMatchObject([
        {
          status: "cancelled",
          revision: task.parentTask.revision + 2,
          outputDigest: "Delegation closed before input delivery",
        },
      ])
      expect(yield* task.seed.execution.wait(task.receipt)).toMatchObject({ status: "recovery_required" })
      expect(yield* task.tasks.get(task.seed.parent.id)).toEqual(corrected)
      const notices = (yield* task.seed.sessions.context(task.seed.parent.id)).filter(
        (message) => message.type === "synthetic",
      )
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ id: notice.id, metadata: { state: "recovery_required" } })
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([])
      expect(yield* task.seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("holds a completed background Task notice behind staged revert without waking its parent", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Synthetic, { sessionID: task.seed.parent.id, text: "Revert boundary" })
      const boundary = (yield* task.seed.sessions.context(task.seed.parent.id)).find(
        (message) => message.type === "synthetic",
      )
      if (!boundary) return yield* Effect.die(new Error("Revert boundary missing"))
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: task.seed.parent.id,
        revert: { messageID: boundary.id, files: [] },
      })
      yield* task.seed.llm.push(TestLLM.text("Child completed", "child-revert"))
      yield* task.seed.execution.dispatch({
        delegationID: task.seed.delegation.id,
        turnID: task.receipt.turnID,
        prompt: "Existing admission retains its original task",
      })
      yield* task.seed.wait(task.receipt.turnID, "completed")
      expect(yield* task.seed.execution.wait(task.receipt)).toEqual({ status: "completed", text: "Child completed" })
      yield* SessionExecution.Service.use((execution) => execution.awaitIdle(task.child.id))
      expect(yield* task.tasks.get(task.seed.parent.id)).toMatchObject([{ status: "completed" }])
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(1)
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([])
      yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions)
      expect(yield* task.seed.llm.requests()).toHaveLength(1)
      expect((yield* task.seed.sessions.get(task.seed.parent.id)).revert?.messageID).toBe(boundary.id)
      yield* task.seed.sessions.revert.commit(task.seed.parent.id)
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toEqual([])
      expect((yield* task.seed.execution.recoverPending).parents).toEqual([])
      expect(yield* task.seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("does not bypass a claimed parent's exhausted restart budget on repeated Task recovery", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      const store = yield* SessionStore.Service
      yield* store.claim(task.seed.parent.id)
      yield* Effect.forEach(Array.from({ length: 10 }), () => store.countResume(task.seed.parent.id), { discard: true })
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(1)
      expect(yield* store.listSuspended()).toEqual([])
      yield* restart.resumeSuspendedSessions
      yield* restart.resumeSuspendedSessions
      expect(yield* task.seed.llm.requests()).toHaveLength(0)
      expect(
        (yield* task.seed.sessions.context(task.seed.parent.id)).filter(
          (message) => message.type === "idle" && message.outcome === "failed",
        ),
      ).toHaveLength(1)
    }),
  )

  it.live("rechecks child placement after waiting and preserves the old parent Task", () =>
    Effect.gen(function* () {
      const task = yield* admitQueuedTask()
      const scope = yield* Effect.scope
      const bus = yield* Bus.Service
      const ready = yield* Deferred.make<void>()
      const context = yield* Effect.context<Layer.Success<typeof layer>>()
      const observer = yield* Layer.build(
        Layer.fresh(DelegationExecution.layer).pipe(
          Layer.provide(
            Layer.succeedContext(
              Context.add(
                context,
                Bus.Service,
                Bus.Service.of({
                  ...bus,
                  log: (input) =>
                    bus
                      .log(input)
                      .pipe(
                        Stream.tap((event) =>
                          input.aggregateID === task.receipt.delegationID && Bus.isSynced(event)
                            ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid)
                            : Effect.void,
                        ),
                      ),
                }),
              ),
            ),
          ),
        ),
      )
      const waiting = yield* Context.get(observer, DelegationExecution.Service)
        .wait(task.receipt)
        .pipe(Effect.exit, Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(ready), "Receipt wait did not subscribe")
      const destination = yield* tmpdirScoped()
      yield* bus.publish(SessionEvent.Moved, {
        sessionID: task.child.id,
        location: Location.Ref.make({ directory: AbsolutePath.make(destination.path) }),
        projectID: task.child.projectID,
        subpath: task.child.subpath,
      })
      yield* task.seed.service.recordDelivery({ ...task.receipt, status: "recovery_required", summary: "Child moved" })
      const result = yield* awaitWithTimeout(Fiber.join(waiting), "Moved receipt did not settle")
      expect(result).toMatchObject({ _tag: "Failure" })
      if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Moved receipt unexpectedly succeeded"))
      expect(String(result.cause)).toContain("lost Session input ownership while waiting")
      expect(yield* task.tasks.get(task.seed.parent.id)).toMatchObject([
        { status: "in_progress", revision: task.parentTask.revision },
      ])
      expect(yield* task.seed.sessions.inbox(task.seed.parent.id)).toHaveLength(0)
    }),
  )

  it.live("keeps queued results separate and does not replace an earlier success with a later failure", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        TestLLM.text("first result", "first"),
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "Second task rejected" }) })),
      )
      const first = yield* seed.append("First full task")
      yield* awaitWithTimeout(gate.started, "First model request missing")
      const child = yield* seed.child
      const second = yield* seed.append("Second full task")
      expect(yield* seed.receipt(first.id)).toMatchObject({ status: "running" })
      expect(yield* seed.receipt(second.id)).toMatchObject({ status: "queued" })
      yield* gate.release
      expect(yield* seed.wait(first.id, "completed")).toMatchObject({ summary: "first result", attempt: 1 })
      expect(yield* seed.wait(second.id, "failed")).toMatchObject({ summary: "Second task rejected", attempt: 1 })
      const execution = yield* SessionExecution.Service
      yield* execution.awaitIdle(child.id)
      const requests = yield* seed.llm.requests()
      expect(requests).toHaveLength(2)
      expect(requests[0]?.messages).toMatchObject([
        { role: "user", content: [{ type: "text", text: "First full task" }] },
      ])
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Second full task" }],
      })
      yield* seed.execution.dispatch({ delegationID: seed.delegation.id, turnID: first.id, prompt: "Ignored retry" })
      expect(yield* seed.llm.requests()).toHaveLength(2)
      expect((yield* seed.sessions.context(child.id)).filter((message) => message.type === "user")).toHaveLength(2)
    }),
  )

  it.live("MC05 settles and retries a later participant after the first participant already succeeded", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("ALPHA_ONE", "mc05-first-complete"))
      const first = yield* seed.append("Reply exactly ALPHA_ONE.", "steer")
      const firstResult = yield* seed.wait(first.id, "completed")
      const firstChild = yield* seed.child
      const runs = yield* SessionExecution.Service
      yield* runs.awaitIdle(firstChild.id)
      expect((yield* seed.service.foldState(seed.delegation.id))?.delegation.status).toBe("approved")
      const firstReceipt = {
        delegationID: seed.delegation.id,
        ...firstResult,
        childSessionID: firstChild.id,
        inputID: DelegationExecution.inputID(seed.delegation.id, firstResult),
      }
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: Agent.ID.make("general"),
        role: "implementer",
        context: "fresh",
      })
      const tasks = yield* SessionTask.Service
      const parentTask = (yield* tasks.append({
        sessionID: seed.parent.id,
        tasks: [{ content: "Second participant result", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!parentTask) return yield* Effect.die(new Error("General parent Task missing"))
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "steer",
        participantIDs: [second.id],
        origin: { deliveryOrigin: "meta", senderParticipantID: second.id },
      })
      expect((yield* seed.service.foldState(seed.delegation.id))?.delegation.status).toBe("running")
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "General request rejected" }) })),
      )
      const [receipt] = yield* seed.execution.dispatch({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        prompt: "Reply exactly BETA_ONE. Use no tools or delegation.",
        task: {
          parentTaskID: parentTask.id,
          parentTaskRevision: parentTask.revision,
          description: "Second participant result",
          background: false,
        },
      })
      if (!receipt) return yield* Effect.die(new Error("General receipt missing"))
      yield* awaitWithTimeout(gate.started, "General request did not start")
      yield* gate.release
      expect(yield* awaitWithTimeout(seed.execution.wait(receipt), "General failed delivery did not settle")).toEqual({
        status: "failed",
        text: "General request rejected",
      })
      yield* runs.awaitIdle(receipt.childSessionID)
      expect((yield* tasks.get(seed.parent.id)).find((task) => task.id === parentTask.id)).toMatchObject({
        status: "failed",
        outputDigest: "General request rejected",
        revision: parentTask.revision + 1,
      })
      expect(
        yield* seed.execution.recover({
          kind: "delegation",
          delegationID: seed.delegation.id,
          participantID: second.id,
          childSessionID: receipt.childSessionID,
          parentSessionID: seed.parent.id,
          description: seed.delegation.title,
        }),
      ).toMatchObject({ status: "reconciled", childSessionID: receipt.childSessionID })
      expect(yield* seed.llm.requests()).toHaveLength(2)
      expect(yield* seed.execution.wait(firstReceipt)).toEqual({ status: "completed", text: "ALPHA_ONE" })
      expect(yield* seed.sessions.inbox(seed.parent.id)).toHaveLength(0)

      yield* seed.llm.push(TestLLM.text("BETA_ONE", "mc05-general-retry"))
      yield* seed.execution.retry({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: second.id,
      })
      const retried = yield* pollWithTimeout(
        seed.service
          .foldState(seed.delegation.id)
          .pipe(
            Effect.map((state) =>
              [...(state?.deliveries.values() ?? [])].find(
                (delivery) => delivery.turnID === turn.id && delivery.attempt === 2 && delivery.status === "completed",
              ),
            ),
          ),
        "General retry did not complete",
      )
      expect(retried).toMatchObject({ participantID: second.id, summary: "BETA_ONE", attempt: 2 })
      if (!retried) return yield* Effect.die(new Error("General retry receipt missing"))
      expect(
        yield* seed.execution.wait({
          ...receipt,
          ...retried,
          inputID: DelegationExecution.inputID(seed.delegation.id, retried),
        }),
      ).toEqual({ status: "completed", text: "BETA_ONE" })
      yield* runs.awaitIdle(receipt.childSessionID)
      expect(DelegationExecution.inputID(seed.delegation.id, retried)).not.toBe(receipt.inputID)
      expect((yield* tasks.get(seed.parent.id)).find((task) => task.id === parentTask.id)).toMatchObject({
        status: "completed",
        outputDigest: "BETA_ONE",
        revision: parentTask.revision + 3,
      })
      expect(
        yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: second.id }),
      ).toMatchObject({ phase: "active", childSessionID: receipt.childSessionID })
      expect(yield* seed.execution.wait(receipt)).toEqual({ status: "failed", text: "General request rejected" })
      expect(yield* seed.execution.wait(firstReceipt)).toEqual({ status: "completed", text: "ALPHA_ONE" })
      expect((yield* seed.sessions.context(firstChild.id)).filter((message) => message.type === "user")).toMatchObject([
        { text: "Reply exactly ALPHA_ONE." },
      ])
      expect(
        (yield* seed.sessions.context(receipt.childSessionID)).filter((message) => message.type === "user"),
      ).toMatchObject([
        { text: "Reply exactly BETA_ONE. Use no tools or delegation." },
        { text: "Reply exactly BETA_ONE. Use no tools or delegation." },
      ])
      const state = yield* seed.service.foldState(seed.delegation.id)
      expect(state?.participants.size).toBe(2)
      expect(state?.turns.size).toBe(2)
      expect(state?.deliveries.size).toBe(2)
      expect(state?.delegation.status).toBe("approved")
      expect(yield* seed.sessions.inbox(seed.parent.id)).toHaveLength(0)
      expect(yield* seed.llm.requests()).toHaveLength(3)
    }),
  )

  it.live("MC05 preserves one participant's successful receipt when another fails after admission", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: Agent.ID.make("build"),
        role: "implementer",
        context: "fresh",
      })
      yield* seed.llm.push(
        TestLLM.text("Independent result retained.", "mc05-success"),
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "Independent participant failed" }) })),
      )
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const receipts = yield* seed.execution.dispatch({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        prompt: "Complete this independent contribution.",
      })
      expect(receipts).toHaveLength(2)
      expect(new Set(receipts.map((receipt) => receipt.participantID)).size).toBe(2)
      expect(new Set(receipts.map((receipt) => receipt.childSessionID)).size).toBe(2)
      expect(new Set(receipts.map((receipt) => receipt.inputID)).size).toBe(2)
      const results = yield* Effect.forEach(receipts, (receipt) => seed.execution.wait(receipt))
      const succeeded = receipts.find((_, index) => results[index]?.status === "completed")
      const failed = receipts.find((_, index) => results[index]?.status === "failed")
      if (!succeeded || !failed) return yield* Effect.die(new Error("MC05 independent outcomes are missing"))
      expect(succeeded.participantID).not.toBe(failed.participantID)
      expect(yield* seed.execution.wait(succeeded)).toEqual({
        status: "completed",
        text: "Independent result retained.",
      })
      expect(yield* seed.execution.wait(failed)).toMatchObject({
        status: "failed",
        text: "Independent participant failed",
      })
      const state = yield* seed.service.foldState(seed.delegation.id)
      expect(state?.turns.size).toBe(1)
      expect(state?.deliveries.size).toBe(2)
      expect(
        [...(state?.deliveries.values() ?? [])].find((delivery) => delivery.participantID === succeeded.participantID),
      ).toMatchObject({ status: "completed", summary: "Independent result retained.", attempt: 1 })
      expect(
        [...(state?.deliveries.values() ?? [])].find((delivery) => delivery.participantID === failed.participantID),
      ).toMatchObject({ status: "failed", summary: "Independent participant failed", attempt: 1 })
      const execution = yield* SessionExecution.Service
      yield* Effect.forEach(receipts, (receipt) =>
        Effect.gen(function* () {
          expect(receipt).toMatchObject({
            delegationID: seed.delegation.id,
            turnID: turn.id,
            deliveryOrigin: "parent-task",
            senderParticipantID: seed.participant.id,
            attempt: 1,
          })
          expect(receipt.inputID).toBe(DelegationExecution.inputID(seed.delegation.id, receipt))
          const child = yield* seed.sessions.get(receipt.childSessionID)
          expect(child.parentID).toBe(seed.parent.id)
          const input = yield* seed.sessions.message({ sessionID: child.id, messageID: receipt.inputID })
          if (input?.type !== "user") return yield* Effect.die(new Error("MC05 admitted input is missing"))
          expect(input.metadata?.delegation).toMatchObject({
            delegationID: seed.delegation.id,
            turnID: turn.id,
            participantID: receipt.participantID,
            deliveryOrigin: "parent-task",
            senderParticipantID: seed.participant.id,
            attempt: 1,
          })
          yield* execution.awaitIdle(child.id)
          expect(yield* seed.sessions.inbox(child.id)).toHaveLength(0)
        }),
      )
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )

  it.live("stores full text in Session and bounds the receipt summary without splitting Unicode characters", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const full = "a" + "🙂".repeat(4200)
      yield* seed.llm.push(TestLLM.text(full, "large"))
      const turn = yield* seed.append("Complete task text beyond its public summary")
      const receipt = yield* seed.wait(turn.id, "completed")
      expect(receipt.summary).toHaveLength(4095)
      expect(receipt.summary).toBe("a" + "🙂".repeat(2047))
      const child = yield* seed.child
      const database = yield* Database.Service
      const result = yield* SessionInputResult.read(database.db, {
        sessionID: child.id,
        inputID: DelegationExecution.inputID(seed.delegation.id, receipt),
      })
      expect(result).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: full }] } })
      expect(
        yield* seed.execution.wait({
          delegationID: seed.delegation.id,
          ...receipt,
          childSessionID: child.id,
          inputID: DelegationExecution.inputID(seed.delegation.id, receipt),
        }),
      ).toEqual({ status: "completed", text: full })
      expect((yield* seed.service.listTurns(seed.delegation.id))[0]?.promptSummary).toBe("Task summary")
    }),
  )

  testEffect(Layer.empty).live(
    "reopens a successful internal Task delivery and consumes its exact parent notice once",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped("aigcfroge-delegation-workspace-")
        // Revert captures the workspace even with files disabled; keep SQLite outside that snapshot.
        const databaseDirectory = yield* tmpdirScoped("aigcfroge-delegation-database-")
        const databasePath = `${databaseDirectory.path}/success-delivery.sqlite`
        const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
        const open = (scope: Scope.Scope) =>
          Effect.gen(function* () {
            const context = yield* Layer.build(
              AppNodeBuilder.build(
                LayerNode.group([nodes, WorkflowExecution.node, WorkflowRun.node, SessionInbox.node]),
                [...replacements, Database.node.replace(Database.configured({ path: databasePath }))],
              ),
            )
            const local = yield* Context.get(context, LocationServiceMap.Service).contextEffect(location)
            yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
            const agents = Context.get(local, Agent.Service)
            yield* agents.transform((editor) =>
              editor.update(worker, (agent) => {
                agent.originKind = "builtin"
                agent.mode = "subagent"
                agent.model = model
              }),
            )
            return {
              sessions: Context.get(context, Session.Service),
              createLegacySession: (input: Parameters<typeof createLegacySession>[0]) =>
                createLegacySession(input).pipe(Effect.provideContext(context)),
              runner: Context.get(context, SessionExecution.Service),
              execution: Context.get(context, DelegationExecution.Service),
              service: Context.get(context, DelegationService.Service),
              tasks: Context.get(context, SessionTask.Service),
              database: Context.get(context, Database.Service),
              restart: Context.get(context, SessionRestart.Service),
              llm: Context.get(context, TestLLM.Test),
              runs: Context.get(context, WorkflowRun.Service),
            }
          }).pipe(Effect.provideService(Scope.Scope, scope))

        const originalScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
        const original = yield* open(originalScope)
        const parent = yield* original.createLegacySession({
          location,
          title: "Successful delivery parent",
          agent: Agent.defaultID,
          model,
        })
        yield* original.llm.push(TestLLM.text("Parent context ready", "parent-context"))
        const boundary = yield* original.sessions.prompt({ sessionID: parent.id, text: "Seed parent context" })
        yield* awaitWithTimeout(original.llm.wait(1), "Parent context request missing", "10 seconds")
        yield* awaitWithTimeout(original.runner.awaitIdle(parent.id), "Parent context did not finish", "10 seconds")
        const boundaryResult = yield* SessionInputResult.read(original.database.db, {
          sessionID: parent.id,
          inputID: boundary.id,
        })
        expect(boundaryResult).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: "Parent context ready" }] },
        })
        yield* original.sessions.revert.stage({ sessionID: parent.id, messageID: boundary.id, files: false })

        const parentTask = (yield* original.tasks.append({
          sessionID: parent.id,
          tasks: [{ content: "Persist a successful internal delivery", status: "in_progress", priority: "medium" }],
        })).at(-1)
        if (!parentTask) return yield* Effect.die(new Error("Parent Task missing"))
        const delegation = yield* original.service.create({
          parentSessionID: parent.id,
          title: "Successful persistent worker",
        })
        const participant = yield* original.service.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: worker,
          role: "implementer",
          context: "fresh",
        })
        const turn = yield* original.service.appendTurn({
          delegationID: delegation.id,
          kind: "task",
          participantIDs: [participant.id],
          delivery: "queue",
          promptSummary: "Successful internal Task",
          origin: { deliveryOrigin: "parent-task", senderParticipantID: participant.id },
        })
        const childText = "Successful internal child output"
        yield* original.llm.push(TestLLM.text(childText, "successful-child"))
        const receipt = (yield* original.execution.dispatch({
          delegationID: delegation.id,
          turnID: turn.id,
          prompt: "Complete the persistent internal task",
          task: {
            parentTaskID: parentTask.id,
            parentTaskRevision: parentTask.revision,
            description: "Successful internal Task",
            background: true,
          },
        }))[0]
        if (!receipt) return yield* Effect.die(new Error("Successful Task receipt missing"))
        expect(
          yield* awaitWithTimeout(original.execution.wait(receipt), "Internal Task did not complete", "10 seconds"),
        ).toEqual({ status: "completed", text: childText })
        yield* awaitWithTimeout(
          original.runner.awaitIdle(receipt.childSessionID),
          "Successful child did not become idle",
          "10 seconds",
        )
        const settledTask = yield* pollWithTimeout(
          original.tasks
            .get(parent.id)
            .pipe(
              Effect.map((tasks) => tasks.find((task) => task.id === parentTask.id && task.status === "completed")),
            ),
          "Successful child did not complete its parent Task",
          "10 seconds",
        )
        expect(settledTask).toMatchObject({ revision: parentTask.revision + 1, outputDigest: childText })
        const notice = yield* pollWithTimeout(
          original.sessions
            .inbox(parent.id)
            .pipe(Effect.map((items) => items.find((item) => item.type === "synthetic"))),
          "Successful Task notice was not admitted",
          "10 seconds",
        )
        if (notice.type !== "synthetic") return yield* Effect.die(new Error("Expected a synthetic Task notice"))
        expect(notice.payload.metadata).toMatchObject({
          source: "task",
          childID: receipt.childSessionID,
          state: "completed",
          parentTaskID: parentTask.id,
          inputID: receipt.inputID,
          delegation: {
            delegationID: delegation.id,
            participantID: participant.id,
            turnID: turn.id,
            deliveryOrigin: "parent-task",
            senderParticipantID: participant.id,
            attempt: 1,
          },
        })
        expect(notice.payload.text).toContain(childText)
        expect(notice.payload.text).toContain(receipt.childSessionID)
        expect(notice.payload.text).toContain('state="completed"')
        expect(yield* original.sessions.inbox(parent.id)).toEqual([notice])
        expect(
          yield* SessionInputResult.read(original.database.db, { sessionID: parent.id, inputID: notice.id }),
        ).toEqual({
          status: "pending",
        })

        const readSettlement = (opened: typeof original) =>
          Effect.gen(function* () {
            const state = yield* opened.service.foldState(delegation.id)
            return {
              deliveries: [...(state?.deliveries.values() ?? [])],
              participant: yield* opened.service.getParticipant({
                delegationID: delegation.id,
                participantID: participant.id,
              }),
              tasks: yield* opened.tasks.get(parent.id),
              childResult: yield* SessionInputResult.read(opened.database.db, {
                sessionID: receipt.childSessionID,
                inputID: receipt.inputID,
              }),
              boundaryResult: yield* SessionInputResult.read(opened.database.db, {
                sessionID: parent.id,
                inputID: boundary.id,
              }),
              childInbox: yield* opened.sessions.inbox(receipt.childSessionID),
              sessionIDs: (yield* opened.database.db.select({ id: SessionTable.id }).from(SessionTable).all())
                .map((session) => session.id)
                .toSorted(),
              workflows: yield* opened.runs.listForRecovery,
            }
          })
        const saved = yield* readSettlement(original)
        expect(saved.deliveries).toHaveLength(1)
        expect(saved.deliveries[0]).toMatchObject({
          turnID: receipt.turnID,
          participantID: receipt.participantID,
          deliveryOrigin: receipt.deliveryOrigin,
          senderParticipantID: receipt.senderParticipantID,
          status: "completed",
          summary: childText,
          attempt: 1,
        })
        expect(saved.participant?.childSessionID).toBe(receipt.childSessionID)
        expect(saved.tasks).toEqual([settledTask])
        expect(saved.childResult).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: childText }] },
        })
        expect(saved.boundaryResult).toEqual(boundaryResult)
        expect(saved.childInbox).toEqual([])
        expect(saved.sessionIDs).toEqual([parent.id, receipt.childSessionID].toSorted())
        expect(saved.workflows).toEqual([])
        expect(yield* original.llm.requests()).toHaveLength(2)

        const recover = (opened: typeof original) =>
          Effect.gen(function* () {
            expect(yield* opened.execution.recoverPending).toMatchObject({
              scanAvailable: true,
              parents: [],
              deferredChildren: [],
            })
            yield* opened.restart.resumeSuspendedSessions
            expect(yield* opened.execution.recoverPending).toMatchObject({
              scanAvailable: true,
              parents: [],
              deferredChildren: [],
            })
            yield* opened.restart.resumeSuspendedSessions
            yield* awaitWithTimeout(opened.runner.awaitIdle(parent.id), "Recovered parent did not idle", "10 seconds")
            yield* awaitWithTimeout(
              opened.runner.awaitIdle(receipt.childSessionID),
              "Recovered child did not idle",
              "10 seconds",
            )
          })
        yield* Scope.close(originalScope, Exit.void)

        const reopenedScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(reopenedScope, Exit.void))
        const reopened = yield* open(reopenedScope)
        expect(reopened.database).not.toBe(original.database)
        expect(reopened.llm).not.toBe(original.llm)
        expect((yield* reopened.sessions.get(parent.id)).revert?.messageID).toBe(boundary.id)
        expect(yield* readSettlement(reopened)).toEqual(saved)
        expect(yield* reopened.sessions.inbox(parent.id)).toEqual([notice])
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: parent.id, inputID: notice.id }),
        ).toEqual({
          status: "pending",
        })
        yield* recover(reopened)
        expect(yield* readSettlement(reopened)).toEqual(saved)
        expect(yield* reopened.sessions.inbox(parent.id)).toEqual([notice])
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: parent.id, inputID: notice.id }),
        ).toEqual({
          status: "pending",
        })
        expect(yield* reopened.llm.requests()).toEqual([])

        const acknowledgment = "Parent acknowledged completed delivery"
        yield* reopened.llm.push(TestLLM.text(acknowledgment, "parent-notice"))
        yield* reopened.sessions.revert.clear(parent.id)
        yield* reopened.restart.resumeSuspendedSessions
        yield* awaitWithTimeout(reopened.llm.wait(1), "Reopened parent notice request missing", "10 seconds")
        yield* awaitWithTimeout(reopened.runner.awaitIdle(parent.id), "Parent notice did not finish", "10 seconds")
        const acknowledged = yield* SessionInputResult.read(reopened.database.db, {
          sessionID: parent.id,
          inputID: notice.id,
        })
        expect(acknowledged).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: acknowledgment }] },
        })
        const notices = (yield* reopened.sessions.context(parent.id)).filter((message) => message.type === "synthetic")
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatchObject({ id: notice.id, metadata: notice.payload.metadata })
        expect(yield* reopened.sessions.inbox(parent.id)).toEqual([])
        expect(yield* readSettlement(reopened)).toEqual(saved)
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        const requestText = (yield* reopened.llm.requests())
          .flatMap((request) =>
            request.messages.flatMap((message) =>
              message.content.filter((part) => part.type === "text").map((part) => part.text),
            ),
          )
          .join("\n")
        expect(requestText).toContain(childText)
        expect(requestText).toContain(receipt.childSessionID)
        expect(requestText).toContain('state="completed"')
        yield* recover(reopened)
        expect(yield* readSettlement(reopened)).toEqual(saved)
        expect(yield* reopened.sessions.inbox(parent.id)).toEqual([])
        expect((yield* reopened.sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
          notices,
        )
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: parent.id, inputID: notice.id }),
        ).toEqual(acknowledged)
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        yield* Scope.close(reopenedScope, Exit.void)

        const coldScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(coldScope, Exit.void))
        const cold = yield* open(coldScope)
        expect(cold.database).not.toBe(reopened.database)
        expect(cold.llm).not.toBe(reopened.llm)
        expect(yield* readSettlement(cold)).toEqual(saved)
        expect(yield* SessionInputResult.read(cold.database.db, { sessionID: parent.id, inputID: notice.id })).toEqual(
          acknowledged,
        )
        yield* recover(cold)
        expect(yield* readSettlement(cold)).toEqual(saved)
        expect(yield* cold.sessions.inbox(parent.id)).toEqual([])
        expect((yield* cold.sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
          notices,
        )
        expect(yield* SessionInputResult.read(cold.database.db, { sessionID: parent.id, inputID: notice.id })).toEqual(
          acknowledged,
        )
        expect(yield* cold.llm.requests()).toEqual([])
        yield* Scope.close(coldScope, Exit.void)
      }),
    30_000,
  )

  testEffect(Layer.empty).live(
    "isolates a real Location config boot failure during restart and rebuilds after repair",
    () =>
      Effect.gen(function* () {
        const badDirectory = yield* tmpdirScoped("aigcfroge-restart-bad-location-")
        const goodDirectory = yield* tmpdirScoped("aigcfroge-restart-good-location-")
        const databaseDirectory = yield* tmpdirScoped("aigcfroge-restart-location-database-")
        const databasePath = `${databaseDirectory.path}/location-restart.sqlite`
        const open = (scope: Scope.Scope) =>
          Layer.build(
            AppNodeBuilder.build(
              LayerNode.group([nodes, WorkflowExecution.node, WorkflowRun.node, SessionInbox.node]),
              [...replacements, Database.node.replace(Database.configured({ path: databasePath }))],
            ),
          ).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.map((context) => ({
              sessions: Context.get(context, Session.Service),
              createLegacySession: (input: Parameters<typeof createLegacySession>[0]) =>
                createLegacySession(input).pipe(Effect.provideContext(context)),
              execution: Context.get(context, SessionExecution.Service),
              restart: Context.get(context, SessionRestart.Service),
              database: Context.get(context, Database.Service),
              locations: Context.get(context, LocationServiceMap.Service),
              llm: Context.get(context, TestLLM.Test),
            })),
          )
        const originalScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(originalScope, Exit.void))
        const original = yield* open(originalScope)
        const bad = yield* original.createLegacySession({
          title: "Bad config restart root",
          location: Location.Ref.make({ directory: AbsolutePath.make(badDirectory.path) }),
          mode: "coding",
          agent: Agent.defaultID,
          model,
        })
        const good = yield* original.createLegacySession({
          title: "Healthy restart root",
          location: Location.Ref.make({ directory: AbsolutePath.make(goodDirectory.path) }),
          mode: "coding",
          agent: Agent.defaultID,
          model,
        })
        yield* original.llm.push(TestLLM.hangAfter())
        const badInput = yield* original.sessions.prompt({ sessionID: bad.id, text: "Bad root original input" })
        yield* awaitWithTimeout(original.llm.wait(1), "Bad root did not start", "10 seconds")
        yield* original.llm.push(TestLLM.hangAfter())
        const goodInput = yield* original.sessions.prompt({ sessionID: good.id, text: "Healthy root original input" })
        yield* awaitWithTimeout(original.llm.wait(2), "Healthy root did not start", "10 seconds")
        const claims = (opened: typeof original) =>
          opened.database.db
            .select({
              id: SessionTable.id,
              time_suspended: SessionTable.time_suspended,
              resume_attempts: SessionTable.resume_attempts,
            })
            .from(SessionTable)
            .orderBy(SessionTable.id)
            .all()
        const before = yield* claims(original)
        expect(before).toHaveLength(2)
        expect(before).toContainEqual({ id: bad.id, time_suspended: expect.any(Number), resume_attempts: 0 })
        expect(before).toContainEqual({ id: good.id, time_suspended: expect.any(Number), resume_attempts: 0 })
        expect(
          yield* SessionInputResult.read(original.database.db, { sessionID: bad.id, inputID: badInput.id }),
        ).toEqual({
          status: "processing",
          sharedInputs: [badInput.id],
        })
        expect(
          yield* SessionInputResult.read(original.database.db, { sessionID: good.id, inputID: goodInput.id }),
        ).toEqual({
          status: "processing",
          sharedInputs: [goodInput.id],
        })
        yield* Scope.close(originalScope, Exit.void)
        yield* Effect.promise(() =>
          Bun.write(`${badDirectory.path}/aigcfroge.json`, JSON.stringify({ username: "{file:username.txt}" })),
        )

        const reopenedScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(reopenedScope, Exit.void))
        const reopened = yield* open(reopenedScope)
        expect(reopened.database).not.toBe(original.database)
        expect(reopened.llm).not.toBe(original.llm)
        expect(yield* claims(reopened)).toEqual(before)
        expect(yield* reopened.llm.requests()).toEqual([])
        const gate = yield* reopened.llm.gate().pipe(Effect.provideService(Scope.Scope, reopenedScope))
        yield* reopened.llm.push(TestLLM.text("Healthy restart completed", "healthy-location-restart"))
        yield* reopened.restart.resumeSuspendedSessions
        yield* awaitWithTimeout(gate.started, "Healthy root recovery was blocked", "10 seconds")
        yield* awaitWithTimeout(
          reopened.execution.awaitIdle(bad.id),
          "Bad root did not settle its boot failure",
          "10 seconds",
        )
        const during = yield* claims(reopened)
        expect(during).toContainEqual({ id: bad.id, time_suspended: null, resume_attempts: 0 })
        expect(during).toContainEqual({ id: good.id, time_suspended: expect.any(Number), resume_attempts: 1 })
        const failed = yield* SessionInputResult.read(reopened.database.db, { sessionID: bad.id, inputID: badInput.id })
        expect(failed).toMatchObject({ status: "failed", error: { type: "unknown", message: "ConfigInvalidError" } })
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        yield* gate.release
        yield* awaitWithTimeout(reopened.execution.awaitIdle(good.id), "Healthy root did not finish", "10 seconds")
        const completed = yield* SessionInputResult.read(reopened.database.db, {
          sessionID: good.id,
          inputID: goodInput.id,
        })
        expect(completed).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: "Healthy restart completed" }] },
        })
        expect(yield* claims(reopened)).toEqual(
          before.map((row) => ({ ...row, time_suspended: null, resume_attempts: 0 })),
        )
        yield* reopened.restart.resumeSuspendedSessions
        yield* reopened.restart.resumeSuspendedSessions
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: bad.id, inputID: badInput.id }),
        ).toEqual(failed)

        const goodContext = yield* reopened.locations
          .contextEffect(good.location)
          .pipe(Effect.provideService(Scope.Scope, reopenedScope))
        yield* Effect.promise(() => Bun.write(`${badDirectory.path}/username.txt`, "repaired-user"))
        const repairedContext = yield* reopened.locations
          .contextEffect(bad.location)
          .pipe(Effect.provideService(Scope.Scope, reopenedScope))
        const config = Context.get(repairedContext, Config.Service)
        expect(Config.latest(yield* config.entries(), "username")).toBe("repaired-user")
        expect(
          yield* reopened.locations
            .contextEffect(good.location)
            .pipe(Effect.provideService(Scope.Scope, reopenedScope)),
        ).toBe(goodContext)
        yield* reopened.restart.resumeSuspendedSessions
        expect(yield* reopened.llm.requests()).toHaveLength(1)
        yield* reopened.llm.push(TestLLM.text("Repaired Location completed", "repaired-location"))
        const fresh = yield* reopened.sessions.prompt({
          sessionID: bad.id,
          text: "Explicit new input after config repair",
        })
        yield* awaitWithTimeout(reopened.llm.wait(2), "Repaired Location did not accept new input", "10 seconds")
        yield* awaitWithTimeout(reopened.execution.awaitIdle(bad.id), "Repaired Location did not finish", "10 seconds")
        const repaired = yield* SessionInputResult.read(reopened.database.db, { sessionID: bad.id, inputID: fresh.id })
        expect(repaired).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: "Repaired Location completed" }] },
        })
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: bad.id, inputID: badInput.id }),
        ).toEqual(failed)
        expect(
          yield* SessionInputResult.read(reopened.database.db, { sessionID: good.id, inputID: goodInput.id }),
        ).toEqual(completed)
        expect(yield* reopened.llm.requests()).toHaveLength(2)
        yield* Scope.close(reopenedScope, Exit.void)

        const coldScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(coldScope, Exit.void))
        const cold = yield* open(coldScope)
        expect(cold.database).not.toBe(reopened.database)
        expect(cold.llm).not.toBe(reopened.llm)
        yield* cold.restart.resumeSuspendedSessions
        yield* cold.restart.resumeSuspendedSessions
        expect(yield* claims(cold)).toEqual(before.map((row) => ({ ...row, time_suspended: null, resume_attempts: 0 })))
        expect(yield* SessionInputResult.read(cold.database.db, { sessionID: bad.id, inputID: badInput.id })).toEqual(
          failed,
        )
        expect(yield* SessionInputResult.read(cold.database.db, { sessionID: good.id, inputID: goodInput.id })).toEqual(
          completed,
        )
        expect(yield* SessionInputResult.read(cold.database.db, { sessionID: bad.id, inputID: fresh.id })).toEqual(
          repaired,
        )
        expect(yield* cold.llm.requests()).toEqual([])
        yield* Scope.close(coldScope, Exit.void)
      }),
    30_000,
  )

  it.live("settles a cancelled queued Task from retained admission and replays its notification once", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.hangAfter())
      yield* seed.append("Keep the child occupied")
      yield* awaitWithTimeout(gate.started, "Child did not start")
      const tasks = yield* SessionTask.Service
      const parentTask = (yield* tasks.append({
        sessionID: seed.parent.id,
        tasks: [{ content: "Queued parent task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!parentTask) return yield* Effect.die(new Error("Parent Task missing"))
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        participantIDs: [seed.participant.id],
        delivery: "queue",
        origin: { deliveryOrigin: "meta", senderParticipantID: seed.participant.id },
      })
      const [receipt] = yield* seed.execution.dispatch({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        prompt: "Queued full task",
        task: {
          parentTaskID: parentTask.id,
          parentTaskRevision: parentTask.revision,
          description: "Queued task",
          background: true,
        },
      })
      if (!receipt) return yield* Effect.die(new Error("Task receipt missing"))
      yield* seed.llm.push(TestLLM.text("Cancellation received", "parent-notice"))
      yield* gate.release
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.execution.wait(receipt)).toEqual({
        status: "cancelled",
        text: "Delegation closed before input delivery",
      })
      const sources = yield* seed.execution.readSources(receipt.delegationID)
      const source = sources.find((source) => source.receipt?.inputID === receipt.inputID)
      if (!source) return yield* Effect.die(new Error("Cancelled admitted source missing"))
      expect(source.parentTaskID).toBe(parentTask.id)
      const read = yield* seed.execution.readResult(source)
      expect(read.available).toBe(true)
      expect(read.text).toContain("Delegation closed before input delivery")
      const settled = (yield* tasks.get(seed.parent.id)).find((task) => task.id === parentTask.id)
      expect(settled).toMatchObject({ status: "cancelled", revision: parentTask.revision + 1 })
      yield* pollWithTimeout(
        seed.sessions
          .context(seed.parent.id)
          .pipe(
            Effect.map((messages) =>
              messages.some((message) => message.type === "assistant" && message.time.completed !== undefined)
                ? true
                : undefined,
            ),
          ),
        "Parent did not consume the cancellation notice",
      )
      yield* SessionExecution.Service.use((execution) => execution.awaitIdle(seed.parent.id))
      const notices = (yield* seed.sessions.context(seed.parent.id)).filter((message) => message.type === "synthetic")
      expect(notices).toHaveLength(1)
      expect(read.text).toBe(notices[0]?.type === "synthetic" ? notices[0].text : undefined)
      expect(notices[0]).toMatchObject({
        metadata: {
          source: "task",
          inputID: receipt.inputID,
          parentTaskID: parentTask.id,
          delegation: {
            delegationID: receipt.delegationID,
            participantID: receipt.participantID,
            turnID: receipt.turnID,
            attempt: 1,
          },
        },
      })
      const notice = notices[0]
      if (notice?.type !== "synthetic") return yield* Effect.die(new Error("Projected cancellation notice is missing"))
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const row = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, notice.id))
        .get()
      if (!row) return yield* Effect.die(new Error("Stored cancellation notice is missing"))
      const reference = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(notice.metadata?.delegation)
      const beforeRead = {
        tasks: yield* tasks.get(seed.parent.id),
        requests: yield* seed.llm.requests(),
        inboxes: yield* Effect.forEach([seed.parent.id, receipt.childSessionID], (sessionID) =>
          seed.sessions.inbox(sessionID),
        ),
        contexts: yield* Effect.forEach([seed.parent.id, receipt.childSessionID], (sessionID) =>
          seed.sessions.context(sessionID),
        ),
        events: yield* Effect.forEach([seed.parent.id, receipt.childSessionID, receipt.delegationID], (aggregateID) =>
          bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
      }
      yield* Effect.gen(function* () {
        yield* database.db
          .update(SessionMessageTable)
          .set({
            data: {
              ...row.data,
              metadata: {
                ...notice.metadata,
                delegation: { ...reference, delegationID: DelegationID.ID.create() },
              },
            },
          })
          .where(eq(SessionMessageTable.id, notice.id))
          .run()
        expect((yield* seed.execution.readResult(source)).available).toBe(false)
      }).pipe(
        Effect.ensuring(
          database.db
            .update(SessionMessageTable)
            .set({ data: row.data })
            .where(eq(SessionMessageTable.id, notice.id))
            .run()
            .pipe(Effect.orDie),
        ),
      )
      expect((yield* seed.execution.readResult(source)).text).toBe(notice.text)
      expect(yield* tasks.get(seed.parent.id)).toEqual(beforeRead.tasks)
      expect(yield* seed.llm.requests()).toEqual(beforeRead.requests)
      expect(
        yield* Effect.forEach([seed.parent.id, receipt.childSessionID], (sessionID) => seed.sessions.inbox(sessionID)),
      ).toEqual(beforeRead.inboxes)
      expect(
        yield* Effect.forEach([seed.parent.id, receipt.childSessionID], (sessionID) =>
          seed.sessions.context(sessionID),
        ),
      ).toEqual(beforeRead.contexts)
      expect(
        yield* Effect.forEach([seed.parent.id, receipt.childSessionID, receipt.delegationID], (aggregateID) =>
          bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
      ).toEqual(beforeRead.events)
      yield* seed.execution.recoverPending
      yield* seed.execution.recoverPending
      expect((yield* tasks.get(seed.parent.id)).find((task) => task.id === parentTask.id)).toEqual(settled)
      expect(
        (yield* seed.sessions.context(seed.parent.id)).filter((message) => message.type === "synthetic"),
      ).toHaveLength(1)
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )

  it.live("settles an interrupted visible input and keeps the queued input pending", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.hangAfter())
      const first = yield* seed.append("Interrupt this task")
      yield* awaitWithTimeout(gate.started, "Task did not start")
      const queued = yield* seed.append("Keep this queued")
      const child = yield* seed.child
      yield* seed.execution.interrupt({ delegationID: seed.delegation.id, participantID: seed.participant.id })
      yield* seed.wait(first.id, "cancelled")
      expect(yield* seed.receipt(queued.id)).toMatchObject({ status: "queued" })
      const database = yield* Database.Service
      expect(yield* SessionInbox.list(database.db, child.id)).toMatchObject([{ payload: { text: "Keep this queued" } }])
      expect(yield* seed.llm.requests()).toHaveLength(1)
      const jobs = yield* Job.Service
      expect((yield* jobs.get(`delegation:${seed.participant.id}`))?.status).toBe("running")
    }),
  )

  it.live("copies parent history into a persistent child fork and adopts the same child on later delivery", () =>
    Effect.gen(function* () {
      const seed = yield* setup("fork")
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      yield* seed.sessions.prompt({ sessionID: seed.parent.id, text: "Parent context", resume: false })
      yield* SessionInbox.promote(database.db, bus, seed.parent.id, "steer")
      yield* seed.llm.push(TestLLM.text("fork result", "fork"), TestLLM.text("next result", "next"))
      const first = yield* seed.append("Child first task")
      yield* seed.wait(first.id, "completed")
      const child = yield* seed.child
      expect(child).toMatchObject({ parentID: seed.parent.id, attended: false, fork: { sessionID: seed.parent.id } })
      expect(child.mode).toBe(seed.parent.mode)
      const second = yield* seed.append("Child next task")
      yield* seed.wait(second.id, "completed")
      expect((yield* seed.child).id).toBe(child.id)
      expect((yield* seed.llm.requests())[0]?.messages).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Parent context" }] },
        { role: "user", content: [{ type: "text", text: "Child first task" }] },
      ])
      expect((yield* seed.sessions.context(seed.parent.id)).filter((message) => message.type === "user")).toHaveLength(
        1,
      )
    }),
  )

  it.live("marks a cold unresolved activation for reconciliation without invoking the model", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({ parentID: seed.parent.id, title: "Cold child", agent: worker, model })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Unverified work",
        delivery: "queue",
        resume: false,
        metadata: { delegation: { delegationID: seed.delegation.id, ...delivery } },
      })
      yield* store.claim(child.id)
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: `delegation:${seed.participant.id}`,
        type: "delegation",
        recovery: seed.recovery(child.id),
        run: Effect.never,
      })
      yield* jobs.background(job.id)
      yield* jobs.cancel(job.id)
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      expect(yield* seed.wait(turn.id, "recovery_required")).toMatchObject({
        attempt: 1,
        errorCode: "session_input_unverified",
      })
      expect(yield* seed.llm.requests()).toHaveLength(0)
      expect(yield* SessionInbox.list(database.db, child.id)).toHaveLength(1)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBeNull()
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      yield* seed.execution.recover(seed.recovery(child.id))
      expect(yield* seed.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("MC10 preserves two cold unresolved inputs and rejects retry without changing durable rows", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Two cold inputs",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const original = yield* Effect.forEach(["queue", "steer"] as const, (intent) =>
        Effect.gen(function* () {
          const turn = yield* seed.service.appendTurn({
            delegationID: seed.delegation.id,
            kind: "task",
            delivery: intent,
            participantIDs: [seed.participant.id],
            origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
          })
          const receipt = yield* seed.receipt(turn.id)
          if (!receipt) return yield* Effect.die(new Error("Cold receipt missing"))
          const id = DelegationExecution.inputID(seed.delegation.id, receipt)
          yield* seed.sessions.prompt({
            sessionID: child.id,
            id,
            text: `Original ${intent} input`,
            delivery: intent,
            resume: false,
            metadata: { delegation: { delegationID: seed.delegation.id, ...receipt } },
          })
          return { id, turnID: turn.id, intent }
        }),
      )
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const pending = yield* SessionInbox.list(database.db, child.id)
      expect(pending).toHaveLength(2)
      expect(pending).toMatchObject(original.map((input) => ({ id: input.id, delivery: input.intent })))
      yield* store.claim(child.id)
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: `delegation:${seed.participant.id}`,
        type: "delegation",
        recovery: seed.recovery(child.id),
        run: Effect.never,
      })
      yield* jobs.background(job.id)
      yield* jobs.cancel(job.id)
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      yield* Effect.forEach(original, (input) =>
        Effect.gen(function* () {
          expect(yield* seed.wait(input.turnID, "recovery_required")).toMatchObject({
            attempt: 1,
            errorCode: "session_input_unverified",
          })
          expect(yield* SessionInputResult.read(database.db, { sessionID: child.id, inputID: input.id })).toEqual({
            status: "pending",
          })
        }),
      )
      expect(yield* SessionInbox.list(database.db, child.id)).toEqual(pending)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBeNull()
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      const snapshot = () =>
        Effect.gen(function* () {
          const tables = yield* database.db.all<{ name: string }>(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
          )
          return yield* Effect.forEach(tables, (table) =>
            database.db
              .all(sql`SELECT * FROM ${sql.identifier(table.name)}`)
              .pipe(
                Effect.map((rows) => ({ table: table.name, rows: rows.map((row) => JSON.stringify(row)).toSorted() })),
              ),
          )
        })
      const before = yield* snapshot()
      yield* Effect.forEach(original, (input) =>
        Effect.gen(function* () {
          const rejected = yield* seed.execution
            .retry({ delegationID: seed.delegation.id, turnID: input.turnID, participantID: seed.participant.id })
            .pipe(Effect.exit)
          if (Exit.isSuccess(rejected)) return yield* Effect.die(new Error("Retry bypassed the other unresolved input"))
          expect(Cause.squash(rejected.cause)).toMatchObject({
            _tag: "Delegation.DelegationInvalidStateError",
            attemptedTransition: "retry",
            reason: "Other participant inputs require reconciliation before retry",
          })
          expect(yield* snapshot()).toEqual(before)
        }),
      )
      expect(yield* SessionInbox.list(database.db, child.id)).toEqual(pending)
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("attributes a steer at a real tool continuation boundary to the shared final result", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        TestLLM.tool("call-read", "read", { path: "missing-file.txt" }),
        TestLLM.text("steered result", "steer"),
      )
      const first = yield* seed.append("Start work")
      yield* awaitWithTimeout(gate.started, "First request missing")
      const steer = yield* seed.append("Adjust current work", "steer")
      yield* gate.release
      const firstResult = yield* seed.wait(first.id, "completed")
      const steerResult = yield* seed.wait(steer.id, "completed")
      expect(firstResult.summary).toBe("steered result")
      expect(steerResult.summary).toBe(firstResult.summary)
      const database = yield* Database.Service
      const child = yield* seed.child
      expect(
        yield* SessionInputResult.read(database.db, {
          sessionID: child.id,
          inputID: DelegationExecution.inputID(seed.delegation.id, firstResult),
        }),
      ).toEqual(
        yield* SessionInputResult.read(database.db, {
          sessionID: child.id,
          inputID: DelegationExecution.inputID(seed.delegation.id, steerResult),
        }),
      )
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )

  it.live("does not rerun model work when a shutdown activation is reconciled", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const context = yield* Effect.context<Layer.Success<typeof layer>>()
      const ownerScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(ownerScope, Exit.void))
      const owner = yield* Layer.buildWithScope(
        Layer.fresh(SessionExecution.layer).pipe(Layer.provide(Layer.succeedContext(context))),
        ownerScope,
      )
      const execution = Context.get(owner, SessionExecution.Service)
      const observer = yield* Layer.build(
        Layer.fresh(DelegationExecution.layer).pipe(
          Layer.provide(Layer.succeedContext(Context.add(context, SessionExecution.Service, execution))),
        ),
      )
      const delegationExecution = Context.get(observer, DelegationExecution.Service)
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.hangAfter())
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      yield* delegationExecution.dispatch({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        prompt: "Work interrupted by shutdown",
      })
      yield* awaitWithTimeout(gate.started, "Shutdown task did not start")
      const child = yield* seed.child
      const database = Context.get(context, Database.Service)
      const jobs = Context.get(context, Job.Service)
      const markers = yield* jobs.pendingBackground
      expect(markers).toHaveLength(1)
      const receipt = yield* seed.receipt(turn.id)
      if (!receipt) return yield* Effect.die(new Error("Receipt missing"))
      // Close the real execution owner while retaining its database and result observer.
      yield* Scope.close(ownerScope, Exit.void)
      yield* execution.awaitIdle(child.id)
      expect(
        yield* SessionInputResult.read(database.db, {
          sessionID: child.id,
          inputID: DelegationExecution.inputID(seed.delegation.id, receipt),
        }),
      ).toEqual({
        status: "processing",
        sharedInputs: [DelegationExecution.inputID(seed.delegation.id, receipt)],
      })
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toEqual(expect.any(Number))
      yield* delegationExecution.recover(seed.recovery(child.id))
      expect(yield* seed.wait(turn.id, "recovery_required")).toMatchObject({ attempt: 1 })
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBeNull()
      expect(yield* seed.llm.requests()).toHaveLength(1)
      expect(yield* seed.sessions.get(child.id)).toBeDefined()
    }),
  )

  it.live("retries a failed delivery with its saved full prompt and a new input identity", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const tasks = yield* SessionTask.Service
      const parentTask = (yield* tasks.append({
        sessionID: seed.parent.id,
        tasks: [{ content: "Retry parent task", status: "in_progress", priority: "medium" }],
      })).at(-1)
      if (!parentTask) return yield* Effect.die(new Error("Parent Task missing"))
      yield* seed.llm.push(
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "First task rejected" }) })),
      )
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const [receipt] = yield* seed.execution.dispatch({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        prompt: "Exact original task text",
        task: {
          parentTaskID: parentTask.id,
          parentTaskRevision: parentTask.revision,
          description: "Retry task",
          background: false,
        },
      })
      if (!receipt) return yield* Effect.die(new Error("Task receipt missing"))
      const failed = yield* seed.wait(turn.id, "failed")
      const child = yield* seed.child
      const execution = yield* SessionExecution.Service
      yield* execution.awaitIdle(child.id)
      yield* seed.llm.push(TestLLM.text("Retry succeeded", "retry"))
      yield* seed.execution.retry({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.participant.id,
      })
      const result = yield* seed.wait(turn.id, "completed")
      const settled = yield* pollWithTimeout(
        tasks
          .get(seed.parent.id)
          .pipe(Effect.map((items) => items.find((item) => item.id === parentTask.id && item.status === "completed"))),
        "Retry did not settle the parent Task",
      )
      expect(settled).toMatchObject({ outputDigest: "Retry succeeded", revision: parentTask.revision + 3 })
      expect(yield* seed.execution.wait(receipt)).toEqual({ status: "failed", text: "First task rejected" })
      expect((yield* tasks.get(seed.parent.id)).find((item) => item.id === parentTask.id)).toEqual(settled)
      expect(result).toMatchObject({ attempt: 2, summary: "Retry succeeded" })
      expect(DelegationExecution.inputID(seed.delegation.id, result)).not.toBe(
        DelegationExecution.inputID(seed.delegation.id, failed),
      )
      expect((yield* seed.sessions.context(child.id)).filter((message) => message.type === "user")).toMatchObject([
        { text: "Exact original task text" },
        { text: "Exact original task text" },
      ])
      expect(
        yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: seed.participant.id }),
      ).toMatchObject({ phase: "active", childSessionID: child.id })
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )

  it.live("recovers an input admitted before the background marker and retries it only once", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Marker gap child",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Task saved before activation",
        delivery: "queue",
        resume: false,
        metadata: { delegation: { delegationID: seed.delegation.id, ...delivery } },
      })
      const jobs = yield* Job.Service
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      expect(yield* seed.wait(turn.id, "recovery_required")).toMatchObject({ attempt: 1 })
      expect(yield* seed.llm.requests()).toHaveLength(0)
      expect(Exit.isFailure(yield* seed.append("New work must not revive unresolved input").pipe(Effect.exit))).toBe(
        true,
      )
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(1)
      expect(yield* seed.llm.requests()).toHaveLength(0)
      yield* seed.llm.push(TestLLM.text("Recovered task result", "recover-retry"))
      yield* seed.execution.retry({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.participant.id,
      })
      expect(yield* seed.wait(turn.id, "completed")).toMatchObject({ attempt: 2, summary: "Recovered task result" })
      expect((yield* seed.sessions.context(child.id)).filter((message) => message.type === "user")).toMatchObject([
        { text: "Task saved before activation" },
      ])
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(0)
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("steers the existing queued input without admitting a duplicate", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        TestLLM.tool("steer-read", "read", { path: "missing-file.txt" }),
        TestLLM.text("Same input steered", "converted"),
      )
      const first = yield* seed.append("Start current task")
      yield* awaitWithTimeout(gate.started, "Current task did not start")
      const queued = yield* seed.append("Convert this queued task")
      yield* seed.execution.steer({
        delegationID: seed.delegation.id,
        turnID: queued.id,
        participantID: seed.participant.id,
      })
      const child = yield* seed.child
      expect(yield* seed.sessions.inbox(child.id)).toMatchObject([
        { delivery: "steer", payload: { text: "Convert this queued task" } },
      ])
      yield* gate.release
      expect((yield* seed.wait(first.id, "completed")).summary).toBe("Same input steered")
      expect((yield* seed.wait(queued.id, "completed")).summary).toBe("Same input steered")
      expect((yield* seed.sessions.context(child.id)).filter((message) => message.type === "user")).toHaveLength(2)
    }),
  )

  it.live("closes admission before cancelling active and pending inputs and releases its observer", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.hangAfter())
      const active = yield* seed.append("Work active during close")
      yield* awaitWithTimeout(gate.started, "Close task did not start")
      const queued = yield* seed.append("Pending work during close")
      const child = yield* seed.child
      yield* seed.execution.close({ delegationID: seed.delegation.id, reason: "Owner closed" })
      expect(yield* seed.receipt(active.id)).toMatchObject({ status: "cancelled" })
      expect(yield* seed.receipt(queued.id)).toMatchObject({
        status: "cancelled",
        summary: "Delegation closed before input delivery",
      })
      expect(yield* seed.service.get(seed.delegation.id)).toMatchObject({ status: "closing" })
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(0)
      expect(yield* seed.sessions.get(child.id)).toBeDefined()
      const jobs = yield* Job.Service
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      const rejected = yield* seed.append("Reject after close").pipe(Effect.exit)
      expect(Exit.isFailure(rejected)).toBe(true)
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("settles an input that became visible while the previous observer awaited idle", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.text("First boundary result", "boundary-1"))
      const first = yield* seed.append("First boundary task")
      yield* awaitWithTimeout(gate.started, "First boundary task did not start")
      const child = yield* seed.child
      yield* seed.llm.push(TestLLM.text("Second boundary result", "boundary-2"))
      const second = yield* seed.append("Second boundary task")
      yield* gate.release
      expect((yield* seed.wait(first.id, "completed")).summary).toBe("First boundary result")
      expect((yield* seed.wait(second.id, "completed")).summary).toBe("Second boundary result")
      const execution = yield* SessionExecution.Service
      yield* execution.awaitIdle(child.id)
      const jobs = yield* Job.Service
      yield* pollWithTimeout(
        jobs.pendingBackground.pipe(Effect.map((items) => (items.length === 0 ? true : undefined))),
        "Observer marker was not released",
      )
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )

  it.live("reconciles missing child state without resuming the model", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({ parentID: seed.parent.id, title: "Lost child", agent: worker, model })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Lost child task",
        resume: false,
        metadata: { delegation: { delegationID: seed.delegation.id, ...delivery } },
      })
      yield* seed.sessions.remove(child.id)
      yield* seed.execution.recover(seed.recovery(child.id))
      expect(yield* seed.wait(turn.id, "recovery_required")).toMatchObject({ errorCode: "session_input_unverified" })
      expect(yield* seed.llm.requests()).toHaveLength(0)
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.wait(turn.id, "cancelled")).toMatchObject({ attempt: 1 })
    }),
  )

  it.live("closes its observer without clearing a moved child input or execution claim", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Moved participant",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const destination = yield* tmpdirScoped()
      yield* seed.sessions.move({ sessionID: child.id, directory: AbsolutePath.make(destination.path) })
      yield* SessionExecution.Service.use((execution) => execution.awaitIdle(child.id))
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Retain work at destination",
        resume: false,
        metadata: { delegation: { delegationID: seed.delegation.id, ...delivery } },
      })
      const store = yield* SessionStore.Service
      yield* store.claim(child.id)
      const jobs = yield* Job.Service
      const observer = yield* jobs.start({
        id: `delegation:${seed.participant.id}`,
        type: "delegation",
        recovery: seed.recovery(child.id),
        notificationID: SessionMessage.ID.create(),
        run: Effect.never,
      })
      yield* jobs.background(observer.id)
      yield* seed.execution.recover(seed.recovery(child.id))
      const database = yield* Database.Service
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toEqual(expect.any(Number))
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.wait(turn.id, "cancelled")).toMatchObject({ attempt: 1 })
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(1)
      expect((yield* seed.sessions.get(child.id)).location.directory).toBe(AbsolutePath.make(destination.path))
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toEqual(expect.any(Number))
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      expect(yield* seed.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("rejects mismatched input provenance during cold reconciliation and explicit retry", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Conflicting input",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Unrelated input text",
        resume: false,
      })
      yield* seed.execution.recover(seed.recovery(child.id))
      expect(yield* seed.wait(turn.id, "recovery_required")).toMatchObject({ attempt: 1 })
      expect(
        Exit.isFailure(
          yield* seed.execution
            .retry({ delegationID: seed.delegation.id, turnID: turn.id, participantID: seed.participant.id })
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(1)
      expect(yield* seed.llm.requests()).toHaveLength(0)
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.wait(turn.id, "cancelled")).toMatchObject({ attempt: 1 })
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(1)
    }),
  )

  it.live("keeps admission closed when an unreconciled input has conflicting provenance", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Unreconciled conflicting input",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Unrelated input retained for its owner",
        resume: false,
      })
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(
        Exit.isFailure(
          yield* seed.service
            .addParticipant({
              delegationID: seed.delegation.id,
              provider: "internal",
              target: "general",
              role: "implementer",
              context: "fresh",
            })
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(Exit.isFailure(yield* seed.append("Work after closure").pipe(Effect.exit))).toBe(true)
      expect((yield* seed.service.foldState(seed.delegation.id))?.delegation.status).toBe("closing")
      expect(yield* seed.wait(turn.id, "cancelled")).toMatchObject({ attempt: 1 })
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(1)
      expect(yield* seed.llm.requests()).toHaveLength(0)
    }),
  )

  it.live("MC07 fanout compensates its committed pending input after the second admission fails", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: Agent.ID.make("build"),
        role: "implementer",
        context: "fresh",
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const admitted = yield* seed.service.foldState(seed.delegation.id)
      if (!admitted) return yield* Effect.die(new Error("MC07 fanout admission missing"))
      const deliveries = [...admitted.deliveries.values()]
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const jobs = yield* Job.Service
      const secondChildID = Session.ID.make(`ses_delegation_${second.id}`)
      const failure = new Error("MC07 fanout second InboxEnqueued projector failed")
      const boundary: { parentDeliveries: number; first: SessionInbox.Info | undefined; second: unknown }[] = []
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        Effect.gen(function* () {
          if (event.data.sessionID !== secondChildID) return
          boundary.push({
            parentDeliveries:
              (yield* seed.service.foldState(seed.delegation.id).pipe(Effect.orDie))?.deliveries.size ?? 0,
            second: event.data,
            first: yield* SessionInbox.find(
              database.db,
              DelegationExecution.inputID(seed.delegation.id, deliveries[0]),
            ),
          })
          return yield* Effect.die(failure)
        }),
      )
      const exit = yield* seed.execution
        .dispatch({ delegationID: seed.delegation.id, turnID: turn.id, prompt: "Independent fanout contribution" })
        .pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("MC07 second admission unexpectedly succeeded"))
      expect(Cause.squash(exit.cause)).toBe(failure)
      const first = yield* seed.child
      const receipts = deliveries.map((delivery) => ({
        delegationID: seed.delegation.id,
        ...delivery,
        childSessionID: delivery.participantID === seed.participant.id ? first.id : secondChildID,
        inputID: DelegationExecution.inputID(seed.delegation.id, delivery),
      }))
      const state = yield* seed.service.foldState(seed.delegation.id)
      const results = yield* Effect.forEach(receipts, (receipt) =>
        SessionInputResult.read(database.db, { sessionID: receipt.childSessionID, inputID: receipt.inputID }),
      )
      const pending = yield* jobs.pendingBackground
      const evidence = {
        scenario: "pending",
        error: String(exit.cause),
        boundary,
        receipts,
        deliveries: [...(state?.deliveries.values() ?? [])],
        inboxes: yield* Effect.forEach(receipts, (receipt) => seed.sessions.inbox(receipt.childSessionID)),
        results,
        jobs: pending,
        parentInbox: yield* seed.sessions.inbox(seed.parent.id),
        claims: yield* Effect.forEach(receipts, (receipt) =>
          database.db.select().from(SessionTable).where(eq(SessionTable.id, receipt.childSessionID)).get(),
        ),
      }
      yield* Effect.sync(() => process.stdout.write(`MC07_FANOUT_EVIDENCE ${JSON.stringify(evidence)}\n`))
      expect(boundary).toMatchObject([
        {
          parentDeliveries: 2,
          second: {
            sessionID: secondChildID,
            inboxID: receipts[1].inputID,
            item: {
              payload: {
                metadata: {
                  delegation: {
                    delegationID: seed.delegation.id,
                    turnID: turn.id,
                    participantID: second.id,
                    deliveryOrigin: "parent-task",
                    senderParticipantID: seed.participant.id,
                    attempt: 1,
                  },
                },
              },
            },
          },
          first: {
            id: receipts[0].inputID,
            sessionID: first.id,
            payload: {
              metadata: {
                delegation: {
                  delegationID: seed.delegation.id,
                  turnID: turn.id,
                  participantID: seed.participant.id,
                  deliveryOrigin: "parent-task",
                  senderParticipantID: seed.participant.id,
                  attempt: 1,
                },
              },
            },
          },
        },
      ])
      expect(receipts.map((receipt) => receipt.inputID)).toHaveLength(
        new Set(receipts.map((receipt) => receipt.inputID)).size,
      )
      expect([...(state?.deliveries.values() ?? [])]).toMatchObject([
        { participantID: seed.participant.id, status: "cancelled", attempt: 1 },
        { participantID: second.id, status: "failed", attempt: 1, summary: expect.stringContaining(failure.message) },
      ])
      expect(results).toEqual([{ status: "missing" }, { status: "missing" }])
      expect(yield* seed.sessions.inbox(first.id)).toEqual([])
      expect(yield* seed.sessions.inbox(secondChildID)).toEqual([])
      expect(
        yield* pollWithTimeout(
          jobs.pendingBackground.pipe(Effect.map((items) => (items.length === 0 ? items : undefined))),
          "MC07 fanout result observer did not settle",
        ),
      ).toEqual([])
      expect((yield* jobs.get(`delegation:${seed.participant.id}`))?.status).not.toBe("running")
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      expect(yield* seed.llm.requests()).toEqual([])
      const history = yield* bus.log({ aggregateID: first.id }).pipe(Stream.runCollect)
      expect(
        history.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.InboxEnqueued.type),
      ).toHaveLength(1)
      expect(
        history.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.InboxCancelled.type),
      ).toHaveLength(1)
      expect(yield* seed.execution.wait(receipts[0])).toMatchObject({ status: "cancelled" })
      expect(yield* seed.service.reconcileResume({ delegationID: seed.delegation.id })).toBe(0)
      expect(yield* seed.service.foldState(seed.delegation.id)).toEqual(state)
      yield* seed.execution.close({ delegationID: seed.delegation.id, reason: "Explicit fanout reconciliation" })
      expect((yield* seed.service.foldState(seed.delegation.id))?.delegation.status).toBe("closing")
      expect(yield* seed.sessions.get(first.id)).toMatchObject({ parentID: seed.parent.id })
      expect(yield* seed.sessions.get(secondChildID)).toMatchObject({ parentID: seed.parent.id })
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, first.id)).get())?.time_suspended,
      ).toBeNull()
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, secondChildID)).get())
          ?.time_suspended,
      ).toBeNull()
      const reconciled = {
        scenario: "pending-reconciled",
        delegation: yield* seed.service.foldState(seed.delegation.id).pipe(Effect.map((state) => state?.delegation)),
        deliveries: yield* seed.service
          .foldState(seed.delegation.id)
          .pipe(Effect.map((state) => [...(state?.deliveries.values() ?? [])])),
        inboxes: yield* Effect.forEach(receipts, (receipt) => seed.sessions.inbox(receipt.childSessionID)),
        jobs: yield* jobs.pendingBackground,
        parentInbox: yield* seed.sessions.inbox(seed.parent.id),
        claims: yield* Effect.forEach(receipts, (receipt) =>
          database.db
            .select({ id: SessionTable.id, claim: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
            .from(SessionTable)
            .where(eq(SessionTable.id, receipt.childSessionID))
            .get(),
        ),
      }
      yield* Effect.sync(() => process.stdout.write(`MC07_FANOUT_EVIDENCE ${JSON.stringify(reconciled)}\n`))
    }),
  )

  it.live("MC07 fanout retains the first complete result when the second admission fails", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: Agent.ID.make("build"),
        role: "implementer",
        context: "fresh",
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("MC07 first delivery missing"))
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const runs = yield* SessionExecution.Service
      const jobs = yield* Job.Service
      const secondChildID = Session.ID.make(`ses_delegation_${second.id}`)
      const failure = new Error("MC07 fanout second admission failed after the first result")
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        event.data.sessionID === secondChildID ? Effect.die(failure) : Effect.void,
      )
      const reached = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const locations = yield* LocationServiceMap.Service
      const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(seed.parent.location)))
      // Pause before the second transaction so the first Session can commit its real result.
      yield* hooks.register("session", "prompt", (event) =>
        Effect.gen(function* () {
          if (event.sessionID !== secondChildID) return
          yield* Deferred.succeed(reached, undefined)
          yield* awaitWithTimeout(
            Deferred.await(release),
            "MC07 second publication was not released",
            "10 seconds",
          ).pipe(Effect.orDie)
        }),
      )
      const scope = yield* Effect.scope
      const dispatched = yield* seed.execution
        .dispatch({ delegationID: seed.delegation.id, turnID: turn.id, prompt: "Keep the complete independent result" })
        .pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
      yield* awaitWithTimeout(Deferred.await(reached), "MC07 second publication was not reached", "10 seconds")
      const first = yield* seed.child
      const receipt = {
        delegationID: seed.delegation.id,
        ...delivery,
        childSessionID: first.id,
        inputID: DelegationExecution.inputID(seed.delegation.id, delivery),
      }
      const full = "MC07 first result\n" + "🙂complete independently\n".repeat(260)
      yield* seed.llm.push(TestLLM.text(full, "mc07-first-complete"))
      yield* awaitWithTimeout(runs.resume(first.id), "MC07 first Session did not complete", "10 seconds")
      yield* runs.awaitIdle(first.id)
      const completed = yield* SessionInputResult.read(database.db, { sessionID: first.id, inputID: receipt.inputID })
      expect(completed).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: full }] } })
      const context = yield* seed.sessions.context(first.id)
      yield* Deferred.succeed(release, undefined)
      const exit = yield* awaitWithTimeout(
        Fiber.join(dispatched),
        "MC07 dispatch did not return its failure",
        "10 seconds",
      )
      if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("MC07 second admission unexpectedly succeeded"))
      expect(Cause.squash(exit.cause)).toBe(failure)
      const state = yield* seed.service.foldState(seed.delegation.id)
      const evidence = {
        scenario: "completed",
        error: String(exit.cause),
        receipt,
        beforeSecondPublication: completed,
        afterFailure: yield* SessionInputResult.read(database.db, { sessionID: first.id, inputID: receipt.inputID }),
        deliveries: [...(state?.deliveries.values() ?? [])],
        firstInbox: yield* seed.sessions.inbox(first.id),
        secondInbox: yield* seed.sessions.inbox(secondChildID),
        jobs: yield* jobs.pendingBackground,
        parentInbox: yield* seed.sessions.inbox(seed.parent.id),
      }
      yield* Effect.sync(() => process.stdout.write(`MC07_FANOUT_EVIDENCE ${JSON.stringify(evidence)}\n`))
      expect([...(state?.deliveries.values() ?? [])]).toMatchObject([
        {
          participantID: seed.participant.id,
          status: "completed",
          attempt: 1,
          summary: expect.stringContaining("MC07 first result"),
        },
        { participantID: second.id, status: "failed", attempt: 1, summary: expect.stringContaining(failure.message) },
      ])
      expect(yield* seed.execution.wait(receipt)).toEqual({ status: "completed", text: full })
      expect(yield* SessionInputResult.read(database.db, { sessionID: first.id, inputID: receipt.inputID })).toEqual(
        completed,
      )
      expect(yield* seed.sessions.context(first.id)).toEqual(context)
      const history = yield* bus.log({ aggregateID: first.id }).pipe(Stream.runCollect)
      expect(
        history.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.InboxEnqueued.type),
      ).toHaveLength(1)
      expect(
        history.filter((event) => !Bus.isSynced(event) && event.type === SessionEvent.InboxCancelled.type),
      ).toEqual([])
      yield* pollWithTimeout(
        jobs.pendingBackground.pipe(Effect.map((items) => (items.length === 0 ? true : undefined))),
        "MC07 completed observer did not settle",
      )
      expect(yield* seed.llm.requests()).toHaveLength(1)
      const retained = yield* seed.service.foldState(seed.delegation.id)
      expect(yield* seed.service.reconcileResume({ delegationID: seed.delegation.id })).toBe(0)
      expect(yield* seed.service.foldState(seed.delegation.id)).toEqual(retained)
      yield* seed.execution.close({ delegationID: seed.delegation.id, reason: "Consume and close partial fanout" })
      expect(yield* seed.execution.wait(receipt)).toEqual({ status: "completed", text: full })
      expect(yield* seed.sessions.context(first.id)).toEqual(context)
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* seed.llm.requests()).toHaveLength(1)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, first.id)).get())?.time_suspended,
      ).toBeNull()
    }),
  )

  it.live("MC07 fanout compensates only its new input while an active child keeps its old Job and foreign input", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.text("Existing complete result retained", "mc07-existing-work"))
      const previous = yield* seed.append("Existing work owns this Session")
      yield* awaitWithTimeout(gate.started, "MC07 existing child did not become active")
      const child = yield* seed.child
      const beforeDelivery = yield* seed.wait(previous.id, "running")
      const receipt = {
        delegationID: seed.delegation.id,
        ...beforeDelivery,
        childSessionID: child.id,
        inputID: DelegationExecution.inputID(seed.delegation.id, beforeDelivery),
      }
      const jobs = yield* Job.Service
      const database = yield* Database.Service
      const runs = yield* SessionExecution.Service
      const bus = yield* Bus.Service
      const job = yield* jobs.get(`delegation:${seed.participant.id}`)
      const markers = yield* jobs.pendingBackground
      const claim = (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())
        ?.time_suspended
      expect(claim).toEqual(expect.any(Number))
      expect(job?.status).toBe("running")
      const foreign = yield* seed.sessions.prompt({
        sessionID: child.id,
        text: "Unrelated source retains its pending input",
        delivery: "queue",
        resume: false,
      })
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: Agent.ID.make("build"),
        role: "implementer",
        context: "fresh",
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const secondChildID = Session.ID.make(`ses_delegation_${second.id}`)
      const failure = new Error("MC07 fanout second admission failed beside active work")
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        event.data.sessionID === secondChildID ? Effect.die(failure) : Effect.void,
      )
      const exit = yield* seed.execution
        .dispatch({
          delegationID: seed.delegation.id,
          turnID: turn.id,
          prompt: "Compensate only this new fanout input",
        })
        .pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("MC07 second admission unexpectedly succeeded"))
      expect(Cause.squash(exit.cause)).toBe(failure)
      const state = yield* seed.service.foldState(seed.delegation.id)
      const deliveries = [...(state?.deliveries.values() ?? [])].filter((delivery) => delivery.turnID === turn.id)
      const evidence = {
        scenario: "shared-active",
        error: String(exit.cause),
        receipt,
        newInputs: deliveries.map((delivery) => DelegationExecution.inputID(seed.delegation.id, delivery)),
        deliveries: [...(state?.deliveries.values() ?? [])],
        beforeJob: job,
        afterJob: yield* jobs.get(`delegation:${seed.participant.id}`),
        jobs: yield* jobs.pendingBackground,
        firstInbox: yield* seed.sessions.inbox(child.id),
        foreign,
        previousResult: yield* SessionInputResult.read(database.db, { sessionID: child.id, inputID: receipt.inputID }),
        claim,
        afterClaim: (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())
          ?.time_suspended,
      }
      yield* Effect.sync(() => process.stdout.write(`MC07_FANOUT_EVIDENCE ${JSON.stringify(evidence)}\n`))
      expect(deliveries).toMatchObject([
        { participantID: seed.participant.id, status: "cancelled", attempt: 1 },
        { participantID: second.id, status: "failed", attempt: 1, summary: expect.stringContaining(failure.message) },
      ])
      expect(yield* seed.sessions.inbox(child.id)).toEqual([foreign])
      expect(yield* seed.receipt(previous.id)).toEqual(beforeDelivery)
      expect(yield* jobs.get(`delegation:${seed.participant.id}`)).toEqual(job)
      expect(yield* jobs.pendingBackground).toEqual(markers)
      expect(yield* runs.isActive(child.id)).toBe(true)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBe(claim)
      expect(yield* SessionInputResult.read(database.db, { sessionID: child.id, inputID: receipt.inputID })).toEqual({
        status: "processing",
        sharedInputs: [receipt.inputID],
      })
      expect(yield* seed.sessions.inbox(secondChildID)).toEqual([])
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      // The foreign owner cleans its own input only after compensation preservation has been observed.
      yield* seed.sessions.cancelInbox({ sessionID: child.id, inboxID: foreign.id })
      yield* gate.release
      yield* seed.wait(previous.id, "completed")
      yield* runs.awaitIdle(child.id)
      expect(yield* seed.execution.wait(receipt)).toEqual({
        status: "completed",
        text: "Existing complete result retained",
      })
      yield* pollWithTimeout(
        jobs.pendingBackground.pipe(Effect.map((items) => (items.length === 0 ? true : undefined))),
        "MC07 shared observer did not settle its original work",
      )
      yield* seed.execution.close({ delegationID: seed.delegation.id, reason: "Original work consumed" })
      expect(yield* seed.execution.wait(receipt)).toEqual({
        status: "completed",
        text: "Existing complete result retained",
      })
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* seed.llm.requests()).toHaveLength(1)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBeNull()
    }),
  )

  it.live("MC07 fanout preparation failure retains its created child and closes it explicitly", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const second = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: worker,
        role: "reviewer",
        context: "fresh",
      })
      const existing = yield* createLegacySession({
        id: Session.ID.make(`ses_delegation_${second.id}`),
        title: "Conflicting root Session",
        location: seed.parent.location,
        model,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id, second.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      expect(
        Exit.isFailure(
          yield* seed.execution
            .dispatch({ delegationID: seed.delegation.id, turnID: turn.id, prompt: "Do not partly admit this fanout" })
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      const database = yield* Database.Service
      expect(yield* database.db.select().from(SessionInboxTable).all()).toHaveLength(0)
      const jobs = yield* Job.Service
      expect(yield* jobs.pendingBackground).toHaveLength(0)
      expect(yield* seed.llm.requests()).toHaveLength(0)
      const child = yield* seed.child
      expect(child).toMatchObject({ parentID: seed.parent.id, agent: worker })
      expect(
        yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: seed.participant.id }),
      ).toMatchObject({ childSessionID: child.id })
      expect(
        (yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: second.id }))
          ?.childSessionID,
      ).toBeUndefined()
      expect(yield* seed.sessions.get(existing.id)).toEqual(existing)
      yield* seed.execution.close({
        delegationID: seed.delegation.id,
        reason: "Preparation failure reconciled by owner",
      })
      const closed = yield* seed.service.foldState(seed.delegation.id)
      expect(closed?.delegation.status).toBe("closing")
      expect([...(closed?.deliveries.values() ?? [])]).toMatchObject([
        { participantID: seed.participant.id, status: "cancelled", attempt: 1 },
        { participantID: second.id, status: "cancelled", attempt: 1 },
      ])
      expect(yield* seed.sessions.get(child.id)).toMatchObject({ parentID: seed.parent.id })
      expect(yield* seed.sessions.get(existing.id)).toEqual(existing)
      expect(yield* seed.sessions.inbox(child.id)).toEqual([])
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child.id)).get())?.time_suspended,
      ).toBeNull()
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )
  it.live("cancels a verified recovered inbox on close without deleting its child", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const child = yield* createLegacySession({
        parentID: seed.parent.id,
        title: "Close recovered input",
        agent: worker,
        model,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.participant.id,
        childSessionID: child.id,
      })
      const turn = yield* seed.service.appendTurn({
        delegationID: seed.delegation.id,
        kind: "task",
        delivery: "queue",
        participantIDs: [seed.participant.id],
        origin: { deliveryOrigin: "parent-task", senderParticipantID: seed.participant.id },
      })
      const delivery = yield* seed.receipt(turn.id)
      if (!delivery) return yield* Effect.die(new Error("Receipt missing"))
      yield* seed.sessions.prompt({
        sessionID: child.id,
        id: DelegationExecution.inputID(seed.delegation.id, delivery),
        text: "Do not resume after close",
        resume: false,
        metadata: { delegation: { delegationID: seed.delegation.id, ...delivery } },
      })
      yield* seed.execution.recoverPending
      expect(yield* seed.wait(turn.id, "recovery_required")).toBeDefined()
      yield* seed.execution.close({ delegationID: seed.delegation.id })
      expect(yield* seed.wait(turn.id, "cancelled")).toMatchObject({ attempt: 1 })
      expect(yield* seed.sessions.inbox(child.id)).toHaveLength(0)
      expect(yield* seed.sessions.get(child.id)).toBeDefined()
      expect(yield* seed.llm.requests()).toHaveLength(0)
    }),
  )
})
