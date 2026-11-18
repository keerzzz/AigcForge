import { HttpRecorder } from "@aigcfroge/http-recorder"
import { OpenAIChat } from "@aigcfroge/ai/protocols/openai-chat"
import { Auth, LLMClient, type LLMClientService, RequestExecutor } from "@aigcfroge/ai/route"
import { Model } from "@aigcfroge/core/model"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Agent } from "@aigcfroge/core/agent"
import { Config } from "@aigcfroge/core/config"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { Snapshot } from "@aigcfroge/core/snapshot"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionRunner } from "@aigcfroge/core/session/runner/index"
import { SessionRunnerLLM } from "@aigcfroge/core/session/runner/llm"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { Tool } from "@aigcfroge/core/tool"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Location } from "@aigcfroge/core/location"
import { InstructionBuiltIns } from "@aigcfroge/core/instructions/builtins"
import { InstructionDiscovery } from "@aigcfroge/core/instruction-discovery"
import { Instructions } from "@aigcfroge/core/instructions/index"
import { SkillInstructions } from "@aigcfroge/core/skill/instructions"
import { ReferenceInstructions } from "@aigcfroge/core/reference/instructions"
import { McpInstructions } from "@aigcfroge/core/mcp/instructions"
import { PluginSupervisor } from "@aigcfroge/core/plugin/supervisor"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { OptimizePlugin } from "@aigcfroge/core/plugin/optimize"
import { IdentityPlugin } from "@aigcfroge/core/plugin/identity"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import path from "node:path"
import { testEffect } from "./lib/effect"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { promptLocationNode } from "./fixture/prompt-location"
import { agentHost, modelHost, host, noProviders } from "./plugin/host"

const cassetteName = "session-runner/openai-chat-streams-text"
const cassetteDirectory = path.resolve(import.meta.dir, "fixtures/recordings")
if (process.env.RECORD === "true") {
  if (process.env.CI !== undefined) throw new Error("Unset CI before recording HTTP cassettes")
  HttpRecorder.removeCassetteSync(cassetteName, { directory: cassetteDirectory })
}
const cassette = HttpRecorder.layerFetch(cassetteName, { directory: cassetteDirectory })
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const model = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer(process.env.OPENAI_API_KEY ?? "fixture"),
    generation: { maxTokens: 20, temperature: 0 },
  })
  .model({ id: "gpt-4o-mini", compatibility: { supportsPromptCacheKey: true } })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 20 },
      }),
    ),
})
const systemContext = Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) })
const instructionContext = Layer.mock(InstructionDiscovery.Service, {
  project: true,
  global: true,
  load: () => Effect.succeed(Instructions.empty),
})
const skillInstructions = Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const referenceInstructions = Layer.mock(ReferenceInstructions.Service, {
  load: () => Effect.succeed(Instructions.empty),
})
const mcpInstructions = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const config = Config.testLayer()
const promptModels = Layer.mock(Model.Service, {
  get: () => Effect.undefined,
  all: () => Effect.succeed([]),
  available: () => Effect.succeed([]),
  default: () => Effect.undefined,
  small: () => Effect.undefined,
})
const runnerLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(SessionRunnerLLM.node, [
    Snapshot.node.replace(Snapshot.noopLayer),
    LayerNodePlatform.llmClient.replace(llmClient),
    SessionRunnerModel.node.replace(models),
    InstructionBuiltIns.node.replace(systemContext),
    InstructionDiscovery.node.replace(instructionContext),
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    SkillInstructions.node.replace(skillInstructions),
    ReferenceInstructions.node.replace(referenceInstructions),
    McpInstructions.node.replace(mcpInstructions),
    Config.node.replace(config),
    PluginSupervisor.node.replace(Layer.empty),
    Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
  ])
const execution = (llmClient: Layer.Layer<LLMClientService>) =>
  Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const sessionRunner = yield* SessionRunner.Service
      const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
        drain: (sessionID, force) => sessionRunner.drain({ sessionID, force }).pipe(Effect.asVoid),
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
  ).pipe(Layer.provide(runnerLayer(llmClient)), Layer.orDie)
const testLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      Model.node,
      PluginHooks.node,
      Tool.node,
      SessionRunnerModel.node,
      InstructionBuiltIns.node,
      InstructionDiscovery.node,
      SkillInstructions.node,
      ReferenceInstructions.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      Session.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      LocationServiceMap.node.replace(promptLocationNode),
      LayerNodePlatform.llmClient.replace(llmClient),
      Model.node.replace(promptModels),
      SessionRunnerModel.node.replace(models),
      InstructionBuiltIns.node.replace(systemContext),
      InstructionDiscovery.node.replace(instructionContext),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      SkillInstructions.node.replace(skillInstructions),
      ReferenceInstructions.node.replace(referenceInstructions),
      Config.node.replace(config),
      Snapshot.node.replace(Snapshot.noopLayer),
      PluginSupervisor.node.replace(Layer.empty),
      Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
      SessionExecution.node.replace(execution(llmClient)),
    ],
  )
const it = testEffect(testLayer(client))
const gateway = testEffect(testLayer(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer))))))
const sessionID = Session.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one recorded prompt through the recorded HTTP transport", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const models = yield* Model.Service
      const hooks = yield* PluginHooks.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.originKind = "builtin"
          agent.mode = "primary"
          agent.permissions.push({ action: "execute", resource: "*", effect: "deny" })
        }),
      )
      const pluginHost = host({
        agent: agentHost(agents),
        model: modelHost(models),
        provider: noProviders,
        session: { hook: (name, callback) => hooks.register("session", name, callback) },
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* IdentityPlugin.Plugin.effect(pluginHost)
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const session = yield* Session.Service
      const prompt = yield* session.prompt({
        sessionID,
        text: "Say hello in one short sentence.",
        resume: false,
      })

      yield* session.resume(sessionID)

      const messages = yield* session.context(sessionID)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ id: prompt.id, type: "user", text: "Say hello in one short sentence." })
      expect(messages[1]).toMatchObject({ type: "assistant", agent: "build", finish: "stop" })
      expect(messages[1]?.type === "assistant" ? messages[1].content : []).toMatchObject([
        { type: "text", text: "Hello!" },
      ])
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(EventTable.seq)
          .all()).map((event) => event.type).filter((type) => !type.startsWith("session.attempt.")),
      ).toEqual([
        "session.inbox.enqueued.1",
        "session.instructions.updated.2",
        "session.inbox.delivered.1",
        "session.step.started.1",
        "session.text.started.1",
        "session.text.ended.1",
        "session.step.streamed.1",
        "session.step.ended.1",
        "session.step.completed.1",
      ])
    }),
  )

  gateway.live("records Magpie early headers as gateway diagnostics and measures the physical stream", () => Effect.gen(function* () {
    const requests: { path: string; session: string | null }[] = []
    const running = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push({ path: new URL(request.url).pathname, session: request.headers.get("x-magpie-session") })
      const frames = [
        { id: "chat_gateway", model: "upstream/final-candidate", choices: [{ delta: { role: "assistant", content: "O" }, finish_reason: null }] },
        { id: "chat_gateway", choices: [{ delta: { content: "K" }, finish_reason: null }] },
        { id: "chat_gateway", choices: [{ delta: {}, finish_reason: "stop" }] },
        { id: "chat_gateway", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ]
      return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream", "x-magpie-provider": "reported-provider", "x-magpie-model": "early-candidate" },
      })
    } })), (server) => Effect.promise(() => server.stop(true)))
    const hooks = yield* PluginHooks.Service
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), (agent) => {
      agent.originKind = "builtin"
      agent.mode = "primary"
    }))
    yield* hooks.register("session", "model.request", (event) => Effect.sync(() => { event.baseURL = `${running.url}v1` }))
    const db = (yield* Database.Service).db
    yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
    yield* db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global, slug: "gateway", directory: "/project", title: "Gateway fixture", version: "test" }).run().pipe(Effect.orDie)
    const session = yield* Session.Service
    yield* session.prompt({ sessionID, text: "Gateway fixture", resume: false })
    yield* session.resume(sessionID)
    const assistant = (yield* session.context(sessionID)).find((message) => message.type === "assistant")
    if (assistant?.type !== "assistant") throw new Error("Expected the gateway assistant")
    expect(assistant.content).toMatchObject([{ type: "text", text: "OK" }])
    expect(assistant.attempts).toHaveLength(1)
    const attempt = assistant.attempts?.[0]
    if (!attempt?.terminal) throw new Error("Expected the physical attempt terminal")
    expect(attempt.model).toMatchObject({ providerID: "openai", id: "gpt-4o-mini" })
    expect(attempt.apiModelID).toBe("gpt-4o-mini")
    expect(attempt.observations.flatMap((observation) => observation.gatewayReport ? [observation.gatewayReport] : [])).toEqual([
      { source: "response-headers", provider: "reported-provider", model: "early-candidate" },
    ])
    const first = attempt.observations.filter((observation) => observation.firstTokenAt !== undefined)
    expect(first).toHaveLength(1)
    expect(first[0]?.firstTokenAt).toBeGreaterThanOrEqual(attempt.started)
    expect(attempt.terminal.providerEndedAt).toBeGreaterThanOrEqual(first[0]?.firstTokenAt ?? 0)
    expect(attempt.terminal.ended).toBeGreaterThanOrEqual(attempt.terminal.providerEndedAt ?? 0)
    expect(attempt.terminal.usage).toMatchObject({ input: 3, output: 2 })
    expect(attempt.quote.status).toBe("unknown")
    expect(attempt.terminal.cost).toBeUndefined()
    expect(requests).toEqual([{ path: "/v1/chat/completions", session: null }])
  }))
})
