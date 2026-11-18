import { describe, expect } from "bun:test"
import { LanguageModel } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { Permission } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginSupervisor } from "@aigcfroge/core/plugin/supervisor"
import { AgentPlugin } from "@aigcfroge/core/plugin/agent"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionContext } from "@aigcfroge/core/session/context"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Tool } from "@aigcfroge/core/tool"
import { SessionShareTool } from "@aigcfroge/core/tool/plugin/share"
import { TaskTool } from "@aigcfroge/core/tool/plugin/task"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { ExecutorBinding } from "@aigcfroge/schema/session"
import { Money } from "@aigcfroge/schema/money"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { makeGlobalNode, makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { registerToolPlugin, toolIdentity } from "./lib/tool"
import { agentHost } from "./plugin/host"

class ExecutionCalls extends Context.Service<
  ExecutionCalls,
  {
    readonly wakes: Array<{
      sessionID: Session.ID
      inbox: SessionInbox.Info[]
      context: SessionMessage.Info[]
    }>
    readonly resumes: Session.ID[]
  }
>()("test/ShareExecutionCalls") {}

const executionCalls = makeGlobalNode({
  service: ExecutionCalls,
  layer: Layer.sync(ExecutionCalls, () => ({ wakes: [], resumes: [] })),
  deps: [],
})
const execution = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const calls = yield* ExecutionCalls
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: (sessionID) => Effect.sync(() => calls.resumes.push(sessionID)).pipe(Effect.asVoid),
        wake: (sessionID) =>
          Effect.gen(function* () {
            calls.wakes.push({
              sessionID,
              inbox: yield* SessionInbox.list(database.db, sessionID),
              context: yield* store.context(sessionID).pipe(Effect.orDie),
            })
          }),
        interrupt: () => Effect.succeed(false),
        awaitIdle: () => Effect.void,
      })
    }),
  ),
  deps: [executionCalls, Database.node, SessionStore.node],
})
const sharePlugins = makeLocationNode({
  name: "test/share-plugins",
  layer: Layer.effectDiscard(Effect.gen(function* () {
    yield* registerToolPlugin(AgentPlugin.Plugin, { agent: agentHost(yield* Agent.Service) })
    yield* registerToolPlugin(SessionShareTool.Plugin)
  })),
  deps: [Session.node, SessionShareV2.node, Permission.node, Tool.node, FSUtil.node, MetaAgentService.node, Agent.node],
})
const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Session.node,
  SessionShareV2.node,
  SessionExecution.node,
  ApprovalPresence.node,
  LocationServiceMap.node,
  MetaAgentService.node,
])
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, executionCalls]), [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: true })),
    offlineModels,
    SessionExecution.node.replace(execution),
    PluginSupervisor.node.replace(sharePlugins),
  ]),
)
const productionIt = testEffect(
  AppNodeBuilder.build(nodes, [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: true })),
    offlineModels,
    LayerNodePlatform.llmClient.replace(TestLLM.testLayer({ fallback: TestLLM.text("received", "share-reply") })),
    SessionRunnerModel.node.replace(
      Layer.succeed(SessionRunnerModel.Service, {
        resolve: () =>
          Effect.succeed(
            SessionRunnerModel.resolved(
              LanguageModel.make({ id: "share", provider: "test", route: OpenAIChat.route }),
              {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              },
            ),
          ),
      }),
    ),
  ]),
)
const volatileIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, executionCalls]), [
    Global.node.replace(tempGlobalLayer),
    Bus.node.replace(Bus.configured({ persist: false })),
    offlineModels,
    SessionExecution.node.replace(execution),
    PluginSupervisor.node.replace(sharePlugins),
  ]),
)
const model = Model.Ref.make({ id: Model.ID.make("share"), providerID: Provider.ID.make("test") })
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const setup = (
  effect: "allow" | "ask" | "builtin" = "allow",
  targetLocation?: Location.Ref,
  callerAgent = Agent.ID.make("meta"),
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
    const sessions = yield* Session.Service
    const locations = yield* LocationServiceMap.Service
    const local = locations.get(location)
    yield* useOfflineCatalog([{ info: Provider.Info.make({ ...Provider.Info.empty(model.providerID), activation: "enabled",
      package: "@aigcfroge/ai/providers/openai/responses" }), models: [Model.Info.make(Model.Info.default(model.providerID, model.id))] }])
      .pipe(Effect.provide(local))
    if (targetLocation) yield* useOfflineCatalog([{ info: Provider.Info.make({ ...Provider.Info.empty(model.providerID), activation: "enabled",
      package: "@aigcfroge/ai/providers/openai/responses" }), models: [Model.Info.make(Model.Info.default(model.providerID, model.id))] }])
      .pipe(Effect.provide(locations.get(targetLocation)))
    const caller = yield* sessions.create({ location, agent: callerAgent, model, title: "caller" })
    const source = yield* sessions.create({ location, model, title: "source" })
    const target = yield* sessions.create({ location: targetLocation ?? location, model, title: "target" })
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(local))
    const agents = yield* Agent.Service.pipe(Effect.provide(local))
    if (effect !== "builtin")
      yield* agents.transform((editor) =>
        editor.update(callerAgent, (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect }]
        }),
      )
    const registry = yield* Tool.Service.pipe(Effect.provide(local))
    const snapshot = yield* registry.snapshot()
    const permission = yield* Permission.Service.pipe(Effect.provide(local))
    return {
      sessions,
      source,
      target,
      caller,
      agents,
      permission,
      snapshot,
      execute: (
        input: typeof SessionShareTool.Input.Type,
        sessionID = caller.id,
        id = "call-share",
        agent = callerAgent,
      ) =>
        snapshot.execute({
          sessionID,
          ...toolIdentity,
          agent,
          call: { type: "tool-call", id, name: SessionShareTool.name, input },
        }),
    }
  })

const promote = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    yield* SessionInbox.promote(database.db, bus, sessionID, "input")
  })

const controlledChild = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  agent = Agent.defaultID,
  toolCallID = "spawn-share-worker",
) {
  const bus = yield* Bus.Service
  const assistantMessageID = SessionMessage.ID.create()
  const source = { sessionID: fixture.caller.id, assistantMessageID, id: toolCallID }
  yield* bus.publish(SessionEvent.Step.Started, {
    sessionID: fixture.caller.id,
    assistantMessageID,
    agent: Agent.ID.make("meta"),
    model,
    started: 0,
  })
  yield* bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: "subagent" })
  yield* bus.publish(SessionEvent.Tool.Called, { ...source, input: { agent }, executed: false })
  const child = yield* fixture.sessions.create({
    parentID: fixture.caller.id,
    agent,
    model,
    executor: new ExecutorBinding({ agent, model, source: "tool" }),
    source: new SessionSchema.SubagentControllerSource({
      kind: "subagent",
      assistantMessageID,
      toolCallID: source.id,
    }),
  })
  yield* bus.publish(SessionEvent.Tool.Success, { ...source, content: [{ type: "text", text: child.id }], executed: false })
  yield* bus.publish(SessionEvent.Step.Ended, {
    sessionID: fixture.caller.id,
    assistantMessageID,
    finish: "stop",
    cost: Money.USD.zero,
    tokens,
  })
  return child
})

const assistant = (sessionID: Session.ID, texts: readonly string[]) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const assistantMessageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: toolIdentity.agent,
      model,
      started: 0,
    })
    yield* Effect.forEach(texts, (text, ordinal) =>
      Effect.gen(function* () {
        yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal })
        yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal, text })
      }),
    )
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.zero,
      tokens,
    })
  })

const savedJudge = Effect.fnUntraced(function* (
  sessionID: Session.ID,
  outcome?: "completed" | "partial" | "empty" | "failed" | "cancelled" | "unavailable",
  options: { name?: string; completed?: boolean; owner?: Session.ID; bounded?: boolean } = {},
) {
  const bus = yield* Bus.Service
  const messageID = SessionMessage.ID.create()
  const source = { type: "tool" as const, messageID, id: "saved-judge" }
  const worker = {
    taskID: "worker-result",
    source,
    requested: model,
    executor: new ExecutorBinding({ agent: toolIdentity.agent, model, source: "tool" }),
    runtime: { provider: "actual-share-provider", id: "actual-share-model", route: "openai-chat" },
    delegationID: DelegationID.ID.make("dlg_share_keeper"),
    participantID: ParticipantID.make("par_share_keeper"),
    turnID: TurnID.make("trn_share_keeper"),
    status: "completed" as const,
    text: "Original exact Judge result 🚀\nSecond evidence line.",
    completion: { assistantID: SessionMessage.ID.create(), model, finish: "stop" as const, needsContinuation: false },
  }
  const output: typeof TaskTool.JudgeOutput.Type = {
    kind: "judge",
    sessionID: options.owner ?? sessionID,
    parentTaskID: "aggregate-result",
    source,
    input: { text: "Original complete Judge input" },
    arbitration: "none",
    status: "completed",
    taskSettlement: "updated",
    workers: [worker],
    ...(outcome
      ? {
          summary: new TaskTool.JudgeEnhancement({
            requested: model,
            status: outcome,
            ...(outcome === "unavailable"
              ? { error: "Configured summary model is unavailable" }
              : {
                  result: {
                    ...worker,
                    taskID: "summary-result",
                    status: outcome === "failed" || outcome === "cancelled" ? outcome : "completed",
                    text: outcome === "empty" ? "" : "Exact saved summary 🚀\nSecond summary line.",
                    completion: { ...worker.completion, finish: outcome === "partial" ? "length" : "stop" },
                  },
                }),
          }),
        }
      : {}),
  }
  const text = JSON.stringify(Schema.encodeSync(Schema.toCodecJson(TaskTool.JudgeOutput))(output))
  const directory = options.bounded ? yield* tmpdirScoped() : undefined
  if (directory) yield* Effect.promise(() => Bun.write(`${directory.path}/judge-output.json`, text))
  const metadata = directory ? { truncated: true, outputPath: `${directory.path}/judge-output.json` } : undefined
  yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID: messageID,
    agent: toolIdentity.agent,
    model,
    started: 0,
  })
  yield* bus.publish(SessionEvent.Tool.Input.Started, {
    sessionID,
    assistantMessageID: messageID,
    id: source.id,
    name: options.name ?? TaskTool.name,
  })
  yield* bus.publish(SessionEvent.Tool.Called, {
    sessionID,
    assistantMessageID: messageID,
    id: source.id,
    input: {},
    executed: false,
  })
  if (options.completed !== false)
    yield* bus.publish(SessionEvent.Tool.Success, {
      sessionID,
      assistantMessageID: messageID,
      id: source.id,
      content: [{ type: "text", text: directory ? "[Full Judge output saved]" : text }],
      metadata,
      executed: false,
    })
  yield* bus.publish(SessionEvent.Step.Ended, {
    sessionID,
    assistantMessageID: messageID,
    finish: "stop",
    cost: Money.USD.zero,
    tokens,
  })
  return { output, text, locator: new SessionShareV2.ResultSource({ messageID, id: source.id }) }
})

it.live("MC08 R1 exact result share ignores later assistant text, retains one intent and admits a new invocation", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const saved = yield* savedJudge(f.source.id, "completed")
    yield* assistant(f.source.id, ["Later assistant text must not change the saved Task selection"])
    const input = {
      sourceSessionID: f.source.id,
      targetSessionID: f.target.id,
      scope: "result" as const,
      result_source: saved.locator,
      trigger: false,
    }
    const first = yield* f.execute(input)
    const output = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(first.output)
    expect(output).toMatchObject({
      result_source: saved.locator,
      basis: "summary",
      admission: "admitted",
      wake: "not_requested",
    })
    expect(output.text).toContain("Exact saved summary 🚀\nSecond summary line.")
    expect(output.text).toContain("actual-share-model")
    expect(output.text).not.toContain("Later assistant text")
    const retry = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)((yield* f.execute(input)).output)
    expect(retry).toMatchObject({ inboxID: output.inboxID, admission: "retained", text: output.text })
    expect(yield* f.sessions.inbox(f.target.id)).toHaveLength(1)
    yield* promote(f.target.id)
    const promoted = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(
      (yield* f.execute({ ...input, trigger: true })).output,
    )
    expect(promoted).toMatchObject({
      inboxID: output.inboxID,
      admission: "retained",
      wake: "suppressed",
      text: output.text,
    })
    expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
    expect((yield* f.sessions.context(f.target.id)).filter((message) => message.type === "synthetic")).toHaveLength(1)
    const fresh = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(
      (yield* f.execute(input, f.caller.id, "new-share-intent")).output,
    )
    expect(fresh.inboxID).not.toBe(output.inboxID)
    expect(fresh.admission).toBe("admitted")
    expect(yield* f.sessions.inbox(f.target.id)).toHaveLength(1)
    const calls = yield* ExecutionCalls
    expect(calls.wakes).toEqual([])
  }),
)

for (const outcome of [undefined, "partial", "empty", "failed", "cancelled", "unavailable"] as const) {
  it.live(`MC08 R1 exact share records ${outcome ?? "unrequested"} summary quality and its actual body basis`, () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const saved = yield* savedJudge(f.source.id, outcome)
      const result = yield* f.execute({
        sourceSessionID: f.source.id,
        targetSessionID: f.target.id,
        scope: "result",
        result_source: saved.locator,
        trigger: false,
      })
      const output = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(result.output)
      expect(output.basis).toBe(outcome === "partial" ? "summary_partial" : "original")
      expect(output.text).toContain(`"summary":"${outcome ?? "not_requested"}"`)
      expect(output.text).toContain(outcome === "partial" ? "Exact saved summary 🚀\nSecond summary line." : saved.text)
      expect(output.text).toContain(saved.locator.messageID)
      expect((yield* f.sessions.inbox(f.target.id))[0]?.payload).toMatchObject({ text: output.text })
    }),
  )
}

it.live("MC08 R1 exact share reads the complete saved Tool output when its model content was bounded", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const saved = yield* savedJudge(f.source.id, undefined, { bounded: true })
    const output = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(
      (yield* f.execute({
        sourceSessionID: f.source.id,
        targetSessionID: f.target.id,
        scope: "result",
        result_source: saved.locator,
        trigger: false,
      })).output,
    )
    expect(output.basis).toBe("original")
    expect(output.text).toContain(saved.text)
    expect(output.text).not.toContain("[Full Judge output saved]")
  }),
)

for (const invalid of ["source-session", "tool-id", "tool-name", "running", "owner", "locator"] as const) {
  it.live(`MC08 R1 rejects an exact result with invalid ${invalid} before target admission`, () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const saved = yield* savedJudge(f.source.id, "completed", {
        name: invalid === "tool-name" ? "other-tool" : undefined,
        completed: invalid !== "running",
        owner: invalid === "owner" ? f.caller.id : undefined,
      })
      const exit = yield* f
        .execute({
          sourceSessionID: invalid === "source-session" ? f.caller.id : f.source.id,
          targetSessionID: f.target.id,
          scope: "result",
          ...(invalid === "locator"
            ? {}
            : {
                result_source: new SessionShareV2.ResultSource({
                  ...saved.locator,
                  id: invalid === "tool-id" ? "wrong-tool" : saved.locator.id,
                }),
              }),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
      expect((yield* ExecutionCalls).wakes).toEqual([])
    }),
  )
}

it.live(
  "MC08 R1 exact share uses the caller's original permission leaf once and rejects without target admission",
  () =>
    Effect.gen(function* () {
      const f = yield* setup("ask")
      const saved = yield* savedJudge(f.source.id, "completed")
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const asked = yield* Deferred.make<Permission.Request>()
      const requests: Permission.Request[] = []
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
        requests.push(request)
        return Deferred.succeed(asked, request).pipe(Effect.asVoid)
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* f
        .execute({
          sourceSessionID: f.source.id,
          targetSessionID: f.target.id,
          scope: "result",
          result_source: saved.locator,
        })
        .pipe(Effect.forkScoped)
      const request = yield* awaitWithTimeout(Deferred.await(asked), "R1 share did not request permission")
      expect(request).toMatchObject({
        sessionID: f.caller.id,
        action: "share",
        resources: [f.source.id, f.target.id],
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-share" },
      })
      expect(requests).toHaveLength(1)
      expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
      yield* f.permission.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "R1 share rejection did not settle")
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeclinedError)
      expect(requests).toHaveLength(1)
      expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
    }),
)

it.live("MC08 R1 exact share retry obeys inspect suppression after its admitted input was cancelled", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const saved = yield* savedJudge(f.source.id, "completed")
    const input = {
      sourceSessionID: f.source.id,
      targetSessionID: f.target.id,
      scope: "result" as const,
      result_source: saved.locator,
      trigger: false,
    }
    const first = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)((yield* f.execute(input)).output)
    yield* f.sessions.cancelInbox({ sessionID: f.target.id, inboxID: first.inboxID })
    const retry = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(
      (yield* f.execute({ ...input, trigger: true })).output,
    )
    expect(retry).toMatchObject({ inboxID: first.inboxID, admission: "suppressed", wake: "suppressed" })
    expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
    expect((yield* ExecutionCalls).wakes).toEqual([])
  }),
)

volatileIt.live("MC08 R1 exact share is unavailable when the Bus cannot retain its retry lifecycle", () =>
  Effect.gen(function* () {
    const f = yield* setup()
    const saved = yield* savedJudge(f.source.id, "completed")
    const output = Schema.decodeUnknownSync(SessionShareTool.ResultOutput)(
      (yield* f.execute({
        sourceSessionID: f.source.id,
        targetSessionID: f.target.id,
        scope: "result",
        result_source: saved.locator,
      })).output,
    )
    expect(output).toMatchObject({
      admission: "unavailable",
      wake: "suppressed",
      reason: expect.stringContaining("retained Bus events"),
    })
    expect(yield* f.sessions.inbox(f.target.id)).toEqual([])
    expect((yield* ExecutionCalls).wakes).toEqual([])
  }),
)

describe("SessionShareV2", () => {
  ;(["reference", "output", "full"] as const).forEach((scope) =>
    it.live(`admits ${scope} from the actual projected source history`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        yield* fixture.sessions.prompt({ sessionID: fixture.source.id, text: "source request", resume: false })
        yield* promote(fixture.source.id)
        yield* assistant(fixture.source.id, ["older result"])
        yield* assistant(fixture.source.id, ["latest", "result"])
        yield* assistant(fixture.source.id, [])
        yield* fixture.sessions.synthetic({ sessionID: fixture.source.id, text: "source note", resume: false })
        yield* promote(fixture.source.id)
        const share = yield* SessionShareV2.Service
        yield* share.share({ sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope })

        const expected = {
          reference: `[Shared reference] Source session: ${fixture.source.id}.`,
          output: `[Shared output from session ${fixture.source.id}]\n\nlatest\nresult`,
          full: `[Shared history from session ${fixture.source.id}]\n\n[User] source request\n\n[Assistant] older result\n\n[Assistant] latest\n\n[Assistant] result\n\n[Synthetic] source note`,
        }[scope]
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([
          expect.objectContaining({
            sessionID: fixture.target.id,
            type: "synthetic",
            delivery: "steer",
            payload: {
              text: expected,
              metadata: { source: "share", sourceSessionID: fixture.source.id, scope },
            },
          }),
        ])
        expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
        const calls = yield* ExecutionCalls
        expect(calls.wakes).toEqual([])
        expect(calls.resumes).toEqual([])
        yield* fixture.execute({
          sourceSessionID: fixture.source.id,
          targetSessionID: fixture.target.id,
          scope,
          trigger: false,
        })
        expect((yield* fixture.sessions.inbox(fixture.target.id)).map((item) => item.payload)).toEqual([
          expect.objectContaining({ text: expected }),
          expect.objectContaining({ text: `[Shared by Meta session ${fixture.caller.id}, content from session ${fixture.source.id}]\n${expected}` }),
        ])
        expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
        expect(calls.wakes).toEqual([])
      }),
    ),
  )

  it.live("admits the explicit fallback when no assistant has text", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* assistant(fixture.source.id, [])
      const share = yield* SessionShareV2.Service
      yield* share.share({ sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope: "output" })
      expect((yield* fixture.sessions.inbox(fixture.target.id))[0]?.payload).toMatchObject({
        text: `[Shared output] Source session ${fixture.source.id} has no assistant output yet.`,
      })
    }),
  )
  ;(["source", "target"] as const).forEach((missing) =>
    it.live(`rejects a missing ${missing} without admitting target work`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const share = yield* SessionShareV2.Service
        const exit = yield* share
          .share({
            sourceSessionID: missing === "source" ? Session.ID.make("ses_missing") : fixture.source.id,
            targetSessionID: missing === "target" ? Session.ID.make("ses_missing") : fixture.target.id,
            scope: "reference",
            trigger: true,
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Session.NotFoundError)
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
        const calls = yield* ExecutionCalls
        expect(calls.wakes).toEqual([])
      }),
    ),
  )
})

describe("SessionShareTool", () => {
  it.live("defaults to one wake after durable admission and supports admit-only", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const calls = yield* ExecutionCalls
      expect(fixture.snapshot.definitions.map((tool) => tool.name)).toContain(SessionShareTool.name)
      const input = {
        sourceSessionID: fixture.source.id,
        targetSessionID: fixture.target.id,
        scope: "reference" as const,
      }
      const first = yield* fixture.execute({ ...input, trigger: false })
      expect(first.output).toBe(`Shared reference from session ${fixture.source.id} to ${fixture.target.id}`)
      expect(first.metadata).toMatchObject({
        ...input,
        actorSessionID: fixture.caller.id,
        contentSourceSessionID: fixture.source.id,
      })
      expect(calls.wakes).toEqual([])
      yield* fixture.execute(input, fixture.caller.id, "second-share")
      expect(calls.wakes).toEqual([
        {
          sessionID: fixture.target.id,
          inbox: yield* fixture.sessions.inbox(fixture.target.id),
          context: [],
        },
      ])
      expect(calls.wakes[0]?.inbox).toHaveLength(2)
      expect(calls.resumes).toEqual([])
    }),
  )

  it.live("rejects a nonexistent caller before requesting permission", () =>
    Effect.gen(function* () {
      const fixture = yield* setup("ask")
      const exit = yield* fixture
        .execute(
          { sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope: "reference" },
          Session.ID.make("ses_missing"),
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
      expect(yield* fixture.permission.forSession(fixture.caller.id)).toEqual([])
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
    }),
  )

  it.live("fails closed when an ask has no responder", () =>
    Effect.gen(function* () {
      const fixture = yield* setup("ask")
      const exit = yield* fixture
        .execute({ sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope: "reference" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
      expect(yield* fixture.permission.forSession(fixture.caller.id)).toEqual([])
    }),
  )
  ;(["source", "target"] as const).forEach((missing) =>
    it.live(`maps a missing ${missing} to a typed tool failure without admission`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const exit = yield* fixture
          .execute({
            sourceSessionID: missing === "source" ? Session.ID.make("ses_missing") : fixture.source.id,
            targetSessionID: missing === "target" ? Session.ID.make("ses_missing") : fixture.target.id,
            scope: "reference",
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
        expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
        const calls = yield* ExecutionCalls
        expect(calls.wakes).toEqual([])
      }),
    ),
  )
  ;(["once", "reject", "correct", "interrupt"] as const).forEach((reply) =>
    it.live(`checks source and target permissions before admission: ${reply}`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup("ask")
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const asked = yield* Deferred.make<Permission.Request>()
        const bus = yield* Bus.Service
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const fiber = yield* fixture
          .execute({
            sourceSessionID: fixture.source.id,
            targetSessionID: fixture.target.id,
            scope: "reference",
            trigger: false,
          })
          .pipe(Effect.forkScoped)
        const request = yield* awaitWithTimeout(Deferred.await(asked), "share did not request permission")
        expect(request).toMatchObject({
          sessionID: fixture.caller.id,
          action: "share",
          resources: [fixture.source.id, fixture.target.id],
          save: [fixture.source.id, fixture.target.id],
          metadata: { sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id },
          source: { type: "tool", messageID: toolIdentity.messageID, id: "call-share" },
        })
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
        expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
        if (reply === "interrupt") {
          yield* awaitWithTimeout(Fiber.interrupt(fiber), "share approval cancellation did not settle")
          expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
          expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
          expect(yield* fixture.permission.forSession(fixture.caller.id)).toEqual([])
          return
        }
        yield* fixture.permission.reply({
          requestID: request.id,
          reply: reply === "correct" ? "reject" : reply,
          ...(reply === "correct" ? { message: "share another source" } : {}),
        })
        const exit = yield* awaitWithTimeout(Fiber.await(fiber), "share permission reply did not settle")
        expect(yield* fixture.permission.forSession(fixture.caller.id)).toEqual([])
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toHaveLength(reply === "once" ? 1 : 0)
        expect(yield* fixture.sessions.context(fixture.target.id)).toEqual([])
        if (reply === "once") {
          expect(Exit.isSuccess(exit)).toBe(true)
          return
        }
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
          reply === "reject" ? Permission.DeclinedError : Tool.Error,
        )
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(reply === "reject")
      }),
    ),
  )

  it.live("a captured visible tool obeys a later target-specific deny", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      expect(fixture.snapshot.definitions.map((tool) => tool.name)).toContain(SessionShareTool.name)
      yield* fixture.agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "share", resource: fixture.target.id, effect: "deny" },
          ]
        }),
      )
      const exit = yield* fixture
        .execute({ sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope: "reference" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
    }),
  )

  productionIt.live("the production plugin graph registers share and the target runner consumes it once", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const fixture = yield* setup("allow", Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))
      expect(fixture.target.location.directory).not.toBe(fixture.caller.location.directory)
      expect(fixture.snapshot.definitions.map((tool) => tool.name)).toContain(SessionShareTool.name)
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const localBus = yield* Bus.Service.pipe(Effect.provide(locations.get(fixture.caller.location)))
      expect(localBus).toBe(bus)
      const share = yield* SessionShareV2.Service
      const localShare = yield* SessionShareV2.Service.pipe(Effect.provide(locations.get(fixture.caller.location)))
      expect(localShare).toBe(share)
      const admitted: SessionMessage.ID[] = []
      const delivered: SessionMessage.ID[] = []
      const completed = yield* Deferred.make<void, Error>()
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        Effect.sync(() => {
          if (event.data.sessionID === fixture.target.id) admitted.push(event.data.inboxID)
        }),
      )
      yield* bus.project(SessionEvent.InboxDelivered, (event) =>
        Effect.sync(() => {
          if (event.data.sessionID === fixture.target.id) delivered.push(event.data.inboxID)
        }),
      )
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type === SessionEvent.Execution.Succeeded.type) {
          // Local Bus data may retain optional undefined keys before JSON encoding.
          const data = Schema.decodeUnknownSync(Schema.toType(SessionEvent.Execution.Succeeded.data))(event.data)
          if (data.sessionID === fixture.target.id) return Deferred.succeed(completed, undefined).pipe(Effect.asVoid)
        }
        if (event.type === SessionEvent.Execution.Failed.type) {
          const data = Schema.decodeUnknownSync(Schema.toType(SessionEvent.Execution.Failed.data))(event.data)
          if (data.sessionID === fixture.target.id)
            return Deferred.fail(completed, new Error(`Target execution failed: ${JSON.stringify(data.error)}`)).pipe(Effect.asVoid)
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* fixture.execute({
        sourceSessionID: fixture.source.id,
        targetSessionID: fixture.target.id,
        scope: "reference",
      })
      yield* awaitWithTimeout(
        Deferred.await(completed),
        "target runner did not complete the shared input",
        "10 seconds",
      )
      expect(admitted).toHaveLength(1)
      expect(delivered).toEqual(admitted)
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
      const messages = yield* fixture.sessions.context(fixture.target.id)
      expect(messages.filter((message) => message.type === "synthetic")).toEqual([
        expect.objectContaining({
          id: admitted[0],
          text: `[Shared by Meta session ${fixture.caller.id}, content from session ${fixture.source.id}]\n[Shared reference] Source session: ${fixture.source.id}.`,
          metadata: expect.objectContaining({
            source: "share",
            sourceSessionID: fixture.source.id,
            actorSessionID: fixture.caller.id,
            contentSourceSessionID: fixture.source.id,
            scope: "reference",
          }),
        }),
      ])
      expect(messages.flatMap((message) => (message.type === "assistant" ? message.content : []))).toContainEqual(
        expect.objectContaining({ type: "text", text: "received" }),
      )
    }),
  )

  productionIt.live("a child report wakes Meta and an exact reply resumes the original child Session", () =>
    Effect.gen(function* () {
      const fixture = yield* setup("builtin")
      const child = yield* controlledChild(fixture, Agent.ID.make("explore"))
      const execution = yield* SessionExecution.Service
      const reported = yield* fixture.execute({ scope: "text", text: "The parser is isolated. Which response fields should I preserve?" },
        child.id, "live-child-report", Agent.ID.make("explore"))
      const record = Schema.decodeUnknownSync(SessionCommunication.Record)(reported.metadata?.communication)
      yield* awaitWithTimeout(execution.awaitIdle(fixture.caller.id), "Meta did not consume the child's report", "10 seconds")
      expect(yield* fixture.sessions.inbox(fixture.caller.id)).toEqual([])
      expect((yield* fixture.sessions.context(fixture.caller.id)).flatMap((message) => message.type === "assistant" ? message.content : []))
        .toContainEqual(expect.objectContaining({ type: "text", text: "received" }))
      const replied = yield* fixture.execute({ scope: "text", replyTo: record.id, text: "Keep the public response fields and continue." },
        fixture.caller.id, "live-meta-reply")
      expect(replied.metadata?.targetSessionID).toBe(child.id)
      yield* awaitWithTimeout(execution.awaitIdle(child.id), "The original child did not consume Meta's reply", "10 seconds")
      expect(yield* fixture.sessions.inbox(child.id)).toEqual([])
      const history = yield* fixture.sessions.context(child.id)
      expect(history.filter((message) => message.type === "synthetic")).toContainEqual(
        expect.objectContaining({ text: "Keep the public response fields and continue." }),
      )
      expect(history.flatMap((message) => message.type === "assistant" ? message.content : []))
        .toContainEqual(expect.objectContaining({ type: "text", text: "received" }))
      expect((yield* fixture.sessions.get(child.id)).controller).toEqual(child.controller)
    }),
  )
})

describe("SessionShareTool Meta coordination", () => {
  it.live("advertises communication to builtin Meta and its controlled Explore child", () =>
    Effect.gen(function* () {
      const fixture = yield* setup("builtin")
      const child = yield* controlledChild(fixture, Agent.ID.make("explore"))
      const context = yield* SessionContext.Service.pipe(
        Effect.provide((yield* LocationServiceMap.Service).get(child.location)),
      )
      for (const sessionID of [fixture.caller.id, child.id])
        expect((yield* context.select(sessionID)).tools.definitions.some((tool) => tool.name === SessionShareTool.name)).toBe(true)
      const report = yield* fixture.execute({ scope: "text", text: "The saved controller matches.", trigger: false },
        child.id, "explore-report", Agent.ID.make("explore"))
      expect(report.metadata?.targetSessionID).toBe(fixture.caller.id)
    }),
  )

  it.live("lets a bound child report and ask Meta, then delivers Meta's reply to the same child", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const child = yield* controlledChild(fixture)
      const local = (yield* LocationServiceMap.Service).get(child.location)
      const context = yield* SessionContext.Service.pipe(Effect.provide(local))
      const selected = yield* context.select(child.id)
      expect(selected.tools.definitions.some((tool) => tool.name === SessionShareTool.name)).toBe(true)

      const report = yield* fixture.execute({
        scope: "text",
        text: "The parser issue is isolated. Should I preserve the existing response shape?",
        trigger: false,
      }, child.id, "child-report", Agent.defaultID)
      const record = Schema.decodeUnknownSync(SessionCommunication.Record)(report.metadata?.communication)
      expect(record).toMatchObject({
        actor: { sessionID: child.id, agent: Agent.defaultID },
        contentSource: { sessionID: child.id, scope: "text" },
        targetSessionID: fixture.caller.id,
        delivery: "steer",
      })
      expect((yield* fixture.sessions.inbox(fixture.caller.id)).find((item) => item.type === "synthetic")?.payload.text).toContain("Should I preserve")

      const reply = yield* fixture.execute({
        scope: "text",
        replyTo: record.id,
        text: "Preserve the response shape and continue with the regression test.",
        trigger: false,
      }, fixture.caller.id, "meta-reply")
      const replied = Schema.decodeUnknownSync(SessionCommunication.Record)(reply.metadata?.communication)
      expect(replied).toMatchObject({ replyTo: record.id, targetSessionID: child.id })
      expect((yield* fixture.sessions.inbox(child.id)).find((item) => item.type === "synthetic")?.payload.text).toContain("Preserve the response shape")
      const share = yield* SessionShareV2.Service
      expect((yield* share.list({ sessionID: child.id })).items.map((message) => message.id)).toEqual([record.id, replied.id])
      expect((yield* share.list({ sessionID: fixture.caller.id })).items.map((message) => message.id)).toEqual([record.id, replied.id])
    }),
  )

  it.live("attributes a child's shared saved output to its actual bound agent", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const child = yield* controlledChild(fixture)
      yield* assistant(child.id, ["The parser preserves the public response fields."])
      yield* fixture.execute({ scope: "output", trigger: false }, child.id, "child-output-report", Agent.defaultID)
      expect((yield* fixture.sessions.inbox(fixture.caller.id)).find((item) => item.type === "synthetic")?.payload.text).toBe(
        `[Shared by agent build in session ${child.id}, content from session ${child.id}]\n[Shared output from session ${child.id}]\n\nThe parser preserves the public response fields.`,
      )
    }),
  )

  it.live("keeps a bound child's messages within its own content and Meta control tree", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const child = yield* controlledChild(fixture)
      for (const input of [
        { sourceSessionID: fixture.source.id, targetSessionID: fixture.caller.id, scope: "output" },
        { targetSessionID: fixture.target.id, scope: "text", text: "Unrelated target" },
      ] as const) {
        const exit = yield* fixture.execute(input, child.id, `child-denied-${input.scope}`, Agent.defaultID).pipe(Effect.exit)
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      }
      expect(yield* fixture.sessions.inbox(fixture.caller.id)).toEqual([])
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
      expect((yield* ExecutionCalls).wakes).toEqual([])
    }),
  )

  it.live("lets same-Meta siblings send and reply directly in their existing Sessions", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const first = yield* controlledChild(fixture)
      const second = yield* controlledChild(fixture, Agent.ID.make("explore"), "spawn-peer-worker")
      const sent = yield* fixture.execute({ scope: "text", targetSessionID: second.id,
        text: "Please check the parser boundary before I update it.", trigger: false }, first.id, "peer-send", Agent.defaultID)
      const record = Schema.decodeUnknownSync(SessionCommunication.Record)(sent.metadata?.communication)
      expect(record).toMatchObject({ actor: { sessionID: first.id }, targetSessionID: second.id,
        contentSource: { sessionID: first.id, scope: "text" } })
      const replied = yield* fixture.execute({ scope: "text", replyTo: record.id,
        text: "The parser boundary is valid; preserve the public fields.", trigger: false }, second.id, "peer-reply", Agent.ID.make("explore"))
      expect(replied.metadata?.targetSessionID).toBe(first.id)
      expect((yield* fixture.sessions.inbox(first.id)).find((item) => item.type === "synthetic")?.payload.text).toContain("preserve the public fields")
      expect((yield* fixture.sessions.inbox(second.id)).find((item) => item.type === "synthetic")?.payload.text).toContain("check the parser boundary")
      expect(yield* fixture.sessions.inbox(fixture.caller.id)).toEqual([])
    }),
  )

  it.live("rejects a child communication to a different real Meta control tree", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const first = yield* controlledChild(fixture)
      const other = yield* fixture.sessions.create({ location: fixture.caller.location, agent: Agent.ID.make("meta"), model })
      const foreign = yield* controlledChild({ ...fixture, caller: other }, Agent.defaultID, "spawn-foreign-worker")
      const exit = yield* fixture.execute({ scope: "text", targetSessionID: foreign.id,
        text: "Cross-group message", trigger: false }, first.id, "peer-foreign", Agent.defaultID).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* fixture.sessions.inbox(foreign.id)).toEqual([])
      expect(yield* fixture.sessions.inbox(other.id)).toEqual([])
    }),
  )

  it.live("requires the child's actual saved Meta ownership before sending feedback", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const child = yield* controlledChild(fixture)
      const metas = yield* MetaAgentService.Service
      if (child.controller?.kind !== "child") return yield* Effect.die(new Error("Expected a controlled child"))
      yield* metas.detach({ metaID: child.controller.metaAgentID, sessionID: child.id })
      const exit = yield* fixture.execute({ scope: "text", text: "Forged ownership", trigger: false },
        child.id, "detached-child-feedback", Agent.defaultID).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* fixture.sessions.inbox(fixture.caller.id)).toEqual([])
    }),
  )

  for (const agent of ["build", "plan"] as const) {
    it.live(`MP01 rejects a ${agent} caller even when its content source is Meta`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup("ask", undefined, Agent.ID.make(agent))
        const meta = yield* fixture.sessions.create({ location: fixture.caller.location, agent: Agent.ID.make("meta"), model })
        const exit = yield* fixture.execute({ sourceSessionID: meta.id, targetSessionID: fixture.target.id, scope: "reference" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
        expect(yield* fixture.permission.forSession(fixture.caller.id)).toEqual([])
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
        expect((yield* ExecutionCalls).wakes).toEqual([])
      }),
    )
  }

  it.live("MP01 rejects a captured Build executor on a currently selected Meta root", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const exit = yield* fixture.execute(
        { sourceSessionID: fixture.source.id, targetSessionID: fixture.target.id, scope: "reference" },
        fixture.caller.id,
        "captured-build-share",
        Agent.ID.make("build"),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
    }),
  )

  for (const reselect of [false, true]) {
    it.live(`MP01 blocks a pending share after Meta selection changes${reselect ? " and returns to Meta" : " to Build"}`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup("ask")
        const bus = yield* Bus.Service
        const metas = yield* MetaAgentService.Service
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const asked = yield* Deferred.make<Permission.Request>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const before = yield* metas.assertCoordination(fixture.caller.id)
        const fiber = yield* fixture.execute({
          sourceSessionID: fixture.source.id,
          targetSessionID: fixture.target.id,
          scope: "reference",
          trigger: false,
        }).pipe(Effect.forkScoped)
        const request = yield* awaitWithTimeout(Deferred.await(asked), "pending Meta share did not ask permission")
        yield* fixture.sessions.switchAgent({ sessionID: fixture.caller.id, agent: Agent.ID.make("build") })
        if (reselect)
          yield* fixture.sessions.switchAgent({ sessionID: fixture.caller.id, agent: Agent.ID.make("meta"), model })
        const current = yield* metas.coordination(fixture.caller.id)
        expect(current.selection.event?.id).not.toBe(before.selection.event?.id)
        expect(current.available).toBe(reselect)
        yield* fixture.permission.reply({ requestID: request.id, reply: "once" })
        const exit = yield* awaitWithTimeout(Fiber.await(fiber), "pending Meta share did not finish after selection changed")
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
        expect(yield* fixture.sessions.inbox(fixture.target.id)).toEqual([])
        expect((yield* ExecutionCalls).wakes).toEqual([])
        expect((yield* fixture.sessions.get(fixture.caller.id)).controller).toEqual(fixture.caller.controller)
      }),
    )
  }

  it.live("MP01 records the Meta actor separately from the Build output it forwards", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* assistant(fixture.source.id, ["Complete Build output 🚀\nSecond line"])
      const forged = {
        sourceSessionID: fixture.source.id,
        targetSessionID: fixture.target.id,
        scope: "output" as const,
        trigger: false,
        actorSessionID: fixture.source.id,
      }
      yield* fixture.execute(forged)
      const inbox = yield* fixture.sessions.inbox(fixture.target.id)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.payload).toMatchObject({
        text: `[Shared by Meta session ${fixture.caller.id}, content from session ${fixture.source.id}]\n[Shared output from session ${fixture.source.id}]\n\nComplete Build output 🚀\nSecond line`,
        metadata: {
          source: "share",
          actorSessionID: fixture.caller.id,
          contentSourceSessionID: fixture.source.id,
          sourceSessionID: fixture.source.id,
          scope: "output",
        },
      })
    }),
  )

  productionIt.live("MP01 shares the Context capability rule while keeping Build and Plan task tools", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const locations = yield* LocationServiceMap.Service
      const context = yield* SessionContext.Service.pipe(Effect.provide(locations.get(fixture.caller.location)))
      const meta = yield* context.select(fixture.caller.id)
      expect(meta.tools.definitions.map((tool) => tool.name)).toContain(SessionShareTool.name)
      expect(meta.tools.definitions.find((tool) => tool.name === TaskTool.name)).toHaveProperty("inputSchema.properties.target")
      for (const agent of ["build", "plan"] as const) {
        yield* fixture.sessions.switchAgent({ sessionID: fixture.caller.id, agent: Agent.ID.make(agent) })
        const ordinary = yield* context.select(fixture.caller.id)
        expect(ordinary.tools.definitions.map((tool) => tool.name)).not.toContain(SessionShareTool.name)
        expect(ordinary.tools.definitions.map((tool) => tool.name)).toContain(TaskTool.name)
        expect(ordinary.tools.definitions.find((tool) => tool.name === TaskTool.name)).not.toHaveProperty("inputSchema.properties.target")
        expect(ordinary.tools.definitions.find((tool) => tool.name === TaskTool.name)).not.toHaveProperty("inputSchema.properties.delivery")
        expect(ordinary.tools.definitions.find((tool) => tool.name === TaskTool.name)).not.toHaveProperty("inputSchema.properties.resume")
      }
    }),
  )
})
