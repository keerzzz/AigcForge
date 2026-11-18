import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { LLMClient } from "@aigcfroge/ai"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Money } from "@aigcfroge/schema/money"
import { Shell } from "@aigcfroge/schema/shell"
import { Skill } from "@aigcfroge/schema/skill"
import { Agent } from "@aigcfroge/core/agent"
import { and, asc, eq, getTableName, sql } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Hash } from "@aigcfroge/util/hash"
import { Bus } from "@aigcfroge/core/bus"
import { EventSequenceTable, EventTable } from "@aigcfroge/core/event/sql"
import { Instructions } from "@aigcfroge/core/instructions/index"
import { Location } from "@aigcfroge/core/location"
import { Model } from "@aigcfroge/core/model"
import { ModelGroup } from "@aigcfroge/core/model-group"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath, RelativePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionInputResult } from "@aigcfroge/core/session/input-result"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { InstructionEntry } from "@aigcfroge/core/session/instruction-entry"
import { SessionEvent } from "@aigcfroge/core/session/event"
import {
  SessionCompositionSnapshotTable,
  SessionConsultationTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
} from "@aigcfroge/core/session/sql"
import { MetaAgentSessionTable, MetaAgentTable } from "@aigcfroge/core/meta-agent/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTransfer } from "@aigcfroge/core/session/transfer"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { Config } from "@aigcfroge/core/config"
import { Event } from "@aigcfroge/schema/event"
import { Workspace } from "@aigcfroge/core/workspace"
import { Expected } from "./lib/session-message"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { promptLocationNode } from "./fixture/prompt-location"
import { globalProjectNode } from "./lib/project"
import { tmpdirScoped } from "./fixture/tmpdir"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionContext } from "@aigcfroge/core/session/context"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Composition } from "@aigcfroge/schema/composition"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { withCustomMode } from "./lib/product-mode"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionTransfer.node,
      InstructionEntry.node,
      Project.node,
      LocationServiceMap.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const liveIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)
const projectIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      // Project adoption needs plain-prompt admission, not live plugin/provider startup.
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const admissionLLM = makeGlobalNode({ service: TestLLM.Test, layer: TestLLM.testLayer(), deps: [] })
const admissionIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      Session.node,
      SessionComposition.node,
      MetaAgentService.node,
      DelegationService.node,
      LocationServiceMap.node,
      admissionLLM,
    ]),
    [Global.node.replace(tempGlobalLayer), Bus.node.replace(Bus.configured({ persist: true })), offlineModels,
      LayerNodePlatform.llmClient.replace(makeGlobalNode({ service: LLMClient.Service,
        layer: Layer.effect(LLMClient.Service, TestLLM.Test), deps: [admissionLLM],
      })),
    ],
  ),
)

const metaAdmission = Effect.fn("Keeper.metaAdmission")(function* (custom: boolean, executorGroup?: Model.GroupRef) {
  const directory = yield* tmpdirScoped()
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
  const agent = `---\nkind: agent\nname: meta-worker\ndescription: Meta admission executor\n${executorGroup ? `config: |\n  model: group:${executorGroup.groupID}\n  mode: subagent\n` : ""}---\nUse the admitted input.\n`
  if (custom)
    yield* Effect.promise(() => Bun.write(path.join(directory.path, ".aigcfroge/agents/meta-worker.md"), agent))
  const model = Model.Ref.make({ providerID: Provider.ID.make("meta-admission-keeper"), id: Model.ID.make("meta") })
  const locations = yield* LocationServiceMap.Service
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@aigcfroge/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provide(locations.get(location)))
  const projects = yield* Project.Service
  yield* projects.resolve(location.directory)
  const id = Session.ID.create()
  const sessions = yield* Session.Service
  const db = (yield* Database.Service).db
  const composition = custom
    ? new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          new Composition.AgentRef({
            kind: "agent",
            relativePath: "meta-worker.md",
            revision: Composition.Revision.make(Hash.sha256(Buffer.from(agent))),
          }),
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })
    : undefined
  return {
    id,
    location,
    model,
    composition,
    db,
    bus: yield* Bus.Service,
    metas: yield* MetaAgentService.Service,
    create: (selection: Model.Selection = model) =>
      composition
        ? sessions.createCustom({ id, location, model: selection, composition }).pipe(Effect.map((response) => response.session))
        : sessions.create({ id, location, model: selection, agent: Agent.ID.make("meta") }),
    read: () =>
      Effect.all({
        sessions: db.select().from(SessionTable).orderBy(asc(SessionTable.id)),
        metas: db.select().from(MetaAgentTable).orderBy(asc(MetaAgentTable.id)),
        owners: db
          .select()
          .from(MetaAgentSessionTable)
          .orderBy(asc(MetaAgentSessionTable.meta_agent_id), asc(MetaAgentSessionTable.session_id)),
        snapshots: db
          .select()
          .from(SessionCompositionSnapshotTable)
          .orderBy(asc(SessionCompositionSnapshotTable.session_id)),
        events: db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).orderBy(asc(EventTable.seq)),
        sequences: db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)),
      }),
  }
})

const saveSessionGroup = Effect.fnUntraced(function* (location: Location.Ref, groupID: Model.GroupID, members: readonly Model.Ref[]) {
  const locations = yield* LocationServiceMap.Service
  const config = yield* Config.Service.pipe(Effect.provide(locations.get(location)))
  if (!config.provider) return yield* Effect.die(new Error("Authored Group configuration is missing"))
  const target = (yield* config.provider.list()).targets.find((target) => target.scope === "project" && target.preferred)
  if (!target) return yield* Effect.die(new Error("Project Group target is missing"))
  const saved = yield* ModelGroup.save(ModelGroup.decodeSave({
    groupID, target: { scope: target.scope, path: target.path }, expectedDigest: target.digest,
    patch: { set: { name: groupID, enabled: true, members: [...members], strategy: "order", affinity: "turn" } },
  })).pipe(Effect.provideService(Config.Service, config))
  expect(saved.definition.status).toBe("saved")
  return yield* ModelGroup.behavior(groupID).pipe(Effect.provideService(Config.Service, config))
})

admissionIt.live("runs ordinary Meta Group selection from current configuration without a Composition snapshot", () => Effect.gen(function* () {
  const f = yield* metaAdmission(false)
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.location)
  const next = Model.Ref.make({ providerID: f.model.providerID, id: Model.ID.make("next") })
  yield* useOfflineCatalog([{
    info: Provider.Info.make({ ...Provider.Info.empty(f.model.providerID), activation: "enabled", package: "@aigcfroge/ai/providers/openai/responses" }),
    models: [f.model, next].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
  }]).pipe(Effect.provide(local))
  const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("dynamic-meta") })
  yield* saveSessionGroup(f.location, group.groupID, [f.model])
  const root = yield* f.create(group)
  const context = yield* SessionContext.Service.pipe(Effect.provide(local))
  const compositions = yield* SessionComposition.Service
  expect(root.model).toEqual(group)
  expect(yield* compositions.read(root.id)).toBeUndefined()
  expect((yield* context.resolveModel(root)).ref).toEqual(f.model)
  if (root.controller?.kind !== "root") return yield* Effect.die(new Error("Meta root controller is missing"))
  expect((yield* f.metas.get(root.controller.metaAgentID))?.groupBehavior).toBeUndefined()
  yield* saveSessionGroup(f.location, group.groupID, [next])
  expect((yield* context.resolveModel(root)).ref).toEqual(next)
  expect(yield* compositions.read(root.id)).toBeUndefined()
}))

admissionIt.live("pins Custom Groups across edits and retry, and captures new behavior on explicit fork or upgrade", () => withCustomMode("true", Effect.gen(function* () {
  const f = yield* metaAdmission(true)
  const sessions = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.location)
  const context = yield* SessionContext.Service.pipe(Effect.provide(local))
  const next = Model.Ref.make({ providerID: f.model.providerID, id: Model.ID.make("next") })
  yield* useOfflineCatalog([{
    info: Provider.Info.make({ ...Provider.Info.empty(f.model.providerID), activation: "enabled", package: "@aigcfroge/ai/providers/openai/responses" }),
    models: [f.model, next].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
  }]).pipe(Effect.provide(local))
  const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("frozen-root") })
  const other = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("explicit-root") })
  const captured = yield* saveSessionGroup(f.location, group.groupID, [f.model])
  const root = yield* f.create(group)
  const original = yield* compositions.get(root.id)
  if (original.version !== 2) return yield* Effect.die(new Error("Custom Group snapshot is not V2"))
  expect(original.data.groupBehavior).toEqual(captured)
  const edited = yield* saveSessionGroup(f.location, group.groupID, [next])
  expect(edited.behaviorDigest).not.toBe(captured.behaviorDigest)
  expect(yield* f.create(group)).toEqual(root)
  expect(yield* compositions.get(root.id)).toEqual(original)
  expect((yield* context.resolveModel(root)).ref).toEqual(f.model)
  yield* sessions.prompt({ sessionID: root.id, text: "Fork the frozen Group", resume: false })
  yield* SessionInbox.promote(f.db, f.bus, root.id, "steer")
  const fork = yield* sessions.fork({ sessionID: root.id })
  expect(fork.model).toEqual(group)
  expect((yield* context.resolveModel(fork)).ref).toEqual(f.model)
  const current = yield* saveSessionGroup(f.location, other.groupID, [next])
  const explicit = yield* sessions.fork({ sessionID: root.id, model: other })
  const explicitSnapshot = yield* compositions.get(explicit.id)
  if (explicitSnapshot.version !== 2) return yield* Effect.die(new Error("Explicit Group snapshot is not V2"))
  expect(explicitSnapshot.data.groupBehavior).toEqual(current)
  expect((yield* context.resolveModel(explicit)).ref).toEqual(next)
  expect(yield* sessions.fork({ sessionID: root.id, id: fork.id, model: other }).pipe(Effect.flip)).toMatchObject({ reason: "group_selection_mismatch" })
  if (!f.composition) return yield* Effect.die(new Error("Custom composition is missing"))
  const ordinary = yield* sessions.create({ location: f.location, agent: Agent.ID.make("build"), model: group })
  const upgraded = yield* sessions.upgradeCustom({ sessionID: ordinary.id, composition: f.composition, model: group })
  if (upgraded.snapshot.version !== 2) return yield* Effect.die(new Error("Upgraded Group snapshot is not V2"))
  expect(upgraded.snapshot.data.groupBehavior).toEqual(edited)
  expect((yield* context.resolveModel(upgraded.session)).ref).toEqual(next)
  expect(yield* compositions.get(root.id)).toEqual(original)
})))

admissionIt.live("keeps a frozen child Group on exact retry and carries its behavior into a root fork", () => withCustomMode("true", Effect.gen(function* () {
  const f = yield* metaAdmission(true)
  const sessions = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const delegations = yield* DelegationService.Service
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.location)
  const next = Model.Ref.make({ providerID: f.model.providerID, id: Model.ID.make("next") })
  yield* useOfflineCatalog([{
    info: Provider.Info.make({ ...Provider.Info.empty(f.model.providerID), activation: "enabled", package: "@aigcfroge/ai/providers/openai/responses" }),
    models: [f.model, next].map((ref) => Model.Info.make(Model.Info.default(ref.providerID, ref.id))),
  }]).pipe(Effect.provide(local))
  const rootGroup = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("parent-group") })
  const childGroup = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("child-group") })
  yield* saveSessionGroup(f.location, rootGroup.groupID, [f.model])
  const firstBehavior = yield* saveSessionGroup(f.location, childGroup.groupID, [next])
  const root = yield* f.create(rootGroup)
  const agent = (yield* compositions.selectAgent(root.id, "meta-worker")).info
  const delegation = yield* delegations.create({ parentSessionID: root.id, agent: agent.id, title: "Frozen ordinary source" })
  const participant = yield* delegations.addParticipant({ delegationID: delegation.id, provider: "internal", target: agent.id, role: "implementer", context: "fresh" })
  const input = { parentID: root.id, agent: agent.id, model: childGroup, source: new SessionSchema.TaskControllerSource({ kind: "task", delegationID: delegation.id, participantID: participant.id }) }
  const child = yield* sessions.create(input)
  yield* delegations.bindParticipant({ delegationID: delegation.id, participantID: participant.id, childSessionID: child.id })
  const snapshot = yield* compositions.get(child.id)
  const context = yield* SessionContext.Service.pipe(Effect.provide(local))
  expect(child.model).toEqual(childGroup)
  expect(child.controller).toBeUndefined()
  expect((yield* context.resolveModel(child)).ref).toEqual(next)
  yield* saveSessionGroup(f.location, childGroup.groupID, [f.model])
  expect(yield* sessions.create({ ...input, id: child.id })).toEqual(child)
  expect(yield* compositions.get(child.id)).toEqual(snapshot)
  expect(yield* sessions.create({ ...input, id: child.id, model: rootGroup }).pipe(Effect.flip)).toMatchObject({ reason: "group_selection_mismatch" })
  yield* sessions.prompt({ sessionID: child.id, text: "Fork from this child Group", resume: false })
  yield* SessionInbox.promote(f.db, f.bus, child.id, "steer")
  const fork = yield* sessions.fork({ sessionID: child.id })
  const forkSnapshot = yield* compositions.get(fork.id)
  if (forkSnapshot.version !== 2) return yield* Effect.die(new Error("Fork Group snapshot is not V2"))
  expect(fork.model).toEqual(childGroup)
  expect(forkSnapshot.data.groupBehavior).toEqual(firstBehavior)
  expect((yield* context.resolveModel(fork)).ref).toEqual(next)
})))

admissionIt.live("captures an asset executor's Group during real freeze and keeps the Meta child's first binding", () => withCustomMode("true", Effect.gen(function* () {
  const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("asset-executor") })
  const f = yield* metaAdmission(true, group)
  const future = Model.Ref.make({ providerID: f.model.providerID, id: Model.ID.make("future-member") })
  const locations = yield* LocationServiceMap.Service
  const local = locations.get(f.location)
  yield* useOfflineCatalog([{
    info: Provider.Info.make({ ...Provider.Info.empty(f.model.providerID), activation: "enabled", package: "@aigcfroge/ai/providers/openai/responses" }),
    models: [f.model, future].map((ref) => Model.Info.make({ ...Model.Info.default(ref.providerID, ref.id),
      modelID: Model.ID.make(ref.id === f.model.id ? "frozen-group-api" : "future-group-api"),
    })),
  }]).pipe(Effect.provide(local))
  const captured = yield* saveSessionGroup(f.location, group.groupID, [f.model])
  const root = yield* f.create()
  const sessions = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const agent = (yield* compositions.selectAgent(root.id, "meta-worker")).info
  const snapshot = yield* compositions.get(root.id)
  if (snapshot.version !== 2) return yield* Effect.die(new Error("Asset Group snapshot is not V2"))
  expect(agent.model).toEqual(group)
  expect(SessionComposition.groupBehaviorFor(snapshot, agent.id)).toEqual(captured)
  const binding = yield* Session.resolveExecutor(root, agent).pipe(Effect.provide(local))
  expect(binding).toMatchObject({ model: group, groupBehavior: captured, source: "agent" })
  const delegations = yield* DelegationService.Service
  const delegation = yield* delegations.create({ parentSessionID: root.id, title: "Frozen Meta executor" })
  const participant = yield* delegations.addParticipant({ delegationID: delegation.id, provider: "internal", target: agent.id, role: "implementer", context: "fresh", executor: binding })
  const input = { parentID: root.id, title: "Frozen Custom Group child", agent: agent.id, model: group, executor: binding,
    source: new SessionSchema.TaskControllerSource({ kind: "task", delegationID: delegation.id, participantID: participant.id }) }
  const child = yield* sessions.create(input)
  yield* delegations.bindParticipant({ delegationID: delegation.id, participantID: participant.id, childSessionID: child.id })
  expect(child.controller).toMatchObject({ kind: "child", executor: { model: group, groupBehavior: captured } })
  const childSnapshot = yield* compositions.get(child.id)
  const llm = yield* TestLLM.Test
  yield* llm.push(TestLLM.text("Frozen first run", "group-first"), TestLLM.text("Frozen resumed run", "group-resume"))
  const firstInput = yield* sessions.prompt({ sessionID: child.id, text: "First frozen Group input", resume: false })
  yield* awaitWithTimeout(sessions.resume(child.id), "The frozen Group child did not finish its first run", "10 seconds")
  expect((yield* llm.requests()).map((request) => String(request.model.id))).toEqual(["frozen-group-api"])
  const afterFirstRun = yield* sessions.get(child.id)
  yield* saveSessionGroup(f.location, group.groupID, [future])
  expect(yield* Session.resolveExecutor(root, agent).pipe(Effect.provide(local))).toEqual(binding)
  expect(yield* sessions.create({ ...input, id: child.id })).toEqual(afterFirstRun)
  const context = yield* SessionContext.Service.pipe(Effect.provide(local))
  expect((yield* context.resolveModel(child)).ref).toEqual(f.model)
  expect(yield* compositions.get(root.id)).toEqual(snapshot)
  const secondInput = yield* sessions.prompt({ sessionID: child.id, text: "Resume this exact frozen Group child", resume: false })
  yield* awaitWithTimeout(sessions.resume(child.id), "The exact frozen Group child did not resume", "10 seconds")
  const requests = yield* llm.requests()
  expect(requests.map((request) => String(request.model.id))).toEqual(["frozen-group-api", "frozen-group-api"])
  expect(requests.map((request) => request.http?.headers?.["x-aigcfroge-session-id"])).toEqual([child.id, child.id])
  expect(JSON.stringify(requests[1]?.messages)).toContain("Resume this exact frozen Group child")
  expect(yield* compositions.get(child.id)).toEqual(childSnapshot)
  expect((yield* sessions.get(child.id)).controller).toEqual(child.controller)
  for (const id of [firstInput.id, secondInput.id]) {
    const completed = yield* SessionInputResult.read(f.db, { sessionID: child.id, inputID: id })
    if (completed.status !== "completed") return yield* Effect.die(new Error("The frozen Group input did not complete"))
    expect(completed.assistant.attempts?.map((attempt) => ({ selection: attempt.selection, model: attempt.model, api: attempt.apiModelID }))).toEqual([
      { selection: group, model: f.model, api: "frozen-group-api" },
    ])
  }
})))

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const correctionLayer = CorrectionStore.layer.pipe(Layer.provide(Config.testLayer()))
const id = Session.ID.create()

/** Public session events from a `log` read, without synced markers. */
const logEvents = (session: Session.Interface, sessionID: Session.ID, follow?: boolean) =>
  session
    .log({ sessionID, follow })
    .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !Bus.isSynced(item)))

const assertCreateInputTypes = (session: Session.Interface) => {
  // @ts-expect-error location or parentID is required.
  session.create({})
  // @ts-expect-error child sessions inherit their parent's location.
  session.create({ parentID: Session.ID.create(), location })
}
void assertCreateInputTypes

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return tmpdirScoped().pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

// These keepers exercise the durable legacy contract independently of new Meta admission.
const legacyRoot = Effect.fn("Keeper.legacyRoot")(function* (input: {
  location: Location.Ref
  title?: string
  agent?: Agent.ID
  model?: Model.Ref
  metadata?: Session.Info["metadata"]
  permissions?: Session.Info["permissions"]
  mode?: Session.Info["mode"]
}) {
  const bus = yield* Bus.Service
  const projects = yield* Project.Service
  const sessions = yield* Session.Service
  const project = yield* projects.resolve(input.location.directory)
  const sessionID = Session.ID.create()
  yield* bus.publish(SessionEvent.Created, {
    ...input,
    sessionID,
    slug: sessionID,
    version: "keeper",
    projectID: project.id,
  })
  return yield* sessions.get(sessionID)
})

const consultationSource = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  const database = yield* Database.Service
  const source = yield* legacyRoot({ location, title: "Consultation source", agent: Agent.ID.make("explore") })
  const question = yield* sessions.prompt({
    sessionID: source.id,
    text: "SC04_FROZEN_SOURCE: compare the saved result.",
    resume: false,
  })

  expect(yield* SessionInbox.promote(database.db, bus, source.id, "steer")).toBe(1)

  return {
    sessions,
    bus,
    db: database.db,
    source,
    question,
    request: {
      sourceSessionID: source.id,
      id: Session.ID.create(),
      agent: Agent.ID.make("build"),
      boundary: { type: "through" as const, messageID: question.id },
      prompt: { id: SessionMessage.ID.create(), text: "Explain the saved comparison." },
      resume: false,
    },
  }
})

describe("SC04 Session.createConsultation", () => {
  it.effect("commits an ordinary Chat target before preparing its first prompt and keeps the first admission", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()
      const locations = yield* LocationServiceMap.Service
      const context = yield* locations.contextEffect(location)
      const hooks = yield* PluginHooks.Service.pipe(Effect.provide(context))
      const prepared: Session.ID[] = []

      yield* hooks.register("session", "prompt", (event) =>
        Effect.gen(function* () {
          if (event.sessionID !== f.request.id) return

          const target = yield* f.sessions.get(event.sessionID).pipe(Effect.orDie)
          prepared.push(target.id)
          expect(target).toMatchObject({ id: f.request.id, mode: "chat", agent: "build", location: f.source.location })
          expect(target.parentID).toBeUndefined()
          expect(target.controller).toBeUndefined()
          expect(event.prompt.files).toBeUndefined()
          event.prompt.text = "Hook kept the ordinary question editable."
          event.metadata = { ordinary: "hook-value" }
          event.delivery = "queue"
        }),
      )

      const created = yield* f.sessions.createConsultation(f.request)
      expect(created.session).toMatchObject({ id: f.request.id, mode: "chat", location: f.source.location })
      expect(created.session.parentID).toBeUndefined()
      expect(created.session.controller).toBeUndefined()
      expect(created.admission).toMatchObject({
        state: "pending",
        input: {
          id: f.request.prompt.id,
          sessionID: f.request.id,
          type: "user",
          delivery: "queue",
          payload: { text: "Hook kept the ordinary question editable.", metadata: { ordinary: "hook-value" } },
        },
      })
      expect(created.reference).toMatchObject({
        sourceSessionID: f.source.id,
        boundary: f.request.boundary,
        sourceMessageIDs: [f.question.id],
        omissions: [],
        file: { mime: "text/plain", source: { type: "inline" } },
      })

      const reference = Buffer.from(created.reference.file.data, "base64")
      expect(reference.toString("utf8")).toContain("SC04_FROZEN_SOURCE")
      expect(created.reference.digest).toBe(Hash.sha256(reference))
      expect(created.admission.state).toBe("pending")
      if (created.admission.state !== "pending")
        return yield* Effect.die(new Error("Consultation input was not pending"))

      expect(created.admission.input.payload.files).toContainEqual(created.reference.file)
      expect(yield* f.sessions.context(f.request.id)).toEqual([])
      expect(yield* f.sessions.inbox(f.source.id)).toEqual([])
      expect(prepared).toEqual([f.request.id])

      const retried = yield* f.sessions.createConsultation({
        ...f.request,
        agent: Agent.ID.make("meta"),
        boundary: { type: "before", messageID: SessionMessage.ID.create() },
        prompt: { ...f.request.prompt, text: "A retry must not replace the first question." },
      })

      expect(retried).toEqual(created)
      expect(prepared).toEqual([f.request.id])
      expect(yield* f.sessions.inbox(f.request.id)).toHaveLength(1)
    }),
  )

  it.live(
    "recovers from the target and frozen material after source movement and deletion without admitting another input",
    () =>
      Effect.gen(function* () {
        const f = yield* consultationSource()
        const created = yield* f.sessions.createConsultation(f.request)

        expect(yield* SessionInbox.promote(f.db, f.bus, created.session.id, "steer")).toBe(1)

        const destination = yield* tmpdirScoped()
        yield* f.sessions.move({ sessionID: f.source.id, directory: AbsolutePath.make(destination.path) })

        expect((yield* f.sessions.get(f.source.id)).location.directory).toBe(AbsolutePath.make(destination.path))
        expect((yield* f.sessions.createConsultation(f.request)).reference).toEqual(created.reference)
        expect((yield* f.sessions.createConsultation(f.request)).session.location).toEqual(created.session.location)
        yield* f.sessions.remove(f.source.id)

        const before = yield* f.sessions.messages({ sessionID: created.session.id })
        const recovered = yield* f.sessions.createConsultation(f.request)
        expect(recovered.session).toEqual(yield* f.sessions.get(created.session.id))
        expect(recovered.reference).toEqual(created.reference)
        expect(recovered.admission).toMatchObject({
          state: "promoted",
          input: {
            id: f.request.prompt.id,
            type: "user",
            text: f.request.prompt.text,
            files: [created.reference.file],
          },
        })
        expect(yield* f.sessions.inbox(created.session.id)).toEqual([])
        expect(yield* f.sessions.messages({ sessionID: created.session.id })).toEqual(before)
        expect(yield* f.sessions.getConsultation(created.session.id)).toEqual({
          reference: recovered.reference,
          admission: recovered.admission,
        })
        expect(yield* f.sessions.messages({ sessionID: created.session.id })).toEqual(before)
      }),
  )

  it.effect(
    "keeps a cancelled first ID terminal and carries the frozen file through a new question and cancellation",
    () =>
      Effect.gen(function* () {
        const f = yield* consultationSource()
        const created = yield* f.sessions.createConsultation(f.request)

        yield* f.sessions.cancelInbox({ sessionID: created.session.id, inboxID: f.request.prompt.id })

        const cancelled = yield* f.sessions.createConsultation(f.request)
        expect(cancelled.admission).toEqual({ state: "cancelled", id: f.request.prompt.id })
        expect(cancelled.reference).toEqual(created.reference)
        expect(yield* f.sessions.getConsultation(created.session.id)).toEqual({
          reference: created.reference,
          admission: cancelled.admission,
        })

        const before = yield* f.sessions.inbox(created.session.id)
        const reused = yield* f.sessions
          .prompt({
            sessionID: created.session.id,
            id: f.request.prompt.id,
            text: "Revive cancelled first ID",
            resume: false,
          })
          .pipe(Effect.flip)

        expect(reused).toMatchObject({
          _tag: "Session.PromptConflictError",
          sessionID: created.session.id,
          messageID: f.request.prompt.id,
        })
        expect(yield* f.sessions.inbox(created.session.id)).toEqual(before)

        const next = yield* f.sessions.prompt({
          sessionID: created.session.id,
          id: SessionMessage.ID.create(),
          text: "Continue with a new question.",
          resume: false,
        })

        expect(next.payload.text).toBe("Continue with a new question.")
        expect(next.payload.files).toContainEqual(created.reference.file)
        yield* f.sessions.cancelInbox({ sessionID: created.session.id, inboxID: next.id })

        expect((yield* f.sessions.createConsultation(f.request)).reference).toEqual(created.reference)

        const continuing = yield* f.sessions.prompt({
          sessionID: created.session.id,
          id: SessionMessage.ID.create(),
          text: "Continue after cancelling the pending reference carrier.",
          resume: false,
        })

        expect(continuing.payload.files).toContainEqual(created.reference.file)
        expect(yield* SessionInbox.promote(f.db, f.bus, created.session.id, "steer")).toBe(1)

        const later = yield* f.sessions.prompt({
          sessionID: created.session.id,
          text: "The promoted reference follows normal history now.",
          resume: false,
        })

        expect(later.payload.files).toBeUndefined()
        expect((yield* f.sessions.createConsultation(f.request)).reference).toEqual(created.reference)
        expect((yield* f.sessions.createConsultation(f.request)).admission).toEqual({
          state: "cancelled",
          id: f.request.prompt.id,
        })
      }),
  )

  it.effect("puts the reference on a later steer while an admit-only queued first input remains pending", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()
      const request = { ...f.request, prompt: { ...f.request.prompt, delivery: "queue" as const } }
      const created = yield* f.sessions.createConsultation(request)
      const steer = yield* f.sessions.prompt({
        sessionID: created.session.id,
        id: SessionMessage.ID.create(),
        text: "Read the frozen reference before the queued question.",
        delivery: "steer",
        resume: false,
      })

      expect(steer.payload.files).toContainEqual(created.reference.file)
      expect(yield* f.sessions.context(created.session.id)).toEqual([])
      expect(yield* SessionInbox.promote(f.db, f.bus, created.session.id, "steer")).toBe(1)

      const visible = yield* f.sessions.context(created.session.id)
      expect(visible).toMatchObject([
        { id: steer.id, type: "user", text: steer.payload.text, files: [created.reference.file] },
      ])
      expect(yield* f.sessions.inbox(created.session.id)).toMatchObject([
        { id: f.request.prompt.id, delivery: "queue", payload: { files: [created.reference.file] } },
      ])

      yield* f.sessions.cancelInbox({ sessionID: created.session.id, inboxID: f.request.prompt.id })

      const recovered = yield* f.sessions.createConsultation(request)
      expect(recovered.admission).toEqual({ state: "cancelled", id: f.request.prompt.id })
      expect(recovered.reference).toEqual(created.reference)
      expect(yield* f.sessions.context(created.session.id)).toEqual(visible)

      const later = yield* f.sessions.prompt({
        sessionID: created.session.id,
        text: "No automatic re-injection.",
        resume: false,
      })
      expect(later.payload.files).toBeUndefined()
      expect(yield* f.sessions.inbox(f.source.id)).toEqual([])
    }),
  )

  it.effect(
    "keeps saved reference bytes after reverting a promoted carrier and admits another prompt without re-injection",
    () =>
      Effect.gen(function* () {
        const f = yield* consultationSource()
        const created = yield* f.sessions.createConsultation(f.request)

        expect(yield* SessionInbox.promote(f.db, f.bus, created.session.id, "steer")).toBe(1)
        expect(yield* f.sessions.messages({ sessionID: created.session.id })).toMatchObject([
          { id: f.request.prompt.id, type: "user", files: [created.reference.file] },
        ])

        yield* f.bus.publish(SessionEvent.RevertEvent.Staged, {
          sessionID: created.session.id,
          revert: { messageID: f.request.prompt.id, files: [] },
        })
        yield* f.sessions.revert.commit(created.session.id)

        expect(yield* f.sessions.messages({ sessionID: created.session.id })).toEqual([])
        expect(yield* f.sessions.inbox(created.session.id)).toEqual([])

        const next = yield* f.sessions.prompt({
          sessionID: created.session.id,
          text: "Continue after reverting the promoted reference carrier.",
          resume: false,
        })

        expect(next.payload.text).toBe("Continue after reverting the promoted reference carrier.")
        expect(next.payload.files).toBeUndefined()
        expect(yield* f.sessions.inbox(created.session.id)).toMatchObject([{ id: next.id }])

        const owner = yield* f.db
          .select()
          .from(SessionConsultationTable)
          .where(eq(SessionConsultationTable.session_id, created.session.id))
          .get()
          .pipe(Effect.orDie)

        expect(owner).toMatchObject({
          reference_promoted: true,
          reference_carrier_id: null,
          reference_file: created.reference.file,
        })
        if (!owner?.reference_file)
          return yield* Effect.die(new Error("Reverted consultation reference was not preserved"))

        const saved = Buffer.from(owner.reference_file.data, "base64")
        expect(saved).toEqual(Buffer.from(created.reference.file.data, "base64"))
        expect(saved.toString("utf8")).toContain("SC04_FROZEN_SOURCE")
        expect(Hash.sha256(saved)).toBe(created.reference.digest)
      }),
  )

  for (const table of [SessionTable, SessionConsultationTable]) {
    it.live(`rolls back the consultation target and reserved owner when ${getTableName(table)} insertion fails`, () =>
      Effect.gen(function* () {
        const f = yield* consultationSource()
        const sourceHistory = yield* f.sessions.messages({ sessionID: f.source.id })

        yield* f.db
          .run(
            sql.raw(`CREATE TEMP TRIGGER fail_consultation_created AFTER INSERT ON "${getTableName(table)}"
            BEGIN SELECT RAISE(ABORT, 'SC04 consultation creation failed'); END`),
          )
          .pipe(Effect.orDie)
        yield* Effect.addFinalizer(() =>
          f.db.run(sql`DROP TRIGGER IF EXISTS fail_consultation_created`).pipe(Effect.orDie),
        )

        const failed = yield* f.sessions.createConsultation(f.request).pipe(Effect.exit)
        expect(Exit.isFailure(failed)).toBe(true)
        expect(Exit.isFailure(failed) ? Cause.pretty(failed.cause) : "").toContain("SC04 consultation creation failed")
        expect(
          yield* f.db.select().from(SessionTable).where(eq(SessionTable.id, f.request.id)).get().pipe(Effect.orDie),
        ).toBeUndefined()
        expect(
          yield* f.db
            .select()
            .from(SessionConsultationTable)
            .where(eq(SessionConsultationTable.session_id, f.request.id))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
        expect(
          yield* f.db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, f.request.id))
            .all()
            .pipe(Effect.orDie),
        ).toEqual([])
        expect(yield* f.sessions.messages({ sessionID: f.source.id })).toEqual(sourceHistory)

        yield* f.db.run(sql`DROP TRIGGER fail_consultation_created`).pipe(Effect.orDie)

        const retried = yield* f.sessions.createConsultation(f.request)
        expect(retried.admission.state).toBe("pending")
        expect(retried.session.id).toBe(f.request.id)
      }),
    )
  }

  it.live("keeps a committed reserved owner and reference when first Inbox admission rolls back", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()

      yield* f.db
        .run(
          sql.raw(`CREATE TEMP TRIGGER fail_consultation_admission AFTER INSERT ON "${getTableName(SessionInboxTable)}"
          BEGIN SELECT RAISE(ABORT, 'SC04 first admission failed'); END`),
        )
        .pipe(Effect.orDie)
      yield* Effect.addFinalizer(() =>
        f.db.run(sql`DROP TRIGGER IF EXISTS fail_consultation_admission`).pipe(Effect.orDie),
      )

      const failed = yield* f.sessions.createConsultation(f.request).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(Exit.isFailure(failed) ? Cause.pretty(failed.cause) : "").toContain("SC04 first admission failed")

      const reserved = yield* f.db
        .select()
        .from(SessionConsultationTable)
        .where(eq(SessionConsultationTable.session_id, f.request.id))
        .get()
        .pipe(Effect.orDie)

      expect(reserved).toMatchObject({
        phase: "reserved",
        first_message_id: f.request.prompt.id,
        reference_carrier_id: null,
      })
      if (!reserved?.reference_file) return yield* Effect.die(new Error("Reserved consultation reference is missing"))

      expect(Buffer.from(reserved.reference_file.data, "base64").toString("utf8")).toContain("SC04_FROZEN_SOURCE")
      expect(yield* f.sessions.inbox(f.request.id)).toEqual([])
      expect(yield* f.sessions.context(f.request.id)).toEqual([])

      const ordinary = yield* f.sessions
        .prompt({
          sessionID: f.request.id,
          id: f.request.prompt.id,
          text: "Ordinary first ID cannot claim this owner.",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(ordinary).toMatchObject({
        _tag: "Session.PromptConflictError",
        sessionID: f.request.id,
        messageID: f.request.prompt.id,
      })
      expect(yield* f.sessions.inbox(f.request.id)).toEqual([])

      yield* f.db.run(sql`DROP TRIGGER fail_consultation_admission`).pipe(Effect.orDie)

      const retried = yield* f.sessions.createConsultation(f.request)
      expect(retried.reference.file).toEqual(reserved.reference_file)
      expect(retried.admission.state).toBe("pending")
      expect(
        yield* f.db
          .select()
          .from(SessionConsultationTable)
          .where(eq(SessionConsultationTable.session_id, f.request.id))
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({
        phase: "admitted",
        reference_carrier_id: f.request.prompt.id,
        reference_file: null,
      })
    }),
  )

  for (const boundary of ["created", "prepared"] as const) {
    it.effect(`cancels at ${boundary} while preserving exactly the already committed consultation phase`, () =>
      Effect.gen(function* () {
        const f = yield* consultationSource()

        if (boundary === "created")
          yield* f.bus.project(SessionEvent.Created, (event) =>
            event.data.sessionID === f.request.id ? Effect.interrupt : Effect.void,
          )
        if (boundary === "prepared") {
          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(location)
          const hooks = yield* PluginHooks.Service.pipe(Effect.provide(context))

          yield* hooks.register("session", "prompt", (event) =>
            event.sessionID === f.request.id ? Effect.interrupt : Effect.void,
          )
        }

        const cancelled = yield* f.sessions.createConsultation(f.request).pipe(Effect.exit)
        expect(Exit.isFailure(cancelled)).toBe(true)
        expect(Exit.isFailure(cancelled) && Cause.hasInterruptsOnly(cancelled.cause)).toBe(true)

        const owner = yield* f.db
          .select()
          .from(SessionConsultationTable)
          .where(eq(SessionConsultationTable.session_id, f.request.id))
          .get()
          .pipe(Effect.orDie)
        const target = yield* f.db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, f.request.id))
          .get()
          .pipe(Effect.orDie)

        if (boundary === "created") {
          expect(owner).toBeUndefined()
          expect(target).toBeUndefined()
          return
        }

        expect(owner).toMatchObject({ phase: "reserved", first_message_id: f.request.prompt.id })
        expect(owner?.reference_file).toBeDefined()
        expect(target).toMatchObject({ id: f.request.id, mode: "chat" })
        expect(yield* f.sessions.inbox(f.request.id)).toEqual([])
      }),
    )
  }

  it.effect("rejects another source or first ID and does not adopt an ordinary target as a consultation", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()
      const created = yield* f.sessions.createConsultation(f.request)

      for (const retry of [
        { ...f.request, sourceSessionID: Session.ID.create() },
        { ...f.request, prompt: { ...f.request.prompt, id: SessionMessage.ID.create() } },
        { ...f.request, id: f.source.id },
      ]) {
        const error = yield* f.sessions.createConsultation(retry).pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Session.ConsultationConflictError" })
      }

      expect(yield* f.sessions.inbox(created.session.id)).toHaveLength(1)
      expect((yield* f.sessions.createConsultation(f.request)).reference).toEqual(created.reference)
      expect(yield* f.sessions.inbox(f.source.id)).toEqual([])
    }),
  )

  it.effect("rejects a controller Agent or missing Agent before creating an ordinary consultation target", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()

      for (const agent of ["meta", "missing-consultation-agent"]) {
        const error = yield* f.sessions
          .createConsultation({ ...f.request, agent: Agent.ID.make(agent) })
          .pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "agent" })
        expect(
          yield* f.db.select().from(SessionTable).where(eq(SessionTable.id, f.request.id)).get().pipe(Effect.orDie),
        ).toBeUndefined()
        expect(
          yield* f.db
            .select()
            .from(SessionConsultationTable)
            .where(eq(SessionConsultationTable.session_id, f.request.id))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()
      }
    }),
  )

  it.effect("returns one target and one first payload to overlapping matching consultation retries", () =>
    Effect.gen(function* () {
      const f = yield* consultationSource()
      const replies = yield* Effect.all(
        [
          f.sessions.createConsultation(f.request),
          f.sessions.createConsultation({
            ...f.request,
            prompt: { ...f.request.prompt, text: "Overlapping retry text" },
          }),
        ],
        { concurrency: 2 },
      )

      expect(replies).toHaveLength(2)
      expect(replies[1]).toEqual(replies[0])
      expect(yield* f.sessions.inbox(f.request.id)).toHaveLength(1)
      expect(
        yield* f.db
          .select()
          .from(SessionConsultationTable)
          .where(eq(SessionConsultationTable.session_id, f.request.id))
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(1)
      expect(yield* f.sessions.inbox(f.source.id)).toEqual([])
    }),
  )

  it.live(
    "cold reopens a reserved consultation without preparing or waking it and resumes only an explicit retry",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const prepared: Session.ID[] = []
        const wakes: Session.ID[] = []
        const targetID = Session.ID.create()
        const layer = AppNodeBuilder.build(
          LayerNode.group([
            Database.node,
            Bus.node,
            SessionProjector.node,
            SessionStore.node,
            Session.node,
            Project.node,
            LocationServiceMap.node,
          ]),
          [
            Database.node.replace(Database.configured({ path: path.join(tmp.path, "consultation.sqlite") })),
            Bus.node.replace(Bus.configured({ persist: true })),
            Project.node.replace(globalProjectNode),
            LocationServiceMap.node.replace(promptLocationNode),
            SessionExecution.node.replace(
              Layer.mock(SessionExecution.Service, {
                active: Effect.succeed(new Set<Session.ID>()),
                isActive: () => Effect.succeed(false),
                interrupt: () => Effect.succeed(false),
                awaitIdle: () => Effect.void,
                wake: (sessionID) =>
                  Effect.sync(() => {
                    wakes.push(sessionID)
                  }),
              }),
            ),
          ],
        )
        const reserved = yield* Effect.gen(function* () {
          const f = yield* consultationSource()
          const request = { ...f.request, id: targetID }
          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(location)
          const hooks = yield* PluginHooks.Service.pipe(Effect.provide(context))

          yield* hooks.register("session", "prompt", (event) => {
            if (event.sessionID !== targetID) return Effect.void

            prepared.push(event.sessionID)
            return Effect.die(new Error("SC04 prepare failed after reservation"))
          })

          const failed = yield* f.sessions.createConsultation(request).pipe(Effect.exit)
          expect(Exit.isFailure(failed)).toBe(true)

          const owner = yield* f.db
            .select()
            .from(SessionConsultationTable)
            .where(eq(SessionConsultationTable.session_id, targetID))
            .get()
            .pipe(Effect.orDie)
          expect(owner).toMatchObject({ phase: "reserved" })
          if (!owner?.reference_file) return yield* Effect.die(new Error("Reserved reference was not committed"))

          return { request, owner, file: owner.reference_file }
        }).pipe(Effect.provide(Layer.fresh(layer)))

        expect(prepared).toEqual([targetID])
        expect(wakes).toEqual([])

        yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const database = yield* Database.Service
          const target = yield* sessions.get(targetID)
          expect(target).toMatchObject({ id: targetID, mode: "chat" })
          expect(yield* sessions.inbox(targetID)).toEqual([])
          expect(prepared).toEqual([targetID])
          expect(wakes).toEqual([])
          expect(
            yield* database.db
              .select()
              .from(SessionConsultationTable)
              .where(eq(SessionConsultationTable.session_id, targetID))
              .get()
              .pipe(Effect.orDie),
          ).toEqual(reserved.owner)

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(location)
          const hooks = yield* PluginHooks.Service.pipe(Effect.provide(context))

          yield* hooks.register("session", "prompt", (event) =>
            Effect.sync(() => {
              if (event.sessionID === targetID) prepared.push(event.sessionID)
            }),
          )
          yield* sessions.remove(reserved.request.sourceSessionID)

          const snapshot = Effect.all({
            session: database.db.select().from(SessionTable).where(eq(SessionTable.id, targetID)).get(),
            owner: database.db
              .select()
              .from(SessionConsultationTable)
              .where(eq(SessionConsultationTable.session_id, targetID))
              .get(),
            inbox: database.db.select().from(SessionInboxTable).where(eq(SessionInboxTable.session_id, targetID)),
            messages: database.db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, targetID)),
            events: database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, targetID)),
            sequences: database.db
              .select()
              .from(EventSequenceTable)
              .where(eq(EventSequenceTable.aggregate_id, targetID)),
          }).pipe(Effect.orDie)

          const beforeRead = yield* snapshot
          const read = yield* sessions.getConsultation(targetID)

          expect(read.admission).toEqual({ state: "reserved", id: reserved.request.prompt.id })
          expect(read.reference.file).toEqual(reserved.file)
          expect(read.reference.sourceSessionID).toBe(reserved.request.sourceSessionID)
          expect(yield* snapshot).toEqual(beforeRead)
          expect(prepared).toEqual([targetID])
          expect(wakes).toEqual([])

          const recovered = yield* sessions.createConsultation(reserved.request)
          expect(recovered.reference.file).toEqual(reserved.file)
          expect(recovered.admission.state).toBe("pending")
          expect(prepared).toEqual([targetID, targetID])
          expect(wakes).toEqual([])

          const beforePendingRead = yield* snapshot

          expect(yield* sessions.getConsultation(targetID)).toEqual({
            reference: recovered.reference,
            admission: recovered.admission,
          })
          expect(yield* snapshot).toEqual(beforePendingRead)
          expect(prepared).toEqual([targetID, targetID])
          expect(wakes).toEqual([])

          yield* sessions.createConsultation({ ...reserved.request, resume: true })
          expect(wakes).toEqual([targetID])
        }).pipe(Effect.provide(Layer.fresh(layer)))
      }),
  )
})

describe("Session.create", () => {
  it.effect("keeps forked correction history without inheriting live source or completion authority", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const corrections = yield* CorrectionStore.Service
      const parent = yield* legacyRoot({ location, title: "Correction fork" })
      yield* session.prompt({ sessionID: parent.id, text: "should be POST not GET", resume: false })
      yield* SessionInbox.promote(database.db, bus, parent.id, "steer", (source) =>
        corrections.observe({ sessionID: parent.id, source: { id: source.id, entries: [] } }),
      )
      yield* corrections.syncSnapshot({
        sessionID: parent.id,
        visibleIDs: [],
        publish: (snapshot) =>
          bus
            .publish(SessionEvent.Synthetic, { sessionID: parent.id, ...snapshot })
            .pipe(Effect.map((event) => SessionMessage.ID.fromEvent(event.id))),
      })
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID,
        agent: Agent.defaultID,
        model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
        started: 0,
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* bus.publish(SessionEvent.Step.Completed, { sessionID: parent.id, assistantMessageID })
      const forked = yield* session.fork({ sessionID: parent.id })
      const history = yield* session.messages({ sessionID: forked.id, order: "asc" })
      expect(history.every((message) => message.origin?.kind === "historical")).toBe(true)
      const assistant = history.find((message) => message.type === "assistant")
      if (assistant?.type !== "assistant") return yield* Effect.die(new Error("Forked settled Assistant missing"))
      expect(assistant.completion).toBeUndefined()
      expect(history.filter(CorrectionStore.isCorrectionHistory)).toHaveLength(1)
      expect(yield* corrections.facts(forked.id)).toEqual([])
      expect((yield* corrections.snapshot(forked.id)).current).toBeUndefined()
      expect(yield* corrections.facts(parent.id)).toEqual([{ key: "user:POST", correct: "POST" }])
    }).pipe(Effect.provide(correctionLayer)),
  )
  ;[
    { custom: false, tables: [SessionTable, MetaAgentTable, MetaAgentSessionTable] },
    { custom: true, tables: [SessionTable, SessionCompositionSnapshotTable, MetaAgentTable, MetaAgentSessionTable] },
  ]
    .flatMap((entry) => entry.tables.map((table) => ({ custom: entry.custom, table })))
    .forEach((fault) => {
      admissionIt.live(
        `rolls back all Meta rows after ${fault.custom ? "Custom" : "generic"} ${getTableName(fault.table)} insertion fails`,
        () =>
          withCustomMode(
            "true",
            Effect.gen(function* () {
              const f = yield* metaAdmission(fault.custom)
              const before = yield* f.read()
              const published: string[] = []
              const unsubscribe = yield* f.bus.listen((event) =>
                Effect.sync(() => {
                  if (Schema.is(SessionEvent.Created)(event) && event.data.sessionID === f.id)
                    published.push(event.type)
                }),
              )
              yield* Effect.addFinalizer(() => unsubscribe)
              // AFTER INSERT forces the actual write to run; the enclosing Created transaction must undo every owner row.
              yield* f.db
                .run(
                  sql.raw(`CREATE TEMP TRIGGER fail_meta_admission AFTER INSERT ON "${getTableName(fault.table)}"
          BEGIN SELECT RAISE(ABORT, 'Meta admission mutation failed'); END`),
                )
                .pipe(Effect.orDie)
              yield* Effect.addFinalizer(() =>
                f.db.run(sql`DROP TRIGGER IF EXISTS fail_meta_admission`).pipe(Effect.orDie),
              )
              const failed = yield* f.create().pipe(Effect.exit)
              expect(Exit.isFailure(failed)).toBe(true)
              expect(Exit.isFailure(failed) ? Cause.pretty(failed.cause) : "").toContain(
                "Meta admission mutation failed",
              )
              expect(yield* f.read()).toEqual(before)
              expect(published).toEqual([])

              yield* f.db.run(sql`DROP TRIGGER fail_meta_admission`).pipe(Effect.orDie)
              const created = yield* f.create()
              if (created.controller?.kind !== "root") return yield* Effect.die(new Error("Meta root owner is missing"))
              yield* f.metas.assertOwner(created)
              const after = yield* f.read()
              expect(created.model).toEqual(f.model)
              expect(after.sessions).toHaveLength(before.sessions.length + 1)
              expect(after.metas).toHaveLength(before.metas.length + 1)
              expect(after.owners).toHaveLength(before.owners.length + 1)
              expect(after.owners.find((owner) => owner.session_id === f.id)).toMatchObject({
                meta_agent_id: created.controller.metaAgentID,
                role: "orchestrator",
              })
              expect(after.metas.find((meta) => meta.id === created.controller?.metaAgentID)).toMatchObject({
                model: f.model,
              })
              expect(after.snapshots).toHaveLength(before.snapshots.length + (fault.custom ? 1 : 0))
              expect(after.events.map((event) => [event.seq, event.type])).toEqual([
                [0, Bus.versionedType(SessionEvent.Created.type, 1)],
              ])
              expect(published).toEqual([SessionEvent.Created.type])
            }),
          ),
        30_000,
      )
    })

  Array.of(false, true).forEach((custom) => {
    admissionIt.live(
      `returns one Session, Meta and owner to overlapping ${custom ? "Custom" : "generic"} Meta creates`,
      () =>
        withCustomMode(
          "true",
          Effect.gen(function* () {
            const f = yield* metaAdmission(custom)
            const before = yield* f.read()
            const entered = yield* Deferred.make<void>()
            const retrying = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
            const projections: string[] = []
            yield* f.bus.project(SessionEvent.Created, (event) => {
              if (event.data.sessionID !== f.id) return Effect.void
              return Effect.gen(function* () {
                projections.push(event.data.sessionID)
                if (projections.length !== 1) return
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              })
            })
            const first = yield* f.create().pipe(Effect.forkIn(yield* Scope.Scope))
            yield* awaitWithTimeout(Deferred.await(entered), "Meta creation did not enter its real Created transaction")
            const second = yield* Effect.gen(function* () {
              yield* Deferred.succeed(retrying, undefined)
              return yield* f.create()
            }).pipe(Effect.forkIn(yield* Scope.Scope))
            yield* awaitWithTimeout(Deferred.await(retrying), "The concurrent Meta retry did not start")
            yield* Deferred.succeed(release, undefined)
            const created = yield* Effect.all([Fiber.join(first), Fiber.join(second)], { concurrency: "unbounded" })
            expect(created[1]).toEqual(created[0])
            yield* f.metas.assertOwner(created[0])
            const after = yield* f.read()
            expect(after.sessions).toHaveLength(before.sessions.length + 1)
            expect(after.metas).toHaveLength(before.metas.length + 1)
            expect(after.owners).toHaveLength(before.owners.length + 1)
            expect(after.snapshots).toHaveLength(before.snapshots.length + (custom ? 1 : 0))
            expect(after.owners.filter((owner) => owner.session_id === f.id)).toHaveLength(1)
            expect(after.events.map((event) => [event.seq, event.type])).toEqual([
              [0, Bus.versionedType(SessionEvent.Created.type, 1)],
            ])
            expect(projections).toEqual([f.id])
          }),
        ),
      30_000,
    )
  })

  it.effect("rejects adopting a before fork as a through fork without mutation", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const parent = yield* session.create({ location })
      const first = yield* session.prompt({ sessionID: parent.id, text: "First", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const second = yield* session.prompt({ sessionID: parent.id, text: "Second", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const fork = yield* session.fork({ sessionID: parent.id, before: second.id })
      const events = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
      expect(yield* session.fork({ id: fork.id, sessionID: parent.id, before: second.id })).toEqual(fork)
      for (const before of [undefined, first.id])
        expect(yield* session.fork({ id: fork.id, sessionID: parent.id, before }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.ForkConflictError",
        })
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))).toEqual(events)
      expect(yield* session.get(fork.id)).toEqual(fork)
    }),
  )

  it.effect("rejects adopting a legacy fork as a Meta fork without mutation", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const parent = yield* legacyRoot({ location, agent: Agent.ID.make("meta") })
      yield* session.prompt({ sessionID: parent.id, text: "Legacy context", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const fork = yield* session.fork({ sessionID: parent.id })
      const events = yield* db.select().from(EventTable)
      const metas = yield* db.select().from(MetaAgentTable)
      const links = yield* db.select().from(MetaAgentSessionTable)
      expect(
        yield* session.fork({ id: fork.id, sessionID: parent.id, control: "meta" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ForkConflictError" })
      expect(yield* session.get(fork.id)).toEqual(fork)
      expect(yield* db.select().from(EventTable)).toEqual(events)
      expect(yield* db.select().from(MetaAgentTable)).toEqual(metas)
      expect(yield* db.select().from(MetaAgentSessionTable)).toEqual(links)
    }),
  )

  it.effect("rejects adopting a Meta fork with a missing saved owner without repairing it", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const parent = yield* session.create({ location, agent: Agent.ID.make("meta") })
      yield* session.prompt({ sessionID: parent.id, text: "Meta context", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const fork = yield* session.fork({ sessionID: parent.id })
      yield* db.delete(MetaAgentSessionTable).where(eq(MetaAgentSessionTable.session_id, fork.id)).run()
      const events = yield* db.select().from(EventTable)
      const links = yield* db.select().from(MetaAgentSessionTable)
      expect(yield* session.fork({ id: fork.id, sessionID: parent.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.ControllerConflictError",
        kind: "meta_owner_invalid",
      })
      expect(yield* session.get(fork.id)).toEqual(fork)
      expect(yield* db.select().from(EventTable)).toEqual(events)
      expect(yield* db.select().from(MetaAgentSessionTable)).toEqual(links)
    }),
  )
  ;["build", "plan"].forEach((agent) => {
    admissionIt.live(`forks ordinary ${agent} after Meta deactivation and preserves an explicit managed fork`, () =>
      Effect.gen(function* () {
        const f = yield* metaAdmission(false)
        const sessions = yield* Session.Service
        const parent = yield* f.create()
        const bus = yield* Bus.Service
        const question = yield* sessions.prompt({ sessionID: parent.id, text: "Fork context", resume: false })
        yield* SessionInbox.promote(f.db, bus, parent.id, "steer")
        yield* sessions.switchAgent({ sessionID: parent.id, agent: Agent.ID.make(agent) })
        const owners = yield* f.metas.sessions(parent.controller!.metaAgentID)
        const ordinary = yield* sessions.fork({ sessionID: parent.id })
        expect(ordinary.agent).toBe(Agent.ID.make(agent))
        expect(ordinary.controller).toBeUndefined()
        expect(yield* sessions.fork({ id: ordinary.id, sessionID: parent.id })).toEqual(ordinary)
        expect(yield* f.metas.sessions(parent.controller!.metaAgentID)).toEqual(owners)
        const managed = yield* sessions.fork({ sessionID: parent.id, control: "meta", model: f.model })
        expect(managed.agent).toBe(Agent.ID.make("meta"))
        expect(managed.controller).toMatchObject({
          kind: "root",
          metaAgentID: parent.controller!.metaAgentID,
          rootSessionID: managed.id,
        })
        expect(yield* f.metas.sessions(parent.controller!.metaAgentID)).toHaveLength(owners.length + 1)
        const through = yield* sessions.fork({ sessionID: parent.id, through: question.id })
        expect(through.fork?.boundary).toEqual({ type: "through", messageID: question.id })
        expect(through.agent).toBe(Agent.ID.make(agent))
        expect(through.controller).toBeUndefined()
        const managedThrough = yield* sessions.fork({
          sessionID: parent.id,
          through: question.id,
          control: "meta",
          model: f.model,
        })
        expect(managedThrough.agent).toBe(Agent.ID.make("meta"))
        expect(managedThrough.controller).toMatchObject({
          kind: "root",
          metaAgentID: parent.controller!.metaAgentID,
          rootSessionID: managedThrough.id,
        })
        expect(yield* f.metas.sessions(parent.controller!.metaAgentID)).toHaveLength(owners.length + 2)
      }),
    )
  })

  admissionIt.live("rejects an ordinary fork when its preview source changes inside the transaction", () =>
    Effect.gen(function* () {
      const f = yield* metaAdmission(false)
      const sessions = yield* Session.Service
      const parent = yield* f.create()
      yield* sessions.prompt({ sessionID: parent.id, text: "Fork context", resume: false })
      yield* SessionInbox.promote(f.db, f.bus, parent.id, "steer")
      yield* sessions.switchAgent({ sessionID: parent.id, agent: Agent.ID.make("build") })
      const source = yield* sessions.get(parent.id)
      const expectedSource = new SessionSchema.ForkExpectedSource({
        sourceSessionID: source.id,
        mode: source.mode,
        agent: source.agent,
        model: source.model,
        controller: source.controller,
      })
      const before = yield* f.read()
      yield* f.bus.project(SessionEvent.Forked, () =>
        f.db
          .update(SessionTable)
          .set({ agent: "plan" })
          .where(eq(SessionTable.id, parent.id))
          .pipe(Effect.orDie, Effect.asVoid),
      )
      expect(yield* sessions.fork({ sessionID: parent.id, expectedSource }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.ControllerConflictError",
        kind: "fork_source_conflict",
        field: "expectedSource",
      })
      expect(yield* f.read()).toEqual(before)
    }),
  )

  it.effect("creates four generic roots with an explicit Meta owner and independent model domains", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const db = (yield* Database.Service).db
      yield* Effect.forEach(["chat", "coding", "work", "assistant"] as const, (mode) =>
        Effect.gen(function* () {
          const created = yield* session.create({ location, mode, agent: Agent.ID.make("meta") })
          expect(created.agent).toBe(Agent.ID.make("meta"))
          expect(created.model).toBeDefined()
          expect(created.controller).toMatchObject({ kind: "root", rootSessionID: created.id })
          const links = yield* db
            .select()
            .from(MetaAgentSessionTable)
            .where(eq(MetaAgentSessionTable.session_id, created.id))
          expect(links).toHaveLength(1)
          expect(links[0]?.role).toBe("orchestrator")
          expect(
            yield* db.select().from(MetaAgentTable).where(eq(MetaAgentTable.id, links[0]!.meta_agent_id)),
          ).toHaveLength(1)
        }),
      )
    }),
  )

  it.effect("creates ordinary Build and Plan roots without resolving Meta models or executor preferences", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const db = (yield* Database.Service).db
      yield* Effect.forEach(["build", "plan"] as const, (name) =>
        Effect.gen(function* () {
          const model =
            name === "plan"
              ? Model.Ref.make({
                  id: Model.ID.make("unactivated"),
                  providerID: Provider.ID.make("unavailable"),
                  variant: Model.VariantID.make("high"),
                })
              : undefined
          const created = yield* session.create({
            location,
            agent: Agent.ID.make(name),
            model,
            executorPreference: { agent: Agent.ID.make("unavailable-executor") },
          })
          expect(created.agent).toBe(Agent.ID.make(name))
          expect(created.model).toEqual(model)
          expect(created.controller).toBeUndefined()
          expect(created.executorPreference).toBeUndefined()
        }),
      )
      expect(yield* db.select().from(SessionTable)).toHaveLength(2)
      expect(yield* db.select().from(MetaAgentTable)).toHaveLength(0)
      expect(yield* db.select().from(MetaAgentSessionTable)).toHaveLength(0)
    }),
  )

  Array.of("build", "plan").forEach((name) =>
    admissionIt.live(`activates Meta from ${name} with the captured valid model`, () =>
      Effect.gen(function* () {
        const fixture = yield* metaAdmission(false)
        const sessions = yield* Session.Service
        const previous =
          name === "plan"
            ? Model.Ref.make({
                providerID: Provider.ID.make("unavailable"),
                id: Model.ID.make("unactivated"),
                variant: Model.VariantID.make("high"),
              })
            : undefined
        const created = yield* sessions.create({
          id: fixture.id,
          location: fixture.location,
          agent: Agent.ID.make(name),
          model: previous,
        })
        expect(created.controller).toBeUndefined()
        yield* sessions.switchAgent({ sessionID: created.id, agent: Agent.ID.make("meta"), model: fixture.model })
        const selected = yield* sessions.get(created.id)
        expect(selected.agent).toBe(Agent.ID.make("meta"))
        expect(selected.model).toMatchObject(fixture.model)
        expect(selected.controller).toMatchObject({ kind: "root", rootSessionID: created.id })
        if (!selected.model || selected.controller?.kind !== "root")
          return yield* Effect.die(new Error("Meta activation owner missing"))
        const model = Schema.encodeSync(Model.Selection)(selected.model)
        const after = yield* fixture.read()
        expect(after.metas).toHaveLength(1)
        expect(after.metas[0]).toMatchObject({ id: selected.controller.metaAgentID, agent: "meta", model })
        expect(after.owners).toMatchObject([
          { meta_agent_id: selected.controller.metaAgentID, session_id: created.id, role: "orchestrator" },
        ])
        expect(after.events.at(-1)).toMatchObject({
          type: Bus.versionedType(SessionEvent.AgentSelected.type, 1),
          data: Schema.encodeSync(SessionEvent.AgentSelected.data)({
            sessionID: created.id,
            agent: Agent.ID.make("meta"),
            previous: Agent.ID.make(name),
            controller: selected.controller,
            model: selected.model,
          }),
        })
      }),
    ),
  )

  admissionIt.live("deactivates Meta while retaining history and reusing its identity", () =>
    Effect.gen(function* () {
      const fixture = yield* metaAdmission(false)
      const sessions = yield* Session.Service
      const created = yield* fixture.create()
      const before = yield* fixture.read()
      const ordinaryModel = Model.Ref.make({
        providerID: Provider.ID.make("unavailable"),
        id: Model.ID.make("ordinary"),
        variant: Model.VariantID.make("high"),
      })
      yield* Effect.forEach(["build", "plan"] as const, (name) =>
        Effect.gen(function* () {
          yield* sessions.switchAgent({ sessionID: created.id, agent: Agent.ID.make(name) })
          yield* sessions.switchModel({ sessionID: created.id, model: ordinaryModel })
          expect((yield* fixture.read()).metas).toEqual(before.metas)
          expect(yield* sessions.get(created.id)).toMatchObject({
            agent: name,
            model: ordinaryModel,
            controller: created.controller,
          })
          yield* sessions.switchAgent({ sessionID: created.id, agent: Agent.ID.make("meta"), model: fixture.model })
          expect(yield* sessions.get(created.id)).toMatchObject({
            agent: "meta",
            model: created.model,
            controller: created.controller,
          })
        }),
      )
      const after = yield* fixture.read()
      expect(after.metas).toEqual(before.metas)
      expect(after.owners).toEqual(before.owners)
    }),
  )

  Array.from([SessionTable, MetaAgentTable, MetaAgentSessionTable, EventTable, EventSequenceTable]).forEach((table) =>
    admissionIt.live(`Meta selection rolls back after ${getTableName(table)} mutation fails`, () =>
      Effect.gen(function* () {
        const fixture = yield* metaAdmission(false)
        const sessions = yield* Session.Service
        yield* sessions.create({ id: fixture.id, location: fixture.location, agent: Agent.ID.make("build") })
        const before = yield* fixture.read()
        const published: string[] = []
        const unsubscribe = yield* fixture.bus.listen((event) =>
          Effect.sync(() => {
            if (Schema.is(SessionEvent.AgentSelected)(event) && event.data.sessionID === fixture.id)
              published.push(event.type)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* fixture.db
          .run(
            sql.raw(`CREATE TEMP TRIGGER fail_meta_selection AFTER ${table === SessionTable || table === EventSequenceTable ? "UPDATE" : "INSERT"} ON "${getTableName(table)}"
              BEGIN SELECT RAISE(ABORT, 'Meta selection mutation failed'); END`),
          )
          .pipe(Effect.orDie)
        yield* Effect.addFinalizer(() =>
          fixture.db.run(sql`DROP TRIGGER IF EXISTS fail_meta_selection`).pipe(Effect.orDie),
        )
        const failed = yield* sessions
          .switchAgent({ sessionID: fixture.id, agent: Agent.ID.make("meta"), model: fixture.model })
          .pipe(Effect.exit)
        expect(Exit.isFailure(failed)).toBe(true)
        expect(Exit.isFailure(failed) ? Cause.pretty(failed.cause) : "").toContain("Meta selection mutation failed")
        expect(yield* fixture.read()).toEqual(before)
        expect(published).toEqual([])
        yield* fixture.db.run(sql`DROP TRIGGER fail_meta_selection`).pipe(Effect.orDie)
        yield* sessions.switchAgent({ sessionID: fixture.id, agent: Agent.ID.make("meta"), model: fixture.model })
        yield* fixture.metas.assertOwner(yield* sessions.get(fixture.id))
        const after = yield* fixture.read()
        expect(after.metas).toHaveLength(1)
        expect(after.owners).toHaveLength(1)
        expect(after.events).toHaveLength(before.events.length + 1)
        expect(published).toEqual([SessionEvent.AgentSelected.type])
      }),
    ),
  )

  admissionIt.live("Meta selection adopts one identity across overlapping activation requests", () =>
    Effect.gen(function* () {
      const fixture = yield* metaAdmission(false)
      const sessions = yield* Session.Service
      yield* sessions.create({ id: fixture.id, location: fixture.location, agent: Agent.ID.make("build") })
      const entered = yield* Deferred.make<void>()
      const retrying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      const projections: string[] = []
      yield* fixture.bus.project(SessionEvent.AgentSelected, (event) => {
        if (event.data.sessionID !== fixture.id) return Effect.void
        return Effect.gen(function* () {
          projections.push(event.id)
          if (projections.length !== 1) return
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        })
      })
      const first = yield* sessions
        .switchAgent({ sessionID: fixture.id, agent: Agent.ID.make("meta"), model: fixture.model })
        .pipe(Effect.forkIn(yield* Scope.Scope))
      yield* awaitWithTimeout(Deferred.await(entered), "Meta activation did not enter its transaction")
      const second = yield* Effect.gen(function* () {
        yield* Deferred.succeed(retrying, undefined)
        yield* sessions.switchAgent({ sessionID: fixture.id, agent: Agent.ID.make("meta"), model: fixture.model })
      }).pipe(Effect.forkIn(yield* Scope.Scope))
      yield* awaitWithTimeout(Deferred.await(retrying), "The concurrent Meta activation did not start")
      yield* Deferred.succeed(release, undefined)
      yield* Effect.all([Fiber.join(first), Fiber.join(second)], { concurrency: "unbounded" })
      const selected = yield* sessions.get(fixture.id)
      yield* fixture.metas.assertOwner(selected)
      const after = yield* fixture.read()
      expect(after.sessions).toHaveLength(1)
      expect(after.metas).toHaveLength(1)
      expect(after.owners).toHaveLength(1)
      expect(after.events).toHaveLength(2)
      expect(projections).toHaveLength(1)
    }),
  )

  admissionIt.live("Meta selection reconstructs the first activation from its durable event", () =>
    Effect.gen(function* () {
      const fixture = yield* metaAdmission(false)
      const sessions = yield* Session.Service
      yield* sessions.create({ id: fixture.id, location: fixture.location, agent: Agent.ID.make("build") })
      yield* sessions.switchAgent({ sessionID: fixture.id, agent: Agent.ID.make("meta"), model: fixture.model })
      const before = yield* fixture.read()
      const messages = yield* sessions.messages({ sessionID: fixture.id, order: "asc" })
      yield* fixture.db.delete(SessionTable).where(eq(SessionTable.id, fixture.id)).run().pipe(Effect.orDie)
      yield* fixture.db.delete(MetaAgentTable).run().pipe(Effect.orDie)
      yield* fixture.bus.remove(fixture.id)
      yield* Effect.forEach(before.events, (event) =>
        fixture.bus.replay({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          created: event.created,
          type: event.type,
          data: event.data,
        }),
      )
      expect(yield* fixture.read()).toEqual(before)
      expect(yield* sessions.messages({ sessionID: fixture.id, order: "asc" })).toEqual(messages)
      yield* fixture.metas.assertOwner(yield* sessions.get(fixture.id))
    }),
  )

  admissionIt.live("Meta selection preserves old AgentSelected events without activation facts", () =>
    Effect.gen(function* () {
      const fixture = yield* metaAdmission(false)
      const sessions = yield* Session.Service
      const created = yield* sessions.create({
        id: fixture.id,
        location: fixture.location,
        agent: Agent.ID.make("build"),
      })
      yield* fixture.bus.publish(SessionEvent.AgentSelected, {
        sessionID: created.id,
        agent: Agent.ID.make("meta"),
        previous: created.agent,
      })
      expect(yield* sessions.get(created.id)).toMatchObject({ agent: "meta", model: created.model })
      expect((yield* sessions.get(created.id)).controller).toBeUndefined()
      const after = yield* fixture.read()
      expect(after.metas).toHaveLength(0)
      expect(after.owners).toHaveLength(0)
      expect(after.events.at(-1)?.data).toEqual({ sessionID: created.id, agent: "meta", previous: "build" })
    }),
  )

  admissionIt.live("creates a root using the configured default Agent owner", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(path.join(directory, "aigcfroge.json"), JSON.stringify({ default_agent: "plan" })),
        )
        const session = yield* Session.Service
        const created = yield* session.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })
        expect(created.agent).toBe(Agent.ID.make("plan"))
        expect(created.controller).toBeUndefined()
        expect(created.model).toBeUndefined()
      }),
    ),
  )

  liveIt.live("preserves the project canonical directory when creating a session in another clone", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const main = AbsolutePath.make(path.join(directory, "repo"))
        const clone = AbsolutePath.make(path.join(directory, "other-clone"))
        yield* Effect.promise(async () => {
          await $`git init -q ${main}`.cwd(directory)
          await $`git -c user.name=Test -c user.email=test@aigcfroge.test -c commit.gpgsign=false commit --allow-empty -qm root`
            .cwd(main)
            .quiet()
          await $`git remote add origin git@github.com:owner/repo.git`.cwd(main)
          await $`git clone --no-hardlinks ${main} ${clone}`.quiet()
          await $`git remote set-url origin https://github.com/owner/repo.git`.cwd(clone)
        })
        const sessions = yield* Session.Service
        const projects = yield* Project.Service
        const first = yield* legacyRoot({ location: Location.Ref.make({ directory: main }) })
        const second = yield* legacyRoot({ location: Location.Ref.make({ directory: clone }) })

        expect(second.projectID).toBe(first.projectID)
        expect((yield* projects.list()).find((project) => project.id === first.projectID)?.canonical).toBe(main)
        expect((yield* sessions.get(first.id)).location.directory).toBe(main)
        expect((yield* sessions.get(second.id)).location.directory).toBe(clone)
      }),
    ),
  )

  projectIt.live("follows the directory's project identity established after creation", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const projects = yield* Project.Service
        const { db } = yield* Database.Service
        const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
        const nested = Location.Ref.make({ directory: AbsolutePath.make(path.join(directory, "packages", "app")) })
        const aliased = Location.Ref.make({
          directory: AbsolutePath.make([path.join(directory, "alias"), "..", "packages", "app"].join(path.sep)),
        })
        const created = yield* legacyRoot({ location: ref, title: "Before git" })
        const child = yield* legacyRoot({ location: nested, title: "Nested before git" })
        const alias = yield* legacyRoot({ location: aliased, title: "Aliased before git" })
        const bus = yield* Bus.Service
        const store = yield* SessionStore.Service
        yield* session.prompt({ sessionID: created.id, text: "Preserved history", resume: false })
        yield* SessionInbox.promote(db, bus, created.id, "steer")
        const pending = yield* session.prompt({ sessionID: created.id, text: "Preserved inbox", resume: false })
        yield* store.claim(created.id)
        const before = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, created.id))
          .get()
          .pipe(Effect.orDie)
        if (!before) return yield* Effect.die(new Error("created session not found"))

        yield* Effect.promise(async () => {
          await $`git init -q`.cwd(directory)
          await $`git config user.email test@example.com`.cwd(directory)
          await $`git config user.name Test`.cwd(directory)
        })
        const unborn = yield* projects.resolve(ref.directory)
        const unbornRoot = yield* session.get(created.id)
        const unbornNested = yield* session.get(child.id)
        const unbornAlias = yield* session.get(alias.id)

        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "README.md"), "test\n")
          await $`git add README.md`.cwd(directory)
          await $`git commit -qm initial`.cwd(directory)
          await $`git remote add origin git@github.com:owner/adopted.git`.cwd(directory)
        })

        const project = yield* projects.resolve(ref.directory)
        const repeat = yield* projects.resolve(ref.directory)
        const adopted = yield* session.get(created.id)
        const nestedAdopted = yield* session.get(child.id)
        const aliasAdopted = yield* session.get(alias.id)
        const page = yield* session.list({ project: project.id })
        const log = Array.from(yield* Stream.runCollect(logEvents(session, created.id)))

        expect(created.projectID).not.toBe(Project.ID.global)
        expect(child.projectID).not.toBe(created.projectID)
        expect(alias.projectID).toBe(child.projectID)
        expect(unborn.id).toBe(Project.ID.global)
        expect(unbornRoot).toMatchObject({ projectID: Project.ID.global, subpath: undefined })
        expect(unbornNested).toMatchObject({ projectID: Project.ID.global, subpath: "packages/app" })
        expect(unbornAlias).toMatchObject({ projectID: Project.ID.global, subpath: "packages/app" })
        expect(
          yield* db
            .select({ data: EventTable.data })
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, Project.ID.global))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({ data: { adopted: expect.arrayContaining([created.projectID, child.projectID]) } })
        expect(project.id).toBe(Project.ID.make(Hash.fast("git-remote:github.com/owner/adopted")))
        expect(repeat.id).toBe(project.id)
        expect(page.data.map((item) => item.id)).toEqual(expect.arrayContaining([created.id, child.id]))
        expect(adopted).toMatchObject({
          projectID: project.id,
          location: ref,
          subpath: undefined,
          time: { updated: DateTime.makeUnsafe(before.time_updated) },
        })
        expect(nestedAdopted).toMatchObject({
          projectID: project.id,
          location: nested,
          subpath: RelativePath.make("packages/app"),
        })
        expect(aliasAdopted).toMatchObject({
          projectID: project.id,
          location: aliased,
          subpath: RelativePath.make("packages/app"),
        })
        // Adoption is a project-domain fact; the session log records nothing new.
        expect(log.map((event) => event.type)).toEqual([
          "session.created",
          "session.inbox.enqueued",
          "session.inbox.delivered",
          "session.inbox.enqueued",
        ])
        expect(yield* session.messages({ sessionID: created.id })).toMatchObject([
          { id: expect.any(String), ...Expected.user("Preserved history") },
        ])
        expect(yield* SessionInbox.find(db, pending.id)).toMatchObject({ payload: { text: "Preserved inbox" } })
        expect(
          yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get().pipe(Effect.orDie),
        ).toMatchObject({
          time_created: before.time_created,
          time_updated: before.time_updated,
          time_suspended: before.time_suspended,
          resume_attempts: before.resume_attempts,
        })
        // Repeated resolution announces the directory's identity exactly once.
        const announced = yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, project.id))
          .all()
          .pipe(Effect.orDie)
        expect(announced.map((event) => event.type)).toEqual(["worktree.resolved.1"])
      }),
    ),
  )

  liveIt.live("does not adopt nested repositories or sessions in another workspace", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const projects = yield* Project.Service
        const outer = path.join(directory, "outer")
        const nested = path.join(outer, "nested")
        const child = AbsolutePath.make(path.join(nested, "app"))
        yield* Effect.promise(() => fs.mkdir(child, { recursive: true }))

        const local = yield* legacyRoot({ location: Location.Ref.make({ directory: AbsolutePath.make(outer) }) })
        const inside = yield* legacyRoot({ location: Location.Ref.make({ directory: child }) })
        const remote = yield* legacyRoot({
          location: Location.Ref.make({
            directory: AbsolutePath.make(outer),
            workspaceID: Workspace.ID.make("wrk_remote"),
          }),
        })

        yield* Effect.promise(async () => {
          for (const root of [nested, outer]) {
            await $`git init -q`.cwd(root)
            await $`git config user.email test@example.com`.cwd(root)
            await $`git config user.name Test`.cwd(root)
            await $`git commit --allow-empty -qm initial`.cwd(root)
          }
        })

        const parent = yield* projects.resolve(AbsolutePath.make(outer))
        expect((yield* session.get(local.id)).projectID).toBe(parent.id)
        expect((yield* session.get(inside.id)).projectID).toBe(inside.projectID)
        expect((yield* session.get(remote.id)).projectID).toBe(remote.projectID)

        const repository = yield* projects.resolve(AbsolutePath.make(nested))
        expect((yield* session.get(inside.id)).projectID).toBe(repository.id)
        expect((yield* session.get(remote.id)).projectID).toBe(remote.projectID)
      }),
    ),
  )

  it.effect("persists a missing title until one is generated or supplied", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service

      const created = yield* session.create({ location })
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get().pipe(Effect.orDie)
      const event = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .get()
        .pipe(Effect.orDie)

      expect(created.title).toBeUndefined()
      expect(row?.title).toBeNull()
      expect(event?.data).not.toHaveProperty("title")
      expect((yield* session.create({ location, title: "Explicit title" })).title).toBe("Explicit title")
    }),
  )

  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect((yield* session.list()).data).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location, agent: Agent.ID.make("plan") }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.create({ id, location, agent: Agent.ID.make("meta") })).toEqual(first)
      expect((yield* session.list()).data).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const workspaceID = Workspace.ID.make("wrk_test")
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("fast"),
      })

      expect(
        yield* legacyRoot({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: Agent.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("stores creation metadata and inherits it through children and forks", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const metadata = { thread: "C123/1699999999.123", labels: ["support", 2] }

      const created = yield* legacyRoot({ location, metadata })
      expect(created.metadata).toEqual(metadata)
      // The annotations are a durable creation fact, not just projected state.
      expect(
        yield* db
          .select({ data: EventTable.data })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, created.id))
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({ data: { metadata } })

      const inherited = yield* session.create({ parentID: created.id })
      expect(inherited.metadata).toEqual(metadata)
      const overridden = yield* session.create({ parentID: created.id, metadata: { thread: "other" } })
      expect(overridden.metadata).toEqual({ thread: "other" })

      yield* session.prompt({ sessionID: created.id, text: "Fork context", resume: false })
      yield* SessionInbox.promote(db, bus, created.id, "steer")
      const forked = yield* session.fork({ sessionID: created.id })
      expect(forked.metadata).toEqual(metadata)

      // Absent stays absent: no empty-object normalization.
      expect((yield* legacyRoot({ location })).metadata).toBeUndefined()

      const replacement = { thread: "updated", owner: "host" }
      yield* session.setMetadata({ sessionID: created.id, metadata: replacement })
      expect((yield* session.get(created.id)).metadata).toEqual(replacement)
      expect(
        yield* db
          .select({ data: EventTable.data })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, created.id),
              eq(EventTable.type, Bus.versionedType(SessionEvent.MetadataUpdated.type, 1)),
            ),
          )
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({ data: { metadata: replacement } })
      expect(
        yield* session.setMetadata({ sessionID: Session.ID.create(), metadata: replacement }).pipe(Effect.flip),
      ).toBeInstanceOf(Session.NotFoundError)
    }),
  )

  it.effect("stores permission rules, inherits them through children and forks, and replaces them", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const permissions = [{ action: "edit", resource: "/original/**", effect: "deny" as const }]

      const created = yield* legacyRoot({ location, permissions })
      expect(created.permissions).toEqual(permissions)
      expect((yield* session.create({ parentID: created.id })).permissions).toEqual(permissions)
      expect((yield* session.create({ parentID: created.id, permissions: [] })).permissions).toEqual([])

      yield* session.prompt({ sessionID: created.id, text: "Fork context", resume: false })
      yield* SessionInbox.promote(db, bus, created.id, "steer")
      const forked = yield* session.fork({ sessionID: created.id })
      expect(forked.permissions).toEqual(permissions)

      const replaced = [{ action: "shell", resource: "*", effect: "ask" as const }]
      yield* session.setPermissions({ sessionID: created.id, permissions: replaced })
      expect((yield* session.get(created.id)).permissions).toEqual(replaced)
      expect(
        yield* session.setPermissions({ sessionID: Session.ID.create(), permissions: replaced }).pipe(Effect.flip),
      ).toBeInstanceOf(Session.NotFoundError)
    }),
  )

  it.effect("inherits location from an existing parent when omitted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* legacyRoot({ location })
      const child = yield* session.create({ parentID: parent.id, title: "child" })

      expect(child).toMatchObject({ parentID: parent.id, location })
    }),
  )

  it.effect("rejects child creation when the parent does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.create()

      expect(yield* Effect.flip(session.create({ parentID: missing, title: "child" }))).toEqual(
        new Session.NotFoundError({ sessionID: missing }),
      )
    }),
  )

  it.effect("filters root sessions before applying the page limit", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const staleRoot = yield* legacyRoot({ location, title: "stale root" })
      const root = yield* legacyRoot({ location, title: "root" })
      const children = yield* Effect.forEach(Array.from({ length: 60 }), (_, index) =>
        session.create({ parentID: root.id, title: `child ${index}` }),
      )

      yield* Effect.forEach(children, (item, index) =>
        db
          .update(SessionTable)
          .set({ time_created: index + 100, time_updated: index + 20_000 })
          .where(eq(SessionTable.id, item.id))
          .run(),
      )
      yield* db
        .update(SessionTable)
        .set({ time_created: 2, time_updated: 5_000 })
        .where(eq(SessionTable.id, staleRoot.id))
        .run()
      yield* db
        .update(SessionTable)
        .set({ time_created: 1, time_updated: 10_000 })
        .where(eq(SessionTable.id, root.id))
        .run()

      const page = yield* session.list({ directory: location.directory, parentID: null, limit: 1, order: "desc" })

      expect(page.data.map((item) => item.id)).toEqual([root.id])
    }),
  )

  it.effect("orders sessions by their latest prompt", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const active = yield* session.create({ location, title: "active" })
      const newer = yield* session.create({ location, title: "newer" })

      yield* db
        .update(SessionTable)
        .set({ time_created: -2, time_updated: -2 })
        .where(eq(SessionTable.id, active.id))
        .run()
      yield* db
        .update(SessionTable)
        .set({ time_created: -1, time_updated: -1 })
        .where(eq(SessionTable.id, newer.id))
        .run()

      yield* session.prompt({ sessionID: active.id, text: "continue", resume: false })

      expect((yield* session.list()).data.map((item) => item.id)).toEqual([active.id, newer.id])
    }),
  )

  it.effect("filters direct child sessions by parent ID", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* legacyRoot({ location, title: "parent" })
      const child = yield* session.create({ parentID: parent.id, title: "child" })
      yield* legacyRoot({ location, title: "other root" })

      const page = yield* session.list({ parentID: parent.id })

      expect(page.data.map((item) => item.id)).toEqual([child.id])
    }),
  )

  it.effect("filters project sessions by subpath", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const root = yield* session.create({ location, title: "root" })
      const nested = yield* session.create({ location, title: "nested" })

      yield* db.update(SessionTable).set({ path: "packages/tui" }).where(eq(SessionTable.id, nested.id)).run()

      const page = yield* session.list({
        project: Project.ID.global,
        subpath: RelativePath.make("packages/tui"),
        parentID: null,
      })

      expect(page.data.map((item) => item.id)).toEqual([nested.id])
      expect(page.data.map((item) => item.id)).not.toContain(root.id)
    }),
  )

  it.effect("forks a session by replaying a durable fork event into copied projected rows", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location, title: "Parent", agent: Agent.ID.make("plan") })
      const admitted = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      yield* session.synthetic({ sessionID: parent.id, text: "parent note", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")

      const forked = yield* session.fork({ sessionID: parent.id })
      const parentContext = yield* session.context(parent.id)
      const forkContext = yield* session.context(forked.id)
      const history = Array.from(yield* Stream.runCollect(logEvents(session, forked.id)))

      expect(forked).toMatchObject({ title: "Parent (fork #1)", fork: { sessionID: parent.id } })
      expect(forked.parentID).toBeUndefined()
      expect(forked.agent).toBe(parent.agent)
      expect(forked.model).toEqual(parent.model)
      expect(forked.controller).toBeUndefined()
      expect(forkContext).toMatchObject([Expected.user("First"), { type: "synthetic", text: "parent note" }])
      expect(forkContext.map((message) => message.id)).not.toEqual(parentContext.map((message) => message.id))
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        type: "session.forked",
        durable: { seq: 0 },
        data: { sessionID: forked.id, parentID: parent.id },
      })
      expect(yield* SessionInbox.find(db, forkContext[0].id)).toBeUndefined()
      expect(yield* SessionInbox.find(db, forkContext[1].id)).toBeUndefined()
      expect(
        yield* session.prompt({ id: forkContext[0].id, sessionID: forked.id, text: "First", resume: false }),
      ).toMatchObject({ id: forkContext[0].id, type: "user", payload: { text: "First" } })

      yield* session.prompt({
        sessionID: parent.id,
        text: "Parent changed",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      yield* session.prompt({
        sessionID: forked.id,
        text: "Child continues",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, forked.id, "steer")

      expect((yield* session.context(parent.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).at(-1)).toMatchObject({ text: "Child continues" })
      expect(
        Array.from(yield* Stream.runCollect(logEvents(session, forked.id))).map(
          (event): number | undefined => event.durable?.seq,
        ),
      ).toEqual([0, 5, 6])
      expect(yield* SessionInbox.find(db, admitted.id)).toBeUndefined()
    }),
  )

  it.effect("keeps a fork untitled when its parent is untitled", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* session.prompt({ sessionID: parent.id, text: "First", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")

      const forked = yield* session.fork({ sessionID: parent.id })
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, forked.id)).get().pipe(Effect.orDie)

      expect(forked.title).toBeUndefined()
      expect(row?.title).toBeNull()
    }),
  )

  it.effect("retains child fork ownership, mode, copied identities and explicit ID across replay", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const parent = yield* legacyRoot({ location, mode: "work", title: "Child fork parent" })
      yield* session.prompt({ sessionID: parent.id, text: "Shared context", resume: false })
      yield* SessionInbox.promote(database.db, bus, parent.id, "steer")
      const id = Session.ID.create()
      const child = yield* session.fork({ id, sessionID: parent.id, child: true })
      expect(child).toMatchObject({
        id,
        parentID: parent.id,
        mode: "work",
        attended: false,
        fork: { sessionID: parent.id },
      })
      const messages = yield* session.context(id)
      expect(messages).toMatchObject([Expected.user("Shared context")])
      expect(yield* session.fork({ id, sessionID: parent.id, child: true })).toEqual(child)
      const events = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all()
      expect(events).toHaveLength(1)
      expect(events[0]?.data).toMatchObject({ child: true })
      yield* bus.remove(id)
      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, id)).run()
      yield* bus.replay({
        id: events[0].id,
        type: events[0].type,
        created: events[0].created,
        seq: events[0].seq,
        aggregateID: id,
        data: events[0].data,
      })
      expect(yield* session.get(id)).toMatchObject({ parentID: parent.id, mode: "work", attended: false })
      expect((yield* session.context(id)).map((message) => message.id)).toEqual(messages.map((message) => message.id))
      const fresh = yield* session.create({ parentID: parent.id })
      expect(fresh).toMatchObject({ parentID: parent.id, mode: "work", attended: false })
      const root = yield* session.fork({ sessionID: parent.id })
      expect(root.mode).toBe("work")
      expect(root.parentID).toBeUndefined()
      expect(root.attended).toBeUndefined()
    }),
  )

  it.effect("rejects an explicit fork ID bound to a different parent or ownership kind", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const parent = yield* legacyRoot({ location, title: "Parent" })
      const other = yield* legacyRoot({ location, title: "Other parent" })
      yield* session.prompt({ sessionID: parent.id, text: "Context", resume: false })
      yield* SessionInbox.promote(database.db, bus, parent.id, "steer")
      const child = yield* session.fork({ sessionID: parent.id, child: true })
      for (const input of [
        { id: child.id, sessionID: other.id, child: true },
        { id: child.id, sessionID: parent.id },
        { id: other.id, sessionID: parent.id, child: true },
      ])
        expect(yield* session.fork(input).pipe(Effect.flip)).toMatchObject({ _tag: "Session.ForkConflictError" })
      expect((yield* session.get(child.id)).parentID).toBe(parent.id)
    }),
  )

  it.effect("replays a fork with stable projected identities", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location, title: "Parent" })
      yield* session.prompt({ sessionID: parent.id, text: "First", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      yield* session.synthetic({ sessionID: parent.id, text: "Second", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const forked = yield* session.fork({ sessionID: parent.id })
      const original = (yield* session.context(forked.id)).map((message) => message.id)
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, forked.id))
        .get()
        .pipe(Effect.orDie)
      if (!recorded) return yield* Effect.die(new Error("Fork event not found"))

      yield* bus.remove(forked.id)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, forked.id)).run().pipe(Effect.orDie)
      yield* bus.replay({
        id: recorded.id,
        created: recorded.created,
        aggregateID: recorded.aggregate_id,
        seq: recorded.seq,
        type: recorded.type,
        data: recorded.data,
      })

      expect((yield* session.context(forked.id)).map((message) => message.id)).toEqual(original)
    }),
  )

  it.effect("inherits instruction entries when forking", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const entries = yield* InstructionEntry.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* session.prompt({ sessionID: parent.id, text: "Fork context", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      yield* entries.put({ sessionID: parent.id, key: "deploy-target", value: "production" })
      yield* entries.put({ sessionID: parent.id, key: "retired", value: true })
      yield* entries.remove({ sessionID: parent.id, key: "retired" })
      yield* Effect.forEach(
        Array.from({ length: 20 }, (_, index) => index),
        (index) => entries.put({ sessionID: parent.id, key: `entry-${String(index).padStart(2, "0")}`, value: index }),
        { discard: true },
      )

      const forked = yield* session.fork({ sessionID: parent.id })
      const inheritedList = yield* entries.list(forked.id)
      const inheritedValues = yield* entries.load(forked.id).pipe(Effect.flatMap(Instructions.read))

      expect(inheritedList).toHaveLength(21)
      expect(inheritedList).toContainEqual({ key: "deploy-target", value: "production" })
      expect(inheritedValues).toContainEqual({
        key: Instructions.Key.make("api/retired"),
        value: Instructions.removed,
      })

      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, forked.id))
        .get()
        .pipe(Effect.orDie)
      if (!recorded) return yield* Effect.die(new Error("Fork event not found"))
      yield* entries.put({ sessionID: parent.id, key: "deploy-target", value: "staging" })
      yield* entries.put({ sessionID: parent.id, key: "new-parent-entry", value: true })
      yield* bus.remove(forked.id)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, forked.id)).run().pipe(Effect.orDie)
      yield* bus.replay({
        id: recorded.id,
        created: recorded.created,
        aggregateID: recorded.aggregate_id,
        seq: recorded.seq,
        type: recorded.type,
        data: recorded.data,
      })

      expect(yield* entries.list(forked.id)).toEqual(inheritedList)
      expect(yield* entries.load(forked.id).pipe(Effect.flatMap(Instructions.read))).toEqual(inheritedValues)
    }),
  )

  it.effect("does not copy a running assistant into a fork", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* session.prompt({ sessionID: parent.id, text: "Run both tools", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })

      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID: parent.id,
        assistantMessageID,
        id: "call_running",
        name: "shell",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID: parent.id,
        assistantMessageID,
        id: "call_running",
        text: '{"command":"sleep 10"}',
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID: parent.id,
        assistantMessageID,
        id: "call_running",
        input: { command: "sleep 10" },
        executed: true,
      })

      const forked = yield* session.fork({ sessionID: parent.id })

      expect(yield* session.context(parent.id)).toMatchObject([
        Expected.user("Run both tools"),
        Expected.assistant({}, [{ type: "tool", id: "call_running", state: { status: "running" } }]),
      ])
      expect(yield* session.context(forked.id)).toMatchObject([Expected.user("Run both tools")])
    }),
  )

  it.effect("copies only settled shell messages into forks", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* session.prompt({ sessionID: parent.id, text: "Run a shell", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const shell = Shell.Info.make({
        id: Shell.ID.make("sh_fork_running"),
        status: "running",
        command: "sleep 10",
        cwd: location.directory,
        shell: "/bin/sh",
        file: "/tmp/sh_fork_running.out",
        metadata: {},
        time: { started: 0 },
      })
      yield* bus.publish(SessionEvent.Shell.Started, { sessionID: parent.id, shell })

      const running = yield* session.fork({ sessionID: parent.id })

      expect(yield* session.context(parent.id)).toMatchObject([
        Expected.user("Run a shell"),
        { type: "shell", command: "sleep 10", status: "running" },
      ])
      expect(yield* session.context(running.id)).toMatchObject([Expected.user("Run a shell")])

      yield* bus.publish(SessionEvent.Shell.Ended, {
        sessionID: parent.id,
        shell: { ...shell, status: "exited", exit: 0, time: { started: 0, completed: 1 } },
        output: { output: "complete", cursor: 8, size: 8, truncated: false },
      })
      const completed = yield* session.fork({ sessionID: parent.id })

      expect(yield* session.context(running.id)).toMatchObject([Expected.user("Run a shell")])
      expect(yield* session.context(completed.id)).toMatchObject([
        Expected.user("Run a shell"),
        { type: "shell", command: "sleep 10", status: "exited", output: { output: "complete" } },
      ])
    }),
  )

  it.effect("rejects forking an empty session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location })

      expect(yield* session.fork({ sessionID: parent.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.ForkEmptyError",
        sessionID: parent.id,
      })
    }),
  )

  it.effect("forks before the selected boundary message", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      const first = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const second = yield* session.prompt({
        sessionID: parent.id,
        text: "Second",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.make(0.75),
        tokens: { input: 6, output: 3, reasoning: 1, cache: { read: 2, write: 1 } },
      })

      const forked = yield* session.fork({
        sessionID: parent.id,
        before: second.id,
      })
      const beforeFirst = yield* session.fork({
        sessionID: parent.id,
        before: first.id,
      })
      const complete = yield* session.fork({ sessionID: parent.id })

      const context = yield* session.context(forked.id)
      const history = Array.from(yield* Stream.runCollect(logEvents(session, forked.id)))
      expect(forked.fork).toEqual({
        sessionID: parent.id,
        boundary: { type: "before", messageID: second.id },
      })
      expect(context).toMatchObject([{ text: "First" }])
      expect(context[0]?.id).not.toBe(first.id)
      expect(history[0]).toMatchObject({
        data: { boundary: { type: "before", messageID: second.id } },
      })
      expect(forked).toMatchObject({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } })
      expect(yield* session.context(beforeFirst.id)).toEqual([])
      expect(beforeFirst).toMatchObject({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } })
      expect(yield* session.context(complete.id)).toMatchObject([
        Expected.user("First"),
        Expected.user("Second"),
        { type: "assistant", finish: "stop" },
      ])
      expect(complete).toMatchObject({
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
    }),
  )

  it.effect("forks through the last Assistant in a settled response group and leaves later turns on the source", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
      const parent = yield* legacyRoot({
        location,
        title: "Inclusive fork",
        mode: "work",
        agent: Agent.ID.make("build"),
        model,
      })
      const first = yield* session.prompt({ sessionID: parent.id, text: "U1", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const opening = SessionMessage.ID.create()
      const usage = {
        cost: Money.USD.make(0),
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID: opening,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID: parent.id, assistantMessageID: opening, ordinal: 0 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: parent.id,
        assistantMessageID: opening,
        ordinal: 0,
        text: "A1 opening text",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID: parent.id,
        assistantMessageID: opening,
        id: "read_a1",
        name: "read",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID: parent.id,
        assistantMessageID: opening,
        id: "read_a1",
        text: '{"path":"answer.txt"}',
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID: parent.id,
        assistantMessageID: opening,
        id: "read_a1",
        input: { path: "answer.txt" },
        executed: false,
      })
      yield* bus.publish(SessionEvent.Tool.Success, {
        sessionID: parent.id,
        assistantMessageID: opening,
        id: "read_a1",
        content: [{ type: "text", text: "A1 tool result" }],
        executed: false,
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID: opening,
        finish: "tool-calls",
        needsContinuation: true,
        ...usage,
      })
      yield* bus.publish(SessionEvent.Step.Completed, { sessionID: parent.id, assistantMessageID: opening })
      const groupEnd = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID: groupEnd,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID: parent.id, assistantMessageID: groupEnd, ordinal: 0 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: parent.id,
        assistantMessageID: groupEnd,
        ordinal: 0,
        text: "A1 final text after tools",
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID: groupEnd,
        finish: "stop",
        needsContinuation: false,
        ...usage,
      })
      yield* bus.publish(SessionEvent.Step.Completed, { sessionID: parent.id, assistantMessageID: groupEnd })
      const second = yield* session.prompt({ sessionID: parent.id, text: "U2", resume: false })
      yield* SessionInbox.promote(db, bus, parent.id, "steer")
      const later = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID: later,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID: parent.id, assistantMessageID: later, ordinal: 0 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: parent.id,
        assistantMessageID: later,
        ordinal: 0,
        text: "A2 later response",
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID: later,
        finish: "stop",
        needsContinuation: false,
        ...usage,
      })
      yield* bus.publish(SessionEvent.Step.Completed, { sessionID: parent.id, assistantMessageID: later })
      const source = yield* session.messages({ sessionID: parent.id, order: "asc" })
      const sourceEvents = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, parent.id))
      const through = yield* session.fork({ sessionID: parent.id, through: groupEnd })
      const before = yield* session.fork({ sessionID: parent.id, before: second.id })
      const complete = yield* session.fork({ sessionID: parent.id })
      const selected = [
        Expected.user("U1"),
        Expected.assistant({ finish: "tool-calls" }, [
          Expected.text("A1 opening text"),
          {
            type: "tool",
            id: "read_a1",
            state: {
              status: "completed",
              input: { path: "answer.txt" },
              content: [{ type: "text", text: "A1 tool result" }],
            },
          },
        ]),
        Expected.assistant({ finish: "stop" }, [Expected.text("A1 final text after tools")]),
      ]
      expect(through.fork).toEqual({ sessionID: parent.id, boundary: { type: "through", messageID: groupEnd } })
      expect(before.fork).toEqual({ sessionID: parent.id, boundary: { type: "before", messageID: second.id } })
      expect(yield* session.context(through.id)).toMatchObject(selected)
      expect(yield* session.context(before.id)).toMatchObject(selected)
      expect(yield* session.context(complete.id)).toMatchObject([
        ...selected,
        Expected.user("U2"),
        Expected.assistant({ finish: "stop" }, [Expected.text("A2 later response")]),
      ])
      expect(
        (yield* session.messages({ sessionID: through.id, order: "asc" })).map((message) => message.id),
      ).not.toEqual([first.id, opening, groupEnd])
      yield* Effect.forEach([through, before, complete], (fork) =>
        Effect.gen(function* () {
          expect(fork).toMatchObject({ mode: parent.mode, agent: parent.agent, model: parent.model })
          expect(fork.parentID).toBeUndefined()
          expect(fork.controller).toBeUndefined()
          expect(yield* session.inbox(fork.id)).toEqual([])
          expect(Array.from(yield* Stream.runCollect(logEvents(session, fork.id))).map((event) => event.type)).toEqual([
            "session.forked",
          ])
        }),
      )
      const saved = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, through.id))
      expect(yield* session.fork({ id: through.id, sessionID: parent.id, through: groupEnd })).toEqual(through)
      expect(
        yield* session.fork({ id: through.id, sessionID: parent.id, through: opening }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ForkConflictError" })
      expect(
        yield* session.fork({ id: through.id, sessionID: parent.id, before: groupEnd }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ForkConflictError" })
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, through.id))).toEqual(saved)
      const rejected = Session.ID.create()
      expect(
        yield* session
          .fork({ id: rejected, sessionID: parent.id, before: second.id, through: groupEnd })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ForkConflictError", sessionID: rejected, parentID: parent.id })
      expect(yield* session.get(rejected).pipe(Effect.flip)).toMatchObject({ _tag: "Session.NotFoundError" })
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, rejected))).toEqual([])
      expect(yield* session.messages({ sessionID: parent.id, order: "asc" })).toEqual(source)
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, parent.id))).toEqual(sourceEvents)
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: Agent.ID.make("build") },
        {
          id,
          location,
          model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect((yield* session.list()).data).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect((yield* session.list()).data).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("persists creation through the current created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: Bus.versionedType(SessionEvent.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("includes current creation rows in the Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({
        sessionID: created.id,
        text: "Hello",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, created.id, "steer")

      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.take(3), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 0 }, type: "session.created" },
        {
          durable: { seq: 1 },
          type: "session.inbox.enqueued",
          data: {
            inboxID: expect.any(String),
            item: { type: "user", payload: { text: "Hello" }, delivery: "steer" },
          },
        },
        { durable: { seq: 2 }, type: "session.inbox.delivered" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sourceEvents = yield* Bus.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: Session.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        text: "Replay lifecycle",
        resume: false,
      })
      yield* SessionInbox.promote(sourceDb, sourceEvents, created.id, "steer")
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* tmpdirScoped()
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]),
        [
          Database.node.replace(Database.configured({ path: path.join(tmp.path, "target.sqlite") })),
          Bus.node.replace(Bus.configured({ persist: true })),
        ],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        yield* Effect.forEach(serialized.slice(0, 2), (event) => bus.replay(event), { discard: true })
        expect(yield* SessionInbox.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          type: "user",
          payload: { text: "Replay lifecycle" },
          delivery: "steer",
        })
        expect(yield* store.context(created.id)).toEqual([])

        yield* Effect.forEach(serialized.slice(2), (event) => bus.replay(event), { discard: true })
        expect(yield* SessionInbox.find(db, admitted.id)).toBeUndefined()
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, ...Expected.user("Replay lifecycle") },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, Bus.versionedType(SessionEvent.Created.type, 1)],
          [1, Bus.versionedType(SessionEvent.InboxEnqueued.type, 1)],
          [2, Bus.versionedType(SessionEvent.InboxDelivered.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const event = yield* Bus.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionEvent.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  liveIt.live("runs a shell command and projects the started/ended shell message", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* legacyRoot({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })
        yield* session.environment({ sessionID: created.id, variables: { AIGCFROGE_SESSION_ENV_TEST: "attached" } })

        const command =
          process.platform === "win32"
            ? "[Console]::Out.Write($env:AIGCFROGE_SESSION_ENV_TEST)"
            : 'printf %s "$AIGCFROGE_SESSION_ENV_TEST"'
        yield* session.shell({ sessionID: created.id, command })

        const messages = yield* session.messages({ sessionID: created.id, order: "asc" })
        const shell = messages.find((message): message is SessionMessage.Shell => message.type === "shell")
        expect(shell).toMatchObject({ type: "shell", command, status: "exited", exit: 0 })
        expect(shell?.output?.output).toContain("attached")
        expect(shell?.output?.truncated).toBe(false)
        expect(shell?.time.completed).toBeDefined()
      }),
    ),
  )

  liveIt.live("still emits shell ended for a failing command", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* legacyRoot({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })

        yield* session.shell({ sessionID: created.id, command: "false" })

        const messages = yield* session.messages({ sessionID: created.id, order: "asc" })
        const shell = messages.find((message): message is SessionMessage.Shell => message.type === "shell")
        expect(shell).toMatchObject({ type: "shell", command: "false", status: "exited" })
        expect(shell?.exit).not.toBe(0)
        expect(shell?.time.completed).toBeDefined()
      }),
    ),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location, agent: Agent.ID.make("build") })

      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("plan") })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.drop(1), Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.agent.selected", data: { agent: "plan", previous: "build" } }])
      expect(yield* session.messages({ sessionID: created.id, order: "asc" })).toMatchObject([
        { type: "agent-switched", agent: "plan", previous: "build" },
      ])
      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("build") })
      expect((yield* session.get(created.id)).agent).toBe(Agent.ID.make("build"))
      expect(yield* session.messages({ sessionID: created.id, order: "asc" })).toMatchObject([
        { type: "agent-switched", agent: "plan", previous: "build" },
        { type: "agent-switched", agent: "build", previous: "plan" },
      ])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: Agent.ID.make("plan") }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const previous = Model.Ref.make({
        id: Model.ID.make("haiku"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("default"),
      })
      const created = yield* legacyRoot({ location, model: previous })
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      const bus = Array.from(
        yield* logEvents(session, created.id, true).pipe(Stream.drop(1), Stream.take(1), Stream.runCollect),
      )
      expect(bus).toMatchObject([{ type: "session.model.selected" }])
      expect(bus[0]?.data).toEqual({ sessionID: created.id, model, previous })
      expect(yield* session.messages({ sessionID: created.id, order: "asc" })).toMatchObject([
        { type: "model-switched", model, previous },
      ])
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* legacyRoot({ location })
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })
      const created = yield* legacyRoot({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: Model.Ref.make({ ...model, variant: Model.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )
})

describe("SessionTransfer", () => {
  it.effect("imports correction-shaped history as historical data and clears asserted completion", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const corrections = yield* CorrectionStore.Service
      const bus = yield* Bus.Service
      const template = yield* legacyRoot({ location, title: "Correction import" })
      const sessionID = Session.ID.create()
      const imported = yield* transfer.import({
        location,
        data: {
          info: { ...template, id: sessionID },
          messages: [
            SessionMessage.User.make({
              id: SessionMessage.ID.create(),
              type: "user",
              text: "should be POST not GET",
              time: { created: DateTime.makeUnsafe(1) },
              origin: { kind: "inbox-user", sessionID, id: Event.ID.create(), seq: Event.Seq.make(1) },
            }),
            SessionMessage.Assistant.make({
              id: SessionMessage.ID.create(),
              type: "assistant",
              agent: Agent.defaultID,
              model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
              content: [],
              time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
              origin: { kind: "step", sessionID, id: Event.ID.create(), seq: Event.Seq.make(2) },
              completion: { id: Event.ID.create(), seq: Event.Seq.make(3) },
            }),
          ],
        },
      })
      const history = yield* session.messages({ sessionID: imported.id, order: "asc" })
      expect(history).toHaveLength(2)
      expect(history.every((message) => message.origin?.kind === "historical")).toBe(true)
      const assistant = history.find((message) => message.type === "assistant")
      if (assistant?.type !== "assistant") return yield* Effect.die(new Error("Imported settled Assistant missing"))
      expect(assistant.completion).toBeUndefined()
      expect(
        yield* corrections.syncSnapshot({
          sessionID: imported.id,
          visibleIDs: history.map((message) => message.id),
          publish: (snapshot) =>
            bus
              .publish(SessionEvent.Synthetic, { sessionID: imported.id, ...snapshot })
              .pipe(Effect.map((event) => SessionMessage.ID.fromEvent(event.id))),
        }),
      ).toBe(false)
      expect(yield* corrections.facts(imported.id)).toEqual([])
      expect((yield* corrections.snapshot(imported.id)).current).toBeUndefined()
    }).pipe(Effect.provide(correctionLayer)),
  )

  it.effect("exports only settled projected messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const source = yield* session.create({ location })
      yield* session.prompt({ sessionID: source.id, text: "Settled", resume: false })
      yield* SessionInbox.promote(db, bus, source.id, "steer")
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: source.id,
        assistantMessageID: SessionMessage.ID.create(),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
        started: 0,
      })
      yield* bus.publish(SessionEvent.Shell.Started, {
        sessionID: source.id,
        shell: Shell.Info.make({
          id: Shell.ID.make("sh_transfer_export"),
          status: "running",
          command: "sleep 10",
          cwd: location.directory,
          shell: "/bin/sh",
          file: "/tmp/sh_transfer_export.out",
          metadata: {},
          time: { started: 0 },
        }),
      })
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID: source.id,
        reason: "manual",
        recent: "pending",
      })

      expect((yield* transfer.export({ sessionID: source.id })).messages).toMatchObject([Expected.user("Settled")])
    }),
  )

  it.effect("imports only settled projected messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const { db } = yield* Database.Service
      const template = yield* session.create({ location, title: "Transfer source" })
      const sessionID = Session.ID.create()
      const userID = SessionMessage.ID.create()
      const runningAssistantID = SessionMessage.ID.create()
      const completedAssistantID = SessionMessage.ID.create()
      const runningShellID = SessionMessage.ID.create()
      const completedShellID = SessionMessage.ID.create()
      const runningCompactionID = SessionMessage.ID.create()
      const completedCompactionID = SessionMessage.ID.create()
      const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
      const providerState = { responseId: "summary-response" }

      yield* transfer.import({
        data: {
          info: { ...template, id: sessionID },
          messages: [
            { id: userID, type: "user", text: "Settled", time: { created: DateTime.makeUnsafe(1) } },
            {
              id: runningAssistantID,
              type: "assistant",
              agent: Agent.ID.make("build"),
              model,
              content: [],
              time: { created: DateTime.makeUnsafe(2) },
            },
            {
              id: completedAssistantID,
              type: "assistant",
              agent: Agent.ID.make("build"),
              model,
              content: [],
              time: { created: DateTime.makeUnsafe(3), completed: DateTime.makeUnsafe(4) },
            },
            {
              id: runningShellID,
              type: "shell",
              shellID: Shell.ID.make("sh_transfer_running"),
              command: "sleep 10",
              status: "running",
              time: { created: DateTime.makeUnsafe(5) },
            },
            {
              id: completedShellID,
              type: "shell",
              shellID: Shell.ID.make("sh_transfer_completed"),
              command: "pwd",
              status: "exited",
              exit: 0,
              output: { output: "/project", cursor: 8, size: 8, truncated: false },
              time: { created: DateTime.makeUnsafe(6), completed: DateTime.makeUnsafe(7) },
            },
            {
              id: runningCompactionID,
              type: "compaction",
              status: "running",
              reason: "manual",
              summary: "pending",
              recent: "pending",
              time: { created: DateTime.makeUnsafe(8) },
            },
            {
              id: completedCompactionID,
              type: "compaction",
              status: "completed",
              reason: "manual",
              model,
              providerState,
              summary: "summary",
              recent: "recent",
              time: { created: DateTime.makeUnsafe(9) },
            },
          ],
        },
        location,
      })

      expect((yield* session.messages({ sessionID, order: "asc" })).map((message) => message.id)).toEqual([
        userID,
        completedAssistantID,
        completedShellID,
        completedCompactionID,
      ])
      expect(yield* Bus.latestSequence(db, sessionID)).toBe(4)
      expect((yield* transfer.export({ sessionID })).messages.at(-1)).toMatchObject({ model, providerState })
      expect((yield* transfer.export({ sessionID, sanitize: true })).messages.at(-1)).toMatchObject({
        model,
        providerState: { redacted: `compaction-provider-state:${completedCompactionID}` },
      })
    }),
  )

  it.effect("imports projected messages and reserves their aggregate sequence", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const template = yield* session.create({
        location,
        title: "Exported",
        metadata: { channel: "C123" },
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      })
      const sessionID = Session.ID.create()
      const sourceMessageID = SessionMessage.ID.create()
      const errorMessageID = SessionMessage.ID.create()
      yield* TestClock.setTime(1_000)

      const imported = yield* transfer.import({
        data: {
          info: {
            ...template,
            id: sessionID,
            time: {
              ...template.time,
              updated: DateTime.makeUnsafe(100),
              idle: DateTime.makeUnsafe(200),
              viewed: DateTime.makeUnsafe(150),
            },
          },
          messages: [
            {
              id: sourceMessageID,
              type: "user",
              text: "Imported message",
              skills: [
                {
                  id: Skill.ID.make("effect"),
                  name: Skill.Name.make("Effect"),
                  text: "Private skill instructions from /private/project",
                },
              ],
              time: { created: DateTime.makeUnsafe(100) },
            },
            {
              id: errorMessageID,
              type: "compaction",
              status: "failed",
              reason: "manual",
              error: { type: "test_error", message: "Original error" },
              time: { created: DateTime.makeUnsafe(101) },
            },
          ],
        },
        location,
      })
      const messages = yield* session.messages({ sessionID, order: "asc" })

      expect(imported).toMatchObject({
        id: sessionID,
        title: "Exported",
        location,
        metadata: { channel: "C123" },
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      })
      expect(imported.time).toMatchObject({
        updated: DateTime.makeUnsafe(1_000),
        idle: DateTime.makeUnsafe(200),
        viewed: DateTime.makeUnsafe(150),
      })
      expect(messages).toMatchObject([
        { id: sourceMessageID, ...Expected.user("Imported message") },
        { id: errorMessageID, type: "compaction", error: { type: "test_error", message: "Original error" } },
      ])
      expect(yield* Bus.latestSequence(db, sessionID)).toBe(2)
      const exported = yield* transfer.export({ sessionID })
      expect(exported.info.time).toMatchObject({ idle: DateTime.makeUnsafe(200), viewed: DateTime.makeUnsafe(150) })
      expect(exported.messages).toEqual(messages)
      const sanitized = yield* transfer.export({ sessionID, sanitize: true })
      expect(sanitized.info.time).toMatchObject({ idle: DateTime.makeUnsafe(200), viewed: DateTime.makeUnsafe(150) })
      expect(sanitized.info.metadata).toEqual({ redacted: `session-metadata:${sessionID}` })
      expect(sanitized.messages).toMatchObject([
        {
          id: sourceMessageID,
          text: `[redacted:text:${sourceMessageID}]`,
          skills: [{ id: "effect", name: "[redacted:skill-name:0]", text: "[redacted:skill:0]" }],
        },
        { id: errorMessageID, error: { type: "test_error", message: "Original error" } },
      ])

      yield* session.prompt({ sessionID, text: "Continue", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      expect((yield* session.messages({ sessionID, order: "asc" })).map((message) => message.type)).toEqual([
        "user",
        "compaction",
        "user",
      ])
      expect(yield* Bus.latestSequence(db, sessionID)).toBe(4)
    }),
  )

  it.effect("rejects an existing session ID without changing its transcript", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const existing = yield* session.create({ location, title: "Existing" })
      const exit = yield* Effect.exit(transfer.import({ data: { info: existing, messages: [] }, location }))

      expect(exit._tag).toBe("Failure")
      expect((yield* session.get(existing.id)).title).toBe("Existing")
      expect(yield* session.messages({ sessionID: existing.id })).toEqual([])
    }),
  )

  it.effect("clamps an imported viewed watermark to its idle transition", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const transfer = yield* SessionTransfer.Service
      const template = yield* session.create({ location })
      const imported = yield* transfer.import({
        data: {
          info: {
            ...template,
            id: Session.ID.create(),
            outcome: "succeeded",
            time: {
              ...template.time,
              idle: DateTime.makeUnsafe(200),
              viewed: DateTime.makeUnsafe(250),
            },
          },
          messages: [],
        },
        location,
      })

      expect(imported.time).toMatchObject({ idle: DateTime.makeUnsafe(200), viewed: DateTime.makeUnsafe(200) })
      expect(imported.outcome).toBe("succeeded")
    }),
  )
})
