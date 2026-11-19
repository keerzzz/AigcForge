import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import type { SessionHooks } from "@aigcfroge/plugin/effect/session"
import { LanguageModel } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols"
import { TestLLM } from "@aigcfroge/ai/testing"
import path from "path"
import { Money } from "@aigcfroge/schema/money"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { App } from "@aigcfroge/core/app"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { makeGlobalNode, makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Database } from "@aigcfroge/core/database/database"
import { Bus } from "@aigcfroge/core/bus"
import { Config } from "@aigcfroge/core/config"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Location } from "@aigcfroge/core/location"
import { Model } from "@aigcfroge/core/model"
import { ModelGroup } from "@aigcfroge/core/model-group"
import { ModelResolver } from "@aigcfroge/core/model-resolver"
import { Provider } from "@aigcfroge/core/provider"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Agent } from "@aigcfroge/core/agent"
import { Job } from "@aigcfroge/core/job"
import { KV } from "@aigcfroge/core/kv"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRestart } from "@aigcfroge/core/session/execution/restart"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentStepTable } from "@aigcfroge/core/meta-agent/sql"
import { SubagentJob } from "@aigcfroge/core/session/subagent-job"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { PluginSupervisor } from "@aigcfroge/core/plugin/supervisor"
import { Permission } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { SubagentTool } from "@aigcfroge/core/tool/plugin/subagent"
import { Tool } from "@aigcfroge/core/tool"
import { and, eq } from "drizzle-orm"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels, useOfflineCatalog } from "./fixture/models"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { CompositionFixture } from "./lib/composition"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const childText = "child final response"
const completedOutput = (sessionID: Session.ID) =>
  `<subagent sessionID="${sessionID}" state="completed">\n${childText}\n</subagent>`
const childModel = Model.Ref.make({ id: Model.ID.make("child"), providerID: Provider.ID.make("test") })
const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })
const overrideModel = Model.Ref.make({
  id: Model.ID.make("override"),
  providerID: Provider.ID.make("test"),
  variant: Model.VariantID.make("fast"),
})
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const outputSessionID = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID }))(value).sessionID

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const completed = new Set<Session.ID>()
      const complete = Effect.fn("SubagentTest.complete")(function* (sessionID: Session.ID) {
        if (completed.has(sessionID)) return
        if ((yield* store.get(sessionID))?.title?.includes("fail")) {
          yield* new SessionRunnerModel.ModelNotSelectedError({ sessionID })
          return
        }
        completed.add(sessionID)
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: Agent.ID.make("reviewer"),
          model: childModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
        })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
          text: childText,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens,
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: (sessionID) => complete(sessionID).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const subagentPluginSupervisor = makeLocationNode({
  name: "test/subagent-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(
        SubagentTool.Plugin,
        { session: { hook: (name, callback, options) => hooks.register("session", name, callback, options) } },
        (name, callback) => hooks.register("tool", name, callback),
      )
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Model.node,
    ModelResolver.node,
    Plugin.node,
    Permission.node,
    Session.node,
    SessionComposition.node,
    Job.node,
    SubagentJob.node,
    Tool.node,
    PluginHooks.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Project.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionComposition.node,
  SessionExecution.node,
  ApprovalPresence.node,
  LocationServiceMap.node,
])
const replacements = [
  SessionExecution.node.replace(executionNode),
  Global.node.replace(tempGlobalLayer),
  offlineModels,
] satisfies LayerNode.Replacements
const productionIt = testEffect(AppNodeBuilder.build(nodes, replacements))
const it = testEffect(
  AppNodeBuilder.build(nodes, [...replacements, PluginSupervisor.node.replace(subagentPluginSupervisor)]),
)
const ownershipIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, MetaAgentService.node]), [
    ...replacements,
    Bus.node.replace(Bus.configured({ persist: true })),
    PluginSupervisor.node.replace(subagentPluginSupervisor),
  ]),
)
const completionIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, SessionRestart.node, SessionTask.node, KV.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    PluginSupervisor.node.replace(subagentPluginSupervisor),
    LayerNodePlatform.llmClient.replace(TestLLM.testLayer({ fallback: TestLLM.text(childText, "completion") })),
    SessionRunnerModel.node.replace(
      Layer.succeed(SessionRunnerModel.Service, {
        resolve: () =>
          Effect.succeed(
            SessionRunnerModel.resolved(
              LanguageModel.make({ id: "child", provider: "test", route: OpenAIChat.route }),
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

const withSubagent = (location: Location.Ref) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
    yield* Provider.Service.use((providers) =>
      providers.transform((editor) => {
        editor.models.update(overrideModel.providerID, overrideModel.id, (model) => {
          model.variants = [{ id: Model.VariantID.make("fast") }]
        })
        editor.models.update(Provider.ID.make("test"), Model.ID.make("plain"), () => {})
      }),
    ).pipe(Effect.provide(locations.get(location)))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) => {
        // The caller identity used by executeTool; subagent permission asserts against it.
        editor.update(toolIdentity.agent, (agent) => {
          agent.originKind = "builtin"
          agent.mode = "primary"
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
        })
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.originKind = "builtin"
          agent.mode = "subagent"
          agent.model = childModel
        })
        editor.update(Agent.ID.make("fallback"), (agent) => {
          agent.originKind = "builtin"
          agent.mode = "subagent"
        })
        editor.update(Agent.ID.make("primary"), (agent) => {
          agent.originKind = "builtin"
          agent.mode = "primary"
        })
      }),
    ).pipe(Effect.provide(locations.get(location)))
  })

const setupCustom = (effect: "allow" | "deny" = "allow") =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const sessions = yield* Session.Service
    const parent = yield* createLegacySession({
      location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
      model: parentModel,
    })
    yield* withSubagent(parent.location)
    const locations = yield* LocationServiceMap.Service
    const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
    const agents = yield* Agent.Service.pipe(Effect.provide(locations.get(parent.location)))
    const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(parent.location)))
    const hooks = yield* PluginHooks.Service.pipe(Effect.provide(locations.get(parent.location)))
    const compositions = yield* SessionComposition.Service
    const database = yield* Database.Service
    const app = yield* App.Metadata
    const info = Agent.Info.make({
      ...Agent.Info.empty(Agent.ID.make("frozen-reviewer")),
      name: Agent.Name.make("review-alias"),
      description: "Frozen review description",
      mode: "subagent",
      model: childModel,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ],
    })
    yield* CompositionFixture.attach(parent.id, info, {
      orchestrator: Agent.Info.make({
        ...Agent.Info.empty(Agent.ID.make("meta")),
        mode: "primary",
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "subagent", resource: info.id, effect },
        ],
      }),
      tools: CompositionDigest.captureTools(
        (yield* registry.snapshot()).catalog,
        parent.location.directory,
        app.version,
      ),
    })
    // Seed legacy Custom placement without using the asset resolver under test elsewhere.
    yield* database.db
      .update(SessionTable)
      .set({ mode: "custom", agent: "meta" })
      .where(eq(SessionTable.id, parent.id))
      .run()
      .pipe(Effect.orDie)
    return {
      sessions,
      parent: yield* sessions.get(parent.id),
      agents,
      registry,
      permission,
      hooks,
      compositions,
      info,
      execute: (input: Partial<typeof SubagentTool.Input.Type> = {}) =>
        executeTool(registry, {
          sessionID: parent.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          call: {
            type: "tool-call",
            id: "call-custom-subagent",
            name: SubagentTool.name,
            input: { agent: info.name, description: "Frozen review", prompt: "Review this", ...input },
          },
        }),
    }
  })

const hookEvent = (sessionID: Session.ID, agent = Agent.ID.make("meta")): SessionHooks["context"] => ({
  sessionID,
  agent,
  model: parentModel,
  system: [],
  messages: [],
  options: {},
  tools: { [SubagentTool.name]: { description: SubagentTool.description, input: { type: "object" } } },
})

ownershipIt.live(
  "parses a Group override and retains the Custom child's captured behavior when its definition changes",
  () =>
    Effect.gen(function* () {
      const f = yield* setupCustom()
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ location: f.parent.location, custom: true })
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
        if (request.sessionID !== f.parent.id || request.action !== SubagentTool.name) return Effect.void
        expect(request.resources).toEqual([f.info.id])
        return f.permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.orDie)
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const locations = yield* LocationServiceMap.Service
      const config = yield* Config.Service.pipe(Effect.provide(locations.get(f.parent.location)))
      if (!config.provider) return yield* Effect.die(new Error("Subagent Group configuration is missing"))
      const target = (yield* config.provider.list()).targets.find(
        (target) => target.scope === "project" && target.preferred,
      )
      if (!target) return yield* Effect.die(new Error("Subagent Group target is missing"))
      const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("review") })
      const input = {
        groupID: group.groupID,
        target: { scope: target.scope, path: target.path },
        expectedDigest: target.digest,
        patch: { set: { name: "Review", enabled: true, members: [childModel], strategy: "order", affinity: "turn" } },
      }
      const saved = yield* ModelGroup.save(ModelGroup.decodeSave(input)).pipe(
        Effect.provideService(Config.Service, config),
      )
      expect(saved.definition.status).toBe("saved")
      const original = yield* ModelGroup.behavior(group.groupID).pipe(Effect.provideService(Config.Service, config))
      const response = yield* f.execute({ model: "group:review" })
      expect(response).toMatchObject({ status: "completed" })
      const childID = outputSessionID(response.output)
      const child = yield* f.sessions.get(childID)
      expect(child.model).toEqual(group)
      const snapshot = yield* f.compositions.get(childID)
      if (snapshot.version !== 2) return yield* Effect.die(new Error("Subagent Group snapshot is not V2"))
      expect(SessionComposition.groupBehaviorFor(snapshot, f.info.id)).toEqual(original)
      const edited = yield* ModelGroup.save(
        ModelGroup.decodeSave({
          ...input,
          expectedDigest: saved.definition.target?.digest,
          patch: { set: { members: [parentModel] } },
        }),
      ).pipe(Effect.provideService(Config.Service, config))
      expect(edited.definition.status).toBe("saved")
      expect((yield* f.execute({ sessionID: childID, background: true })).status).toBe("completed")
      expect((yield* f.sessions.get(childID)).model).toEqual(group)
      expect(yield* f.compositions.get(childID)).toEqual(snapshot)
      const next = yield* f.execute({ model: "group:review" })
      expect(next.status).toBe("completed")
      const nextSnapshot = yield* f.compositions.get(outputSessionID(next.output))
      if (nextSnapshot.version !== 2) return yield* Effect.die(new Error("New subagent Group snapshot is not V2"))
      expect(SessionComposition.groupBehaviorFor(nextSnapshot, f.info.id)?.members).toEqual([parentModel])
      return undefined
    }),
)

describe("SubagentTool", () => {
  it.live("rejects user-defined Coding targets without creating a child", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const parent = yield* createLegacySession({
            location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
            agent: toolIdentity.agent,
            model: parentModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const local = locations.get(parent.location)
          const agents = yield* Agent.Service.pipe(Effect.provide(local))
          const target = Agent.ID.make("user-reviewer")
          yield* agents.transform((editor) =>
            editor.update(target, (agent) => {
              agent.mode = "subagent"
              agent.model = childModel
            }),
          )
          expect((yield* agents.get(target))?.originKind).toBe("user")
          const sessions = yield* Session.Service
          const before = yield* sessions.list()
          const registry = yield* Tool.Service.pipe(Effect.provide(local))
          const response = yield* executeTool(registry, {
            sessionID: parent.id,
            agent: toolIdentity.agent,
            messageID: toolIdentity.messageID,
            call: {
              type: "tool-call",
              id: "call-user-mode",
              name: SubagentTool.name,
              input: { agent: target, description: "User target", prompt: "Review" },
            },
          })
          expect(response).toMatchObject({
            status: "error",
            error: {
              message: `Agent "${target}" is not allowed in mode "coding": User-defined agents require an adopted Custom composition`,
            },
          })
          expect(yield* sessions.list()).toEqual(before)
        }),
      ),
    ),
  )
  it.live("omits an unattended ask target from all catalog hooks before the registered executor rejects it", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ mode: "coding", attended: 0 })
        .where(eq(SessionTable.id, seed.parent.id))
        .run()
      yield* seed.agents.transform((editor) => {
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.originKind = "builtin"
          agent.permissions = [
            { action: "*", resource: "*", effect: "deny" },
            { action: "subagent", resource: "reviewer", effect: "ask" },
          ]
        })
      })
      expect((yield* seed.sessions.get(seed.parent.id)).attended).toBe(false)
      expect(
        Permission.evaluate(
          "subagent",
          "reviewer",
          yield* seed.permission.effectiveRules(seed.parent.id, Agent.ID.make("meta")),
        ).effect,
      ).toBe("deny")
      const before = yield* seed.sessions.list()
      const inbox = yield* seed.sessions.inbox(seed.parent.id)
      const result = yield* executeTool(seed.registry, {
        sessionID: seed.parent.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: {
          type: "tool-call",
          id: "call-unattended-directory",
          name: SubagentTool.name,
          input: { agent: "reviewer", description: "Denied review", prompt: "Review this" },
        },
      })
      expect(result).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Permission denied: subagent" },
      })
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(inbox)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
      yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
        Effect.gen(function* () {
          const event = yield* seed.hooks.trigger("session", name, hookEvent(seed.parent.id))
          expect(event.tools[SubagentTool.name]?.description).toBe(SubagentTool.description)
        }),
      )
    }),
  )
  ;["build", "meta"].forEach((actor) => {
    ownershipIt.live(`keeps captured ${actor} Subagent ownership across a later Started and Agent change`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const sessions = yield* Session.Service
        const parent = yield* createLegacySession({
          location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
          agent: Agent.ID.make("build"),
          model: parentModel,
        })
        yield* withSubagent(parent.location)
        const locations = yield* LocationServiceMap.Service
        const local = locations.get(parent.location)
        yield* useOfflineCatalog([
          {
            info: Provider.Info.make({
              ...Provider.Info.empty(parentModel.providerID),
              activation: "enabled",
              package: "@aigcfroge/ai/providers/openai/responses",
            }),
            models: [parentModel, childModel].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
          },
        ]).pipe(Effect.provide(local))
        const agents = yield* Agent.Service.pipe(Effect.provide(local))
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make(actor), (agent) => {
            agent.originKind = "builtin"
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: "subagent", resource: "reviewer", effect: "ask" },
            ]
          }),
        )
        if (actor === "meta")
          yield* sessions.switchAgent({ sessionID: parent.id, agent: Agent.ID.make("meta"), model: parentModel })
        const before = yield* sessions.get(parent.id)
        const bus = yield* Bus.Service
        const input = { agent: "reviewer", description: "captured review", prompt: "Review this" }
        const source = {
          sessionID: parent.id,
          assistantMessageID: toolIdentity.messageID,
          id: "call-captured-subagent",
        }
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: parent.id,
          assistantMessageID: toolIdentity.messageID,
          agent: Agent.ID.make(actor),
          model: parentModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: "subagent" })
        yield* bus.publish(SessionEvent.Tool.Called, { ...source, input, executed: false })
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const permission = yield* Permission.Service.pipe(Effect.provide(local))
        const registry = yield* Tool.Service.pipe(Effect.provide(local))
        const asked = yield* Deferred.make<Permission.Request>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const fiber = yield* executeTool(registry, {
          sessionID: parent.id,
          agent: Agent.ID.make(actor),
          messageID: toolIdentity.messageID,
          call: { type: "tool-call", id: source.id, name: "subagent", input },
        }).pipe(Effect.forkIn(yield* Effect.scope))
        const request = yield* awaitWithTimeout(Deferred.await(asked), "Captured Subagent did not request permission")
        const next = Agent.ID.make(actor === "build" ? "meta" : "build")
        yield* sessions.switchAgent({ sessionID: parent.id, agent: next, model: parentModel })
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: parent.id,
          assistantMessageID: toolIdentity.messageID,
          agent: next,
          model: parentModel,
          started: 0,
        })
        yield* permission.reply({ requestID: request.id, reply: "once" })
        const response = yield* awaitWithTimeout(Fiber.join(fiber), "Captured Subagent did not settle")
        expect(response).toMatchObject({ status: "completed" })
        const child = yield* sessions.get(outputSessionID(response.metadata))
        yield* bus.publish(SessionEvent.Tool.Success, {
          ...source,
          content: [{ type: "text", text: childText }],
          executed: false,
        })
        const db = (yield* Database.Service).db
        const steps = yield* db
          .select()
          .from(MetaAgentStepTable)
          .where(
            and(
              eq(MetaAgentStepTable.meta_agent_session_id, parent.id),
              eq(MetaAgentStepTable.meta_agent_id, (yield* sessions.get(parent.id)).controller!.metaAgentID),
            ),
          )
        if (actor === "build") {
          expect(child.controller).toBeUndefined()
          expect(steps.map((step) => step.event_type)).toEqual([SessionEvent.Step.Started.type])
        }
        if (actor === "meta") {
          expect(child.controller).toMatchObject({
            kind: "child",
            metaAgentID: before.controller?.metaAgentID,
            executor: { agent: "reviewer", model: childModel },
            source: { kind: "subagent", assistantMessageID: toolIdentity.messageID, toolCallID: source.id },
          })
          yield* MetaAgentService.Service.use((metas) => metas.assertOwner(child))
          expect(
            Permission.evaluate("subagent", "reviewer", yield* permission.effectiveRules(child.id, child.agent)).effect,
          ).toBe("deny")
          const hooks = yield* PluginHooks.Service.pipe(Effect.provide(local))
          yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
            Effect.gen(function* () {
              const event = yield* hooks.trigger("session", name, hookEvent(child.id, child.agent))
              expect(event.tools[SubagentTool.name]?.description).toBe(SubagentTool.description)
            }),
          )
          expect(steps.map((step) => step.event_type)).toEqual([
            SessionEvent.Step.Started.type,
            SessionEvent.Tool.Called.type,
            SessionEvent.Tool.Success.type,
          ])
        }
        const other = Agent.ID.make(actor === "build" ? "meta" : "build")
        yield* agents.transform((editor) =>
          editor.update(other, (agent) => {
            agent.originKind = "builtin"
            agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          }),
        )
        expect(
          yield* executeTool(registry, {
            sessionID: parent.id,
            agent: other,
            messageID: toolIdentity.messageID,
            call: {
              type: "tool-call",
              id: "call-other-owner",
              name: "subagent",
              input: { ...input, sessionID: child.id },
            },
          }),
        ).toMatchObject({ status: "error" })
        expect(yield* sessions.get(child.id)).toEqual(child)
      }),
    )
  })

  it.live("authorizes a frozen Custom alias before creating or switching its canonical child", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      yield* seed.agents.transform((editor) => {
        editor.update(seed.info.id, (agent) => {
          agent.mode = "primary"
          agent.model = parentModel
          agent.hidden = true
          agent.description = "Live canonical description"
        })
        editor.update(Agent.ID.make(seed.info.name), (agent) => {
          agent.mode = "subagent"
          agent.model = overrideModel
        })
      })
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const bus = yield* Bus.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const before = yield* seed.sessions.list()
      const scope = yield* Effect.scope
      const fiber = yield* seed.execute().pipe(Effect.forkIn(scope))
      const request = yield* awaitWithTimeout(Deferred.await(asked), "Custom subagent did not request permission")
      expect(request).toMatchObject({
        sessionID: seed.parent.id,
        action: "subagent",
        resources: [seed.info.id],
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-custom-subagent" },
      })
      expect(yield* seed.sessions.list()).toEqual(before)
      yield* seed.permission.reply({ requestID: request.id, reply: "once" })
      const result = yield* awaitWithTimeout(Fiber.join(fiber), "Custom subagent did not finish", "10 seconds")
      expect(result).toMatchObject({ status: "completed", metadata: { status: "completed" } })
      const childID = outputSessionID(result.metadata)
      expect(yield* seed.sessions.get(childID)).toMatchObject({
        parentID: seed.parent.id,
        mode: "custom",
        agent: seed.info.id,
        model: childModel,
      })
      expect((yield* seed.compositions.selectAgent(childID, seed.info.name)).info.model).toEqual(childModel)

      // A continuation must wait for permission before switching the child's model.
      const continuedAsk = yield* Deferred.make<Permission.Request>()
      const unsubscribeContinuation = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(continuedAsk, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribeContinuation)
      const childBefore = yield* seed.sessions.get(childID)
      const inboxBefore = yield* seed.sessions.inbox(childID)
      const continuation = yield* seed
        .execute({ sessionID: childID, model: "test/override#fast" })
        .pipe(Effect.forkIn(scope))
      const continuedRequest = yield* awaitWithTimeout(
        Deferred.await(continuedAsk),
        "Custom subagent continuation did not request permission",
      )
      expect(continuedRequest.resources).toEqual([seed.info.id])
      expect(yield* seed.sessions.get(childID)).toEqual(childBefore)
      expect(yield* seed.sessions.inbox(childID)).toEqual(inboxBefore)
      yield* seed.permission.reply({ requestID: continuedRequest.id, reply: "once" })
      expect(yield* awaitWithTimeout(Fiber.join(continuation), "Custom continuation did not finish")).toMatchObject({
        status: "completed",
        metadata: { sessionID: childID },
      })
      expect(yield* seed.sessions.get(childID)).toMatchObject({ agent: seed.info.id, model: overrideModel })
    }),
  )

  it.live("applies a frozen Custom deny to aliases before child state changes", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom("deny")
      const child = yield* createLegacySession({ parentID: seed.parent.id, agent: seed.info.id, model: parentModel })
      const before = yield* seed.sessions.list()
      const inbox = yield* seed.sessions.inbox(child.id)
      yield* Effect.forEach([undefined, child.id], (sessionID) =>
        Effect.gen(function* () {
          expect(
            yield* seed.execute({ ...(sessionID === undefined ? {} : { sessionID }), model: "test/override#fast" }),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: subagent" },
          })
        }),
      )
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.sessions.inbox(child.id)).toEqual(inbox)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
    }),
  )

  it.live("rejects live-only targets and meta before creating Custom children", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      const before = yield* seed.sessions.list()
      expect(yield* seed.execute({ agent: "reviewer" })).toEqual({
        status: "error",
        error: {
          type: "tool.execution",
          message: "Custom subagent reviewer is unavailable: SessionComposition.AgentDelegationForbiddenError",
        },
      })
      expect(yield* seed.execute({ agent: "meta" })).toEqual({
        status: "error",
        error: { type: "tool.execution", message: "Agent meta cannot run as a subagent" },
      })
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
    }),
  )

  it.live("uses the frozen Custom pool and caller permissions in all subagent catalog hooks", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      yield* seed.agents.transform((editor) => {
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.originKind = "builtin"
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        })
        editor.update(seed.info.id, (agent) => {
          agent.mode = "primary"
          agent.hidden = true
          agent.description = "Live canonical description"
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        })
      })
      const child = yield* createLegacySession({ parentID: seed.parent.id, agent: seed.info.id })
      yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
        Effect.gen(function* () {
          const root = yield* seed.hooks.trigger("session", name, hookEvent(seed.parent.id))
          expect(root.tools[SubagentTool.name]?.description).toBe(
            `${SubagentTool.description}\n\nAvailable subagents:\n- ${seed.info.id}: ${seed.info.description}`,
          )
          const executor = yield* seed.hooks.trigger("session", name, hookEvent(child.id, seed.info.id))
          expect(executor.tools[SubagentTool.name]?.description).toBe(SubagentTool.description)
        }),
      )
    }),
  )

  it.live("narrows all frozen catalog hooks with Session target denies without starting a child", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ permission: [{ action: "subagent", resource: seed.info.id, effect: "deny" }] })
        .where(eq(SessionTable.id, seed.parent.id))
        .run()
      expect(
        Permission.evaluate(
          "subagent",
          seed.info.id,
          yield* seed.permission.effectiveRules(seed.parent.id, Agent.ID.make("meta")),
        ).effect,
      ).toBe("deny")
      const before = yield* seed.sessions.list()
      const inbox = yield* seed.sessions.inbox(seed.parent.id)
      yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
        Effect.gen(function* () {
          const event = yield* seed.hooks.trigger("session", name, hookEvent(seed.parent.id))
          expect(event.tools[SubagentTool.name]?.description).toBe(SubagentTool.description)
          const absent = hookEvent(seed.parent.id)
          absent.tools = {}
          expect((yield* seed.hooks.trigger("session", name, absent)).tools).toEqual({})
        }),
      )
      expect(yield* seed.execute()).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Permission denied: subagent" },
      })
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual(inbox)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
    }),
  )

  it.live("keeps the effective live catalog local to each Location", () =>
    Effect.gen(function* () {
      const first = yield* setupCustom()
      const second = yield* setupCustom()
      const database = yield* Database.Service
      yield* Effect.forEach(
        [
          { seed: first, target: "reviewer", description: "First location" },
          { seed: second, target: "fallback", description: "Second location" },
        ],
        (item) =>
          Effect.gen(function* () {
            yield* database.db
              .update(SessionTable)
              .set({ mode: "coding", attended: 1 })
              .where(eq(SessionTable.id, item.seed.parent.id))
              .run()
            yield* item.seed.agents.transform((editor) => {
              editor.update(Agent.ID.make("meta"), (agent) => {
                agent.originKind = "builtin"
                agent.permissions = [
                  { action: "*", resource: "*", effect: "deny" },
                  { action: "subagent", resource: item.target, effect: "allow" },
                ]
              })
              editor.update(Agent.ID.make(item.target), (agent) => {
                agent.description = item.description
              })
            })
          }),
      )
      expect(first.parent.location.directory).not.toBe(second.parent.location.directory)
      yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
        Effect.gen(function* () {
          const firstEvent = yield* first.hooks.trigger("session", name, hookEvent(first.parent.id))
          const secondEvent = yield* second.hooks.trigger("session", name, hookEvent(second.parent.id))
          expect(firstEvent.tools[SubagentTool.name]?.description).toBe(
            `${SubagentTool.description}\n\nAvailable subagents:\n- reviewer: First location`,
          )
          expect(secondEvent.tools[SubagentTool.name]?.description).toBe(
            `${SubagentTool.description}\n\nAvailable subagents:\n- fallback: Second location`,
          )
        }),
      )
    }),
  )

  it.live("fails closed for a missing Custom snapshot in execution and catalog hooks", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      const parent = yield* createLegacySession({ location: seed.parent.location, model: parentModel })
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ mode: "custom", agent: "meta" })
        .where(eq(SessionTable.id, parent.id))
        .run()
        .pipe(Effect.orDie)
      const before = yield* seed.sessions.list()
      expect(
        yield* executeTool(seed.registry, {
          sessionID: parent.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          call: {
            type: "tool-call",
            id: "call-missing-composition",
            name: SubagentTool.name,
            input: { agent: "reviewer", description: "Missing snapshot", prompt: "Review this" },
          },
        }),
      ).toEqual({
        status: "error",
        error: {
          type: "tool.execution",
          message: "Custom subagent reviewer is unavailable: SessionComposition.SnapshotNotFoundError",
        },
      })
      yield* Effect.forEach(["context", "compaction", "generate"] as const, (name) =>
        Effect.gen(function* () {
          const event = hookEvent(parent.id)
          const exit = yield* seed.hooks.trigger("session", name, event).pipe(Effect.exit)
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
            SessionComposition.SnapshotNotFoundError,
          )
          expect(event.tools[SubagentTool.name]?.description).toBe(SubagentTool.description)
        }),
      )
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.permission.forSession(parent.id)).toEqual([])
    }),
  )

  completionIt.live("admits one durable completion across live delivery and restart replay", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tasks = yield* SessionTask.Service
          const parent = yield* createLegacySession({
            location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
            model: parentModel,
            title: "Completion recipient",
          })
          expect(yield* tasks.get(parent.id)).toEqual([])
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const jobs = yield* Job.Service
          const bus = yield* Bus.Service
          const admitted = yield* Deferred.make<Job.Background>()
          const notifications: SessionMessage.ID[] = []
          yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
            Effect.gen(function* () {
              if (event.data.sessionID !== parent.id || event.data.item.type !== "synthetic") return
              notifications.push(event.data.inboxID)
              const marker = (yield* jobs.pendingBackground).find((job) => job.notificationID === event.data.inboxID)
              // The marker must survive until admission commits, not merely until delivery starts.
              expect(marker?.status).toBe("completed")
              if (marker) yield* Deferred.succeed(admitted, marker)
            }),
          )

          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-completion-replay",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
            },
          })
          const marker = yield* Deferred.await(admitted)
          yield* jobs.pendingBackground.pipe(Effect.repeat({ until: (pending) => pending.length === 0 }))
          yield* sessions.wait(parent.id)
          const messages = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(messages).toEqual([
            expect.objectContaining({
              id: marker.notificationID,
              description: "background review",
              text: `<subagent sessionID="${outputSessionID(result.metadata)}" state="completed" description="background review">\n${childText}\n</subagent>`,
              metadata: {
                source: "subagent",
                childID: outputSessionID(result.metadata),
                agent: "reviewer",
                state: "completed",
              },
            }),
          ])
          expect(yield* tasks.get(parent.id)).toEqual([])

          // Reproduce a crash after admission but before acknowledgment using the real persisted marker.
          const kv = yield* KV.Service
          yield* kv.set(`job.background/${marker.notificationID}`, marker)
          const restart = yield* SessionRestart.Service
          yield* restart.resumeSuspendedSessions
          yield* sessions.wait(parent.id)
          expect(notifications).toEqual([marker.notificationID])
          expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
            messages,
          )
          expect(yield* jobs.pendingBackground).toEqual([])
          expect(yield* tasks.get(parent.id)).toEqual([])
        }),
      ),
    ),
  )

  productionIt.live("registers globally while resolving agents from the caller location", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const parent = yield* createLegacySession({ location })
          yield* withSubagent(parent.location)

          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          expect((yield* registry.snapshot()).definitions.map((tool) => tool.name)).toContain(SubagentTool.name)
          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-primary",
                name: SubagentTool.name,
                input: { agent: "primary", description: "primary", prompt: "should fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: { type: "tool.execution", message: "Agent primary cannot run as a subagent" },
          })
        }),
      ),
    ),
  )

  it.live("prevents subagents from launching subagents by default", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const root = yield* createLegacySession({ location })
          const parent = yield* createLegacySession({ parentID: root.id, title: "parent" })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-nested-subagent",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "nested", prompt: "should fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("Subagent depth limit reached (1)"),
            },
          })
          expect((yield* sessions.list({ parentID: parent.id })).data).toHaveLength(0)
        }),
      ),
    ),
  )

  it.live("allows nested subagents up to the configured depth", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(path.join(dir.path, "aigcfroge.json"), JSON.stringify({ experimental: { subagent_depth: 2 } })),
          )
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const root = yield* createLegacySession({ location })
          const parent = yield* createLegacySession({ parentID: root.id, title: "parent", model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-configured-nested-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "nested", prompt: "should run" },
            },
          })

          expect(settled).toMatchObject({
            status: "completed",
            metadata: { status: "completed" },
            content: [{ type: "text", text: expect.stringContaining(childText) }],
          })
          expect(settled.metadata).toEqual({
            sessionID: outputSessionID(settled.metadata),
            status: "completed",
          })
          expect((yield* sessions.get(outputSessionID(settled.metadata))).parentID).toBe(parent.id)
        }),
      ),
    ),
  )

  it.live("runs a foreground child session and returns the final assistant text", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const progress: Tool.Metadata[] = []

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            progress: (update) => Effect.sync(() => progress.push(update)),
            call: {
              type: "tool-call",
              id: "call-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "review", prompt: "review this", model: "", sessionID: "" },
            },
          })

          expect(settled).toMatchObject({
            status: "completed",
            metadata: { status: "completed" },
            content: [{ type: "text", text: expect.stringContaining(childText) }],
          })
          const child = yield* sessions.get(outputSessionID(settled.metadata))
          expect(settled.content).toEqual([{ type: "text", text: completedOutput(child.id) }])
          expect(settled.metadata).toEqual({ sessionID: child.id, status: "completed" })
          expect(progress[0]).toEqual({ sessionID: child.id, status: "running" })
          expect(child).toMatchObject({
            parentID: parent.id,
            location: parent.location,
            agent: "reviewer",
            model: childModel,
          })
          expect((yield* sessions.inbox(child.id)).find((message) => message.type === "user")?.payload.text).toBe(
            "You are a subagent spawned by another session.\nreview this",
          )

          const fallback = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-fallback",
              name: SubagentTool.name,
              input: { agent: "fallback", description: "fallback", prompt: "fallback" },
            },
          })
          const fallbackChild = yield* sessions.get(outputSessionID(fallback.metadata))
          expect(fallbackChild).toMatchObject({ parentID: parent.id, model: parentModel })
        }),
      ),
    ),
  )

  it.live("continues an existing child session", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          const first = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-first",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "review", prompt: "review this" },
            },
          })
          const childID = outputSessionID(first.metadata)
          const second = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-second",
              name: SubagentTool.name,
              input: {
                agent: "reviewer",
                description: "follow up",
                prompt: "continue this",
                sessionID: childID,
                model: "",
              },
            },
          })

          expect(outputSessionID(second.metadata)).toBe(childID)
          expect((yield* sessions.list({ parentID: parent.id })).data).toHaveLength(1)
          expect((yield* sessions.get(childID)).title).toBe("review")
          expect(
            (yield* sessions.inbox(childID)).flatMap((message) =>
              message.type === "user" ? [message.payload.text] : [],
            ),
          ).toEqual(["You are a subagent spawned by another session.\nreview this", "continue this"])
          expect(second.content).toEqual([{ type: "text", text: completedOutput(childID) }])
        }),
      ),
    ),
  )

  it.live("steers a running child session in the background", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location, model: parentModel })
          const child = yield* createLegacySession({
            parentID: parent.id,
            title: "review",
            agent: Agent.ID.make("reviewer"),
            model: childModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const jobs = yield* Job.Service
          yield* jobs.start({ id: child.id, type: SubagentTool.name, run: Effect.never })

          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-running-subagent",
              name: SubagentTool.name,
              input: {
                agent: "reviewer",
                description: "follow up",
                prompt: "continue while running",
                sessionID: child.id,
                background: true,
              },
            },
          })

          expect(result).toMatchObject({
            status: "completed",
            metadata: { sessionID: child.id, status: "running" },
          })
          expect((yield* sessions.inbox(child.id)).find((message) => message.type === "user")?.payload.text).toBe(
            "continue while running",
          )
          expect((yield* jobs.get(child.id))?.status).toBe("running")
          yield* jobs.cancel(child.id)
        }),
      ),
    ),
  )

  it.live("rejects unrelated children and switches agents on continuation", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location, model: parentModel })
          const otherParent = yield* createLegacySession({ location, model: parentModel })
          const unrelated = yield* createLegacySession({
            parentID: otherParent.id,
            title: "other review",
            agent: Agent.ID.make("reviewer"),
          })
          const switched = yield* createLegacySession({
            parentID: parent.id,
            title: "fallback review",
            agent: Agent.ID.make("fallback"),
            model: parentModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const call = (sessionID: Session.ID, id: string, agent = "reviewer") =>
            executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call" as const,
                id,
                name: SubagentTool.name,
                input: { agent, description: "follow up", prompt: "continue", sessionID },
              },
            })

          const missing = Session.ID.create()
          expect(yield* call(missing, "call-missing-child")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Subagent session not found: ${missing}`,
            },
          })
          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-malformed-child-id",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "follow up", prompt: "continue", sessionID: "placeholder" },
              },
            }),
          ).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining('sessionID: Expected a string starting with "ses"') },
          })
          expect(yield* call(parent.id, "call-parent-id")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Session ${parent.id} is not a child of the current session`,
            },
          })
          expect(yield* call(unrelated.id, "call-unrelated-child")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Session ${unrelated.id} is not a child of the current session`,
            },
          })
          expect(yield* call(switched.id, "call-switched-child")).toMatchObject({
            status: "completed",
            metadata: { sessionID: switched.id, status: "completed" },
          })
          expect(yield* sessions.get(switched.id)).toMatchObject({
            agent: "reviewer",
            model: childModel,
          })
          // Switching to an agent without a configured model keeps the child's current model.
          expect(yield* call(switched.id, "call-modelless-switch", "fallback")).toMatchObject({
            status: "completed",
            metadata: { sessionID: switched.id, status: "completed" },
          })
          expect(yield* sessions.get(switched.id)).toMatchObject({
            agent: "fallback",
            model: childModel,
          })
        }),
      ),
    ),
  )

  it.live("runs the child on an explicitly requested model", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const call = (id: string, input: Record<string, unknown>) =>
            executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call" as const,
                id,
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "review", prompt: "review this", ...input },
              },
            })

          // The requested model beats the agent's configured model.
          const spawned = yield* call("call-override", { model: "test/override#fast", sessionID: "" })
          expect(spawned).toMatchObject({ status: "completed", metadata: { status: "completed" } })
          const child = yield* sessions.get(outputSessionID(spawned.metadata))
          expect(child).toMatchObject({ agent: "reviewer", model: overrideModel })

          // Continuing with a model switches the existing child even when the agent is unchanged.
          const continued = yield* call("call-override-continue", { sessionID: child.id, model: "test/override" })
          expect(continued).toMatchObject({ status: "completed", metadata: { sessionID: child.id } })
          expect((yield* sessions.get(child.id)).model).toEqual({
            id: overrideModel.id,
            providerID: overrideModel.providerID,
            variant: Model.VariantID.make("default"),
          })

          const failures = [
            [
              "not-a-ref",
              'Invalid model "not-a-ref". Use "providerID/modelID", "providerID/modelID#variant", or "group:groupID".',
            ],
            ["test/missing", 'Model "test/missing" is not available. Use the models tool to see what is available.'],
            ["test/override#slow", 'Variant "slow" is not available for "test/override". Available: fast.'],
            ["test/plain#high", 'Model "test/plain" has no variants. Omit the variant.'],
          ] as const
          for (const [model, message] of failures) {
            expect(yield* call(`call-${model}`, { model })).toEqual({
              status: "error",
              error: { type: "tool.execution", message },
            })
          }
        }),
      ),
    ),
  )

  it.live("returns child runner failures as tool errors", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const parent = yield* createLegacySession({ location })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-subagent-failure",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "fail review", prompt: "please fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("No model is available for session"),
            },
          })
        }),
      ),
    ),
  )

  it.live("notifies once when background work completes", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* createLegacySession({ location })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const bus = yield* Bus.Service
          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-background-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
            },
          })
          const childID = outputSessionID(settled.metadata)
          expect(settled.metadata).toMatchObject({
            status: "running",
          })
          expect(settled.metadata).toEqual({ sessionID: childID, status: "running" })
          expect(settled.content).toEqual([{ type: "text", text: expect.stringContaining(`sessionID: ${childID}`) }])

          const admission = Array.from(yield* Fiber.join(admitted))[0]
          expect(admission?.data.item.type).toBe("synthetic")
          if (admission?.data.item.type !== "synthetic")
            return yield* Effect.die(new Error("Expected synthetic inbox item"))
          expect(admission?.data.item.payload.text).toContain(`<subagent sessionID="${childID}" state="completed"`)
          expect(admission?.data.item.payload).toMatchObject({
            description: "background review",
            metadata: {
              source: "subagent",
              childID,
              agent: "reviewer",
              state: "completed",
            },
          })
          const database = yield* Database.Service
          yield* SessionInbox.promote(database.db, bus, parent.id, "steer")
          const synthetic = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          expect(synthetic[0]?.text).toContain(`<subagent sessionID="${childID}" state="completed"`)
          expect(synthetic[0]?.text).toContain(childText)
        }),
      ),
    ),
  )
})
