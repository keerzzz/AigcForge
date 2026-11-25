import { describe, expect } from "bun:test"
import path from "node:path"
import { AIError, InvalidRequestError, LanguageModel, LLMClient, LLMEvent } from "@omnixa/ai"
import { OpenAIChat } from "@omnixa/ai/protocols"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { AgentAsset } from "@omnixa/core/agent-asset"
import { App } from "@omnixa/core/app"
import { Bus } from "@omnixa/core/bus"
import { Config } from "@omnixa/core/config"
import { CompositionDigest } from "@omnixa/core/composition/digest"
import { Database } from "@omnixa/core/database/database"
import { DelegationExecution } from "@omnixa/core/delegation/execution"
import { DelegationService } from "@omnixa/core/delegation/service"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNodePlatform } from "@omnixa/core/effect/app-node-platform"
import { Job } from "@omnixa/core/job"
import { FileAccess } from "@omnixa/core/file-access"
import { ShellSelect } from "@omnixa/core/shell/select"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { ModelGroup } from "@omnixa/core/model-group"
import { ModelResolver } from "@omnixa/core/model-resolver"
import { Permission } from "@omnixa/core/permission"
import { ApprovalPresence } from "@omnixa/core/permission/approval-presence"
import { Plugin } from "@omnixa/core/plugin"
import { Provider } from "@omnixa/core/provider"
import { Project } from "@omnixa/core/project"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionMessage } from "@omnixa/core/session/message"
import { TaskOperation } from "@omnixa/core/session/task-operation"
import { SessionRunnerModel } from "@omnixa/core/session/runner/model"
import { SessionInboxTable, SessionMessageTable, SessionTable, TaskTable } from "@omnixa/core/session/sql"
import { SessionTask } from "@omnixa/core/session/task"
import { Tool } from "@omnixa/core/tool"
import { TaskTool } from "@omnixa/core/tool/plugin/task"
import { GoalTool } from "@omnixa/core/tool/plugin/goal"
import { ScheduleTool } from "@omnixa/core/tool/plugin/schedule"
import { SessionGoal } from "@omnixa/core/session/goal"
import { ScheduleService } from "@omnixa/core/session/schedule-service"
import { SubagentTool } from "@omnixa/core/tool/plugin/subagent"
import { SessionContext } from "@omnixa/core/session/context"
import { WorkflowAsset } from "@omnixa/core/workflow-asset"
import { WorkflowExecution } from "@omnixa/core/workflow/execution"
import { WorkflowRun } from "@omnixa/core/workflow/workflow-run"
import { Composition } from "@omnixa/schema/composition"
import { OperationExistingRootTarget, OperationNewRootTarget } from "@omnixa/schema/session-task"
import { StepDef } from "@omnixa/schema/workflow-asset"
import { Hash } from "@omnixa/util/hash"
import { MetaAgentService } from "@omnixa/core/meta-agent/service"
import { MetaAgentSessionTable, MetaAgentTable } from "@omnixa/core/meta-agent/sql"
import { DelegationEvent } from "@omnixa/core/delegation/event"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@omnixa/core/delegation/sql"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { Event } from "@omnixa/schema/event"
import { Money } from "@omnixa/schema/money"
import { KV } from "@omnixa/core/kv"
import { KVTable } from "@omnixa/core/kv/sql"
import { ExecutorPreference, ExecutorBinding, TaskControllerSource } from "@omnixa/schema/session"
import { DelegationID, ParticipantID, TurnID } from "@omnixa/schema/delegation-id"
import { Delegation } from "@omnixa/schema/delegation"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Global } from "@omnixa/util/global"
import { FSUtil } from "@omnixa/util/fs-util"
import { asc, eq, sql } from "drizzle-orm"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { CompositionFixture } from "./lib/composition"
import { withCustomModeEnabled } from "./lib/product-mode"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

withCustomModeEnabled()

const llmTest = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(LLMClient.Service, TestLLM.Test),
  deps: [llmTest],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      WorkflowExecution.node,
      WorkflowRun.node,
      DelegationExecution.node,
      DelegationService.node,
      MetaAgentService.node,
      Session.node,
      SessionComposition.node,
      SessionTask.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Database.node,
      Project.node,
      Bus.node,
      Job.node,
      ApprovalPresence.node,
      FSUtil.node,
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
                LanguageModel.make({ id: "task", provider: "test", route: OpenAIChat.route }),
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
  ),
)
const leafIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      WorkflowExecution.node,
      WorkflowRun.node,
      DelegationExecution.node,
      DelegationService.node,
      Session.node,
      SessionComposition.node,
      SessionTask.node,
      SessionExecution.node,
      LocationServiceMap.node,
      MetaAgentService.node,
      SessionGoal.node,
      ScheduleService.node,
      Project.node,
      Database.node,
      Bus.node,
      Job.node,
      KV.node,
      llmTest,
    ]),
    [
      Global.node.replace(tempGlobalLayer),
      Bus.node.replace(Bus.configured({ persist: true })),
      offlineModels,
      LayerNodePlatform.llmClient.replace(llmClient),
    ],
  ),
)

const metaLeaf = Effect.fnUntraced(function* (mode?: "work") {
  const directory = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(path.join(directory.path, "omnixa.json"), JSON.stringify({ experimental: { subagent_depth: 2 } })),
  )
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(location)
  const providerID = Provider.ID.make("meta-leaf-keeper")
  const metaModel = Model.Ref.make({ providerID, id: Model.ID.make("meta") })
  const workerModel = Model.Ref.make({ providerID, id: Model.ID.make("worker") })
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [metaModel, workerModel].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
    },
  ]).pipe(Effect.provide(local))
  const build = yield* Agent.Service.use((agents) => agents.get(Agent.ID.make("build"))).pipe(Effect.provide(local))
  if (!build) return yield* Effect.die(new Error("The real built-in Build agent is missing"))
  expect(build.mode).toBe("all")
  const sessions = yield* Session.Service
  const root = yield* sessions.create({
    location,
    mode,
    agent: Agent.ID.make("meta"),
    model: metaModel,
    executorPreference: new ExecutorPreference({ agent: build.id, model: workerModel }),
  })
  const binding = yield* Session.resolveExecutor(root, build).pipe(Effect.provide(local))
  const delegations = yield* DelegationService.Service
  const delegation = yield* delegations.create({ parentSessionID: root.id, title: "Real Meta leaf owner" })
  const participant = yield* delegations.addParticipant({
    delegationID: delegation.id,
    provider: "internal",
    target: binding.agent,
    role: "implementer",
    context: "fresh",
    executor: binding,
  })
  const source = new TaskControllerSource({ kind: "task", delegationID: delegation.id, participantID: participant.id })
  const child = yield* sessions.create({
    parentID: root.id,
    agent: binding.agent,
    model: binding.model,
    executor: binding,
    source,
  })
  yield* delegations.bindParticipant({
    delegationID: delegation.id,
    participantID: participant.id,
    childSessionID: child.id,
  })
  const metas = yield* MetaAgentService.Service
  yield* metas.assertOwner(child)
  expect(child.controller).toMatchObject({ kind: "child", rootSessionID: root.id, source, executor: binding })
  const db = (yield* Database.Service).db
  const permission = yield* Permission.Service.pipe(Effect.provide(local))
  const llm = yield* TestLLM.Test
  const kv = yield* KV.Service
  return {
    root,
    child,
    metaModel,
    workerModel,
    binding,
    source,
    delegation,
    participant,
    sessions,
    delegations,
    metas,
    local,
    bus: yield* Bus.Service,
    read: () =>
      Effect.all({
        sessions: db.select().from(SessionTable).orderBy(asc(SessionTable.id)),
        metas: db.select().from(MetaAgentTable).orderBy(asc(MetaAgentTable.id)),
        owners: db
          .select()
          .from(MetaAgentSessionTable)
          .orderBy(asc(MetaAgentSessionTable.meta_agent_id), asc(MetaAgentSessionTable.session_id)),
        delegations: db.select().from(DelegationTable).orderBy(asc(DelegationTable.id)),
        participants: db.select().from(DelegationParticipantTable).orderBy(asc(DelegationParticipantTable.id)),
        turns: db.select().from(DelegationTurnTable).orderBy(asc(DelegationTurnTable.id)),
        deliveryState: delegations.foldState(delegation.id),
        tasks: db.select().from(TaskTable).orderBy(asc(TaskTable.id)),
        events: db.select().from(EventTable).orderBy(asc(EventTable.aggregate_id), asc(EventTable.seq)),
        sequences: db.select().from(EventSequenceTable).orderBy(asc(EventSequenceTable.aggregate_id)),
        rootInbox: sessions.inbox(root.id),
        childInbox: sessions.inbox(child.id),
        waiters: permission.list(),
        kv: kv.scan({ prefix: "" }),
        requests: llm.requests(),
      }),
  }
})

const workflowLeaf = Effect.fnUntraced(function* (
  steps: readonly StepDef[] = [
    new StepDef({ id: "A", name: "A", agent: "workflow-worker", input: { value: "published" }, next: "END" }),
  ],
) {
  const fixture = yield* metaLeaf("work")
  expect(fixture.root.mode).toBe("work")
  expect(fixture.child.mode).toBe("work")
  const agent =
    "---\nkind: agent\nname: workflow-worker\ndescription: Published workflow worker\nconfig: |\n  model: meta-leaf-keeper/worker\n  mode: subagent\n---\nUse the published input.\n"
  const workflow = JSON.stringify({
    kind: "workflow",
    name: "task-keeper",
    description: "Finite Task workflow",
    version: "1",
    steps,
  })
  yield* Effect.promise(() =>
    Bun.write(path.join(fixture.root.location.directory, ".omnixa/agents/workflow-worker.md"), agent),
  )
  yield* Effect.promise(() =>
    Bun.write(path.join(fixture.root.location.directory, ".omnixa/workflows/task-keeper.yaml"), workflow),
  )
  yield* AgentAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(fixture.local))
  yield* WorkflowAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(fixture.local))
  yield* fixture.sessions.setPermissions({
    sessionID: fixture.root.id,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  return {
    ...fixture,
    llm: yield* TestLLM.Test,
    db: (yield* Database.Service).db,
    tasks: yield* SessionTask.Service,
    workflows: yield* WorkflowRun.Service,
    workflowExecution: yield* WorkflowExecution.Service,
    registry: yield* Tool.Service.pipe(Effect.provide(fixture.local)),
    input: {
      description: "Execute published workflow",
      prompt: "Keep the published inputs.",
      workflow: new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          new Composition.AgentRef({
            kind: "agent",
            relativePath: "workflow-worker.md",
            revision: Composition.Revision.make(Hash.sha256(Buffer.from(agent))),
          }),
        ],
        workflow: new Composition.WorkflowRef({
          kind: "workflow",
          relativePath: "task-keeper.yaml",
          revision: Composition.Revision.make(Hash.sha256(Buffer.from(workflow))),
        }),
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      }),
    },
  }
})

const judgeLeaf = Effect.fnUntraced(function* () {
  const f = yield* metaLeaf("work")
  yield* f.sessions.setPermissions({
    sessionID: f.root.id,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  })
  const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
  const input = {
    description: "Compare the exact evidence",
    prompt: "<workflow_result>\nExact upstream evidence 🚀\nKeep both lines.\n</workflow_result>",
    subagent_type: "build",
    execution_type: "judge" as const,
    judge_models: ["meta-leaf-keeper/worker", "meta-leaf-keeper/meta"],
  }
  return {
    ...f,
    llm: yield* TestLLM.Test,
    tasks: yield* SessionTask.Service,
    models: yield* Model.Service.pipe(Effect.provide(f.local)),
    execution: yield* DelegationExecution.Service,
    db: (yield* Database.Service).db,
    input,
    execute: (overrides: Partial<typeof TaskTool.Input.Type> = {}) =>
      executeTool(registry, {
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: {
          type: "tool-call",
          id: "mc08-j1-judge",
          name: TaskTool.name,
          input: { ...input, ...overrides },
        },
      }),
  }
})

const saveJudgeGroup = Effect.fnUntraced(function* (
  f: Effect.Success<ReturnType<typeof judgeLeaf>>,
  members: readonly Model.Ref[],
) {
  const config = yield* Config.Service.pipe(Effect.provide(f.local))
  if (!config.provider) return yield* Effect.die(new Error("Judge Group configuration is missing"))
  const target = (yield* config.provider.list()).targets.find(
    (target) => target.scope === "project" && target.preferred,
  )
  if (!target) return yield* Effect.die(new Error("Judge Group target is missing"))
  const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("judge-summary") })
  const saved = yield* ModelGroup.save(
    ModelGroup.decodeSave({
      groupID: group.groupID,
      target: { scope: target.scope, path: target.path },
      expectedDigest: target.digest,
      patch: {
        set: { name: "Judge summary", enabled: true, members: [...members], strategy: "order", affinity: "turn" },
      },
    }),
  ).pipe(Effect.provideService(Config.Service, config))
  expect(saved.definition.status).toBe("saved")
  yield* f.sessions.selectExecutor({
    sessionID: f.root.id,
    executorPreference: new ExecutorPreference({ agent: f.binding.agent, model: group }),
  })
  return group
})

leafIt.live("inherits a Judge summary Group and records its actual fallback API model from physical attempts", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    const rejected = Model.Ref.make({ providerID: f.metaModel.providerID, id: Model.ID.make("catalog-rejected") })
    const accepted = Model.Ref.make({ providerID: f.metaModel.providerID, id: Model.ID.make("catalog-summary") })
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(f.metaModel.providerID),
          activation: "enabled",
          package: "@omnixa/ai/providers/openai/responses",
        }),
        models: [f.metaModel, f.workerModel, rejected, accepted].map((ref) =>
          Model.Info.make({
            ...Model.Info.default(ref.providerID, ref.id),
            modelID:
              ref.id === rejected.id
                ? Model.ID.make("rejected-api")
                : ref.id === accepted.id
                  ? Model.ID.make("summary-api")
                  : ref.id,
          }),
        ),
      },
    ]).pipe(Effect.provide(f.local))
    const group = yield* saveJudgeGroup(f, [rejected, accepted])
    yield* f.llm.serve((request) =>
      request.model.id === "rejected-api"
        ? Stream.fail(
            new AIError({
              reason: new InvalidRequestError({
                message: "The Group candidate model does not exist",
                classification: "model-not-found",
                http: { status: 404, url: "http://127.0.0.1/v1/responses", headers: {} },
              }),
            }),
          )
        : TestLLM.text(
            request.model.id === "summary-api" ? "Complete Group summary" : `Original ${request.model.id} body`,
            "group-summary",
          ),
    )
    const result = yield* f.execute({ summary: {} })
    expect(result.status).toBe("completed")
    const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
    expect(output.workers.map((worker) => worker.text)).toEqual(["Original worker body", "Original meta body"])
    expect(output.summary).toMatchObject({
      status: "completed",
      result: {
        requested: group,
        executor: { model: group, groupBehavior: { members: [rejected, accepted] } },
        text: "Complete Group summary",
        completion: { model: accepted },
      },
    })
    const requests = yield* f.llm.requests()
    expect(requests.map((request) => String(request.model.id))).toEqual([
      "worker",
      "meta",
      "rejected-api",
      "summary-api",
    ])
    const actual = requests.find((request) => request.model.id === "summary-api")
    if (!actual) return yield* Effect.die(new Error("The actual Group summary request is missing"))
    expect(output.summary?.result?.runtime).toEqual({
      provider: actual.model.provider,
      id: actual.model.id,
      route: actual.model.route.id,
    })
    const receipt = output.summary?.result?.receipt
    if (!receipt) return yield* Effect.die(new Error("The Group summary receipt is missing"))
    expect((yield* f.sessions.get(receipt.childSessionID)).model).toEqual(group)
    const completed = yield* SessionInputResult.read(f.db, {
      sessionID: receipt.childSessionID,
      inputID: receipt.inputID,
    })
    if (completed.status !== "completed")
      return yield* Effect.die(new Error("The Group summary input did not complete"))
    expect(
      completed.assistant.attempts?.map((attempt) => ({
        selection: attempt.selection,
        model: attempt.model,
        api: attempt.apiModelID,
      })),
    ).toEqual([
      { selection: group, model: rejected, api: "rejected-api" },
      { selection: group, model: accepted, api: "summary-api" },
    ])
    return undefined
  }),
)

leafIt.live("keeps the original Judge packet and omits runtime when an inherited Group emits no attempt", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    const missing = Model.Ref.make({ providerID: f.metaModel.providerID, id: Model.ID.make("not-in-catalog") })
    const group = yield* saveJudgeGroup(f, [missing])
    yield* f.llm.serve((request) => TestLLM.text(`Original ${request.model.id} body`, "group-unavailable"))
    const result = yield* f.execute({ summary: {} })
    expect(result.status).toBe("completed")
    const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
    expect(output.status).toBe("completed")
    expect(output.workers.map((worker) => worker.text)).toEqual(["Original worker body", "Original meta body"])
    expect(output.summary).toMatchObject({ status: "failed", result: { requested: group, executor: { model: group } } })
    expect(output.summary?.result?.runtime).toBeUndefined()
    expect(output.summary?.result?.completion).toBeUndefined()
    expect(yield* f.llm.requests()).toHaveLength(2)
    const receipt = output.summary?.result?.receipt
    if (!receipt) return yield* Effect.die(new Error("The unavailable Group receipt is missing"))
    expect(
      (yield* f.sessions.messages({ sessionID: receipt.childSessionID }))
        .filter((message) => message.type === "assistant")
        .flatMap((message) => message.attempts ?? []),
    ).toEqual([])
    return undefined
  }),
)

for (const mode of ["foreground", "background", "admit-only"] as const) {
  leafIt.live(`SC01 root Task ${mode} self-target settles the original runner without duplicate inputs`, () =>
    Effect.gen(function* () {
      const f = yield* metaLeaf("work")
      const llm = yield* TestLLM.Test
      const tasks = yield* SessionTask.Service
      const execution = yield* SessionExecution.Service
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const replies = [
        TestLLM.tool("sc01-self-target", TaskTool.name, {
          description: "Continue this root",
          prompt: "Do the successor work",
          target: { type: "existing_root", sessionID: f.root.id },
          ...(mode === "background" ? { background: true } : {}),
          ...(mode === "admit-only" ? { resume: false } : {}),
        }),
        TestLLM.text("The original turn settled", "sc01-source-finished"),
        TestLLM.text("The queued successor settled", "sc01-target-finished"),
      ]
      yield* llm.serve((request) =>
        request.tools.some((tool) => tool.name === TaskTool.name)
          ? (replies.shift() ?? TestLLM.text("The root settled", "sc01-exhausted"))
          : TestLLM.text("A fixture title", "sc01-auxiliary"),
      )
      yield* f.sessions.prompt({
        sessionID: f.root.id,
        text: "Call the Task tool with this root as its target",
        resume: false,
      })
      yield* awaitWithTimeout(f.sessions.resume(f.root.id), "The source Task runner did not settle", "10 seconds")
      expect(yield* execution.isActive(f.root.id)).toBe(false)
      const tools = (yield* f.sessions.messages({ sessionID: f.root.id })).flatMap((message) =>
        message.type === "assistant" ? message.content : [],
      )
      const operation = (yield* tasks.operations({ sessionID: f.root.id }))[0]
      if (mode === "foreground") {
        expect(tools).toContainEqual(
          expect.objectContaining({
            type: "tool",
            id: "sc01-self-target",
            state: expect.objectContaining({
              status: "error",
              error: expect.objectContaining({
                message:
                  "Synchronous Task target must be a different root Session; use background: true or resume: false for this Session",
              }),
            }),
          }),
        )
        expect(operation).toBeUndefined()
        expect(yield* f.sessions.inbox(f.root.id)).toEqual([])
        return undefined
      }
      if (!operation) return yield* Effect.die(new Error("The asynchronous self-target operation was not admitted"))
      expect(yield* tasks.operations({ sessionID: f.root.id })).toHaveLength(1)
      expect(operation).toMatchObject({
        sourceSessionID: f.root.id,
        targetSessionID: f.root.id,
        request: { delivery: "queue" },
      })
      expect(tools).toContainEqual(
        expect.objectContaining({
          type: "tool",
          id: "sc01-self-target",
          state: expect.objectContaining({ status: "completed" }),
        }),
      )
      expect(
        yield* SessionInputResult.read((yield* Database.Service).db, {
          sessionID: f.root.id,
          inputID: operation.inputID,
        }),
      ).toMatchObject({ status: "completed" })
      expect(yield* f.sessions.inbox(f.root.id)).toEqual([])
      return undefined
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const execution = yield* SessionExecution.Service
          yield* Effect.forEach(yield* execution.active, (sessionID) => execution.interrupt(sessionID), {
            discard: true,
          })
        }),
      ),
    ),
  )
}

leafIt.live("MP02 Task root targets keep stable invocation identities and preserve the existing delegation", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf("work")
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const tasks = yield* SessionTask.Service
    const database = yield* Database.Service
    const delegated = yield* f.delegations.foldState(f.delegation.id)
    yield* Effect.forEach(["new_root", "existing_root"] as const, (kind) =>
      Effect.gen(function* () {
        const target =
          kind === "existing_root"
            ? yield* f.sessions.create({
                location: f.root.location,
                mode: "chat",
                agent: Agent.ID.make("build"),
                model: f.binding.model,
              })
            : undefined
        const input: typeof TaskTool.Input.Type = {
          description: "Dispatch independent root work",
          prompt: "Complete this independent root work",
          target: target
            ? new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id })
            : new OperationNewRootTarget({
                type: "new_root",
                mode: "chat",
                agent: Agent.ID.make("build"),
                model: f.binding.model,
              }),
          resume: false,
        }
        const before = yield* tasks.operations({ sessionID: f.root.id })
        const call = { type: "tool-call" as const, id: `mp02-root-${kind}`, name: TaskTool.name, input }
        const first = yield* executeTool(registry, {
          sessionID: f.root.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          call,
        })
        expect(first.status).toBe("completed")
        const output = Schema.decodeUnknownSync(TaskTool.OperationOutput)(first.output)
        expect(output).toMatchObject({
          kind: "operation",
          status: "admitted",
          operation: {
            sourceSessionID: f.root.id,
            sourceMode: "work",
            phase: "admitted",
            source: {
              type: "model_tool",
              sessionID: f.root.id,
              agent: "meta",
              messageID: toolIdentity.messageID,
              id: call.id,
            },
            request: { delivery: "queue", resume: false },
          },
          operationRef: { sourceSessionID: f.root.id },
        })
        expect(output.operationRef.operationID).toBe(output.operation.operationID)
        expect(first.metadata?.operationRef).toEqual(output.operationRef)
        if (!output.operation.targetSessionID) return yield* Effect.die(new Error("Root operation has no target"))
        const created = yield* f.sessions.get(output.operation.targetSessionID)
        expect(created).toMatchObject({ mode: "chat", agent: "build" })
        expect(created.parentID).toBeUndefined()
        expect(created.id).not.toBe(f.root.id)
        if (target) expect(created.id).toBe(target.id)
        const inbox = yield* database.db
          .select()
          .from(SessionInboxTable)
          .where(eq(SessionInboxTable.id, output.operation.inputID))
          .all()
          .pipe(Effect.orDie)
        expect(inbox).toMatchObject([{ session_id: created.id, type: "user", payload: { text: input.prompt } }])
        const repeated = yield* executeTool(registry, {
          sessionID: f.root.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          call,
        })
        expect(repeated.status).toBe("completed")
        expect(Schema.decodeUnknownSync(TaskTool.OperationOutput)(repeated.output)).toEqual(output)
        expect(yield* tasks.operations({ sessionID: f.root.id })).toHaveLength(before.length + 1)
        expect(
          yield* database.db
            .select()
            .from(SessionInboxTable)
            .where(eq(SessionInboxTable.id, output.operation.inputID))
            .all()
            .pipe(Effect.orDie),
        ).toEqual(inbox)
        const distinct = yield* executeTool(registry, {
          sessionID: f.root.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          call: { ...call, id: `${call.id}-next` },
        })
        expect(distinct.status).toBe("completed")
        const next = Schema.decodeUnknownSync(TaskTool.OperationOutput)(distinct.output)
        expect(next.operation.operationID).not.toBe(output.operation.operationID)
        expect(next.operation.inputID).not.toBe(output.operation.inputID)
        expect(yield* tasks.operations({ sessionID: f.root.id })).toHaveLength(before.length + 2)
      }),
    )
    expect(yield* f.delegations.foldState(f.delegation.id)).toEqual(delegated)
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 Task root dispatch reuses a source Task and rejects a changed invocation", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const tasks = yield* SessionTask.Service
    const [linked] = yield* tasks.append({
      sessionID: f.root.id,
      tasks: [{ content: "Existing planning Task", status: "pending", priority: "high" }],
    })
    const input: typeof TaskTool.Input.Type = {
      description: "Run a linked root task",
      prompt: "Use the linked planning task",
      parent_task_id: linked.id,
      target: new OperationNewRootTarget({
        type: "new_root",
        mode: "coding",
        agent: Agent.ID.make("build"),
        model: f.binding.model,
      }),
      resume: false,
    }
    const call = { type: "tool-call" as const, id: "mp02-root-linked", name: TaskTool.name, input }
    const result = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call,
    })
    expect(result.status).toBe("completed")
    const operation = Schema.decodeUnknownSync(TaskTool.OperationOutput)(result.output).operation
    expect(operation.taskID).toBe(linked.id)
    expect(yield* tasks.get(f.root.id)).toHaveLength(1)
    const prior = yield* tasks.operations({ sessionID: f.root.id })
    const changed = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { ...call, input: { ...input, prompt: "Changed root work" } },
    })
    expect(changed.status).toBe("error")
    expect(changed.output).toBeUndefined()
    expect(yield* tasks.operations({ sessionID: f.root.id })).toEqual(prior)
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 foreground root Task returns the complete durable result and settles its source Task", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const llm = yield* TestLLM.Test
    const body = "Complete root result 🚀\n" + "durable body ".repeat(450) + "\nFinal line"
    yield* llm.push(TestLLM.text(body, "mp02-foreground-root"))
    const response = yield* awaitWithTimeout(
      executeTool(registry, {
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: {
          type: "tool-call",
          id: "mp02-full-root",
          name: TaskTool.name,
          input: {
            description: "Return complete root work",
            prompt: "Finish the exact root Task",
            target: new OperationNewRootTarget({
              type: "new_root",
              mode: "chat",
              agent: Agent.ID.make("build"),
              model: f.binding.model,
            }),
          },
        },
      }),
      "The foreground root Task did not settle",
      "15 seconds",
    )
    expect(response.status).toBe("completed")
    const output = Schema.decodeUnknownSync(TaskTool.OperationOutput)(response.output)
    expect(output.output).toBe(body)
    expect(output.operation.result?.text).toBe(body)
    expect(output.operation.phase).toBe("settled")
    expect(output.operation.sourceSettlement).toBe("settled")
    expect(output.operation.result?.sharedInputs).toEqual([output.operation.inputID])
    expect(output.operation.result?.resultEventID).toBeDefined()
    expect(
      (yield* SessionTask.Service.use((tasks) => tasks.get(f.root.id))).find(
        (task) => task.id === output.operation.taskID,
      )?.status,
    ).toBe("completed")
    expect(
      (yield* f.sessions.inbox(f.root.id)).find(
        (item) =>
          item.id === TaskOperation.notificationID({ sessionID: f.root.id, operationID: output.operation.operationID }),
      ),
    ).toBeUndefined()
    expect(yield* llm.requests()).toHaveLength(1)
  }),
)

leafIt.live("MP02 background root Task admits one full notification across repeated reconciliation", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    yield* f.bus.publish(SessionEvent.Synthetic, { sessionID: f.root.id, text: "Preserve background notification" })
    const boundary = (yield* f.sessions.context(f.root.id)).find((message) => message.type === "synthetic")
    if (!boundary) return yield* Effect.die(new Error("Notification boundary missing"))
    yield* f.bus.publish(SessionEvent.RevertEvent.Staged, {
      sessionID: f.root.id,
      revert: { messageID: boundary.id, files: [] },
    })
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const llm = yield* TestLLM.Test
    const release = yield* Deferred.make<void>()
    const body = "Complete background root result 🚀\nSecond line"
    yield* llm.push(
      Stream.unwrap(
        Deferred.await(release).pipe(Effect.as(Stream.fromIterable(TestLLM.text(body, "mp02-background-root")))),
      ),
    )
    const response = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        id: "mp02-background-root",
        name: TaskTool.name,
        input: {
          description: "Background root work",
          prompt: "Finish background work",
          background: true,
          target: new OperationNewRootTarget({
            type: "new_root",
            mode: "chat",
            agent: Agent.ID.make("build"),
            model: f.binding.model,
          }),
        },
      },
    })
    expect(response.status).toBe("completed")
    const admitted = Schema.decodeUnknownSync(TaskTool.OperationOutput)(response.output).operation
    expect(admitted.phase).toBe("admitted")
    expect(admitted.result).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    const ref = { sessionID: f.root.id, operationID: admitted.operationID }
    const settled = yield* awaitWithTimeout(
      f.sessions.waitTaskOperation(ref),
      "Background result observer did not settle",
      "15 seconds",
    )
    expect(settled.result?.text).toBe(body)
    yield* f.sessions.reconcileTaskOperation(ref)
    yield* f.sessions.reconcileTaskOperation(ref)
    const notices = (yield* f.sessions.inbox(f.root.id)).filter((item) => item.id === TaskOperation.notificationID(ref))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      type: "synthetic",
      payload: { text: `<task operation="${admitted.operationID}" state="settled">\n${body}\n</task>` },
    })
    expect(yield* llm.requests()).toHaveLength(1)
  }),
)

leafIt.live("MP02 recovery admits the saved prepared payload once without recreating its target", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const tasks = yield* SessionTask.Service
    const target = yield* createLegacySession({
      location: f.root.location,
      title: "Saved root target",
      mode: "chat",
      agent: Agent.ID.make("build"),
      model: f.workerModel,
    })
    const inputID = SessionMessage.ID.create()
    const operationID = SessionTask.OperationID.create()
    const capability = yield* f.metas.assertCoordination(f.root.id, { agent: Agent.ID.make("meta"), tool: "task" })
    const reserved = yield* tasks.reserveOperation({
      sessionID: f.root.id,
      request: new SessionTask.OperationRequest({
        operationID,
        inputID,
        target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
        prompt: "Raw request",
        delivery: "queue",
        resume: false,
      }),
      source: new SessionTask.OperationUserSource({
        type: "user_coordination",
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
      }),
      selection: new SessionTask.OperationSelection({
        agent: Agent.ID.make("meta"),
        seq: capability.selection.event?.seq ?? Event.Seq.make(0),
        eventID: capability.selection.event?.id,
        compositionDigest: capability.selection.compositionDigest,
      }),
      sourceLocation: f.root.location,
      sourceMode: f.root.mode ?? "coding",
    })
    yield* tasks.attachOperationTask({ sessionID: f.root.id, operationID })
    const payload = SessionInbox.UserPayload.make({ text: "Frozen prepared body 🚀" })
    yield* tasks.advanceOperation({
      sessionID: f.root.id,
      operationID,
      change: new SessionTask.OperationChange({
        phase: "prepared",
        prepared: new SessionTask.OperationPrepared({
          payload,
          delivery: "queue",
          digest: TaskOperation.payloadDigest(payload, "queue"),
        }),
      }),
    })
    const before = (yield* f.sessions.list()).data.map((session) => session.id).toSorted()
    yield* f.sessions.recoverTaskOperations
    yield* f.sessions.recoverTaskOperations
    expect((yield* f.sessions.list()).data.map((session) => session.id).toSorted()).toEqual(before)
    const operation = yield* tasks.operation({ sessionID: f.root.id, operationID })
    expect(operation).toMatchObject({ phase: "admitted", inputID, targetSessionID: reserved.operation.targetSessionID })
    expect(operation?.admission).toBeDefined()
    expect((yield* f.sessions.inbox(target.id)).filter((item) => item.id === inputID)).toMatchObject([
      { type: "user", payload: { text: payload.text }, delivery: "queue" },
    ])
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 cancellation of a shared root input preserves the other input and its complete result", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const tasks = yield* SessionTask.Service
    const database = yield* Database.Service
    const target = yield* createLegacySession({
      location: f.root.location,
      mode: "chat",
      agent: Agent.ID.make("build"),
      model: f.binding.model,
    })
    const operation = yield* f.sessions.dispatchTask({
      sessionID: f.root.id,
      request: new SessionTask.OperationRequest({
        operationID: SessionTask.OperationID.create(),
        inputID: SessionMessage.ID.create(),
        target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
        prompt: "Shared operation work",
        delivery: "steer",
        resume: false,
      }),
    })
    const user = yield* f.sessions.prompt({ sessionID: target.id, text: "Keep this user work", resume: false })
    yield* SessionInbox.promote(database.db, f.bus, target.id, "input", undefined, { anchorInputID: operation.inputID })
    const ref = { sessionID: f.root.id, operationID: operation.operationID }
    expect(yield* SessionInputResult.current(database.db, target.id)).toMatchObject({
      inputs: [{ inputID: operation.inputID }, { inputID: user.id }],
    })
    const cancelled = yield* f.sessions.cancelTaskOperation(ref)
    expect(cancelled.phase).toBe("admitted")
    expect(cancelled.cancelIntent).toBe(true)
    expect(cancelled.error?.code).toBe("shared_input_ownership")
    expect((yield* SessionInputResult.current(database.db, target.id))?.inputs.map((entry) => entry.inputID)).toEqual([
      operation.inputID,
      user.id,
    ])
    const assistantMessageID = SessionMessage.ID.create()
    const body = "Complete shared work survives cancellation"
    yield* f.bus.publish(SessionEvent.Step.Started, {
      sessionID: target.id,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: f.workerModel,
      started: Date.now(),
    })
    yield* f.bus.publish(SessionEvent.Text.Started, { sessionID: target.id, assistantMessageID, ordinal: 0 })
    yield* f.bus.publish(SessionEvent.Text.Ended, { sessionID: target.id, assistantMessageID, ordinal: 0, text: body })
    yield* f.bus.publish(SessionEvent.Step.Ended, {
      sessionID: target.id,
      assistantMessageID,
      finish: "stop",
      needsContinuation: false,
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    yield* f.bus.publish(SessionEvent.Step.Completed, {
      sessionID: target.id,
      assistantMessageID,
      resultAnchorInputID: operation.inputID,
    })
    const settled = yield* f.sessions.reconcileTaskOperation(ref)
    expect(settled?.phase).toBe("settled")
    expect(settled?.result?.text).toBe(body)
    expect(settled?.result?.sharedInputs).toEqual([operation.inputID, user.id])
    expect(yield* SessionInputResult.read(database.db, { sessionID: target.id, inputID: user.id })).toMatchObject({
      status: "completed",
      assistant: { id: assistantMessageID },
    })
    expect((yield* tasks.operation(ref))?.result?.text).toBe(body)
  }),
)

leafIt.live("MP02 deleted root targets settle their source Task and retain one full failure notification", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    yield* f.bus.publish(SessionEvent.Synthetic, { sessionID: f.root.id, text: "Preserve target deletion notice" })
    const boundary = (yield* f.sessions.context(f.root.id)).find((message) => message.type === "synthetic")
    if (!boundary) return yield* Effect.die(new Error("Deletion notice boundary missing"))
    yield* f.bus.publish(SessionEvent.RevertEvent.Staged, {
      sessionID: f.root.id,
      revert: { messageID: boundary.id, files: [] },
    })
    const target = yield* createLegacySession({
      location: f.root.location,
      mode: "chat",
      agent: Agent.ID.make("build"),
      model: f.binding.model,
    })
    const operation = yield* f.sessions.dispatchTask({
      sessionID: f.root.id,
      request: new SessionTask.OperationRequest({
        operationID: SessionTask.OperationID.create(),
        inputID: SessionMessage.ID.create(),
        target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
        prompt: "Hold work until explicitly resumed",
        delivery: "queue",
        resume: false,
      }),
    })
    yield* f.sessions.remove(target.id)
    const ref = { sessionID: f.root.id, operationID: operation.operationID }
    const settled = yield* f.sessions.reconcileTaskOperation(ref)
    expect(settled).toMatchObject({
      phase: "failed",
      sourceSettlement: "settled",
      error: { code: "target_unavailable" },
      result: { text: "The target Session was deleted" },
    })
    yield* f.sessions.reconcileTaskOperation(ref)
    const notices = (yield* f.sessions.inbox(f.root.id)).filter((item) => item.id === TaskOperation.notificationID(ref))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      type: "synthetic",
      payload: {
        text: `<task operation="${operation.operationID}" state="failed">\nThe target Session was deleted\n</task>`,
      },
    })
    expect(
      (yield* SessionTask.Service.use((tasks) => tasks.get(f.root.id))).find((task) => task.id === operation.taskID)
        ?.status,
    ).toBe("failed")
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 waiting root operations execute in order and claim the current edited Task revision", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const tasks = yield* SessionTask.Service
    yield* f.bus.publish(SessionEvent.Synthetic, { sessionID: f.root.id, text: "Keep followup receipts" })
    const boundary = (yield* f.sessions.context(f.root.id)).find((message) => message.type === "synthetic")
    if (!boundary) return yield* Effect.die(new Error("Followup notice boundary missing"))
    yield* f.bus.publish(SessionEvent.RevertEvent.Staged, {
      sessionID: f.root.id,
      revert: { messageID: boundary.id, files: [] },
    })
    const target = yield* createLegacySession({
      location: f.root.location,
      title: "Saved waiting target",
      mode: "chat",
      agent: Agent.ID.make("build"),
      model: f.binding.model,
    })
    const [source] = yield* tasks.append({
      sessionID: f.root.id,
      tasks: [{ content: "Original Task", status: "pending", priority: "medium" }],
    })
    const llm = yield* TestLLM.Test
    const release = yield* Deferred.make<void>()
    yield* llm.push(
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text("First complete result", "mp02-waiting-a"))),
        ),
      ),
      TestLLM.text("Second complete result", "mp02-waiting-b"),
    )
    const request = (prompt: string, revision: number) =>
      new SessionTask.OperationRequest({
        operationID: SessionTask.OperationID.create(),
        inputID: SessionMessage.ID.create(),
        target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
        taskID: source.id,
        expectedRevision: revision,
        prompt,
        delivery: "queue",
        resume: true,
      })
    const first = yield* f.sessions.dispatchTask({
      sessionID: f.root.id,
      request: request("First work", source.revision),
    })
    if (first.taskRevision === undefined) return yield* Effect.die(new Error("First Task revision missing"))
    const second = yield* f.sessions.dispatchTask({
      sessionID: f.root.id,
      request: request("Second work", first.taskRevision),
    })
    expect(second.phase).toBe("waiting")
    expect(second.predecessorID).toBe(first.operationID)
    const edited = yield* tasks.updateTask({ sessionID: f.root.id, id: source.id, content: "User edited waiting Task" })
    if (!edited) return yield* Effect.die(new Error("Waiting Task edit missing"))
    const waiting = yield* f.sessions
      .waitTaskOperation({ sessionID: f.root.id, operationID: second.operationID })
      .pipe(Effect.forkScoped)
    yield* Deferred.succeed(release, undefined)
    const complete = yield* awaitWithTimeout(
      Fiber.join(waiting),
      "The waiting Task did not run after its predecessor",
      "15 seconds",
    )
    expect(complete).toMatchObject({
      phase: "settled",
      sourceSettlement: "settled",
      result: { text: "Second complete result" },
    })
    expect(complete.taskRevision).toBe(edited.revision + 1)
    expect((yield* tasks.get(f.root.id))[0]).toMatchObject({ content: edited.content, status: "completed" })
    expect((yield* tasks.operation({ sessionID: f.root.id, operationID: first.operationID }))?.sourceSettlement).toBe(
      "conflict",
    )
    expect(yield* llm.requests()).toHaveLength(2)
  }),
)

leafIt.live(
  "MP02 cancelling an exclusively promoted root input interrupts its real execution and settles the result",
  () =>
    Effect.gen(function* () {
      const f = yield* metaLeaf()
      const llm = yield* TestLLM.Test
      const body = "SC02 first Step completed read"
      const file = path.join(f.root.location.directory, "sc02-next-step.txt")
      yield* Effect.promise(() => Bun.write(file, body))
      yield* llm.push(TestLLM.tool("sc02-read", "read", { path: file }), Stream.never)
      const target = yield* createLegacySession({
        location: f.root.location,
        title: "SC02 next-Step cancellation",
        mode: "chat",
        agent: Agent.ID.make("build"),
        model: f.binding.model,
      })
      const operation = yield* f.sessions.dispatchTask(
        {
          sessionID: f.root.id,
          request: new SessionTask.OperationRequest({
            operationID: SessionTask.OperationID.create(),
            inputID: SessionMessage.ID.create(),
            target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
            prompt: "Held exclusive work",
            delivery: "queue",
            resume: true,
          }),
        },
        {
          source: new SessionTask.OperationToolSource({
            type: "model_tool",
            sessionID: f.root.id,
            agent: Agent.ID.make("meta"),
            messageID: toolIdentity.messageID,
            id: "mp02-exclusive-stop",
          }),
        },
      )
      yield* awaitWithTimeout(llm.wait(2), "The exclusive target did not reach its next Step", "10 seconds")
      const requests = yield* llm.requests()
      expect(requests).toHaveLength(2)
      expect(JSON.stringify(requests[1]?.messages)).toContain(body)
      expect(JSON.stringify(requests[1]?.messages)).toContain("sc02-read")
      const database = yield* Database.Service
      expect((yield* SessionInputResult.current(database.db, target.id))?.inputs.map((entry) => entry.inputID)).toEqual(
        [operation.inputID],
      )
      const ref = { sessionID: f.root.id, operationID: operation.operationID }
      yield* awaitWithTimeout(
        f.sessions.cancelTaskOperation(ref),
        "The next-Step cancellation was not acknowledged",
        "10 seconds",
      )
      yield* awaitWithTimeout(
        SessionExecution.Service.use((execution) => execution.awaitIdle(target.id)),
        "Target cancellation did not settle",
        "10 seconds",
      )
      const result = yield* f.sessions.reconcileTaskOperation(ref)
      expect(result).toMatchObject({
        phase: "cancelled",
        cancelIntent: true,
        sourceSettlement: "settled",
        result: { text: "Task execution was interrupted", sharedInputs: [operation.inputID] },
      })
      expect(yield* SessionExecution.Service.use((execution) => execution.isActive(target.id))).toBe(false)
      expect(yield* llm.requests()).toHaveLength(2)
      const events = yield* f.bus.log({ aggregateID: target.id }).pipe(Stream.runCollect)
      expect(events.filter((event) => event.type === SessionEvent.Step.Started.type)).toHaveLength(2)
      expect(events.filter((event) => event.type === SessionEvent.Step.Completed.type)).toHaveLength(1)
      expect(events.filter((event) => event.type === SessionEvent.Tool.Success.type)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            id: "sc02-read",
            content: [expect.objectContaining({ type: "text", text: expect.stringContaining(body) })],
          }),
        }),
      ])
      expect(events.filter((event) => event.type === SessionEvent.Execution.Interrupted.type)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: "user", resultAnchorInputID: operation.inputID }),
        }),
      ])
      expect(
        events.filter(
          (event) =>
            event.type === SessionEvent.Execution.Succeeded.type || event.type === SessionEvent.Execution.Failed.type,
        ),
      ).toEqual([])
    }),
)

leafIt.live("MP02 explicit root replacement preserves input history, queue siblings, and exact retries", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const tasks = yield* SessionTask.Service
    const database = yield* Database.Service
    const llm = yield* TestLLM.Test
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    yield* llm.push(Stream.never)
    // A fixed title keeps the held response assigned to the primary request.
    const target = yield* createLegacySession({
      location: f.root.location,
      title: "Replacement root target",
      mode: "chat",
      agent: Agent.ID.make("build"),
      model: f.binding.model,
    })
    const first = yield* f.sessions.dispatchTask(
      {
        sessionID: f.root.id,
        request: new SessionTask.OperationRequest({
          operationID: SessionTask.OperationID.create(),
          inputID: SessionMessage.ID.create(),
          target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
          prompt: "Held work to replace",
          delivery: "queue",
          resume: true,
        }),
      },
      {
        source: new SessionTask.OperationToolSource({
          type: "model_tool",
          sessionID: f.root.id,
          agent: Agent.ID.make("meta"),
          messageID: toolIdentity.messageID,
          id: "mp02-replaced-root",
        }),
      },
    )
    yield* awaitWithTimeout(llm.wait(1), "The input to replace did not start", "10 seconds")
    if (first.taskID === undefined || first.taskRevision === undefined)
      return yield* Effect.die(new Error("The original root Task has no claim"))
    const sibling = yield* f.sessions.prompt({
      sessionID: target.id,
      text: "Keep queued sibling",
      delivery: "queue",
      resume: false,
    })
    const prefix = yield* f.bus.log({ aggregateID: target.id }).pipe(
      Stream.filter((item) => !Bus.isSynced(item) && item.durable !== undefined),
      Stream.runCollect,
    )
    const firstRef = { sessionID: f.root.id, operationID: first.operationID }
    const input = {
      description: "Replace root work",
      prompt: "Independent replacement work",
      target: new OperationExistingRootTarget({ type: "existing_root", sessionID: target.id }),
      replacesOperationID: first.operationID,
      parent_task_id: first.taskID,
      resume: false,
    }
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "task", resource: "*", effect: "deny" }],
    })
    const denied = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { type: "tool-call", id: "mp02-denied-replacement", name: TaskTool.name, input },
    })
    expect(denied.status).toBe("error")
    expect(yield* tasks.operation(firstRef)).toEqual(first)
    expect(yield* SessionExecution.Service.use((execution) => execution.isActive(target.id))).toBe(true)
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const call = { type: "tool-call" as const, id: "mp02-explicit-replacement", name: TaskTool.name, input }
    const response = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call,
    })
    expect(response.status).toBe("completed")
    const replacement = Schema.decodeUnknownSync(TaskTool.OperationOutput)(response.output).operation
    expect(replacement).toMatchObject({
      phase: "admitted",
      taskID: first.taskID,
      taskRevision: first.taskRevision + 2,
      request: { replacesOperationID: first.operationID },
    })
    expect(replacement.operationID).not.toBe(first.operationID)
    expect(replacement.inputID).not.toBe(first.inputID)
    const superseded = yield* tasks.operation(firstRef)
    expect(superseded).toMatchObject({
      phase: "superseded",
      cancelIntent: true,
      inputID: first.inputID,
      targetSessionID: target.id,
      sourceSettlement: "settled",
    })
    yield* awaitWithTimeout(
      SessionExecution.Service.use((execution) => execution.awaitIdle(target.id)),
      "Replacement did not stop its exclusive predecessor",
      "10 seconds",
    )
    expect(yield* SessionInputResult.read(database.db, { sessionID: target.id, inputID: first.inputID })).toMatchObject(
      { status: "interrupted", sharedInputs: [first.inputID] },
    )
    expect((yield* f.sessions.inbox(target.id)).map((item) => item.id)).toEqual([sibling.id, replacement.inputID])
    expect(
      (yield* f.bus.log({ aggregateID: target.id }).pipe(
        Stream.filter((item) => !Bus.isSynced(item) && item.durable !== undefined),
        Stream.runCollect,
      )).slice(0, prefix.length),
    ).toEqual(prefix)
    const repeated = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call,
    })
    expect(repeated.output).toEqual(response.output)
    expect(yield* tasks.operation(firstRef)).toEqual(superseded)
    const changed = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { ...call, input: { ...input, replacesOperationID: replacement.operationID } },
    })
    expect(changed.status).toBe("error")
    expect(yield* tasks.operation(firstRef)).toEqual(superseded)
    expect(yield* llm.requests()).toHaveLength(1)
    const body = "Complete independent replacement result\n" + "retained body ".repeat(50)
    yield* llm.push(
      TestLLM.text("Queued sibling result", "mp02-replacement-sibling"),
      TestLLM.text(body, "mp02-replacement-result"),
    )
    yield* awaitWithTimeout(f.sessions.resume(target.id), "The replacement work did not settle", "15 seconds")
    const completed = yield* f.sessions.reconcileTaskOperation({
      sessionID: f.root.id,
      operationID: replacement.operationID,
    })
    expect(completed).toMatchObject({ phase: "settled", result: { text: body, sharedInputs: [replacement.inputID] } })
    const after = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        ...call,
        id: "mp02-replace-completed",
        input: { ...input, replacesOperationID: replacement.operationID, prompt: "Work after a saved result" },
      },
    })
    expect(after.status).toBe("completed")
    expect(yield* tasks.operation({ sessionID: f.root.id, operationID: replacement.operationID })).toEqual(completed)
    expect(yield* tasks.operation(firstRef)).toEqual(superseded)
    expect(yield* llm.requests()).toHaveLength(3)
  }),
)

leafIt.live("MP04 Meta Goal tool saves, reads and pauses a persistent objective with no execution retry", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const llm = yield* TestLLM.Test
    yield* llm.push(TestLLM.text("Work ready for user acceptance", "mp04-goal-entry"))
    const call = {
      type: "tool-call" as const,
      name: GoalTool.name,
      id: "mp04-goal-set",
      input: {
        action: "set",
        objective: "Finish the accepted work",
        conditions: [{ id: "acceptance", kind: "human_acceptance", description: "User accepts the complete work" }],
        budget: {},
      },
    }
    const first = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call,
    })
    expect(first.status).toBe("completed")
    const output = Schema.decodeUnknownSync(GoalTool.Output)(first.output)
    const goal = output.data[0]
    if (!goal) return yield* Effect.die(new Error("Goal tool did not save its Goal"))
    expect(goal.objective).toBe(call.input.objective)
    const repeated = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call,
    })
    expect(repeated.status).toBe("completed")
    expect(Schema.decodeUnknownSync(GoalTool.Output)(repeated.output).data[0]?.id).toBe(goal.id)
    yield* SessionExecution.Service.use((execution) => execution.awaitIdle(f.root.id))
    expect(yield* SessionGoal.Service.use((goals) => goals.list(f.root.id))).toHaveLength(1)
    const paused = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        name: GoalTool.name,
        id: "mp04-goal-pause",
        input: { action: "pause", goalID: goal.id, expectedRevision: goal.revision },
      },
    })
    expect(paused.status).toBe("completed")
    expect(Schema.decodeUnknownSync(GoalTool.Output)(paused.output).data[0]).toMatchObject({
      status: "paused",
      pauseReason: "user",
    })
    expect(yield* llm.requests()).toHaveLength(1)
    yield* f.sessions.switchAgent({ sessionID: f.root.id, agent: Agent.ID.make("build") })
    expect(
      Exit.isFailure(
        yield* registry.snapshot().pipe(
          Effect.flatMap((snapshot) =>
            snapshot.execute({
              sessionID: f.root.id,
              agent: Agent.ID.make("meta"),
              messageID: toolIdentity.messageID,
              call: { type: "tool-call", name: GoalTool.name, id: "mp04-stale-goal", input: { action: "list" } },
            }),
          ),
          Effect.exit,
        ),
      ),
    ).toBe(true)
  }),
)

leafIt.live("MP05 Meta Schedule tool creates a real reminder and changes the saved rule revision", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const first = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        name: ScheduleTool.name,
        id: "mp05-schedule-create",
        input: {
          action: "create",
          kind: "reminder",
          content: "Check the accepted work",
          dueAt: Date.now() + 60_000,
          timezone: "UTC",
        },
      },
    })
    expect(first.status).toBe("completed")
    const rule = Schema.decodeUnknownSync(ScheduleTool.Output)(first.output).data[0]
    if (!rule) return yield* Effect.die(new Error("Schedule tool did not save its rule"))
    expect((yield* ScheduleService.Service.use((schedules) => schedules.getRule(rule.id)))?.content).toBe(rule.content)
    const paused = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        name: ScheduleTool.name,
        id: "mp05-schedule-pause",
        input: { action: "pause", scheduleID: rule.id, expectedRevision: rule.revision },
      },
    })
    expect(paused.status).toBe("completed")
    expect(Schema.decodeUnknownSync(ScheduleTool.Output)(paused.output).data[0]).toMatchObject({
      status: "paused",
      revision: rule.revision + 1,
    })
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 captured Meta Task root calls lose capability after switching the source to Build", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const snapshot = yield* registry.snapshot()
    yield* f.sessions.switchAgent({ sessionID: f.root.id, agent: Agent.ID.make("build") })
    const before = yield* f.read()
    const result = yield* snapshot
      .execute({
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: {
          type: "tool-call",
          id: "mp02-stale-meta-root",
          name: TaskTool.name,
          input: {
            description: "Stale captured Meta task",
            prompt: "Try the old Meta root capability",
            target: new OperationNewRootTarget({
              type: "new_root",
              mode: "coding",
              agent: Agent.ID.make("build"),
              model: f.binding.model,
            }),
            resume: false,
          },
        },
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* SessionTask.Service.use((tasks) => tasks.operations({ sessionID: f.root.id }))).toEqual([])
    expect(yield* f.read()).toEqual(before)
  }),
)

leafIt.live("MP02 root Task permission denial retains failure instead of an admission success", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "task", resource: "*", effect: "deny" }],
    })
    const result = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        id: "mp02-denied-root",
        name: TaskTool.name,
        input: {
          description: "Denied root task",
          prompt: "Retain the operation permission failure",
          target: new OperationNewRootTarget({
            type: "new_root",
            mode: "coding",
            agent: Agent.ID.make("build"),
            model: f.binding.model,
          }),
        },
      },
    })
    expect(result.status).toBe("error")
    expect(result.output).toBeUndefined()
    const operations = yield* SessionTask.Service.use((tasks) => tasks.operations({ sessionID: f.root.id }))
    expect(operations).toHaveLength(1)
    expect(operations[0].phase).toBe("blocked")
    expect(operations[0].error).toBeDefined()
    expect(operations[0].request.resume).toBe(true)
    expect(operations[0].request.delivery).toBe("queue")
    expect(yield* SessionTask.Service.use((tasks) => tasks.get(f.root.id))).toEqual([])
    expect(yield* TestLLM.Test.use((llm) => llm.requests())).toEqual([])
  }),
)

leafIt.live("MP02 Task rejects root and legacy controls together before reserving an operation", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf()
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const before = yield* f.read()
    yield* Effect.forEach(
      [
        {
          target: new OperationNewRootTarget({
            type: "new_root",
            mode: "coding",
            agent: Agent.ID.make("build"),
            model: f.binding.model,
          }),
          subagent_type: "build",
          resume: false,
        },
        { subagent_type: "build", resume: false },
        { subagent_type: "build", replacesOperationID: SessionTask.OperationID.create() },
      ],
      (input) =>
        Effect.gen(function* () {
          const result = yield* executeTool(registry, {
            sessionID: f.root.id,
            agent: Agent.ID.make("meta"),
            messageID: toolIdentity.messageID,
            call: {
              type: "tool-call",
              id: "mp02-conflicting-root",
              name: TaskTool.name,
              input: {
                description: "Conflicting target controls",
                prompt: "Keep the execution route explicit",
                ...input,
              },
            },
          })
          expect(result.status).toBe("error")
        }),
    )
    expect(yield* SessionTask.Service.use((tasks) => tasks.operations({ sessionID: f.root.id }))).toEqual([])
    expect(yield* f.read()).toEqual(before)
  }),
)

leafIt.live("MC08 J1 dispatches the same real agent on distinct actual models with independent worker Tasks", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    const before = yield* f.delegations.list({ parentSessionID: f.root.id })
    const bodies = ["Exact worker A body 🚀\nA second line.", "Exact worker B body\nB second line."]
    yield* f.llm.serve((request) =>
      TestLLM.text(request.model.id === "worker" ? bodies[0] : bodies[1], request.model.id),
    )
    const result = yield* f.execute()
    if (result.status === "error") console.info("MC08_J1_REJECTED_TOOL_RESULT", JSON.stringify(result))
    expect(result.status).toBe("completed")
    const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
    expect(output.status).toBe("completed")
    expect(output.arbitration).toBe("none")
    expect(output.taskSettlement).toBe("updated")
    expect(output.source).toEqual({ type: "tool", messageID: toolIdentity.messageID, id: "mc08-j1-judge" })
    expect(output.input).toEqual({ text: f.input.prompt })
    expect(output.workers.map((worker) => worker.text)).toEqual(bodies)
    expect(output.workers.map((worker) => worker.runtime?.id)).toEqual(["worker", "meta"])
    expect(output.workers.map((worker) => worker.runtime?.provider)).toEqual(["meta-leaf-keeper", "meta-leaf-keeper"])
    expect(new Set(output.workers.map((worker) => worker.delegationID)).size).toBe(2)
    expect(
      new Set(output.workers.flatMap((worker) => (worker.receipt ? [worker.receipt.childSessionID] : []))).size,
    ).toBe(2)
    expect((yield* f.delegations.list({ parentSessionID: f.root.id })).length).toBe(before.length + 2)
    const tasks = yield* f.tasks.get(f.root.id)
    expect(tasks).toHaveLength(3)
    expect(tasks.find((task) => task.id === output.parentTaskID)).toMatchObject({ status: "completed", revision: 2 })
    for (const worker of output.workers) {
      const receipt = worker.receipt
      if (!receipt) return yield* Effect.die(new Error("Judge worker has no exact receipt"))
      expect(tasks.find((task) => task.id === worker.taskID)).toMatchObject({
        parentID: output.parentTaskID,
        status: "completed",
        revision: 2,
        outputDigest: worker.text,
      })
      expect(receipt).toMatchObject({
        delegationID: worker.delegationID,
        participantID: worker.participantID,
        turnID: worker.turnID,
      })
      const state = yield* f.delegations.foldState(receipt.delegationID)
      expect(state?.participants.get(receipt.participantID)).toMatchObject({
        provider: "internal",
        target: "build",
        role: "reviewer",
        context: "fresh",
        executor: worker.executor,
      })
      expect(state?.reviews).toEqual([])
      const child = yield* f.sessions.get(receipt.childSessionID)
      expect(child.mode).toBe("work")
      expect(child.controller).toMatchObject({ kind: "child", executor: worker.executor })
      expect(worker.executor.source).toBe("tool")
      const user = (yield* f.sessions.context(child.id)).find((message) => message.id === receipt.inputID)
      expect(user).toMatchObject({
        type: "user",
        text: f.input.prompt,
        metadata: { task: { parentTaskID: worker.taskID, parentTaskRevision: 1, source: output.source } },
      })
      expect(worker.completion).toMatchObject({ finish: "stop", model: worker.executor.model })
      expect(worker.status).toBe("completed")
      expect(worker.source).toEqual(output.source)
    }
    expect((yield* f.llm.requests()).map((request) => String(request.model.id)).sort()).toEqual(["meta", "worker"])
    expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    expect(yield* f.sessions.get(f.root.id)).toMatchObject({
      agent: f.root.agent,
      mode: f.root.mode,
      controller: f.root.controller,
      model: f.root.model,
      executorPreference: f.root.executorPreference,
    })
    console.info("MC08_J1_EXACT_WORKERS", JSON.stringify(output))
  }),
)

const judgeReceipts = Effect.fnUntraced(function* (f: Effect.Success<ReturnType<typeof judgeLeaf>>) {
  const states = yield* f.delegations.list({ parentSessionID: f.root.id })
  const participants = states.flatMap((state) =>
    [...(state?.participants.values() ?? [])].filter((participant) => participant.executor?.source === "tool"),
  )
  return yield* Effect.forEach(participants, (participant) =>
    Effect.gen(function* () {
      if (!participant?.childSessionID) return yield* Effect.die(new Error("Judge child is missing"))
      const user = (yield* f.sessions.context(participant.childSessionID)).find((message) => message.type === "user")
      if (!user) return yield* Effect.die(new Error("Judge input is missing"))
      return Schema.decodeUnknownSync(Delegation.Receipt)(
        Object.assign({}, user.metadata?.delegation, { childSessionID: participant.childSessionID, inputID: user.id }),
      )
    }),
  )
})

leafIt.live("MA01 Meta claims a real Build Task for its admitted input and rejects another source", () =>
  Effect.gen(function* () {
    const f = yield* metaLeaf("work")
    yield* f.sessions.setPermissions({
      sessionID: f.root.id,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    const tasks = yield* SessionTask.Service
    const registry = yield* Tool.Service.pipe(Effect.provide(f.local))
    const llm = yield* TestLLM.Test
    const kv = yield* KV.Service
    const release = yield* Deferred.make<void>()
    yield* llm.push(
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text("Build finished the real Task", "ma01-build"))),
        ),
      ),
    )
    const input = {
      description: "Build a real owned Task",
      prompt: "Finish this exact task.",
      subagent_type: "build",
      delegation_id: f.delegation.id,
      participant_id: f.participant.id,
    }
    const running = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { type: "tool-call", id: "ma01-task-owner", name: TaskTool.name, input },
    }).pipe(Effect.forkIn(yield* Effect.scope))
    yield* awaitWithTimeout(llm.wait(1), "MA01 Build did not start", "10 seconds")
    const enqueued = (yield* f.sessions.log({ sessionID: f.child.id }).pipe(Stream.runCollect)).find(
      (event): event is SessionEvent.InboxEnqueued => event.type === SessionEvent.InboxEnqueued.type,
    )
    if (!enqueued || enqueued.data.item.type !== "user")
      return yield* Effect.die(new Error("The real Build Task input admission is missing"))
    const captured = {
      link: Schema.decodeUnknownSync(
        Schema.Struct({
          parentTaskID: Schema.String,
          parentTaskRevision: Schema.Int,
          source: Permission.ToolSource,
        }),
      )(enqueued.data.item.payload.metadata?.task),
      childID: enqueued.data.sessionID,
    }
    expect(enqueued.data.item.payload.text).toBe(input.prompt)
    expect(captured.link.source).toEqual({ type: "tool", messageID: toolIdentity.messageID, id: "ma01-task-owner" })
    expect(yield* kv.get(`task:claim:${f.root.id}:${captured.link.parentTaskID}`)).toEqual(captured.link)
    const manager = { type: "tool" as const, messageID: toolIdentity.messageID, id: "ma01-task-manager" }
    const update = yield* tasks
      .updateTask(
        {
          sessionID: f.root.id,
          id: captured.link.parentTaskID,
          status: "completed",
        },
        { management: manager },
      )
      .pipe(Effect.result)
    expect(update._tag).toBe("Failure")
    if (update._tag === "Failure") expect(update.failure.reason).toBe("execution_owned")
    const competing = yield* executeTool(registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: {
        type: "tool-call",
        id: "ma01-competing-task",
        name: TaskTool.name,
        input: { ...input, parent_task_id: captured.link.parentTaskID },
      },
    })
    expect(competing.status).toBe("error")
    expect(competing.error?.message).toContain("owned by unsettled execution")
    expect(yield* llm.requests()).toHaveLength(1)
    yield* Deferred.succeed(release, undefined)
    const completed = yield* awaitWithTimeout(Fiber.join(running), "MA01 Build did not settle", "10 seconds")
    expect(completed.status).toBe("completed")
    expect(completed.metadata).toMatchObject({
      parentTaskID: captured.link.parentTaskID,
      parentTaskRevision: captured.link.parentTaskRevision,
    })
    expect(yield* f.sessions.get(captured.childID)).toMatchObject({
      parentID: f.root.id,
      mode: "work",
      controller: { kind: "child", executor: f.binding },
    })
    expect(yield* kv.get(`task:claim:${f.root.id}:${captured.link.parentTaskID}`)).toBeUndefined()
    const editable = yield* tasks.updateTask(
      {
        sessionID: f.root.id,
        id: captured.link.parentTaskID,
        content: "Meta updated the settled plan",
      },
      { management: manager },
    )
    expect(editable?.content).toBe("Meta updated the settled plan")
  }),
)

for (const closure of ["domain", "execution"] as const) {
  leafIt.live(`MA01 releases a claimed Task when ${closure} close wins before dispatch admission`, () =>
    Effect.gen(function* () {
      const f = yield* metaLeaf("work")
      const tasks = yield* SessionTask.Service
      const execution = yield* DelegationExecution.Service
      const kv = yield* KV.Service
      const llm = yield* TestLLM.Test
      const source = { type: "tool" as const, messageID: toolIdentity.messageID, id: `ma01-close-${closure}` }
      const ready = yield* Deferred.make<{ task: SessionTask.Info; turn: Delegation.TurnInfo }>()
      const release = yield* Deferred.make<void>()
      const staged = yield* Effect.gen(function* () {
        const task = (yield* tasks.append(
          {
            sessionID: f.root.id,
            tasks: [{ content: "Close before admission", status: "in_progress", priority: "medium" }],
          },
          { claim: source },
        )).at(-1)
        if (!task) return yield* Effect.die(new Error("MA01 pre-admission Task is missing"))
        const turn = yield* f.delegations.appendTurn({
          delegationID: f.delegation.id,
          kind: "task",
          promptSummary: task.content,
          participantIDs: [f.participant.id],
          delivery: "steer",
          origin: { deliveryOrigin: "meta", senderParticipantID: f.participant.id },
        })
        yield* Deferred.succeed(ready, { task, turn })
        yield* Deferred.await(release)
        return yield* execution
          .dispatch({
            delegationID: f.delegation.id,
            turnID: turn.id,
            prompt: "This input must never be admitted.",
            task: {
              parentTaskID: task.id,
              parentTaskRevision: task.revision,
              description: task.content,
              background: false,
              source,
            },
          })
          .pipe(Effect.result)
      }).pipe(Effect.forkIn(yield* Effect.scope))
      const admission = yield* awaitWithTimeout(
        Deferred.await(ready),
        "MA01 pre-admission window is missing",
        "10 seconds",
      )
      expect(yield* kv.get(`task:claim:${f.root.id}:${admission.task.id}`)).toEqual({
        parentTaskID: admission.task.id,
        parentTaskRevision: admission.task.revision,
        source,
      })
      if (closure === "domain")
        yield* f.delegations.close({ delegationID: f.delegation.id, reason: "Close before dispatch" })
      if (closure === "execution")
        yield* execution.close({ delegationID: f.delegation.id, reason: "Close before dispatch" })
      yield* Deferred.succeed(release, undefined)
      const result = yield* awaitWithTimeout(Fiber.join(staged), "MA01 closed dispatch stayed locked", "10 seconds")
      if (closure === "domain") expect(result._tag).toBe("Failure")
      if (closure === "execution") {
        expect(result._tag).toBe("Success")
        if (result._tag === "Success") expect(result.success).toEqual([])
      }
      expect(yield* kv.get(`task:claim:${f.root.id}:${admission.task.id}`)).toBeUndefined()
      expect((yield* tasks.get(f.root.id))[0]).toMatchObject({ id: admission.task.id, status: "cancelled" })
      const editable = yield* tasks.updateTask(
        { sessionID: f.root.id, id: admission.task.id, content: "Released plan" },
        {
          management: { type: "tool", messageID: toolIdentity.messageID, id: "ma01-close-manager" },
        },
      )
      expect(editable?.content).toBe("Released plan")
      expect(yield* f.sessions.inbox(f.child.id)).toEqual([])
      expect(yield* llm.requests()).toEqual([])
    }),
  )
}

for (const invalid of ["missing", "disabled", "variant", "alias", "variant_alias"] as const) {
  leafIt.live(`MC08 J1 rejects the entire batch before admission for ${invalid} models`, () =>
    Effect.gen(function* () {
      const f = yield* judgeLeaf()
      if (invalid === "disabled" || invalid === "alias")
        yield* f.models.transform((editor) =>
          editor.update(f.metaModel.providerID, f.metaModel.id, (model) => {
            if (invalid === "disabled") {
              model.enabled = false
              return
            }
            model.modelID = f.workerModel.id
          }),
        )
      if (invalid === "variant_alias")
        yield* f.models.transform((editor) =>
          editor.update(f.workerModel.providerID, f.workerModel.id, (model) => {
            model.variants = [{ id: Model.VariantID.make("review"), settings: {} }]
          }),
        )
      const judge_models =
        invalid === "missing"
          ? [f.input.judge_models[0], "meta-leaf-keeper/missing"]
          : invalid === "variant"
            ? [f.input.judge_models[0], "meta-leaf-keeper/meta#missing"]
            : invalid === "variant_alias"
              ? [f.input.judge_models[0], `${f.input.judge_models[0]}#review`]
              : f.input.judge_models
      const before = yield* f.read()
      const result = yield* f.execute({ judge_models })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain(
        invalid === "variant"
          ? "Variant unavailable"
          : invalid === "alias" || invalid === "variant_alias"
            ? "distinct actual provider/API models"
            : "Executor model is unavailable",
      )
      expect(yield* f.read()).toEqual(before)
      expect(yield* f.tasks.get(f.root.id)).toEqual([])
      expect(yield* f.llm.requests()).toEqual([])
    }),
  )
}

leafIt.live(
  "MC08 J1 preserves a completed sibling and the full body when another model fails after partial output",
  () =>
    Effect.gen(function* () {
      const f = yield* judgeLeaf()
      const body = `approved is worker text\n${"full body ".repeat(480)}\nExact final line 🚀`
      yield* f.llm.serve((request) =>
        request.model.id === "worker"
          ? TestLLM.text(body, "judge-success")
          : TestLLM.failAfter(
              new AIError({ reason: new InvalidRequestError({ message: "Judge B rejected the request" }) }),
              LLMEvent.textStart({ id: "partial" }),
              LLMEvent.textDelta({ id: "partial", text: "FAILED_PARTIAL_BODY" }),
            ),
      )
      const result = yield* f.execute()
      expect(result.status).toBe("completed")
      const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
      expect(output.status).toBe("failed")
      expect(output.arbitration).toBe("none")
      expect(output.workers.map((worker) => worker.status)).toEqual(["completed", "failed"])
      expect(output.workers[0]?.text).toBe(body)
      expect(output.workers[1]?.text).toContain("Judge B rejected the request")
      expect(output.workers[1]?.text).not.toContain("FAILED_PARTIAL_BODY")
      expect(output.workers[1]?.completion).toBeUndefined()
      const text = result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(TaskTool.JudgeOutput))(text)).toEqual(output)
      expect(text).toContain(JSON.stringify(body).slice(1, -1))
      const tasks = yield* f.tasks.get(f.root.id)
      expect(tasks.find((task) => task.id === output.parentTaskID)).toMatchObject({ status: "failed", revision: 2 })
      for (const worker of output.workers) {
        expect(String(tasks.find((task) => task.id === worker.taskID)?.status)).toBe(worker.status)
        expect((yield* f.delegations.foldState(worker.delegationID))?.reviews).toEqual([])
      }
      expect(tasks.find((task) => task.id === output.workers[0]?.taskID)?.outputDigest?.length).toBe(4096)
      expect(yield* f.llm.requests()).toHaveLength(2)
      expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    }),
)

leafIt.live(
  "MC08 R1 leaves unrequested enhancements absent and resolves an omitted summary model through the saved executor",
  () =>
    Effect.gen(function* () {
      const f = yield* judgeLeaf()
      yield* f.llm.serve((request) =>
        TestLLM.stop(
          ...[`Exact ${request.model.id} body`, "", `Second ${request.model.id} body`].flatMap((text, index) => [
            LLMEvent.textStart({ id: `r1-default-${index}` }),
            LLMEvent.textDelta({ id: `r1-default-${index}`, text }),
            LLMEvent.textEnd({ id: `r1-default-${index}` }),
          ]),
        ),
      )
      const plain = Schema.decodeUnknownSync(TaskTool.JudgeOutput)((yield* f.execute()).output)
      expect(plain.arbitration).toBe("none")
      expect(plain.summary).toBeUndefined()
      expect(plain.workers.map((worker) => worker.text)).toEqual([
        "Exact worker body\n\nSecond worker body",
        "Exact meta body\n\nSecond meta body",
      ])
      expect(yield* f.llm.requests()).toHaveLength(2)
      const result = yield* f.execute({ summary: {} })
      expect(result.status).toBe("completed")
      const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
      expect(output.arbitration).toBe("none")
      expect(output.summary).toMatchObject({
        status: "completed",
        result: { executor: f.binding, text: "Exact worker body\n\nSecond worker body" },
      })
      expect(output.summary?.requested).toBeUndefined()
      expect(yield* f.llm.requests()).toHaveLength(5)
    }),
)

for (const invalid of ["model", "variant"] as const) {
  leafIt.live(`MC08 R1 retains the original Judge packet when explicit enhancement ${invalid} is unavailable`, () =>
    Effect.gen(function* () {
      const f = yield* judgeLeaf()
      const requested = Model.Ref.make({
        providerID: f.metaModel.providerID,
        id: Model.ID.make(invalid === "model" ? "missing" : "worker"),
        ...(invalid === "variant" ? { variant: Model.VariantID.make("missing") } : {}),
      })
      yield* f.llm.serve((request) => TestLLM.text(`Retained ${request.model.id} body`, "r1-unavailable"))
      const result = yield* f.execute({ arbitration_model: requested, summary: { model: requested } })
      expect(result.status).toBe("completed")
      const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
      expect(output.status).toBe("completed")
      expect(output.workers.map((worker) => worker.text)).toEqual(["Retained worker body", "Retained meta body"])
      expect(output.arbitration).toMatchObject({
        requested,
        status: "unavailable",
        error: expect.stringContaining(invalid === "model" ? "unavailable" : "Variant unavailable"),
      })
      expect(output.summary).toMatchObject({ requested, status: "unavailable" })
      expect(yield* f.tasks.get(f.root.id)).toHaveLength(3)
      expect(yield* f.llm.requests()).toHaveLength(2)
    }),
  )
}

for (const outcome of ["failed", "length", "empty", "cancelled"] as const) {
  leafIt.live(`MC08 R1 keeps original bodies and records actual ${outcome} enhancement quality`, () =>
    Effect.gen(function* () {
      const f = yield* judgeLeaf()
      const selected = Model.Ref.make({ providerID: f.metaModel.providerID, id: Model.ID.make("enhancement") })
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(f.metaModel.providerID),
            activation: "enabled",
            package: "@omnixa/ai/providers/openai/responses",
          }),
          models: [f.metaModel, f.workerModel, selected].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(Effect.provide(f.local))
      if (outcome === "length")
        yield* Agent.Service.use((service) =>
          service.transform((editor) =>
            editor.update(Agent.ID.make("build"), (agent) => {
              agent.steps = 1
            }),
          ),
        ).pipe(Effect.provide(f.local))
      yield* f.llm.serve((request) => {
        if (request.model.id !== "enhancement") return TestLLM.text(`Original ${request.model.id} body`, "r1-original")
        if (outcome === "failed")
          return Stream.concat(
            Stream.fromIterable(TestLLM.text("Partial before failure", "r1-failed").slice(0, -1)),
            Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "R1 enhancement rejected" }) })),
          )
        if (outcome === "cancelled") return Stream.never
        if (outcome === "empty") return TestLLM.text("", "r1-empty")
        return TestLLM.complete(
          { reason: { normalized: "length" } },
          LLMEvent.textStart({ id: "r1-length" }),
          LLMEvent.textDelta({ id: "r1-length", text: "Readable length-limited summary" }),
          LLMEvent.textEnd({ id: "r1-length" }),
        )
      })
      const pending = yield* f
        .execute(outcome === "failed" ? { arbitration_model: selected, summary: {} } : { summary: { model: selected } })
        .pipe(Effect.forkScoped)
      yield* awaitWithTimeout(f.llm.wait(3), "R1 enhancement did not start", "10 seconds")
      if (outcome === "cancelled") {
        const states = yield* f.delegations.list({ parentSessionID: f.root.id })
        const state = states.find((state) =>
          [...(state?.participants.values() ?? [])].some(
            (participant) =>
              participant.executor &&
              !Model.Selection.isGroup(participant.executor.model) &&
              participant.executor.model.id === selected.id,
          ),
        )
        if (!state) return yield* Effect.die(new Error("R1 enhancement delegation is missing"))
        yield* f.execution.close({
          delegationID: state.delegation.id,
          reason: "R1 controlled enhancement cancellation",
        })
      }
      const result = yield* awaitWithTimeout(Fiber.join(pending), "R1 enhancement did not settle", "10 seconds")
      expect(result.status).toBe("completed")
      const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
      expect(output.status).toBe("completed")
      expect(output.workers.map((worker) => worker.text)).toEqual(["Original worker body", "Original meta body"])
      const enhancement = outcome === "failed" && output.arbitration !== "none" ? output.arbitration : output.summary
      expect(enhancement?.status).toBe(outcome === "length" ? "partial" : outcome)
      expect(enhancement?.result?.runtime?.id).toBe("enhancement")
      expect(enhancement?.result?.receipt).toBeDefined()
      if (outcome === "length")
        expect(output.summary?.result?.completion).toMatchObject({ finish: "length", needsContinuation: false })
      if (outcome === "failed") {
        expect(enhancement?.result?.text).toContain("R1 enhancement rejected")
        expect(enhancement?.result?.completion).toBeUndefined()
        expect(output.summary?.status).toBe("completed")
        const receipt = output.summary?.result?.receipt
        if (!receipt) return yield* Effect.die(new Error("R1 summary receipt is missing"))
        const admitted = (yield* f.sessions.context(receipt.childSessionID)).find(
          (message) => message.id === receipt.inputID,
        )
        if (admitted?.type !== "user") return yield* Effect.die(new Error("R1 summary input is missing"))
        expect(admitted.text).toContain("R1 enhancement rejected")
        expect(admitted.text).toContain('"status":"failed"')
      }
      if (outcome === "empty") {
        expect(output.summary?.result?.text).toBe("")
        const receipt = output.summary?.result?.receipt
        if (!receipt || output.source.type !== "tool" || !result.content || !isReadonlyArrayNonEmpty(result.content))
          return yield* Effect.die(new Error("Empty Judge summary has no canonical Tool result"))
        const bus = yield* Bus.Service
        const source = {
          sessionID: f.root.id,
          assistantMessageID: SessionMessage.ID.make(output.source.messageID),
          id: output.source.id,
        }
        const input = { ...f.input, summary: { model: selected } }
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: f.root.id,
          assistantMessageID: source.assistantMessageID,
          agent: Agent.ID.make("meta"),
          model: f.metaModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: TaskTool.name })
        yield* bus.publish(SessionEvent.Tool.Input.Ended, { ...source, text: JSON.stringify(input) })
        yield* bus.publish(SessionEvent.Tool.Called, { ...source, input, executed: false })
        yield* bus.publish(SessionEvent.Step.Streamed, {
          sessionID: f.root.id,
          assistantMessageID: source.assistantMessageID,
        })
        yield* bus.publish(SessionEvent.Tool.Success, {
          ...source,
          content: result.content,
          metadata: result.metadata,
          executed: true,
        })
        const beforeRead = yield* f.llm.requests()
        const delivery = (yield* f.execution.readSources(receipt.delegationID)).find(
          (value) => value.receipt?.inputID === receipt.inputID,
        )
        if (!delivery) return yield* Effect.die(new Error("Empty Judge summary delivery is missing"))
        expect(yield* f.execution.readResult(delivery)).toMatchObject({ available: true, text: "" })
        yield* f.sessions.revert.stage({ sessionID: receipt.childSessionID, messageID: receipt.inputID, files: false })
        yield* f.sessions.revert.commit(receipt.childSessionID)
        expect(
          (yield* SessionInputResult.read(f.db, { sessionID: receipt.childSessionID, inputID: receipt.inputID }))
            .status,
        ).toBe("missing")
        expect(yield* f.execution.readResult(delivery)).toMatchObject({ available: true, text: "" })
        expect(yield* f.llm.requests()).toEqual(beforeRead)
      }
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === output.parentTaskID)).toMatchObject({
        status: "completed",
        revision: 2,
      })
      expect(yield* f.llm.requests()).toHaveLength(outcome === "failed" ? 4 : 3)
    }),
  )
}

leafIt.live("MC08 R1 parent interruption cancels the owning enhancement while retaining completed original Tasks", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    yield* f.llm.serve((request) =>
      request.messages.some(
        (message) =>
          message.role === "user" &&
          message.content.some(
            (part) => part.type === "text" && part.text.startsWith("Arbitrate the complete Judge evidence"),
          ),
      )
        ? Stream.never
        : TestLLM.text(`Retained ${request.model.id} body`, "r1-parent-cancel"),
    )
    const pending = yield* f.execute({ arbitration_model: f.workerModel, summary: {} }).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(f.llm.wait(3), "R1 arbitration did not start", "10 seconds")
    const before = yield* f.tasks.get(f.root.id)
    expect(before.filter((task) => task.parentID !== undefined && task.status === "completed")).toHaveLength(2)
    expect(before.filter((task) => task.status === "in_progress")).toHaveLength(2)
    yield* awaitWithTimeout(Fiber.interrupt(pending), "R1 parent interruption did not settle", "10 seconds")
    const after = yield* f.tasks.get(f.root.id)
    expect(after.filter((task) => task.parentID !== undefined && task.status === "completed")).toHaveLength(2)
    expect(after.filter((task) => task.status === "cancelled")).toHaveLength(2)
    expect(after.some((task) => task.content.includes(": summary"))).toBe(false)
    expect(after.filter((task) => task.status === "completed").map((task) => task.outputDigest)).toEqual([
      "Retained worker body",
      "Retained meta body",
    ])
    expect(yield* f.llm.requests()).toHaveLength(3)
  }),
)

leafIt.live("MC08 J1 cancels only owning workers while retaining a completed sibling receipt and body", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    const body = "Completed sibling survives cancellation 🚀"
    const original = yield* f.delegations.foldState(f.delegation.id)
    yield* f.llm.serve((request) =>
      request.model.id === "worker" ? TestLLM.text(body, "judge-A-complete") : Stream.never,
    )
    const pending = yield* f.execute().pipe(Effect.forkIn(yield* Effect.scope))
    yield* awaitWithTimeout(f.llm.wait(2), "MC08 J1 workers did not start", "10 seconds")
    const receipts = yield* judgeReceipts(f)
    const completed = yield* Effect.forEach(receipts, (receipt) =>
      f.sessions.get(receipt.childSessionID).pipe(Effect.map((child) => ({ receipt, child }))),
    )
    const success = completed.find(
      (worker) =>
        worker.child.model && !Model.Selection.isGroup(worker.child.model) && worker.child.model.id === "worker",
    )
    const running = completed.find(
      (worker) =>
        worker.child.model && !Model.Selection.isGroup(worker.child.model) && worker.child.model.id === "meta",
    )
    if (!success || !running) return yield* Effect.die(new Error("Judge receipts are missing"))
    expect(
      yield* awaitWithTimeout(
        f.execution.wait(success.receipt),
        "MC08 J1 successful receipt did not settle",
        "10 seconds",
      ),
    ).toMatchObject({ status: "completed", text: body })
    const before = yield* f.sessions.context(success.child.id)
    const tasks = yield* f.tasks.get(f.root.id)
    const aggregate = tasks.find((task) => task.parentID === undefined)
    expect(aggregate?.status).toBe("in_progress")
    yield* awaitWithTimeout(Fiber.interrupt(pending), "MC08 J1 cancellation did not settle", "10 seconds")
    expect(yield* f.execution.wait(success.receipt)).toMatchObject({ status: "completed", text: body })
    expect(yield* f.execution.wait(running.receipt)).toMatchObject({ status: "cancelled" })
    expect(yield* f.sessions.context(success.child.id)).toEqual(before)
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === aggregate?.id)?.status).toBe("cancelled")
    expect(
      (yield* f.tasks.get(f.root.id))
        .filter((task) => task.parentID === aggregate?.id)
        .map((task) => task.status)
        .sort(),
    ).toEqual(["cancelled", "completed"])
    expect(yield* f.delegations.foldState(f.delegation.id)).toEqual(original)
    expect(yield* f.sessions.get(f.child.id)).toEqual(f.child)
    expect(yield* f.sessions.inbox(running.child.id)).toEqual([])
    expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    expect(yield* f.llm.requests()).toHaveLength(2)
  }),
)

leafIt.live("MC08 J1 preserves an edited aggregate Task when all workers settle after a CAS conflict", () =>
  Effect.gen(function* () {
    const f = yield* judgeLeaf()
    const linked = (yield* f.tasks.append({
      sessionID: f.root.id,
      tasks: [{ content: "Existing Judge task", status: "pending", priority: "high" }],
    })).at(-1)
    if (!linked) return yield* Effect.die(new Error("Linked Judge task is missing"))
    const release = yield* Deferred.make<void>()
    yield* f.llm.serve((request) =>
      Stream.unwrap(
        Deferred.await(release).pipe(
          Effect.as(Stream.fromIterable(TestLLM.text(`Full ${request.model.id} body`, request.model.id))),
        ),
      ),
    )
    const pending = yield* f.execute({ parent_task_id: linked.id }).pipe(Effect.forkIn(yield* Effect.scope))
    yield* awaitWithTimeout(f.llm.wait(2), "MC08 J1 workers did not start", "10 seconds")
    const admitted = (yield* f.tasks.get(f.root.id)).find((task) => task.id === linked.id)
    expect(admitted).toMatchObject({ status: "in_progress", revision: 2, priority: "high" })
    const kv = yield* KV.Service
    const active = yield* f.tasks.get(f.root.id)
    const management = { type: "tool" as const, messageID: toolIdentity.messageID, id: "ma01-judge-manager" }
    const blocked = yield* Effect.forEach(active, (task) =>
      f.tasks
        .updateTask({ sessionID: f.root.id, id: task.id, status: "completed" }, { management })
        .pipe(Effect.result),
    )
    expect(blocked.every((result) => result._tag === "Failure" && result.failure.reason === "execution_owned")).toBe(
      true,
    )
    expect(yield* f.tasks.get(f.root.id)).toEqual(active)
    const edited = yield* f.tasks.patch({
      sessionID: f.root.id,
      id: linked.id,
      expectedRevision: admitted?.revision,
      status: "pending",
    })
    yield* Deferred.succeed(release, undefined)
    const result = yield* awaitWithTimeout(Fiber.join(pending), "MC08 J1 aggregate stayed locked", "10 seconds")
    expect(result.status).toBe("completed")
    const output = Schema.decodeUnknownSync(TaskTool.JudgeOutput)(result.output)
    expect(output.status).toBe("completed")
    expect(output.taskSettlement).toBe("conflict")
    expect(output.parentTaskID).toBe(linked.id)
    expect(output.workers.map((worker) => worker.text)).toEqual(["Full worker body", "Full meta body"])
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === linked.id)).toEqual(edited)
    expect(output.workers.map((worker) => worker.taskID)).toHaveLength(2)
    expect(yield* kv.get(`task:claim:${f.root.id}:${linked.id}`)).toBeUndefined()
    expect(
      yield* Effect.forEach(output.workers, (worker) => kv.get(`task:claim:${f.root.id}:${worker.taskID}`)),
    ).toEqual([undefined, undefined])
    expect(
      (yield* f.tasks.get(f.root.id))
        .filter((task) => task.parentID === linked.id)
        .every((task) => task.status === "completed"),
    ).toBe(true)
    expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    expect(yield* f.llm.requests()).toHaveLength(2)
  }),
)

for (const actor of ["build", "plan"] as const) {
  leafIt.live(`MC08 W2 rejects a ${actor} Workflow Task without changing its mode or Meta ownership`, () =>
    Effect.gen(function* () {
      const f = yield* workflowLeaf()
      const parent = yield* f.sessions.create({
        location: f.root.location,
        mode: "work",
        agent: Agent.ID.make(actor),
        model: f.metaModel,
      })
      const before = yield* f.read()
      const result = yield* executeTool(f.registry, {
        sessionID: parent.id,
        agent: Agent.ID.make(actor),
        messageID: toolIdentity.messageID,
        call: { type: "tool-call", id: "not-meta", name: TaskTool.name, input: { ...f.input, subagent_type: "meta" } },
      })
      expect(result).toMatchObject({
        status: "error",
        error: { message: "Workflow Task requires the selected Meta in Work" },
      })
      expect(yield* f.sessions.get(parent.id)).toEqual(parent)
      expect(parent.mode).toBe("work")
      expect(yield* f.read()).toEqual(before)
      expect(yield* f.tasks.get(parent.id)).toEqual([])
      expect(yield* f.workflows.getBySession(parent.id)).toBeUndefined()
      expect(yield* f.llm.requests()).toEqual([])
    }),
  )
}

leafIt.live("MC08 W2 rejects foreign and scheduled parent Tasks before Workflow admission", () =>
  Effect.gen(function* () {
    const f = yield* workflowLeaf()
    const other = yield* f.sessions.create({
      location: f.root.location,
      mode: "work",
      agent: Agent.ID.make("build"),
      model: f.metaModel,
    })
    const foreign = (yield* f.tasks.append({
      sessionID: other.id,
      tasks: [{ content: "Foreign", status: "pending", priority: "medium" }],
    })).at(-1)
    const scheduled = (yield* f.tasks.append({
      sessionID: f.root.id,
      tasks: [
        {
          content: "Scheduled",
          status: "scheduled",
          scheduledAt: (yield* DateTime.nowAsDate).getTime() + 3_600_000,
          priority: "medium",
        },
      ],
    })).at(-1)
    if (!foreign || !scheduled) return yield* Effect.die(new Error("Missing parent Task fixtures"))
    for (const id of [foreign.id, scheduled.id]) {
      const result = yield* executeTool(f.registry, {
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: { type: "tool-call", id: `parent-${id}`, name: TaskTool.name, input: { ...f.input, parent_task_id: id } },
      })
      expect(result.status).toBe("error")
    }
    expect(yield* f.tasks.get(f.root.id)).toEqual([scheduled])
    expect(yield* f.tasks.get(other.id)).toEqual([foreign])
    expect(yield* f.workflows.getBySession(f.root.id)).toBeUndefined()
    expect(yield* f.llm.requests()).toEqual([])
  }),
)

leafIt.live("MC08 W2 marks the actual parent Task failed when the owning run transaction aborts", () =>
  Effect.gen(function* () {
    const f = yield* workflowLeaf()
    yield* f.db
      .run(
        sql`CREATE TEMP TRIGGER mc08_w2_admission_fail BEFORE INSERT ON workflow_step_run BEGIN SELECT RAISE(ABORT, 'MC08 W2 actual admission failed'); END`,
      )
      .pipe(Effect.orDie)
    const result = yield* executeTool(f.registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { type: "tool-call", id: "admission-fail", name: TaskTool.name, input: f.input },
    }).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    const tasks = yield* f.tasks.get(f.root.id)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: "failed", revision: 2 })
    expect(yield* f.workflows.getBySession(f.root.id)).toBeUndefined()
    expect(yield* f.llm.requests()).toEqual([])
  }),
)

leafIt.live("MC08 W2 preserves a user Task edit when foreground completion loses its admitted CAS", () =>
  Effect.gen(function* () {
    const f = yield* workflowLeaf()
    const gate = yield* Deferred.make<void>()
    yield* f.llm.push(
      Stream.unwrap(
        Deferred.await(gate).pipe(Effect.as(Stream.fromIterable(TestLLM.text("Exact completed body", "cas-child")))),
      ),
    )
    const scope = yield* Scope.Scope
    const pending = yield* executeTool(f.registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { type: "tool-call", id: "cas", name: TaskTool.name, input: f.input },
    }).pipe(Effect.forkIn(scope))
    yield* awaitWithTimeout(f.llm.wait(1), "MC08 W2 child did not start", "10 seconds")
    const run = yield* f.workflows.getBySession(f.root.id)
    if (!run) return yield* Effect.die(new Error("Missing owning foreground run"))
    const binding = (yield* f.workflows.admission(f.root.id, run.id)).taskBinding
    if (!binding) return yield* Effect.die(new Error("Missing admitted Task binding"))
    const kv = yield* KV.Service
    expect(yield* kv.get(`task:claim:${f.root.id}:${binding.parentTaskID}`)).toEqual({
      parentTaskID: binding.parentTaskID,
      parentTaskRevision: binding.parentTaskRevision,
      source: binding.source,
    })
    const active = yield* f.tasks.get(f.root.id)
    const blocked = yield* Effect.forEach(active, (task) =>
      f.tasks
        .removeTask(
          { sessionID: f.root.id, id: task.id },
          {
            management: { type: "tool", messageID: toolIdentity.messageID, id: "ma01-workflow-manager" },
          },
        )
        .pipe(Effect.result),
    )
    expect(blocked.every((result) => result._tag === "Failure" && result.failure.reason === "execution_owned")).toBe(
      true,
    )
    expect(yield* f.tasks.get(f.root.id)).toEqual(active)
    const edited = yield* f.tasks.patch({
      sessionID: f.root.id,
      id: binding.parentTaskID,
      status: "pending",
      expectedRevision: binding.parentTaskRevision,
    })
    yield* Deferred.succeed(gate, undefined)
    const result = yield* awaitWithTimeout(Fiber.join(pending), "MC08 W2 foreground Task stayed locked", "10 seconds")
    expect(result.status).toBe("completed")
    const text = result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
    expect(text).toContain('"taskSettlement":"conflict"')
    expect(text).toContain("Exact completed body")
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toEqual(edited)
    expect((yield* f.workflows.get(run.id)).status).toBe("completed")
    expect(yield* Effect.forEach(active, (task) => kv.get(`task:claim:${f.root.id}:${task.id}`))).toEqual([
      undefined,
      undefined,
    ])
    expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
  }),
)

leafIt.live(
  "hard-rejects actual Meta child recursion at tool and domain owners even with depth two",
  () =>
    Effect.gen(function* () {
      const f = yield* metaLeaf()
      const foreign = yield* metaLeaf()
      const before = yield* f.read()
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(Config.latest(yield* config.entries(), "experimental")?.subagent_depth).toBe(2)
        const registry = yield* Tool.Service
        expect((yield* registry.snapshot()).definitions.map((tool) => tool.name)).toEqual(
          expect.arrayContaining([TaskTool.name, SubagentTool.name]),
        )
        const context = yield* SessionContext.Service
        const selected = yield* context.select(f.child.id)
        expect(
          selected.tools.catalog.some((tool) => tool.name === TaskTool.name || tool.name === SubagentTool.name),
        ).toBe(false)
        expect(
          selected.tools.definitions.some((tool) => tool.name === TaskTool.name || tool.name === SubagentTool.name),
        ).toBe(false)
        expect(
          yield* executeTool(registry, {
            sessionID: f.child.id,
            agent: f.binding.agent,
            messageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call",
              id: "call-meta-child-task",
              name: TaskTool.name,
              input: { description: "Forbidden task", prompt: "Do not admit", subagent_type: f.binding.agent },
            },
          }),
        ).toMatchObject({
          status: "error",
          error: { type: "tool.execution", message: expect.stringContaining("cannot be used in child sessions") },
        })
        expect(
          yield* executeTool(registry, {
            sessionID: f.child.id,
            agent: f.binding.agent,
            messageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call",
              id: "call-meta-child-subagent",
              name: SubagentTool.name,
              input: { description: "Forbidden child", prompt: "Do not admit", agent: f.binding.agent },
            },
          }),
        ).toMatchObject({
          status: "error",
          error: { type: "tool.execution", message: "Meta children cannot create subagents" },
        })
      }).pipe(Effect.provide(f.local))
      expect(
        yield* f.sessions
          .create({
            parentID: f.child.id,
            agent: f.binding.agent,
            model: f.binding.model,
            executor: f.binding,
            source: f.source,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_child_recursion" })
      expect(
        yield* f.sessions
          .fork({ sessionID: f.child.id, child: true, agent: f.binding.agent, executor: f.binding, source: f.source })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_child_recursion" })
      expect(
        yield* f.sessions.switchAgent({ sessionID: f.child.id, agent: Agent.ID.make("explore") }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_binding_conflict" })
      expect(
        yield* f.sessions.switchModel({ sessionID: f.child.id, model: f.metaModel }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Session.ControllerConflictError",
        kind: "meta_binding_conflict",
      })
      expect(
        yield* f.sessions
          .selectExecutor({
            sessionID: f.child.id,
            executorPreference: new ExecutorPreference({ agent: f.binding.agent, model: f.metaModel }),
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "executor_selection_unsupported" })
      yield* f.sessions.switchAgent({ sessionID: f.child.id, agent: f.binding.agent })
      yield* f.sessions.switchModel({ sessionID: f.child.id, model: f.binding.model })
      expect(
        yield* f.delegations
          .create({
            parentSessionID: f.child.id,
            title: "Forbidden delegation",
            metaAgentID: f.child.controller?.metaAgentID,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Delegation.DelegationInvalidStateError",
        currentStatus: "meta_child",
        attemptedTransition: "create",
      })
      const retry = {
        delegationID: f.delegation.id,
        provider: "internal",
        target: f.binding.agent,
        role: "implementer" as const,
        context: "fresh" as const,
        childSessionID: f.child.id,
      }
      expect(
        (yield* f.delegations.addParticipant({
          ...retry,
          executor: new ExecutorBinding({ ...f.binding, source: "tool" }),
        })).executor,
      ).toEqual(f.binding)
      expect(
        yield* f.delegations
          .addParticipant({ ...retry, executor: new ExecutorBinding({ ...f.binding, model: f.metaModel }) })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError", attemptedTransition: "addParticipant" })
      expect(
        yield* f.delegations
          .bindParticipant({
            delegationID: foreign.delegation.id,
            participantID: foreign.participant.id,
            childSessionID: f.child.id,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError", attemptedTransition: "bindParticipant" })
      expect(yield* f.read()).toEqual(before)

      // Retained facts can name a genuine Meta child as a parent. The real projector seeds that invalid history;
      // the existing child Controller and Meta association stay intact while addParticipant/appendTurn fail closed.
      const forbidden = DelegationID.ID.create()
      const participantID = ParticipantID.create()
      const timestamp = (yield* DateTime.nowAsDate).getTime()
      yield* f.bus.publish(DelegationEvent.Created, {
        delegationID: forbidden,
        parentSessionID: f.child.id,
        title: "Retained child-owned delegation",
        status: "draft",
        timestamp,
      })
      yield* f.bus.publish(DelegationEvent.ParticipantAdded, {
        delegationID: forbidden,
        participantID,
        provider: "internal",
        target: f.binding.agent,
        role: "implementer",
        context: "fresh",
        phase: "provisioning",
        executor: f.binding,
        timestamp,
      })
      const retained = yield* f.read()
      expect(
        yield* f.delegations
          .addParticipant({
            delegationID: forbidden,
            provider: "internal",
            target: f.binding.agent,
            role: "reviewer",
            context: "fresh",
            executor: f.binding,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Delegation.DelegationInvalidStateError",
        currentStatus: "meta_child",
        attemptedTransition: "addParticipant",
      })
      expect(
        yield* f.delegations
          .appendTurn({
            delegationID: forbidden,
            kind: "task",
            participantIDs: [participantID],
            delivery: "steer",
            origin: { deliveryOrigin: "meta", senderParticipantID: participantID },
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Delegation.DelegationInvalidStateError",
        currentStatus: "meta_child",
        attemptedTransition: "appendTurn",
      })
      expect(yield* f.read()).toEqual(retained)
      yield* f.metas.assertOwner(yield* f.sessions.get(f.child.id))
      expect((yield* f.sessions.get(f.child.id)).controller).toEqual(f.child.controller)
      expect(retained.requests).toEqual([])
    }),
  30_000,
)

leafIt.live(
  "MC08 W2 cancels foreground work, preserves completed bodies, and retries with a new actual Tool binding",
  () =>
    Effect.gen(function* () {
      const f = yield* workflowLeaf([
        new StepDef({ id: "A", name: "A", agent: "workflow-worker", input: { value: "A published" }, next: "B" }),
        new StepDef({ id: "B", name: "B", agent: "workflow-worker", input: { value: "B published" }, next: "END" }),
      ])
      yield* f.llm.push(TestLLM.text("Preserved completed A body", "cancel-A"), Stream.never)
      const call = {
        sessionID: f.root.id,
        agent: Agent.ID.make("meta"),
        messageID: toolIdentity.messageID,
        call: { type: "tool-call" as const, id: "cancel-workflow", name: TaskTool.name, input: f.input },
      }
      const scope = yield* Scope.Scope
      const pending = yield* executeTool(f.registry, call).pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(f.llm.wait(2), "MC08 W2 second child did not start", "10 seconds")
      const run = yield* f.workflows.getBySession(f.root.id)
      if (!run) return yield* Effect.die(new Error("Missing owning cancellation run"))
      yield* awaitWithTimeout(Fiber.interrupt(pending), "MC08 W2 Task cancellation stayed locked", "10 seconds")
      const cancelled = yield* f.workflows.get(run.id)
      expect(cancelled.status).toBe("cancelled")
      const steps = yield* f.workflows.getSteps(run.id)
      expect(steps.map((step) => step.status)).toEqual(["completed", "cancelled"])
      const children = yield* Effect.forEach(steps, (step) =>
        Effect.gen(function* () {
          if (!step.childSessionId) return yield* Effect.die(new Error("Missing frozen Work child"))
          const child = yield* f.sessions.get(Session.ID.make(step.childSessionId))
          expect(child).toMatchObject({ parentID: f.root.id, mode: "work" })
          expect(child.controller).toMatchObject({
            kind: "child",
            rootSessionID: f.root.id,
            source: { kind: "workflow", runID: run.id, stepRunID: step.id },
          })
          expect(child.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }])
          return child
        }),
      )
      yield* f.sessions.setPermissions({
        sessionID: f.root.id,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "write", resource: "*", effect: "deny" },
        ],
      })
      const permission = yield* Permission.Service.pipe(Effect.provide(f.local))
      yield* Effect.forEach(children, (child) =>
        Effect.gen(function* () {
          yield* permission.assert({ sessionID: child.id, action: "read", resources: ["src/result.txt"] })
          expect(
            yield* permission
              .assert({ sessionID: child.id, action: "write", resources: ["src/result.txt"] })
              .pipe(Effect.flip),
          ).toBeInstanceOf(Permission.BlockedError)
        }),
      )
      const binding = (yield* f.workflows.admission(f.root.id, run.id)).taskBinding
      if (!binding) return yield* Effect.die(new Error("Missing actual cancellation Task binding"))
      expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding.parentTaskID)).toMatchObject({
        status: "cancelled",
        revision: 2,
      })
      yield* Effect.promise(() =>
        Bun.file(path.join(f.root.location.directory, ".omnixa/agents/workflow-worker.md")).delete(),
      )
      yield* Effect.promise(() =>
        Bun.file(path.join(f.root.location.directory, ".omnixa/workflows/task-keeper.yaml")).delete(),
      )
      yield* AgentAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(f.local))
      yield* WorkflowAsset.Service.use((assets) => assets.reload()).pipe(Effect.provide(f.local))
      yield* f.workflowExecution.resume({ sessionID: f.root.id, runID: run.id })
      expect(yield* f.workflowExecution.reconcilePending).toEqual([])
      const repeated = yield* executeTool(f.registry, call)
      expect(repeated.status).toBe("completed")
      const text = repeated.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
      expect(text).toContain('"status":"cancelled"')
      expect(text).toContain("Preserved completed A body")
      expect(text).toContain('"quality":"complete"')
      expect(text).toContain('"id":"cancel-workflow"')
      expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
      expect((yield* f.llm.requests()).length).toBe(2)
      const target = steps[1]
      if (!target) return yield* Effect.die(new Error("Missing cancelled retry target"))
      yield* f.llm.push(TestLLM.text("Recovered frozen B body", "retry-B"))
      const retryInput = {
        description: "Retry the frozen B step",
        prompt: "Use its published input",
        workflow_retry: new WorkflowExecution.TaskRetry({
          runID: run.id,
          stepRunID: target.id,
          expectedRunRevision: cancelled.revision,
          expectedStepRevision: target.revision,
        }),
      }
      const retried = yield* executeTool(f.registry, {
        ...call,
        call: { type: "tool-call", id: "new-retry-binding", name: TaskTool.name, input: retryInput },
      })
      expect(retried.status).toBe("completed")
      const retryText = retried.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
      expect(retryText).toContain("Preserved completed A body")
      expect(retryText).toContain("Recovered frozen B body")
      expect(retryText).toContain('"id":"new-retry-binding"')
      const next = yield* f.workflows.getBySession(f.root.id)
      if (!next || next.id === run.id) return yield* Effect.die(new Error("Missing new retry lineage"))
      const inherited = yield* f.workflows.admission(f.root.id, next.id)
      expect(inherited.taskBinding?.parentTaskID).not.toBe(binding.parentTaskID)
      expect(inherited.taskBinding?.source).toEqual({
        type: "tool",
        messageID: toolIdentity.messageID,
        id: "new-retry-binding",
      })
      expect(inherited.snapshot?.data).toEqual((yield* f.workflows.admission(f.root.id, run.id)).snapshot?.data)
      const nextSteps = yield* f.workflows.getSteps(next.id)
      expect(nextSteps[0]).toMatchObject({
        childSessionId: steps[0]?.childSessionId,
        status: "completed",
      })
      const retryChildID = nextSteps[1]?.childSessionId
      if (!retryChildID) return yield* Effect.die(new Error("Missing retried frozen Work child"))
      const retryChild = yield* f.sessions.get(Session.ID.make(retryChildID))
      expect(retryChild).toMatchObject({ parentID: f.root.id, mode: "work" })
      expect(retryChild.permissions).toEqual((yield* f.sessions.get(f.root.id)).permissions)
      expect(
        yield* permission
          .assert({ sessionID: retryChild.id, action: "write", resources: ["src/result.txt"] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(Permission.BlockedError)
      expect((yield* f.llm.requests()).length).toBe(3)
      const before = yield* f.tasks.get(f.root.id)
      const exact = yield* executeTool(f.registry, {
        ...call,
        call: { type: "tool-call", id: "new-retry-binding", name: TaskTool.name, input: retryInput },
      })
      expect(exact.content).toEqual(retried.content)
      expect(yield* f.tasks.get(f.root.id)).toEqual(before)
      expect((yield* f.llm.requests()).length).toBe(3)
      expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    }),
)

leafIt.live("MC08 W2 keeps partial_success and its completed body in the foreground Tool envelope", () =>
  Effect.gen(function* () {
    const f = yield* workflowLeaf([
      new StepDef({
        id: "A",
        name: "A",
        agent: "workflow-worker",
        input: { value: "A" },
        next: "B",
        failurePolicy: "continue",
      }),
      new StepDef({ id: "B", name: "B", agent: "workflow-worker", input: { value: "B" }, next: "END" }),
    ])
    yield* f.llm.push(
      Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "Intentional W2 child failure" }) })),
      TestLLM.text("Completed B despite A failure", "partial-B"),
    )
    const result = yield* executeTool(f.registry, {
      sessionID: f.root.id,
      agent: Agent.ID.make("meta"),
      messageID: toolIdentity.messageID,
      call: { type: "tool-call", id: "partial-workflow", name: TaskTool.name, input: f.input },
    })
    expect(result.status).toBe("completed")
    const text = result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? ""
    expect(text).toContain('"status":"partial_success"')
    expect(text).toContain('"quality":"unavailable"')
    expect(text).toContain("Completed B despite A failure")
    const run = yield* f.workflows.getBySession(f.root.id)
    if (!run) return yield* Effect.die(new Error("Missing partial run"))
    const binding = (yield* f.workflows.admission(f.root.id, run.id)).taskBinding
    expect((yield* f.tasks.get(f.root.id)).find((task) => task.id === binding?.parentTaskID)).toMatchObject({
      status: "completed",
      revision: 2,
    })
    expect((yield* f.sessions.inbox(f.root.id)).filter((item) => item.type === "synthetic")).toEqual([])
    expect((yield* f.llm.requests()).length).toBe(2)
  }),
)

const model = Model.Ref.make({ id: Model.ID.make("task"), providerID: Provider.ID.make("test") })
const worker = Agent.ID.make("task-worker")
const Result = Schema.Struct({
  ...TaskTool.InternalOutput.fields,
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  turnID: TurnID,
  inputID: SessionMessage.ID,
  parentTaskID: Schema.String,
})
const result = Schema.decodeUnknownSync(Result)
const taskText = (sessionID: Session.ID, text: string) =>
  `<task id="${sessionID}" state="completed">\n<task_result>\n${text}\n</task_result>\n</task>`

const setup = (effect: "allow" | "ask" = "allow") =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const sessions = yield* Session.Service
    const parent = yield* createLegacySession({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
      title: "Task tool parent",
      agent: toolIdentity.agent,
      model,
    })
    const locations = yield* LocationServiceMap.Service
    const local = locations.get(parent.location)
    yield* Plugin.awaitActivation.pipe(Effect.provide(local))
    const agents = yield* Agent.Service.pipe(Effect.provide(local))
    yield* agents.transform((editor) => {
      editor.update(toolIdentity.agent, (agent) => {
        agent.permissions = [{ action: "*", resource: "*", effect }]
      })
      editor.update(worker, (agent) => {
        agent.originKind = "builtin"
        agent.mode = "subagent"
        agent.model = model
      })
    })
    const registry = yield* Tool.Service.pipe(Effect.provide(local))
    const snapshot = yield* registry.snapshot()
    const llm = yield* TestLLM.Test
    const delegations = yield* DelegationService.Service
    const compositions = yield* SessionComposition.Service
    const execution = yield* DelegationExecution.Service
    const tasks = yield* SessionTask.Service
    const permission = yield* Permission.Service.pipe(Effect.provide(local))
    const config = yield* Config.Service.pipe(Effect.provide(local))
    const models = yield* Model.Service.pipe(Effect.provide(local))
    const resolver = yield* ModelResolver.Service.pipe(Effect.provide(local))
    const plugins = yield* Plugin.Service.pipe(Effect.provide(local))
    const runs = yield* SessionExecution.Service
    const access = yield* FileAccess.Service.pipe(Effect.provide(local))
    const shells = yield* ShellSelect.Service.pipe(Effect.provide(local))
    const files = yield* FSUtil.Service
    const database = yield* Database.Service
    return {
      sessions,
      parent,
      agents,
      registry,
      snapshot,
      llm,
      delegations,
      compositions,
      execution,
      tasks,
      permission,
      runs,
      pluginContext: Context.make(Session.Service, sessions).pipe(
        Context.add(Agent.Service, agents),
        Context.add(Model.Service, models),
        Context.add(ModelResolver.Service, resolver),
        Context.add(Plugin.Service, plugins),
        Context.add(SessionComposition.Service, compositions),
        Context.add(Config.Service, config),
        Context.add(Permission.Service, permission),
        Context.add(DelegationService.Service, delegations),
        Context.add(DelegationExecution.Service, execution),
        Context.add(Database.Service, database),
        Context.add(SessionExecution.Service, runs),
        Context.add(SessionTask.Service, tasks),
        Context.add(Tool.Service, registry),
        Context.add(FileAccess.Service, access),
        Context.add(ShellSelect.Service, shells),
        Context.add(FSUtil.Service, files),
      ),
      execute: (input: Partial<typeof TaskTool.Input.Type> = {}, sessionID = parent.id, agent = toolIdentity.agent) =>
        snapshot.execute({
          sessionID,
          ...toolIdentity,
          agent,
          call: {
            type: "tool-call",
            id: "call-task",
            name: TaskTool.name,
            input: { description: "Review the task", prompt: "Full task prompt", subagent_type: worker, ...input },
          },
        }),
    }
  })

const setupCustom = (effect: "allow" | "deny" = "allow") =>
  Effect.gen(function* () {
    const seed = yield* setup()
    const app = yield* App.Metadata
    const database = yield* Database.Service
    const info = Agent.Info.make({
      ...Agent.Info.empty(worker),
      name: Agent.Name.make("frozen-worker"),
      mode: "subagent",
      model,
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    })
    yield* CompositionFixture.attach(seed.parent.id, info, {
      orchestrator: Agent.Info.make({
        ...Agent.Info.empty(Agent.ID.make("meta")),
        mode: "primary",
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "task", resource: worker, effect },
        ],
      }),
      tools: CompositionDigest.captureTools(seed.snapshot.catalog, String(seed.parent.location.directory), app.version),
    })
    yield* database.db
      .update(SessionTable)
      .set({ mode: "custom", agent: "meta" })
      .where(eq(SessionTable.id, seed.parent.id))
      .run()
      .pipe(Effect.orDie)
    return {
      ...seed,
      info,
      execute: (input: Partial<typeof TaskTool.Input.Type> = {}) =>
        seed.execute(input, seed.parent.id, Agent.ID.make("meta")),
    }
  })

const backgroundFlag = (enabled: boolean) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS
      process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS = enabled ? "1" : "0"
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS
          return
        }
        process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS = previous
      }),
  )

describe("TaskTool persistent delegation", () => {
  ;["build", "meta"].forEach((actor) => {
    it.live(`keeps captured ${actor} Task ownership when Agent changes before child admission`, () =>
      Effect.gen(function* () {
        const seed = yield* setup("ask")
        const locations = yield* LocationServiceMap.Service
        yield* useOfflineCatalog([
          {
            info: Provider.Info.make({
              ...Provider.Info.empty(model.providerID),
              activation: "enabled",
              package: "@omnixa/ai/providers/openai/responses",
            }),
            models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
          },
        ]).pipe(Effect.provide(locations.get(seed.parent.location)))
        yield* seed.agents.transform((editor) =>
          editor.update(Agent.ID.make("meta"), (agent) => {
            agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
          }),
        )
        if (actor === "meta")
          yield* seed.sessions.switchAgent({ sessionID: seed.parent.id, agent: Agent.ID.make("meta"), model })
        const before = yield* seed.sessions.get(seed.parent.id)
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
        yield* seed.llm.push(TestLLM.text("captured task result", "captured"))
        const fiber = yield* seed
          .execute({}, seed.parent.id, Agent.ID.make(actor))
          .pipe(Effect.forkIn(yield* Effect.scope))
        const request = yield* awaitWithTimeout(Deferred.await(asked), "Captured Task did not request permission")
        yield* seed.sessions.switchAgent({
          sessionID: seed.parent.id,
          agent: Agent.ID.make(actor === "build" ? "meta" : "build"),
          model,
        })
        yield* seed.permission.reply({ requestID: request.id, reply: "once" })
        const response = yield* awaitWithTimeout(Fiber.join(fiber), "Captured Task did not settle")
        const output = result(response.output)
        const state = yield* seed.delegations.foldState(output.delegationID)
        if (!state) throw new Error("Captured Task delegation state is missing")
        const child = yield* seed.sessions.get(output.sessionID)
        expect(output.status).toBe("completed")
        expect(child.parentID).toBe(seed.parent.id)
        if (actor === "build") {
          expect(state?.delegation.metaAgentID).toBeUndefined()
          expect(state?.participants.get(output.participantID)?.executor).toBeUndefined()
          expect(child.controller).toBeUndefined()
          expect(yield* seed.delegations.resolveActive(seed.parent.id, Agent.ID.make("meta"))).toBeUndefined()
        }
        if (actor === "meta") {
          expect(state?.delegation.metaAgentID).toBe(before.controller?.metaAgentID)
          expect(child.controller).toMatchObject({
            kind: "child",
            metaAgentID: before.controller?.metaAgentID,
            source: { kind: "task", delegationID: output.delegationID, participantID: output.participantID },
          })
          yield* MetaAgentService.Service.use((metas) => metas.assertOwner(child))
          expect(yield* seed.delegations.resolveActive(seed.parent.id, Agent.ID.make("build"))).toBeUndefined()
        }
        expect(yield* seed.llm.requests()).toHaveLength(1)
        const other = Agent.ID.make(actor === "build" ? "meta" : "build")
        expect(
          yield* seed.delegations
            .resolve({
              parentSessionID: seed.parent.id,
              agent: other,
              title: "Wrong owner",
              delegationID: output.delegationID,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError", attemptedTransition: "resolve" })
        expect(
          yield* seed.delegations.resolve({
            parentSessionID: seed.parent.id,
            agent: Agent.ID.make(actor),
            title: "Saved owner",
            delegationID: output.delegationID,
          }),
        ).toEqual(state)
      }),
    )
  })

  it.live("registers the production tool and returns the full input result beyond the public digest", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      expect(seed.snapshot.definitions.map((tool) => tool.name)).toContain(TaskTool.name)
      const full = "a" + "🙂".repeat(2400) + "\nFinal result"
      yield* seed.llm.push(TestLLM.text(full, "full"))
      const response = yield* seed.execute({ prompt: "Complete task context beyond its description" })
      const output = result(response.output)
      expect(output.status).toBe("completed")
      expect(output.output).toBe(taskText(output.sessionID, full))
      expect(response.content).toEqual([{ type: "text", text: output.output }])
      expect(response.metadata).toMatchObject({
        sessionID: output.sessionID,
        delegationID: output.delegationID,
        participantID: output.participantID,
        turnID: output.turnID,
        inputID: output.inputID,
        parentTaskID: output.parentTaskID,
        status: "completed",
      })
      expect(yield* seed.sessions.get(output.sessionID)).toMatchObject({ parentID: seed.parent.id, agent: worker })
      const state = yield* seed.delegations.foldState(output.delegationID)
      expect(state?.participants.size).toBe(1)
      expect([...(state?.deliveries.values() ?? [])][0]).toMatchObject({
        status: "completed",
        summary: full.slice(0, 4095),
      })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([
        expect.objectContaining({
          id: output.parentTaskID,
          content: "Review the task",
          status: "completed",
          outputDigest: full.slice(0, 4095),
        }),
      ])
      expect((yield* seed.llm.requests())[0]?.messages).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Complete task context beyond its description" }] },
      ])
    }),
  )

  it.live("reuses one participant and child for automatic, child-ID, and participant-ID follow-ups", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(
        TestLLM.text("first answer", "first"),
        TestLLM.text("second answer", "second"),
        TestLLM.text("third answer", "third"),
        TestLLM.text("fourth answer", "fourth"),
      )
      const first = result((yield* seed.execute({ prompt: "first prompt" })).output)
      const second = result((yield* seed.execute({ prompt: "second prompt" })).output)
      const third = result((yield* seed.execute({ prompt: "third prompt", task_id: first.sessionID })).output)
      const fourth = result(
        (yield* seed.execute({
          prompt: "fourth prompt",
          delegation_id: first.delegationID,
          participant_id: first.participantID,
        })).output,
      )
      const outputs = [first, second, third, fourth]
      expect(new Set(outputs.map((output) => output.delegationID)).size).toBe(1)
      expect(new Set(outputs.map((output) => output.participantID)).size).toBe(1)
      expect(new Set(outputs.map((output) => output.sessionID)).size).toBe(1)
      expect(new Set(outputs.map((output) => output.inputID)).size).toBe(4)
      expect(new Set(outputs.map((output) => output.turnID)).size).toBe(4)
      expect(outputs.map((output) => output.output)).toEqual(
        ["first answer", "second answer", "third answer", "fourth answer"].map((text) =>
          taskText(first.sessionID, text),
        ),
      )
      const state = yield* seed.delegations.foldState(first.delegationID)
      expect(state?.participants.size).toBe(1)
      expect(state?.turns.size).toBe(4)
      expect(
        (yield* seed.sessions.context(first.sessionID)).filter((message) => message.type === "user"),
      ).toMatchObject(["first prompt", "second prompt", "third prompt", "fourth prompt"].map((text) => ({ text })))
      expect(yield* seed.llm.requests()).toHaveLength(4)
    }),
  )

  it.live("asks before creating a Task, Delegation, or child and preserves a user's rejection", () =>
    Effect.gen(function* () {
      const seed = yield* setup("ask")
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
      const request = yield* awaitWithTimeout(Deferred.await(asked), "Task did not request permission")
      expect(request).toMatchObject({
        sessionID: seed.parent.id,
        action: "task",
        resources: [worker],
        save: ["*"],
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-task" },
      })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      yield* seed.permission.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "Task rejection did not settle")
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeclinedError)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("a captured task obeys a later deny without changing its existing delegation or parent Task", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("initial result", "initial"))
      const first = result((yield* seed.execute()).output)
      const state = yield* seed.delegations.foldState(first.delegationID)
      const tasks = yield* seed.tasks.get(seed.parent.id)
      const history = yield* seed.sessions.context(first.sessionID)
      yield* seed.agents.transform((editor) =>
        editor.update(toolIdentity.agent, (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task", resource: worker, effect: "deny" },
          ]
        }),
      )
      const exit = yield* seed
        .execute({ task_id: first.sessionID, parent_task_id: first.parentTaskID })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(state)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(tasks)
      expect(yield* seed.sessions.context(first.sessionID)).toEqual(history)
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("rejects new work on a failed participant and authorizes retry of its saved input", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "Initial task rejected" }) })),
      )
      const first = result((yield* seed.execute({ prompt: "Original retry task" })).output)
      expect(first.status).toBe("failed")
      const before = yield* seed.delegations.foldState(first.delegationID)
      expect(before?.participants.get(first.participantID)?.phase).toBe("failed")
      expect(before?.turns.size).toBe(1)
      const tasks = yield* seed.tasks.get(seed.parent.id)
      const history = yield* seed.sessions.context(first.sessionID)
      const exit = yield* seed
        .execute({
          command: "append",
          delegation_id: first.delegationID,
          task_id: first.sessionID,
          parent_task_id: first.parentTaskID,
        })
        .pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("requires retry before new work")
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(tasks)
      expect(yield* seed.sessions.context(first.sessionID)).toEqual(history)
      expect(yield* seed.llm.requests()).toHaveLength(1)

      yield* seed.agents.transform((editor) =>
        editor.update(toolIdentity.agent, (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task_reconcile", resource: first.delegationID, effect: "ask" },
          ]
        }),
      )
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
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(TestLLM.text("Retry succeeded", "retry"))
      const scope = yield* Effect.scope
      const fiber = yield* seed
        .execute({
          command: "retry",
          delegation_id: first.delegationID,
          participant_id: first.participantID,
          turn_id: first.turnID,
          prompt: "Management text must not replace the saved task",
        })
        .pipe(Effect.forkIn(scope))
      const request = yield* awaitWithTimeout(Deferred.await(asked), "Task retry did not request permission")
      expect(request).toMatchObject({
        action: "task_reconcile",
        resources: [first.delegationID],
        sessionID: seed.parent.id,
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-task" },
      })
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(tasks)
      yield* seed.permission.reply({ requestID: request.id, reply: "once" })
      const response = yield* awaitWithTimeout(Fiber.join(fiber), "Task retry command did not complete")
      expect(Schema.decodeUnknownSync(TaskTool.Output)(response.output)).toMatchObject({
        sessionID: seed.parent.id,
        delegationID: first.delegationID,
        status: "completed",
      })
      yield* awaitWithTimeout(gate.started, "Task retry model request missing")
      const state = yield* seed.delegations.foldState(first.delegationID)
      const delivery = [...(state?.deliveries.values() ?? [])].find((item) => item.turnID === first.turnID)
      if (!delivery) return yield* Effect.die(new Error("Retry delivery missing"))
      expect(delivery.attempt).toBe(2)
      yield* gate.release
      expect(
        yield* seed.execution.wait({
          ...delivery,
          delegationID: first.delegationID,
          childSessionID: first.sessionID,
          inputID: DelegationExecution.inputID(first.delegationID, delivery),
        }),
      ).toEqual({ status: "completed", text: "Retry succeeded" })
      expect((yield* seed.delegations.foldState(first.delegationID))?.turns.size).toBe(1)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([
        expect.objectContaining({ id: first.parentTaskID, status: "completed", outputDigest: "Retry succeeded" }),
      ])
      expect((yield* seed.llm.requests())[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Original retry task" }],
      })
    }),
  )
  ;(["interrupt", "close"] as const).forEach((command) =>
    it.live(`authorizes the canonical ${command} command before cancelling a real child task`, () =>
      Effect.gen(function* () {
        yield* backgroundFlag(true)
        const seed = yield* setup()
        const gate = yield* seed.llm.gate()
        yield* seed.llm.push(TestLLM.hangAfter(), TestLLM.text("Cancellation received", "managed-parent"))
        const first = result((yield* seed.execute({ background: true })).output)
        yield* awaitWithTimeout(gate.started, "Managed child task did not start")
        const before = yield* seed.delegations.foldState(first.delegationID)
        const delivery = [...(before?.deliveries.values() ?? [])][0]
        if (!delivery) return yield* Effect.die(new Error("Managed task delivery missing"))
        yield* seed.agents.transform((editor) =>
          editor.update(toolIdentity.agent, (agent) => {
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: `task_${command}`, resource: first.delegationID, effect: "ask" },
            ]
          }),
        )
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
        const scope = yield* Effect.scope
        const fiber = yield* seed
          .execute({ command, delegation_id: first.delegationID, participant_id: first.participantID })
          .pipe(Effect.forkIn(scope))
        const request = yield* awaitWithTimeout(Deferred.await(asked), "Management command did not ask permission")
        expect(request).toMatchObject({
          action: `task_${command}`,
          resources: [first.delegationID],
          sessionID: seed.parent.id,
          source: { type: "tool", messageID: toolIdentity.messageID, id: "call-task" },
        })
        expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
        expect((yield* seed.tasks.get(seed.parent.id))[0]?.status).toBe("in_progress")
        yield* gate.release
        yield* seed.permission.reply({ requestID: request.id, reply: "once" })
        const response = yield* awaitWithTimeout(Fiber.join(fiber), "Management command did not complete")
        expect(Schema.decodeUnknownSync(TaskTool.Output)(response.output)).toMatchObject({
          sessionID: seed.parent.id,
          delegationID: first.delegationID,
          status: "completed",
        })
        expect(
          yield* seed.execution.wait({
            ...delivery,
            delegationID: first.delegationID,
            childSessionID: first.sessionID,
            inputID: first.inputID,
          }),
        ).toMatchObject({ status: "cancelled" })
        const state = yield* seed.delegations.foldState(first.delegationID)
        expect(state?.turns.size).toBe(1)
        if (command === "close") {
          expect(state?.delegation.status).toBe("closing")
          expect(state?.participants.get(first.participantID)?.phase).toBe("closed")
        }
        expect(yield* seed.tasks.get(seed.parent.id)).toEqual([
          expect.objectContaining({ id: first.parentTaskID, status: "cancelled" }),
        ])
        yield* awaitWithTimeout(seed.llm.wait(2), "Parent did not consume the management cancellation notice")
        yield* seed.runs.awaitIdle(first.sessionID)
        yield* seed.runs.awaitIdle(seed.parent.id)
        const history = yield* seed.sessions.context(seed.parent.id)
        expect(history.filter((message) => message.type === "synthetic")).toEqual([
          expect.objectContaining({
            metadata: expect.objectContaining({
              source: "task",
              childID: first.sessionID,
              state: "cancelled",
              parentTaskID: first.parentTaskID,
              inputID: first.inputID,
              delegation: {
                delegationID: first.delegationID,
                participantID: first.participantID,
                turnID: first.turnID,
                attempt: 1,
                deliveryOrigin: "meta",
                senderParticipantID: first.participantID,
              },
              communication: expect.objectContaining({
                actor: expect.objectContaining({ type: "system", sessionID: first.sessionID }),
                targetSessionID: seed.parent.id,
                body: expect.objectContaining({ sessionID: seed.parent.id }),
              }),
            }),
          }),
        ])
        expect(history.find((message) => message.type === "assistant")).toMatchObject({
          content: [{ type: "text", text: "Cancellation received" }],
          time: { completed: expect.any(Object) },
        })
        expect(history.some((message) => message.type === "idle" && message.outcome === "failed")).toBe(false)
        expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
        expect(yield* seed.llm.requests()).toHaveLength(2)
      }),
    ),
  )
  it.live("MC07 R2 complete archives a completed internal delegation and is idempotent", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("Completed implementation", "mc07-r2-complete-child"))
      const first = result((yield* seed.execute()).output)
      const response = yield* seed.execute({ command: "complete", delegation_id: first.delegationID })
      const terminal = Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)({
        sessionID: seed.parent.id,
        assistantMessageID: toolIdentity.messageID,
        id: "call-task",
        content: response.content,
        metadata: response.metadata,
        executed: false,
      })
      expect(Schema.encodeSync(Schema.toCodecJson(SessionEvent.Tool.Success.data))(terminal)).toMatchObject({
        metadata: { sessionID: seed.parent.id, delegationID: first.delegationID, status: "completed" },
      })
      expect(Schema.decodeUnknownSync(TaskTool.Output)(response.output)).toMatchObject({
        sessionID: seed.parent.id,
        delegationID: first.delegationID,
        status: "completed",
      })
      const completed = yield* seed.delegations.foldState(first.delegationID)
      expect(completed?.delegation).toMatchObject({
        status: "archived",
        completedAt: expect.any(Number),
      })
      expect(completed?.archivedFrom).toBe("completed")
      expect(completed?.participants.get(first.participantID)?.phase).toBe("closed")
      yield* seed.execute({ command: "complete", delegation_id: first.delegationID })
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(completed)
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )
  it.live("MC07 R2 complete requires task_archive after task_close before lifecycle mutation", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("Completed implementation", "mc07-r2-archive-deny-child"))
      const first = result((yield* seed.execute()).output)
      const before = yield* seed.delegations.foldState(first.delegationID)
      yield* seed.agents.transform((editor) =>
        editor.update(toolIdentity.agent, (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task_close", resource: first.delegationID, effect: "allow" },
            { action: "task_archive", resource: first.delegationID, effect: "deny" },
          ]
        }),
      )
      const exit = yield* seed.execute({ command: "complete", delegation_id: first.delegationID }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("task_archive")
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      expect((yield* seed.tasks.get(seed.parent.id))[0]?.status).toBe("completed")
    }),
  )
  it.live("MC07 R2 complete requests task_close then task_archive from the same invocation", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("Completed implementation", "mc07-r2-complete-ask-child"))
      const first = result((yield* seed.execute()).output)
      const before = yield* seed.delegations.foldState(first.delegationID)
      yield* seed.agents.transform((editor) =>
        editor.update(toolIdentity.agent, (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "task_close", resource: first.delegationID, effect: "ask" },
            { action: "task_archive", resource: first.delegationID, effect: "ask" },
          ]
        }),
      )
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const closeAsked = yield* Deferred.make<Permission.Request>()
      const archiveAsked = yield* Deferred.make<Permission.Request>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
        if (request.action === "task_close") return Deferred.succeed(closeAsked, request).pipe(Effect.asVoid)
        if (request.action === "task_archive") return Deferred.succeed(archiveAsked, request).pipe(Effect.asVoid)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* seed
        .execute({ command: "complete", delegation_id: first.delegationID })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const close = yield* awaitWithTimeout(Deferred.await(closeAsked), "MC07 complete did not ask task_close")
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      expect(
        (yield* seed.permission.forSession(seed.parent.id)).filter((request) => request.action === "task_archive"),
      ).toEqual([])
      yield* seed.permission.reply({ requestID: close.id, reply: "once" })
      const archive = yield* awaitWithTimeout(Deferred.await(archiveAsked), "MC07 complete did not ask task_archive")
      expect(close).toMatchObject({
        action: "task_close",
        resources: [first.delegationID],
        sessionID: seed.parent.id,
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-task" },
      })
      expect(archive).toMatchObject({
        action: "task_archive",
        resources: close.resources,
        sessionID: close.sessionID,
        source: close.source,
      })
      expect(archive.id).not.toBe(close.id)
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      yield* seed.permission.reply({ requestID: archive.id, reply: "once" })
      const response = yield* awaitWithTimeout(Fiber.join(fiber), "MC07 complete did not finish after both permissions")
      expect(Schema.decodeUnknownSync(TaskTool.Output)(response.output)).toMatchObject({
        status: "completed",
        delegationID: first.delegationID,
      })
      expect((yield* seed.delegations.foldState(first.delegationID))?.archivedFrom).toBe("completed")
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
    }),
  )
  it.live("MC07 R2 complete refuses after an early Task close preserves cancellation", () =>
    Effect.gen(function* () {
      yield* backgroundFlag(true)
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        TestLLM.hangAfter(),
        TestLLM.text("The early cancellation was consumed.", "mc07-r2-early-close-parent"),
      )
      const first = result((yield* seed.execute({ background: true })).output)
      yield* awaitWithTimeout(gate.started, "MC07 early close child did not start")
      yield* gate.release
      yield* seed.execute({ command: "close", delegation_id: first.delegationID })
      const closed = yield* seed.delegations.foldState(first.delegationID)
      expect(closed?.delegation.status).toBe("closing")
      expect([...(closed?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["cancelled"])
      expect((yield* seed.tasks.get(seed.parent.id))[0]?.status).toBe("cancelled")
      const exit = yield* seed.execute({ command: "complete", delegation_id: first.delegationID }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("completion barrier")
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(closed)
      yield* awaitWithTimeout(seed.llm.wait(2), "MC07 parent did not consume the early close notification")
      yield* awaitWithTimeout(seed.runs.awaitIdle(seed.parent.id), "MC07 early close parent did not settle")
    }),
  )
  ;(["close", "interrupt", "retry", "complete"] as const).forEach((command) =>
    it.live(`requires an explicitly selected owned delegation for ${command}`, () =>
      Effect.gen(function* () {
        const seed = yield* setup("ask")
        const missing = yield* seed.execute({ command }).pipe(Effect.exit)
        const missingError = Exit.isFailure(missing) ? Cause.squash(missing.cause) : undefined
        expect(missingError instanceof Tool.Error && missingError.message).toContain("delegation_id is required")
        const other = yield* createLegacySession({ location: seed.parent.location, model, title: "Other task owner" })
        const foreign = yield* seed.delegations.create({ parentSessionID: other.id, title: "Foreign delegation" })
        const before = yield* seed.delegations.foldState(foreign.id)
        const exit = yield* seed.execute({ command, delegation_id: foreign.id }).pipe(Effect.exit)
        const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
        expect(error instanceof Tool.Error && error.message).toContain("does not belong to parent session")
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
        expect(yield* seed.delegations.foldState(foreign.id)).toEqual(before)
        expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
        expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
        expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
        expect(yield* seed.llm.requests()).toEqual([])
      }),
    ),
  )
  ;(
    [
      [
        { execution_type: "external-cli" },
        "External execution requires a configured CLI transport with its matching subagent, no internal child ID/model override, and a non-Custom parent",
      ],
      [
        { execution_type: "external-cli", subagent_type: "codex", cli_target: "codex", command: "steer" },
        "External steer requires foreground execution and explicit existing delegation_id and participant_id",
      ],
      ...([true, false] as const).map(
        (attended) =>
          [
            {
              execution_type: "external-cli" as const,
              subagent_type: "codex",
              cli_target: "codex",
              command: "steer" as const,
              delegation_id: DelegationID.ID.create(),
              participant_id: ParticipantID.create(),
              attended,
            },
            "External steer inherits the original Job's approval scope; attended cannot be changed",
          ] as const,
      ),
      [
        {
          execution_type: "external-cli",
          subagent_type: "codex",
          cli_target: "codex",
          command: "steer",
          delegation_id: DelegationID.ID.create(),
          participant_id: ParticipantID.create(),
          new_delegation: true,
        },
        "External steer requires foreground execution and explicit existing delegation_id and participant_id",
      ],
      [
        { execution_type: "external-cli", subagent_type: "codex", cli_target: "codex", model },
        "External execution requires a configured CLI transport with its matching subagent, no internal child ID/model override, and a non-Custom parent",
      ],
      [
        { execution_type: "external-cli", subagent_type: "codex", cli_target: "codex", judge_models: ["test/task"] },
        "External execution requires a configured CLI transport with its matching subagent, no internal child ID/model override, and a non-Custom parent",
      ],
      [
        { execution_type: "external-cli", subagent_type: "codex", cli_target: "codex", task_id: "ses_missing" },
        "External execution requires a configured CLI transport with its matching subagent, no internal child ID/model override, and a non-Custom parent",
      ],
      [{ execution_type: "judge" }, "Judge Task requires the selected Meta in Work"],
      [{ cli_target: "codex" }, "cli_target requires external-cli; judge_models requires judge"],
      [{ judge_models: ["test/task"] }, "cli_target requires external-cli; judge_models requires judge"],
      [{ attended: true }, "Attended task execution is not available"],
      [{ turn_id: TurnID.create() }, "turn_id is only supported by retry"],
    ] satisfies ReadonlyArray<readonly [Partial<typeof TaskTool.Input.Type>, string]>
  ).forEach(([input, message]) =>
    it.live(`rejects unsupported task options: ${message}`, () =>
      Effect.gen(function* () {
        const seed = yield* setup()
        const before = yield* seed.sessions.list()
        const exit = yield* seed.execute(input).pipe(Effect.exit)
        const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
        expect(error).toBeInstanceOf(Tool.Error)
        expect(error instanceof Tool.Error && error.message).toContain(message)
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
        expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
        expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
        expect(yield* seed.sessions.list()).toEqual(before)
        expect(yield* seed.llm.requests()).toEqual([])
      }),
    ),
  )

  it.live("rejects a child-ID from another selected delegation before admitting work", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(TestLLM.text("first", "first"))
      const first = result((yield* seed.execute()).output)
      const other = yield* seed.delegations.create({ parentSessionID: seed.parent.id, title: "Other delegation" })
      const before = yield* seed.delegations.list({ parentSessionID: seed.parent.id })
      const tasks = yield* seed.tasks.get(seed.parent.id)
      const exit = yield* seed.execute({ delegation_id: other.id, task_id: first.sessionID }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("does not belong to the selected delegation")
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual(before)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(tasks)
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("links an owned parent Task and completes it without appending another Task", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const parentTask = (yield* seed.tasks.append({
        sessionID: seed.parent.id,
        tasks: [{ content: "Existing planned task", status: "pending", priority: "high" }],
      })).at(-1)
      if (!parentTask) return yield* Effect.die(new Error("Parent task missing"))
      yield* seed.llm.push(TestLLM.text("Linked task finished", "linked"))
      const output = result((yield* seed.execute({ parent_task_id: parentTask.id })).output)
      expect(output.parentTaskID).toBe(parentTask.id)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([
        expect.objectContaining({
          id: parentTask.id,
          content: "Existing planned task",
          status: "completed",
          priority: "high",
          outputDigest: "Linked task finished",
          revision: parentTask.revision + 2,
        }),
      ])
      expect((yield* seed.sessions.context(output.sessionID)).find((message) => message.type === "user")).toMatchObject(
        {
          id: output.inputID,
          metadata: { task: { parentTaskID: parentTask.id, parentTaskRevision: parentTask.revision + 1 } },
        },
      )
    }),
  )

  it.live("rejects a foreign parent Task without changing either session's Task list", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const other = yield* createLegacySession({ location: seed.parent.location, model, title: "Other parent" })
      const foreign = (yield* seed.tasks.append({
        sessionID: other.id,
        tasks: [{ content: "Other session task", status: "pending", priority: "medium" }],
      })).at(-1)
      if (!foreign) return yield* Effect.die(new Error("Foreign parent task missing"))
      const before = yield* seed.sessions.list()
      const exit = yield* seed.execute({ parent_task_id: foreign.id }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("does not belong to this session")
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.tasks.get(other.id)).toEqual([foreign])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("keeps a scheduled parent Task under its schedule's ownership", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const now = yield* DateTime.nowAsDate
      const tasks = yield* seed.tasks.append({
        sessionID: seed.parent.id,
        tasks: [
          {
            content: "Scheduled parent task",
            status: "scheduled",
            priority: "medium",
            scheduledAt: now.getTime() + 3_600_000,
          },
        ],
      })
      const scheduled = tasks.at(-1)
      if (!scheduled) return yield* Effect.die(new Error("Scheduled parent task missing"))
      const before = yield* seed.sessions.list()
      const exit = yield* seed.execute({ parent_task_id: scheduled.id }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("schedule owns execution")
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(tasks)
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("rejects retry when the linked failed Task has been reassigned to a schedule", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      yield* seed.llm.push(
        Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "Scheduled retry initial failure" }) })),
      )
      const first = result((yield* seed.execute()).output)
      expect(first.status).toBe("failed")
      yield* seed.runs.awaitIdle(first.sessionID)
      const task = (yield* seed.tasks.get(seed.parent.id)).find((item) => item.id === first.parentTaskID)
      if (!task) return yield* Effect.die(new Error("Failed parent Task missing"))
      const now = yield* DateTime.nowAsDate
      const scheduled = yield* seed.tasks.update({
        sessionID: seed.parent.id,
        tasks: [{ ...task, status: "scheduled", scheduledAt: now.getTime() + 3_600_000 }],
      })
      const before = yield* seed.delegations.foldState(first.delegationID)
      const inbox = yield* seed.sessions.inbox(first.sessionID)
      const history = yield* seed.sessions.context(first.sessionID)
      const requests = yield* seed.llm.requests()
      const exit = yield* seed
        .execute({
          command: "retry",
          delegation_id: first.delegationID,
          participant_id: first.participantID,
          turn_id: first.turnID,
        })
        .pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error instanceof Tool.Error && error.message).toContain("Linked parent Task is unavailable for retry")
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
      expect(yield* seed.delegations.foldState(first.delegationID)).toEqual(before)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(scheduled)
      expect(yield* seed.sessions.inbox(first.sessionID)).toEqual(inbox)
      expect(yield* seed.sessions.context(first.sessionID)).toEqual(history)
      expect(yield* seed.llm.requests()).toEqual(requests)
      expect([...(before?.deliveries.values() ?? [])][0]?.attempt).toBe(1)
    }),
  )

  it.live("rejects a missing Custom snapshot before creating task or delegation state", () =>
    Effect.gen(function* () {
      const seed = yield* setup()
      const database = yield* Database.Service
      // V2 has no public mode-switch command; set the persisted legacy placement as a fixture.
      yield* database.db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, seed.parent.id)).run()
      expect((yield* seed.sessions.get(seed.parent.id)).mode).toBe("custom")
      const before = yield* seed.sessions.list()
      const exit = yield* seed.execute().pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error).toBeInstanceOf(Tool.Error)
      expect(yield* seed.compositions.get(seed.parent.id).pipe(Effect.flip)).toBeInstanceOf(
        SessionComposition.SnapshotNotFoundError,
      )
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("authorizes a frozen Custom alias before writes and executes its canonical worker despite live changes", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      yield* seed.agents.transform((editor) => {
        editor.update(worker, (agent) => {
          agent.mode = "primary"
          agent.model = Model.Ref.parse("test/live-worker")
          agent.permissions = [{ action: "*", resource: "*", effect: "deny" }]
        })
        editor.update(Agent.ID.make(seed.info.name), (agent) => {
          agent.mode = "subagent"
          agent.model = model
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
      yield* seed.llm.push(TestLLM.text("Frozen Custom result", "custom"))
      const before = yield* seed.sessions.list()
      const scope = yield* Effect.scope
      const fiber = yield* seed.execute({ subagent_type: seed.info.name }).pipe(Effect.forkIn(scope))
      const request = yield* awaitWithTimeout(Deferred.await(asked), "Custom task did not request permission")
      expect(request).toMatchObject({
        sessionID: seed.parent.id,
        action: "task",
        resources: [worker],
        source: { type: "tool", messageID: toolIdentity.messageID, id: "call-task" },
      })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      yield* seed.permission.reply({ requestID: request.id, reply: "once" })
      const output = result(
        (yield* awaitWithTimeout(Fiber.join(fiber), "Custom task did not finish", "10 seconds")).output,
      )
      expect(output).toMatchObject({ status: "completed", output: taskText(output.sessionID, "Frozen Custom result") })
      expect(yield* seed.sessions.get(output.sessionID)).toMatchObject({
        parentID: seed.parent.id,
        mode: "custom",
        agent: worker,
        model,
      })
      expect((yield* seed.compositions.selectAgent(output.sessionID, worker)).info.model).toEqual(model)
      expect(
        (yield* seed.delegations.getParticipant({
          delegationID: output.delegationID,
          participantID: output.participantID,
        }))?.target,
      ).toBe(worker)
      expect(yield* seed.llm.requests()).toHaveLength(1)
    }),
  )

  it.live("applies a Custom deny to the canonical worker when invoked by its frozen alias", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom("deny")
      const before = yield* seed.sessions.list()
      const error = yield* seed.execute({ subagent_type: seed.info.name }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("rejects live-only targets and meta outside the frozen Custom executor pool", () =>
    Effect.gen(function* () {
      const seed = yield* setupCustom()
      yield* seed.agents.transform((editor) =>
        editor.update(Agent.ID.make("live-only-worker"), (agent) => {
          agent.mode = "subagent"
          agent.model = model
        }),
      )
      const before = yield* seed.sessions.list()
      for (const subagent_type of ["live-only-worker", "meta"]) {
        expect(yield* seed.execute({ subagent_type }).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
      }
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([])
      expect(yield* seed.delegations.list({ parentSessionID: seed.parent.id })).toEqual([])
      expect(yield* seed.sessions.list()).toEqual(before)
      expect(yield* seed.permission.forSession(seed.parent.id)).toEqual([])
      expect(yield* seed.llm.requests()).toEqual([])
    }),
  )

  it.live("ignores background when its experimental flag is disabled and returns the complete result", () =>
    Effect.gen(function* () {
      yield* backgroundFlag(false)
      const seed = yield* setup()
      const gate = yield* seed.llm.gate()
      const text = "Foreground fallback result\n\nForeground second paragraph"
      yield* seed.llm.push(
        TestLLM.stop(
          LLMEvent.textStart({ id: "fallback-first" }),
          LLMEvent.textDelta({ id: "fallback-first", text: "Foreground fallback result" }),
          LLMEvent.textEnd({ id: "fallback-first" }),
          LLMEvent.textStart({ id: "fallback-empty" }),
          LLMEvent.textEnd({ id: "fallback-empty" }),
          LLMEvent.textStart({ id: "fallback-second" }),
          LLMEvent.textDelta({ id: "fallback-second", text: "Foreground second paragraph" }),
          LLMEvent.textEnd({ id: "fallback-second" }),
        ),
      )
      const bus = yield* Bus.Service
      const call = {
        type: "tool-call" as const,
        id: "call-task",
        name: TaskTool.name,
        input: { description: "Review the task", prompt: "Full task prompt", subagent_type: worker, background: true },
      }
      const toolSource = { sessionID: seed.parent.id, assistantMessageID: toolIdentity.messageID, id: call.id }
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: seed.parent.id,
        assistantMessageID: toolSource.assistantMessageID,
        agent: toolIdentity.agent,
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, { ...toolSource, name: TaskTool.name })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, { ...toolSource, text: JSON.stringify(call.input) })
      yield* bus.publish(SessionEvent.Tool.Called, { ...toolSource, input: call.input, executed: false })
      yield* bus.publish(SessionEvent.Step.Streamed, {
        sessionID: seed.parent.id,
        assistantMessageID: toolSource.assistantMessageID,
      })
      const scope = yield* Effect.scope
      const fiber = yield* seed.snapshot
        .execute({ sessionID: seed.parent.id, ...toolIdentity, call })
        .pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(gate.started, "Fallback task did not start")
      yield* gate.release
      const response = yield* awaitWithTimeout(Fiber.join(fiber), "Fallback task did not complete")
      const output = result(response.output)
      expect(output.status).toBe("completed")
      expect(output.output).toBe(taskText(output.sessionID, text))
      if (!response.content || !isReadonlyArrayNonEmpty(response.content))
        return yield* Effect.die(new Error("Actual foreground Task content is missing"))
      yield* bus.publish(SessionEvent.Tool.Success, {
        ...toolSource,
        content: response.content,
        metadata: response.metadata,
        executed: true,
      })
      expect((yield* seed.tasks.get(seed.parent.id))[0]?.status).toBe("completed")
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      const sources = yield* seed.execution.readSources(output.delegationID)
      const source = sources.find((value) => value.receipt?.inputID === output.inputID)
      if (!source) return yield* Effect.die(new Error("Foreground delivery source is missing"))
      expect(yield* seed.execution.readResult(source)).toMatchObject({ available: true, text })
      const receipt = Schema.decodeUnknownSync(Delegation.Receipt)(response.metadata?.receipt)
      yield* seed.sessions.wait(receipt.childSessionID)
      yield* seed.sessions.revert.stage({ sessionID: receipt.childSessionID, messageID: receipt.inputID, files: false })
      yield* seed.sessions.revert.commit(receipt.childSessionID)
      const db = (yield* Database.Service).db
      expect(
        (yield* SessionInputResult.read(db, { sessionID: receipt.childSessionID, inputID: receipt.inputID })).status,
      ).toBe("missing")
      expect(yield* seed.execution.readResult(source)).toMatchObject({ available: true, text: output.output })
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, toolSource.assistantMessageID))
        .get()
      const message = yield* seed.sessions.message({
        sessionID: seed.parent.id,
        messageID: toolSource.assistantMessageID,
      })
      if (!row || message?.type !== "assistant")
        return yield* Effect.die(new Error("Original foreground Tool message is missing"))
      yield* Effect.forEach(
        [
          new Delegation.Receipt({ ...receipt, delegationID: DelegationID.ID.create() }),
          new Delegation.Receipt({ ...receipt, childSessionID: Session.ID.create() }),
          new Delegation.Receipt({ ...receipt, participantID: ParticipantID.create() }),
          new Delegation.Receipt({ ...receipt, turnID: TurnID.create() }),
          new Delegation.Receipt({ ...receipt, deliveryOrigin: "foreign-origin" }),
          new Delegation.Receipt({ ...receipt, senderParticipantID: ParticipantID.create() }),
          new Delegation.Receipt({ ...receipt, attempt: receipt.attempt + 1 }),
        ],
        (foreign) =>
          Effect.gen(function* () {
            yield* db
              .update(SessionMessageTable)
              .set({
                data: {
                  ...row.data,
                  content: Schema.encodeSync(SessionMessage.Assistant.fields.content)(
                    message.content.map((part) =>
                      part.type === "tool" && part.id === call.id && part.state.status === "completed"
                        ? {
                            ...part,
                            state: {
                              ...part.state,
                              metadata: {
                                ...part.state.metadata,
                                receipt: Schema.encodeSync(Schema.toCodecJson(Delegation.Receipt))(foreign),
                              },
                            },
                          }
                        : part,
                    ),
                  ),
                },
              })
              .where(eq(SessionMessageTable.id, row.id))
              .run()
            expect((yield* seed.execution.readResult(source)).available).toBe(false)
          }).pipe(
            Effect.ensuring(
              db
                .update(SessionMessageTable)
                .set({ data: row.data })
                .where(eq(SessionMessageTable.id, row.id))
                .run()
                .pipe(Effect.orDie),
            ),
          ),
      )
      expect(yield* seed.execution.readResult(source)).toMatchObject({ available: true, text: output.output })
    }),
  )

  it.live("returns a background handle and completes the Task after its plugin registration scope closes", () =>
    Effect.gen(function* () {
      yield* backgroundFlag(true)
      const seed = yield* setup()
      // Replace the effective production registration with the same plugin in an independently disposable scope.
      yield* seed.registry.transform((editor) => editor.remove(TaskTool.name))
      const pluginScope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(pluginScope, Exit.void))
      yield* registerToolPlugin(TaskTool.Plugin).pipe(
        Effect.provideContext(seed.pluginContext),
        Scope.provide(pluginScope),
      )
      const gate = yield* seed.llm.gate()
      yield* seed.llm.push(
        TestLLM.text("Background complete result", "background"),
        TestLLM.text("Background notice received", "background-parent"),
      )
      const snapshot = yield* seed.registry.snapshot()
      const bus = yield* Bus.Service
      const call = {
        type: "tool-call" as const,
        id: "call-background-task",
        name: TaskTool.name,
        input: {
          description: "Background review task",
          prompt: "Full background prompt",
          subagent_type: worker,
          background: true,
        },
      }
      const source = { sessionID: seed.parent.id, assistantMessageID: toolIdentity.messageID, id: call.id }
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: seed.parent.id,
        assistantMessageID: source.assistantMessageID,
        agent: toolIdentity.agent,
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, { ...source, name: TaskTool.name })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, { ...source, text: JSON.stringify(call.input) })
      yield* bus.publish(SessionEvent.Tool.Called, { ...source, input: call.input, executed: false })
      yield* bus.publish(SessionEvent.Step.Streamed, {
        sessionID: seed.parent.id,
        assistantMessageID: source.assistantMessageID,
      })
      const response = yield* snapshot.execute({
        sessionID: seed.parent.id,
        ...toolIdentity,
        call,
      })
      const output = result(response.output)
      expect(output.status).toBe("running")
      expect(output.output).toContain("You will be notified automatically")
      if (!response.content || !isReadonlyArrayNonEmpty(response.content))
        return yield* Effect.die(new Error("Actual background ACK content is missing"))
      yield* bus.publish(SessionEvent.Tool.Success, {
        ...source,
        content: response.content,
        metadata: response.metadata,
        executed: true,
      })
      yield* awaitWithTimeout(gate.started, "Background task did not start")
      expect((yield* seed.tasks.get(seed.parent.id))[0]?.status).toBe("in_progress")
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      const beforeRead = {
        tasks: yield* seed.tasks.get(seed.parent.id),
        requests: yield* seed.llm.requests(),
        inboxes: yield* Effect.forEach([seed.parent.id, output.sessionID], (sessionID) =>
          seed.sessions.inbox(sessionID),
        ),
        contexts: yield* Effect.forEach([seed.parent.id, output.sessionID], (sessionID) =>
          seed.sessions.context(sessionID),
        ),
        events: yield* Effect.forEach([seed.parent.id, output.sessionID, output.delegationID], (aggregateID) =>
          bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
      }
      const ackMessage = beforeRead.contexts[0]?.find((message) => message.id === source.assistantMessageID)
      if (ackMessage?.type !== "assistant")
        return yield* Effect.die(new Error("Projected background ACK message is missing"))
      const ack = ackMessage.content.find((part) => part.type === "tool" && part.id === call.id)
      if (ack?.type !== "tool") return yield* Effect.die(new Error("Projected background ACK Tool is missing"))
      expect(ack.state).toMatchObject({ status: "completed", metadata: { status: "running" } })
      const readClaim = (id: string) =>
        Context.get(seed.pluginContext, Database.Service)
          .db.select({ value: KVTable.value })
          .from(KVTable)
          .where(eq(KVTable.key, `task:claim:${seed.parent.id}:${id}`))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row?.value),
          )
      expect(yield* readClaim(output.parentTaskID)).toMatchObject({
        parentTaskID: output.parentTaskID,
        source: { type: "tool", messageID: source.assistantMessageID, id: source.id },
      })
      const blocked = yield* seed.tasks
        .updateTask(
          { sessionID: seed.parent.id, id: output.parentTaskID, status: "completed" },
          {
            management: { type: "tool", messageID: source.assistantMessageID, id: "ma01-background-manager" },
          },
        )
        .pipe(Effect.result)
      expect(blocked._tag).toBe("Failure")
      if (blocked._tag === "Failure") expect(blocked.failure.reason).toBe("execution_owned")
      const sources = yield* seed.execution.readSources(output.delegationID)
      const delivery = sources.find((value) => value.receipt?.inputID === output.inputID)
      if (!delivery) return yield* Effect.die(new Error("Background delivery source is missing"))
      expect(delivery.source).toEqual({ type: "tool", messageID: source.assistantMessageID, id: source.id })
      expect((yield* seed.execution.readResult(delivery)).available).toBe(false)
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual(beforeRead.tasks)
      expect(yield* seed.llm.requests()).toEqual(beforeRead.requests)
      expect(
        yield* Effect.forEach([seed.parent.id, output.sessionID], (sessionID) => seed.sessions.inbox(sessionID)),
      ).toEqual(beforeRead.inboxes)
      expect(
        yield* Effect.forEach([seed.parent.id, output.sessionID], (sessionID) => seed.sessions.context(sessionID)),
      ).toEqual(beforeRead.contexts)
      expect(
        yield* Effect.forEach([seed.parent.id, output.sessionID, output.delegationID], (aggregateID) =>
          bus.log({ aggregateID }).pipe(Stream.runCollect),
        ),
      ).toEqual(beforeRead.events)
      yield* Scope.close(pluginScope, Exit.void)
      expect((yield* seed.registry.snapshot()).definitions.map((tool) => tool.name)).not.toContain(TaskTool.name)
      yield* gate.release
      yield* awaitWithTimeout(seed.llm.wait(2), "Parent did not consume the background completion notice")
      yield* seed.runs.awaitIdle(output.sessionID)
      yield* seed.runs.awaitIdle(seed.parent.id)
      const notification = (yield* seed.sessions.log({ sessionID: seed.parent.id }).pipe(Stream.runCollect))
        .filter((event): event is SessionEvent.InboxEnqueued => event.type === SessionEvent.InboxEnqueued.type)
        .find(
          (event) =>
            event.data.item.type === "synthetic" &&
            event.data.item.payload.metadata?.source === "task" &&
            event.data.item.payload.metadata?.childID === output.sessionID,
        )
      if (!notification)
        return yield* Effect.die(new Error("The real background Task notification admission is missing"))
      const notice = notification.data
      expect(notice.item).toMatchObject({
        type: "synthetic",
        payload: {
          description: "Background review task",
          text: `<task id="${output.sessionID}" state="completed">\nBackground complete result\n</task>`,
          metadata: {
            source: "task",
            childID: output.sessionID,
            state: "completed",
            parentTaskID: output.parentTaskID,
            inputID: output.inputID,
          },
        },
      })
      expect(yield* seed.tasks.get(seed.parent.id)).toEqual([
        expect.objectContaining({
          id: output.parentTaskID,
          status: "completed",
          outputDigest: "Background complete result",
        }),
      ])
      const history = yield* seed.sessions.context(seed.parent.id)
      expect(history.filter((message) => message.type === "synthetic")).toEqual([
        expect.objectContaining({ id: notice.inboxID }),
      ])
      expect(
        history.find((message) => message.type === "assistant" && message.id !== source.assistantMessageID),
      ).toMatchObject({
        content: [{ type: "text", text: "Background notice received" }],
        time: { completed: expect.any(Object) },
      })
      expect(yield* seed.execution.readResult(delivery)).toMatchObject({
        available: true,
        text: "Background complete result",
      })
      expect(yield* readClaim(output.parentTaskID)).toBeUndefined()
      expect(history.some((message) => message.type === "idle" && message.outcome === "failed")).toBe(false)
      expect(yield* seed.sessions.inbox(seed.parent.id)).toEqual([])
      expect(yield* seed.llm.requests()).toHaveLength(2)
    }),
  )
})
