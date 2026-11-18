import { describe, expect, test } from "bun:test"
import {
  AIError,
  CompactionPart,
  CompactionCheckpointResponse,
  HttpContext,
  LLMEvent,
  LLMRequest,
  Message,
  SystemPart,
  LanguageModel,
  ToolFailure,
  TransportError,
  InvalidProviderOutputError,
  InvalidRequestError,
  RateLimitError,
  UnknownProviderError,
  AuthenticationError,
  QuotaExceededError,
} from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols/openai-chat"
import { AnthropicMessages, OpenAIResponses } from "@aigcfroge/ai/protocols"
import { compileRequest } from "@aigcfroge/ai/route/client"
import { TestLLM } from "@aigcfroge/ai/testing"
import type { SessionHooks } from "@aigcfroge/plugin/effect/session"
import { Database } from "@aigcfroge/core/database/database"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Event } from "@aigcfroge/schema/event"
import { App } from "@aigcfroge/core/app"
import { Permission } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { SessionMemoryAdmission } from "@aigcfroge/core/session/memory-admission"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { EventSequenceTable, EventTable } from "@aigcfroge/core/event/sql"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { Form } from "@aigcfroge/core/form"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { Snapshot } from "@aigcfroge/core/snapshot"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionCompaction } from "@aigcfroge/core/session/compaction"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionModelTransport } from "@aigcfroge/core/session/model-transport"
import { SessionProviderContext } from "@aigcfroge/core/session/provider-context"
import { Money } from "@aigcfroge/schema/money"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionRunner } from "@aigcfroge/core/session/runner/index"
import { SessionRunnerLLM } from "@aigcfroge/core/session/runner/llm"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionStep } from "@aigcfroge/core/session/runner/step"
import { SessionUsage } from "@aigcfroge/core/session/usage"
import { TaskOperation } from "@aigcfroge/core/session/task-operation"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { PluginSupervisor } from "@aigcfroge/core/plugin/supervisor"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { OptimizePlugin } from "@aigcfroge/core/plugin/optimize"
import { IdentityPlugin } from "@aigcfroge/core/plugin/identity"
import { CommandPlugin } from "@aigcfroge/core/plugin/command"
import { Command } from "@aigcfroge/core/command"
import { GoalTool } from "@aigcfroge/core/tool/plugin/goal"
import { QuestionTool } from "@aigcfroge/core/tool/plugin/question"
import { Agent } from "@aigcfroge/core/agent"
import { Config } from "@aigcfroge/core/config"
import { ConfigProviderPlugin } from "@aigcfroge/core/config/plugin/provider"
import { ProviderDiscovery } from "@aigcfroge/core/provider/discovery"
import { Integration } from "@aigcfroge/core/integration"
import { Credential } from "@aigcfroge/core/credential"
import { ModelGroup } from "@aigcfroge/core/model-group"
import { ModelResolver } from "@aigcfroge/core/model-resolver"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { SessionAttempt } from "@aigcfroge/schema/session-attempt"
import { IntegrationConnection } from "@aigcfroge/core/integration/connection"
import { ConfigMeta } from "@aigcfroge/core/config/meta"
import { MetaAgentMemory } from "@aigcfroge/core/agent/meta/memory"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentMemoryTable, MetaAgentSessionTable, MetaAgentTable } from "@aigcfroge/core/meta-agent/sql"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { Document, Info } from "@aigcfroge/schema/config"
import { ConfigCompaction } from "@aigcfroge/schema/config/compaction"
import { Tool } from "@aigcfroge/core/tool"
import type { Info as ToolInfo } from "@aigcfroge/schema/tool"
import {
  InstructionStateTable,
  SessionInboxTable,
  SessionInputResultTable,
  SessionMessageTable,
  SessionTable,
  TaskOperationTable,
} from "@aigcfroge/core/session/sql"
import { InstructionEntry } from "@aigcfroge/core/session/instruction-entry"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Instructions } from "@aigcfroge/core/instructions/index"
import { InstructionBuiltIns } from "@aigcfroge/core/instructions/builtins"
import { InstructionDiscovery } from "@aigcfroge/core/instruction-discovery"
import { SkillInstructions } from "@aigcfroge/core/skill/instructions"
import { ReferenceInstructions } from "@aigcfroge/core/reference/instructions"
import { McpInstructions } from "@aigcfroge/core/mcp/instructions"
import { SessionSystemPrompt } from "@aigcfroge/core/session/system-prompt"
import { ID, Model } from "@aigcfroge/core/model"
import { Location } from "@aigcfroge/core/location"
import { Provider } from "@aigcfroge/core/provider"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { asc, desc, eq, sql } from "drizzle-orm"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { registerToolPlugin } from "./lib/tool"
import { promptLocationNode } from "./fixture/prompt-location"
import { SessionWire } from "./fixture/session-wire"
import { tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Expected } from "./lib/session-message"
import { agentHost, integrationHost, modelHost, providerHost, host, noProviders } from "./plugin/host"
import { CodeModeInstructions } from "@aigcfroge/core/codemode/instructions"
import { withCustomMode } from "./lib/product-mode"

const emptyCodeMode = `${CodeModeInstructions.render({ total: 0, shown: 0, namespaces: [] })}\n\n`
type ToolBarrier = {
  readonly count: number
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  active: number
  maxActive: number
}
const testLLM = TestLLM.layer({
  fallback: [],
  transformRequest: (request) =>
    LLMRequest.update(request, {
      system: request.system.map((part) => ({
        ...part,
        text: part.text.replace(emptyCodeMode, ""),
      })),
      tools: request.tools.filter((tool) => tool.name !== "execute"),
    }),
})
type ModelLimit = { readonly context: number; readonly input?: number; readonly output: number }
const defaultModelLimit = { context: 200_000, output: 32_000 }
const modelLimits = new Map<string, ModelLimit>()
const testModel = (id: string, limit: ModelLimit = defaultModelLimit) => {
  modelLimits.set(id, limit)
  return LanguageModel.make({ id, provider: "fake", route: OpenAIChat.route })
}
const model = testModel("fake-model")
const defaultSystem = SessionSystemPrompt.make([])
const identity = (providerID: string, id: string) =>
  ["# Your Model", `- Name: ${id}`, `- Provider ID: ${providerID}`, `- Model ID: ${id}`].join("\n")
const fakeIdentity = identity("fake", "fake-model")
const replacementIdentity = identity("fake", "replacement")
const gptIdentity = identity("openai", "gpt-5")
const replacementModel = testModel("replacement")
const compactModel = testModel("compact", { context: 4_000, output: 50 })
const fullOutputModel = testModel("full-output", { context: 262_144, output: 262_144 })
const unknownContextModel = testModel("unknown-context", { context: 0, output: 32_000 })
const undersizedContextModel = testModel("undersized-context", { context: 1, output: 1_000 })
const recoveryModel = testModel("recovery", { context: 200_000, output: 1_000 })
const fittedOutputModel = testModel("fitted-output", { context: 100_000, output: 64_000 })
const smallWindowModel = testModel("small-window", { context: 64_000, output: 16_000 })
const largeOutputModel = testModel("large-output", { context: 1_000_000, output: 1_000_000 })

test("calculates step cost using the matching context tier", () => {
  expect(
    SessionUsage.calculateCost(
      [
        {
          input: Money.USDPerMillionTokens.make(1),
          output: Money.USDPerMillionTokens.make(2),
          cache: {
            read: Money.USDPerMillionTokens.make(0.1),
            write: Money.USDPerMillionTokens.make(0.5),
          },
        },
        {
          tier: { type: "context", size: 100 },
          input: Money.USDPerMillionTokens.make(3),
          output: Money.USDPerMillionTokens.make(4),
          cache: {
            read: Money.USDPerMillionTokens.make(0.2),
            write: Money.USDPerMillionTokens.make(0.6),
          },
        },
      ],
      { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 1 } },
    ),
  ).toBeCloseTo(0.0002926)
})

test("ignores malformed model cost fields", () => {
  const costs = [
    {
      input: Money.USDPerMillionTokens.make(3),
      output: Money.USDPerMillionTokens.make(15),
      cache: {
        read: Money.USDPerMillionTokens.make(0.3),
        write: Money.USDPerMillionTokens.make(3.75),
      },
    },
  ]
  Object.assign(costs[0], { input: {} })

  expect(
    SessionUsage.calculateCost(costs, {
      input: 1_000_000,
      output: 100_000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }),
  ).toBe(Money.USD.make(1.5))
})

test("does not apply an ineligible tier without base pricing", () => {
  expect(
    SessionUsage.calculateCost(
      [
        {
          tier: { type: "context", size: 100 },
          input: Money.USDPerMillionTokens.make(3),
          output: Money.USDPerMillionTokens.make(4),
          cache: {
            read: Money.USDPerMillionTokens.make(0.2),
            write: Money.USDPerMillionTokens.make(0.6),
          },
        },
      ],
      { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } },
    ),
  ).toBe(Money.USD.zero)
})

const resolvesModel: Effect.Effect<void, SessionRunnerModel.Error> = Effect.void

const makeRunnerState = (compaction?: SessionRunnerModel.Resolved["compaction"]) => {
  let toolBarrier: ToolBarrier | undefined
  const releaseTools = (barrier: ToolBarrier) =>
    Effect.sync(() => {
      if (toolBarrier === barrier) toolBarrier = undefined
    }).pipe(Effect.andThen(Deferred.succeed(barrier.release, undefined)), Effect.asVoid)
  return {
    currentModel: model,
    compaction,
    modelResolveHook: resolvesModel,
    systemBaseline: "Initial context",
    systemRemoved: false,
    systemUnavailable: false,
    systemLoadHook: Effect.void,
    skillBaselines: new Map<Agent.ID, string>(),
    authorizations: new Array<Tool.Context>(),
    executions: new Array<string>(),
    closedTransports: new Array<Session.ID>(),
    blockTools: (count = 1) =>
      Effect.acquireRelease(
        Effect.all({ started: Deferred.make<void>(), release: Deferred.make<void>() }).pipe(
          Effect.map((deferreds) => {
            const barrier = { count, ...deferreds, active: 0, maxActive: 0 }
            toolBarrier = barrier
            return barrier
          }),
        ),
        releaseTools,
      ).pipe(
        Effect.map((barrier) => ({
          started: Deferred.await(barrier.started),
          release: releaseTools(barrier),
          maxActive: Effect.sync(() => barrier.maxActive),
        })),
      ),
    awaitToolBarrier: Effect.suspend(() => {
      const barrier = toolBarrier
      if (!barrier) return Effect.void
      barrier.active++
      barrier.maxActive = Math.max(barrier.maxActive, barrier.active)
      return (barrier.active === barrier.count ? Deferred.succeed(barrier.started, undefined) : Effect.void).pipe(
        Effect.andThen(Deferred.await(barrier.release)),
        Effect.ensuring(Effect.sync(() => barrier.active--)),
      )
    }),
  }
}

class RunnerState extends Context.Service<RunnerState, ReturnType<typeof makeRunnerState>>()("test/SessionRunner") {}

const permissionFail = {
  name: "permission_fail",
  description: "Reject a permission",
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  execute: () =>
    new ToolFailure({
      message: "Permission denied: edit",
      error: new Permission.BlockedError({
        rules: [],
        permission: "edit",
        resources: ["src/index.ts"],
      }),
    }),
}
const transformTools = (registry: Tool.Interface, tools: Readonly<Record<string, ToolInfo>>, options?: Tool.Options) =>
  registry.transform((editor) =>
    Object.entries(tools).forEach(([name, tool]) => editor.add({ ...tool, name, options: options ?? tool.options })),
  )
const layerFor = <Memory extends boolean>(memory: Memory, realModels = false, transport = false) =>
  Layer.unwrap(
    Effect.map(RunnerState, (state) => {
      const modelTransport = Layer.succeed(
        SessionModelTransport.Service,
        SessionModelTransport.Service.of({
          bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
          close: (sessionID) => Effect.sync(() => state.closedTransports.push(sessionID)),
          closeAll: Effect.void,
        }),
      )
      const echo = Layer.effectDiscard(
        Tool.Service.use((registry) =>
          transformTools(
            registry,
            {
              echo: {
                name: "echo",
                description: "Echo text",
                input: Schema.Struct({ text: Schema.String }),
                output: Schema.Struct({ text: Schema.String }),
                execute: ({ text }, context) =>
                  Effect.gen(function* () {
                    state.authorizations.push(context)
                    state.executions.push(text)
                    yield* state.awaitToolBarrier
                    return { output: { text }, content: text }
                  }),
              },
              defect: {
                name: "defect",
                description: "Fail unexpectedly",
                input: Schema.Struct({}),
                output: Schema.Struct({}),
                execute: () => state.awaitToolBarrier.pipe(Effect.andThen(Effect.die("unexpected tool defect"))),
              },
              storefail: {
                name: "storefail",
                description: "Produce output that cannot be persisted",
                input: Schema.Struct({}),
                output: Schema.Struct({}),
                execute: () => Effect.succeed({ output: {} }),
              },
            },
            { codemode: false },
          ),
        ),
      )
      const echoNode = makeLocationNode({ name: "test/session-runner-tools", layer: echo, deps: [Tool.node] })
      const models = Layer.mock(SessionRunnerModel.Service)({
        resolve: (session) =>
          state.modelResolveHook.pipe(
            Effect.map(() => {
              const ref = session.model && !Model.Selection.isGroup(session.model) ? session.model : undefined
              const selected = ref?.id === "replacement" ? replacementModel : state.currentModel
              return SessionRunnerModel.resolved(transport ? LanguageModel.update(selected, { route: SessionWire.route }) : selected, {
                capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                cost: [],
                limit: modelLimits.get(String(selected.id)) ?? defaultModelLimit,
                variant: ref?.variant,
                compaction: state.compaction,
                connection: transport ? { type: "env", name: "SESSION_WIRE_KEEPER" } : undefined,
              })
            }),
          ),
      })
      const systemContextKey = Instructions.Key.make("test/context")
      const systemContext = Layer.mock(InstructionBuiltIns.Service, {
        load: () =>
          Effect.sync(() =>
            Instructions.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              read: state.systemLoadHook.pipe(
                Effect.andThen(
                  Effect.sync(() =>
                    state.systemUnavailable
                      ? Instructions.unavailable
                      : state.systemRemoved
                        ? Instructions.removed
                        : state.systemBaseline,
                  ),
                ),
              ),
              render: {
                initial: String,
                changed: (_previous, current) => current,
                removed: () => "System context source removed: test/context",
              },
            }),
          ),
      })
      const instructionContext = Layer.mock(InstructionDiscovery.Service, {
        project: true,
        global: true,
        load: () => Effect.succeed(Instructions.empty),
      })
      const skillInstructions = Layer.mock(SkillInstructions.Service, {
        load: (permissions) => {
          // `setup` tags each agent's ruleset with a `skill` rule naming that agent.
          const baseline = permissions
            .filter((rule) => rule.action === "skill")
            .map((rule) => state.skillBaselines.get(Agent.ID.make(rule.resource)))
            .findLast((text) => text !== undefined)
          return Effect.succeed(
            baseline === undefined
              ? Instructions.empty
              : Instructions.make({
                  key: Instructions.Key.make("test/skill-guidance"),
                  codec: Schema.toCodecJson(Schema.String),
                  read: Effect.succeed(baseline),
                  render: {
                    initial: String,
                    changed: (_previous, current) => current,
                    removed: () => "Skill guidance removed",
                  },
                }),
          )
        },
      })
      const referenceInstructions = Layer.mock(ReferenceInstructions.Service, {
        load: () => Effect.succeed(Instructions.empty),
      })
      const mcpInstructions = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
      const config = Config.testLayer([
        new Document({
          type: "document",
          info: new Info({
            ...(memory
              ? { meta: ConfigMeta.Info.make({ memory: ConfigMeta.Memory.make({ enabled: true, top_n: 2 }) }) }
              : {}),
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ])
      const promptModels = Layer.mock(Model.Service, {
        get: () => Effect.undefined,
        all: () => Effect.succeed([]),
        available: () => Effect.succeed([]),
        default: () => Effect.undefined,
        selection: () => Effect.undefined,
        small: () => Effect.undefined,
      })
      const configTestNode = makeLocationNode({ service: Config.Test, layer: config, deps: [] })
      const replacements: LayerNode.Replacements = [
        // The captured runner and the public fixture must observe the same event bus.
        Bus.node.replace(Bus.configured({ persist: true })),
        Snapshot.node.replace(Snapshot.noopLayer),
        LayerNodePlatform.llmClient.replace((transport ? SessionWire.layer : TestLLM.clientLayer).pipe(Layer.provide(testLLM))),
        ...(realModels ? [] : [SessionRunnerModel.node.replace(models)]),
        InstructionBuiltIns.node.replace(systemContext),
        InstructionDiscovery.node.replace(instructionContext),
        Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
        SkillInstructions.node.replace(skillInstructions),
        ReferenceInstructions.node.replace(referenceInstructions),
        McpInstructions.node.replace(mcpInstructions),
        Config.node.replace(config),
        PluginSupervisor.node.replace(Layer.empty),
        Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
        SessionModelTransport.node.replace(modelTransport),
      ]
      const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, replacements)
      const execution = Layer.effect(
        SessionExecution.Service,
        Effect.gen(function* () {
          const sessionRunner = yield* SessionRunner.Service
          function drain(
            sessionID: Session.ID,
            force: boolean,
            continuation?: SessionRunner.Continuation,
          ): Effect.Effect<void, SessionRunner.RunError> {
            return sessionRunner
              .drain({ sessionID, force, continuation })
              .pipe(
                Effect.flatMap((result) =>
                  result._tag === "Complete" ? Effect.void : drain(sessionID, false, result.continuation),
                ),
              )
          }
          const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
            drain: (sessionID, force) => drain(sessionID, force),
          })
          return SessionExecution.Service.of({
            active: coordinator.active,
            isActive: coordinator.isActive,
            resume: coordinator.run,
            wake: coordinator.wake,
            interrupt: (sessionID) => coordinator.interrupt(sessionID),
            awaitIdle: coordinator.awaitIdle,
          })
        }),
      ).pipe(Layer.provide(runnerLayer), Layer.orDie)
      return AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          Bus.node,
          Form.node,
          SessionProjector.node,
          SessionStore.node,
          SessionInbox.node,
          SessionGoal.node,
          ScheduleService.node,
          MetaAgentService.node,
          Command.node,
          Agent.node,
          Model.node,
          Provider.node,
          Integration.node,
          Credential.node,
          Tool.node,
          PluginHooks.node,
          echoNode,
          SessionRunnerModel.node,
          ModelResolver.node,
          InstructionBuiltIns.node,
          InstructionDiscovery.node,
          InstructionEntry.node,
          SkillInstructions.node,
          ReferenceInstructions.node,
          Config.node,
          CorrectionStore.node,
          configTestNode,
          Snapshot.node,
          SessionCompaction.node,
          LayerNodePlatform.llmClient,
          SessionRunnerLLM.node,
          MetaAgentMemory.node,
          Permission.node,
          Location.node,
          ApprovalPresence.node,
          SessionMemoryAdmission.node,
          SessionExecution.node,
          Session.node,
        ]),
        [
          ...replacements,
          LocationServiceMap.node.replace(promptLocationNode),
          ...(realModels ? [] : [Model.node.replace(promptModels)]),
          SessionExecution.node.replace(execution),
        ],
      )
    }),
  ).pipe(Layer.provideMerge(Layer.sync(RunnerState, makeRunnerState)), Layer.provideMerge(testLLM))
const layer = layerFor(false)
const it = testEffect(layer)
const wireIt = testEffect(layerFor(false, false, true))
const memoryIt = testEffect(layerFor(true))
const groupIt = testEffect(layerFor(false, true))
const sessionID = Session.ID.make("ses_runner_test")
const otherSessionID = Session.ID.make("ses_runner_other")

const insertSession = (id: Session.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const bus = yield* Bus.Service
  const sessionInbox = yield* SessionInbox.Service
  const agents = yield* Agent.Service
  const models = yield* Model.Service
  const hooks = yield* PluginHooks.Service
  const pluginHost = host({
    agent: agentHost(agents),
    model: modelHost(models),
    provider: noProviders,
    session: { hook: (name, callback) => hooks.register("session", name, callback) },
  })
  yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
    discard: true,
  })
  yield* IdentityPlugin.Plugin.effect(pluginHost)
  yield* agents.transform((editor) => {
    editor.update(Agent.ID.make("build"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
    })
    // Skill instructions receive only a ruleset, so tag each agent with a rule naming itself for the mock.
    for (const id of ["build", "reviewer"]) {
      editor.update(Agent.ID.make(id), (agent) => {
        agent.originKind = "builtin"
        agent.permissions.push({ action: "skill", resource: id, effect: "allow" })
      })
    }
  })
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* insertSession(sessionID)
  const state = yield* RunnerState
  const session = yield* Session.Service
  const llm = yield* TestLLM.Service
  const admit = (text: string) => session.prompt({ sessionID, text, resume: false })
  const resume = session.resume(sessionID)
  return Object.assign(state, {
    db,
    bus,
    sessionInbox,
    session,
    llm,
    requests: llm.requests,
    admit,
    resume,
    context: session.context(sessionID),
    messages: session.messages({ sessionID }),
    inbox: session.inbox(sessionID),
    runPrompt: Effect.fnUntraced(function* (text: string) {
      const message = yield* admit(text)
      yield* resume
      return message
    }),
    // Pause coordinated Session.resume at its first model request, not a direct runner drain.
    resumePaused: Effect.gen(function* () {
      const gate = yield* llm.gate
      const run = yield* resume.pipe(Effect.forkChild)
      yield* gate.started
      return { finish: gate.release.pipe(Effect.andThen(Fiber.join(run))) }
    }),
  })
})

it.effect("SC04 a later steer consumes the frozen consultation reference before an admit-only queued first input", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const source = yield* s.admit("SC04_RUNNER_REFERENCE: retained source evidence.")

    expect(yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer")).toBe(1)

    const sourceHistory = yield* s.messages
    const request = {
      sourceSessionID: sessionID,
      id: Session.ID.create(),
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ providerID: Provider.ID.make("fake"), id: Model.ID.make("fake-model") }),
      boundary: { type: "through" as const, messageID: source.id },
      prompt: {
        id: SessionMessage.ID.create(),
        text: "Queued first question must stay pending.",
        delivery: "queue" as const,
      },
      resume: false,
    }
    const created = yield* s.session.createConsultation(request)

    expect(created.admission).toMatchObject({ state: "pending", input: { id: request.prompt.id, delivery: "queue" } })
    expect(s.requests).toEqual([])

    const steer = yield* s.session.prompt({
      sessionID: created.session.id,
      text: "Read the reference in this steering question first.",
      delivery: "steer",
      resume: false,
    })

    expect(steer.payload.files).toContainEqual(created.reference.file)

    yield* s.llm.push(TestLLM.text("Reference consumed by the steer", "sc04-reference-answer"))

    const gate = yield* s.llm.gate
    const scope = yield* Scope.Scope
    const running = yield* s.session.resume(created.session.id).pipe(Effect.forkIn(scope))

    yield* awaitWithTimeout(gate.started, "Consultation steer did not reach its model request")

    expect(s.requests).toHaveLength(1)
    const first = s.requests[0]
    if (!first) return yield* Effect.die(new Error("Consultation model request is missing"))

    expect(userTexts(first)).toContain(steer.payload.text)
    expect(userTexts(first).some((text) => text.includes("SC04_RUNNER_REFERENCE"))).toBe(true)
    expect(userTexts(first)).not.toContain(request.prompt.text)
    expect(first.system.some((part) => part.text.includes("SC04_RUNNER_REFERENCE"))).toBe(false)
    expect(yield* s.session.inbox(created.session.id)).toMatchObject([
      { id: request.prompt.id, delivery: "queue", payload: { files: [created.reference.file] } },
    ])

    yield* s.session.cancelInbox({ sessionID: created.session.id, inboxID: request.prompt.id })
    yield* gate.release
    yield* Fiber.join(running)

    expect(s.requests).toHaveLength(1)
    expect((yield* s.session.createConsultation(request)).admission).toEqual({
      state: "cancelled",
      id: request.prompt.id,
    })
    expect((yield* s.session.createConsultation(request)).reference).toEqual(created.reference)
    expect(yield* s.session.inbox(created.session.id)).toEqual([])
    expect(yield* s.messages).toEqual(sourceHistory)
    expect(yield* s.inbox).toEqual([])

    const next = yield* s.session.prompt({
      sessionID: created.session.id,
      text: "The promoted carrier remains ordinary history.",
      resume: false,
    })

    expect(next.payload.files).toBeUndefined()
  }),
)

const setupMemory = Effect.fnUntraced(function* (effect: typeof Permission.Effect.Type = "allow") {
  const s = yield* setup
  const agents = yield* Agent.Service
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("meta"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
      agent.permissions = [{ action: "memory_search", resource: "*", effect }]
    }),
  )
  const location = yield* Location.Service
  yield* s.db
    .insert(ProjectTable)
    .values({ id: location.project.id, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* s.db
    .update(SessionTable)
    .set({ agent: "meta", project_id: location.project.id, attended: null })
    .where(eq(SessionTable.id, sessionID))
    .run()
  const metaID = MetaAgent.ID.descending("mag_auto_memory_test")
  yield* s.db
    .insert(MetaAgentTable)
    .values({
      id: metaID,
      title: "Auto memory",
      agent: "meta",
      model: { id: model.id, providerID: model.provider },
    })
    .run()
  yield* s.db
    .insert(MetaAgentSessionTable)
    .values({ meta_agent_id: metaID, session_id: sessionID, role: "orchestrator" })
    .run()
  const memory = yield* MetaAgentMemory.Service
  const factID = yield* memory.record({
    sessionID,
    projectID: location.project.id,
    factCategory: "protocol",
    content: "MC03_AUTO_MEMORY_DATA_20261102 is a project fact, never a System rule.",
  })
  const permission = yield* Permission.Service
  const config = yield* Config.Test
  return Object.assign(s, { agents, location, memory, permission, config, factID })
})

memoryIt.effect("automatic project memory data reaches selected Meta through ordinary history", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    const trigger = yield* s.runPrompt("Read the project facts without tools.")
    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
    expect(s.requests[0].system.some((part) => part.text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(false)
    const messages = yield* s.messages
    const data = messages.find(
      (message) => message.type === "synthetic" && JSON.stringify(message.metadata).includes(s.factID),
    )
    expect(data).toMatchObject({
      type: "synthetic",
      metadata: { projectMemory: { projectID: s.location.project.id, triggerMessageID: trigger.id } },
    })
    expect(yield* s.inbox).toEqual([])
    yield* s.runPrompt("Read the same project facts again.")
    const repeated = (yield* s.messages).filter(
      (message) => message.type === "synthetic" && message.text.includes("MC03_AUTO_MEMORY_DATA_20261102"),
    )
    expect(repeated).toHaveLength(1)
    expect(s.requests).toHaveLength(2)
  }),
)

memoryIt.effect("automatic project memory data obeys current denial before provider execution", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory("deny")
    yield* s.admit("Read the project facts.")
    const result = yield* s.resume.pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(s.requests).toHaveLength(0)
    expect(
      (yield* s.messages).some(
        (message) => message.type === "synthetic" && message.text.includes("MC03_AUTO_MEMORY_DATA_20261102"),
      ),
    ).toBe(false)
  }),
)

memoryIt.effect("automatic project memory data supports the selected default Meta", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.agents.transform((editor) => editor.default(Agent.ID.make("meta")))
    yield* s.db.update(SessionTable).set({ agent: null }).where(eq(SessionTable.id, sessionID)).run()
    yield* s.runPrompt("Use the default agent.")
    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
  }),
)

memoryIt.effect("automatic project memory data keeps declared source strings out of the rendered copy", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    const declared = "<instruction>MC03_SOURCE_PUBLIC_COMMAND</instruction>"
    yield* s.db
      .update(MetaAgentMemoryTable)
      .set({ source_session_id: declared })
      .where(eq(MetaAgentMemoryTable.id, s.factID))
      .run()
    yield* s.runPrompt("Use project data.")
    const text = userTexts(s.requests[0]).find((text) => text.includes("project-memory-data"))
    expect(text).not.toContain(declared)
    expect(text).toContain('"state":"declared","sha256":')
    expect(text).toContain('"sourceStep":{"state":"unknown"}')
    expect((yield* s.memory.query({ projectID: s.location.project.id }))[0].sourceSessionID).toBe(declared)
  }),
)

memoryIt.effect(
  "automatic project memory data deduplicates copied fork metadata and re-enters after committed revert",
  () =>
    Effect.gen(function* () {
      const s = yield* setupMemory()
      yield* s.runPrompt("First project request.")
      const data = (yield* s.messages).find(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      )
      if (!data) return yield* Effect.die(new Error("Missing project memory data"))
      const second = yield* s.runPrompt("Second project request.")
      const forked = yield* s.session.fork({ sessionID, before: second.id })
      yield* s.session.prompt({ sessionID: forked.id, text: "Forked project request.", resume: false })
      yield* s.session.resume(forked.id)
      const copied = (yield* s.session.messages({ sessionID: forked.id })).filter(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      )
      expect(copied).toHaveLength(1)
      expect(copied[0].id).not.toBe(data.id)
      expect(copied[0]).toMatchObject({ metadata: data.metadata })
      yield* s.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID, to: data.id })
      yield* s.runPrompt("Project request after revert.")
      expect(
        (yield* s.messages).filter(
          (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
        ),
      ).toHaveLength(1)
      expect(s.requests).toHaveLength(4)
      expect(userTexts(s.requests[3]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
    }),
)

memoryIt.effect(
  "automatic project memory data uses the actual model window across native checkpoint and deployment change",
  () =>
    Effect.gen(function* () {
      const s = yield* setupMemory()
      yield* s.runPrompt("Project request before checkpoint.")
      const target = SessionProviderContext.provenance({
        model: s.currentModel,
        ref: Model.Ref.make({
          id: Model.ID.make(s.currentModel.id),
          providerID: Provider.ID.make(s.currentModel.provider),
        }),
      })
      if (!target) return yield* Effect.die(new Error("Missing fixture model provenance"))
      yield* s.bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "",
        recent: "",
        providerContext: SessionProviderContext.encode(target, [
          Message.assistant(CompactionPart.make({ provider: s.currentModel.provider, encrypted: "memory-window" })),
        ]),
      })
      yield* s.runPrompt("Project request in native window.")
      expect(userTexts(s.requests[1]).filter((text) => text.includes("project-memory-data"))).toHaveLength(1)
      const published = (yield* recordedEventTypes(sessionID)).filter((type) => type === "session.synthetic.1").length
      s.currentModel = LanguageModel.update(s.currentModel, { id: "memory-other-deployment" })
      yield* s.runPrompt("Re-expanded project request.")
      expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.synthetic.1")).toHaveLength(
        published,
      )
      expect(JSON.stringify(s.requests[2])).not.toContain('"encrypted":"memory-window"')
      expect(userTexts(s.requests[2]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
    }),
)

memoryIt.effect("automatic project memory data does not refill a logical Step during provider retry", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.admit("Retry the same project request.")
    yield* s.llm.push(Stream.fail(incompleteStream()), TestLLM.text("Recovered", "memory-retry"))
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkIn(yield* Effect.scope))
    yield* Queue.take(scheduled)
    yield* s.memory.record({
      sessionID,
      projectID: s.location.project.id,
      factCategory: "api",
      content: "MC03_FACT_ADDED_DURING_RETRY",
    })
    yield* TestClock.adjust("2400 millis")
    yield* awaitWithTimeout(Fiber.join(run), "Memory retry did not settle")
    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[1])).toEqual(userTexts(s.requests[0]))
    expect(JSON.stringify(s.requests[1])).not.toContain("MC03_FACT_ADDED_DURING_RETRY")
    yield* s.runPrompt("A new project request.")
    expect(JSON.stringify(s.requests[2])).toContain("MC03_FACT_ADDED_DURING_RETRY")
  }),
)

memoryIt.effect("automatic project memory data retains visible facts after opt-out without copying changed rows", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.runPrompt("Read current project facts.")
    yield* s.config.setEntries([])
    yield* s.db
      .update(MetaAgentMemoryTable)
      .set({ content: "api_key=MC03_CHANGED_AFTER_OPT_OUT" })
      .where(eq(MetaAgentMemoryTable.id, s.factID))
      .run()
    yield* s.runPrompt("Continue after opt-out.")
    expect(s.requests).toHaveLength(2)
    expect(JSON.stringify(s.requests[1])).toContain("MC03_AUTO_MEMORY_DATA_20261102")
    expect(JSON.stringify(s.requests[1])).not.toContain("MC03_CHANGED_AFTER_OPT_OUT")
    expect(
      (yield* s.messages).filter(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      ),
    ).toHaveLength(1)
  }),
)

memoryIt.effect("automatic project memory data rejects an unsafe fact after cold compaction", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.runPrompt("Original delivered human request.")
    yield* s.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: "## Objective\n- Continue the task",
      recent: "",
    })
    yield* s.db
      .update(MetaAgentMemoryTable)
      .set({ content: "api_key=MC03_COLD_UNKNOWN_PUBLIC" })
      .where(eq(MetaAgentMemoryTable.id, s.factID))
      .run()
    const result = yield* s.resume.pipe(Effect.exit)
    expect(Exit.isFailure(result) && Cause.squash(result.cause)).toMatchObject({
      _tag: "MetaAgentMemory.InvalidFactError",
      id: s.factID,
      reason: "credential",
    })
    expect(s.requests).toHaveLength(1)
    expect(JSON.stringify(s.requests)).not.toContain("MC03_COLD_UNKNOWN_PUBLIC")
    expect((yield* s.context).some((message) => message.type === "user")).toBe(false)
    expect(
      (yield* s.context).some(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      ),
    ).toBe(false)
  }),
)

memoryIt.effect("automatic project memory data uses the durable human trigger after cold compaction", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    const trigger = yield* s.runPrompt("Original delivered human request.")
    yield* s.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: "## Objective\n- Continue the task",
      recent: "",
    })
    yield* s.db
      .update(MetaAgentMemoryTable)
      .set({ content: "MC03_PUBLIC_COLD_CHANGED_20261103 is ordinary project data." })
      .where(eq(MetaAgentMemoryTable.id, s.factID))
      .run()
    yield* s.resume
    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[1]).filter((text) => text.includes("MC03_PUBLIC_COLD_CHANGED_20261103"))).toHaveLength(
      1,
    )
    expect(s.requests[1].system.some((part) => part.text.includes("MC03_PUBLIC_COLD_CHANGED_20261103"))).toBe(false)
    const context = yield* s.context
    expect(context.some((message) => message.type === "user")).toBe(false)
    const data = context.find(
      (message) => message.type === "synthetic" && message.text.includes("MC03_PUBLIC_COLD_CHANGED_20261103"),
    )
    expect(data).toMatchObject({
      metadata: { projectMemory: { triggerMessageID: trigger.id } },
    })
    expect((yield* s.messages).some((message) => message.id === trigger.id && message.type === "user")).toBe(true)
  }),
)

memoryIt.effect("automatic project memory data rehydrates once after real automatic compaction", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "memory-before-compaction", 3_950))
    yield* s.runPrompt("Earlier question ".repeat(180))
    s.currentModel = compactModel
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the task", "memory-summary"),
      TestLLM.text("Continued", "memory-final"),
    )
    const trigger = yield* s.runPrompt("Recent exact request ".repeat(180))
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[2]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
    expect(s.requests[2].system.some((part) => part.text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(false)
    const data = (yield* s.context).filter(
      (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
    )
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ metadata: { projectMemory: { triggerMessageID: trigger.id } } })
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.compaction.ended.1")).toHaveLength(
      1,
    )
  }),
)

memoryIt.effect("automatic project memory data stops a second real compaction rehydration within one Step", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "memory-before-limit", 3_950))
    yield* s.runPrompt("Earlier question ".repeat(180))
    s.currentModel = compactModel
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the task", "memory-limit-summary"),
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Preserve the task again", "memory-limit-summary-2"),
    )
    yield* s.admit("Recent exact request ".repeat(180))
    const result = yield* s.resume.pipe(Effect.exit)
    expect(Exit.isFailure(result) && Cause.squash(result.cause)).toMatchObject({
      _tag: "SessionMemoryAdmission.Error",
      reason: "rehydration_limit",
    })
    expect(s.requests).toHaveLength(4)
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.compaction.ended.1")).toHaveLength(
      2,
    )
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.synthetic.1")).toHaveLength(2)
    const eventTypes = yield* recordedEventTypes(sessionID)
    expect(eventTypes.filter((type) => type === "session.step.started.1")).toHaveLength(2)
    expect(eventTypes.filter((type) => type === "session.attempt.started.1")).toHaveLength(2)
  }),
)

for (const selection of ["disabled", "build", "plan"] as const) {
  memoryIt.effect(`automatic project memory data skips ${selection} without reading unsafe facts`, () =>
    Effect.gen(function* () {
      const s = yield* setupMemory("deny")
      yield* s.db
        .update(MetaAgentMemoryTable)
        .set({ content: "api_key=MC03_SKIPPED_PUBLIC" })
        .where(eq(MetaAgentMemoryTable.id, s.factID))
        .run()
      if (selection === "disabled") yield* s.config.setEntries([])
      if (selection !== "disabled") {
        yield* s.agents.transform((editor) =>
          editor.update(Agent.ID.make(selection), (agent) => {
            agent.originKind = "builtin"
            agent.mode = "primary"
            agent.permissions = [{ action: "memory_search", resource: "*", effect: "deny" }]
          }),
        )
        yield* s.db.update(SessionTable).set({ agent: selection }).where(eq(SessionTable.id, sessionID)).run()
      }
      yield* s.runPrompt("Use the selected agent.")
      expect(s.requests).toHaveLength(1)
      expect(JSON.stringify(s.requests[0])).not.toContain("MC03_SKIPPED_PUBLIC")
      expect(
        (yield* s.messages).some(
          (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
        ),
      ).toBe(false)
    }),
  )
}

const pendingMemory = Effect.fnUntraced(function* (existing?: Effect.Success<ReturnType<typeof setupMemory>>) {
  const s = existing ?? (yield* setupMemory("ask"))
  const physicalBeforeApproval = s.requests.length
  const presence = yield* ApprovalPresence.Service
  yield* presence.bindResponder({ custom: true })
  const asked = yield* Deferred.make<Permission.Request>()
  const unsubscribe = yield* s.bus.listen((event) =>
    event.type === Permission.Event.Asked.type
      ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
      : Effect.void,
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  const trigger = yield* s.admit("Approve reading project facts.")
  const fiber = yield* s.resume.pipe(Effect.forkIn(yield* Effect.scope))
  const request = yield* awaitWithTimeout(
    Effect.raceFirst(
      Deferred.await(asked),
      Fiber.join(fiber).pipe(
        Effect.andThen(Effect.die(new Error("Automatic memory execution ended without an approval request"))),
      ),
    ),
    "Automatic memory did not ask for permission",
  )
  expect(request).toMatchObject({
    action: "memory_search",
    resources: [s.location.project.id],
    sessionID,
    metadata: { projectMemory: { triggerMessageID: trigger.id } },
  })
  expect(request.source).toBeUndefined()
  expect(s.requests).toHaveLength(physicalBeforeApproval)
  expect(
    (yield* s.context).some(
      (message) => message.type === "synthetic" && message.text.includes("MC03_AUTO_MEMORY_DATA_20261102"),
    ),
  ).toBe(false)
  return { s, fiber, request }
})

memoryIt.effect("automatic project memory data waits for real once approval", () =>
  Effect.gen(function* () {
    const pending = yield* pendingMemory()
    yield* pending.s.permission.reply({ requestID: pending.request.id, reply: "once" })
    yield* awaitWithTimeout(Fiber.join(pending.fiber), "Approved automatic memory did not settle")
    expect(pending.s.requests).toHaveLength(1)
    expect(userTexts(pending.s.requests[0]).some((text) => text.includes("MC03_AUTO_MEMORY_DATA_20261102"))).toBe(true)
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* pending.s.bus.listen((event) =>
      event.type === Permission.Event.Asked.type
        ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    yield* pending.s.admit("Read the facts in a new Step.")
    const next = yield* pending.s.resume.pipe(Effect.forkIn(yield* Effect.scope))
    const request = yield* awaitWithTimeout(Deferred.await(asked), "The new Step did not request a new authorization")
    expect(request.id).not.toBe(pending.request.id)
    expect(pending.s.requests).toHaveLength(1)
    yield* pending.s.permission.reply({ requestID: request.id, reply: "once" })
    yield* awaitWithTimeout(Fiber.join(next), "The second authorized Step did not settle")
    expect(pending.s.requests).toHaveLength(2)
    expect(
      (yield* pending.s.messages).filter(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      ),
    ).toHaveLength(1)
  }),
)

memoryIt.effect("automatic project memory data retains its admitted model window across approval suspension", () =>
  Effect.gen(function* () {
    const s = yield* setupMemory()
    yield* s.runPrompt("Project request before a native checkpoint.")
    const selectedModel = s.currentModel
    const target = SessionProviderContext.provenance({
      model: selectedModel,
      ref: Model.Ref.make({
        id: Model.ID.make(selectedModel.id),
        providerID: Provider.ID.make(selectedModel.provider),
      }),
    })
    if (!target) return yield* Effect.die(new Error("Missing fixture model provenance"))
    yield* s.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: "",
      recent: "",
      providerContext: SessionProviderContext.encode(target, [
        Message.assistant(
          CompactionPart.make({ provider: selectedModel.provider, encrypted: "memory-approval-window" }),
        ),
      ]),
    })
    yield* s.agents.transform((editor) =>
      editor.update(Agent.ID.make("meta"), (agent) => {
        agent.permissions = [{ action: "memory_search", resource: "*", effect: "ask" }]
      }),
    )
    const pending = yield* pendingMemory(s)
    s.currentModel = LanguageModel.update(selectedModel, { id: "changed-during-memory-approval" })
    yield* s.permission.reply({ requestID: pending.request.id, reply: "once" })
    yield* awaitWithTimeout(Fiber.join(pending.fiber), "Model-window approval did not settle")
    expect(s.requests).toHaveLength(2)
    expect(s.requests[1].model.id).toBe(selectedModel.id)
    expect(JSON.stringify(s.requests[1])).toContain('"encrypted":"memory-approval-window"')
    expect(userTexts(s.requests[1]).filter((text) => text.includes("project-memory-data"))).toHaveLength(1)
  }),
)

memoryIt.effect("automatic project memory data preserves real rejection and interruption", () =>
  Effect.gen(function* () {
    const pending = yield* pendingMemory()
    yield* pending.s.permission.reply({ requestID: pending.request.id, reply: "reject" })
    const result = yield* awaitWithTimeout(Fiber.await(pending.fiber), "Rejected automatic memory did not settle")
    expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true)
    expect(pending.s.requests).toHaveLength(0)
    expect(yield* pending.s.permission.forSession(sessionID)).toEqual([])
  }),
)

memoryIt.effect("automatic project memory data cancels a pending authorization", () =>
  Effect.gen(function* () {
    const pending = yield* pendingMemory()
    yield* pending.s.session.interrupt(sessionID)
    const result = yield* Fiber.await(pending.fiber)
    expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true)
    expect(pending.s.requests).toHaveLength(0)
    expect(yield* pending.s.permission.forSession(sessionID)).toEqual([])
  }),
)

memoryIt.effect("automatic project memory data rechecks opt-out while awaiting approval", () =>
  Effect.gen(function* () {
    const pending = yield* pendingMemory()
    yield* pending.s.config.setEntries([])
    yield* pending.s.db
      .update(MetaAgentMemoryTable)
      .set({ content: "api_key=MC03_REVOKED_PUBLIC" })
      .where(eq(MetaAgentMemoryTable.id, pending.s.factID))
      .run()
    yield* pending.s.permission.reply({ requestID: pending.request.id, reply: "once" })
    yield* awaitWithTimeout(Fiber.join(pending.fiber), "Opted-out automatic memory did not settle")
    expect(pending.s.requests).toHaveLength(1)
    expect(JSON.stringify(pending.s.requests[0])).not.toContain("MC03_REVOKED_PUBLIC")
  }),
)

memoryIt.effect("automatic project memory data rechecks Session placement after approval", () =>
  Effect.gen(function* () {
    const pending = yield* pendingMemory()
    yield* pending.s.db
      .update(SessionTable)
      .set({ project_id: Project.ID.global })
      .where(eq(SessionTable.id, sessionID))
      .run()
    yield* pending.s.permission.reply({ requestID: pending.request.id, reply: "once" })
    const result = yield* awaitWithTimeout(Fiber.await(pending.fiber), "Moved automatic memory did not settle")
    expect(Exit.isFailure(result) && Cause.squash(result.cause)).toMatchObject({
      _tag: "SessionMemoryAdmission.Error",
      reason: "selection_changed",
    })
    expect(pending.s.requests).toHaveLength(0)
    expect(
      (yield* pending.s.messages).some(
        (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
      ),
    ).toBe(false)
  }),
)

for (const content of ["api_key=MC03_LEGACY_AUTO_PUBLIC", "x".repeat(2001)]) {
  memoryIt.effect(
    "automatic project memory data rejects unsafe legacy copies before provider execution: " +
      (content.length > 2000 ? "length" : "credential"),
    () =>
      Effect.gen(function* () {
        const s = yield* setupMemory()
        yield* s.db.update(MetaAgentMemoryTable).set({ content }).where(eq(MetaAgentMemoryTable.id, s.factID)).run()
        yield* s.admit("Read stored facts.")
        const result = yield* s.resume.pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(s.requests).toHaveLength(0)
        expect(
          (yield* s.messages).some(
            (message) => message.type === "synthetic" && message.text.includes("project-memory-data"),
          ),
        ).toBe(false)
      }),
  )
}

type Scenario = Effect.Success<typeof setup>
const scenario = (
  name: string,
  body: (s: Scenario) => Effect.gen.Return<void, unknown, Layer.Success<typeof layer> | Scope.Scope>,
  transport = false,
) =>
  (transport ? wireIt : it).effect(
    name,
    Effect.gen(function* () {
      const s = yield* setup
      yield* body(s)
      if (!transport) return
      const observations = (yield* s.messages).flatMap((message) => message.type === "assistant"
        ? message.attempts?.flatMap((attempt) => attempt.observations) ?? []
        : [])
      expect(observations).toEqual(expect.arrayContaining([expect.objectContaining({
        transport: "http", delivery: "accepted", deployment: expect.objectContaining({
          protocol: "session-test-events", connection: { type: "env", name: "SESSION_WIRE_KEEPER" },
        }),
      })]))
    }),
  )

// Nominal retry gaps: exponential from 2s capped at 10s, for 10 retries.
const RETRY_GAPS = [2_000, 4_000, 8_000, ...Array<number>(7).fill(10_000)]
// Longest possible gap per retry (+20% jitter); advancing the clock by these always fires the retry.
const RETRY_GAPS_MAX = RETRY_GAPS.map((gap) => gap * 1.2)
const RETRY_ATTEMPTS = RETRY_GAPS.map((_, index) => index + 2)

// Subscribe before resuming; model requests can arrive before retry backoff is scheduled.
const subscribeRetries = (s: Scenario) =>
  Effect.gen(function* () {
    const scheduled = yield* Queue.unbounded<SessionMessage.ID>()
    yield* s.bus.subscribe(SessionEvent.RetryScheduled).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.runForEach((event) => Queue.offer(scheduled, event.data.assistantMessageID)),
      Effect.forkScoped({ startImmediately: true }),
    )
    return scheduled
  })

const providerUnavailable = () =>
  new AIError({
    reason: new TransportError({
      message: "Provider unavailable",
      transport: "http",
      operation: "request",
    }),
  })

const streamDisconnected = () =>
  new AIError({
    reason: new TransportError({
      message: "The socket connection was closed unexpectedly",
      transport: "http",
      operation: "read",
    }),
  })

const continuationRejected = (recovery: "retry-full" | "rotate-and-retry-full") =>
  new AIError({
    reason: new TransportError({
      message: "Continuation rejected",
      transport: "websocket",
      operation: "read",
      phase: "receive",
      delivery: "rejected",
      recovery,
    }),
  })

const websocketDisconnected = () =>
  new AIError({
    reason: new TransportError({
      message: "WebSocket closed with code 1006",
      transport: "websocket",
      operation: "read",
      phase: "close",
      code: "1006",
      delivery: "accepted",
    }),
  })

const incompleteStream = () =>
  new AIError({
    reason: new InvalidProviderOutputError({
      classification: "incomplete-stream",
      message: "The provider response ended unexpectedly.",
    }),
  })

const INCOMPLETE_STREAM_CONTINUATION =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const invalidRequest = () =>
  new AIError({
    reason: new InvalidRequestError({ message: "Invalid request" }),
  })

const payloadTooLarge = () =>
  new AIError({
    reason: new InvalidRequestError({ message: "Too large", classification: "payload-too-large" }),
  })

const rateLimited = (retryAfterMs?: number) =>
  new AIError({
    reason: new RateLimitError({ message: "Rate limited", retryAfterMs }),
  })

const groupID = Model.GroupID.make("p3-fallback")
const groupSelection = new Model.GroupRef({ type: "group", groupID })
const groupA = Model.Ref.parse("p3-primary/a")
const groupSibling = Model.Ref.parse("p3-primary/a-sibling")
const groupB = Model.Ref.parse("p3-backup/b")
const groupC = Model.Ref.parse("p3-single/c")
const groupDefinition = (members: readonly ModelGroup.Member[] = [groupA, groupB]) => new ModelGroup.Definition({
  name: "P3 fallback", enabled: true, members: [...members], strategy: "order", affinity: "turn",
})
const groupDocument = (definition?: ModelGroup.Definition, priced = false) => new Document({
  type: "document", info: Schema.decodeUnknownSync(Info)({
    modelGroups: definition === undefined ? {} : { [groupID]: definition },
    providers: {
      "p3-primary": {
        package: "@aigcfroge/ai/providers/openai-compatible", settings: { baseURL: "https://fixture.invalid/v1" },
        models: {
          a: { modelID: "api-a", ...(priced ? { cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }] } : {}) },
          "a-sibling": { modelID: "api-a-sibling" },
        },
      },
      "p3-backup": {
        package: "@aigcfroge/ai/providers/openai-compatible", settings: { baseURL: "https://fixture.invalid/v1" },
        models: { b: { modelID: "api-b", ...(priced ? { cost: [{ input: 4, output: 5, cache: { read: 0, write: 0 } }] } : {}) } },
      },
      "p3-single": {
        package: "@aigcfroge/ai/providers/openai-compatible", settings: { baseURL: "https://fixture.invalid/v1" },
        models: { c: { modelID: "api-c" } },
      },
    },
  }),
})
const setupGroup = Effect.fnUntraced(function* (definition = groupDefinition(), priced = false) {
  const s = yield* setup
  const config = yield* Config.Test
  const providers = yield* Provider.Service
  const integrations = yield* Integration.Service
  const models = yield* Model.Service
  const agents = yield* Agent.Service
  const document = groupDocument(definition, priced)
  yield* config.setEntries([document])
  yield* ConfigProviderPlugin.Plugin.effect(host({
    model: modelHost(models), provider: providerHost(providers), integration: integrationHost(integrations),
  }))
  yield* Effect.forEach([groupA.providerID, groupB.providerID, groupC.providerID], (providerID) =>
    integrations.connection.key({ integrationID: Integration.ID.make(providerID), key: `fixture-${providerID}` }),
    { discard: true },
  )
  if (priced) yield* models.transform((editor) => {
    [groupA, groupB].forEach((ref) => editor.update(ref.providerID, ref.id, (model) => {
      Object.assign(model, ProviderDiscovery.resolveMetadata({
        user: document.info.providers?.[ref.providerID]?.models?.[ref.id], runtime: model,
      }))
    }))
  })
  yield* models.reload()
  yield* agents.transform((editor) => editor.remove(Agent.ID.make("title")))
  yield* s.bus.publish(SessionEvent.ModelSelected, { sessionID, model: groupSelection })
  return {
    s, config,
    // The public virtual Location fixture has no group catalog; B and Server keepers own public selection.
    admit: (text: string) => s.sessionInbox.admit({
      id: SessionMessage.ID.create(), sessionID, item: { type: "user", payload: { text }, delivery: "steer" },
    }),
  }
})

describe("P3 model groups through the original runner", () => {
  groupIt.effect("preserves the selected group and no-candidates reason when every member is unavailable", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(groupDefinition([Model.Ref.parse("p3-primary/missing")]))
    const s = fixture.s
    yield* fixture.admit("Keep the unavailable group selected")
    expect(yield* s.resume.pipe(Effect.result)).toMatchObject({
      _tag: "Failure", failure: { _tag: "ModelGroup.Unavailable", groupID, reason: "no-candidates" },
    })
    expect((yield* s.session.get(sessionID))?.model).toEqual(groupSelection)
    expect(s.requests).toEqual([])
    expect((yield* s.context).filter((message) => message.type === "assistant")).toEqual([])
  }))

  groupIt.effect("keeps fallback B across following tool Steps and retains physical catalog and account identities", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const s = fixture.s
    yield* fixture.admit("Fall back, execute once, and continue")
    yield* s.llm.push(
      Stream.fail(new AIError({ reason: new AuthenticationError({ message: "Account A rejected" }) })),
      TestLLM.tool("p3-echo", "echo", { text: "once" }),
      TestLLM.text("Done", "p3-done"),
    )
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b", "api-b"])
    expect(s.executions).toEqual(["once"])
    const messages = (yield* s.context).filter((message): message is SessionMessage.Assistant => message.type === "assistant")
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ model: groupB, attempts: [
      { ordinal: 0, selection: groupSelection, model: groupA, apiModelID: "api-a", terminal: { status: "failed" } },
      { ordinal: 1, selection: groupSelection, model: groupB, apiModelID: "api-b", transition: "fallback", terminal: { status: "completed" } },
    ] })
    expect(messages[1]).toMatchObject({ model: groupB, attempts: [{ ordinal: 0, model: groupB }] })
    expect(messages[0].attempts?.[0].connection?.type).toBe("credential")
    expect(messages[0].attempts?.[0].connection).not.toEqual(messages[0].attempts?.[1].connection)
    expect((yield* s.session.get(sessionID))?.model).toEqual(groupSelection)
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.step.started.1")).toHaveLength(2)
  }))

  groupIt.effect("clears the drain's binding when the Session becomes idle", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const s = fixture.s
    yield* fixture.admit("Finish on B")
    yield* s.llm.push(Stream.fail(new AIError({ reason: new AuthenticationError({ message: "A rejected" }) })), TestLLM.text("B finished", "p3-idle-b"))
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    yield* fixture.admit("Start a fresh turn")
    yield* s.llm.push(TestLLM.text("A answered again", "p3-idle-a"))
    yield* s.resume
    expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b", "api-a"])
  }))

  for (const change of ["name", "behavior", "promotion"] as const) {
    groupIt.effect(`rechecks ${change} at the held tool boundary while preserving completed tool work`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const s = fixture.s
      yield* fixture.admit("Hold B's tool boundary")
      yield* s.llm.push(
        Stream.fail(new AIError({ reason: new AuthenticationError({ message: "Account A rejected" }) })),
        TestLLM.tool("p3-held", "echo", { text: "held-once" }),
        TestLLM.text("Continued", "p3-continued"),
      )
      const scheduled = yield* subscribeRetries(s)
      const tools = yield* s.blockTools()
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* tools.started
      const original = ModelGroup.snapshot(groupID, groupDefinition())
      if (change === "name") yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition(), name: "Renamed only" }))])
      if (change === "behavior") yield* fixture.config.setEntries([groupDocument(groupDefinition([groupC, groupB]))])
      if (change === "promotion") yield* fixture.admit("Use the next prompt's fresh binding")
      yield* tools.release
      yield* Fiber.join(run)
      expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b", change === "name" ? "api-b" : change === "behavior" ? "api-c" : "api-a"])
      expect(s.executions).toEqual(["held-once"])
      const assistants = (yield* s.context).filter((message): message is SessionMessage.Assistant => message.type === "assistant")
      expect(assistants[0].attempts?.map((attempt) => attempt.behaviorDigest)).toEqual([original.behaviorDigest, original.behaviorDigest])
      if (change === "name") expect(assistants[1].attempts?.[0].behaviorDigest).toBe(original.behaviorDigest)
      if (change === "behavior") expect(assistants[1].attempts?.[0].behaviorDigest).not.toBe(original.behaviorDigest)
      if (change === "promotion") expect((yield* s.context).filter((message) => message.type === "user")).toHaveLength(2)
    }))
  }

  for (const reason of ["disabled", "missing"] as const) {
    groupIt.effect(`stops the next generation when the active group becomes ${reason} during a held tool`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const s = fixture.s
      yield* fixture.admit("Stop after this completed tool")
      yield* s.llm.push(TestLLM.tool("p3-disabled-tool", "echo", { text: "settled-once" }), TestLLM.text("Must not run", "p3-unused-disabled"))
      const tools = yield* s.blockTools()
      const run = yield* s.resume.pipe(Effect.result, Effect.forkChild)
      yield* tools.started
      yield* fixture.config.setEntries([groupDocument(reason === "disabled" ? new ModelGroup.Definition({ ...groupDefinition(), enabled: false }) : undefined)])
      yield* tools.release
      expect(yield* Fiber.join(run)).toMatchObject({ _tag: "Failure", failure: { _tag: "ModelGroup.Unavailable", reason } })
      expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a"])
      expect(s.executions).toEqual(["settled-once"])
      expect(requireAssistant(yield* s.context)).toMatchObject({ attempts: [{ terminal: { status: "completed" } }] })
    }))
  }

  groupIt.effect("uses the committed single Selection when the in-flight group is disabled before fallback preview", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const s = fixture.s
    yield* fixture.admit("Switch the in-flight group to C")
    yield* s.llm.push(Stream.fail(new AIError({ reason: new AuthenticationError({ message: "Old account rejected" }) })), TestLLM.text("C answered", "p3-single-answer"))
    const scheduled = yield* subscribeRetries(s)
    const gate = yield* s.llm.gate
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* gate.started
    yield* s.bus.publish(SessionEvent.ModelSelected, { sessionID, model: groupC })
    yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition(), enabled: false }))])
    yield* gate.release
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-c"])
    const assistant = requireAssistant(yield* s.context)
    expect(assistant).toMatchObject({ model: groupC, attempts: [
      { ordinal: 0, selection: groupSelection, model: groupA },
      { ordinal: 1, selection: groupC, model: groupC },
    ] })
    expect(assistant.attempts?.[0].behaviorDigest).toBeDefined()
    expect(assistant.attempts?.[1].behaviorDigest).toBeUndefined()
    expect((yield* s.session.get(sessionID))?.model).toEqual({ ...groupC, variant: Model.VariantID.make("default") })
  }))

  for (const reason of ["model-not-found", "authentication", "quota"] as const) {
    groupIt.effect(`uses the original account policy for typed ${reason} fallback`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup(groupDefinition([groupA, groupSibling, groupB]))
      const s = fixture.s
      yield* fixture.admit("Select the next applicable candidate")
      const failure = new AIError({ reason: reason === "model-not-found"
        ? new InvalidRequestError({ message: "Model is absent", classification: "model-not-found" })
        : reason === "authentication" ? new AuthenticationError({ message: "Account rejected" })
        : new QuotaExceededError({ message: "Account quota exhausted" }) })
      yield* s.llm.push(Stream.fail(failure), TestLLM.text("Recovered", "p3-policy-recovery"))
      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)
      const target = reason === "authentication" ? groupB : groupSibling
      expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", reason === "authentication" ? "api-b" : "api-a-sibling"])
      const assistant = requireAssistant(yield* s.context)
      expect(assistant).toMatchObject({ model: target, attempts: [{ model: groupA }, { model: target }] })
      expect(assistant.attempts?.[0].connection?.type).toBe("credential")
      if (reason !== "authentication") expect(assistant.attempts?.[1].connection).toEqual(assistant.attempts?.[0].connection)
      if (reason === "authentication") expect(assistant.attempts?.[1].connection).not.toEqual(assistant.attempts?.[0].connection)
    }))
  }

  groupIt.effect("shares the original retry allowance across candidate advancement and same-model retries", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const s = fixture.s
    yield* fixture.admit("Exhaust one shared allowance")
    yield* s.llm.push(...Array.from({ length: RETRY_GAPS.length + 1 }, () => Stream.fail(providerUnavailable())))
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.result, Effect.forkChild)
    for (const delay of RETRY_GAPS_MAX) {
      yield* Queue.take(scheduled)
      yield* TestClock.adjust(delay)
    }
    expect(yield* Fiber.join(run)).toMatchObject({ _tag: "Failure", failure: { _tag: "Session.StepFailedError", error: { type: "model-group.retry-budget" } } })
    expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", ...Array<string>(RETRY_GAPS.length).fill("api-b")])
    const assistant = requireAssistant(yield* s.context)
    expect(assistant.attempts).toHaveLength(RETRY_GAPS.length + 1)
    expect(assistant.attempts?.every((attempt) => attempt.terminal?.status === "failed")).toBe(true)
    const events = yield* recordedEventTypes(sessionID)
    expect(events.filter((type) => type === "session.step.started.1")).toHaveLength(1)
    expect(events.filter((type) => type === "session.retry.scheduled.1")).toHaveLength(RETRY_GAPS.length)
  }))

  groupIt.effect("continues partial output on a new Assistant without repeating a settled local tool", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const s = fixture.s
    yield* fixture.admit("Continue the partial answer")
    yield* s.llm.push(TestLLM.failAfter(streamDisconnected(),
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "p3-partial" }), LLMEvent.textDelta({ id: "p3-partial", text: "Partial" }), LLMEvent.textEnd({ id: "p3-partial" }),
      LLMEvent.toolCall({ id: "p3-partial-tool", name: "echo", input: { text: "executed-once" } }),
    ), TestLLM.text("Completed", "p3-continuation"))
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b"])
    expect(s.executions).toEqual(["executed-once"])
    const assistants = (yield* s.context).filter((message): message is SessionMessage.Assistant => message.type === "assistant")
    expect(assistants).toHaveLength(2)
    expect(assistants[0].id).not.toBe(assistants[1].id)
    expect(assistants[0]).toMatchObject({ attempts: [{ model: groupA, terminal: { status: "failed", outputStarted: true } }] })
    expect(assistants[1]).toMatchObject({ attempts: [{ model: groupB, transition: "continuation", terminal: { status: "completed" } }] })
    expect(s.requests[1].messages.filter((message) => message.role === "tool")).toHaveLength(1)
    expect((yield* s.context).filter((message) => message.type === "synthetic" && message.text === INCOMPLETE_STREAM_CONTINUATION)).toHaveLength(1)
  }))

  for (const kind of ["reasoning", "tool input"] as const) {
    groupIt.effect(`continues partial ${kind} on fallback B while retaining the original Assistant`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const s = fixture.s
      const fragment = fragmentFixture(kind, `p3-partial-${kind}`, [kind === "reasoning" ? "Partial thought" : '{"text":"partial'])
      yield* fixture.admit(`Continue after unfinished ${kind}`)
      yield* s.llm.push(TestLLM.failAfter(streamDisconnected(), ...fragment.partialEvents), TestLLM.text("Completed", "p3-fragment-completed"))
      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)
      expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b"])
      expect(s.executions).toEqual([])
      const assistants = (yield* s.context).filter((message): message is SessionMessage.Assistant => message.type === "assistant")
      expect(assistants).toHaveLength(2)
      expect(assistants[0].id).not.toBe(assistants[1].id)
      expect(assistants[0]).toMatchObject({ model: groupA, attempts: [{ model: groupA, terminal: { status: "failed", outputStarted: true } }] })
      expect(assistants[1]).toMatchObject({ model: groupB, attempts: [{ model: groupB, transition: "continuation", terminal: { status: "completed" } }] })
      if (kind === "reasoning") {
        expect(assistants[0].content).toMatchObject([fragment.expectedContent])
        expect(s.requests[1].messages).toContainEqual(expect.objectContaining({
          role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Partial thought" })]),
        }))
      }
      if (kind === "tool input") expect(assistants[0].content).toMatchObject([{ type: "tool", id: `p3-partial-${kind}`, state: { status: "error" } }])
      expect((yield* s.context).filter((message) => message.type === "synthetic" && message.text === INCOMPLETE_STREAM_CONTINUATION)).toHaveLength(1)
    }))
  }

  for (const status of ["completed", "failed", "cancelled"] as const) {
    groupIt.effect(`settles differently priced group attempts once when fallback B is ${status}`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup(groupDefinition(), true)
      const s = fixture.s
      const ready = yield* Deferred.make<void>()
      const second = [LLMEvent.stepStart({ index: 0 }), LLMEvent.stepFinish({
        index: 0, reason: { normalized: "stop" },
        usage: { inputTokens: 1_000, nonCachedInputTokens: 1_000, outputTokens: 2_000, reasoningTokens: 1_000 },
      })]
      yield* fixture.admit("Keep each physical attempt's own quote")
      yield* s.llm.push(
        TestLLM.failAfter(streamDisconnected(), LLMEvent.stepStart({ index: 0 }), LLMEvent.stepFinish({
          index: 0, reason: { normalized: "stop" }, usage: { inputTokens: 1_000, nonCachedInputTokens: 1_000, outputTokens: 1_000 },
        })),
        status === "completed" ? [...second, LLMEvent.finish({ reason: { normalized: "stop" } })]
          : status === "failed" ? TestLLM.failAfter(invalidRequest(), ...second)
          : Stream.concat(Stream.fromIterable(second), Stream.fromEffect(Deferred.succeed(ready, undefined)).pipe(Stream.flatMap(() => Stream.never))),
      )
      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.result, Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      if (status === "cancelled") {
        yield* awaitWithTimeout(Deferred.await(ready), "Fallback B did not reach its held provider stream")
        expect(yield* s.session.interrupt(sessionID)).toBe(true)
        expect(Exit.hasInterrupts(yield* awaitWithTimeout(Fiber.await(run), "The cancelled Session owner did not settle"))).toBe(true)
      }
      if (status !== "cancelled") expect((yield* Fiber.join(run))._tag).toBe(status === "completed" ? "Success" : "Failure")
      expect(s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b"])
      const assistant = requireAssistant(yield* s.context)
      expect(assistant.attempts).toHaveLength(2)
      expect(assistant.attempts?.[0]).toMatchObject({ model: groupA, quoteOrigin: "user", quote: { status: "known", prices: [{ input: 1, output: 2 }] }, terminal: { status: "failed", usage: { input: 1_000, output: 1_000 } } })
      expect(assistant.attempts?.[1]).toMatchObject({ model: groupB, quoteOrigin: "user", quote: { status: "known", prices: [{ input: 4, output: 5 }] }, terminal: { status, usage: { input: 1_000, output: 1_000, reasoning: 1_000 } } })
      expect(assistant.attempts?.[0].terminal?.cost).toBeCloseTo(0.003, 10)
      expect(assistant.attempts?.[1].terminal?.cost).toBeCloseTo(0.014, 10)
      expect(assistant.cost).toBeCloseTo(0.017, 10)
      expect(assistant).toMatchObject({ unknownPriceAttempts: 0, missingUsageAttempts: 0, tokens: { input: 2_000, output: 2_000, reasoning: 1_000 } })
      const goals = yield* SessionGoal.Service
      yield* SessionStep.reconcile(s.db, s.bus, goals, sessionID)
      yield* SessionStep.reconcile(s.db, s.bus, goals, sessionID)
      expect((yield* s.session.get(sessionID))?.cost).toBeCloseTo(0.017, 10)
      const events = yield* recordedEventTypes(sessionID)
      expect(events.filter((type) => type === "session.attempt.ended.1")).toHaveLength(2)
      expect(events.filter((type) => type === "session.step.ended.1" || type === "session.step.failed.1")).toHaveLength(1)
    }))
  }
})

const groupAccounts = Effect.fnUntraced(function* () {
  const integrations = yield* Integration.Service
  const active = yield* integrations.connection.active(Integration.ID.make(groupA.providerID))
  if (active?.type !== "credential") return yield* Effect.die(new Error("The group fixture requires its original credential"))
  const credentials = yield* Credential.Service
  const alternate = yield* credentials.create({
    integrationID: Integration.ID.make(groupA.providerID), activate: false,
    value: Credential.Key.make({ type: "key", key: "fixture-alternate", configuration: { baseURL: "https://alternate-fixture.invalid/v1" } }),
  })
  return {
    integrations, credentials,
    active: { type: "credential" as const, id: active.id },
    alternate: { type: "credential" as const, id: alternate.id },
  }
})

describe("P4 model group reservations through the original runner", () => {
  groupIt.effect("reprepares stale choices before Goal admission and runs two different Session streams concurrently", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "rotate" }))
    const s = fixture.s
    const metas = yield* MetaAgentService.Service
    const goals = yield* SessionGoal.Service
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => editor.update(Agent.ID.make("meta"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
    }))
    yield* insertSession(otherSessionID)
    const owners = yield* Effect.forEach([sessionID, otherSessionID], (id) => Effect.gen(function* () {
      const meta = yield* metas.create({ title: `Reservation ${id}`, agent: "meta", model: Model.Ref.parse("fake/fake-model") })
      yield* s.db.update(SessionTable).set({ agent: "meta", controller: new MetaAgent.RootController({
        kind: "root", metaAgentID: meta.id, rootSessionID: id,
      }) }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)
      yield* metas.attach({ metaID: meta.id, sessionID: id, role: "orchestrator" })
      yield* s.bus.publish(SessionEvent.ModelSelected, { sessionID: id, model: groupSelection })
      const goal = yield* goals.set({ sessionID: id, objective: "Hold one real group attempt", budget: { rounds: 1, attempts: 1, steps: 1 },
        conditions: [SessionGoal.Condition.make({ id: "accept", kind: "human_acceptance", description: "Accept the result" })],
      })
      expect((yield* goals.advance({ sessionID: id, goalID: goal.id })).state).toBe("admitted")
      return { sessionID: id, goalID: goal.id }
    }))
    const preparedReady = yield* Deferred.make<void>()
    const preparedRelease = yield* Deferred.make<void>()
    const reprepareReady = yield* Deferred.make<Session.ID>()
    const reprepareRelease = yield* Deferred.make<void>()
    const streamsReady = yield* Deferred.make<void>()
    const streamsRelease = yield* Deferred.make<void>()
    const preparations: { sessionID: Session.ID; model: Model.Ref }[] = []
    let active = 0
    let maxActive = 0
    yield* (yield* PluginHooks.Service).register("session", "model.request", (event) => Effect.gen(function* () {
      if (event.kind !== "primary") return
      preparations.push({ sessionID: event.sessionID, model: event.model })
      if (preparations.length <= 2) {
        if (preparations.length === 2) yield* Deferred.succeed(preparedReady, undefined)
        yield* Deferred.await(preparedRelease)
        return
      }
      if (preparations.length === 3) {
        yield* Deferred.succeed(reprepareReady, event.sessionID)
        yield* Deferred.await(reprepareRelease)
      }
    }))
    yield* s.llm.push(...["one", "two"].map((id) => Stream.unwrap(Effect.gen(function* () {
      active++
      maxActive = Math.max(maxActive, active)
      if (active === 2) yield* Deferred.succeed(streamsReady, undefined)
      yield* Deferred.await(streamsRelease)
      return Stream.fromIterable(TestLLM.text("Done", `p4-concurrent-${id}`))
    }).pipe(Effect.ensuring(Effect.sync(() => active--))))))
    const scope = yield* Scope.Scope
    const runs = yield* Effect.forEach([sessionID, otherSessionID], (id) => s.session.resume(id).pipe(Effect.forkIn(scope)))
    yield* awaitWithTimeout(Deferred.await(preparedReady), "Both Sessions did not prepare their initial group candidate")
    expect(preparations.map((entry) => entry.model)).toEqual([groupA, groupA])
    yield* Deferred.succeed(preparedRelease, undefined)
    const stale = yield* awaitWithTimeout(Deferred.await(reprepareReady), "The stale candidate was not reprepared before admission")
    yield* awaitWithTimeout(s.llm.wait(1), "The winning Session did not enter its provider stream")
    expect(preparations[2]?.model).toEqual(groupB)
    for (const owner of owners) {
      const goal = yield* goals.get(owner)
      expect(goal?.accounting.coordinator.attempts).toBe(owner.sessionID === stale ? 0 : 1)
    }
    expect(s.executions).toEqual([])
    expect(s.requests).toHaveLength(1)
    yield* Deferred.succeed(reprepareRelease, undefined)
    yield* awaitWithTimeout(Deferred.await(streamsReady), "The group reservation mutex held a provider stream")
    expect(active).toBe(2)
    expect(maxActive).toBe(2)
    expect(s.requests.map((request) => String(request.model.id)).toSorted()).toEqual(["api-a", "api-b"])
    for (const owner of owners) {
      const goal = yield* goals.get(owner)
      const assistant = requireAssistant(yield* s.session.context(owner.sessionID))
      expect(goal?.attempts).toHaveLength(1)
      expect(assistant.attempts).toHaveLength(1)
      expect(goal?.attempts[0]?.id).toBe(assistant.attempts?.[0]?.attemptID)
      expect(assistant.attempts?.[0].ordinal).toBe(0)
    }
    yield* Deferred.succeed(streamsRelease, undefined)
    yield* Effect.forEach(runs, Fiber.join, { discard: true })
    const events = (yield* Effect.forEach([sessionID, otherSessionID], recordedEventTypes)).flat()
    expect(events.filter((type) => type === "session.attempt.started.1")).toHaveLength(2)
    expect(events.filter((type) => type === "session.retry.scheduled.1")).toEqual([])
    expect(s.executions).toEqual([])
    expect(preparations).toHaveLength(3)
  }))

  groupIt.effect("allocates member shares before applying account weights inside a member", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    const definition = new ModelGroup.Definition({ ...groupDefinition(), strategy: "weight", members: [
      { ...groupA, weight: 1, connections: [{ ref: accounts.active, weight: 1 }, { ref: accounts.alternate, weight: 3 }] },
      { ...groupB, weight: 1 },
    ] })
    yield* fixture.config.setEntries([groupDocument(definition)])
    for (const index of Array.from({ length: 16 }, (_, index) => index)) {
      yield* fixture.admit(`Weighted request ${index}`)
      yield* fixture.s.llm.push(TestLLM.text("Done", `p4-weight-${index}`))
      yield* fixture.s.resume
    }
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts).toHaveLength(16)
    expect(attempts.filter((attempt) => attempt.groupMemberIndex === 0)).toHaveLength(8)
    expect(attempts.filter((attempt) => attempt.groupMemberIndex === 1)).toHaveLength(8)
    expect(attempts.filter((attempt) => attempt.connection?.type === "credential" && attempt.connection.id === accounts.active.id)).toHaveLength(2)
    expect(attempts.filter((attempt) => attempt.connection?.type === "credential" && attempt.connection.id === accounts.alternate.id)).toHaveLength(6)
    expect(yield* accounts.integrations.connection.active(Integration.ID.make(groupA.providerID))).toMatchObject(accounts.active)
    expect(fixture.s.requests).toHaveLength(16)
  }))

  groupIt.effect("advances to another explicit connection of the same model and retains the actual connection across tool Steps", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    yield* fixture.config.setEntries([groupDocument(groupDefinition([{ ...groupA, connections: [{ ref: accounts.active }, { ref: accounts.alternate }] }]))])
    yield* fixture.admit("Use the second account after the first rejects")
    yield* fixture.s.llm.push(
      Stream.fail(new AIError({ reason: new AuthenticationError({ message: "First account rejected" }) })),
      TestLLM.tool("p4-account-tool", "echo", { text: "account-once" }),
      TestLLM.text("Done", "p4-account-done"),
    )
    const scheduled = yield* subscribeRetries(fixture.s)
    const run = yield* fixture.s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts.map((attempt) => attempt.model)).toEqual([groupA, groupA, groupA])
    expect(attempts.map((attempt) => attempt.connection)).toEqual([accounts.active, accounts.alternate, accounts.alternate])
    expect(attempts.map((attempt) => attempt.groupMemberIndex)).toEqual([0, 0, 0])
    expect(fixture.s.requests.map((request) => request.model.route.endpoint.baseURL)).toEqual([
      "https://fixture.invalid/v1", "https://alternate-fixture.invalid/v1", "https://alternate-fixture.invalid/v1",
    ])
    expect(fixture.s.executions).toEqual(["account-once"])
    expect(yield* accounts.integrations.connection.active(Integration.ID.make(groupA.providerID))).toMatchObject(accounts.active)
  }))

  for (const policy of ["omitted", "empty"] as const) {
    groupIt.effect(`keeps ${policy} connections explicit without automatically expanding all accounts`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const accounts = yield* groupAccounts()
      yield* fixture.config.setEntries([groupDocument(groupDefinition([
        { ...groupA, ...(policy === "empty" ? { connections: [] } : {}) }, groupB,
      ]))])
      yield* fixture.admit("Honor the authored connection policy")
      yield* fixture.s.llm.push(...(policy === "omitted" ? [Stream.fail(new AIError({ reason: new AuthenticationError({ message: "Active account rejected" }) }))] : []),
        TestLLM.text("Backup", "p4-connection-policy"))
      if (policy === "omitted") {
        const scheduled = yield* subscribeRetries(fixture.s)
        const run = yield* fixture.s.resume.pipe(Effect.forkChild)
        yield* Queue.take(scheduled)
        yield* TestClock.adjust("2400 millis")
        yield* Fiber.join(run)
      }
      if (policy === "empty") yield* fixture.s.resume
      expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(policy === "omitted" ? ["api-a", "api-b"] : ["api-b"])
      const attempts = requireAssistant(yield* fixture.s.context).attempts ?? []
      expect(attempts.some((attempt) => attempt.connection?.type === "credential" && attempt.connection.id === accounts.alternate.id)).toBe(false)
    }))
  }

  for (const affinity of ["turn", "off"] as const) {
    groupIt.effect(`applies ${affinity} affinity at each new Logical Step while preserving the local tool`, () => Effect.gen(function* () {
      const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "rotate", affinity }))
      yield* fixture.admit("Execute one tool and continue")
      yield* fixture.s.llm.push(TestLLM.tool("p4-affinity-tool", "echo", { text: "affinity-once" }), TestLLM.text("Done", "p4-affinity-done"))
      yield* fixture.s.resume
      expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a", affinity === "turn" ? "api-a" : "api-b"])
      expect(fixture.s.executions).toEqual(["affinity-once"])
      expect((yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : []).map((attempt) => attempt.groupMemberIndex))
        .toEqual(affinity === "turn" ? [0, 0] : [0, 1])
    }))
  }

  groupIt.effect("recovers this Session's binding across idle and clears it when the actual actor changes", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "rotate", affinity: "session" }))
    yield* fixture.admit("Fall back to B")
    yield* fixture.s.llm.push(Stream.fail(new AIError({ reason: new AuthenticationError({ message: "A rejected" }) })), TestLLM.text("B", "p4-session-b"))
    const scheduled = yield* subscribeRetries(fixture.s)
    const run = yield* fixture.s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)
    yield* fixture.admit("Keep this Session's B")
    yield* fixture.s.llm.push(TestLLM.text("Still B", "p4-session-held"))
    yield* fixture.s.resume
    yield* fixture.s.bus.publish(SessionEvent.AgentSelected, { sessionID, agent: Agent.ID.make("reviewer"), model: groupSelection })
    yield* fixture.admit("The new actor selects afresh")
    yield* fixture.s.llm.push(TestLLM.text("A", "p4-session-actor"))
    yield* fixture.s.resume
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b", "api-b", "api-a"])
    expect((yield* fixture.s.context).filter((message) => message.type === "assistant").at(-1)?.attempts?.[0].agent).toBe(Agent.ID.make("reviewer"))
  }))

  groupIt.effect("charges overlapping authored members by their durable member index", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "weight", members: [
      { ...groupA, weight: 1 }, { ...groupA, weight: 3 },
    ] }))
    for (const index of Array.from({ length: 8 }, (_, index) => index)) {
      yield* fixture.admit(`Overlapping member ${index}`)
      yield* fixture.s.llm.push(TestLLM.text("Done", `p4-overlap-${index}`))
      yield* fixture.s.resume
    }
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts.map((attempt) => attempt.model)).toEqual(Array.from({ length: 8 }, () => groupA))
    expect(attempts.filter((attempt) => attempt.groupMemberIndex === 0)).toHaveLength(2)
    expect(attempts.filter((attempt) => attempt.groupMemberIndex === 1)).toHaveLength(6)
    expect(new Set(attempts.map((attempt) => attempt.attemptID)).size).toBe(8)
  }))

  groupIt.effect("starts a fork with its own affinity and counts copied receipts only for their original owner", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "rotate", affinity: "session" }))
    yield* fixture.admit("Parent A")
    yield* fixture.s.llm.push(TestLLM.text("Parent", "p4-fork-parent"))
    yield* fixture.s.resume
    const boundary = requireAssistant(yield* fixture.s.messages)
    const fork = yield* fixture.s.session.fork({ sessionID, through: boundary.id })
    yield* fixture.s.sessionInbox.admit({ id: SessionMessage.ID.create(), sessionID: fork.id,
      item: { type: "user", payload: { text: "Fork selects afresh" }, delivery: "steer" },
    })
    yield* fixture.s.llm.push(TestLLM.text("Fork B", "p4-fork-owned"))
    yield* fixture.s.session.resume(fork.id)
    yield* insertSession(otherSessionID)
    yield* fixture.s.bus.publish(SessionEvent.ModelSelected, { sessionID: otherSessionID, model: groupSelection })
    yield* fixture.s.sessionInbox.admit({ id: SessionMessage.ID.create(), sessionID: otherSessionID,
      item: { type: "user", payload: { text: "Only the two physical reservations count" }, delivery: "steer" },
    })
    yield* fixture.s.llm.push(TestLLM.text("Other A", "p4-fork-next"))
    yield* fixture.s.session.resume(otherSessionID)
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b", "api-a"])
    const forkHistory = yield* fixture.s.session.context(fork.id)
    const owned = forkHistory.flatMap((message) => message.type === "assistant" && message.origin?.kind === "step" && message.origin.sessionID === fork.id ? message.attempts ?? [] : [])
    expect(owned).toMatchObject([{ model: groupB, groupMemberIndex: 1 }])
    const copied = forkHistory.find((message) => message.type === "assistant" && message.attempts?.some((attempt) =>
      attempt.attemptID === boundary.attempts?.[0].attemptID))
    expect(copied?.origin).toEqual({ kind: "historical" })
    expect(copied?.type === "assistant" && copied.attempts?.[0].attemptID).toBe(boundary.attempts?.[0].attemptID)
  }))
})

const groupQuote = (input: number, output: number, cache = 0) => ({
  status: "known" as const,
  prices: [{ input: Money.USDPerMillionTokens.make(input), output: Money.USDPerMillionTokens.make(output),
    cache: { read: Money.USDPerMillionTokens.make(cache), write: Money.USDPerMillionTokens.make(cache) } }],
})
const groupQuota = (
  connection: ModelSource.ConnectionRef,
  windows: ModelSource.Quota["windows"],
  fields: Partial<Omit<ModelSource.Quota, "connection" | "windows">> = {},
): ModelSource.Quota => ({
  status: "known", source: "p5-fixture", connection, observedAt: 0, freshUntil: 100_000, allowed: true, windows, ...fields,
})
const setGroupMetadata = Effect.fnUntraced(function* (input: readonly {
  readonly model: Model.Ref
  readonly connection?: ModelSource.ConnectionRef
  readonly quote?: ModelSource.Quote
  readonly quota?: ModelSource.Quota
  readonly apiModelID?: string
}[]) {
  const models = yield* Model.Service
  yield* models.transform((editor) => input.forEach((entry) => {
    const connection = editor.connection(Integration.ID.make(entry.model.providerID))
    if (entry.connection !== undefined &&
      (connection === undefined || IntegrationConnection.key(connection) !== IntegrationConnection.key(entry.connection))) return
    editor.update(entry.model.providerID, entry.model.id, (model) => {
      if (entry.quote !== undefined) Object.assign(model, { metadata: { ...model.metadata, quote: entry.quote } })
      if (entry.quota !== undefined) Object.assign(model, { metadata: { ...model.metadata, quota: entry.quota } })
      if (entry.apiModelID !== undefined) Object.assign(model, { modelID: entry.apiModelID })
    })
  }))
  yield* models.reload()
})
const installGroupQuota = Effect.fnUntraced(function* (input: readonly {
  readonly model: Model.Ref
  readonly connection: ModelSource.ConnectionRef
  readonly quota: ModelSource.Quota
}[]) {
  const hooks = yield* PluginHooks.Service
  const reads: { readonly model: Model.Ref; readonly connection?: ModelSource.ConnectionRef }[] = []
  yield* hooks.register("session", "model.quota", (event) => Effect.sync(() => {
    reads.push({ model: event.model, connection: event.connection })
    event.quota = input.find((entry) => entry.model.providerID === event.model.providerID && entry.model.id === event.model.id &&
      event.connection !== undefined && IntegrationConnection.key(entry.connection) === IntegrationConnection.key(event.connection))?.quota
  }))
  return reads
})
/** Controlled durable input to the original projector and rank owner, independent of live transport calls. */
const seedGroupReceipt = Effect.fnUntraced(function* (definition: ModelGroup.Definition, input: {
  readonly model: Model.Ref
  readonly index: number
  readonly started: number
  readonly firstTokenAt?: number
  readonly firstOutputAt?: number
  readonly providerEndedAt?: number
  readonly output?: number
  readonly reasoning?: number
  readonly actual?: boolean
  readonly sentURL?: string
  readonly connection?: ModelSource.ConnectionRef
  readonly transition?: SessionAttempt.Started["transition"]
}) {
  const bus = yield* Bus.Service
  const runtime = yield* (yield* ModelResolver.Service).resolve(input.model, input.connection)
  if (runtime === undefined) return yield* Effect.die(new Error("The speed fixture requires a concrete model"))
  const assistantMessageID = SessionMessage.ID.create()
  const preparedDeployment = SessionProviderContext.provenance(runtime)
  const deployment = SessionProviderContext.provenance(runtime, input.sentURL)
  const usage = { input: 0, output: input.output ?? 200, reasoning: input.reasoning ?? 0, cache: { read: 0, write: 0 } }
  const quote = runtime.quote ?? { status: "unknown" as const }
  const cost = SessionUsage.quotedCost(quote, usage) ?? Money.USD.zero
  yield* bus.publish(SessionEvent.Attempt.Started, { sessionID, assistantMessageID, ...new SessionAttempt.Started({
    ordinal: 0, attemptID: "gatt_p5_" + assistantMessageID, agent: Agent.ID.make("build"),
    selection: groupSelection, behaviorDigest: ModelGroup.snapshot(groupID, definition).behaviorDigest, groupMemberIndex: input.index,
    model: input.model, apiModelID: String(runtime.model.id),
    ...(runtime.connection === undefined ? {} : { connection: runtime.connection }),
    ...(preparedDeployment === undefined ? {} : { preparedDeployment }),
    quote, goalRefs: [], transition: input.transition ?? "initial", started: input.started,
  }) })
  yield* bus.publish(SessionEvent.Step.Started, { sessionID, assistantMessageID, agent: Agent.ID.make("build"), model: input.model, started: input.started })
  yield* bus.publish(SessionEvent.Attempt.Observed, { sessionID, assistantMessageID, ordinal: 0,
    observation: new SessionAttempt.Observation({
      observedAt: input.firstTokenAt ?? input.firstOutputAt ?? input.started, delivery: "accepted",
      ...(input.actual === false || deployment === undefined ? {} : { deployment }),
      ...(input.firstTokenAt === undefined ? {} : { firstTokenAt: input.firstTokenAt }),
      ...(input.firstOutputAt === undefined ? {} : { firstOutputAt: input.firstOutputAt }),
    }),
  })
  yield* bus.publish(SessionEvent.Attempt.Ended, { sessionID, assistantMessageID, ordinal: 0,
    terminal: new SessionAttempt.Terminal({
      status: "completed", ended: input.providerEndedAt ?? input.started + 1000, outputStarted: true, finish: "stop",
      ...(input.providerEndedAt === undefined ? {} : { providerEndedAt: input.providerEndedAt }),
      usage, cost, delivery: "accepted",
    }),
  })
  yield* bus.publish(SessionEvent.Step.Ended, { sessionID, assistantMessageID, finish: "stop", needsContinuation: false,
    cost, tokens: usage, unknownPriceAttempts: Number(quote.status === "unknown"), missingUsageAttempts: 0 })
  return assistantMessageID
})

describe("P5 dynamic model group strategies through the original runner", () => {
  groupIt.effect("orders cheap by the valid physical quote before unknown and settles actual usage once", () => Effect.gen(function* () {
    const definition = new ModelGroup.Definition({ ...groupDefinition([groupC, groupA, groupB]), strategy: "cheap", affinity: "off" })
    const fixture = yield* setupGroup(definition, true)
    const accounts = yield* groupAccounts()
    const reads = yield* installGroupQuota([{ model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, []) }])
    yield* setGroupMetadata([{ model: groupB, quote: groupQuote(0.2, 0.3) }])
    yield* fixture.admit("Use the current quote")
    yield* fixture.s.llm.push(TestLLM.complete({ reason: { normalized: "stop" }, usage: {
      inputTokens: 1000, nonCachedInputTokens: 1000, outputTokens: 2000,
    } }, LLMEvent.textStart({ id: "p5-cheap" }), LLMEvent.textDelta({ id: "p5-cheap", text: "Done" }), LLMEvent.textEnd({ id: "p5-cheap" })))
    yield* fixture.s.resume
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-b"])
    expect(reads).toEqual([])
    const assistant = requireAssistant(yield* fixture.s.context)
    expect(assistant.attempts).toMatchObject([{ model: groupB, quote: { status: "known", prices: [{ input: 0.2, output: 0.3 }] } }])
    expect(assistant.attempts?.[0].terminal?.cost).toBeCloseTo(0.0008, 10)
    expect(assistant.cost).toBeCloseTo(0.0008, 10)
    expect((yield* fixture.s.session.get(sessionID))?.cost).toBeCloseTo(0.0008, 10)
  }))

  groupIt.effect("uses current cache rates to break an equal cheap estimate", () => Effect.gen(function* () {
    const definition = new ModelGroup.Definition({ ...groupDefinition(), strategy: "cheap", affinity: "off" })
    const fixture = yield* setupGroup(definition)
    yield* setGroupMetadata([{ model: groupA, quote: groupQuote(1, 2, 0.5) }, { model: groupB, quote: groupQuote(1, 2, 0.1) }])
    yield* fixture.admit("Keep input/output equal and compare the cache")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-cache"))
    yield* fixture.s.resume
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-b"])
  }))

  for (const status of ["expired", "future", "known-empty", "free-empty"] as const) {
    groupIt.effect("keeps cheap " + status + " quote semantics explicit", () => Effect.gen(function* () {
      const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "cheap", affinity: "off" }), true)
      const base = groupQuote(0, 0)
      const quote: ModelSource.Quote = status === "free-empty" ? { status: "free", prices: [] } :
        status === "known-empty" ? { status: "known", prices: [] } :
          { ...base, ...(status === "expired" ? { validUntil: 0 } : { validFrom: 1000 }) }
      yield* setGroupMetadata([{ model: groupA, quote }])
      yield* fixture.admit("Use the quote's declared status and interval")
      yield* fixture.s.llm.push(TestLLM.text("Done", "p5-quote-" + status))
      yield* fixture.s.resume
      expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual([status === "free-empty" ? "api-a" : "api-b"])
      if (status === "free-empty") expect(requireAssistant(yield* fixture.s.context).attempts?.[0].quote).toEqual({ status: "free", prices: [] })
    }))
  }

  groupIt.effect("keeps all unknown cheap quotes in authored order without inferring free", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "cheap", affinity: "off" }))
    yield* fixture.admit("Prices have not been supplied")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-unknown-price"))
    yield* fixture.s.resume
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a"])
    expect(requireAssistant(yield* fixture.s.context)).toMatchObject({ attempts: [{ quote: { status: "unknown" } }], unknownPriceAttempts: 1 })
  }))

  groupIt.effect("samples a prepared future quote at the real Started boundary and charges one Goal attempt", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition([groupA]), strategy: "cheap", affinity: "off" }))
    yield* setGroupMetadata([{ model: groupA, quote: { ...groupQuote(1, 2), validFrom: 1000, validUntil: 5000 } }])
    const metas = yield* MetaAgentService.Service
    const goals = yield* SessionGoal.Service
    yield* (yield* Agent.Service).transform((editor) => editor.update(Agent.ID.make("meta"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
    }))
    const meta = yield* metas.create({ title: "Quote boundary", agent: "meta", model: Model.Ref.parse("fake/fake-model") })
    yield* fixture.s.db.update(SessionTable).set({ agent: "meta", controller: new MetaAgent.RootController({
      kind: "root", metaAgentID: meta.id, rootSessionID: sessionID,
    }) }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
    yield* metas.attach({ metaID: meta.id, sessionID, role: "orchestrator" })
    const preparations: number[] = []
    yield* (yield* PluginHooks.Service).register("session", "model.request", (event) => Effect.gen(function* () {
      if (event.sessionID !== sessionID || event.kind !== "primary") return
      preparations.push((yield* DateTime.nowAsDate).getTime())
      yield* TestClock.setTime(1000)
    }))
    const goal = yield* goals.set({ sessionID, objective: "Price the physical attempt once",
      budget: { rounds: 1, attempts: 1, steps: 1 },
      conditions: [SessionGoal.Condition.make({ id: "accept", kind: "human_acceptance", description: "Accept the result" })],
    })
    expect((yield* goals.advance({ sessionID, goalID: goal.id })).state).toBe("admitted")
    yield* fixture.s.llm.push(TestLLM.complete({ reason: { normalized: "stop" }, usage: {
      inputTokens: 1000, nonCachedInputTokens: 1000, outputTokens: 1000,
    } }, LLMEvent.textStart({ id: "p5-start-price" }), LLMEvent.textDelta({ id: "p5-start-price", text: "Done" }), LLMEvent.textEnd({ id: "p5-start-price" })))
    yield* fixture.s.resume
    const assistant = requireAssistant(yield* fixture.s.context)
    expect(preparations).toEqual([0])
    expect(fixture.s.requests).toHaveLength(1)
    expect(assistant.attempts).toMatchObject([{ started: 1000, quote: { status: "known", validFrom: 1000, validUntil: 5000 } }])
    expect(assistant.attempts?.[0].terminal?.cost).toBeCloseTo(0.003, 10)
    expect(assistant.cost).toBeCloseTo(0.003, 10)
    expect((yield* fixture.s.session.get(sessionID))?.cost).toBeCloseTo(0.003, 10)
    const accounting = yield* goals.get({ sessionID, goalID: goal.id })
    expect(accounting?.accounting.coordinator.attempts).toBe(1)
    expect(accounting?.attempts).toHaveLength(1)
    expect(accounting?.attempts[0]?.id).toBe(assistant.attempts?.[0].attemptID)
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.attempt.started.1")).toHaveLength(1)
  }))

  groupIt.effect("ranks fast by the latest qualified actual TTFT plus 200 output tokens including reasoning", () => Effect.gen(function* () {
    const definition = new ModelGroup.Definition({ ...groupDefinition(), strategy: "fast", affinity: "off" })
    const fixture = yield* setupGroup(definition)
    const accounts = yield* groupAccounts()
    const reads = yield* installGroupQuota([{ model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, []) }])
    yield* seedGroupReceipt(definition, { model: groupA, index: 0, started: 0, firstTokenAt: 10, providerEndedAt: 20, output: 1000 })
    yield* seedGroupReceipt(definition, { model: groupA, index: 0, started: 100, firstTokenAt: 150, providerEndedAt: 100150, output: 100, reasoning: 100 })
    yield* seedGroupReceipt(definition, { model: groupB, index: 1, started: 200, firstTokenAt: 700, providerEndedAt: 1700, output: 100, reasoning: 100 })
    yield* TestClock.setTime(200000)
    yield* fixture.admit("Compare a short response at each measured pace")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-fast-score"))
    yield* fixture.s.resume
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-b"])
    expect(reads).toEqual([])
    const assistant = (yield* fixture.s.context).findLast((message): message is SessionMessage.Assistant => message.type === "assistant")
    expect(assistant?.attempts).toMatchObject([{ model: groupB }])
  }))

  for (const condition of ["prepared-only", "first-output-only", "expired", "different-deployment", "different-account"] as const) {
    groupIt.effect("keeps fast " + condition + " evidence unmeasured", () => Effect.gen(function* () {
      const definition = new ModelGroup.Definition({ ...groupDefinition(), strategy: "fast", affinity: "off" })
      const fixture = yield* setupGroup(definition)
      const accounts = yield* groupAccounts()
      yield* seedGroupReceipt(definition, { model: groupA, index: 0, started: 0, firstOutputAt: 1,
        ...(condition === "first-output-only" ? {} : { firstTokenAt: 1 }), providerEndedAt: 2, output: 1000,
        ...(condition === "prepared-only" ? { actual: false } : {}),
        ...(condition === "different-deployment" ? { sentURL: "https://other-fixture.invalid/v1/chat/completions" } : {}),
        ...(condition === "different-account" ? { connection: accounts.alternate } : {}),
      })
      const time = condition === "expired" ? 24 * 60 * 60 * 1000 + 10000 : 10000
      yield* seedGroupReceipt(definition, { model: groupB, index: 1, started: time - 2000, firstTokenAt: time - 1900, providerEndedAt: time - 1000 })
      yield* TestClock.setTime(time)
      yield* fixture.admit("Use only the matching actual recent measurement")
      yield* fixture.s.llm.push(TestLLM.text("Done", "p5-fast-proof-" + condition))
      yield* fixture.s.resume
      expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-b"])
    }))
  }

  groupIt.effect("uses one normal initial Step in eight to explore unmeasured fast candidates without duplicate requests", () => Effect.gen(function* () {
    const definition = new ModelGroup.Definition({ ...groupDefinition(), strategy: "fast", affinity: "off" })
    const fixture = yield* setupGroup(definition)
    yield* seedGroupReceipt(definition, { model: groupA, index: 0, started: 0, firstTokenAt: 100, providerEndedAt: 1100 })
    yield* seedGroupReceipt(definition, { model: groupA, index: 0, started: 2000, firstTokenAt: 2100, providerEndedAt: 3100, transition: "retry" })
    yield* TestClock.setTime(10000)
    for (const index of Array.from({ length: 8 }, (_, index) => index)) {
      yield* fixture.admit("Normal Step " + index)
      yield* fixture.s.llm.push(TestLLM.text("Done", "p5-probe-" + index))
      yield* fixture.s.resume
    }
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual([...Array<string>(6).fill("api-a"), "api-b", "api-a"])
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts.filter((attempt) => attempt.transition === "initial")).toHaveLength(9)
    expect(attempts.filter((attempt) => attempt.transition === "retry")).toHaveLength(1)
    expect(fixture.s.executions).toEqual([])
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.retry.scheduled.1")).toEqual([])
  }))

  const quotaStrategies = ["smart", "usage", "pace", "free", "expiring", "drain"] as const
  for (const strategy of quotaStrategies) {
    groupIt.effect("uses " + strategy + " facts for the exact account before missing candidates", () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const accounts = yield* groupAccounts()
      const definition = new ModelGroup.Definition({ ...groupDefinition([groupC, { ...groupA, connections: [
        { ref: accounts.active }, { ref: accounts.alternate },
      ] }]), strategy, affinity: "off" })
      yield* fixture.config.setEntries([groupDocument(definition)])
      const reads = yield* installGroupQuota([
        { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account",
          usedRatio: strategy === "drain" ? 1 : 0.8, total: 100, remaining: strategy === "drain" ? 0 : 20, resetAt: 20000,
          ...(strategy === "pace" ? {} : { spanMs: 30000 }),
        }], { freeModel: false, freePlan: strategy === "expiring" }) },
        { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "budget", unit: "tokens", scope: "account",
          usedRatio: 0.2, total: 100, remaining: 80, resetAt: 10000, ...(strategy === "pace" ? {} : { spanMs: 30000 }),
        }], { freeModel: strategy === "free", freePlan: strategy === "expiring" }) },
      ])
      yield* fixture.admit("Use " + strategy + " on a qualified exact account")
      yield* fixture.s.llm.push(TestLLM.text("Done", "p5-known-" + strategy))
      yield* fixture.s.resume
      const attempt = requireAssistant(yield* fixture.s.context).attempts?.[0]
      expect(attempt).toMatchObject({ selection: groupSelection, model: groupA, connection: accounts.alternate,
        quota: { status: "known", connection: accounts.alternate } })
      expect(fixture.s.requests.map((request) => request.model.route.endpoint.baseURL)).toEqual(["https://alternate-fixture.invalid/v1"])
      expect(reads.filter((read) => read.model.id === groupA.id)).toHaveLength(2)
      expect(yield* accounts.integrations.connection.active(Integration.ID.make(groupA.providerID))).toMatchObject(accounts.active)
    }))

    for (const status of ["unknown", "error", "expired"] as const) {
      groupIt.effect("preserves " + strategy + " " + status + " adapter data and permits one normal attempt", () => Effect.gen(function* () {
        const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition([groupA]), strategy, affinity: "off" }))
        const accounts = yield* groupAccounts()
        const quota = groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", usedRatio: 0,
          total: 100, remaining: 100, resetAt: 10000, spanMs: 30000,
        }], status === "expired" ? { freshUntil: 0, freeModel: true, freePlan: true } :
          { status, ...(status === "error" ? { reason: "transport" as const } : {}), freeModel: true, freePlan: true })
        const reads = yield* installGroupQuota([{ model: groupA, connection: accounts.active, quota }])
        yield* fixture.admit("Keep unavailable quota data distinct from missing capability")
        yield* fixture.s.llm.push(TestLLM.text("Done", "p5-data-" + strategy + "-" + status))
        yield* fixture.s.resume
        expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a"])
        expect(reads).toHaveLength(1)
        expect(requireAssistant(yield* fixture.s.context).attempts?.[0]).toMatchObject({
          quota: { status: status === "expired" ? "known" : status, connection: accounts.active },
        })
        if (status === "expired") expect(requireAssistant(yield* fixture.s.context).attempts?.[0].quota?.freshUntil).toBe(0)
      }))
    }

    groupIt.effect("returns explicit " + strategy + " unavailable when every adapter is unsupported", () => Effect.gen(function* () {
      const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition([groupA]), strategy, affinity: "off" }))
      const accounts = yield* groupAccounts()
      yield* installGroupQuota([{ model: groupA, connection: accounts.active,
        quota: { status: "unsupported", source: "p5-unsupported", reason: "unsupported", connection: accounts.active, windows: [] } }])
      yield* fixture.admit("Keep the explicitly unavailable strategy")
      expect(yield* fixture.s.resume.pipe(Effect.result)).toMatchObject({
        _tag: "Failure", failure: { _tag: "ModelGroup.Unavailable", groupID, reason: "strategy-unavailable" },
      })
      expect(fixture.s.requests).toEqual([])
      expect((yield* fixture.s.session.get(sessionID))?.model).toEqual(groupSelection)
    }))
  }

  groupIt.effect("reports missing quota capability without silently using order", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "smart", affinity: "off" }))
    yield* fixture.admit("The adapter has not been installed")
    expect(yield* fixture.s.resume.pipe(Effect.result)).toMatchObject({
      _tag: "Failure", failure: { _tag: "ModelGroup.Unavailable", reason: "strategy-unavailable" },
    })
    expect(fixture.s.requests).toEqual([])
  }))

  groupIt.effect("preserves different units' slots while ordering comparable usage within their own unit", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition([
      { ...groupA, connections: [{ ref: accounts.active }] }, groupSibling, { ...groupA, connections: [{ ref: accounts.alternate }] },
    ]), strategy: "usage", affinity: "off" }))])
    yield* installGroupQuota([
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "wallet", unit: "tokens", scope: "account", remaining: 10 }]) },
      { model: groupSibling, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "wallet", unit: "credits", scope: "account", remaining: 1000000 }]) },
      { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "wallet", unit: "tokens", scope: "account", remaining: 100 }]) },
    ])
    yield* fixture.admit("Compare token balances only with token balances")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-units"))
    yield* fixture.s.resume
    expect(requireAssistant(yield* fixture.s.context).attempts?.[0]).toMatchObject({ model: groupA, connection: accounts.alternate })
    expect(fixture.s.requests.map((request) => request.model.route.endpoint.baseURL)).toEqual(["https://alternate-fixture.invalid/v1"])
  }))

  groupIt.effect("memoizes a quota preparation by actual API model and account across catalog aliases", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition([groupA, groupSibling]), strategy: "usage", affinity: "off" }))
    const accounts = yield* groupAccounts()
    yield* setGroupMetadata([{ model: groupSibling, apiModelID: "api-a" }])
    const reads = yield* installGroupQuota([{ model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [
      { id: "budget", unit: "tokens", scope: "account", usedRatio: 0.2, total: 100, remaining: 80 },
    ]) }])
    yield* fixture.admit("Read one physical model quota once")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-memo"))
    yield* fixture.s.resume
    expect(reads).toHaveLength(1)
    expect(requireAssistant(yield* fixture.s.context).attempts?.[0]).toMatchObject({ model: groupA, connection: accounts.active })
  }))

  groupIt.effect("pins the captured active account when it changes during quota preparation", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition([groupA]), strategy: "usage", affinity: "off" }))
    const accounts = yield* groupAccounts()
    const hooks = yield* PluginHooks.Service
    const reads: ModelSource.ConnectionRef[] = []
    yield* hooks.register("session", "model.quota", (event) => Effect.gen(function* () {
      if (event.model.providerID !== groupA.providerID || event.connection === undefined) return
      reads.push(event.connection)
      yield* accounts.credentials.activate(accounts.alternate.id)
      event.quota = groupQuota(event.connection, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }])
    }))
    yield* fixture.admit("Keep the quota and catalog on the captured connection")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-active-race"))
    yield* fixture.s.resume
    expect(reads).toEqual([accounts.active])
    expect(requireAssistant(yield* fixture.s.context).attempts?.[0]).toMatchObject({ connection: accounts.active,
      quota: { status: "known", connection: accounts.active } })
    expect(fixture.s.requests.map((request) => request.model.route.endpoint.baseURL)).toEqual(["https://fixture.invalid/v1"])
    expect(yield* accounts.integrations.connection.active(Integration.ID.make(groupA.providerID))).toMatchObject(accounts.alternate)
  }))

  groupIt.effect("does not rank an account by another account's quota", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition([{ ...groupA, connections: [
      { ref: accounts.alternate }, { ref: accounts.active },
    ] }]), strategy: "usage", affinity: "off" }))])
    yield* installGroupQuota([
      { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", usedRatio: 0, remaining: 100 }], { freeModel: true }) },
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", usedRatio: 0.6, remaining: 40 }]) },
    ])
    yield* fixture.admit("Use the account that supplied its own quota")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-quota-account"))
    yield* fixture.s.resume
    expect(requireAssistant(yield* fixture.s.context).attempts?.[0]).toMatchObject({ connection: accounts.active,
      quota: { status: "known", connection: accounts.active } })
    expect(fixture.s.requests.map((request) => request.model.route.endpoint.baseURL)).toEqual(["https://fixture.invalid/v1"])
  }))

  groupIt.effect("continues the original quota strategy from a known auth failure to an unknown adapter without a new allowance", () => Effect.gen(function* () {
    const fixture = yield* setupGroup(new ModelGroup.Definition({ ...groupDefinition(), strategy: "usage", affinity: "off" }))
    const accounts = yield* groupAccounts()
    const backup = yield* accounts.integrations.connection.active(Integration.ID.make(groupB.providerID))
    if (backup?.type !== "credential") return yield* Effect.die(new Error("The backup fixture needs a credential"))
    const connection = { type: "credential" as const, id: backup.id }
    yield* installGroupQuota([
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }]) },
      { model: groupB, connection, quota: { status: "unknown", source: "p5-backup", connection, windows: [] } },
    ])
    yield* fixture.admit("Retain an unknown executable fallback")
    yield* fixture.s.llm.push(Stream.fail(new AIError({ reason: new AuthenticationError({ message: "Known account rejected" }) })),
      TestLLM.text("Recovered", "p5-unknown-fallback"))
    const scheduled = yield* subscribeRetries(fixture.s)
    const running = yield* fixture.s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(running)
    expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a", "api-b"])
    expect(requireAssistant(yield* fixture.s.context).attempts).toMatchObject([
      { transition: "initial", quota: { status: "known" }, terminal: { status: "failed", failure: { reason: "Authentication" } } },
      { transition: "fallback", quota: { status: "unknown" }, terminal: { status: "completed" } },
    ])
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.retry.scheduled.1")).toHaveLength(1)
  }))

  for (const scope of ["account", "model", "unknown", "stale", "mismatch"] as const) {
    groupIt.effect("limits QuotaExceeded exclusions to the proven " + scope + " scope", () => Effect.gen(function* () {
      const fixture = yield* setupGroup(groupDefinition([groupA, groupSibling, groupB]))
      const accounts = yield* groupAccounts()
      const quota = groupQuota(scope === "mismatch" ? accounts.alternate : accounts.active, scope === "unknown" ? [] : [{
        id: "budget", unit: "tokens", scope: scope === "model" ? "model" : "account", usedRatio: 1, remaining: 0,
        ...(scope === "model" ? { modelIDs: ["api-a"] } : {}),
      }], scope === "unknown" ? { status: "unknown" } : scope === "stale" ? { freshUntil: 0 } : {})
      yield* setGroupMetadata([{ model: groupA, connection: accounts.active, quota }])
      yield* fixture.admit("Apply only the evidenced failure scope")
      yield* fixture.s.llm.push(Stream.fail(new AIError({ reason: new QuotaExceededError({ message: "Quota exceeded" }) })),
        TestLLM.text("Recovered", "p5-scope-" + scope))
      const scheduled = yield* subscribeRetries(fixture.s)
      const running = yield* fixture.s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(running)
      expect(fixture.s.requests.map((request) => String(request.model.id))).toEqual(["api-a", scope === "account" ? "api-b" : "api-a-sibling"])
      const attempts = requireAssistant(yield* fixture.s.context).attempts ?? []
      if (scope === "account") expect(attempts[1].connection).not.toEqual(attempts[0].connection)
      if (scope !== "account") expect(attempts[1].connection).toEqual(attempts[0].connection)
      if (scope === "mismatch") expect(attempts[0].quota).toBeUndefined()
    }))
  }

  for (const completion of ["stop", "tool"] as const) {
    groupIt.effect("keeps drain Transport fallback " + completion + " temporary through the next fresh prompt", () => Effect.gen(function* () {
      const fixture = yield* setupGroup()
      const accounts = yield* groupAccounts()
      yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition([{ ...groupA, connections: [
        { ref: accounts.active }, { ref: accounts.alternate },
      ] }]), strategy: "drain", affinity: "turn" }))])
      yield* installGroupQuota([
        { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }]) },
        { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }]) },
      ])
      yield* fixture.admit("Use a temporary fallback for the transport failure")
      yield* fixture.s.llm.push(Stream.fail(streamDisconnected()),
        completion === "tool" ? TestLLM.tool("p5-transient-tool", "echo", { text: "held-once" }) : TestLLM.text("Recovered", "p5-transient-stop"),
        ...(completion === "tool" ? [TestLLM.text("Held continuation", "p5-transient-held")] : []))
      const scheduled = yield* subscribeRetries(fixture.s)
      const running = yield* fixture.s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(running)
      yield* fixture.admit("Return to the persistent cursor on a fresh prompt")
      yield* fixture.s.llm.push(TestLLM.text("Done", "p5-transient-fresh"))
      yield* fixture.s.resume
      const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
      expect(attempts.map((attempt) => attempt.connection)).toEqual(completion === "tool"
        ? [accounts.active, accounts.alternate, accounts.alternate, accounts.active]
        : [accounts.active, accounts.alternate, accounts.active])
      expect(fixture.s.executions).toEqual(completion === "tool" ? ["held-once"] : [])
      expect(fixture.s.requests).toHaveLength(completion === "tool" ? 4 : 3)
    }))
  }

  groupIt.effect("keeps drain on the same candidate for RateLimit retries and the next fresh Step", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    yield* fixture.config.setEntries([groupDocument(new ModelGroup.Definition({ ...groupDefinition([{ ...groupA, connections: [
      { ref: accounts.active }, { ref: accounts.alternate },
    ] }]), strategy: "drain", affinity: "off" }))])
    yield* installGroupQuota([
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }]) },
      { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100 }]) },
    ])
    yield* fixture.admit("Retry the rate limit on the current drain candidate")
    yield* fixture.s.llm.push(Stream.fail(rateLimited()), TestLLM.text("Recovered", "p5-drain-rate"))
    const scheduled = yield* subscribeRetries(fixture.s)
    const running = yield* fixture.s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(running)
    yield* fixture.admit("Keep that drain cursor after idle")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-drain-next"))
    yield* fixture.s.resume
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts.map((attempt) => attempt.connection)).toEqual([accounts.active, accounts.active, accounts.active])
    expect(attempts.map((attempt) => attempt.transition)).toEqual(["initial", "retry", "initial"])
    expect(fixture.s.requests).toHaveLength(3)
  }))

  groupIt.effect("recovers the actual drain cursor from durable Started and terminal receipts after quota renewal", () => Effect.gen(function* () {
    const fixture = yield* setupGroup()
    const accounts = yield* groupAccounts()
    const definition = new ModelGroup.Definition({ ...groupDefinition([{ ...groupA, connections: [
      { ref: accounts.active }, { ref: accounts.alternate },
    ] }]), strategy: "drain", affinity: "off" })
    yield* fixture.config.setEntries([groupDocument(definition)])
    yield* installGroupQuota([
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100, resetAt: 10000 }]) },
      { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100, resetAt: 10000 }]) },
    ])
    yield* fixture.admit("Advance the depleted drain candidate")
    yield* fixture.s.llm.push(Stream.fail(new AIError({ reason: new QuotaExceededError({ message: "First quota exhausted" }) })),
      TestLLM.text("Recovered", "p5-drain-fallback"))
    const scheduled = yield* subscribeRetries(fixture.s)
    const running = yield* fixture.s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(running)
    yield* TestClock.setTime(10001)
    yield* setGroupMetadata([
      { model: groupA, connection: accounts.active, quota: groupQuota(accounts.active, [{ id: "budget", unit: "tokens", scope: "account", remaining: 100, resetAt: 20000 }], { observedAt: 10001 }) },
      { model: groupA, connection: accounts.alternate, quota: groupQuota(accounts.alternate, [{ id: "budget", unit: "tokens", scope: "account", remaining: 80, resetAt: 20000 }], { observedAt: 10001 }) },
    ])
    yield* fixture.admit("Do not move back merely because the first account renewed")
    yield* fixture.s.llm.push(TestLLM.text("Done", "p5-drain-renewed"))
    yield* fixture.s.resume
    const attempts = (yield* fixture.s.context).flatMap((message) => message.type === "assistant" ? message.attempts ?? [] : [])
    expect(attempts.map((attempt) => attempt.connection)).toEqual([accounts.active, accounts.alternate, accounts.alternate])
    expect(attempts.map((attempt) => attempt.transition)).toEqual(["initial", "fallback", "initial"])
    expect(yield* accounts.integrations.connection.active(Integration.ID.make(groupA.providerID))).toMatchObject(accounts.active)
  }))
})

const setupOverflowRecovery = Effect.fnUntraced(function* (s: Scenario) {
  yield* s.llm.push(TestLLM.text("Earlier answer", "text-earlier"))
  yield* s.runPrompt("Earlier question ".repeat(700))
  s.currentModel = recoveryModel
  s.requests.length = 0
})

const messageTexts = (request: LLMRequest, role: "user" | "system") =>
  request.messages.flatMap((message) =>
    message.role === role ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : [])) : [],
  )
const userTexts = (request: LLMRequest) => messageTexts(request, "user")
const systemTexts = (request: LLMRequest) => messageTexts(request, "system")
const messageRoles = (request: LLMRequest | undefined) => request?.messages.map((message) => message.role)

const setupGoalEntry = Effect.fnUntraced(function* () {
  const s = yield* setup
  const agents = yield* Agent.Service
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("meta"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
      agent.permissions.push({ action: GoalTool.name, resource: "*", effect: "allow" })
    }),
  )
  yield* s.session.switchAgent({ sessionID, agent: Agent.ID.make("meta") })
  const goals = yield* SessionGoal.Service
  const commands = yield* Command.Service
  yield* CommandPlugin.MetaCommands.effect(
    host({
      command: { ...host().command, transform: commands.transform, reload: commands.reload },
      session: { prompt: s.session.prompt, synthetic: s.session.synthetic },
    }),
  )
  yield* registerToolPlugin(GoalTool.Plugin)
  return Object.assign(s, {
    goals,
    goalCommand: (text: string) =>
      commands.execute({ name: "goal", invocation: { sessionID, prompt: { text }, delivery: "steer" } }),
  })
})

it.effect("MP04 Goal entry /goal persists one queued round and consumes it after the current input finishes", () =>
  Effect.gen(function* () {
    const s = yield* setupGoalEntry()
    yield* s.llm.push(
      TestLLM.text("Current input completed", "mp04-existing-input"),
      TestLLM.text("Complete Goal result 🚀\nReady for acceptance", "mp04-command-result"),
    )
    const input = yield* s.admit("Finish the current input first")
    const gate = yield* s.llm.gate
    const running = yield* s.resume.pipe(Effect.forkChild)
    yield* awaitWithTimeout(gate.started, "The current input did not reach its request")
    const objective = "Complete the accepted implementation"
    yield* s.goalCommand(objective)
    const goal = (yield* s.goals.list(sessionID))[0]
    const round = goal?.rounds[0]
    if (!goal || !round) return yield* Effect.die(new Error("/goal did not persist its first round"))
    expect(goal).toMatchObject({ objective, revision: 1, status: "active" })
    expect(goal.conditions).toMatchObject([{ kind: "human_acceptance", description: objective }])
    expect(yield* s.inbox).toMatchObject([
      { id: round.inputID, type: "synthetic", delivery: "queue", payload: { metadata: { source: "goal", goalRound: { goalID: goal.id, roundID: round.roundID } } } },
    ])
    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toEqual([input.payload.text])
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: round.inputID })).toMatchObject({ status: "pending" })
    yield* gate.release
    yield* awaitWithTimeout(Fiber.join(running), "/goal did not finish its safe-boundary continuation")
    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[1]).at(-1)).toContain("Objective: " + objective)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({
      status: "completed", sharedInputs: [input.id], assistant: { content: [Expected.text("Current input completed")] },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: round.inputID })).toMatchObject({
      status: "completed", sharedInputs: [round.inputID], assistant: { content: [Expected.text("Complete Goal result 🚀\nReady for acceptance")] },
    })
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({
      status: "active", accounting: { rounds: 1, coordinator: { steps: 1, attempts: 1, unknownAttempts: 1 } },
    })
    yield* s.goalCommand("pause")
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({ status: "paused", pauseReason: "user" })
    yield* s.goalCommand("resume")
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({ status: "active", rounds: [round] })
    yield* s.goalCommand("")
    const status = (yield* s.inbox)[0]
    if (status?.type !== "synthetic") return yield* Effect.die(new Error("/goal did not admit its saved status"))
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(SessionGoal.Info)))(status.payload.text)).toMatchObject([
      { id: goal.id, objective, revision: 1, status: "active" },
    ])
    yield* s.goalCommand("cancel")
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({ status: "cancelled", rounds: [round] })
    expect(s.requests).toHaveLength(2)
  }),
)

it.effect("MP04 Goal entry natural-language goal Tool reaches the original runner and durable result", () =>
  Effect.gen(function* () {
    const s = yield* setupGoalEntry()
    const objective = "Finish the requested work and keep its full result"
    yield* s.llm.push(
      TestLLM.tool("mp04-goal-set", GoalTool.name, {
        action: "set", objective,
        conditions: [{ id: "acceptance", kind: "human_acceptance", description: "Accept the complete work" }], budget: {},
      }),
      TestLLM.text("The Goal is saved", "mp04-tool-step"),
      TestLLM.text("Full Goal outcome 🚀\nOriginal result retained", "mp04-tool-goal-result"),
    )
    const input = yield* s.runPrompt("Keep working on this objective until I accept the complete work")
    const goal = (yield* s.goals.list(sessionID))[0]
    const round = goal?.rounds[0]
    if (!goal || !round) return yield* Effect.die(new Error("The model Goal Tool did not persist its round"))
    expect(s.requests).toHaveLength(3)
    expect(s.requests[0].tools.map((tool) => tool.name)).toContain(GoalTool.name)
    expect(userTexts(s.requests[1])).toEqual([input.payload.text])
    expect(userTexts(s.requests[2]).at(-1)).toContain("Objective: " + objective)
    const toolStep = (yield* s.messages).find((message) => message.type === "assistant" && message.content.some((part) => part.type === "tool" && part.id === "mp04-goal-set"))
    const tool = toolStep?.type === "assistant" ? toolStep.content.find((part) => part.type === "tool" && part.id === "mp04-goal-set") : undefined
    if (tool?.type !== "tool" || tool.state.status !== "completed") return yield* Effect.die(new Error("The actual Goal Tool result is missing"))
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(GoalTool.Output))(tool.state.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"))).toMatchObject({
      data: [{ id: goal.id, objective, rounds: [round] }],
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({
      status: "completed", sharedInputs: [input.id], assistant: { content: [Expected.text("The Goal is saved")] },
    })
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: round.inputID })
    expect(result).toMatchObject({
      status: "completed", sharedInputs: [round.inputID], assistant: { content: [Expected.text("Full Goal outcome 🚀\nOriginal result retained")] },
    })
    expect(goal).toMatchObject({ status: "active", accounting: { rounds: 1, coordinator: { steps: 1, attempts: 1 }, worker: { attempts: 0 } } })
    const accepted = yield* s.goals.confirm({ sessionID, goalID: goal.id, expectedRevision: goal.revision, evidenceIDs: goal.currentEvidenceIDs, evidenceSetDigest: goal.evidenceSetDigest })
    expect(accepted.status).toBe("completed")
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: round.inputID })).toEqual(result)
    expect(yield* s.goals.advance({ sessionID, goalID: goal.id })).toMatchObject({ state: "skipped", reason: "completed" })
    expect(yield* s.inbox).toEqual([])
    expect(s.requests).toHaveLength(3)
  }),
)

it.effect("MP04 Goal entry switching Meta to Build cancels the queued Goal until an explicit Meta resume", () =>
  Effect.gen(function* () {
    const s = yield* setupGoalEntry()
    yield* s.llm.push(TestLLM.text("Current Meta input completed", "mp04-switch-input"))
    yield* s.admit("Finish this Meta input")
    const gate = yield* s.llm.gate
    const running = yield* s.resume.pipe(Effect.forkChild)
    yield* awaitWithTimeout(gate.started, "The Meta input did not start before the switch")
    yield* s.goalCommand("Continue only with selected Meta")
    const goal = (yield* s.goals.list(sessionID))[0]
    const round = goal?.rounds[0]
    if (!goal || !round) return yield* Effect.die(new Error("The switched Goal round is missing"))
    yield* s.session.switchAgent({ sessionID, agent: Agent.ID.make("build") })
    yield* gate.release
    yield* awaitWithTimeout(Fiber.join(running), "Build did not settle the original Meta input")
    expect((yield* s.session.get(sessionID)).agent).toBe(Agent.ID.make("build"))
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({
      status: "paused", pauseReason: "blocked", pauseCode: "agent_changed", accounting: { rounds: 1, coordinator: { attempts: 0 } },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: round.inputID })).toMatchObject({ status: "missing" })
    expect((yield* s.session.log({ sessionID }).pipe(Stream.runCollect)).some((event) =>
      event.type === SessionEvent.InboxCancelled.type && event.data.inboxID === round.inputID,
    )).toBe(true)
    expect(yield* s.inbox).toEqual([])
    expect(s.requests).toHaveLength(1)
    const execution = yield* SessionExecution.Service
    yield* execution.wake(sessionID)
    yield* awaitWithTimeout(execution.awaitIdle(sessionID), "The idle Build wake did not settle")
    yield* s.session.switchAgent({ sessionID, agent: Agent.ID.make("meta") })
    expect(yield* s.goals.advance({ sessionID, goalID: goal.id })).toMatchObject({ state: "blocked", reason: "agent_changed" })
    expect(s.requests).toHaveLength(1)
    yield* s.llm.push(TestLLM.text("Resumed Goal work", "mp04-explicit-resume"))
    yield* s.goalCommand("resume")
    yield* awaitWithTimeout(execution.awaitIdle(sessionID), "The explicit Meta Goal resume did not settle")
    const resumed = yield* s.goals.get({ sessionID, goalID: goal.id })
    expect(resumed).toMatchObject({ status: "active", accounting: { rounds: 2, coordinator: { steps: 1, attempts: 1 } } })
    const next = resumed?.rounds[1]
    if (!next) return yield* Effect.die(new Error("Explicit Meta resume did not reserve a new Goal round"))
    expect(next.inputID).not.toBe(round.inputID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: next.inputID })).toMatchObject({
      status: "completed", sharedInputs: [next.inputID], assistant: { content: [Expected.text("Resumed Goal work")] },
    })
    expect(s.requests).toHaveLength(2)
  }),
)

it.effect("MP04 Goal entry a saved Goal worker completes and its full result is consumed by Meta", () =>
  Effect.gen(function* () {
    const s = yield* setupGoalEntry()
    const execution = yield* SessionExecution.Service
    yield* s.llm.push(TestLLM.text("Goal ready for worker dispatch", "mp04-worker-goal"))
    yield* s.goalCommand("Keep the original worker result for acceptance")
    yield* awaitWithTimeout(execution.awaitIdle(sessionID), "The initial Goal did not settle before dispatch")
    const goal = (yield* s.goals.list(sessionID))[0]
    const round = goal?.rounds[0]
    if (!goal || !round) return yield* Effect.die(new Error("The worker Goal round is missing"))
    yield* insertSession(otherSessionID)
    yield* s.session.setPermissions({ sessionID, permissions: [{ action: "task", resource: "*", effect: "allow" }] })
    const text = "Full worker result 🚀\nSecond line retained"
    yield* s.llm.push(
      TestLLM.text(text, "mp04-worker-completion"),
      TestLLM.text("Meta consumed the full worker result", "mp04-worker-consumer"),
    )
    const gate = yield* s.llm.gate
    const operation = yield* s.session.dispatchTask({
      sessionID,
      request: new SessionTask.OperationRequest({
        operationID: SessionTask.OperationID.create(), inputID: SessionMessage.ID.create(),
        target: { type: "existing_root", sessionID: otherSessionID },
        prompt: "Produce the complete worker result", delivery: "queue", resume: true, background: true,
      }),
    }, {
      source: new SessionTask.OperationGoalSource({
        type: "goal_round", sessionID, agent: Agent.ID.make("meta"),
        goalID: goal.id, roundID: round.roundID, revision: round.revision,
      }),
    })
    yield* awaitWithTimeout(gate.started, "The Goal worker did not start its actual request")
    expect(yield* s.goals.advance({ sessionID, goalID: goal.id })).toMatchObject({ state: "waiting", reason: "worker_running" })
    expect(yield* s.goals.advance({ sessionID, goalID: goal.id })).toMatchObject({ state: "waiting", reason: "worker_running" })
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({ rounds: [round], taskRefs: [{ sourceSessionID: sessionID, operationID: operation.operationID }] })
    expect(s.requests).toHaveLength(2)
    expect(yield* s.inbox).toEqual([])
    yield* gate.release
    yield* awaitWithTimeout(s.llm.wait(3), "The original worker result did not wake its Meta consumer")
    yield* awaitWithTimeout(execution.awaitIdle(otherSessionID), "The Goal worker did not settle")
    yield* awaitWithTimeout(execution.awaitIdle(sessionID), "The Goal worker result consumer did not settle")
    const noticeID = TaskOperation.notificationID({ sessionID, operationID: operation.operationID })
    const notice = `<task operation="${operation.operationID}" state="settled">\n${text}\n</task>`
    expect(s.requests[2].messages).toContainEqual(expect.objectContaining({
      id: noticeID, role: "user", content: [{ type: "text", text: notice }],
    }))
    const saved = yield* TaskOperation.get(s.db, { sessionID, operationID: operation.operationID })
    expect(saved).toMatchObject({ phase: "settled", result: { text, inputID: operation.inputID }, source: { type: "goal_round", goalID: goal.id, roundID: round.roundID } })
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: noticeID })
    expect(result).toMatchObject({ status: "completed", assistant: { content: [Expected.text("Meta consumed the full worker result")] } })
    if (result.status !== "completed") return yield* Effect.die(new Error("The Meta worker result consumer did not complete"))
    expect(saved?.consumers).toContainEqual(expect.objectContaining({ consumerSessionID: sessionID, assistantMessageID: result.assistant.id, resultDigest: saved?.result?.digest }))
    expect(yield* s.goals.get({ sessionID, goalID: goal.id })).toMatchObject({ rounds: [round], accounting: { rounds: 1, worker: { steps: 1, attempts: 1 } } })
    expect(s.requests).toHaveLength(3)
    expect(yield* s.inbox).toEqual([])
  }),
)

const recordedEventTypes = (id: Session.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.map((row) => row.type)),
      )
  })

const recordedStepSettlementEvents = (id: Session.ID, assistantMessageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const settlementTypes = new Set([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.tool.failed.2",
      "session.step.ended.1",
      "session.step.failed.1",
    ])
    return (yield* db
      .select({ type: EventTable.type, data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)).filter(
      (event) => settlementTypes.has(event.type) && event.data.assistantMessageID === assistantMessageID,
    )
  })

const recordedStepSettlementTypes = (id: Session.ID, assistantMessageID: SessionMessage.ID) =>
  recordedStepSettlementEvents(id, assistantMessageID).pipe(Effect.map((events) => events.map((event) => event.type)))

const hostedCall = (id: string, query: string) =>
  LLMEvent.toolCall({ id, name: "web_search", input: { query }, providerExecuted: true })

const requireAssistant = (messages: readonly SessionMessage.Info[]) => {
  const assistant = messages.find((message) => message.type === "assistant")
  if (!assistant) throw new Error("Assistant message missing")
  return assistant
}

const replaySessionProjection = (id: Session.ID, through?: Event.Seq) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const bus = yield* Bus.Service
    const recorded = yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)

    yield* bus.remove(id)
    yield* db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, id)).run().pipe(Effect.orDie)
    if (through !== undefined)
      yield* db.delete(SessionInputResultTable).where(eq(SessionInputResultTable.session_id, id)).run().pipe(Effect.orDie)
    yield* Effect.forEach(
      recorded.filter((event) => through === undefined || event.seq <= through).map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      })),
      (event) => bus.replay(event),
      { discard: true },
    )
  })

type FragmentKind = "text" | "reasoning" | "tool input"

type FragmentFixture = {
  readonly delta?: Event.Definition
  readonly completeEvents: LLMEvent[]
  readonly partialEvents: LLMEvent[]
  readonly expectedAssistant: unknown
  readonly expectedContent: unknown
}

const fragmentKinds: readonly FragmentKind[] = ["text", "reasoning", "tool input"]

const fragmentID = (kind: FragmentKind, suffix: string) => `${kind === "tool input" ? "call" : kind}-${suffix}`

const fragmentFixture = (kind: FragmentKind, id: string, chunks: readonly string[]): FragmentFixture => {
  const text = chunks.join("")
  switch (kind) {
    case "text": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id }),
        ...chunks.map((text) => LLMEvent.textDelta({ id, text })),
      ]
      const expectedContent = { type: "text", text }
      return {
        delta: SessionEvent.Text.Delta,
        partialEvents,
        completeEvents: [
          ...partialEvents,
          LLMEvent.textEnd({ id }),
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
          LLMEvent.finish({ reason: { normalized: "stop" } }),
        ],
        expectedAssistant: { type: "assistant", finish: "stop", content: [expectedContent] },
        expectedContent,
      }
    }
    case "reasoning": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id }),
        ...chunks.map((text) => LLMEvent.reasoningDelta({ id, text })),
      ]
      const expectedContent = { type: "reasoning", text }
      return {
        delta: SessionEvent.Reasoning.Delta,
        partialEvents,
        completeEvents: [
          ...partialEvents,
          LLMEvent.reasoningEnd({ id }),
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
          LLMEvent.finish({ reason: { normalized: "stop" } }),
        ],
        expectedAssistant: { type: "assistant", finish: "stop", content: [expectedContent] },
        expectedContent,
      }
    }
    case "tool input": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id, name: "echo" }),
        ...chunks.map((text) => LLMEvent.toolInputDelta({ id, name: "echo", text })),
      ]
      const expectedContent = { type: "tool", id, state: { status: "streaming", input: text } }
      return {
        partialEvents,
        completeEvents: [...partialEvents, LLMEvent.toolInputEnd({ id, name: "echo" })],
        expectedAssistant: {
          type: "assistant",
          content: [
            {
              type: "tool",
              id,
              state: { status: "error", input: {}, error: { type: "tool.input-incomplete" } },
            },
          ],
        },
        expectedContent,
      }
    }
  }
}

function* verifyEphemeralDeltas(s: Scenario, kind: FragmentKind) {
  const prompt = `Stream ${kind}`
  const chunks = Array.from({ length: 32 }, (_, index) => `${index},`)
  const fixture = fragmentFixture(kind, fragmentID(kind, "many"), chunks)
  const expectedContext = [
    { type: "user", text: prompt },
    fixture.expectedAssistant,
    ...(kind === "tool input" ? [Expected.assistant({}, [])] : []),
  ]
  yield* s.admit(prompt)
  const live = fixture.delta
    ? yield* s.bus.subscribe(fixture.delta).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
    : undefined
  yield* Effect.yieldNow
  yield* s.llm.push(fixture.completeEvents)

  yield* s.resume

  const deltas = fixture.delta
    ? yield* s.db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.type, Bus.versionedType(fixture.delta.type, 1)))
        .all()
        .pipe(Effect.orDie)
    : []
  if (live) {
    const streamed = Array.from(yield* Fiber.join(live))
    expect(streamed).toHaveLength(1)
    expect(
      streamed
        .map((event) => {
          if (!event.data || typeof event.data !== "object" || !("delta" in event.data))
            throw new Error("Expected delta event")
          if (typeof event.data.delta !== "string") throw new Error("Expected string delta")
          return event.data.delta
        })
        .join(""),
    ).toBe(chunks.join(""))
  }
  expect(deltas).toHaveLength(0)
  expect(yield* s.context).toMatchObject(expectedContext)

  yield* replaySessionProjection(sessionID)

  expect(yield* s.context).toMatchObject(expectedContext)
}

function* verifyPartialFlushOnFailure(s: Scenario, kind: FragmentKind) {
  const prompt = `Fail after ${kind}`
  const fixture = fragmentFixture(kind, fragmentID(kind, "partial"), ["Partial"])
  // A non-retryable failure keeps the step terminal so the flushed fragments settle durably.
  const failure = invalidRequest()
  yield* s.admit(prompt)
  yield* s.llm.push(TestLLM.failAfter(failure, ...fixture.partialEvents))

  expect(yield* s.resume.pipe(Effect.flip)).toBe(failure)
  expect(yield* s.context).toMatchObject([
    Expected.user(prompt),
    Expected.assistant({ finish: "error", error: { type: "provider.invalid-request", message: "Invalid request" } }, [
      kind === "tool input"
        ? Expected.failedTool(
            { id: fragmentID(kind, "partial") },
            { error: { type: "provider.invalid-request", message: "Invalid request" } },
          )
        : fixture.expectedContent,
    ]),
  ])
  expect(s.requests).toHaveLength(1)
}

function* verifyPartialFlushOnInterruption(s: Scenario, kind: FragmentKind) {
  const prompt = `Interrupt after ${kind}`
  const fixture = fragmentFixture(kind, fragmentID(kind, "interrupted"), ["Partial"])
  const streamed = yield* Deferred.make<void>()
  yield* s.admit(prompt)
  yield* s.llm.push(
    Stream.concat(
      Stream.fromIterable(fixture.partialEvents),
      Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
    ),
  )

  const runner = yield* SessionRunner.Service
  const fiber = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
  yield* Deferred.await(streamed)
  yield* Fiber.interrupt(fiber)
  const context = yield* s.context
  expect(context).toMatchObject([
    Expected.user(prompt),
    Expected.assistant({ finish: "error", error: { type: "aborted", message: "Step interrupted" } }, [
      kind === "tool input"
        ? Expected.failedTool({ id: fragmentID(kind, "interrupted") }, {})
        : fixture.expectedContent,
    ]),
  ])
  expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.completed.1")
  expect(requireAssistant(context).completion).toBeUndefined()
}

const prepareTitleGeneration = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const { db } = yield* Database.Service
  yield* db.update(SessionTable).set({ title: null }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("title"), (agent) => {
      agent.mode = "primary"
      agent.hidden = true
      agent.system = "Generate a title."
    }),
  )
})

const watchRename = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const bus = yield* Bus.Service
  return yield* bus.subscribe(SessionEvent.Renamed).pipe(
    Stream.filter((event) => event.data.sessionID === sessionID),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  )
})

describe("SessionRunnerLLM", () => {
  scenario("rejects a disabled Custom drain before settling or delivering durable controls", function* (s) {
    yield* s.admit("Pending work")
    yield* s.sessionInbox.admitCompaction({ id: SessionMessage.ID.create(), sessionID, delivery: "queue" })
    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
          projectID: Project.ID.global,
        },
        delivery: "queue",
      },
    })
    yield* s.db
      .update(SessionTable)
      .set({ mode: "custom" })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    const before = {
      session: yield* s.session.get(sessionID),
      inbox: yield* s.inbox,
      messages: yield* s.messages,
      events: yield* s.db.select().from(EventTable).all().pipe(Effect.orDie),
    }
    const runner = yield* SessionRunner.Service
    yield* withCustomMode(
      "false",
      Effect.forEach([false, true], (force) =>
        runner.drain({ sessionID, force }).pipe(
          Effect.flip,
          Effect.tap((error) =>
            Effect.sync(() => expect(error).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })),
          ),
        ),
      ),
    )
    expect({
      session: yield* s.session.get(sessionID),
      inbox: yield* s.inbox,
      messages: yield* s.messages,
      events: yield* s.db.select().from(EventTable).all().pipe(Effect.orDie),
    }).toEqual(before)
    expect(s.requests).toHaveLength(0)
    expect(s.closedTransports).toEqual([])
  })

  scenario("leaves controls pending when Custom runtime is disabled during a provider turn", function* (s) {
    yield* s.admit("Finish the active turn")
    const compaction = yield* s.sessionInbox.admitCompaction({
      id: SessionMessage.ID.create(),
      sessionID,
      delivery: "queue",
    })
    const moveID = SessionMessage.ID.create()
    yield* s.sessionInbox.admit({
      id: moveID,
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
          projectID: Project.ID.global,
        },
        delivery: "queue",
      },
    })
    yield* s.llm.push(TestLLM.stop())
    const gate = yield* s.llm.gate
    const runner = yield* SessionRunner.Service
    const running = yield* runner.drain({ sessionID, force: false }).pipe(Effect.forkChild)
    yield* gate.started
    // Mark the active row Custom at the provider gate. No frozen context is needed:
    // the next boundary must reject before any composition or control work.
    yield* s.db
      .update(SessionTable)
      .set({ mode: "custom" })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    yield* withCustomMode(
      "false",
      gate.release.pipe(
        Effect.andThen(Fiber.join(running)),
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => expect(error).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })),
        ),
      ),
    )
    expect((yield* s.inbox).map((input) => input.id)).toEqual([compaction.id, moveID])
    expect((yield* s.session.get(sessionID)).location.directory).toBe(AbsolutePath.make("/project"))
    expect((yield* s.messages).some((message) => message.type === "compaction")).toBe(false)
    expect(s.requests).toHaveLength(1)
    expect(s.closedTransports).toEqual([])
  })

  scenario("generates the title while the first model step is still running", function* (s) {
    yield* prepareTitleGeneration

    yield* s.admit("First prompt")
    yield* s.llm.push(TestLLM.text("Generated title", "text-title"), Stream.never)
    const renamed = yield* watchRename(sessionID)
    const runner = yield* SessionRunner.Service
    const fiber = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
    yield* Fiber.join(renamed)

    expect((yield* s.session.get(sessionID)).title).toBe("Generated title")
    yield* Fiber.interrupt(fiber)
  })

  scenario("does not automatically replace an existing session title", function* (s) {
    yield* prepareTitleGeneration
    yield* s.session.rename({ sessionID, title: "Manual title" })
    yield* s.admit("Follow-up prompt")
    yield* s.llm.push(TestLLM.text("Assistant response", "text-response"))

    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect((yield* s.session.get(sessionID)).title).toBe("Manual title")
  })

  scenario("coalesces title generation while a request is active", function* (s) {
    yield* prepareTitleGeneration

    const titleStarted = yield* Deferred.make<void>()
    const releaseTitle = yield* Deferred.make<void>()
    yield* Effect.gen(function* () {
      yield* s.admit("First prompt")
      yield* s.llm.push(
        Stream.unwrap(
          Deferred.succeed(titleStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseTitle)),
            Effect.as(Stream.fromIterable(TestLLM.text("Generated title", "text-title"))),
          ),
        ),
        TestLLM.text("First response", "text-first"),
        TestLLM.text("Second response", "text-second"),
      )

      const first = yield* s.resume.pipe(Effect.forkChild)
      yield* Deferred.await(titleStarted).pipe(Effect.timeout("5 seconds"))
      expect(s.requests[0]?.system.map((part) => part.text)).toContain("Generate a title.")
      yield* Fiber.join(first)
      yield* s.admit("Second prompt")
      yield* s.resume

      expect(s.requests).toHaveLength(3)
      const renamed = yield* watchRename(sessionID)
      yield* Deferred.succeed(releaseTitle, undefined)
      yield* Fiber.join(renamed)
      expect((yield* s.session.get(sessionID)).title).toBe("Generated title")
    }).pipe(Effect.ensuring(Deferred.succeed(releaseTitle, undefined)))
  })

  scenario("retries title generation from the first prompt after title and execution failures", function* (s) {
    yield* prepareTitleGeneration

    yield* s.admit("First prompt")
    yield* s.llm.push(Stream.fail(invalidRequest()), Stream.fail(invalidRequest()))
    expect((yield* s.resume.pipe(Effect.exit))._tag).toBe("Failure")

    yield* s.admit("Second prompt")
    const titleFailed = yield* Deferred.make<void>()
    yield* s.llm.push(
      Stream.make(LLMEvent.providerError({ message: "Title provider unavailable" })).pipe(
        Stream.ensuring(Deferred.succeed(titleFailed, undefined)),
      ),
      TestLLM.text("Recovered", "text-recovered"),
    )
    yield* s.resume
    yield* Deferred.await(titleFailed)
    yield* Effect.yieldNow
    expect((yield* s.session.get(sessionID)).title).toBeUndefined()

    const renamed = yield* watchRename(sessionID)
    yield* s.admit("Third prompt")
    yield* s.llm.push(
      TestLLM.text("Generated title", "text-title"),
      TestLLM.text("Recovered again", "text-recovered-again"),
    )
    yield* s.resume
    yield* Fiber.join(renamed)

    expect(s.requests).toHaveLength(6)
    expect(s.requests[2]?.messages).toContainEqual(Message.user("First prompt"))
    expect(s.requests[4]?.messages).toContainEqual(Message.user("First prompt"))
    expect((yield* s.session.get(sessionID)).title).toBe("Generated title")
  })

  scenario("advertises and executes a location registered tool", function* (s) {
    const registry = yield* Tool.Service
    const contexts: Tool.Context[] = []
    yield* transformTools(
      registry,
      {
        location_context: {
          name: "location_context",
          description: "Read application context",
          input: Schema.Struct({ query: Schema.String }),
          output: Schema.Struct({ answer: Schema.String }),
          execute: ({ query }, context) =>
            Effect.gen(function* () {
              contexts.push(context)
              yield* context.progress({ phase: "reading" })
              return { output: { answer: query.toUpperCase() } }
            }),
        },
      },
      { codemode: false },
    )
    yield* s.admit("Use application context")
    yield* s.llm.push(TestLLM.tool("call-location", "location_context", { query: "hello" }), [])

    const progressFiber = yield* s.bus.subscribe(SessionEvent.Tool.Progress).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID && event.data.id === "call-location"),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* s.resume

    expect(s.requests[0]?.tools.map((tool) => tool.name)).toContain("location_context")
    expect(contexts).toEqual([
      {
        sessionID,
        agent: Agent.ID.make("build"),
        messageID: expect.stringMatching(/^msg_/),
        id: Tool.CallID.make("call-location"),
        progress: expect.any(Function),
      },
    ])
    expect(Array.from(yield* Fiber.join(progressFiber))[0]?.data.metadata).toEqual({ phase: "reading" })
    expect(yield* s.context).toMatchObject([
      Expected.user("Use application context"),
      Expected.assistant({}, [
        Expected.completedTool({ id: "call-location" }, { content: [Expected.text('{"answer":"HELLO"}')] }),
      ]),
      Expected.assistant({}, []),
    ])
  })

  scenario("executes a tool renamed by a session context hook", function* (s) {
    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "context", (event) =>
      Effect.sync(() => {
        event.tools.renamed_echo = event.tools.echo!
        delete event.tools.echo
      }),
    )
    yield* s.admit("Use the renamed tool")
    yield* s.llm.push(TestLLM.tool("call-renamed", "renamed_echo", { text: "renamed" }), [])

    yield* s.resume

    expect(s.requests[0]?.tools.map((tool) => tool.name)).toContain("renamed_echo")
    expect(s.requests[0]?.tools.map((tool) => tool.name)).not.toContain("echo")
    expect(s.executions).toEqual(["renamed"])
  })

  scenario("executes the tool advertised before a registry reload", function* (s) {
    const registry = yield* Tool.Service
    const scope = yield* Scope.make()
    const executions: string[] = []
    yield* transformTools(
      registry,
      {
        reloaded: {
          name: "reloaded",
          description: "Record the advertised tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ value: Schema.String }),
          execute: () =>
            Effect.sync(() => executions.push("advertised")).pipe(Effect.as({ output: { value: "advertised" } })),
        },
      },
      { codemode: false },
    ).pipe(Scope.provide(scope))
    yield* s.admit("Use the reloaded tool")
    yield* s.llm.push(TestLLM.tool("call-reloaded", "reloaded", {}), [])

    const run = yield* s.resumePaused
    yield* Scope.close(scope, Exit.void)
    yield* transformTools(
      registry,
      {
        reloaded: {
          name: "reloaded",
          description: "Record the replacement tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ value: Schema.String }),
          execute: () =>
            Effect.sync(() => executions.push("replacement")).pipe(Effect.as({ output: { value: "replacement" } })),
        },
      },
      { codemode: false },
    )
    yield* run.finish

    expect(executions).toEqual(["advertised"])
    expect(yield* s.context).toMatchObject([
      Expected.user("Use the reloaded tool"),
      Expected.assistant({}, [
        Expected.completedTool({ id: "call-reloaded" }, { content: [Expected.text('{"value":"advertised"}')] }),
      ]),
      Expected.assistant({}, []),
    ])
  })

  scenario("delivers ordinary user corrections as one current snapshot before the same model request", function* (s) {
    yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
    yield* s.runPrompt("should be POST not GET")
    const corrections = yield* CorrectionStore.Service
    expect(yield* corrections.facts(sessionID)).toEqual([{ key: "user:POST", correct: "POST" }])
    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toContain("should be POST not GET")
    const data = userTexts(s.requests[0]).filter((text) => text.includes("<correction-data>"))
    expect(data).toHaveLength(1)
    expect(data[0]).toContain('"correct":"POST"')
    expect(data[0]).not.toContain("GET")
    yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
    yield* s.runPrompt("should be POST not GET")
    const snapshots = (yield* s.messages).filter(
      (message) => message.type === "synthetic" && message.metadata?.correctionSnapshot,
    )
    expect(snapshots).toHaveLength(2)
    expect(snapshots.filter((message) => message.type === "synthetic" && message.text !== "")).toHaveLength(1)
    expect(userTexts(s.requests[1]).filter((text) => text.includes("<correction-data>"))).toHaveLength(1)
  })

  for (const phase of ["source", "checkpoint"] as const) {
    scenario(`recovers a correction through public resume after ${phase} publication rolls back`, function* (s) {
      const defect = new Error(`correction ${phase} projection rejected`)
      let failing = true
      yield* s.bus.project(SessionEvent.InboxDelivered, () =>
        phase === "source" && failing ? Effect.die(defect) : Effect.void,
      )
      yield* s.bus.project(SessionEvent.Synthetic, (event) =>
        phase === "checkpoint" && failing && event.data.metadata?.correctionSnapshot ? Effect.die(defect) : Effect.void,
      )
      yield* s.admit("should be POST not GET")
      expect(yield* s.resume.pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
      expect(s.requests).toHaveLength(0)
      const corrections = yield* CorrectionStore.Service
      expect((yield* corrections.snapshot(sessionID)).current).toBeUndefined()
      expect((yield* s.messages).filter(CorrectionStore.isCorrectionHistory)).toHaveLength(0)
      expect(yield* s.inbox).toHaveLength(phase === "source" ? 1 : 0)
      failing = false
      yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
      yield* s.resume
      expect(s.requests).toHaveLength(1)
      const data = userTexts(s.requests[0]).filter((text) => text.includes("<correction-data>"))
      expect(data).toHaveLength(1)
      expect(data[0]).toContain('"correct":"POST"')
      expect(data[0]).not.toContain("GET")
      expect(yield* s.inbox).toEqual([])
      expect(yield* corrections.facts(sessionID)).toEqual([{ key: "user:POST", correct: "POST" }])
    })
  }

  for (const reason of ["manual", "overflow"] as const) {
    scenario(
      `uses current correction data in ${reason} compaction without copying its source into recent`,
      function* (s) {
        yield* s.llm.push(TestLLM.text("Earlier answer", "correction-history"))
        yield* s.runPrompt("Earlier task")
        const corrections = yield* CorrectionStore.Service
        yield* corrections.record({
          sessionID,
          entry: {
            key: "private-path",
            correct: "CURRENT_CORRECTION_NEW",
            wrong: "SOURCE_CORRECTION_OLD",
            source: "user-correction",
            extractLayer: 2,
          },
        })
        const before = s.requests.length
        if (reason === "manual") {
          yield* s.llm.push(TestLLM.text("## Objective\n- Continue task", "correction-summary"))
          yield* s.session.compact({ sessionID })
          yield* s.resume
        }
        if (reason === "overflow") {
          s.currentModel = recoveryModel
          yield* s.llm.push(
            [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
            TestLLM.text("## Objective\n- Continue task", "correction-summary"),
            TestLLM.text("Continued", "correction-recovered"),
          )
          yield* s.runPrompt("Continue task")
        }
        const requests = s.requests.slice(before)
        expect(requests).toHaveLength(reason === "manual" ? 1 : 3)
        const texts = userTexts(requests[reason === "manual" ? 0 : 1])
        expect(texts.join("\n")).toContain("CURRENT_CORRECTION_NEW")
        expect(texts.join("\n")).not.toContain("SOURCE_CORRECTION_OLD")
        expect(texts.filter((text) => text.includes("<correction-data>"))).toHaveLength(1)
        const compacted = (yield* s.messages).findLast((message) => message.type === "compaction")
        if (compacted?.type !== "compaction" || compacted.status !== "completed")
          return yield* Effect.die(new Error("Completed correction compaction missing"))
        expect(compacted.status).toBe("completed")
        expect(compacted.recent).not.toContain("SOURCE_CORRECTION_OLD")
        expect(compacted.recent).not.toContain("CURRENT_CORRECTION_NEW")
        expect(compacted.recent).not.toContain("<correction-data>")
      },
    )
  }

  scenario(
    "ages raw correction facts on six real tool-free completed Steps and preserves their history",
    function* (s) {
      const corrections = yield* CorrectionStore.Service
      yield* corrections.record({
        sessionID,
        entry: { key: "raw", correct: "Keep the algorithm simple", source: "user-correction", extractLayer: 3 },
      })
      expect(yield* corrections.facts(sessionID)).toHaveLength(1)
      for (const index of Array.from({ length: 6 }, (_, index) => index)) {
        yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
        yield* s.runPrompt(`Continue task ${index}`)
        expect(yield* corrections.facts(sessionID)).toHaveLength(index < 5 ? 1 : 0)
      }
      expect(s.requests).toHaveLength(6)
      expect(s.executions).toEqual([])
      yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
      yield* s.runPrompt("Show current work")
      expect(userTexts(s.requests[6]).join("\n")).not.toContain("Keep the algorithm simple")
      expect(
        (yield* s.messages).some(
          (message) => message.type === "synthetic" && message.text.includes("Keep the algorithm simple"),
        ),
      ).toBe(true)
      expect(userTexts(s.requests[6]).filter((text) => text.includes("<correction-data>"))).toHaveLength(1)
    },
  )

  scenario("does not extract a correction from synthetic input", function* (s) {
    yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
    yield* s.session.synthetic({ sessionID, text: "should be POST not GET" })
    yield* s.resume
    const corrections = yield* CorrectionStore.Service
    expect(yield* corrections.facts(sessionID)).toEqual([])
    expect(userTexts(s.requests[0])).toContain("should be POST not GET")
    expect(userTexts(s.requests[0]).join("\n")).not.toContain("<correction-data>")
  })

  for (const partial of [false, true]) {
    scenario(`counts a correction's retried logical Step once (partial=${partial})`, function* (s) {
      const corrections = yield* CorrectionStore.Service
      yield* corrections.record({
        sessionID,
        entry: { key: "raw", correct: "Keep work focused", source: "user-correction", extractLayer: 3 },
      })
      yield* s.admit("Continue work")
      yield* s.llm.push(
        partial
          ? TestLLM.failAfter(
              incompleteStream(),
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.textStart({ id: "partial-correction" }),
              LLMEvent.textDelta({ id: "partial-correction", text: "Partial work" }),
            )
          : Stream.fail(incompleteStream()),
        TestLLM.text("Finished", "correction-retry"),
      )
      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.forkIn(yield* Effect.scope))
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* awaitWithTimeout(Fiber.join(run), "Correction retry did not settle")
      expect(s.requests).toHaveLength(2)
      for (const index of Array.from({ length: 4 }, (_, index) => index)) {
        yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
        yield* s.runPrompt(`Continue work ${index}`)
      }
      expect(yield* corrections.facts(sessionID)).toHaveLength(1)
      yield* s.llm.push(Stream.fromIterable(TestLLM.stop()))
      yield* s.runPrompt("Finish work")
      expect(yield* corrections.facts(sessionID)).toEqual([])
      expect(s.requests).toHaveLength(7)
    })
  }

  scenario("starts a real runner step after default prompt recording", function* (s) {
    const message = yield* s.session.prompt({
      sessionID,
      text: "Run automatically",
    })
    yield* s.session.wait(sessionID)

    expect(s.requests).toHaveLength(1)
    expect(yield* s.messages).toMatchObject([
      Expected.assistant({}, []),
      { id: message.id, type: "user", text: "Run automatically" },
    ])
  })

  scenario("binds source protocol origins to actual user delivery and Step events", function* (s) {
    const input = yield* s.runPrompt("New source protocol request")
    const events = yield* s.db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all()
    const delivered = events.find((event) => event.type === "session.inbox.delivered.1")
    const started = events.find((event) => event.type === "session.step.started.1")
    const attempted = events.find((event) => event.type === "session.attempt.started.1")
    expect(delivered).toBeDefined()
    expect(started).toBeDefined()
    expect(attempted).toBeDefined()
    expect(delivered?.data).toHaveProperty("correctionSourceVersion", 1)
    const messages = yield* s.messages
    expect(messages.find((message) => message.type === "user")).toMatchObject({
      id: input.id,
      origin: { kind: "inbox-user", sessionID, id: delivered?.id, seq: delivered?.seq },
    })
    expect(messages.find((message) => message.type === "assistant")).toMatchObject({
      origin: { kind: "step", sessionID, id: attempted?.id, seq: attempted?.seq },
    })
    expect(attempted && started && attempted.seq < started.seq).toBe(true)
  })

  scenario("does not upgrade an unmarked historical source protocol delivery", function* (s) {
    yield* s.admit("Historical unmarked delivery")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer")
    expect((yield* s.context).find((message) => message.type === "user")).toMatchObject({
      origin: { kind: "historical" },
    })
    expect(s.requests).toHaveLength(0)
  })

  scenario("runs a follow-up when synthetic input arrives during an active continuation", function* (s) {
    const secondStarted = yield* Deferred.make<void>()
    const releaseSecond = yield* Deferred.make<void>()
    yield* s.llm.push(
      Stream.fromIterable(TestLLM.tool("call-echo", "echo", { text: "background started" })),
      Stream.unwrap(
        Deferred.succeed(secondStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseSecond)),
          Effect.as(Stream.fromIterable(TestLLM.stop())),
        ),
      ),
      Stream.fromIterable(TestLLM.text("Handled completion", "text-completion")),
    )
    yield* s.admit("Start background work")
    const running = yield* s.resume.pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(secondStarted)

    yield* s.session.synthetic({ sessionID, text: "Background work completed" })
    yield* Deferred.succeed(releaseSecond, undefined)
    yield* Fiber.join(running)

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[2])).toContain("Background work completed")
  })

  scenario("streams one request with registry definitions from chronological user history", function* (s) {
    yield* s.admit("First")
    yield* s.runPrompt("Second")

    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]?.model).toBe(model)
    expect(s.requests[0]?.tools.map((tool) => tool.name)).toEqual(["defect", "echo", "storefail"])
    expect(s.requests[0]?.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: [{ type: "text", text: "First" }] },
      { role: "user", content: [{ type: "text", text: "Second" }] },
    ])
    expect(yield* s.messages).toMatchObject([
      Expected.assistant({}, []),
      Expected.user("Second"),
      Expected.user("First"),
    ])
  })

  scenario("marks the initial instruction sync as baseline metadata", function* (s) {
    const instructionEvents: Event.Payload[] = []
    const unsubscribe = yield* s.bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === "session.instructions.updated") instructionEvents.push(event)
      }),
    )
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    yield* s.runPrompt("Second")
    yield* unsubscribe

    expect(instructionEvents).toHaveLength(2)
    expect(instructionEvents[0]?.metadata).toEqual({ instructions: { initial: true } })
    expect(instructionEvents[1]?.metadata).toBeUndefined()
  })

  scenario("retries the first request after system context becomes available", function* (s) {
    const messageID = SessionMessage.ID.create()
    s.systemUnavailable = true
    yield* s.session.prompt({
      id: messageID,
      sessionID,
      text: "First",
      resume: false,
    })

    const exit = yield* s.resume.pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Instructions.InitializationBlocked)
    expect(s.requests).toHaveLength(0)
    expect(yield* SessionInbox.has(s.db, sessionID, "steer")).toBe(true)
    expect(
      yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
    ).toBeUndefined()

    s.systemUnavailable = false
    yield* s.session.prompt({ id: messageID, sessionID, text: "First" })
    yield* s.session.wait(sessionID)

    expect(s.requests).toHaveLength(1)
    expect(messageRoles(s.requests[0])).toEqual(["user"])
  })

  scenario(
    "preserves instruction state and interrupts the source Location runner after a Session moves",
    function* (s) {
      yield* s.runPrompt("First")
      const instructionState = yield* s.db
        .select()
        .from(InstructionStateTable)
        .where(eq(InstructionStateTable.session_id, sessionID))
        .get()

      yield* s.bus.publish(SessionEvent.Moved, {
        sessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
        projectID: Project.ID.global,
      })
      expect(
        yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
      ).toEqual(instructionState)

      yield* s.admit("Second")
      const exit = yield* s.resume.pipe(Effect.exit)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(s.requests).toHaveLength(1)
      expect(yield* SessionInbox.has(s.db, sessionID, "steer")).toBe(true)
    },
  )

  scenario("settles compaction and delivers a move while initial instructions are unavailable", function* (s) {
    const runner = yield* SessionRunner.Service
    s.systemUnavailable = true
    let reads = 0
    s.systemLoadHook = Effect.sync(() => {
      reads++
    })
    const compaction = yield* s.sessionInbox.admitCompaction({
      id: SessionMessage.ID.create(),
      sessionID,
      delivery: "queue",
    })
    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
          projectID: Project.ID.global,
        },
        delivery: "queue",
      },
    })

    expect(yield* runner.drain({ sessionID, force: false })).toEqual(SessionRunner.DrainResult.Moved({}))

    // Compaction needs the model and instructions, so it reads them and fails; the move does not.
    expect(reads).toBe(1)
    expect(s.requests).toHaveLength(0)
    expect(yield* s.inbox).toEqual([])
    expect((yield* s.session.get(sessionID)).location.directory).toBe(AbsolutePath.make("/moved"))
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      error: { message: "Instruction initialization blocked by unavailable sources: test/context" },
    })
  })

  scenario("delivers a queued move atomically at the idle boundary", function* (s) {
    const inboxID = SessionMessage.ID.create()
    yield* s.sessionInbox.admit({
      id: inboxID,
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
          projectID: Project.ID.global,
        },
        delivery: "queue",
      },
    })

    yield* s.resume

    expect((yield* s.session.get(sessionID)).location.directory).toBe(AbsolutePath.make("/moved"))
    expect(yield* s.inbox).toEqual([])
    expect(s.requests).toEqual([])
    expect(s.closedTransports).toEqual([sessionID])
    expect(
      (yield* s.db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(desc(EventTable.seq))
        .limit(2)
        .all()).map((event) => event.type),
    ).toEqual([Bus.versionedType(SessionEvent.Moved.type, 1), Bus.versionedType(SessionEvent.InboxDelivered.type, 1)])
  })

  for (const delivery of ["steer", "queue"] as const) {
    scenario(`preserves a tool continuation and step allowance across chained moves (${delivery})`, function* (s) {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* s.admit("Echo before moving")
      yield* s.llm.push(TestLLM.tool("call-move", "echo", { text: "moving" }), TestLLM.text("Done", "text-after-move"))
      const tools = yield* s.blockTools()
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* tools.started
      yield* Effect.forEach(["steer", delivery] as const, (delivery) =>
        s.sessionInbox.admit({
          id: SessionMessage.ID.create(),
          sessionID,
          item: {
            type: "move",
            payload: {
              location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
              projectID: Project.ID.global,
            },
            delivery,
          },
        }),
      )

      yield* tools.release
      yield* Fiber.join(run)

      expect(s.requests).toHaveLength(2)
      expect(messageRoles(s.requests[1])?.slice(0, 3)).toEqual(["user", "assistant", "tool"])
      expect(s.requests[0]?.toolChoice).toBeUndefined()
      expect(s.requests[1]?.toolChoice).toMatchObject({ type: "none" })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === "session.step.started.1" || type === "session.moved.1",
        ),
      ).toEqual(["session.step.started.1", "session.moved.1", "session.moved.1", "session.step.started.1"])
      expect(yield* s.inbox).toEqual([])
    })
  }

  scenario("keeps queued input parked across a mid-turn move", function* (s) {
    yield* s.admit("Echo before moving")
    yield* s.llm.push(
      TestLLM.tool("call-move", "echo", { text: "moving" }),
      TestLLM.text("Done", "text-after-move"),
      TestLLM.text("Handled queue", "text-after-queue"),
    )
    const tools = yield* s.blockTools()
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* s.session.prompt({ sessionID, text: "Queued for later", delivery: "queue", resume: false })
    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          projectID: Project.ID.global,
        },
        delivery: "steer",
      },
    })

    yield* tools.release
    yield* Fiber.join(run)

    // The resumed turn absorbs steers only; queued input waits for the turn to end.
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[1])).not.toContain("Queued for later")
    expect(userTexts(s.requests[2])).toContain("Queued for later")
  })

  scenario("runs a queued control on Location entry before a carried continuation", function* (s) {
    const runner = yield* SessionRunner.Service
    yield* s.admit("Echo before moving")
    yield* s.llm.push(
      TestLLM.tool("call-entry", "echo", { text: "moving" }),
      TestLLM.text("## Objective\n- Entry summary", "entry-summary"),
      TestLLM.text("Continued", "entry-continuation"),
    )
    const stream = yield* s.llm.gate
    const run = yield* runner.drain({ sessionID, force: false }).pipe(Effect.forkChild)
    yield* stream.started
    const compaction = yield* s.sessionInbox.admitCompaction({
      id: SessionMessage.ID.create(),
      sessionID,
      delivery: "queue",
    })
    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          projectID: Project.ID.global,
        },
        delivery: "steer",
      },
    })
    yield* stream.release
    const moved = yield* Fiber.join(run)

    expect(moved).toEqual(SessionRunner.DrainResult.Moved({ continuation: { step: 2 } }))
    expect(s.requests).toHaveLength(1)
    expect(yield* SessionInbox.find(s.db, compaction.id)).toMatchObject({ id: compaction.id })
    if (moved._tag !== "Moved") throw new Error("Expected a Location handoff")

    // Location entry considers queued controls even when model work carries across the move.
    yield* runner.drain({ sessionID, force: false, continuation: moved.continuation })

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[2])[0]).toContain("<summary>\n## Objective\n- Entry summary\n</summary>")
    expect(yield* s.inbox).toEqual([])
  })

  scenario(
    "restores installed native context with auto disabled and preserves it across fork and revert",
    function* (s) {
      const compaction = yield* SessionCompaction.Service
      yield* compaction.transform((editor) => editor.configure({ auto: false }))
      yield* s.runPrompt("Original request")
      s.systemBaseline = "Checkpoint instructions"
      yield* s.runPrompt("Before checkpoint")
      const target = SessionProviderContext.provenance({
        model: s.currentModel,
        ref: Model.Ref.make({
          id: Model.ID.make(s.currentModel.id),
          providerID: Provider.ID.make(s.currentModel.provider),
        }),
      })
      if (!target) throw new Error("Expected concrete fixture endpoint")
      const replacement = [
        Message.assistant(CompactionPart.make({ provider: s.currentModel.provider, encrypted: "checkpoint" })),
      ]
      const providerContext = SessionProviderContext.encode(target, replacement)
      yield* s.bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "",
        recent: "",
        providerContext,
      })
      const checkpoint = (yield* s.messages).find((message) => message.type === "compaction")
      if (!checkpoint) throw new Error("Expected checkpoint")

      s.systemBaseline = "Newest instructions"
      const after = yield* s.runPrompt("After checkpoint")
      const continued = s.requests.at(-1)
      if (!continued) throw new Error("Expected continuation request")
      expect(continued.messages[0]).toEqual(replacement[0])
      expect(continued.system.map((part) => part.text)).toContain("Checkpoint instructions")
      expect(systemTexts(continued)).toEqual(["Newest instructions"])

      const forked = yield* s.session.fork({ sessionID, before: after.id })
      yield* s.session.prompt({ sessionID: forked.id, text: "Fork prompt", resume: false })
      yield* s.session.resume(forked.id)
      expect(s.requests.at(-1)?.messages[0]).toEqual(replacement[0])
      expect(s.requests.at(-1)?.system.map((part) => part.text)).toContain("Newest instructions")
      expect(s.requests.at(-1)?.messages.filter((message) => message.role === "system")).toEqual([
        Message.system("Newest instructions"),
      ])
      expect(
        (yield* s.session.messages({ sessionID: forked.id })).find((message) => message.type === "compaction"),
      ).toMatchObject({ providerContext })

      const original = s.currentModel
      s.currentModel = LanguageModel.update(original, { id: "different-deployment" })
      yield* s.session.prompt({ sessionID: forked.id, text: "Switched fork", resume: false })
      yield* s.session.resume(forked.id)
      expect(s.requests.at(-1)?.messages[0]?.content).toEqual([Message.text("Original request")])
      expect(s.requests.at(-1)?.messages.filter((message) => message.role === "system")).toEqual([
        Message.system("Newest instructions"),
      ])
      s.currentModel = original

      yield* s.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID, to: checkpoint.id })
      yield* s.runPrompt("After revert")
      expect(
        s.requests
          .at(-1)
          ?.messages.flatMap((message) => message.content)
          .some((part) => part.type === "compaction"),
      ).toBe(false)
      expect(s.requests.at(-1)?.messages[0]?.content).toEqual([Message.text("Original request")])
      expect(
        (yield* s.session.messages({ sessionID: forked.id })).find((message) => message.type === "compaction"),
      ).toMatchObject({ providerContext })

      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "model.request", (event) =>
        Effect.sync(() => {
          event.baseURL = "https://another-deployment.example/v1"
        }),
      )
      const before = s.requests.length
      yield* s.session.prompt({ sessionID: forked.id, text: "Changed route", resume: false })
      expect(yield* s.session.resume(forked.id).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
      expect(s.requests).toHaveLength(before)
    },
  )

  scenario("seeds a fork with the parent's newest instruction values", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    const second = yield* s.runPrompt("Second")
    s.systemBaseline = "Latest context"
    yield* s.runPrompt("Third")

    const forked = yield* s.session.fork({ sessionID, before: second.id })
    expect(
      yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, forked.id)).get(),
    ).toMatchObject({
      initial_values: { "test/context": Instructions.hash("Latest context") },
      current_values: { "test/context": Instructions.hash("Latest context") },
    })
    yield* s.session.prompt({ sessionID: forked.id, text: "Forked", resume: false })
    yield* s.session.resume(forked.id)

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, fakeIdentity, "Latest context"])
    // Copied history keeps the frozen chronological update; no new update is emitted.
    expect(systemTexts(s.requests.at(-1)!)).toContain("Changed context")
    expect(systemTexts(s.requests.at(-1)!)).not.toContain("Latest context")

    const recorded = yield* s.db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, forked.id))
      .orderBy(asc(EventTable.seq))
      .all()
    yield* s.bus.remove(forked.id)
    yield* s.db.delete(SessionTable).where(eq(SessionTable.id, forked.id)).run()
    yield* Effect.forEach(
      recorded.map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      })),
      (event) => s.bus.replay(event),
      { discard: true },
    )
    expect(
      yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, forked.id)).get(),
    ).toMatchObject({ current_values: { "test/context": Instructions.hash("Latest context") } })
  })

  scenario("keeps nested forks self-contained", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    const second = yield* s.runPrompt("Second")

    const child = yield* s.session.fork({ sessionID, before: second.id })
    const inheritedFirst = (yield* s.session.messages({ sessionID: child.id })).find(
      (message) => message.type === "user" && message.text === "First",
    )
    if (!inheritedFirst) return yield* Effect.die(new Error("Nested fork boundary message not found"))
    const grandchild = yield* s.session.fork({
      sessionID: child.id,
      before: inheritedFirst.id,
    })

    expect(
      yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, grandchild.id)).get(),
    ).toMatchObject({
      initial_values: { "test/context": Instructions.hash("Changed context") },
      current_values: { "test/context": Instructions.hash("Changed context") },
    })
    return undefined
  })

  scenario("re-establishes a fresh baseline when instruction state is missing", function* (s) {
    yield* s.runPrompt("First")
    yield* s.db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).run()
    yield* s.admit("Second")
    s.requests.length = 0

    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]?.system.map((part) => part.text)).toEqual([defaultSystem, fakeIdentity, "Initial context"])
    expect(messageRoles(s.requests[0])).toEqual(["user", "user"])
    // The projected row is authoritative: a missing row admits a fresh baseline
    // instead of rebuilding from durable events.
    expect(
      yield* s.db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.type, "session.instructions.updated.2"))
        .all(),
    ).toHaveLength(2)
    expect(yield* s.db.select().from(InstructionStateTable).get()).toMatchObject({
      initial_values: { "test/context": Instructions.hash("Initial context") },
      current_values: { "test/context": Instructions.hash("Initial context") },
    })
  })

  scenario("keeps the initial instructions stable and derives a chronological update from values", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    yield* s.runPrompt("Second")

    for (const field of [
      "model",
      "generation",
      "providerOptions",
      "http",
      "toolChoice",
      "cache",
      "tools",
      "system",
    ] as const)
      expect(s.requests[1][field]).toEqual(s.requests[0][field])
    expect(s.requests[0].messages).toHaveLength(1)
    expect(s.requests[1].messages.slice(0, 1)).toEqual([...s.requests[0].messages])
    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, fakeIdentity, "Initial context"],
    ])
    expect(messageRoles(s.requests[1])).toEqual(["user", "system", "user"])
    expect(s.requests[1]?.messages.at(1)?.content).toEqual([Expected.text("Changed context")])
    // The chronological update is a durable client-visible system message.
    const messages = yield* s.messages
    expect(messages).toHaveLength(5)
    expect(messages[0]).toMatchObject(Expected.assistant({}, []))
    expect(messages[2]).toMatchObject({ type: "system", text: "Changed context" })
    expect(messages[3]).toMatchObject(Expected.assistant({}, []))

    const updates = yield* s.db
      .select({ data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.type, "session.instructions.updated.2"))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)
    expect(updates).toHaveLength(2)
    expect(updates[0]?.data).toMatchObject({
      sessionID,
      delta: { "test/context": Instructions.hash("Initial context") },
    })
    expect(updates[1]?.data).toEqual({
      sessionID,
      delta: { "test/context": Instructions.hash("Changed context") },
      text: "Changed context",
    })
    yield* replaySessionProjection(sessionID)
    expect(yield* s.messages).toHaveLength(5)
  })

  scenario("uses the selected model family prompt when the agent does not override it", function* (s) {
    s.currentModel = LanguageModel.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
    yield* s.admit("First")

    yield* s.llm.push(TestLLM.text("Done", "text-provider-prompt"))
    yield* s.resume

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([
      expect.stringContaining("# Delegation"),
      gptIdentity,
      "Initial context",
    ])
  })

  scenario("uses the selected model family prompt when the agent system override is empty", function* (s) {
    s.currentModel = LanguageModel.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
    const agent = yield* Agent.Service
    yield* agent.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.system = ""
        agent.mode = "primary"
      }),
    )
    yield* s.admit("First")

    yield* s.llm.push(TestLLM.text("Done", "text-empty-agent-system"))
    yield* s.resume

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([
      expect.stringContaining("# Delegation"),
      gptIdentity,
      "Initial context",
    ])
  })

  scenario("includes the effective default agent system before durable context", function* (s) {
    const agent = yield* Agent.Service
    yield* agent.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.system = "Build agent instructions"
        agent.mode = "primary"
      }),
    )
    yield* s.admit("First")

    yield* s.llm.push(TestLLM.text("Done", "text-build"))
    yield* s.resume

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([
      "Build agent instructions",
      fakeIdentity,
      "Initial context",
    ])
  })

  scenario("uses the configured default agent system for omitted-agent sessions", function* (s) {
    const agent = yield* Agent.Service
    yield* agent.transform((editor) => {
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.system = "Build agent instructions"
        agent.mode = "primary"
      })
      editor.update(Agent.ID.make("reviewer"), (agent) => {
        agent.system = "Reviewer instructions"
        agent.mode = "primary"
      })
      editor.default(Agent.ID.make("reviewer"))
    })
    yield* s.admit("First")

    yield* s.llm.push(TestLLM.text("Done", "text-reviewer"))
    yield* s.resume

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([
      "Reviewer instructions",
      fakeIdentity,
      "Initial context",
    ])
    expect((yield* s.messages)[0]).toMatchObject({ type: "assistant", agent: "reviewer" })
  })

  scenario("uses an explicitly selected non-build agent system", function* (s) {
    const agent = yield* Agent.Service
    yield* agent.transform((editor) =>
      editor.update(Agent.ID.make("reviewer"), (agent) => {
        agent.system = "Reviewer instructions"
        agent.mode = "primary"
      }),
    )
    yield* s.db
      .update(SessionTable)
      .set({ agent: "reviewer" })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    yield* s.admit("First")

    yield* s.llm.push(TestLLM.text("Done", "text-selected"))
    yield* s.resume

    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([
      "Reviewer instructions",
      fakeIdentity,
      "Initial context",
    ])
    expect((yield* s.messages)[0]).toMatchObject({ type: "assistant", agent: "reviewer" })
  })

  scenario("fails before the model request when the selected agent is unavailable", function* (s) {
    yield* s.db
      .update(SessionTable)
      .set({ agent: "explore" })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    yield* s.session.prompt({ sessionID, text: "Inspect files", resume: false })

    s.requests.length = 0
    yield* s.llm.push([])
    const failure = yield* s.resume.pipe(Effect.flip)

    expect(failure).toMatchObject({
      _tag: "Session.AgentNotFoundError",
      sessionID,
      agent: "explore",
    })
    expect(s.requests).toHaveLength(0)
  })

  scenario("updates selected-agent skill instructions after an agent switch", function* (s) {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("reviewer"), (agent) => {
        agent.mode = "primary"
      }),
    )
    s.skillBaselines.set(Agent.ID.make("build"), "Build skills")
    yield* s.runPrompt("First")
    s.skillBaselines.set(Agent.ID.make("reviewer"), "Reviewer skills")
    yield* s.bus.publish(SessionEvent.AgentSelected, {
      sessionID,
      agent: Agent.ID.make("reviewer"),
    })
    yield* s.runPrompt("Second")

    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Build skills\n\nInitial context"],
      [defaultSystem, fakeIdentity, "Build skills\n\nInitial context"],
    ])
    expect(systemTexts(s.requests[1])).toContainEqual(expect.stringContaining("Reviewer skills"))
  })

  scenario("keeps the sampled agent when selection changes during observation", function* (s) {
    s.skillBaselines.set(Agent.ID.make("build"), "Build skills")
    s.skillBaselines.set(Agent.ID.make("reviewer"), "Reviewer skills")
    let switched = false
    s.systemLoadHook = Effect.suspend(() => {
      if (switched) return Effect.void
      switched = true
      return s.bus
        .publish(SessionEvent.AgentSelected, {
          sessionID,
          agent: Agent.ID.make("reviewer"),
        })
        .pipe(Effect.asVoid)
    })
    yield* s.runPrompt("First")

    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Build skills\n\nInitial context"],
    ])
  })

  scenario("keeps the sampled model when selection changes during model resolution", function* (s) {
    let switched = false
    s.modelResolveHook = Effect.suspend(() => {
      if (switched) return Effect.void
      switched = true
      return s.bus
        .publish(SessionEvent.ModelSelected, {
          sessionID,
          model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
        })
        .pipe(Effect.asVoid)
    })
    yield* s.runPrompt("First")
    expect(s.requests.map((request) => request.model)).toEqual([model])
    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
    ])
  })

  scenario("admits removed context as a chronological System message", function* (s) {
    yield* s.runPrompt("First")
    s.systemRemoved = true
    yield* s.runPrompt("Second")

    expect(messageRoles(s.requests[1])).toEqual(["user", "system", "user"])
    expect(s.requests[1]?.messages.at(1)?.content).toEqual([
      Expected.text("System context source removed: test/context"),
    ])
    expect(yield* s.messages).toMatchObject([
      Expected.assistant({}, []),
      Expected.user("Second"),
      { type: "system", text: "System context source removed: test/context" },
      Expected.assistant({}, []),
      Expected.user("First"),
    ])
  })

  scenario("renders API context entries through add, change, and removal", function* (s) {
    const contextEntries = yield* InstructionEntry.Service
    yield* contextEntries.put({ sessionID, key: "deploy-target", value: "production" })
    yield* s.runPrompt("First")

    // String values render verbatim inside the initial tagged block.
    expect(s.requests[0]?.system.map((part) => part.text)).toEqual([
      defaultSystem,
      fakeIdentity,
      ["Initial context", "", '<context key="deploy-target">', "production", "</context>"].join("\n"),
    ])

    // Non-string JSON pretty-prints; the change narrates as a System update.
    yield* contextEntries.put({ sessionID, key: "deploy-target", value: { region: "us-east-1" } })
    yield* s.runPrompt("Second")

    expect(messageRoles(s.requests[1])).toEqual(["user", "system", "user"])
    expect(s.requests[1]?.messages.at(1)?.content).toEqual([
      Expected.text(
        [
          'The context under "deploy-target" changed and supersedes the previous value:',
          '<context key="deploy-target">',
          "{",
          '  "region": "us-east-1"',
          "}",
          "</context>",
        ].join("\n"),
      ),
    ])
    expect(yield* contextEntries.list(sessionID)).toEqual([{ key: "deploy-target", value: { region: "us-east-1" } }])

    // Deleting the row announces removal through the stored removal text.
    yield* contextEntries.remove({ sessionID, key: "deploy-target" })
    yield* s.runPrompt("Third")

    expect(messageRoles(s.requests[2])).toEqual(["user", "system", "user", "system", "user"])
    expect(s.requests[2]?.messages.at(-2)?.content).toEqual([
      Expected.text('The context under "deploy-target" no longer applies. Disregard it.'),
    ])
    expect(yield* contextEntries.list(sessionID)).toEqual([])
  })

  scenario("retains JSON null API entries as values", function* (s) {
    const entries = yield* InstructionEntry.Service
    yield* entries.put({ sessionID, key: "nullable", value: "present" })
    yield* s.runPrompt("First")

    yield* entries.put({ sessionID, key: "nullable", value: null })
    yield* s.runPrompt("Second")

    expect(s.requests[1]?.messages.at(1)?.content).toEqual([
      Expected.text(
        [
          'The context under "nullable" changed and supersedes the previous value:',
          '<context key="nullable">',
          "null",
          "</context>",
        ].join("\n"),
      ),
    ])
    expect(yield* entries.list(sessionID)).toEqual([{ key: "nullable", value: null }])
  })

  scenario("accepts API instruction entries up to 256 KiB", function* () {
    const entries = yield* InstructionEntry.Service
    const value = "x".repeat(InstructionEntry.MaxValueBytes - 2)

    yield* entries.put({ sessionID, key: "large", value })

    expect(yield* entries.list(sessionID)).toEqual([{ key: "large", value }])
  })

  scenario("rejects API instruction entries larger than 256 KiB", function* () {
    const entries = yield* InstructionEntry.Service

    const exit = yield* entries
      .put({ sessionID, key: "oversized", value: "x".repeat(InstructionEntry.MaxValueBytes) })
      .pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(InstructionEntry.ValueTooLargeError)
    expect(yield* entries.list(sessionID)).toEqual([])
  })

  scenario("keeps initial instructions and chronological updates after a model switch", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    yield* s.runPrompt("Second")
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
    })
    s.systemBaseline = "Replacement context"
    yield* s.runPrompt("Third")

    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, replacementIdentity, "Initial context"],
    ])
    expect(messageRoles(s.requests[1])).toEqual(["user", "system", "user"])
    expect(s.requests[2]?.messages.filter((message) => message.role === "system")).toHaveLength(2)
    expect((yield* s.context).map((message) => message.type)).toEqual([
      "user",
      "assistant",
      "system",
      "user",
      "assistant",
      "model-switched",
      "system",
      "user",
      "assistant",
    ])
    yield* replaySessionProjection(sessionID)
    expect(yield* s.messages).toHaveLength(9)
    yield* s.runPrompt("Fourth")
  })

  scenario("records a same-model effort switch as a cache-preserving effort update", function* (s) {
    s.currentModel = LanguageModel.make({ id: "claude-opus-5", provider: "anthropic", route: AnthropicMessages.route })
    const model = { id: ID.make("claude-opus-5"), providerID: Provider.ID.make("anthropic") }
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { ...model, variant: Model.VariantID.make("high") },
    })
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-effort-high"))
    yield* s.runPrompt("First")
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { ...model, variant: Model.VariantID.make("low") },
    })
    s.currentModel = LanguageModel.update(s.currentModel, { defaults: { providerOptions: { effort: "low" } } })
    yield* s.llm.push(TestLLM.text("Later answer", "text-effort-low"))
    yield* s.runPrompt("Second")

    expect(messageRoles(s.requests[1])).toEqual(["user", "assistant", "system", "user"])
    expect(s.requests[1]?.messages[2]).toEqual(Message.effort({ effort: "low", previous: "high" }))

    const compiled = yield* compileRequest(s.requests[1]!)
    expect(compiled.body).toMatchObject({
      output_config: { effort: "high" },
      messages: [
        { role: "user" },
        { role: "assistant" },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user" },
      ],
    })
  })

  scenario("preserves instruction values while a source is temporarily unavailable", function* (s) {
    yield* s.runPrompt("First")
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
    })
    s.systemUnavailable = true
    yield* s.runPrompt("Second")
    s.systemUnavailable = false
    s.systemBaseline = "Replacement context"
    yield* s.runPrompt("Third")

    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, replacementIdentity, "Initial context"],
      [defaultSystem, replacementIdentity, "Initial context"],
    ])
  })

  scenario("moves the epoch at compaction and narrates later changes", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed before compaction"
    yield* s.llm.push(TestLLM.text("## Objective\n- summary", "epoch-summary"))
    yield* s.session.compact({ sessionID })
    yield* s.resume
    expect(systemTexts(s.requests[1])).toEqual([])
    expect((yield* s.context).some((message) => message.type === "system")).toBe(false)
    s.systemBaseline = "Replacement context"
    yield* s.runPrompt("Second")

    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, fakeIdentity, "Initial context"],
    ])
    expect(messageRoles(s.requests[2])).toEqual(["user", "system", "user"])
    expect(s.requests[2]?.messages.at(1)?.content).toEqual([Expected.text("Replacement context")])
    yield* replaySessionProjection(sessionID)
    const latest = yield* s.runPrompt("Third")
    expect(systemTexts(s.requests[3])).toEqual(["Replacement context"])
    const fork = yield* s.session.fork({ sessionID, before: latest.id })
    expect(
      (yield* s.session.context(fork.id)).flatMap((message) => (message.type === "system" ? [message.text] : [])),
    ).toEqual(["Replacement context"])
  })

  for (const order of ["before", "between", "after"] as const) {
    scenario(`prioritizes manual compaction admitted ${order} two steers at the safe boundary`, function* (s) {
      s.currentModel = recoveryModel
      yield* s.llm.push(
        TestLLM.text("Active complete", "active"),
        TestLLM.text("## Objective\n- Active work checkpoint", "summary"),
        TestLLM.text("Steers complete", "steers"),
      )
      yield* s.admit("Active work")
      const active = yield* s.resumePaused
      const compactID = SessionMessage.ID.create()
      if (order === "before") yield* s.session.compact({ sessionID, id: compactID })
      const first = yield* s.admit("STEER_A")
      if (order === "between") yield* s.session.compact({ sessionID, id: compactID })
      const second = yield* s.admit("STEER_B")
      if (order === "after") yield* s.session.compact({ sessionID, id: compactID })
      expect((yield* s.session.compact({ sessionID })).id).toBe(compactID)

      expect(s.requests).toHaveLength(1)
      expect(yield* s.inbox).toHaveLength(3)
      expect((yield* s.messages).some((message) => message.type === "compaction")).toBe(false)
      yield* active.finish

      expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
      expect(s.requests).toHaveLength(3)
      expect(userTexts(s.requests[1])).not.toContain("STEER_A")
      expect(userTexts(s.requests[1])).not.toContain("STEER_B")
      expect(userTexts(s.requests[2]).slice(-2)).toEqual(["STEER_A", "STEER_B"])
      expect(yield* s.inbox).toEqual([])
      expect((yield* s.messages).filter((message) => message.id === compactID)).toMatchObject([
        { type: "compaction", status: "completed" },
      ])
      expect((yield* s.context).filter((message) => message.type === "user").map((message) => message.id)).toEqual([
        first.id,
        second.id,
      ])
      // An advisory drain must not redeliver either steer or rerun compaction.
      const runner = yield* SessionRunner.Service
      yield* runner.drain({ sessionID, force: false })
      expect(s.requests).toHaveLength(3)
    })
  }

  scenario("waits for active tools before prioritizing compaction over pending steers", function* (s) {
    yield* s.llm.push(
      TestLLM.tool("call-active", "echo", { text: "active" }),
      TestLLM.text("## Objective\n- Tool work checkpoint", "summary"),
      TestLLM.text("Steers complete", "steers"),
    )
    yield* s.admit("Active work")
    const tools = yield* s.blockTools()
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* s.admit("STEER_A")
    yield* s.admit("STEER_B")
    const compact = yield* s.session.compact({ sessionID })
    expect(s.requests).toHaveLength(1)
    expect((yield* s.messages).some((message) => message.id === compact.id)).toBe(false)
    yield* tools.release
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
    expect(s.requests[1].messages.some((message) => message.role === "tool")).toBe(true)
    expect(userTexts(s.requests[2]).slice(-2)).toEqual(["STEER_A", "STEER_B"])
    expect(yield* s.inbox).toEqual([])
  })

  scenario("rechecks compaction admitted during boundary context preparation", function* (s) {
    yield* s.runPrompt("Earlier work")
    yield* s.admit("STEER_A")
    yield* s.admit("STEER_B")
    const preparing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    s.systemLoadHook = Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Deferred.await(release)))
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Earlier work checkpoint", "summary"),
      TestLLM.text("Steers complete", "steers"),
    )
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Deferred.await(preparing)
    yield* s.session.compact({ sessionID })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(run)
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
    expect(userTexts(s.requests[2]).slice(-2)).toEqual(["STEER_A", "STEER_B"])
    expect(yield* s.inbox).toEqual([])
  })

  for (const outcome of ["cancelled", "failed"] as const) {
    scenario(`preserves both earlier steers when prioritized compaction is ${outcome}`, function* (s) {
      yield* s.llm.push(TestLLM.text("Active complete", "active"))
      yield* s.admit("Active work")
      const active = yield* s.resumePaused
      const first = yield* s.admit("STEER_A")
      const second = yield* s.admit("STEER_B")
      const compact = yield* s.session.compact({ sessionID })
      if (outcome === "cancelled") yield* s.session.cancelInbox({ sessionID, inboxID: compact.id })
      if (outcome === "failed") yield* s.llm.push([LLMEvent.providerError({ message: "summary unavailable" })])
      yield* s.llm.push(TestLLM.text("Steers complete", "steers"))
      yield* active.finish

      expect(s.requests).toHaveLength(outcome === "cancelled" ? 2 : 3)
      if (outcome === "failed") {
        expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
        expect((yield* s.messages).find((message) => message.id === compact.id)).toMatchObject({
          status: "failed",
          error: { type: "provider.error", message: "summary unavailable" },
        })
      }
      if (outcome === "cancelled") expect((yield* s.messages).some((message) => message.id === compact.id)).toBe(false)
      expect(userTexts(s.requests[s.requests.length - 1]).slice(-2)).toEqual(["STEER_A", "STEER_B"])
      expect(
        (yield* s.context)
          .filter((message) => message.id === first.id || message.id === second.id)
          .map((message) => message.id),
      ).toEqual([first.id, second.id])
      expect(yield* s.inbox).toEqual([])
    })
  }

  scenario("keeps steers durable across interrupted priority compaction and replay", function* (s) {
    yield* s.runPrompt("Earlier work")
    const first = yield* s.admit("STEER_A")
    const second = yield* s.admit("STEER_B")
    yield* s.llm.push(TestLLM.text("## Objective\n- Interrupted checkpoint", "summary"))
    const summary = yield* s.llm.gate
    const compact = yield* s.session.compact({ sessionID })
    yield* summary.started
    expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
    expect((yield* s.inbox).map((item) => item.id)).toEqual([first.id, second.id])
    yield* s.session.interrupt(sessionID)
    yield* s.session.wait(sessionID)
    yield* summary.release
    expect((yield* s.messages).find((message) => message.id === compact.id)).toMatchObject({ status: "failed" })
    yield* replaySessionProjection(sessionID)
    expect((yield* s.inbox).map((item) => item.id)).toEqual([first.id, second.id])

    yield* s.llm.push(TestLLM.text("Recovered steers", "steers"))
    yield* s.resume
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[2]).slice(-2)).toEqual(["STEER_A", "STEER_B"])
    expect(yield* s.inbox).toEqual([])
  })

  scenario("does not pull compaction across an earlier move", function* (s) {
    yield* s.admit("STEER_A")
    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: {
          location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
          projectID: Project.ID.global,
        },
        delivery: "steer",
      },
    })
    yield* s.admit("STEER_B")
    yield* s.sessionInbox.admitCompaction({ id: SessionMessage.ID.create(), sessionID, delivery: "steer" })
    yield* s.llm.push(
      TestLLM.text("First steer complete", "first"),
      TestLLM.text("## Objective\n- Source work checkpoint", "summary"),
      TestLLM.text("Second steer complete", "second"),
    )
    yield* s.resume
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[0])).toEqual(["STEER_A"])
    expect(userTexts(s.requests[1]).at(-1)).toContain("Summarize only what the user and the assistant said and did")
    expect(userTexts(s.requests[2]).at(-1)).toBe("STEER_B")
    expect(
      (yield* recordedEventTypes(sessionID)).filter(
        (type) => type === "session.moved.1" || type === "session.compaction.started.1",
      ),
    ).toEqual(["session.moved.1", "session.compaction.started.1"])
  })

  scenario("runs steers before queued compaction and later queued input", function* (s) {
    s.currentModel = recoveryModel
    yield* s.llm.push(
      TestLLM.tool("call-active", "echo", { text: "active" }),
      TestLLM.text("Steer complete", "text-steer"),
      [LLMEvent.textDelta({ id: "summary", text: "## Objective\n- durable summary" })],
      TestLLM.text("Queue complete", "text-queue"),
    )
    yield* s.admit("Active work")
    const active = yield* s.resumePaused

    const first = yield* s.session.compact({ sessionID, delivery: "queue" })
    expect(yield* SessionInbox.find(s.db, first.id)).toMatchObject({
      id: first.id,
    })
    expect((yield* s.messages).find((message) => message.id === first.id)).toBeUndefined()

    yield* s.admit("Steer after compaction")
    yield* s.session.synthetic({ sessionID, text: "Completion after compaction", resume: false })
    yield* s.session.prompt({
      sessionID,
      text: "Queue after compaction",
      delivery: "queue",
      resume: false,
    })
    expect(yield* SessionInbox.has(s.db, sessionID, "steer")).toBe(true)

    yield* active.finish

    expect(s.requests).toHaveLength(4)
    expect(userTexts(s.requests[1])).toContain("Steer after compaction")
    expect(userTexts(s.requests[1])).toContain("Completion after compaction")
    expect(userTexts(s.requests[3])).toContain("Queue after compaction")
    expect(yield* SessionInbox.find(s.db, first.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === first.id)).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "## Objective\n- durable summary",
    })
  })

  scenario("releases queued prompts when durable compaction fails", function* (s) {
    s.currentModel = recoveryModel
    yield* s.llm.push(
      TestLLM.text("Active complete", "text-active-failure"),
      [],
      [],
      TestLLM.text("Continued", "text-after-failure"),
    )
    yield* s.admit("Active work")
    const active = yield* s.resumePaused

    const compaction = yield* s.session.compact({ sessionID })
    yield* s.session.prompt({
      sessionID,
      text: "Continue after failure",
      delivery: "queue",
      resume: false,
    })
    yield* active.finish

    expect(s.requests).toHaveLength(4)
    expect(userTexts(s.requests[3])).toContain("Continue after failure")
    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
    })
    expect(
      (yield* recordedEventTypes(sessionID)).filter(
        (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
      ),
    ).toHaveLength(1)
  })

  scenario("explains when manual compaction has no history", function* (s) {
    const compaction = yield* s.session.compact({ sessionID })

    yield* s.resume

    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
    })
    expect(
      (yield* recordedEventTypes(sessionID)).filter(
        (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
      ),
    ).toHaveLength(1)
  })

  scenario("delivers steered manual compaction when the model has no context limit", function* (s) {
    s.currentModel = unknownContextModel
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-unknown-history"))
    yield* s.runPrompt("Earlier question")

    s.requests.length = 0
    yield* s.llm.push(TestLLM.text("## Objective\n- Manual summary", "text-manual-unknown-summary"))
    const compaction = yield* s.session.compact({ sessionID, delivery: "steer" })
    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])[0]).toContain("Earlier question")
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "## Objective\n- Manual summary",
    })
  })

  scenario("runs manual compaction at the next step boundary before queued prompts", function* (s) {
    s.currentModel = recoveryModel
    yield* s.llm.push(
      TestLLM.text("Active complete", "text-active-steer-compact"),
      [LLMEvent.textDelta({ id: "summary", text: "## Objective\n- durable summary" })],
      TestLLM.text("Queue complete", "text-queue-after-compact"),
    )
    yield* s.admit("Active work")
    const active = yield* s.resumePaused

    const compaction = yield* s.session.compact({ sessionID })
    yield* s.session.prompt({ sessionID, text: "Queued prompt", delivery: "queue", resume: false })
    yield* active.finish

    // Steer-delivered compaction runs at the boundary after the active step, ahead of
    // the queued prompt, and consuming it does not trigger an input-free model call.
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[2])).toContain("Queued prompt")
    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "## Objective\n- durable summary",
    })
  })

  scenario("runs manual compaction before the continuation of an active tool turn", function* (s) {
    s.currentModel = recoveryModel
    yield* s.llm.push(
      TestLLM.tool("call-active", "echo", { text: "active" }),
      [LLMEvent.textDelta({ id: "summary", text: "## Objective\n- durable summary" })],
      TestLLM.text("Continued", "text-continued-after-compact"),
    )
    yield* s.admit("Active work")
    const active = yield* s.resumePaused

    const compaction = yield* s.session.compact({ sessionID })
    yield* active.finish

    // The compaction summary is requested before the tool turn's continuation step.
    expect(s.requests).toHaveLength(3)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "## Objective\n- durable summary",
    })
  })

  scenario("preserves provider errors from manual compaction", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-provider-history"))
    yield* s.runPrompt("Earlier question")

    yield* s.llm.push([LLMEvent.providerError({ message: "summary unavailable" })])
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      error: { type: "provider.error", message: "summary unavailable" },
    })
  })

  for (const route of [OpenAIChat.route, OpenAIResponses.route, AnthropicMessages.route]) {
    for (const reason of ["manual", "auto"] as const) {
      scenario(`preserves the session request prefix during ${reason} compaction (${route.id})`, function* (s) {
        const agents = yield* Agent.Service
        const hooks = yield* PluginHooks.Service
        const agentID = Agent.ID.make("reviewer")
        const variant = Model.VariantID.make("test-variant")
        s.currentModel = LanguageModel.make({
          id: route === AnthropicMessages.route ? "claude-sonnet-4-6" : "gpt-5",
          provider: route === AnthropicMessages.route ? "anthropic" : "openai",
          route,
        })
        yield* agents.transform((editor) =>
          editor.update(agentID, (agent) => {
            agent.system = "Review the project carefully."
          }),
        )
        yield* s.bus.publish(SessionEvent.AgentSelected, { sessionID, agent: agentID })
        yield* s.bus.publish(SessionEvent.ModelSelected, {
          sessionID,
          model: { id: ID.make(s.currentModel.id), providerID: Provider.ID.make(s.currentModel.provider), variant },
        })
        const requestAgents: Agent.ID[] = []
        const hook = (event: SessionHooks["context"]) =>
          Effect.sync(() => {
            expect(event.agent).toBe(agentID)
            expect(event.model.variant).toBe(variant)
            event.system.push(SystemPart.make("Hook-provided instructions"))
            event.tools.echo.description = "Hook-provided tool description"
            event.options.maxTokens = 4_000
          })
        yield* hooks.register("session", "context", hook)
        yield* hooks.register("session", "compaction", hook)
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            requestAgents.push(event.agent)
          }),
        )
        yield* s.llm.push(
          TestLLM.tool("call-prefix", "echo", { text: "x".repeat(4_000) }),
          TestLLM.textWithUsage("Earlier answer", "prefix-answer", 185_000),
          TestLLM.complete(
            {
              reason: { normalized: "stop" },
              providerMetadata: { [s.currentModel.provider]: { responseId: "summary" } },
            },
            LLMEvent.textDelta({ id: "prefix-summary", text: "## Objective\n- Checkpoint summary" }),
          ),
        )
        yield* s.runPrompt("Review these changes")
        if (reason === "manual") {
          yield* s.session.compact({ sessionID })
          yield* s.resume
        }
        if (reason === "auto") {
          yield* s.llm.push(TestLLM.text("Continued", "prefix-continued"))
          yield* s.runPrompt("Retained recent request")
        }

        const normal = s.requests[1]
        const compact = s.requests[2]
        expect(compact.messages.slice(0, normal.messages.length)).toEqual([...normal.messages])
        expect(compact.messages.at(-1)).toMatchObject({
          role: "user",
          content: [{ type: "text", text: SessionCompaction.buildPrompt(false) }],
        })
        expect(userTexts(compact)).not.toContain("Retained recent request")
        for (const field of [
          "model",
          "system",
          "tools",
          "generation",
          "providerOptions",
          "toolChoice",
          "cache",
          "promptCacheKey",
          "http",
        ] as const)
          expect(compact[field]).toEqual(normal[field])
        expect(compact.toolChoice).toBeUndefined()
        expect(compact.system.map((part) => part.text)).toContain("Review the project carefully.")
        expect(requestAgents[2]).toBe(agentID)
        expect(s.executions).toEqual(["x".repeat(4_000)])
        expect((yield* s.messages).find((message) => message.type === "compaction")).toMatchObject({
          model: { id: s.currentModel.id, providerID: s.currentModel.provider, variant },
          providerState: { responseId: "summary" },
        })

        // Compare wire content without the cache breakpoints that move to the new final message.
        const before = yield* compileRequest(LLMRequest.update(normal, { cache: "none" }))
        const after = yield* compileRequest(LLMRequest.update(compact, { cache: "none" }))
        const key = route === OpenAIResponses.route ? "input" : "messages"
        const input = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))
        const prefix = input(before.body[key])
        expect(input(after.body[key]).slice(0, prefix.length)).toEqual([...prefix])
        expect(after.body).toMatchObject(
          Object.fromEntries(Object.entries(before.body).filter(([name]) => name !== key)),
        )
      })
    }
  }

  for (const response of ["tools", "reasoning", "invalid text"] as const) {
    for (const summary of [true, false]) {
      scenario(
        `compaction ${summary ? "recovers" : "stops"} after one template reminder for ${response}`,
        function* (s) {
          yield* s.llm.push(TestLLM.text("Earlier answer", "summary-history"))
          yield* s.runPrompt("Earlier question")
          s.requests.length = 0
          const invalid =
            response === "tools"
              ? TestLLM.tool("call-summary", "echo", { text: "must not execute" })
              : response === "reasoning"
                ? TestLLM.stop(
                    LLMEvent.reasoningDelta({ id: "summary-reasoning", text: "## Objective\n- Not a summary" }),
                  )
                : TestLLM.text("Let me search the codebase. I will fill in ## Objective later.", "invalid-summary")
          yield* s.llm.push(
            invalid.map((event) =>
              LLMEvent.is.stepFinish(event)
                ? { ...event, providerMetadata: { openai: { responseId: "rejected-summary-state" } } }
                : event,
            ),
            summary
              ? [LLMEvent.textDelta({ id: "summary-recovered", text: "### Active\n- Recovered summary" })]
              : invalid,
          )
          const compact = yield* s.session.compact({ sessionID })
          yield* s.resume

          expect(s.requests).toHaveLength(2)
          expect(s.requests[1].messages.slice(0, -1)).toEqual([...s.requests[0].messages])
          expect(userTexts(s.requests[1]).at(-1)).toContain("did not fill in the required summary template")
          expect(s.requests.every((request) => request.toolChoice === undefined)).toBe(true)
          expect(s.executions).toEqual([])
          expect(JSON.stringify(yield* s.messages)).not.toContain("rejected-summary-state")
          expect((yield* s.messages).find((message) => message.id === compact.id)).toMatchObject(
            summary
              ? { status: "completed", summary: "### Active\n- Recovered summary" }
              : {
                  status: "failed",
                  error: {
                    type: "compaction.failed",
                    message:
                      response === "invalid text"
                        ? "Compaction summary did not match the required template"
                        : "Compaction produced no summary",
                  },
                },
          )
          if (!summary)
            expect(
              (yield* s.context).some((message) => message.type === "user" && message.text === "Earlier question"),
            ).toBe(true)
        },
      )
    }
  }

  scenario("restarts compaction drafts after transient failures and unsuccessful finishes", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-failure-history"))
    yield* s.runPrompt("Earlier question")
    s.requests.length = 0
    const hooks = yield* PluginHooks.Service
    const retries: PluginHooks.Domains["session"]["retry"][] = []
    yield* hooks.register("session", "retry", (event) =>
      Effect.sync(() => {
        retries.push({ ...event })
        event.decision = { retry: true, delay: 0 }
      }),
    )
    const draft = TestLLM.complete(
      {
        reason: { normalized: "unknown" },
        usage: { nonCachedInputTokens: 10 },
        providerMetadata: { openai: { responseId: "discarded-draft" } },
      },
      LLMEvent.textDelta({ id: "draft", text: "## Objective\n- Partial draft" }),
    )
    yield* s.llm.push(
      TestLLM.failAfter(streamDisconnected(), ...draft.slice(0, -1)),
      draft,
      TestLLM.complete(
        { reason: { normalized: "error" } },
        LLMEvent.textDelta({ id: "failed", text: "## Objective\n- Failed draft" }),
      ),
      Stream.fail(rateLimited(60_000)),
      TestLLM.textWithUsage("## Objective\n- Accepted summary", "accepted", 30),
    )
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect(s.requests).toHaveLength(5)
    for (const request of s.requests) expect(request).toEqual(s.requests[0])
    expect(retries.map((event) => event.attempt)).toEqual([2, 3, 4, 5])
    expect(retries.every((event) => event.sessionID === sessionID && event.agent === "build")).toBe(true)
    expect(retries[3].decision).toEqual({ retry: true, delay: 60_000 })
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      status: "completed",
      summary: "## Objective\n- Accepted summary",
    })
    expect(JSON.stringify(yield* s.messages)).not.toContain("discarded-draft")
    expect((yield* s.session.get(sessionID))?.tokens.input).toBe(50)
  })

  scenario("bounds compaction network retries across a template correction", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "history"))
    yield* s.runPrompt("Earlier question")
    s.requests.length = 0
    const hooks = yield* PluginHooks.Service
    const attempts: number[] = []
    yield* hooks.register("session", "retry", (event) =>
      Effect.sync(() => {
        attempts.push(event.attempt)
        expect(event.decision).toMatchObject({ retry: true })
        event.decision = { retry: true, delay: 0 }
      }),
    )
    yield* s.llm.push(Stream.fail(providerUnavailable()), TestLLM.text("Not a summary", "invalid"))
    yield* s.llm.always(Stream.fail(providerUnavailable()))
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect(attempts).toEqual(RETRY_ATTEMPTS)
    expect(s.requests).toHaveLength(RETRY_ATTEMPTS.length + 2)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      status: "failed",
      error: { type: "provider.transport", message: "Provider unavailable" },
    })
    expect((yield* s.context).some((message) => message.type === "user" && message.text === "Earlier question")).toBe(
      true,
    )
  })

  scenario("explains a compaction blocked by the provider", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "history"))
    yield* s.runPrompt("Earlier question")
    yield* s.llm.push(
      TestLLM.complete({
        reason: {
          normalized: "content-filter",
          raw: "refusal",
          category: "cyber",
          explanation: "This request was declined because it could enable cyber harm.",
        },
      }),
    )
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      status: "failed",
      error: {
        type: "provider.content-filter",
        message:
          "Compaction summary was blocked by the provider (cyber): This request was declined because it could enable cyber harm.",
      },
    })
  })

  for (const header of [false, true]) {
    scenario(`stops compaction retries through the ${header ? "provider header" : "retry hook"}`, function* (s) {
      yield* s.llm.push(TestLLM.text("Earlier answer", "history"))
      yield* s.runPrompt("Earlier question")
      s.requests.length = 0
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "retry", (event) =>
        Effect.sync(() => {
          expect(event.decision.retry).toBe(!header)
          event.decision = { retry: false }
        }),
      )
      yield* s.llm.push(
        Stream.fail(
          header
            ? new AIError({
                reason: new TransportError({
                  message: "Connection closed",
                  transport: "http",
                  operation: "read",
                  http: new HttpContext({
                    url: "https://example.com",
                    status: 200,
                    headers: { "x-should-retry": "false" },
                  }),
                }),
              })
            : incompleteStream(),
        ),
      )
      const compaction = yield* s.session.compact({ sessionID })
      yield* s.resume

      expect(s.requests).toHaveLength(1)
      expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
        status: "failed",
        error: { type: header ? "provider.transport" : "provider.invalid-output" },
      })
    })
  }

  for (const response of ["length", "content-filter"] as const) {
    scenario(`rejects compaction ${response} without retrying or committing its draft`, function* (s) {
      yield* s.llm.push(TestLLM.text("Earlier answer", "history"))
      yield* s.runPrompt("Earlier question")
      s.requests.length = 0
      yield* s.llm.push(
        TestLLM.complete(
          { reason: { normalized: response } },
          LLMEvent.textDelta({ id: "truncated", text: "## Objective\n- Incomplete summary" }),
        ),
      )
      const compaction = yield* s.session.compact({ sessionID })
      yield* s.resume

      expect(s.requests).toHaveLength(1)
      expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "failed" })
      yield* s.llm.push(TestLLM.text("Continued", "continued"))
      yield* s.runPrompt("Continue")
      expect(userTexts(s.requests[1])).toContain("Earlier question")
      expect(JSON.stringify(s.requests[1])).not.toContain("Incomplete summary")
    })
  }

  scenario("stops after three smaller compaction inputs overflow", function* (s) {
    // Large enough that the conversation, not the system prompt, is most of the request.
    const filler = "context ".repeat(1_000)
    yield* s.llm.push(...Array.from({ length: 8 }, (_, index) => TestLLM.text(`Answer ${index}`, `answer-${index}`)))
    yield* Effect.forEach(
      Array.from({ length: 8 }, (_, index) => index),
      (index) => s.runPrompt(`Request ${index}: ${filler}`),
    )
    s.currentModel = unknownContextModel
    s.requests.length = 0
    const overflow = () =>
      Stream.fail(
        new AIError({ reason: new InvalidRequestError({ message: "Too long", classification: "context-overflow" }) }),
      )
    yield* s.llm.push(overflow(), overflow(), overflow(), overflow())
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect(s.requests).toHaveLength(4)
    expect(userTexts(s.requests[2])[0].length).toBeLessThan(userTexts(s.requests[1])[0].length)
    expect(userTexts(s.requests[3])[0].length).toBeLessThan(userTexts(s.requests[2])[0].length)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "failed" })
    yield* s.llm.push(TestLLM.text("Continued", "continued"))
    yield* s.runPrompt("Continue")
    expect(userTexts(s.requests[4])).toContain(`Request 0: ${filler}`)
  })

  scenario("resends compaction as text after payload too large, then shrinks later rejections", function* (s) {
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const filler = "context ".repeat(1_000)
    yield* s.session.prompt({
      sessionID,
      text: "Request 0 with an image",
      files: [{ uri: `data:image/png;base64,${image}` }],
      resume: false,
    })
    yield* s.llm.push(...Array.from({ length: 7 }, (_, index) => TestLLM.text(`Answer ${index}`, `answer-${index}`)))
    yield* s.resume
    yield* Effect.forEach(
      Array.from({ length: 6 }, (_, index) => index + 1),
      (index) => s.runPrompt(`Request ${index}: ${filler}`),
    )
    s.currentModel = unknownContextModel
    s.requests.length = 0
    yield* s.llm.push(...Array.from({ length: 5 }, () => Stream.fail(payloadTooLarge())))
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    // The first rejection resends everything as text, which carries no media; later ones shrink like "too long".
    expect(s.requests).toHaveLength(5)
    expect(s.requests[0]?.messages.some((message) => message.content.some((part) => part.type === "media"))).toBeTrue()
    expect(s.requests[1]?.messages.every((message) => message.role === "user")).toBeTrue()
    expect(userTexts(s.requests[1])[0]).toContain("[image/png omitted]")
    expect(userTexts(s.requests[1])[0]).not.toMatch(/older exchanges? omitted/)
    expect(userTexts(s.requests[2])[0].length).toBeLessThan(userTexts(s.requests[1])[0].length)
    expect(userTexts(s.requests[3])[0].length).toBeLessThan(userTexts(s.requests[2])[0].length)
    expect(userTexts(s.requests[4])[0].length).toBeLessThan(userTexts(s.requests[3])[0].length)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "failed" })
  })

  scenario("resends whole history as text after payload too large when it cannot be shortened", function* (s) {
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    yield* s.session.prompt({
      sessionID,
      text: `Request 0: ${"x".repeat(40_000)}`,
      files: [{ uri: `data:image/png;base64,${image}` }],
      resume: false,
    })
    yield* s.llm.push(TestLLM.text("Answer 0", "answer-0"))
    yield* s.resume
    s.currentModel = testModel("smaller-history", { context: 7_000, output: 1_000 })
    s.requests.length = 0
    yield* s.llm.push(Stream.fail(payloadTooLarge()), TestLLM.text("## Objective\n- Recovered", "summary"))
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    // Even the latest exchange is over the estimated limit, so the first send is unchanged and the second keeps it all.
    expect(s.requests).toHaveLength(2)
    expect(s.requests[0]?.messages.some((message) => message.content.some((part) => part.type === "media"))).toBeTrue()
    expect(s.requests[1]?.messages.every((message) => message.role === "user")).toBeTrue()
    expect(userTexts(s.requests[1])[0]).toContain("[image/png omitted]")
    expect(userTexts(s.requests[1])[0]).toContain(`Request 0: ${"x".repeat(40_000)}`)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "completed" })
  })

  scenario("shrinks after payload too large on a compaction already sent as text", function* (s) {
    const service = yield* SessionCompaction.Service
    yield* service.transform((editor) => editor.configure({ buffer: 3_000 }))
    s.currentModel = testModel("large-history", { context: 1_000_000, output: 32_000 })
    yield* s.llm.push(...Array.from({ length: 6 }, (_, index) => TestLLM.text(`Answer ${index}`, `answer-${index}`)))
    yield* Effect.forEach(
      Array.from({ length: 6 }, (_, index) => index),
      (index) => s.runPrompt(`Request ${index}: ${"x".repeat(8_000)}`),
    )
    s.currentModel = testModel("smaller-history", { context: 12_000, output: 1_000 })
    s.requests.length = 0
    yield* s.llm.push(Stream.fail(payloadTooLarge()), TestLLM.text("## Objective\n- Recovered", "summary"))
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    // The first send was already text, so there is no media left to drop; the rejection counts like "too long".
    expect(s.requests).toHaveLength(2)
    expect(s.requests[0]?.messages.every((message) => message.role === "user")).toBeTrue()
    expect(userTexts(s.requests[1])[0].length).toBeLessThan(userTexts(s.requests[0])[0].length)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "completed" })
  })

  scenario("aims the first overflow compaction below the rejected context", function* (s) {
    const filler = "context ".repeat(1_000)
    yield* s.llm.push(...Array.from({ length: 4 }, (_, index) => TestLLM.text(`Answer ${index}`, `answer-${index}`)))
    yield* Effect.forEach(
      Array.from({ length: 4 }, (_, index) => index),
      (index) => s.runPrompt(`Request ${index}: ${filler}`),
    )
    s.currentModel = recoveryModel
    s.requests.length = 0
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Recovered", "summary"),
      TestLLM.text("Recovered", "recovered"),
    )
    yield* s.runPrompt("Continue")

    // The history fits the model's window by estimate, but the provider just rejected it, so older exchanges go.
    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[1])[0]).toContain("older exchanges omitted")
    expect(userTexts(s.requests[1])[0]).not.toContain("Request 0:")
    expect(userTexts(s.requests[1])[0]).toContain("Request 3:")
  })

  scenario("serializes history and omits media after a summary input overflow", function* (s) {
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    yield* s.session.prompt({
      sessionID,
      text: "Earlier question",
      files: [{ uri: `data:image/png;base64,${image}` }],
      resume: false,
    })
    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.toolCall({ id: "hosted", name: "web_search", input: { query: "earlier" }, providerExecuted: true }),
        LLMEvent.toolResult({
          id: "hosted",
          name: "web_search",
          result: { type: "text", value: "x".repeat(5_000) },
          providerExecuted: true,
        }),
        LLMEvent.textStart({ id: "history" }),
        LLMEvent.textDelta({ id: "history", text: "Earlier answer" }),
        LLMEvent.textEnd({ id: "history" }),
      ),
    )
    yield* s.resume
    s.requests.length = 0
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "Too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Recovered", "summary"),
    )
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(s.requests[0]?.messages.some((message) => message.content.some((part) => part.type === "media"))).toBeTrue()
    expect(s.requests[1]?.messages.every((message) => message.role === "user")).toBeTrue()
    expect(userTexts(s.requests[1])[0]).toContain("[image/png omitted]")
    expect(userTexts(s.requests[1])[0]).toContain("[Tool result]:")
    expect(userTexts(s.requests[1])[0]).toContain(`${"x".repeat(1_250)}\n[truncated]`)
    expect(userTexts(s.requests[1])[0]).not.toContain("x".repeat(1_251))
    expect(s.requests[1]?.system).toEqual(s.requests[0]?.system)
    expect(s.requests[1]?.tools).toEqual(s.requests[0]?.tools)
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({ status: "completed" })
  })

  scenario("fits serialized compaction history by omitting oldest exchanges", function* (s) {
    const service = yield* SessionCompaction.Service
    yield* service.transform((editor) => editor.configure({ buffer: 3_000 }))
    s.currentModel = testModel("large-history", { context: 1_000_000, output: 32_000 })
    yield* s.llm.push(...Array.from({ length: 4 }, (_, index) => TestLLM.text(`Answer ${index}`, `answer-${index}`)))
    yield* Effect.forEach(
      Array.from({ length: 4 }, (_, index) => index),
      (index) => s.runPrompt(`Request ${index}: ${"x".repeat(8_000)}`),
    )
    s.currentModel = testModel("smaller-history", { context: 7_000, output: 1_000 })
    s.requests.length = 0
    yield* s.llm.push(TestLLM.text("## Objective\n- Recovered", "summary"))
    const compaction = yield* s.session.compact({ sessionID })
    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])[0]).toContain("older exchanges omitted")
    expect(userTexts(s.requests[0])[0]).not.toContain("Request 0:")
    expect(userTexts(s.requests[0])[0]).not.toContain("Request 1:")
    expect(userTexts(s.requests[0])[0]).toContain("Request 2:")
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      status: "completed",
      summary: "## Objective\n- Recovered",
    })
  })

  scenario("records cancelled manual compaction without surfacing an internal failure", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-interrupt-history"))
    yield* s.runPrompt("Earlier question")

    const streamed = yield* Deferred.make<void>()
    const partial = fragmentFixture("text", "text-manual-interrupt-summary", ["Partial summary"])
    yield* s.llm.push(
      Stream.concat(
        Stream.fromIterable(partial.partialEvents),
        Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      ),
    )
    const compaction = yield* s.session.compact({ sessionID })
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Deferred.await(streamed)
    yield* s.session.interrupt(sessionID)

    yield* Fiber.await(run)
    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "aborted", message: "Compaction cancelled" },
    })
  })

  scenario("settles an admitted manual compaction when pre-start resolution throws", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-resolution-history"))
    yield* s.runPrompt("Earlier question")

    const compaction = yield* s.session.compact({ sessionID })
    s.modelResolveHook = Effect.die("model resolution failed")

    expect(yield* Effect.exit(s.resume)).toMatchObject({ _tag: "Failure" })

    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      reason: "manual",
    })
    expect(
      (yield* recordedEventTypes(sessionID)).filter(
        (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
      ),
    ).toHaveLength(1)
  })

  scenario("records manual compaction model resolution failures without calling the model", function* (s) {
    yield* s.llm.push(TestLLM.text("Earlier answer", "text-manual-unavailable-history"))
    yield* s.runPrompt("Earlier question")
    s.requests.length = 0

    const compaction = yield* s.session.compact({ sessionID })
    s.modelResolveHook = Effect.fail(
      new SessionRunnerModel.ModelUnavailableError({
        providerID: Provider.ID.make("test"),
        modelID: Model.ID.make("missing"),
      }),
    )
    yield* s.resume

    expect(s.requests).toHaveLength(0)
    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "provider.no-route", message: "Model unavailable: test/missing" },
    })
  })

  scenario("automatically compacts into a completed summary and retained recent turn", function* (s) {
    const store = yield* SessionStore.Service
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-first", 3_950))
    yield* s.runPrompt("Earlier question ".repeat(180))

    s.currentModel = compactModel
    s.requests.length = 0
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the task", "text-summary"),
      TestLLM.textWithUsage("Continued", "text-final", 3_950),
    )
    yield* s.runPrompt("Recent exact request ".repeat(180))

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0]).at(-1)).toContain("## Objective")
    expect(userTexts(s.requests[1])).toHaveLength(1)
    expect(userTexts(s.requests[1])[0]).toContain("<summary>\n## Objective\n- Preserve the task\n</summary>")
    expect(userTexts(s.requests[1])[0]).toContain(`[User]: ${"Recent exact request ".repeat(180)}`)

    const context = yield* store.context(sessionID)
    expect(context.map((message) => message.type)).toEqual(["compaction", "assistant"])
    expect(context[0]).toMatchObject({
      type: "compaction",
      summary: "## Objective\n- Preserve the task",
      recent: `[User]: ${"Recent exact request ".repeat(180)}`,
    })

    s.requests.length = 0
    s.executions.length = 0
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the updated task", "text-summary-2"),
      TestLLM.text("Continued again", "text-final-2"),
    )
    yield* s.runPrompt("Newest exact request ".repeat(180))

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0])[0]).toContain("<summary>\n## Objective\n- Preserve the task\n</summary>")
    expect(userTexts(s.requests[0])[0]).toContain("Recent exact request")
    expect(userTexts(s.requests[0]).at(-1)).toBe(SessionCompaction.buildPrompt(true))
    expect((yield* store.context(sessionID))[0]).toMatchObject({
      type: "compaction",
      summary: "## Objective\n- Preserve the updated task",
      recent: `[User]: ${"Newest exact request ".repeat(180)}`,
    })
  })

  scenario("automatically persists native windows, retains earlier users, and waits for fresh usage", function* (s) {
    s.currentModel = LanguageModel.make({ id: "native", provider: "openai", route: OpenAIResponses.route })
    modelLimits.set("native", { context: 11_000, output: 1_000 })
    s.compaction = { type: "native" }
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.defaultID, (agent) => {
        agent.steps = 2
      }),
    )
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "before-native", 10_000))
    yield* s.runPrompt("First real request")
    const checkpoint = (encrypted: string) =>
      CompactionCheckpointResponse.make({
        responseID: `resp_${encrypted}`,
        checkpoint: { type: "compaction", provider: s.currentModel.provider, encrypted },
      })
    yield* s.llm.push(
      checkpoint("first"),
      TestLLM.tool("echo-native", "echo", { text: "continue" }),
      TestLLM.text("No usage yet", "no-usage"),
    )
    yield* s.runPrompt("Second real request")
    expect(s.requests).toHaveLength(4)
    expect(s.requests[2].toolChoice).not.toEqual({ type: "none" })
    expect(s.executions).toEqual(["continue"])
    expect(JSON.stringify(s.requests[2].messages)).toContain("first")
    const installed = (yield* s.messages).filter((message) => message.type === "compaction")
    expect(installed).toMatchObject([{ status: "completed", reason: "auto", providerContext: { version: 1 } }])
    // New input without a post-checkpoint usage anchor must not retrigger compaction.
    yield* s.llm.push(TestLLM.textWithUsage("Measured", "measured", 10_000))
    yield* s.runPrompt("Third real request")
    expect(s.requests).toHaveLength(5)
    yield* s.llm.push(checkpoint("second"), TestLLM.textWithUsage("Continued", "continued", 10_000))
    yield* s.runPrompt("Fourth real request")
    expect(s.requests).toHaveLength(7)
    expect(userTexts(s.requests[6])).toEqual([
      "First real request",
      "Second real request",
      "Third real request",
      "Fourth real request",
    ])
    expect(JSON.stringify(s.requests[6].messages)).not.toContain('"encrypted":"first"')
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ auto: false }))
    yield* replaySessionProjection(sessionID)
    yield* s.llm.push(TestLLM.text("Disabled auto still replays", "disabled"))
    yield* s.runPrompt("Fifth real request")
    expect(s.requests).toHaveLength(8)
    expect(JSON.stringify(s.requests[7].messages)).toContain('"encrypted":"second"')
  }, true)

  scenario("recovers an overflowing native window with another native compaction", function* (s) {
    s.currentModel = LanguageModel.make({ id: "native", provider: "openai", route: OpenAIResponses.route })
    modelLimits.set("native", { context: 11_000, output: 1_000 })
    s.compaction = { type: "native" }
    const checkpoint = (encrypted: string) =>
      CompactionCheckpointResponse.make({
        responseID: `resp_${encrypted}`,
        checkpoint: { type: "compaction", provider: s.currentModel.provider, encrypted },
      })
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "before-native", 10_000))
    yield* s.runPrompt("Original durable request")
    yield* s.llm.push(checkpoint("native-window"), TestLLM.text("After native", "after-native"))
    yield* s.runPrompt("Before native checkpoint")
    s.requests.length = 0
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      checkpoint("recovered-window"),
      TestLLM.text("Recovered", "recovered"),
    )
    yield* s.runPrompt("Overflow request")
    expect(s.requests).toHaveLength(3)
    expect(JSON.stringify(s.requests[0].messages)).toContain("native-window")
    expect(JSON.stringify(s.requests[2].messages)).toContain("recovered-window")
    expect(JSON.stringify(s.requests[2].messages)).not.toContain('"encrypted":"native-window"')
    expect(yield* s.context).toMatchObject([
      { type: "compaction", status: "completed", providerContext: { version: 1 } },
      { type: "assistant" },
    ])
  }, true)

  scenario("does not compact immediately when the advertised output limit fills the context", function* (s) {
    s.currentModel = fullOutputModel
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-full-output-first", 9_500))
    yield* s.runPrompt("Earlier question")

    s.requests.length = 0
    yield* s.llm.push(TestLLM.text("Continued", "text-full-output-final"))
    yield* s.runPrompt("Continue")

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toContain("Continue")
    expect(yield* s.context).not.toContainEqual(expect.objectContaining({ type: "compaction" }))
  })

  scenario("stops after required automatic compaction fails", function* (s) {
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-before-failed-compaction", 3_950))
    yield* s.runPrompt("Earlier question ".repeat(180))

    s.currentModel = compactModel
    s.requests.length = 0
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "Unsupported parameter: max_output_tokens" })],
      TestLLM.text("Must not run", "text-after-failed-compaction"),
    )
    yield* s.admit("Recent exact request ".repeat(180))
    expect(yield* Effect.exit(s.resume)).toMatchObject({ _tag: "Failure" })

    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]?.generation?.maxTokens).toBe(50)
    expect(yield* s.context).toContainEqual(
      expect.objectContaining({
        type: "compaction",
        status: "failed",
        reason: "auto",
        error: expect.objectContaining({ message: "Unsupported parameter: max_output_tokens" }),
      }),
    )
  })

  scenario("forces one compaction and retries after provider context overflow", function* (s) {
    yield* setupOverflowRecovery(s)
    yield* s.llm.push(
      [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
      ],
      TestLLM.text("## Objective\n- Recover overflow", "text-summary"),
      TestLLM.text("Recovered", "text-final"),
    )
    yield* s.runPrompt("Continue")

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[1]).at(-1)).toContain("## Objective")
    expect(userTexts(s.requests[2])[0]).toContain("<summary>\n## Objective\n- Recover overflow\n</summary>")
    expect(yield* s.context).toMatchObject([
      { type: "compaction", summary: "## Objective\n- Recover overflow" },
      { type: "assistant", finish: "stop" },
    ])
    yield* replaySessionProjection(sessionID)
    expect(yield* s.context).toMatchObject([{ type: "compaction" }, { type: "assistant", finish: "stop" }])
  })

  scenario("refreshes preparation after overflow compaction without promoting new input", function* (s) {
    yield* setupOverflowRecovery(s)

    let reads = 0
    let resolutions = 0
    s.systemLoadHook = Effect.sync(() => {
      reads++
    })
    s.modelResolveHook = Effect.sync(() => {
      resolutions++
    })
    yield* s.admit("Continue")
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Overflow summary", "overflow-summary"),
      TestLLM.text("Recovered", "overflow-recovered"),
      TestLLM.stop(),
      TestLLM.stop(),
    )
    const first = yield* s.llm.gate
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* first.started
    expect(reads).toBe(1)
    expect(resolutions).toBe(1)
    expect(s.requests[0]?.model).toBe(recoveryModel)

    const summary = yield* s.llm.gate
    yield* first.release
    yield* summary.started
    s.systemBaseline = "Changed during compaction"
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
    })
    const queued = yield* s.session.prompt({
      sessionID,
      text: "Queued during compaction",
      delivery: "queue",
      resume: false,
    })
    const steered = yield* s.admit("Steered during compaction")
    const retry = yield* s.llm.gate
    yield* summary.release
    yield* retry.started

    expect(reads).toBe(2)
    expect(resolutions).toBe(2)
    expect(s.requests).toHaveLength(3)
    expect(s.requests[2]?.model).toBe(replacementModel)
    expect(s.requests[2]?.system.map((part) => part.text)).toEqual([
      defaultSystem,
      replacementIdentity,
      "Initial context",
    ])
    expect(systemTexts(s.requests[2])).toContain("Changed during compaction")
    expect(userTexts(s.requests[2])[0]).toContain("<summary>\n## Objective\n- Overflow summary\n</summary>")
    expect(userTexts(s.requests[2]).join("\n")).not.toContain("Queued during compaction")
    expect(userTexts(s.requests[2]).join("\n")).not.toContain("Steered during compaction")
    expect((yield* s.inbox).map((item) => item.id)).toEqual([queued.id, steered.id])

    yield* retry.release
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(5)
    expect(userTexts(s.requests[3])).toContain("Steered during compaction")
    expect(userTexts(s.requests[3])).not.toContain("Queued during compaction")
    expect(userTexts(s.requests[4])).toContain("Queued during compaction")
    expect(yield* s.inbox).toEqual([])
  })

  scenario("does not recover provider context overflow when automatic compaction is disabled", function* (s) {
    yield* setupOverflowRecovery(s)
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => editor.configure({ auto: false }))
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("Must not compact", "text-unexpected-summary"),
      TestLLM.text("Must not retry", "text-unexpected-retry"),
    )
    yield* s.admit("Continue")
    expect((yield* s.resume.pipe(Effect.flip)).message).toBe("prompt too long")

    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toContainEqual(
      expect.objectContaining({
        type: "assistant",
        finish: "error",
        error: expect.objectContaining({ message: "prompt too long" }),
      }),
    )
    expect(yield* s.context).not.toContainEqual(expect.objectContaining({ type: "compaction" }))
    expect(yield* recordedEventTypes(sessionID)).not.toContain(
      Bus.versionedType(SessionEvent.Compaction.Started.type, 1),
    )
  })

  scenario("recovers from provider context overflow without a configured context limit", function* (s) {
    yield* setupOverflowRecovery(s)
    s.currentModel = unknownContextModel
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Recover unknown limit", "text-summary-unknown-limit"),
      TestLLM.text("Recovered", "text-final-unknown-limit"),
    )
    yield* s.runPrompt("Continue")

    expect(s.requests).toHaveLength(3)
    expect(yield* s.context).toMatchObject([
      { type: "compaction", summary: "## Objective\n- Recover unknown limit" },
      { type: "assistant", finish: "stop" },
    ])
  })

  scenario("compacts before requesting an undersized configured context limit", function* (s) {
    yield* setupOverflowRecovery(s)
    s.currentModel = undersizedContextModel
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Recover undersized limit", "text-summary-undersized-limit"),
      TestLLM.text("Recovered", "text-final-undersized-limit"),
    )
    yield* s.runPrompt("Continue")

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      { type: "compaction", summary: "## Objective\n- Recover undersized limit" },
      { type: "assistant", finish: "stop" },
    ])
  })

  scenario("persists a second context overflow after one recovery", function* (s) {
    yield* setupOverflowRecovery(s)
    const overflow = () => [
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
    ]
    yield* s.llm.push(overflow(), TestLLM.text("## Objective\n- Recover once", "text-summary"), overflow())
    yield* s.admit("Continue")
    expect((yield* s.resume.pipe(Effect.flip)).message).toBe("prompt too long")

    expect(s.requests).toHaveLength(3)
    expect(yield* s.context).toMatchObject([
      { type: "compaction" },
      { type: "assistant", finish: "error", error: { message: "prompt too long" } },
    ])
  })

  scenario("recovers once from a raw context overflow failure", function* (s) {
    yield* setupOverflowRecovery(s)
    yield* s.llm.push(
      Stream.fail(
        new AIError({
          reason: new InvalidRequestError({
            message: "prompt too long",
            classification: "context-overflow",
          }),
        }),
      ),
    )
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Recover raw overflow", "text-summary"),
      TestLLM.text("Recovered", "text-final"),
    )
    yield* s.runPrompt("Continue")

    expect(s.requests).toHaveLength(3)
    expect(yield* s.context).toMatchObject([
      { type: "compaction", summary: "## Objective\n- Recover raw overflow" },
      { type: "assistant", finish: "stop" },
    ])
  })

  scenario("fits the output limit to the prompt size", function* (s) {
    s.currentModel = fittedOutputModel
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-fitted-first", 50_000))
    yield* s.runPrompt("Earlier question")
    yield* s.llm.push(TestLLM.text("Continued", "text-fitted-final"))
    yield* s.runPrompt("Continue")

    expect(s.requests[0]?.generation?.maxTokens).toBe(64_000)
    expect(s.requests[1]?.generation?.maxTokens).toBeLessThan(100_000 - 50_000)
    expect(s.requests[1]?.generation?.maxTokens).toBeGreaterThan(100_000 - 50_000 - 200)
  })

  scenario("caps the output limit a large model advertises", function* (s) {
    s.currentModel = largeOutputModel
    yield* s.llm.push(TestLLM.text("Answer", "text-large-output"))
    yield* s.runPrompt("Question")

    expect(s.requests[0]?.generation?.maxTokens).toBe(256_000)
  })

  scenario("gives the summary its full output limit when the conversation overshot the threshold", function* (s) {
    // The conversation overshot the threshold, so the prepared summary request exceeds the budget and `deliver`
    // shrinks it before sending. The output limit must follow the budget, not the oversized prepared request.
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-budget-first", 185_000))
    yield* s.runPrompt("Earlier question")
    s.requests.length = 0
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the task", "text-budget-summary"),
      TestLLM.text("Continued", "text-budget-final"),
    )
    yield* s.runPrompt("Recent request ".repeat(400))

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0]).at(-1)).toContain("## Objective")
    // The summary may use the whole 20k reserve of a 200k window.
    expect(s.requests[0]?.generation?.maxTokens).toBe(20_000)
    expect(s.requests[1]?.generation?.maxTokens).toBe(32_000)
  })

  scenario("keeps the summary its room on a small window", function* (s) {
    // 90% of 64k would leave 6.4k for the summary, so the 16k reserve sets the ceiling at 48k instead.
    s.currentModel = smallWindowModel
    yield* s.llm.push(TestLLM.textWithUsage("Earlier answer", "text-small-first", 59_000))
    yield* s.runPrompt("Earlier question")
    s.requests.length = 0
    yield* s.llm.push(
      TestLLM.text("## Objective\n- Preserve the task", "text-small-summary"),
      TestLLM.text("Continued", "text-small-final"),
    )
    yield* s.runPrompt("Recent request ".repeat(400))

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0]).at(-1)).toContain("## Objective")
    expect(s.requests[0]?.generation?.maxTokens).toBe(16_000)
    expect(s.requests[1]?.generation?.maxTokens).toBe(16_000)
  })

  scenario("publishes the original overflow when recovery summarization fails", function* (s) {
    yield* setupOverflowRecovery(s)
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      [LLMEvent.providerError({ message: "summary unavailable" })],
    )
    yield* s.admit("Continue")
    expect((yield* s.resume.pipe(Effect.flip)).message).toBe("prompt too long")

    expect(s.requests).toHaveLength(2)
    const context = yield* s.context
    expect(context).toContainEqual(
      expect.objectContaining({
        type: "compaction",
        status: "failed",
        reason: "auto",
        error: { type: "provider.error", message: "summary unavailable" },
      }),
    )
    expect(context.slice(-3)).toMatchObject([
      Expected.user("Continue"),
      { type: "assistant", finish: "error", error: { message: "prompt too long" } },
      { type: "compaction", status: "failed", reason: "auto" },
    ])
  })

  scenario("interrupts overflow recovery while the summary provider is running", function* (s) {
    yield* setupOverflowRecovery(s)
    yield* s.llm.push(
      [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
      TestLLM.text("## Objective\n- Interrupted", "text-summary"),
    )
    const first = yield* s.llm.gate
    yield* s.admit("Continue")
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* first.started

    const summary = yield* s.llm.gate
    yield* first.release
    yield* summary.started

    yield* s.session.interrupt(sessionID)
    const exit = yield* Fiber.await(run)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
    expect(yield* s.context).toContainEqual(
      expect.objectContaining({
        type: "compaction",
        status: "failed",
        reason: "auto",
        error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
      }),
    )
  })

  scenario("uses epoch values after compaction while a source is unavailable", function* (s) {
    yield* s.runPrompt("First")
    s.systemBaseline = "Changed context"
    yield* s.runPrompt("Second")
    yield* s.bus.publish(SessionEvent.Compaction.Started, {
      sessionID,
      reason: "manual",
      recent: "",
    })
    yield* s.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: "summary",
      recent: "",
    })
    s.systemUnavailable = true
    yield* s.runPrompt("Third")

    // Compaction already moved current values into the new epoch before the unavailable read.
    expect(s.requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, fakeIdentity, "Changed context"])
    expect(systemTexts(s.requests.at(-1)!)).not.toContain("Changed context")
  })

  scenario("projects reasoning and tool events without executing or continuing tools", function* (s) {
    yield* s.admit("Use tools")

    yield* s.llm.push(
      TestLLM.complete(
        {
          reason: { normalized: "tool-calls" },
          usage: {
            inputTokens: 10,
            nonCachedInputTokens: 8,
            outputTokens: 4,
            reasoningTokens: 1,
            cacheReadInputTokens: 2,
          },
        },
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
        LLMEvent.reasoningDelta({ id: "reasoning-1", text: "Think" }),
        LLMEvent.reasoningEnd({ id: "reasoning-1" }),
        LLMEvent.toolInputStart({ id: "call-error", name: "write" }),
        LLMEvent.toolInputDelta({ id: "call-error", name: "write", text: '{"path":"README.md"}' }),
        LLMEvent.toolInputEnd({ id: "call-error", name: "write" }),
        LLMEvent.toolCall({ id: "call-error", name: "write", input: { path: "README.md" }, providerExecuted: true }),
        LLMEvent.toolError({ id: "call-error", name: "write", message: "Denied" }),
        LLMEvent.toolResult({ id: "call-error", name: "write", result: { type: "error", value: "Denied" } }),
        LLMEvent.toolCall({
          id: "call-provider",
          name: "web_search",
          input: { query: "hello" },
          providerExecuted: true,
          providerMetadata: { openai: { source: "provider" } },
        }),
        LLMEvent.toolResult({
          id: "call-provider",
          name: "web_search",
          result: {
            type: "content",
            value: [
              { type: "text", text: "Hello" },
              { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "hello.png" },
            ],
          },
          providerExecuted: true,
          providerMetadata: { openai: { source: "provider" } },
        }),
      ),
    )

    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]?.tools.map((tool) => tool.name)).toEqual(["defect", "echo", "storefail"])
    expect(yield* s.context).toMatchObject([
      Expected.user("Use tools"),
      {
        type: "assistant",
        finish: "tool-calls",
        cost: 0,
        tokens: { input: 8, output: 3, reasoning: 1, cache: { read: 2, write: 0 } },
        content: [
          Expected.reasoning("Think"),
          Expected.failedTool(
            { id: "call-error", name: "write" },
            { input: { path: "README.md" }, error: { type: "tool.execution", message: "Denied" } },
          ),
          Expected.completedTool(
            {
              id: "call-provider",
              name: "web_search",
              executed: true,
              providerState: { source: "provider" },
              providerResultState: { source: "provider" },
            },
            {
              input: { query: "hello" },
              content: [
                Expected.text("Hello"),
                { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=", name: "hello.png" },
              ],
            },
          ),
        ],
      },
    ])
  })

  scenario("continues with reloaded history after durably settling one local tool call", function* (s) {
    yield* s.admit("Echo this")

    yield* s.llm.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.text("Done", "text-final"))

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(messageRoles(s.requests[1])).toEqual(["user", "assistant", "tool"])
    expect(s.authorizations).toMatchObject([{ sessionID, id: "call-echo" }])
    expect(s.executions).toEqual(["hello"])
    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Echo this"),
      Expected.assistant({ finish: "tool-calls" }, [
        Expected.completedTool(
          { id: "call-echo", name: "echo" },
          { input: { text: "hello" }, content: [Expected.text("hello")] },
        ),
      ]),
      Expected.assistant({ finish: "stop" }, [Expected.text("Done")]),
    ])
    const assistant = requireAssistant(context)
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.step.ended.1",
    ])
  })

  scenario("reloads a model switch before a tool-driven continuation step", function* (s) {
    yield* s.admit("Echo this")

    yield* s.llm.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.stop())
    const tools = yield* s.blockTools()
    const run = yield* Effect.forkChild(s.resume)
    yield* tools.started
    yield* s.bus.publish(SessionEvent.ModelSelected, {
      sessionID,
      model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
    })
    s.systemBaseline = "Replacement context"
    yield* tools.release
    yield* Fiber.join(run)

    expect(s.requests.map((request) => request.model)).toEqual([model, replacementModel])
    expect(s.requests.map((request) => request.system.map((part) => part.text))).toEqual([
      [defaultSystem, fakeIdentity, "Initial context"],
      [defaultSystem, replacementIdentity, "Initial context"],
    ])
    expect(systemTexts(s.requests[1])).toContain("Replacement context")
  })

  scenario("consumes the full provider stream before recording its boundary and settling local tools", function* (s) {
    yield* s.admit("Echo this")
    const request = yield* s.llm.gate
    const tail = yield* Deferred.make<void>()
    const complete = yield* Deferred.make<void>()
    const finished = yield* Deferred.make<void>()
    yield* s.llm.push(
      Stream.fromIterable(
        TestLLM.complete(
          { reason: { normalized: "tool-calls" }, usage: { outputTokens: 100, reasoningTokens: 80 } },
          LLMEvent.toolCall({ id: "call-streamed", name: "echo", input: { text: "hello" } }),
        ),
      ).pipe(
        Stream.concat(
          Stream.fromEffect(Deferred.succeed(tail, undefined).pipe(Effect.andThen(Deferred.await(complete)))).pipe(
            Stream.drain,
          ),
        ),
        Stream.onEnd(Deferred.succeed(finished, undefined)),
      ),
      TestLLM.stop(),
    )
    const tools = yield* s.blockTools()
    const streamed = yield* s.bus.subscribe(SessionEvent.Step.Streamed).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    const run = yield* Effect.forkChild(s.resume)

    yield* request.started
    yield* TestClock.adjust("2 seconds")
    yield* request.release
    yield* tools.started
    yield* Deferred.await(tail)
    expect(s.requests).toHaveLength(1)
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.streamed.1")
    expect(requireAssistant(yield* s.context).time.completed).toBeUndefined()
    yield* TestClock.adjust("3 seconds")
    yield* Deferred.succeed(complete, undefined)
    yield* Fiber.join(streamed)
    expect(yield* Deferred.isDone(finished)).toBe(true)
    const assistant = requireAssistant(yield* s.context)
    expect(assistant.time.streamed).toBeDefined()
    expect(DateTime.toEpochMillis(assistant.time.streamed!) - DateTime.toEpochMillis(assistant.time.created)).toBe(
      5_000,
    )
    expect(assistant.time.completed).toBeUndefined()
    expect(assistant.content).toMatchObject([{ type: "tool", state: { status: "running" } }])

    yield* TestClock.adjust("10 seconds")
    yield* tools.release
    yield* Fiber.join(run)
    const events = yield* recordedEventTypes(sessionID)
    expect(events.indexOf("session.step.streamed.1")).toBeLessThan(events.indexOf("session.tool.success.2"))
    expect(events.indexOf("session.tool.success.2")).toBeLessThan(events.indexOf("session.step.ended.1"))
    expect(events.filter((type) => type === "session.step.streamed.1")).toHaveLength(2)
    yield* replaySessionProjection(sessionID)
    const replayed = (yield* s.context).find((message) => message.id === assistant.id)
    expect(replayed).toMatchObject({
      time: { created: assistant.time.created, streamed: assistant.time.streamed },
      tokens: { output: 20, reasoning: 80 },
    })
  })

  scenario("restores durable reasoning provider metadata in the next request", function* (s) {
    yield* s.admit("Think first")

    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.reasoningStart({ id: "reasoning-anthropic" }),
        LLMEvent.reasoningDelta({ id: "reasoning-anthropic", text: "Signed thought" }),
        LLMEvent.reasoningEnd({
          id: "reasoning-anthropic",
          providerMetadata: { openai: { signature: "sig_1" }, anthropic: { ignored: true } },
        }),
        LLMEvent.reasoningStart({
          id: "reasoning-openai",
          providerMetadata: {
            openai: { itemId: "rs_1", reasoningEncryptedContent: null },
            anthropic: { ignored: true },
          },
        }),
        LLMEvent.reasoningDelta({ id: "reasoning-openai", text: "Encrypted thought" }),
        LLMEvent.reasoningEnd({
          id: "reasoning-openai",
          providerMetadata: {
            openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" },
            anthropic: { ignored: true },
          },
        }),
      ),
    )
    yield* s.resume
    yield* replaySessionProjection(sessionID)

    expect(yield* s.context).toMatchObject([
      Expected.user("Think first"),
      Expected.assistant({}, [
        {
          type: "reasoning",
          text: "Signed thought",
          state: { signature: "sig_1" },
        },
        {
          type: "reasoning",
          text: "Encrypted thought",
          state: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" },
        },
      ]),
    ])

    yield* s.admit("Continue")
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests[1]?.messages[1]?.content).toEqual([
      {
        type: "reasoning",
        text: "Signed thought",
        providerMetadata: { openai: { signature: "sig_1" } },
      },
      {
        type: "reasoning",
        text: "Encrypted thought",
        providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
      },
    ])
  }, true)

  scenario("keeps one durable reasoning part when reasoning closes after text", function* (s) {
    yield* s.admit("Think and answer")

    const details = [{ type: "reasoning.text", text: "thinking", signature: "signed", index: 0 }]
    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
        LLMEvent.reasoningDelta({ id: "reasoning-0", text: "thinking" }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textDelta({ id: "text-0", text: "Hello" }),
        LLMEvent.textDelta({ id: "text-0", text: " world" }),
        LLMEvent.reasoningEnd({
          id: "reasoning-0",
          providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
        }),
        LLMEvent.textEnd({ id: "text-0" }),
      ),
    )
    yield* s.resume
    yield* replaySessionProjection(sessionID)

    const assistant = requireAssistant(yield* s.context)
    expect(assistant.content.filter((part) => part.type === "reasoning")).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Think and answer"),
      Expected.assistant({}, [
        {
          type: "reasoning",
          text: "thinking",
          state: { reasoningField: "reasoning", reasoningDetails: details },
        },
        { type: "text", text: "Hello world" },
      ]),
    ])

    yield* s.admit("Continue")
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests[1]?.messages[1]?.content.filter((part) => part.type === "reasoning")).toEqual([
      {
        type: "reasoning",
        text: "thinking",
        providerMetadata: { openai: { reasoningField: "reasoning", reasoningDetails: details } },
      },
    ])
  }, true)

  scenario("restores durable text provider metadata in the next request", function* (s) {
    yield* s.admit("Check first")

    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.textStart({
          id: "commentary",
          providerMetadata: { openai: { itemId: "msg_commentary", phase: "commentary" } },
        }),
        LLMEvent.textDelta({ id: "commentary", text: "Checking." }),
        LLMEvent.textEnd({
          id: "commentary",
          providerMetadata: {
            openai: { itemId: "msg_commentary", phase: "commentary" },
            anthropic: { ignored: true },
          },
        }),
      ),
    )
    yield* s.resume
    yield* replaySessionProjection(sessionID)

    expect(yield* s.context).toMatchObject([
      Expected.user("Check first"),
      Expected.assistant({}, [
        { type: "text", text: "Checking.", state: { itemId: "msg_commentary", phase: "commentary" } },
      ]),
    ])

    yield* s.admit("Continue")
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests[1]?.messages[1]?.content).toEqual([
      {
        type: "text",
        text: "Checking.",
        providerMetadata: { openai: { itemId: "msg_commentary", phase: "commentary" } },
      },
    ])
  }, true)

  scenario("replays durable provider-executed tool results inline in the next request", function* (s) {
    yield* s.admit("Search first")

    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.toolCall({
          id: "hosted-search",
          name: "web_search",
          input: { query: "Effect" },
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "hosted-search" }, fake: { ignored: true } },
        }),
        LLMEvent.toolResult({
          id: "hosted-search",
          name: "web_search",
          result: { type: "json", value: [{ title: "Effect" }] },
          providerExecuted: true,
          providerMetadata: { openai: { blockType: "web_search_tool_result" }, anthropic: { ignored: true } },
        }),
      ),
    )
    yield* s.resume
    yield* replaySessionProjection(sessionID)

    yield* s.admit("Continue")
    yield* s.llm.push([])
    yield* s.resume

    expect(messageRoles(s.requests[1])).toEqual(["user", "assistant", "user"])
    expect(s.requests[1]?.messages[1]?.content).toMatchObject([
      {
        type: "tool-call",
        id: "hosted-search",
        name: "web_search",
        input: { query: "Effect" },
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "hosted-search" } },
      },
      {
        type: "tool-result",
        id: "hosted-search",
        name: "web_search",
        // The generic replay result derives from canonical stored content.
        result: { type: "text", value: '[{"title":"Effect"}]' },
        providerExecuted: true,
        providerMetadata: { openai: { blockType: "web_search_tool_result" } },
      },
    ])
  }, true)

  scenario("starts recorded local tools eagerly and awaits settlement before continuing", function* (s) {
    yield* s.admit("Echo five times")

    const tools = yield* s.blockTools(5)
    const providerGate = yield* Deferred.make<void>()
    const initial = Stream.fromIterable([
      LLMEvent.stepStart({ index: 0 }),
      ...Array.from({ length: 5 }, (_, index) =>
        LLMEvent.toolCall({ id: `call-echo-${index}`, name: "echo", input: { text: `${index}` } }),
      ),
    ])
    const final = Stream.fromIterable([
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" } }),
      LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
    ])
    yield* s.llm.push(
      Stream.concat(initial, Stream.fromEffect(Deferred.await(providerGate)).pipe(Stream.flatMap(() => final))),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started

    expect(s.executions).toHaveLength(5)
    expect(yield* tools.maxActive).toBe(5)
    expect(yield* s.context).toMatchObject([
      Expected.user("Echo five times"),
      {
        type: "assistant",
        content: Array.from({ length: 5 }, (_, index) => ({
          type: "tool",
          id: `call-echo-${index}`,
          state: { status: "running", input: { text: `${index}` } },
        })),
      },
    ])

    yield* Deferred.succeed(providerGate, undefined)
    yield* Effect.yieldNow
    expect(s.requests).toHaveLength(1)

    yield* tools.release
    yield* Fiber.join(run)

    expect(s.executions).toHaveLength(5)
    expect(yield* tools.maxActive).toBe(5)
    expect(s.requests).toHaveLength(2)
  })

  scenario("settles repeated provider-local tool call IDs against their owning assistant messages", function* (s) {
    yield* s.admit("Echo twice")

    yield* s.llm.push(
      TestLLM.tool("tool_0", "echo", { text: "first" }),
      TestLLM.tool("tool_0", "echo", { text: "second" }),
      [],
    )

    yield* s.resume

    const expected = [
      Expected.user("Echo twice"),
      Expected.assistant({}, [Expected.completedTool({ id: "tool_0" }, { content: [Expected.text("first")] })]),
      Expected.assistant({}, [Expected.completedTool({ id: "tool_0" }, { content: [Expected.text("second")] })]),
      Expected.assistant({}, []),
    ]
    expect(s.executions).toEqual(["first", "second"])
    expect(s.requests).toHaveLength(3)
    expect(yield* s.context).toMatchObject(expected)

    yield* replaySessionProjection(sessionID)

    expect(yield* s.context).toMatchObject(expected)
  })

  scenario("joins concurrent resume calls into one active provider run", function* (s) {
    yield* s.admit("Run once")

    yield* s.llm.push(TestLLM.text("Once", "text-once"))
    const stream = yield* s.llm.gate

    const first = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    const second = yield* s.resume.pipe(Effect.forkChild)
    yield* Effect.yieldNow

    expect(s.requests).toHaveLength(1)
    yield* stream.release
    yield* Fiber.join(first)
    yield* Fiber.join(second)

    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Run once"),
      Expected.assistant({ finish: "stop" }, [Expected.text("Once")]),
    ])
  })

  scenario("steers an active step with newly recorded prompts", function* (s) {
    yield* s.admit("Start working")

    yield* s.llm.push(TestLLM.stop(), TestLLM.stop())

    const first = yield* s.resumePaused
    yield* s.session.prompt({ sessionID, text: "Change direction" })
    yield* first.finish
    yield* Effect.yieldNow

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0])).toEqual(["Start working"])
    expect(userTexts(s.requests[1])).toEqual(["Start working", "Change direction"])
    expect((yield* s.context).map((message) => message.type)).toEqual(["user", "assistant", "user", "assistant"])
  })

  scenario("promotes queued input after continuation ends", function* (s) {
    yield* s.admit("Start working")

    yield* s.llm.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.stop(), TestLLM.stop())

    const first = yield* s.resumePaused
    yield* s.session.prompt({
      sessionID,
      text: "Wait until continuation ends",
      delivery: "queue",
    })
    yield* first.finish

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[0])).toEqual(["Start working"])
    expect(userTexts(s.requests[1])).toEqual(["Start working"])
    expect(userTexts(s.requests[2])).toEqual(["Start working", "Wait until continuation ends"])
  })

  scenario("keeps queued input parked when a steer is cancelled during preparation", function* (s) {
    const runner = yield* SessionRunner.Service
    yield* s.admit("A")
    yield* s.llm.push(TestLLM.stop(), TestLLM.stop(), TestLLM.stop())
    const stream = yield* s.llm.gate
    const run = yield* runner.drain({ sessionID, force: false }).pipe(Effect.forkChild)
    yield* stream.started

    yield* s.session.prompt({ sessionID, text: "B", delivery: "queue", resume: false })
    const steer = yield* s.admit("S")
    s.systemLoadHook = Effect.gen(function* () {
      s.systemLoadHook = Effect.void
      yield* s.session.cancelInbox({ sessionID, inboxID: steer.id }).pipe(Effect.orDie)
    })
    yield* stream.release
    yield* Fiber.join(run)

    expect(s.requests.map(userTexts)).toEqual([["A"], ["A"], ["A", "B"]])
    expect((yield* s.messages).some((message) => message.id === steer.id)).toBe(false)
    expect(yield* s.inbox).toEqual([])
  })

  scenario("dispatches a queued move when a steer is cancelled during preparation", function* (s) {
    const runner = yield* SessionRunner.Service

    const location = Location.Ref.make({ directory: AbsolutePath.make("/moved") })
    yield* s.admit("A")
    yield* s.llm.push(TestLLM.stop(), TestLLM.stop())
    const stream = yield* s.llm.gate
    const run = yield* runner.drain({ sessionID, force: false }).pipe(Effect.forkChild)
    yield* stream.started

    yield* s.sessionInbox.admit({
      id: SessionMessage.ID.create(),
      sessionID,
      item: {
        type: "move",
        payload: { location, projectID: Project.ID.global },
        delivery: "queue",
      },
    })
    const steer = yield* s.admit("S")
    s.systemLoadHook = Effect.gen(function* () {
      s.systemLoadHook = Effect.void
      yield* s.session.cancelInbox({ sessionID, inboxID: steer.id }).pipe(Effect.orDie)
    })
    yield* stream.release

    expect({ result: yield* Fiber.join(run), location: (yield* s.session.get(sessionID)).location }).toEqual({
      result: SessionRunner.DrainResult.Moved({}),
      location,
    })
    expect(s.requests.map(userTexts)).toEqual([["A"], ["A"]])
    expect(s.closedTransports).toEqual([sessionID])
    expect(yield* recordedEventTypes(sessionID)).toContain(Bus.versionedType(SessionEvent.Moved.type, 1))
    expect(yield* s.inbox).toEqual([])
  })

  scenario("preserves durable queued input for a later wake after interruption", function* (s) {
    const interrupted = yield* s.admit("Interrupt current work")

    yield* s.llm.push([], TestLLM.text("Queued work completed", "queued-after-interruption"))
    const stream = yield* s.llm.gate

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    const queued = yield* s.session.prompt({
      sessionID,
      text: "Run after interrupt",
      delivery: "queue",
    })
    yield* s.session.interrupt(sessionID)
    expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
    expect(s.requests).toHaveLength(1)
    // The fixture coordinator owns fibers only; supply the production user-interruption settlement for the runner consumer.
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, {
      sessionID,
      reason: "user",
      resultAnchorInputID: interrupted.id,
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "interrupted", sharedInputs: [interrupted.id],
    })
    expect(yield* SessionInputResult.current(s.db, sessionID)).toBeUndefined()
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toMatchObject({ status: "pending" })
    expect(yield* SessionInbox.has(s.db, sessionID, "queue")).toBe(true)
    const resumed = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    yield* stream.release
    yield* Fiber.join(resumed)

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0])).toEqual(["Interrupt current work"])
    expect(userTexts(s.requests[1])).toEqual(["Interrupt current work", "Run after interrupt"])
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toMatchObject({
      status: "completed", sharedInputs: [queued.id], assistant: { content: [Expected.text("Queued work completed")] },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "interrupted", sharedInputs: [interrupted.id],
    })
    expect(yield* s.inbox).toEqual([])
  })

  scenario("preserves durable steering input for a later resume after interruption", function* (s) {
    yield* s.admit("Interrupt current work")

    yield* s.llm.push([], TestLLM.stop())
    const stream = yield* s.llm.gate

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    yield* s.session.prompt({
      sessionID,
      text: "Steer after interrupt",
    })
    yield* s.session.interrupt(sessionID)
    expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
    expect(s.requests).toHaveLength(1)
    expect(yield* SessionInbox.has(s.db, sessionID, "steer")).toBe(true)

    const resumed = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    yield* stream.release
    yield* Fiber.join(resumed)

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0])).toEqual(["Interrupt current work"])
    expect(userTexts(s.requests[1])).toEqual(["Interrupt current work", "Steer after interrupt"])
  })

  scenario("promotes queued inputs one at a time in FIFO order", function* (s) {
    yield* s.admit("Start working")

    yield* s.llm.push(TestLLM.stop(), TestLLM.stop(), TestLLM.stop())

    const first = yield* s.resumePaused
    yield* s.session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
    yield* s.session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
    yield* first.finish

    expect(s.requests).toHaveLength(3)
    expect(userTexts(s.requests[0])).toEqual(["Start working"])
    expect(userTexts(s.requests[1])).toEqual(["Start working", "Queue first"])
    expect(userTexts(s.requests[2])).toEqual(["Start working", "Queue first", "Queue second"])
  })

  scenario("attributes each queued input to its own durable result before later input fails", function* (s) {
    const initial = yield* s.admit("Initial task")
    const queued = yield* s.session.prompt({ sessionID, text: "Queued task", delivery: "queue", resume: false })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })).toEqual({ status: "pending" })
    yield* s.llm.push(TestLLM.text("Initial result", "initial-result"), TestLLM.text("Queued result", "queued-result"))
    const run = yield* s.resumePaused
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })).toMatchObject({
      status: "processing",
      sharedInputs: [initial.id],
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toEqual({ status: "pending" })
    yield* run.finish

    const first = yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })
    const second = yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })
    expect(first).toMatchObject({ status: "completed", sharedInputs: [initial.id], assistant: { content: [Expected.text("Initial result")] } })
    expect(second).toMatchObject({ status: "completed", sharedInputs: [queued.id], assistant: { content: [Expected.text("Queued result")] } })
    if (first.status !== "completed" || second.status !== "completed") return yield* Effect.die("Missing result")
    expect(first.assistant.id).not.toBe(second.assistant.id)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: first.assistant.id })).toEqual({
      status: "missing",
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID: Session.ID.create(), inputID: initial.id })).toEqual({
      status: "missing",
    })
    // The result remains readable beyond the old SubagentJob 20-message window.
    yield* Effect.forEach(
      Array.from({ length: 22 }, (_, index) => index),
      (index) => s.bus.publish(SessionEvent.Synthetic, { sessionID, text: `Later notice ${index}` }),
    )
    const failed = yield* s.admit("Fail later")
    yield* s.llm.push(Stream.fail(invalidRequest()))
    const failure = yield* s.resume.pipe(Effect.exit)
    expect(Exit.isFailure(failure)).toBe(true)
    // This runner fixture bypasses production SessionExecution lifecycle publication.
    yield* s.bus.publish(SessionEvent.Execution.Failed, {
      sessionID,
      resultAnchorInputID: failed.id,
      error: { type: "provider.invalid-request", message: "Invalid request" },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: failed.id })).toMatchObject({ status: "failed" })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })).toEqual(first)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toEqual(second)
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })).toEqual(first)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toEqual(second)
  })

  scenario("keeps shutdown inputs unresolved and separates interrupted and historical results", function* (s) {
    const interrupted = yield* s.admit("Cancelled work")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer", undefined, {})
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown", resultAnchorInputID: interrupted.id })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "processing",
      sharedInputs: [interrupted.id],
    })
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "user", resultAnchorInputID: interrupted.id })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "interrupted",
      sharedInputs: [interrupted.id],
    })

    const historical = yield* s.admit("Historical work")
    yield* s.llm.push(TestLLM.text("Historical answer", "historical-result"))
    yield* s.resume
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: historical.id })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return yield* Effect.die("Missing historical fixture result")
    // Real stored pre-upgrade messages have no continuation field; never infer it from finish.
    yield* s.db
      .update(SessionMessageTable)
      .set({ data: sql`json_remove(${SessionMessageTable.data}, '$.needsContinuation')` })
      .where(eq(SessionMessageTable.id, result.assistant.id))
      .run()
      .pipe(Effect.orDie)
    yield* s.db.delete(SessionInputResultTable).where(eq(SessionInputResultTable.input_id, historical.id)).run().pipe(Effect.orDie)
    const later = yield* s.admit("New work")
    yield* s.llm.push(TestLLM.text("New answer", "new-result"))
    yield* s.resume
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: historical.id })).toEqual({
      status: "unverified",
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: later.id })).toMatchObject({
      status: "completed",
      assistant: { content: [Expected.text("New answer")] },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "interrupted",
      sharedInputs: [interrupted.id],
    })
  })

  scenario("attributes a steered input after the active tool continuation settles", function* (s) {
    const initial = yield* s.admit("Start work")
    yield* s.llm.push(TestLLM.tool("input-result-tool", "echo", { text: "work" }), TestLLM.text("Done", "done"))
    const run = yield* s.resumePaused
    const steer = yield* s.session.prompt({ sessionID, text: "Steer work" })
    yield* run.finish
    const first = yield* SessionInputResult.read(s.db, { sessionID, inputID: initial.id })
    const second = yield* SessionInputResult.read(s.db, { sessionID, inputID: steer.id })
    expect(first).toMatchObject({ status: "completed", sharedInputs: [initial.id, steer.id], assistant: { content: [Expected.text("Done")] } })
    expect(second).toEqual(first)
    expect(yield* SessionInputResult.current(s.db, sessionID)).toBeUndefined()
    if (first.status !== "completed") return yield* Effect.die("Missing shared result")
    expect(first.resultEventID).toBe(first.assistant.completion?.id)
  })

  scenario("MP02 records a batch of steers as one result and ignores metadata operation claims", function* (s) {
    const first = yield* s.session.prompt({
      sessionID,
      text: "First shared input",
      metadata: { operation: { sourceSessionID: "ses_forged", operationID: "op_forged" } },
      resume: false,
    })
    const second = yield* s.admit("Second shared input")
    yield* s.llm.push(TestLLM.text("One complete shared answer 🚀\nSecond line", "shared-batch"))
    const run = yield* s.resumePaused
    const current = yield* SessionInputResult.current(s.db, sessionID)
    expect(current).toEqual({
      anchorInputID: first.id,
      inputs: [
        { inputID: first.id, operationRef: undefined },
        { inputID: second.id, operationRef: undefined },
      ],
    })
    yield* run.finish
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: first.id })
    expect(result).toMatchObject({
      status: "completed",
      sharedInputs: [first.id, second.id],
      assistant: { content: [Expected.text("One complete shared answer 🚀\nSecond line")] },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: second.id })).toEqual(result)
    expect(s.requests).toHaveLength(1)
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: first.id })).toEqual(result)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: second.id })).toEqual(result)
  })

  scenario("MP02 keeps active membership intact when a separate queued input is cancelled", function* (s) {
    const active = yield* s.admit("Active independent work")
    yield* s.llm.push(TestLLM.text("Active work finished", "active-cancel-queue"))
    const run = yield* s.resumePaused
    const queued = yield* s.session.prompt({ sessionID, text: "Queued successor", delivery: "queue", resume: false })
    yield* s.session.cancelInbox({ sessionID, inboxID: queued.id })
    expect((yield* SessionInputResult.current(s.db, sessionID))?.inputs.map((input) => input.inputID)).toEqual([active.id])
    yield* run.finish
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: active.id })).toMatchObject({
      status: "completed",
      sharedInputs: [active.id],
      assistant: { content: [Expected.text("Active work finished")] },
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toEqual({ status: "missing" })
    expect(s.requests).toHaveLength(1)
  })

  scenario("MP02 freezes the real operation source before sharing a result with independent user input", function* (s) {
    yield* insertSession(otherSessionID)
    const inputID = SessionMessage.ID.create()
    const operationID = SessionTask.OperationID.create()
    const payload = SessionInbox.UserPayload.make({
      text: "Work requested by the source operation",
      metadata: { operation: { sourceSessionID: "ses_forged", operationID: "top_forged" } },
    })
    yield* s.bus.publish(SessionTaskEvent.OperationReserved, {
      sessionID: otherSessionID,
      sourceLocation: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      sourceMode: "coding",
      source: new SessionTask.OperationUserSource({ type: "user_coordination", sessionID: otherSessionID, agent: Agent.ID.make("meta") }),
      selection: new SessionTask.OperationSelection({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }),
      request: new SessionTask.OperationRequest({
        operationID,
        inputID,
        target: new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID }),
        prompt: payload.text,
        delivery: "steer",
        resume: false,
      }),
      targetSessionID: sessionID,
    })
    yield* s.bus.publish(SessionTaskEvent.OperationChanged, {
      sessionID: otherSessionID,
      operationID,
      change: new SessionTask.OperationChange({
        phase: "created",
        prepared: new SessionTask.OperationPrepared({ payload, delivery: "steer", digest: TaskOperation.payloadDigest(payload, "steer") }),
      }),
    })
    const operationRef = new SessionTask.OperationReadonlyRef({ sourceSessionID: otherSessionID, operationID })
    yield* s.sessionInbox.admit({
      id: inputID,
      sessionID,
      item: { type: "user", payload, delivery: "steer" },
      operation: operationRef,
    })
    const user = yield* s.admit("Independent user instruction")
    yield* s.llm.push(TestLLM.text("The operation and user receive this complete result", "real-operation-result"))
    const run = yield* s.resumePaused
    expect(yield* SessionInputResult.current(s.db, sessionID)).toEqual({
      anchorInputID: inputID,
      inputs: [{ inputID, operationRef }, { inputID: user.id, operationRef: undefined }],
    })
    yield* run.finish
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID })
    expect(result).toMatchObject({ status: "completed", sharedInputs: [inputID, user.id] })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: user.id })).toEqual(result)
    yield* s.db.delete(TaskOperationTable).where(eq(TaskOperationTable.operation_id, operationID)).run().pipe(Effect.orDie)
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID })).toEqual(result)
    expect((yield* s.db.select().from(SessionInputResultTable).where(eq(SessionInputResultTable.input_id, inputID)).get().pipe(Effect.orDie))?.operation_ref).toEqual(operationRef)
    expect(s.requests).toHaveLength(1)
  })

  scenario("MP02 retains a processing input group through explicit resume after shutdown and keeps queue separate", function* (s) {
    const interrupted = yield* s.admit("Work persisted before shutdown")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer", undefined, {})
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown", resultAnchorInputID: interrupted.id })
    const queued = yield* s.session.prompt({ sessionID, text: "Work after the resumed answer", delivery: "queue", resume: false })
    yield* s.llm.push(TestLLM.text("Resumed answer", "resumed-group"), TestLLM.text("Queued answer", "resumed-queue"))
    yield* s.resume
    const first = yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })
    const second = yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })
    expect(first).toMatchObject({ status: "completed", sharedInputs: [interrupted.id], assistant: { content: [Expected.text("Resumed answer")] } })
    expect(second).toMatchObject({ status: "completed", sharedInputs: [queued.id], assistant: { content: [Expected.text("Queued answer")] } })
    expect(s.requests).toHaveLength(2)
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toEqual(first)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })).toEqual(second)
  })

  scenario("MP02 joins a persisted processing group when a newly admitted steer wakes the runner", function* (s) {
    const interrupted = yield* s.admit("Earlier input retained after shutdown")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer", undefined, {})
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown", resultAnchorInputID: interrupted.id })
    const steer = yield* s.admit("Continue the retained work with this instruction")
    yield* s.llm.push(TestLLM.text("One answer after the new steer", "wake-persisted-group"))
    yield* (yield* SessionRunner.Service).drain({ sessionID, force: false, promotable: "steer" })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "completed",
      sharedInputs: [interrupted.id, steer.id],
    })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: steer.id })).toEqual(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id }))
    expect(s.requests).toHaveLength(1)
  })

  scenario("MP02 leaves a persisted processing group alone on an advisory wake without admitted input", function* (s) {
    const interrupted = yield* s.admit("Retained work needs explicit continuation")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer", undefined, {})
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown", resultAnchorInputID: interrupted.id })
    yield* (yield* SessionRunner.Service).drain({ sessionID, force: false })
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: interrupted.id })).toMatchObject({
      status: "processing",
      sharedInputs: [interrupted.id],
    })
    expect(s.requests).toHaveLength(0)
  })

  scenario("MP02 requires the recorded terminal event and continuation policy for a completed input result", function* (s) {
    const input = yield* s.admit("Validate the exact result pointer")
    yield* s.llm.push(TestLLM.text("Actual terminal answer", "exact-result-pointer"))
    yield* s.resume
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return yield* Effect.die("Missing exact result fixture")
    yield* s.db.update(SessionMessageTable).set({ data: sql`json_set(${SessionMessageTable.data}, '$.completion.id', 'evt_unrelated')` }).where(eq(SessionMessageTable.id, result.assistant.id)).run().pipe(Effect.orDie)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({ status: "unverified", sharedInputs: [input.id] })
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toEqual(result)
    yield* s.db.update(SessionMessageTable).set({ data: sql`json_remove(${SessionMessageTable.data}, '$.needsContinuation')` }).where(eq(SessionMessageTable.id, result.assistant.id)).run().pipe(Effect.orDie)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({ status: "unverified", sharedInputs: [input.id] })
    yield* replaySessionProjection(sessionID)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toEqual(result)
    expect(s.requests).toHaveLength(1)
  })

  it.live("MP02 reads exact shared and queued results after closing and reopening a real SQLite connection", () =>
    Effect.gen(function* () {
      const s = yield* setup
      const first = yield* s.admit("First shared durable input")
      const shared = yield* s.admit("Second shared durable input")
      const queued = yield* s.session.prompt({ sessionID, text: "Independent queued input", delivery: "queue", resume: false })
      yield* s.llm.push(TestLLM.text("Complete shared result 🚀\nSecond line", "cold-shared-result"), TestLLM.text("Complete queued result", "cold-queued-result"))
      yield* s.resume
      const firstResult = yield* SessionInputResult.read(s.db, { sessionID, inputID: first.id })
      const queuedResult = yield* SessionInputResult.read(s.db, { sessionID, inputID: queued.id })
      expect(firstResult).toMatchObject({ status: "completed", sharedInputs: [first.id, shared.id] })
      expect(queuedResult).toMatchObject({ status: "completed", sharedInputs: [queued.id] })
      const rows = yield* Effect.all({
        project: s.db.select().from(ProjectTable).where(eq(ProjectTable.id, Project.ID.global)).get(),
        session: s.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
        messages: s.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).all(),
        results: s.db.select().from(SessionInputResultTable).where(eq(SessionInputResultTable.session_id, sessionID)).all(),
        events: s.db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all(),
        sequence: s.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).get(),
      }).pipe(Effect.orDie)
      if (!rows.project || !rows.session || !rows.sequence) return yield* Effect.die("Missing persisted result fixture")
      const project = rows.project
      const session = rows.session
      const sequence = rows.sequence
      const directory = yield* tmpdirScoped()
      const cold = Database.layer({ path: `${directory.path}/input-result.sqlite` }).pipe(Layer.provide(tempGlobalLayer))
      yield* Effect.scoped(Effect.gen(function* () {
        const db = Context.get(yield* Layer.build(Layer.fresh(cold)), Database.Service).db
        yield* db.insert(ProjectTable).values(project).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values(session).run().pipe(Effect.orDie)
        yield* db.insert(SessionMessageTable).values(rows.messages).run().pipe(Effect.orDie)
        yield* db.insert(SessionInputResultTable).values(rows.results).run().pipe(Effect.orDie)
        yield* db.insert(EventSequenceTable).values(sequence).run().pipe(Effect.orDie)
        yield* db.insert(EventTable).values(rows.events).run().pipe(Effect.orDie)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        const db = Context.get(yield* Layer.build(Layer.fresh(cold)), Database.Service).db
        expect(yield* SessionInputResult.read(db, { sessionID, inputID: first.id })).toEqual(firstResult)
        expect(yield* SessionInputResult.read(db, { sessionID, inputID: shared.id })).toEqual(firstResult)
        expect(yield* SessionInputResult.read(db, { sessionID, inputID: queued.id })).toEqual(queuedResult)
        expect(yield* SessionInputResult.current(db, sessionID)).toBeUndefined()
      }))
      expect(s.requests).toHaveLength(2)
    }),
  )

  scenario("stops a steer-scoped drain before queued input", function* (s) {
    yield* s.session.prompt({ sessionID, text: "Queue for later", delivery: "queue", resume: false })
    yield* s.session.prompt({ sessionID, text: "Steer now", resume: false })
    yield* s.llm.push(TestLLM.stop())

    const runner = yield* SessionRunner.Service
    yield* runner.drain({ sessionID, force: false, promotable: "steer" })

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toEqual(["Steer now"])
    expect(yield* SessionInbox.has(s.db, sessionID, "steer")).toBe(false)
    expect(yield* SessionInbox.has(s.db, sessionID, "queue")).toBe(true)
  })

  scenario("a steer-scoped drain runs a queued manual compaction next in line", function* (s) {
    // Admit without waking so the steer-scoped drain below is the first consumer.
    const compaction = yield* s.sessionInbox.admitCompaction({
      id: SessionMessage.ID.create(),
      sessionID,
      delivery: "queue",
    })

    const runner = yield* SessionRunner.Service
    yield* runner.drain({ sessionID, force: false, promotable: "steer" })

    // Control work is scope-independent between turns: the barrier is consumed
    // even though the drain never promotes queued input.
    expect(yield* SessionInbox.find(s.db, compaction.id)).toBeUndefined()
    expect((yield* s.messages).find((message) => message.id === compaction.id)).toMatchObject({
      type: "compaction",
      status: "failed",
      error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
    })
  })

  scenario("a steer-scoped drain leaves a compaction parked behind a queued prompt", function* (s) {
    yield* s.session.prompt({ sessionID, text: "Queue for later", delivery: "queue", resume: false })
    const compaction = yield* s.sessionInbox.admitCompaction({
      id: SessionMessage.ID.create(),
      sessionID,
      delivery: "queue",
    })

    const runner = yield* SessionRunner.Service
    yield* runner.drain({ sessionID, force: false, promotable: "steer" })

    // Enqueue order holds: the queued prompt is next in line, so nothing runs.
    expect(s.requests).toHaveLength(0)
    expect(yield* SessionInbox.has(s.db, sessionID, "queue")).toBe(true)
    expect(yield* SessionInbox.find(s.db, compaction.id)).toMatchObject({ id: compaction.id })
  })

  scenario("promotes queued input after steering continuation ends", function* (s) {
    yield* s.admit("Start steering")
    yield* s.session.prompt({
      sessionID,
      text: "Queue for later",
      delivery: "queue",
      resume: false,
    })

    yield* s.llm.push(TestLLM.stop(), TestLLM.stop())

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[0])).toEqual(["Start steering"])
    expect(userTexts(s.requests[1])).toEqual(["Start steering", "Queue for later"])
  })

  scenario("promotes steers before the next queued input", function* (s) {
    yield* s.admit("Start working")

    yield* s.llm.push(TestLLM.stop(), TestLLM.stop(), TestLLM.stop(), TestLLM.stop())
    const firstStream = yield* s.llm.gate

    const first = yield* s.resume.pipe(Effect.forkChild)
    yield* firstStream.started
    yield* s.session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
    yield* s.session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
    const secondStream = yield* s.llm.gate
    yield* firstStream.release
    yield* secondStream.started
    yield* s.session.prompt({ sessionID, text: "Steer before next queued input" })
    yield* s.session.prompt({
      sessionID,
      text: "Also steer before next queued input",
    })
    yield* s.session.synthetic({ sessionID, text: "Background completion before next queued input" })
    yield* secondStream.release
    yield* Fiber.join(first)

    expect(s.requests).toHaveLength(4)
    expect(userTexts(s.requests[0])).toEqual(["Start working"])
    expect(userTexts(s.requests[1])).toEqual(["Start working", "Queue first"])
    expect(userTexts(s.requests[2])).toEqual([
      "Start working",
      "Queue first",
      "Steer before next queued input",
      "Also steer before next queued input",
      "Background completion before next queued input",
    ])
    expect(userTexts(s.requests[3])).toEqual([
      "Start working",
      "Queue first",
      "Steer before next queued input",
      "Also steer before next queued input",
      "Background completion before next queued input",
      "Queue second",
    ])
  })

  scenario("coalesces multiple active steering prompts into one continuation step", function* (s) {
    const execution = yield* SessionExecution.Service
    yield* s.admit("Start working")

    yield* s.llm.push(TestLLM.stop(), TestLLM.stop())

    const first = yield* s.resumePaused
    yield* s.session.prompt({ sessionID, text: "First steer" })
    yield* s.session.prompt({ sessionID, text: "Second steer" })
    yield* first.finish
    yield* Effect.yieldNow

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[1])).toEqual(["Start working", "First steer", "Second steer"])
    yield* execution.wake(sessionID)
    yield* Effect.yieldNow
    expect(s.requests).toHaveLength(2)
  })

  scenario("runs steering input accepted while the active step fails", function* (s) {
    yield* s.admit("Start working")

    const failure = invalidRequest()
    yield* s.llm.push(Stream.fail(failure))

    const first = yield* s.resumePaused
    yield* s.session.prompt({ sessionID, text: "Recover with this" })
    expect(yield* first.finish.pipe(Effect.flip)).toBe(failure)

    yield* s.llm.push([])
    yield* s.session.wait(sessionID)

    expect(s.requests).toHaveLength(2)
    expect(userTexts(s.requests[1])).toEqual(["Start working", "Recover with this"])
  })

  scenario("settles abandoned compactions before continuing after a process crash", function* (s) {
    yield* s.runPrompt("History before the crash")
    const first = SessionMessage.ID.create()
    const completed = SessionMessage.ID.create()
    const last = SessionMessage.ID.create()
    yield* s.bus.publish(SessionEvent.Compaction.Started, {
      sessionID,
      reason: "manual",
      inputID: first,
      recent: "",
    })
    yield* s.bus.publish(SessionEvent.Compaction.Started, {
      sessionID,
      reason: "manual",
      inputID: completed,
      recent: "",
    })
    yield* s.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: "## Objective\n- Earlier completed checkpoint",
      recent: "",
    })
    yield* s.bus.publish(SessionEvent.Compaction.Started, {
      sessionID,
      reason: "auto",
      inputID: last,
      recent: "",
    })

    // These starts have no terminal events, as after SIGKILL. The older orphan
    // is outside model-visible history; recovery must settle it as well.
    expect(
      (yield* s.messages).filter((message) => message.type === "compaction" && message.status === "running"),
    ).toHaveLength(2)
    yield* s.llm.push(TestLLM.text("Recovered response", "recovered"))
    const run = yield* s.resumePaused
    expect((yield* s.messages).filter((message) => message.type === "compaction").toReversed()).toMatchObject([
      { id: first, status: "failed", reason: "manual", error: { type: "compaction.interrupted" } },
      { id: completed, status: "completed", summary: "## Objective\n- Earlier completed checkpoint" },
      { id: last, status: "failed", reason: "auto", error: { type: "compaction.interrupted" } },
    ])
    yield* run.finish

    yield* s.llm.push(TestLLM.text("## Objective\n- New checkpoint", "new-summary"))
    const next = yield* s.session.compact({ sessionID })
    yield* s.session.wait(sessionID)
    expect((yield* s.messages).find((message) => message.id === next.id)).toMatchObject({
      status: "completed",
      summary: "## Objective\n- New checkpoint",
    })
    expect(
      (yield* s.messages).filter((message) => message.type === "compaction" && message.status === "running"),
    ).toHaveLength(0)
  })

  scenario("settles an abandoned compaction before delivering another manual compaction", function* (s) {
    yield* s.runPrompt("History before the crash")
    const previous = SessionMessage.ID.create()
    yield* s.bus.publish(SessionEvent.Compaction.Started, {
      sessionID,
      reason: "manual",
      inputID: previous,
      recent: "",
    })
    yield* s.llm.push(TestLLM.text("## Objective\n- New checkpoint", "new-summary"))
    const gate = yield* s.llm.gate
    const next = yield* s.session.compact({ sessionID })
    yield* gate.started
    expect((yield* s.messages).filter((message) => message.type === "compaction").toReversed()).toMatchObject([
      { id: previous, status: "failed", error: { type: "compaction.interrupted" } },
      { id: next.id, status: "running" },
    ])
    yield* gate.release
    yield* s.session.wait(sessionID)
  })

  scenario("durably fails local tools left running by a prior process before continuing", function* (s) {
    yield* s.admit("Recover interrupted tool")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer")
    const assistantMessageID = SessionMessage.ID.create()
    yield* s.bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      started: 0,
    })
    yield* s.bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted",
      name: "echo",
    })
    yield* s.bus.publish(SessionEvent.Tool.Input.Ended, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted",
      text: '{"text":"stale"}',
    })
    yield* s.bus.publish(SessionEvent.Tool.Called, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted",
      input: { text: "stale" },
      executed: false,
    })
    s.requests.length = 0
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(messageRoles(s.requests[0])).toEqual(["user", "assistant", "tool"])
    expect(yield* s.context).toMatchObject([
      Expected.user("Recover interrupted tool"),
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-interrupted" },
          { error: { type: "aborted", message: "Tool execution interrupted: echo" } },
        ),
      ]),
      Expected.assistant({}, []),
    ])
  })

  scenario("preserves a stale subagent child session in its model-visible failure", function* (s) {
    yield* s.admit("Recover interrupted subagent")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer")
    const assistantMessageID = SessionMessage.ID.create()
    yield* s.bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      started: 0,
    })
    yield* s.bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted-subagent",
      name: "subagent",
    })
    yield* s.bus.publish(SessionEvent.Tool.Input.Ended, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted-subagent",
      text: '{"agent":"general"}',
    })
    yield* s.bus.publish(SessionEvent.Tool.Called, {
      sessionID,
      assistantMessageID,
      id: "call-interrupted-subagent",
      input: { agent: "general" },
      executed: false,
    })
    yield* s.db
      .update(SessionMessageTable)
      .set({
        data: sql`json_set(
          ${SessionMessageTable.data},
          '$.content[0].state.metadata',
          json('{"sessionID":"ses_existing_child","status":"running","internal":"private"}')
        )`,
      })
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .run()
      .pipe(Effect.orDie)
    s.requests.length = 0
    yield* s.llm.push([])
    yield* s.resume

    expect(yield* s.context).toMatchObject([
      Expected.user("Recover interrupted subagent"),
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-interrupted-subagent" },
          {
            error: {
              type: "aborted",
              message: "Tool execution interrupted: subagent (sessionID: ses_existing_child)",
            },
            metadata: { sessionID: "ses_existing_child", status: "running", internal: "private" },
          },
        ),
      ]),
      Expected.assistant({}, []),
    ])
    const modelResult = JSON.stringify(s.requests[0]?.messages.at(-1))
    expect(modelResult).toContain("ses_existing_child")
    expect(modelResult).not.toContain("private")
  })

  scenario("durably fails hosted tools left running by a prior process before continuing inline", function* (s) {
    yield* s.admit("Recover interrupted hosted tool")
    yield* s.llm.push(TestLLM.hangAfter(LLMEvent.toolCall({
      id: "call-hosted-interrupted", name: "web_search", input: { query: "stale" },
      providerExecuted: true, providerMetadata: { openai: { itemId: "call-hosted-interrupted" } },
    })))
    const running = yield* s.resume.pipe(Effect.forkIn(yield* Effect.scope))
    const boundary = (yield* awaitWithTimeout(s.bus.log({ aggregateID: sessionID, follow: true }).pipe(
      Stream.filter((event): event is SessionEvent.Tool.Called => event.type === SessionEvent.Tool.Called.type),
      Stream.filter((event) => event.data.id === "call-hosted-interrupted"),
      Stream.take(1), Stream.runCollect,
    ), "The original HTTP attempt did not produce its hosted tool"))[0]
    if (!boundary) return yield* Effect.die(new Error("Missing hosted tool recovery boundary"))
    yield* s.session.interrupt(sessionID)
    expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true)
    // Replay the actual pre-interruption prefix as the state left by a prior process.
    yield* replaySessionProjection(sessionID, boundary.durable.seq)
    expect(requireAssistant(yield* s.context).content).toMatchObject([
      { type: "tool", id: "call-hosted-interrupted", state: { status: "running" } },
    ])
    s.requests.length = 0
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(messageRoles(s.requests[0])).toEqual(["user", "assistant"])
    expect(s.requests[0]?.messages[1]?.content).toMatchObject([
      {
        type: "tool-call",
        id: "call-hosted-interrupted",
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "call-hosted-interrupted" } },
      },
      { type: "tool-result", id: "call-hosted-interrupted", providerExecuted: true, result: { type: "error" } },
    ])
  }, true)

  scenario("durably fails pending tool input left by a prior process before continuing", function* (s) {
    yield* s.admit("Recover interrupted tool input")
    yield* SessionInbox.promote(s.db, s.bus, sessionID, "steer")
    const assistantMessageID = SessionMessage.ID.create()
    yield* s.bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      started: 0,
    })
    yield* s.bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID,
      id: "call-pending-interrupted",
      name: "echo",
    })
    s.requests.length = 0
    yield* s.llm.push([])
    yield* s.resume

    expect(s.requests).toHaveLength(1)
    expect(messageRoles(s.requests[0])).toEqual(["user", "assistant", "tool"])
    expect(yield* s.context).toMatchObject([
      Expected.user("Recover interrupted tool input"),
      Expected.assistant({}, [Expected.failedTool({ id: "call-pending-interrupted" }, {})]),
      Expected.assistant({}, []),
    ])
  })

  scenario("promotes the first queued input when woken while idle", function* (s) {
    const execution = yield* SessionExecution.Service
    yield* s.session.prompt({
      sessionID,
      text: "Wait in queue",
      delivery: "queue",
      resume: false,
    })

    const stream = yield* s.llm.gate
    yield* execution.wake(sessionID)
    yield* stream.started
    yield* stream.release

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toEqual(["Wait in queue"])
  })

  scenario("retries inbox input after prompt projection rolls back", function* (s) {
    const execution = yield* SessionExecution.Service
    const defect = new Error("fail after prompt promotion")
    let fail = true
    yield* s.bus.project(SessionEvent.InboxDelivered, () => (fail ? Effect.die(defect) : Effect.void))
    yield* s.admit("Recover promoted input")

    expect(yield* s.resume.pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    fail = false
    s.requests.length = 0
    yield* s.llm.push(TestLLM.stop())

    const stream = yield* s.llm.gate
    yield* execution.wake(sessionID)
    yield* stream.started
    yield* stream.release

    expect(userTexts(s.requests[0])).toEqual(["Recover promoted input"])
  })

  scenario("does not strand a committed promotion when a post-commit listener defects", function* (s) {
    yield* s.bus.listen((event) =>
      event.type === SessionEvent.InboxDelivered.type ? Effect.die("fail after prompt promotion commits") : Effect.void,
    )
    yield* s.runPrompt("Run committed promotion")

    expect(s.requests).toHaveLength(1)
    expect(userTexts(s.requests[0])).toEqual(["Run committed promotion"])
  })

  scenario("adds session correlation headers to model requests", function* (s) {
    yield* s.runPrompt("Run correlated request")

    expect(s.requests[0]?.http?.headers).toEqual({
      "x-aigcfroge-session-id": sessionID,
      "x-session-affinity": sessionID,
      "X-Session-Id": sessionID,
      "User-Agent": App.useragent(App.make()),
      "x-aigcfroge-project": Project.ID.global,
      "x-aigcfroge-session": sessionID,
      "x-aigcfroge-client": "aigcfroge",
    })
  })

  scenario("uses the selected Agent request headers and body for primary execution", function* (s) {
    const agents = yield* Agent.Service
    const request = {
      settings: { agentOnly: true, temperature: 0.99 },
      headers: { "X-Agent": "primary" },
      body: { temperature: 0.75, metadata: { source: "primary-agent" } },
    }
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.request = request
      }),
    )
    const hooks = yield* PluginHooks.Service
    const seen: Agent.ID[] = []
    yield* hooks.register("session", "model.request", (event) =>
      Effect.sync(() => {
        if (event.kind !== "primary") return
        seen.push(event.agent)
      }),
    )
    yield* s.runPrompt("Run configured Agent request")

    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]?.http?.headers).toMatchObject({
      "X-Agent": "primary",
      "x-aigcfroge-session-id": sessionID,
    })
    expect(s.requests[0]?.http?.body).toEqual(request.body)
    expect(s.requests[0]?.generation?.temperature).toBeUndefined()
    expect(s.requests[0]?.providerOptions?.agentOnly).toBeUndefined()
    expect(seen).toEqual([Agent.ID.make("build")])
  })

  scenario("uses parent cache affinity for child model requests", function* (s) {
    const parentID = Session.ID.make("ses_runner_parent")

    yield* s.db
      .update(SessionTable)
      .set({ parent_id: parentID })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    yield* s.runPrompt("Run child request")

    expect(s.requests[0]?.http?.headers).toMatchObject({
      "x-aigcfroge-session-id": sessionID,
      "x-aigcfroge-parent-session-id": parentID,
      "x-session-affinity": parentID,
      "X-Session-Id": parentID,
      "x-parent-session-id": parentID,
      "x-aigcfroge-session": parentID,
    })
    expect(s.requests[0]?.promptCacheKey).toBe(parentID)
  })

  scenario("runs different sessions concurrently", function* (s) {
    yield* insertSession(otherSessionID)
    yield* s.admit("Run first")
    yield* s.session.prompt({
      sessionID: otherSessionID,
      text: "Run second",
      resume: false,
    })

    const stream = yield* s.llm.gate

    const first = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    const second = yield* s.session.resume(otherSessionID).pipe(Effect.forkChild)
    yield* stream.started

    expect(s.requests).toHaveLength(2)
    expect(s.requests.map((request) => request.promptCacheKey)).toEqual([sessionID, otherSessionID])
    yield* stream.release
    yield* Fiber.join(first)
    yield* Fiber.join(second)
  })

  scenario("bounds 64-character session prompt cache keys", function* (s) {
    const longSessionID = Session.ID.make(`ses_${"a".repeat(64)}`)
    const otherLongSessionID = Session.ID.make(`ses_${"b".repeat(64)}`)
    yield* insertSession(longSessionID)
    yield* insertSession(otherLongSessionID)
    yield* s.session.prompt({
      sessionID: longSessionID,
      text: "Run long session",
      resume: false,
    })
    yield* s.session.prompt({
      sessionID: otherLongSessionID,
      text: "Run other long session",
      resume: false,
    })

    yield* s.session.resume(longSessionID)
    yield* s.session.resume(otherLongSessionID)

    const keys = s.requests.map((request) => request.promptCacheKey)
    expect(keys).toEqual([longSessionID.slice(4), otherLongSessionID.slice(4)])
    expect(keys.every((key) => typeof key === "string" && key.length === 64)).toBe(true)
    expect(keys[0]).not.toBe(keys[1])
  })

  scenario("fans out one failed run and allows a later retry", function* (s) {
    yield* s.admit("Retry after failure")

    yield* s.llm.push(Stream.fail(invalidRequest()))
    const stream = yield* s.llm.gate

    const first = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    const second = yield* s.resume.pipe(Effect.forkChild)
    yield* Effect.yieldNow

    expect(s.requests).toHaveLength(1)
    yield* stream.release
    const [firstExit, secondExit] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
    expect(secondExit).toEqual(firstExit)

    yield* s.llm.push([])
    yield* s.resume
    expect(s.requests).toHaveLength(2)
  })

  scenario("durably settles local tool failures before continuing", function* (s) {
    yield* s.admit("Call missing")

    yield* s.llm.push(TestLLM.tool("call-missing", "missing", {}), TestLLM.text("Recovered", "text-after-error"))
    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      Expected.user("Call missing"),
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-missing" },
          {
            error: {
              type: "tool.execution",
              message:
                'No tool named "missing" is currently available. Please use a tool from the available tool list.',
            },
          },
        ),
      ]),
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  scenario("returns unexpected local tool defects to the model and continues", function* (s) {
    yield* s.admit("Call defect")

    yield* s.llm.push(TestLLM.tool("call-defect", "defect", {}), TestLLM.text("Recovered", "text-after-defect"))

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(messageRoles(s.requests[1])).toEqual(["user", "assistant", "tool"])
    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Call defect"),
      Expected.assistant({}, [
        Expected.failedTool({ id: "call-defect" }, { error: { type: "unknown", message: "unexpected tool defect" } }),
      ]),
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
    const assistant = requireAssistant(context)
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.ended.1",
    ])
  })

  scenario("returns tool-wrapped policy blocks to the model and continues", function* (s) {
    const registry = yield* Tool.Service
    yield* transformTools(
      registry,
      {
        blocked: {
          name: "blocked",
          description: "Fail because policy blocked execution",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () =>
            Effect.fail(new Permission.BlockedError({ rules: [], permission: "blocked", resources: ["*"] })).pipe(
              Effect.mapError(() => new Tool.Error({ message: "Permission blocked" })),
            ),
        },
      },
      { codemode: false },
    )
    yield* s.admit("Call blocked")

    yield* s.llm.push(TestLLM.tool("call-blocked", "blocked", {}), TestLLM.stop())

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      Expected.user("Call blocked"),
      Expected.assistant({}, [
        Expected.failedTool({ id: "call-blocked" }, { error: { message: "Permission blocked" } }),
      ]),
      { type: "assistant", finish: "stop" },
    ])
  })

  scenario("interrupts runner continuation on a decline after settling an ordinary tool error", function* (s) {
    const registry = yield* Tool.Service
    yield* transformTools(
      registry,
      {
        failed: {
          name: "failed",
          description: "Fail normally before the declined call",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.fail(new Tool.Error({ message: "Ordinary tool failure" })),
        },
        declined: {
          name: "declined",
          description: "Fail because the user declined approval",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die(new Permission.DeclinedError()),
        },
      },
      { codemode: false },
    )
    yield* s.admit("Call declined")

    yield* s.llm.push(
      TestLLM.toolCalls(
        LLMEvent.toolCall({ id: "call-failed", name: "failed", input: {} }),
        LLMEvent.toolCall({ id: "call-declined", name: "declined", input: {} }),
      ),
    )

    const exit = yield* s.resume.pipe(Effect.exit)

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Call declined"),
      Expected.assistant({}, [
        Expected.failedTool({ id: "call-failed" }, { error: { message: "Ordinary tool failure" } }),
        Expected.failedTool(
          { id: "call-declined" },
          { error: { type: "aborted", message: "The user declined this tool call" } },
        ),
      ]),
    ])
  })

  scenario("returns permission corrections to the model and continues", function* (s) {
    const registry = yield* Tool.Service
    yield* transformTools(
      registry,
      {
        corrected: {
          name: "corrected",
          description: "Fail with user correction feedback",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () =>
            Effect.fail(new Permission.CorrectedError({ feedback: "Use another tool" })).pipe(
              Effect.mapError(() => new Tool.Error({ message: "Use another tool" })),
            ),
        },
      },
      { codemode: false },
    )
    yield* s.admit("Call corrected")

    yield* s.llm.push(TestLLM.tool("call-corrected", "corrected", {}), TestLLM.stop())

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      Expected.user("Call corrected"),
      Expected.assistant({}, [
        Expected.failedTool({ id: "call-corrected" }, { error: { message: "Use another tool" } }),
      ]),
      { type: "assistant", finish: "stop" },
    ])
  })

  scenario("returns configured permission denials to the model and continues", function* (s) {
    const registry = yield* Tool.Service
    yield* transformTools(registry, { permissionfail: permissionFail }, { codemode: false })
    yield* s.admit("Reject permission")
    yield* s.llm.push(TestLLM.tool("call-permission", "permissionfail", {}), [
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
    ])

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-permission" },
          {
            error: {
              type: "permission.rejected",
              message: "Permission denied: edit",
            },
          },
        ),
      ]),
      { type: "assistant", finish: "stop" },
    ])
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.failed.1")
  })

  scenario("interrupts runner continuation when a question is cancelled", function* (s) {
    const registry = yield* Tool.Service
    yield* transformTools(
      registry,
      {
        question: {
          name: "question",
          description: "Ask the user",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die(new QuestionTool.CancelledError()),
        },
      },
      { codemode: false },
    )
    yield* s.admit("Ask then stop")

    yield* s.llm.push(TestLLM.tool("call-question", "question", {}), [])

    const run = yield* s.resume.pipe(Effect.exit, Effect.forkChild)
    const exit = yield* Fiber.join(run)

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Ask then stop"),
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-question" },
          { error: { type: "aborted", message: "The user dismissed this question" } },
        ),
      ]),
    ])
  })

  scenario("awaits started local tools before surfacing provider stream failure", function* (s) {
    yield* s.admit("Settle before failing")
    // Non-retryable so the step settles terminally instead of continuing after tool output.
    const failure = invalidRequest()
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-failure", name: "echo", input: { text: "settle" } }),
      ),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* tools.release
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)

    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Settle before failing"),
      Expected.assistant({}, [
        Expected.completedTool({ id: "call-before-failure" }, { content: [Expected.text("settle")] }),
      ]),
    ])
    const assistant = requireAssistant(context)
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.step.failed.1",
    ])
  })

  scenario("durably fails blocked local tools when a step is interrupted", function* (s) {
    yield* s.admit("Interrupt blocked tool")
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      TestLLM.hangAfter(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-interrupt", name: "echo", input: { text: "blocked" } }),
      ),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* s.session.interrupt(sessionID)

    expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
    yield* s.session.interrupt(sessionID)
    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Interrupt blocked tool"),
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-before-interrupt" },
          { error: { type: "aborted", message: "Tool execution interrupted" } },
        ),
      ]),
    ])
    const assistant = requireAssistant(context)
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.completed.1")
    expect(assistant.completion).toBeUndefined()
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.failed.1",
    ])

    yield* replaySessionProjection(sessionID)

    const replayed = yield* s.context
    expect(replayed).toMatchObject([
      Expected.user("Interrupt blocked tool"),
      Expected.assistant({}, [Expected.failedTool({ id: "call-before-interrupt" }, {})]),
    ])
    expect(requireAssistant(replayed).completion).toBeUndefined()
    s.requests.length = 0
    yield* s.llm.push([])
    yield* s.resume
    expect(messageRoles(s.requests[0])).toEqual(["user", "assistant", "tool"])
  })

  scenario("interrupts a blocked step without local tool execution", function* (s) {
    yield* s.admit("Interrupt provider")
    const stream = yield* s.llm.gate

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* stream.started
    yield* s.session.interrupt(sessionID)
    const exit = yield* Fiber.await(run)

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Interrupt provider"),
      { type: "assistant", finish: "error", error: { type: "aborted", message: "Step interrupted" } },
    ])
    expect(yield* recordedEventTypes(sessionID)).toContain("session.step.failed.1")
    yield* s.session.interrupt(sessionID)
  })

  scenario("durably fails blocked local tools when interrupted while awaiting settlement", function* (s) {
    yield* s.admit("Interrupt tool settlement")
    const tools = yield* s.blockTools()
    yield* s.llm.push(TestLLM.tool("call-await-interrupt", "echo", { text: "blocked" }))
    const streamed = yield* s.bus.subscribe(SessionEvent.Step.Streamed).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )

    const runner = yield* SessionRunner.Service
    const run = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
    yield* tools.started
    yield* Fiber.join(streamed)
    yield* Fiber.interrupt(run)

    const exit = yield* Fiber.await(run)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(yield* s.context).toMatchObject([
      Expected.user("Interrupt tool settlement"),
      Expected.assistant({ finish: "error", error: { type: "aborted", message: "Step interrupted" } }, [
        Expected.failedTool(
          { id: "call-await-interrupt" },
          { error: { type: "aborted", message: "Tool execution interrupted" } },
        ),
      ]),
    ])
    const eventTypes = yield* recordedEventTypes(sessionID)
    expect(eventTypes.filter((type) => type === "session.tool.failed.2")).toHaveLength(1)
    expect(eventTypes.filter((type) => type === "session.step.failed.1")).toHaveLength(1)
    expect(eventTypes).not.toContain("session.step.ended.1")
    expect(eventTypes).not.toContain("session.retry.scheduled.1")
    expect(s.requests).toHaveLength(1)
  })

  scenario("forces a text response on an agent's configured final step", function* (s) {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.steps = 2
      }),
    )
    const input = yield* s.admit("Finish at the limit")

    yield* s.llm.push(
      TestLLM.tool("call-terminal", "echo", { text: "done" }),
      TestLLM.tool("call-forbidden", "echo", { text: "forbidden" }),
    )

    yield* s.resume

    expect(s.requests).toHaveLength(2)
    expect(s.requests[0]?.toolChoice).toBeUndefined()
    expect(s.requests[1]?.toolChoice).toMatchObject({ type: "none" })
    // Protocols with native "none" keep these definitions for prompt caching.
    expect(s.requests[1]?.tools.map((tool) => tool.name)).toContain("echo")
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
    })
    expect(s.executions).toEqual(["done"])
    expect(yield* s.context).toMatchObject([
      Expected.user("Finish at the limit"),
      Expected.assistant({}, [Expected.completedTool({ id: "call-terminal" }, {})]),
      Expected.assistant({}, [Expected.failedTool({ id: "call-forbidden" }, {})]),
    ])
    const result = yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })
    expect(result).toMatchObject({
      status: "completed",
      assistant: { needsContinuation: false, content: [Expected.failedTool({ id: "call-forbidden" }, {})] },
    })
    const assistants = (yield* s.session.messages({ sessionID, order: "asc" })).filter(
      (message) => message.type === "assistant",
    )
    expect(assistants.map((message) => message.needsContinuation)).toEqual([true, false])
  })

  scenario("resets the configured step allowance when steering input promotes", function* (s) {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.steps = 2
      }),
    )
    yield* s.admit("Start work")

    yield* s.llm.push(
      TestLLM.tool("call-before-steer", "echo", { text: "before" }),
      TestLLM.tool("call-after-steer", "echo", { text: "after" }),
      TestLLM.stop(),
    )

    const run = yield* s.resumePaused
    yield* s.session.prompt({ sessionID, text: "Change direction" })
    yield* run.finish

    expect(s.requests).toHaveLength(3)
    expect(s.requests[1]?.toolChoice).toBeUndefined()
    expect(s.requests[1]?.tools).not.toEqual([])
    expect(s.requests[2]?.toolChoice).toMatchObject({ type: "none" })
    expect(s.executions).toEqual(["before", "after"])
  })

  scenario("projects provider errors as terminal assistant step failures", function* (s) {
    yield* s.llm.push([LLMEvent.stepStart({ index: 0 }), LLMEvent.providerError({ message: "Provider unavailable" })])

    expect((yield* s.runPrompt("Fail durably").pipe(Effect.flip)).message).toBe("Provider unavailable")

    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Fail durably"),
      { type: "assistant", finish: "error", error: { type: "provider.unknown", message: "Provider unavailable" } },
    ])
  })

  scenario("projects provider errors emitted before assistant step start", function* (s) {
    yield* s.llm.push([LLMEvent.providerError({ message: "Provider unavailable" })])

    expect((yield* s.runPrompt("Fail before step").pipe(Effect.flip)).message).toBe("Provider unavailable")

    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Fail before step"),
      { type: "assistant", finish: "error", error: { type: "provider.unknown", message: "Provider unavailable" } },
    ])
  })

  scenario("persists raw finish reasons and provider state", function* (s) {
    yield* s.llm.push(
      TestLLM.complete(
        {
          reason: { normalized: "stop", raw: "end_turn" },
          providerMetadata: { openai: { responseId: "response-1", serviceTier: "priority" } },
        },
        LLMEvent.textStart({ id: "answer" }),
        LLMEvent.textDelta({ id: "answer", text: "Complete" }),
        LLMEvent.textEnd({ id: "answer" }),
      ),
    )

    yield* s.runPrompt("Keep provider finish details")

    expect(yield* s.context).toMatchObject([
      { type: "user" },
      {
        type: "assistant",
        finish: "stop",
        rawFinish: "end_turn",
        providerState: { responseId: "response-1", serviceTier: "priority" },
        content: [Expected.text("Complete")],
      },
    ])
  })

  scenario("projects content-filter finishes as visible terminal failures", function* (s) {
    yield* s.llm.push(
      TestLLM.complete(
        {
          reason: { normalized: "content-filter", raw: "SAFETY" },
          providerMetadata: {
            openai: {
              responseId: "response-blocked",
              refusal: { category: "safety", explanation: "Prompt blocked" },
            },
          },
          usage: { nonCachedInputTokens: 8, outputTokens: 3, reasoningTokens: 1 },
        },
        LLMEvent.textStart({ id: "partial" }),
        LLMEvent.textDelta({ id: "partial", text: "Partial" }),
      ),
    )

    expect((yield* s.runPrompt("Blocked response").pipe(Effect.flip)).message).toBe("Provider blocked the response")
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      {
        type: "assistant",
        finish: "content-filter",
        rawFinish: "SAFETY",
        providerState: {
          responseId: "response-blocked",
          refusal: { category: "safety", explanation: "Prompt blocked" },
        },
        error: { type: "provider.content-filter" },
        cost: 0,
        tokens: { input: 8, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
        content: [Expected.text("Partial")],
      },
    ])
    expect(yield* s.session.get(sessionID)).toMatchObject({
      cost: 0,
      tokens: { input: 8, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
    })
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.ended.1")
  })

  scenario("settles a local tool before one content-filter step failure", function* (s) {
    yield* s.admit("Tool before blocked response")
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      TestLLM.complete(
        { reason: { normalized: "content-filter" } },
        LLMEvent.toolCall({ id: "call-before-content-filter", name: "echo", input: { text: "settled" } }),
      ),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* tools.release
    expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider blocked the response")

    const assistant = requireAssistant(yield* s.context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => event.type)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.step.failed.1",
    ])
    expect(
      events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
    ).toHaveLength(1)
  })

  scenario("does not recover context overflow after durable assistant output", function* (s) {
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "text-partial" }),
      LLMEvent.textDelta({ id: "text-partial", text: "Partial" }),
      LLMEvent.textEnd({ id: "text-partial" }),
      LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
    ])
    expect((yield* s.runPrompt("Fail after output").pipe(Effect.flip)).message).toBe("prompt too long")

    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Fail after output"),
      Expected.assistant({ finish: "error", error: { message: "prompt too long" } }, [Expected.text("Partial")]),
    ])
  })

  scenario("projects raw provider stream failures as terminal assistant step failures", function* (s) {
    const failure = invalidRequest()
    yield* s.llm.push(Stream.fail(failure))

    expect(yield* s.runPrompt("Fail raw stream durably").pipe(Effect.flip)).toBe(failure)
    yield* replaySessionProjection(sessionID)
    expect(yield* s.context).toMatchObject([
      Expected.user("Fail raw stream durably"),
      { type: "assistant", finish: "error", error: { type: "provider.invalid-request", message: "Invalid request" } },
    ])
  })

  for (const failure of [providerUnavailable, websocketDisconnected]) {
    scenario(`bounds jittered exponential backoff before output for ${failure.name}`, function* (s) {
      yield* s.admit("Retry transport")
      yield* s.llm.push(TestLLM.failAfter(failure(), LLMEvent.stepStart({ index: 0 })))
      yield* s.llm.push(
        Stream.fromEffect(Effect.sleep(400)).pipe(
          Stream.flatMap(() => Stream.fromIterable(TestLLM.text("Recovered", "retry-success"))),
        ),
      )

      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("1599 millis")
      expect(s.requests).toHaveLength(1)
      yield* TestClock.adjust("1201 millis")
      yield* Fiber.join(run)

      expect(s.requests).toHaveLength(2)
      expect(s.requests[1]?.messages).toEqual(s.requests[0]?.messages)
      const eventTypes = yield* recordedEventTypes(sessionID)
      expect(eventTypes).toContain("session.retry.scheduled.1")
      expect(eventTypes.filter((type) => type === "session.step.started.1")).toHaveLength(1)
      expect(yield* s.context).toMatchObject([
        { type: "user" },
        Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
      ])
      yield* replaySessionProjection(sessionID)
      expect((yield* s.context).filter((message) => message.type === "assistant")).toHaveLength(1)
      const assistant = requireAssistant(yield* s.context)
      const attempts = assistant.attempts
      if (attempts?.length !== 2 || attempts[0].terminal === undefined || attempts[1].terminal === undefined || assistant.time.streamed === undefined)
        return yield* Effect.die(new Error("Transparent retry omitted its physical receipts or first streamed time"))
      expect(DateTime.toEpochMillis(assistant.time.created)).toBe(attempts[0].started)
      expect(DateTime.toEpochMillis(assistant.time.streamed)).toBe(attempts[0].terminal.ended)
      expect(attempts[1].terminal.ended - attempts[1].started).toBe(400)
    })
  }

  scenario("does not start another physical attempt after interruption during retry backoff", function* (s) {
    yield* s.admit("Interrupt retry backoff")
    yield* s.llm.push(Stream.fail(providerUnavailable()), TestLLM.text("Must not run", "unused-retry"))
    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* s.session.interrupt(sessionID)
    const exit = yield* Fiber.await(run)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    yield* TestClock.adjust("1 minute")
    expect(s.requests).toHaveLength(1)
    const events = yield* recordedEventTypes(sessionID)
    expect(events.filter((type) => type === "session.retry.scheduled.1")).toHaveLength(1)
    expect(events).not.toContain("session.synthetic.1")
  })

  scenario("immediately rebuilds once after explicit continuation rejection", function* (s) {
    yield* s.llm.push(Stream.fail(continuationRejected("retry-full")))
    yield* s.llm.push(TestLLM.text("Recovered", "continuation-recovery"))

    yield* s.runPrompt("Recover continuation")

    expect(s.requests).toHaveLength(2)
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  scenario("bounds repeated continuation rejection to one immediate recovery", function* (s) {
    const failure = continuationRejected("rotate-and-retry-full")
    yield* s.llm.push(Stream.fail(failure), Stream.fail(failure))

    expect(yield* s.runPrompt("Reject continuation twice").pipe(Effect.flip)).toBe(failure)

    expect(s.requests).toHaveLength(2)
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
  })

  scenario("retries an incomplete stream before output", function* (s) {
    yield* s.admit("Retry incomplete stream")
    yield* s.llm.push(Stream.fail(incompleteStream()))
    yield* s.llm.push(TestLLM.text("Recovered", "incomplete-stream-success"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  scenario("retries an unknown finish before output", function* (s) {
    yield* s.admit("Retry unknown finish")
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "unknown" } }),
      LLMEvent.finish({ reason: { normalized: "unknown" } }),
    ])
    yield* s.llm.push(TestLLM.text("Recovered", "unknown-finish-success"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  scenario("uses a larger provider retry-after delay", function* (s) {
    yield* s.admit("Retry rate limit")
    yield* s.llm.push(Stream.fail(rateLimited(5_000)))
    yield* s.llm.push(TestLLM.text("Recovered", "retry-after-success"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("4999 millis")
    expect(s.requests).toHaveLength(1)
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(run)
    expect(s.requests).toHaveLength(2)
  })

  scenario("caps an excessive provider retry-after delay at fifteen minutes", function* (s) {
    yield* s.admit("Retry capped rate limit")
    yield* s.llm.push(Stream.fail(rateLimited(3_600_000)))
    yield* s.llm.push(TestLLM.text("Recovered", "retry-cap-success"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("899999 millis")
    expect(s.requests).toHaveLength(1)
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(run)
    expect(s.requests).toHaveLength(2)
  })

  scenario("continues an incomplete stream after observable text", function* (s) {
    const failure = incompleteStream()
    const input = yield* s.admit("Continue partial output")
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "partial-rate-limit" }),
        LLMEvent.textDelta({ id: "partial-rate-limit", text: "Partial" }),
      ),
    )
    yield* s.llm.push(TestLLM.text(" continuation", "continued-text"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(s.requests[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial" }],
    })
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: INCOMPLETE_STREAM_CONTINUATION,
        },
      ],
    })
    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Continue partial output"),
      Expected.assistant({ finish: "error", error: { type: "provider.invalid-output" } }, [Expected.text("Partial")]),
      {
        type: "synthetic",
        text: INCOMPLETE_STREAM_CONTINUATION,
      },
      Expected.assistant({ finish: "stop" }, [Expected.text(" continuation")]),
    ])
    const assistants = context.filter((message) => message.type === "assistant")
    expect(new Set(assistants.map((message) => message.id)).size).toBe(2)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({
      status: "completed",
      assistant: { id: assistants[1]?.id, content: [Expected.text(" continuation")] },
    })
    expect(context.find((message) => message.type === "synthetic")?.description).toBeUndefined()
    expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
    yield* replaySessionProjection(sessionID)
    expect(yield* s.context).toMatchObject(context)
    expect(yield* SessionInputResult.read(s.db, { sessionID, inputID: input.id })).toMatchObject({
      status: "completed",
      assistant: { id: assistants[1]?.id },
    })
  })

  scenario("continues an unknown finish after observable text", function* (s) {
    yield* s.admit("Continue unknown finish")
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "unknown-partial" }),
      LLMEvent.textDelta({ id: "unknown-partial", text: "Partial" }),
      LLMEvent.textEnd({ id: "unknown-partial" }),
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "unknown" } }),
      LLMEvent.finish({ reason: { normalized: "unknown" } }),
    ])
    yield* s.llm.push(TestLLM.text(" continuation", "unknown-continuation"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }],
    })
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({ finish: "error" }, [Expected.text("Partial")]),
      { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
      Expected.assistant({ finish: "stop" }, [Expected.text(" continuation")]),
    ])
  })

  scenario("continues after a mid-stream rate limit honoring retry-after", function* (s) {
    yield* s.admit("Continue after rate limit")
    yield* s.llm.push(
      TestLLM.failAfter(
        rateLimited(5_000),
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "rate-limited-partial" }),
        LLMEvent.textDelta({ id: "rate-limited-partial", text: "Partial" }),
      ),
    )
    yield* s.llm.push(TestLLM.text(" continuation", "rate-limit-continuation"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("4999 millis")
    expect(s.requests).toHaveLength(1)
    yield* TestClock.adjust("1 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(s.requests[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial" }],
    })
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }],
    })
    expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
    expect(yield* s.context).toMatchObject([
      Expected.user("Continue after rate limit"),
      Expected.assistant({ finish: "error", error: { type: "provider.rate-limit" } }, [Expected.text("Partial")]),
      { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
      Expected.assistant({ finish: "stop" }, [Expected.text(" continuation")]),
    ])
  })

  scenario("continues after an unrecognized mid-stream provider failure", function* (s) {
    const failure = new AIError({ reason: new UnknownProviderError({ message: "Provider returned error" }) })
    yield* s.admit("Continue after unknown failure")
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "unknown-failure-partial" }),
        LLMEvent.textDelta({ id: "unknown-failure-partial", text: "Partial" }),
      ),
    )
    yield* s.llm.push(TestLLM.text(" continuation", "unknown-failure-continuation"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }],
    })
    expect(yield* s.context).toMatchObject([
      Expected.user("Continue after unknown failure"),
      Expected.assistant({ finish: "error", error: { type: "provider.unknown" } }, [Expected.text("Partial")]),
      { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
      Expected.assistant({ finish: "stop" }, [Expected.text(" continuation")]),
    ])
  })

  scenario("lowers interrupted reasoning before continuing an incomplete stream", function* (s) {
    yield* s.admit("Continue interrupted reasoning")
    yield* s.llm.push(
      TestLLM.failAfter(
        incompleteStream(),
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "partial-reasoning" }),
        LLMEvent.reasoningDelta({ id: "partial-reasoning", text: "Partial thought" }),
      ),
    )
    yield* s.llm.push(TestLLM.text("Recovered", "reasoning-recovery"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial thought" }],
    })
    expect(s.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: INCOMPLETE_STREAM_CONTINUATION,
        },
      ],
    })
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({ finish: "error" }, [Expected.reasoning("Partial thought")]),
      { type: "synthetic" },
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  for (const failure of [streamDisconnected, websocketDisconnected]) {
    scenario(`continues after ${failure.name} with durable reasoning state`, function* (s) {
      yield* s.admit("Recover disconnected reasoning")
      yield* s.llm.push(
        TestLLM.failAfter(
          failure(),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.reasoningStart({
            id: "disconnected-reasoning",
            providerMetadata: {
              openai: { itemId: "rs_disconnected", reasoningEncryptedContent: "encrypted-state" },
            },
          }),
        ),
      )
      yield* s.llm.push(TestLLM.text("Recovered", "reasoning-transport-recovery"))

      const scheduled = yield* subscribeRetries(s)
      const run = yield* s.resume.pipe(Effect.forkChild)
      yield* Queue.take(scheduled)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(s.requests).toHaveLength(2)
      expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
      expect(s.requests[1]?.messages.slice(-2)).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Recover disconnected reasoning" }] },
        { role: "user", content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }] },
      ])
      expect(yield* s.context).toMatchObject([
        { type: "user" },
        Expected.assistant({ finish: "error" }, [
          {
            type: "reasoning",
            text: "",
            state: { itemId: "rs_disconnected", reasoningEncryptedContent: "encrypted-state" },
          },
        ]),
        { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
        Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
      ])
    })
  }

  scenario("continues an incomplete stream after settling a local tool", function* (s) {
    yield* s.admit("Continue after tool")
    yield* s.llm.push(
      TestLLM.failAfter(
        incompleteStream(),
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-close", name: "echo", input: { text: "settled" } }),
      ),
    )
    yield* s.llm.push(TestLLM.text("Recovered", "tool-recovery"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.executions).toEqual(["settled"])
    expect(s.requests[1]?.messages.slice(-3)).toMatchObject([
      {
        role: "assistant",
        content: [{ type: "tool-call", id: "call-before-close", name: "echo", input: { text: "settled" } }],
      },
      { role: "tool", content: [{ type: "tool-result", id: "call-before-close" }] },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: INCOMPLETE_STREAM_CONTINUATION,
          },
        ],
      },
    ])
  })

  scenario("continues an incomplete stream after settling a local tool defect", function* (s) {
    yield* s.admit("Continue after tool defect")
    yield* s.llm.push(
      TestLLM.failAfter(
        incompleteStream(),
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-defect-before-close", name: "defect", input: {} }),
      ),
    )
    yield* s.llm.push(TestLLM.text("Recovered", "tool-defect-recovery"))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(messageRoles(s.requests[1])).toEqual(["user", "assistant", "tool", "user"])
    expect(yield* s.context).toMatchObject([
      { type: "user" },
      Expected.assistant({}, [
        Expected.failedTool(
          { id: "call-defect-before-close" },
          { error: { type: "unknown", message: "unexpected tool defect" } },
        ),
      ]),
      { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
      Expected.assistant({ finish: "stop" }, [Expected.text("Recovered")]),
    ])
  })

  scenario(
    "shares retry accounting and assistant identity across transparent retries and partial continuations",
    function* (s) {
      const scheduled = yield* subscribeRetries(s)
      yield* s.admit("Mix retry paths")
      const failure = incompleteStream()
      const partial = TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "mixed-partial" }),
        LLMEvent.textDelta({ id: "mixed-partial", text: "Partial" }),
      )
      // Alternate transparent failures and partial continuations until the retry allowance is spent.
      const outcomes = RETRY_GAPS.map((_, index) => (index % 2 === 0 ? Stream.fail(failure) : partial))
      yield* s.llm.push(...outcomes, partial)
      const run = yield* s.resume.pipe(Effect.forkChild)
      const identities: SessionMessage.ID[] = []
      for (const delay of RETRY_GAPS_MAX) {
        identities.push(yield* Queue.take(scheduled))
        yield* TestClock.adjust(delay)
      }
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
      expect(s.requests).toHaveLength(RETRY_GAPS.length + 1)
      // A transparent retry keeps the assistant identity; a partial continuation starts a new one.
      for (const [index, identity] of identities.entries()) {
        if (index === 0) continue
        if (index % 2 === 1) expect(identity).toBe(identities[index - 1])
        else expect(identity).not.toBe(identities[index - 1])
      }
      const partials = outcomes.filter((outcome) => outcome === partial).length
      const messages = yield* s.context
      expect(messages.filter((message) => message.type === "assistant")).toHaveLength(partials + 1)
      expect(messages.filter((message) => message.type === "synthetic")).toHaveLength(partials)
      const events = yield* recordedEventTypes(sessionID)
      expect(events.filter((type) => type === "session.retry.scheduled.1")).toHaveLength(RETRY_GAPS.length)
      expect(events.filter((type) => type === "session.step.failed.1")).toHaveLength(partials + 1)
    },
  )

  scenario("stops incomplete stream continuations once the retry allowance is spent", function* (s) {
    yield* s.admit("Exhaust partial continuations")
    const failure = incompleteStream()
    yield* s.llm.always(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "partial-exhaustion" }),
        LLMEvent.textDelta({ id: "partial-exhaustion", text: "Partial" }),
      ),
    )

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    for (const delay of RETRY_GAPS_MAX) {
      yield* Queue.take(scheduled)
      yield* TestClock.adjust(delay)
    }
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
    expect(s.requests).toHaveLength(RETRY_GAPS.length + 1)
    const context = yield* s.context
    expect(context.filter((message) => message.type === "assistant")).toHaveLength(RETRY_GAPS.length + 1)
    expect(context.filter((message) => message.type === "synthetic")).toHaveLength(RETRY_GAPS.length)
  })

  scenario("stops once the retry allowance is spent", function* (s) {
    yield* s.admit("Exhaust retries")
    const failure = providerUnavailable()
    yield* s.llm.always(Stream.fail(failure))

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    for (const delay of RETRY_GAPS_MAX) {
      yield* Queue.take(scheduled)
      yield* TestClock.adjust(delay)
    }
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
    expect(s.requests).toHaveLength(RETRY_GAPS.length + 1)

    const retries = yield* s.db
      .select({ data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.type, "session.retry.scheduled.1"))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)
    // Each scheduled time falls within the jittered cumulative window for that retry.
    expect(retries).toHaveLength(RETRY_GAPS.length)
    let elapsed = 0
    for (const [index, gap] of RETRY_GAPS.entries()) {
      elapsed += gap
      expect(retries[index]?.data.at).toBeGreaterThanOrEqual(elapsed * 0.8)
      expect(retries[index]?.data.at).toBeLessThanOrEqual(elapsed * 1.2)
    }
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.step.started.1")).toHaveLength(
      1,
    )
    const assistant = requireAssistant(yield* s.context)
    expect(yield* recordedStepSettlementEvents(sessionID, assistant.id)).toMatchObject([
      { type: "session.step.started.1" },
      { type: "session.step.failed.1" },
    ])
    expect(assistant.attempts).toHaveLength(RETRY_GAPS.length + 1)
    expect(assistant.attempts?.map((attempt) => attempt.ordinal)).toEqual(Array.from({ length: RETRY_GAPS.length + 1 }, (_, ordinal) => ordinal))
    expect(assistant.attempts?.every((attempt) => attempt.terminal?.status === "failed")).toBe(true)
  })

  scenario("retries a model call without consuming the logical agent step", function* (s) {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.steps = 2
      }),
    )
    yield* s.admit("Retry without consuming a step")
    const failure = providerUnavailable()
    yield* s.llm.push(Stream.fail(failure))
    yield* s.llm.push(TestLLM.tool("call-after-retry", "echo", { text: "recovered" }), TestLLM.stop())

    const scheduled = yield* subscribeRetries(s)
    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Queue.take(scheduled)
    yield* TestClock.adjust("2400 millis")
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(3)
    expect(s.requests[0]?.toolChoice).toBeUndefined()
    expect(s.requests[0]?.tools.map((tool) => tool.name)).toContain("echo")
    expect(s.requests[1]?.toolChoice).toBeUndefined()
    expect(s.requests[1]?.tools.map((tool) => tool.name)).toContain("echo")
    expect(s.requests[1]?.messages.at(-1)).not.toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
    })
    expect(s.requests[2]?.toolChoice).toMatchObject({ type: "none" })
    // The final step keeps tool definitions to preserve provider prompt caching.
    expect(s.requests[2]?.tools.map((tool) => tool.name)).toContain("echo")
    expect(s.requests[2]?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
    })
    expect(s.executions).toEqual(["recovered"])
    const eventTypes = yield* recordedEventTypes(sessionID)
    expect(eventTypes.filter((type) => type === "session.step.started.1")).toHaveLength(2)
    expect(eventTypes.filter((type) => type === "session.attempt.started.1")).toHaveLength(3)
    expect(eventTypes.filter((type) => type === "session.retry.scheduled.1")).toHaveLength(1)
    expect((yield* s.context).filter((message) => message.type === "assistant")).toHaveLength(2)
  })

  scenario("does not retry non-eligible provider failures", function* (s) {
    const failure = invalidRequest()
    yield* s.llm.push(Stream.fail(failure))

    expect(yield* s.runPrompt("Do not retry").pipe(Effect.flip)).toBe(failure)
    expect(s.requests).toHaveLength(1)
    expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
  })

  scenario("settles malformed streamed tool input before the provider failure", function* (s) {
    const failure = new AIError({
      reason: new InvalidProviderOutputError({ message: "Invalid JSON input for tool call echo" }),
    })
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-malformed", name: "echo" }),
        LLMEvent.toolInputDelta({ id: "call-malformed", name: "echo", text: '{"text":"partial' }),
      ),
    )

    expect(yield* s.runPrompt("Call a malformed tool").pipe(Effect.flip)).toBe(failure)
    const assistant = requireAssistant(yield* s.context)

    yield* s.llm.push(TestLLM.stop())
    yield* s.runPrompt("Continue")

    expect(yield* recordedStepSettlementEvents(sessionID, assistant.id)).toMatchObject([
      { type: "session.step.started.1" },
      {
        type: "session.tool.failed.2",
        data: {
          id: "call-malformed",
          error: { type: "provider.invalid-output", message: "Invalid JSON input for tool call echo" },
        },
      },
      {
        type: "session.step.failed.1",
        data: { error: { type: "provider.invalid-output", message: "Invalid JSON input for tool call echo" } },
      },
    ])
  })

  scenario("settles unfinished tool input after an output limit", function* (s) {
    yield* s.llm.push(
      TestLLM.complete(
        { reason: { normalized: "length" } },
        LLMEvent.toolInputStart({ id: "call-incomplete", name: "echo" }),
        LLMEvent.toolInputDelta({ id: "call-incomplete", name: "echo", text: '{"text":"partial' }),
      ),
      TestLLM.stop(),
    )

    yield* s.runPrompt("Recover unfinished tool input")

    expect(s.requests).toHaveLength(2)
    expect(s.executions).toEqual([])
    expect(requireAssistant(yield* s.context).content).toMatchObject([
      {
        type: "tool",
        id: "call-incomplete",
        executed: false,
        state: { status: "error", error: { type: "tool.input-incomplete" } },
      },
    ])
  })

  scenario("continues after malformed local tool input without exposing raw arguments", function* (s) {
    const marker = "raw-malformed-marker"
    const raw = `{"text":"${marker}`
    yield* s.llm.push(
      TestLLM.toolCalls(
        LLMEvent.toolInputStart({ id: "call-malformed", name: "echo" }),
        LLMEvent.toolInputDelta({ id: "call-malformed", name: "echo", text: raw }),
        LLMEvent.toolInputEnd({ id: "call-malformed", name: "echo" }),
        LLMEvent.toolInputError({
          id: "call-malformed",
          name: "echo",
          raw,
        }),
      ),
      TestLLM.stop(),
    )

    yield* s.runPrompt("Recover malformed tool input")

    expect(s.requests).toHaveLength(2)
    expect(s.executions).toEqual([])
    expect(JSON.stringify(s.requests[1])).not.toContain(marker)
    expect(s.requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "tool-call", id: "call-malformed", name: "echo", input: {} }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-result",
              id: "call-malformed",
              result: expect.objectContaining({
                type: "error",
                value: expect.objectContaining({
                  error: expect.objectContaining({
                    message: "Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.",
                  }),
                }),
              }),
            }),
          ]),
        }),
      ]),
    )
    const context = yield* s.context
    const failed = context.find(
      (message): message is SessionMessage.Assistant =>
        message.type === "assistant" && message.content.some((item) => item.type === "tool"),
    )
    expect(failed).toMatchObject({
      content: [
        Expected.failedTool(
          { id: "call-malformed", executed: false },
          {
            input: {},
            error: {
              type: "tool.input-json",
              message: "Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.",
            },
          },
        ),
      ],
    })
    if (!failed) throw new Error("Malformed tool assistant missing")
    expect(failed.error).toBeUndefined()
    expect(yield* recordedStepSettlementTypes(sessionID, failed.id)).toEqual([
      "session.step.started.1",
      "session.tool.failed.2",
      "session.step.ended.1",
    ])

    const durable = yield* s.db
      .select({ type: EventTable.type, data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    expect(durable.find((event) => event.type === "session.tool.input.ended.1")?.data).toMatchObject({
      id: "call-malformed",
      text: raw,
    })
  })

  scenario("settles a valid sibling before recovering malformed tool input", function* (s) {
    yield* s.admit("Run parallel tools")
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      TestLLM.toolCalls(
        LLMEvent.toolCall({ id: "call-valid", name: "echo", input: { text: "valid" } }),
        LLMEvent.toolInputError({
          id: "call-malformed",
          name: "echo",
          raw: '{"text":"partial',
        }),
      ),
      TestLLM.stop(),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    expect(s.requests).toHaveLength(1)
    yield* tools.release
    yield* Fiber.join(run)

    expect(s.requests).toHaveLength(2)
    expect(s.executions).toEqual(["valid"])
    const request = s.requests[1]
    if (!request) throw new Error("Malformed recovery request missing")
    expect(request.messages.flatMap((message) => (message.role === "tool" ? message.content : []))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "call-valid", type: "tool-result" }),
        expect.objectContaining({ id: "call-malformed", type: "tool-result" }),
      ]),
    )
  })

  scenario("does not recover malformed input after sibling execution is interrupted", function* (s) {
    yield* s.admit("Interrupt malformed recovery")
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      TestLLM.toolCalls(
        LLMEvent.toolCall({ id: "call-valid", name: "echo", input: { text: "blocked" } }),
        LLMEvent.toolInputError({
          id: "call-malformed",
          name: "echo",
          raw: '{"text":"partial',
        }),
      ),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    while (
      !(yield* s.context).some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((item) => item.type === "tool" && item.id === "call-malformed"),
      )
    )
      yield* Effect.yieldNow
    yield* s.session.interrupt(sessionID)

    expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
    expect(s.requests).toHaveLength(1)
    expect(yield* s.context).toMatchObject([
      Expected.user("Interrupt malformed recovery"),
      Expected.assistant({ error: { type: "aborted", message: "Step interrupted" } }, [
        Expected.failedTool({ id: "call-valid" }, { error: { type: "aborted" } }),
        Expected.failedTool({ id: "call-malformed" }, {}),
      ]),
    ])
  })

  scenario("records malformed provider-executed input as executed", function* (s) {
    const failure = new AIError({
      reason: new InvalidProviderOutputError({ message: "Invalid hosted tool input" }),
    })
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-hosted", name: "web_search", providerExecuted: true }),
        LLMEvent.toolInputDelta({ id: "call-hosted", name: "web_search", text: '{"query":"partial' }),
      ),
    )

    expect(yield* s.runPrompt("Fail malformed hosted input").pipe(Effect.flip)).toBe(failure)
    expect(requireAssistant(yield* s.context)).toMatchObject({
      error: { type: "provider.invalid-output", message: "Invalid hosted tool input" },
      content: [
        Expected.failedTool({ id: "call-hosted", executed: true }, { error: { type: "provider.invalid-output" } }),
      ],
    })
  })

  scenario("records a provider failure after malformed input", function* (s) {
    const failure = new AIError({
      reason: new InvalidProviderOutputError({ message: "Provider failed after malformed input" }),
    })
    yield* s.llm.push(
      TestLLM.failAfter(
        failure,
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputError({
          id: "call-malformed",
          name: "echo",
          raw: '{"text":"partial',
        }),
      ),
    )

    expect(yield* s.runPrompt("Fail after malformed input").pipe(Effect.flip)).toBe(failure)
    expect(requireAssistant(yield* s.context)).toMatchObject({
      error: { type: "provider.invalid-output", message: "Provider failed after malformed input" },
      content: [Expected.failedTool({ id: "call-malformed", executed: false }, { error: { type: "tool.input-json" } })],
    })
    expect(s.requests).toHaveLength(1)
  })

  scenario("continues after repeated malformed tool input", function* (s) {
    const malformed = (id: string) =>
      TestLLM.toolCalls(
        LLMEvent.toolInputError({
          id,
          name: "echo",
          raw: '{"text":"partial',
        }),
      )
    yield* s.llm.push(
      malformed("call-first"),
      TestLLM.tool("call-valid-between", "echo", { text: "valid" }),
      malformed("call-second"),
      TestLLM.stop(),
    )

    yield* s.runPrompt("Keep producing malformed tools")

    expect(s.requests).toHaveLength(4)
    expect(s.executions).toEqual(["valid"])
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.step.failed.1")).toHaveLength(0)
  })

  scenario("does not continue malformed tool input past the agent step limit", function* (s) {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("build"), (agent) => {
        agent.steps = 2
      }),
    )
    const malformed = (id: string) =>
      TestLLM.toolCalls(
        LLMEvent.toolInputError({
          id,
          name: "echo",
          raw: '{"text":"partial',
        }),
      )
    yield* s.llm.push(malformed("call-first"), malformed("call-at-limit"))

    yield* s.runPrompt("Stop malformed tools at the step limit")

    expect(s.requests).toHaveLength(2)
    expect(s.requests[0]?.toolChoice).toBeUndefined()
    expect(s.requests[1]?.toolChoice).toMatchObject({ type: "none" })
    expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.tool.failed.2")).toHaveLength(2)
  })

  scenario("does not continue automatically after a provider error follows a local tool call", function* (s) {
    yield* s.admit("Do not continue failed provider")
    const tools = yield* s.blockTools()
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.toolCall({ id: "call-before-provider-error", name: "echo", input: { text: "settled" } }),
      LLMEvent.providerError({ message: "Provider unavailable" }),
    ])

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* tools.started
    yield* tools.release
    expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider unavailable")

    expect(s.requests).toHaveLength(1)
    expect(s.executions).toEqual(["settled"])
    const context = yield* s.context
    const assistant = requireAssistant(context)
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.step.failed.1",
    ])
  })

  scenario("durably fails a hosted tool when its provider errors before returning a result", function* (s) {
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      hostedCall("call-hosted-provider-error", "effect"),
      LLMEvent.providerError({ message: "Provider unavailable" }),
    ])

    expect((yield* s.runPrompt("Fail hosted tool durably").pipe(Effect.flip)).message).toBe("Provider unavailable")

    expect(s.requests).toHaveLength(1)
    const context = yield* s.context
    expect(context).toMatchObject([
      Expected.user("Fail hosted tool durably"),
      Expected.assistant({}, [Expected.failedTool({ id: "call-hosted-provider-error" }, {})]),
    ])
    const assistant = requireAssistant(context)
    expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.failed.1",
    ])
  })

  scenario("preserves a tool defect before provider failure settlement", function* (s) {
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.toolCall({ id: "call-defect-provider-error", name: "defect", input: {} }),
      LLMEvent.providerError({ message: "Provider unavailable" }),
    ])

    expect((yield* s.runPrompt("Defect while provider fails").pipe(Effect.flip)).message).toBe("Provider unavailable")

    const context = yield* s.context
    const assistant = requireAssistant(context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => event.type)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.failed.1",
    ])
    expect(events[2]?.data.error).toMatchObject({ type: "unknown", message: "unexpected tool defect" })
  })

  scenario("preserves the provider failure when tool output persistence also fails", function* (s) {
    let injected = false
    yield* s.bus.project(SessionEvent.Tool.Success, (event) => {
      if (event.data.id !== "call-store-provider-error") return Effect.void
      return Effect.sync(() => {
        injected = true
      }).pipe(Effect.andThen(Effect.die("tool output persistence failed")))
    })
    yield* s.admit("Storage fails while provider fails")
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.toolCall({ id: "call-store-provider-error", name: "storefail", input: {} }),
      LLMEvent.providerError({ message: "Provider unavailable" }),
    ])

    expect(yield* s.resume.pipe(Effect.exit)).toMatchObject({
      _tag: "Failure",
    })

    expect(injected).toBe(true)
    expect(requireAssistant(yield* s.context)).toMatchObject({
      error: { type: "provider.unknown", message: "Provider unavailable" },
    })
  })

  scenario("durably fails a hosted tool left unresolved at normal provider EOF", function* (s) {
    yield* s.llm.push([LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-eof", "effect")])

    expect((yield* s.runPrompt("Fail hosted tool at EOF").pipe(Effect.flip)).message).toBe(
      "Provider did not return a tool result",
    )
    const assistant = requireAssistant(yield* s.context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => event.type)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.failed.1",
    ])
    expect(
      events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
    ).toHaveLength(1)
    yield* replaySessionProjection(sessionID)

    expect(yield* s.context).toMatchObject([
      Expected.user("Fail hosted tool at EOF"),
      Expected.assistant({ finish: "error", error: { type: "tool.result-missing" } }, [
        Expected.failedTool({ id: "call-hosted-eof" }, {}),
      ]),
    ])
  })

  scenario("fails an unresolved hosted tool before one clean step end", function* (s) {
    yield* s.llm.push(TestLLM.stop(hostedCall("call-hosted-clean-end", "effect")))

    yield* s.runPrompt("Settle hosted tool before ending")

    const assistant = requireAssistant(yield* s.context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => event.type)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.ended.1",
    ])
    expect(
      events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
    ).toHaveLength(1)
  })

  scenario("settles unresolved local and hosted tools before one raw provider failure", function* (s) {
    yield* s.admit("Fail unresolved tools")
    const failure = invalidRequest()
    const providerFailed = yield* Deferred.make<void>()
    const tools = yield* s.blockTools()
    yield* s.llm.push(
      Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-local-raw-failure", name: "defect", input: {} }),
          hostedCall("call-hosted-raw-failure-pair", "effect"),
        ]),
        Stream.fromEffect(Deferred.succeed(providerFailed, undefined)).pipe(Stream.flatMap(() => Stream.fail(failure))),
      ),
    )

    const run = yield* s.resume.pipe(Effect.forkChild)
    yield* Deferred.await(providerFailed)
    yield* tools.release
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)

    const assistant = requireAssistant(yield* s.context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => ({ type: event.type, id: event.data.id }))).toEqual([
      { type: "session.step.started.1", id: undefined },
      { type: "session.tool.called.1", id: "call-local-raw-failure" },
      { type: "session.tool.called.1", id: "call-hosted-raw-failure-pair" },
      { type: "session.tool.failed.2", id: "call-local-raw-failure" },
      { type: "session.tool.failed.2", id: "call-hosted-raw-failure-pair" },
      { type: "session.step.failed.1", id: undefined },
    ])
    expect(
      events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
    ).toHaveLength(1)
  })

  scenario("durably fails a hosted tool left unresolved by a raw provider stream failure", function* (s) {
    // Non-retryable so the step settles terminally instead of continuing after tool output.
    const failure = invalidRequest()
    yield* s.llm.push(
      Stream.concat(
        Stream.fromIterable([LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-raw-failure", "effect")]),
        Stream.fail(failure),
      ),
    )

    expect(yield* s.runPrompt("Fail hosted tool on raw failure").pipe(Effect.flip)).toBe(failure)
    expect(s.requests).toHaveLength(1)
    const assistant = requireAssistant(yield* s.context)
    const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
    expect(events.map((event) => event.type)).toEqual([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.failed.2",
      "session.step.failed.1",
    ])
    expect(
      events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
    ).toHaveLength(1)
    yield* replaySessionProjection(sessionID)
    expect(yield* s.context).toMatchObject([
      Expected.user("Fail hosted tool on raw failure"),
      Expected.assistant({ finish: "error", error: { type: "provider.invalid-request", message: "Invalid request" } }, [
        Expected.failedTool({ id: "call-hosted-raw-failure" }, {}),
      ]),
    ])
  })

  scenario("rejects a second text start before the open fragment ends", function* (s) {
    yield* s.llm.push([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "text-1" }),
      LLMEvent.textStart({ id: "text-2" }),
    ])

    const defect = yield* s.runPrompt("Two blocks").pipe(Effect.catchDefect(Effect.succeed))
    expect(defect).toBeInstanceOf(Error)
    if (!(defect instanceof Error)) return
    expect(defect.message).toBe("text start before end: text-2")
  })

  scenario("projects sequential text fragments as separate content parts", function* (s) {
    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "First" }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.textStart({ id: "text-2" }),
        LLMEvent.textDelta({ id: "text-2", text: "Second" }),
        LLMEvent.textEnd({ id: "text-2" }),
      ),
    )

    yield* s.runPrompt("Two blocks")

    expect(yield* s.context).toMatchObject([
      Expected.user("Two blocks"),
      Expected.assistant({}, [Expected.text("First"), Expected.text("Second")]),
    ])
  })

  scenario("broadcasts pending text while the provider stream is paused", function* (s) {
    const paused = yield* Deferred.make<void>()
    yield* s.admit("Check before running a command")
    yield* s.llm.push(
      Stream.concat(
        Stream.fromIterable([
          LLMEvent.textStart({ id: "text" }),
          LLMEvent.textDelta({ id: "text", text: "Checking the project." }),
        ]),
        Stream.fromEffect(Deferred.succeed(paused, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      ),
    )
    const deltas = yield* s.bus
      .subscribe(SessionEvent.Text.Delta)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
    const running = yield* s.resume.pipe(Effect.forkScoped)
    yield* Deferred.await(paused)
    yield* TestClock.adjust("100 millis")
    expect(deltas.pollUnsafe()).toBeDefined()
    expect(Array.from(yield* Fiber.join(deltas)).map((event) => event.data.delta)).toEqual(["Checking the project."])
    yield* Fiber.interrupt(running)
  })

  for (const kind of fragmentKinds) {
    scenario(
      kind === "tool input"
        ? "does not broadcast provider tool input deltas"
        : `batches provider ${kind} deltas without storing projection rewrites`,
      (s) => verifyEphemeralDeltas(s, kind),
    )

    scenario(`durably closes partial ${kind} when the provider stream fails`, (s) =>
      verifyPartialFlushOnFailure(s, kind),
    )

    scenario(`durably closes partial ${kind} when the provider stream is interrupted`, (s) =>
      verifyPartialFlushOnInterruption(s, kind),
    )
  }

  scenario("rejects duplicate streamed text starts", function* (s) {
    yield* s.llm.push([LLMEvent.textStart({ id: "text-1" }), LLMEvent.textStart({ id: "text-1" })])

    const defect = yield* s.resume.pipe(Effect.catchDefect(Effect.succeed))
    expect(defect).toBeInstanceOf(Error)
    if (!(defect instanceof Error)) return
    expect(defect.message).toBe("Duplicate text start: text-1")
  })

  scenario("transitions streamed raw tool input to parsed called input", function* (s) {
    yield* s.llm.push(
      TestLLM.stop(
        LLMEvent.toolInputStart({ id: "call-parsed", name: "web_search" }),
        LLMEvent.toolInputDelta({ id: "call-parsed", name: "web_search", text: '{"query":"hello"}' }),
        LLMEvent.toolInputEnd({ id: "call-parsed", name: "web_search" }),
        hostedCall("call-parsed", "hello"),
      ),
    )

    yield* s.runPrompt("Call provider tool")

    expect(yield* s.context).toMatchObject([
      Expected.user("Call provider tool"),
      Expected.assistant({}, [Expected.failedTool({ id: "call-parsed" }, { input: { query: "hello" } })]),
    ])
  })

  scenario("rejects malformed streamed tool input ordering", function* (s) {
    yield* s.llm.push([LLMEvent.toolInputDelta({ id: "call-1", name: "read", text: "{}" })])

    const defect = yield* s.resume.pipe(Effect.catchDefect(Effect.succeed))
    expect(defect).toBeInstanceOf(Error)
    if (!(defect instanceof Error)) return
    expect(defect.message).toBe("Tool input delta before start: call-1")
  })
})
