/**
 * Phase 2 RED tests: Task Tool integration with persistent Delegation.
 *
 * These tests call the real TaskTool entrypoint. The Phase 2-only input fields
 * are represented by an explicit test contract intersection until the
 * production input schema owns them; no unchecked cast is used to smuggle
 * fields into execute().
 */

import { afterEach, describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@aigcfroge/core/delegation/sql"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { SessionTask } from "@aigcfroge/core/session/task"
import type { SessionPrompt } from "@/session/prompt"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Parameters, TaskTool, type TaskPromptOps } from "@/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { defaultLayer as adapterRegistryLayer } from "@/agent/meta/adapters/registry"
import { disposeAllInstances } from "./fixture/fixture"
import { testEffect } from "./lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

type Phase2TaskInput = Schema.Schema.Type<typeof Parameters> & {
  readonly delegation_id?: string
  readonly new_delegation?: boolean
}

const phase2Input = (input: Phase2TaskInput): Phase2TaskInput => input
const decodeRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))

function assertDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined()
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    adapterRegistryLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    DelegationService.defaultLayer,
    SessionTask.defaultLayer,
    RuntimeFlags.layer({ experimentalPersistentDelegations: true, ...flags }),
  ).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer())
const backgroundIt = testEffect(layer({ experimentalBackgroundSubagents: true }))
const flagOffIt = testEffect(layer({ experimentalPersistentDelegations: false }))
const productionIt = testEffect(ToolRegistry.defaultLayer.pipe(Layer.provide(Ripgrep.defaultLayer)))

const seed = Effect.fn("DelegationTaskTest.seed")(function* (title = "Delegation Parent") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: {
  text?: string
  started?: Deferred.Deferred<void>
  release?: Deferred.Deferred<void>
  onPrompt?: (input: SessionPrompt.PromptInput) => void
}): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.gen(function* () {
        opts?.onPrompt?.(input)
        if (opts?.started) yield* Deferred.succeed(opts.started, undefined)
        if (opts?.release) yield* Deferred.await(opts.release)
        const id = MessageID.ascending()
        return {
          info: {
            id,
            role: "assistant" as const,
            parentID: input.messageID ?? MessageID.ascending(),
            sessionID: input.sessionID,
            mode: input.agent ?? "build",
            agent: input.agent ?? "build",
            cost: 0,
            path: { cwd: "/tmp", root: "/tmp" },
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ref.modelID,
            providerID: ref.providerID,
            variant: "xhigh",
            time: { created: Date.now() },
          },
          parts: [
            {
              id: PartID.ascending(),
              sessionID: input.sessionID,
              messageID: id,
              type: "text" as const,
              text: opts?.text ?? "done",
            },
          ],
        }
      }),
  }
}

describe("Delegation Task Tool Integration (Phase 2 RED)", () => {
  productionIt.instance("production ToolRegistry composes the task tool with delegation owners", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect((yield* registry.named()).task.id).toBe("task")
    }),
  )

  it.instance("1. first task dispatch creates Delegation, Build participant, and child Session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seenPrompt: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({
        text: "initial build result",
        onPrompt: (input) => (seenPrompt = input),
      })

      const result = yield* def.execute(
        phase2Input({
          description: "build feature",
          prompt: "implement feature A",
          subagent_type: "general",
        }),
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const metadata = decodeRecord(result.metadata)
      expect(result).toBeDefined()
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
      expect(metadata.delegationID).toBeDefined()
      expect(metadata.turnID).toBeDefined()
      expect(metadata.participantID).toBeDefined()
      expect(metadata.deliveryID).toBeUndefined()
      const metadataTurnID = stringField(metadata, "turnID")
      const metadataParticipantID = stringField(metadata, "participantID")
      assertDefined(metadataTurnID)
      assertDefined(metadataParticipantID)
      expect(seenPrompt?.delegationOrigin?.turnID).toBeDefined()
      expect(String(seenPrompt?.delegationOrigin?.turnID)).toBe(metadataTurnID)
      expect(seenPrompt?.delegationOrigin?.deliveryOrigin).toBe("meta")
      expect(seenPrompt?.delegationOrigin?.senderParticipantID).toBeDefined()
      expect(String(seenPrompt?.delegationOrigin?.senderParticipantID)).toBe(metadataParticipantID)

      const delegations = yield* db.select().from(DelegationTable).where(eq(DelegationTable.parent_session_id, chat.id))
      expect(delegations).toHaveLength(1)
      const participants = yield* db
        .select()
        .from(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.delegation_id, delegations[0].id))
      expect(participants).toHaveLength(1)
      const childSessionID = (yield* sessions.children(chat.id))[0]?.id
      expect(participants[0]?.child_session_id).toBe(childSessionID)
      const linkedTasks = yield* (yield* SessionTask.Service).get(chat.id)
      expect(linkedTasks).toHaveLength(1)
      expect(linkedTasks[0]?.status).toBe("completed")
      expect(linkedTasks[0]?.outputDigest).toBe(childSessionID)
    }),
  )

  it.instance("missing prompt runtime fails before creating delegation side effects", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          phase2Input({
            description: "missing runtime",
            prompt: "must not be admitted",
            subagent_type: "general",
          }),
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: {},
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* (yield* SessionTask.Service).get(chat.id)).toHaveLength(0)
      expect(
        yield* db.select().from(DelegationTable).where(eq(DelegationTable.parent_session_id, chat.id)),
      ).toHaveLength(0)
    }),
  )

  it.instance("2. second task dispatch without delegation_id reuses the active Delegation and child Session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps({ text: "second build result" })

      const execute = (description: string, prompt: string) =>
        def.execute(phase2Input({ description, prompt, subagent_type: "general" }), {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })

      const result1 = yield* execute("step 1", "do step 1")
      const result2 = yield* execute("step 2", "do step 2")
      const metadata1 = decodeRecord(result1.metadata)
      const metadata2 = decodeRecord(result2.metadata)

      expect(metadata1.delegationID).toBeDefined()
      expect(metadata2.delegationID).toBe(metadata1.delegationID)
      expect(metadata2.turnID).not.toBe(metadata1.turnID)
      expect(yield* sessions.children(chat.id)).toHaveLength(1)

      const delegations = yield* db.select().from(DelegationTable).where(eq(DelegationTable.parent_session_id, chat.id))
      expect(delegations).toHaveLength(1)
      const turns = yield* db
        .select()
        .from(DelegationTurnTable)
        .where(eq(DelegationTurnTable.delegation_id, delegations[0].id))
      expect(turns).toHaveLength(2)
    }),
  )

  it.instance("concurrent first dispatches share one Delegation participant and child Session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const execute = (description: string) =>
        def.execute(
          phase2Input({
            description,
            prompt: `run ${description}`,
            subagent_type: "general",
          }),
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps({ text: `${description} done` }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

      const results = yield* Effect.all([execute("concurrent one"), execute("concurrent two")], {
        concurrency: "unbounded",
      })
      const metadata = results.map((result) => decodeRecord(result.metadata))
      expect(new Set(metadata.map((entry) => entry.delegationID)).size).toBe(1)
      expect(new Set(metadata.map((entry) => entry.participantID)).size).toBe(1)
      expect(new Set(metadata.map((entry) => entry.sessionId)).size).toBe(1)
      expect(new Set(metadata.map((entry) => entry.turnID)).size).toBe(2)
      expect(yield* sessions.children(chat.id)).toHaveLength(1)

      const delegations = yield* db.select().from(DelegationTable).where(eq(DelegationTable.parent_session_id, chat.id))
      expect(delegations).toHaveLength(1)
      const participants = yield* db
        .select()
        .from(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.delegation_id, delegations[0].id))
      expect(participants).toHaveLength(1)
      const turns = yield* db
        .select()
        .from(DelegationTurnTable)
        .where(eq(DelegationTurnTable.delegation_id, delegations[0].id))
      expect(turns.map((turn) => turn.seq).sort((left, right) => left - right)).toEqual([1, 2])
    }),
  )

  it.instance("3. explicit delegation_id not owned by the parent is rejected fail-closed", () =>
    Effect.gen(function* () {
      const delegation = yield* DelegationService.Service
      const { chat: foreignParent } = yield* seed("Parent A")
      const { chat, assistant } = yield* seed("Parent B")
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const foreignDelegationID = (yield* delegation.create({ parentSessionID: foreignParent.id, title: "Foreign" })).id
      const exit = yield* def
        .execute(
          phase2Input({
            description: "hijack attempt",
            prompt: "attempting to reuse a foreign delegation",
            subagent_type: "general",
            delegation_id: foreignDelegationID,
          }),
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(foreignDelegationID).toBeDefined()
    }),
  )

  it.instance("4. explicit Delegation routing keeps coexisting Delegations isolated", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps({ text: "done" })
      const execute = (input: Phase2TaskInput) =>
        def.execute(input, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })

      const result1 = yield* execute(
        phase2Input({
          description: "delegation 1",
          prompt: "work on branch 1",
          subagent_type: "general",
          new_delegation: true,
        }),
      )
      const result2 = yield* execute(
        phase2Input({
          description: "delegation 2",
          prompt: "work on branch 2",
          subagent_type: "general",
          new_delegation: true,
        }),
      )
      const metadata1 = decodeRecord(result1.metadata)
      const metadata2 = decodeRecord(result2.metadata)
      const delegationID1 = stringField(metadata1, "delegationID")
      const delegationID2 = stringField(metadata2, "delegationID")
      expect(delegationID1).toBeDefined()
      expect(delegationID2).toBeDefined()
      assertDefined(delegationID1)
      assertDefined(delegationID2)
      const id1 = DelegationID.ID.make(delegationID1)
      const id2 = DelegationID.ID.make(delegationID2)
      expect(id1).not.toBe(id2)

      const childSessionID2 = stringField(metadata2, "sessionId")
      expect(childSessionID2).toBeDefined()
      assertDefined(childSessionID2)
      const hijack = yield* execute(
        phase2Input({
          description: "cross-delegation hijack",
          prompt: "reuse delegation 2 child in delegation 1",
          subagent_type: "general",
          delegation_id: id1,
          task_id: childSessionID2,
        }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(hijack)).toBe(true)

      yield* execute(
        phase2Input({
          description: "turn for delegation 1",
          prompt: "continue branch 1",
          subagent_type: "general",
          delegation_id: id1,
        }),
      )

      const turns1 = yield* db.select().from(DelegationTurnTable).where(eq(DelegationTurnTable.delegation_id, id1))
      const turns2 = yield* db.select().from(DelegationTurnTable).where(eq(DelegationTurnTable.delegation_id, id2))
      expect(turns1).toHaveLength(2)
      expect(turns2).toHaveLength(1)
    }),
  )

  it.instance("5. TaskTool output exposes delegationID and turnID without deliveryID", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const result = yield* def.execute(
        phase2Input({
          description: "contract task",
          prompt: "run contract check",
          subagent_type: "general",
        }),
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "output contract check" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      const metadata = decodeRecord(result.metadata)
      expect(metadata.delegationID).toBeDefined()
      expect(metadata.turnID).toBeDefined()
      expect(metadata.participantID).toBeDefined()
      expect(metadata.deliveryID).toBeUndefined()
    }),
  )

  backgroundIt.instance("6. settled background dispatch reuses the child Session and settles compatibility tasks", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const sessions = yield* Session.Service
      const background = yield* BackgroundJob.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps: stubOps({ text: "bg done" }) },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const first = yield* def.execute(
        phase2Input({
          description: "async task",
          prompt: "run long job",
          subagent_type: "general",
          background: true,
        }),
        context,
      )
      const firstMetadata = decodeRecord(first.metadata)
      const childSessionID = stringField(firstMetadata, "sessionId")
      expect(first.output).toContain("background")
      expect(childSessionID).toBeDefined()
      assertDefined(childSessionID)
      expect((yield* background.wait({ id: childSessionID })).info?.status).toBe("completed")

      const second = yield* def.execute(
        phase2Input({
          description: "async continuation",
          prompt: "continue the child job",
          subagent_type: "general",
          task_id: childSessionID,
          background: true,
        }),
        context,
      )
      expect(second.output).toContain("background")
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
      expect((yield* background.wait({ id: childSessionID })).info?.status).toBe("completed")

      expect(firstMetadata.delegationID).toBeDefined()
      expect(firstMetadata.deliveryID).toBeUndefined()
      expect(decodeRecord(second.metadata).deliveryID).toBeUndefined()
      const linkedTasks = yield* (yield* SessionTask.Service).get(chat.id)
      expect(linkedTasks).toHaveLength(2)
      expect(linkedTasks.every((task) => task.status === "completed")).toBe(true)
      expect(linkedTasks.every((task) => task.outputDigest === childSessionID)).toBe(true)
    }),
  )

  backgroundIt.instance("background cancellation settles the compatibility task as cancelled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const background = yield* BackgroundJob.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()

      const result = yield* def.execute(
        phase2Input({
          description: "cancelled task",
          prompt: "wait until cancelled",
          subagent_type: "general",
          background: true,
        }),
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ started, release }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      const childSessionID = stringField(decodeRecord(result.metadata), "sessionId")
      expect(childSessionID).toBeDefined()
      assertDefined(childSessionID)
      yield* Deferred.await(started)
      expect((yield* background.cancel(childSessionID))?.status).toBe("cancelled")

      const linkedTasks = yield* (yield* SessionTask.Service).get(chat.id)
      expect(linkedTasks).toHaveLength(1)
      expect(linkedTasks[0]?.status).toBe("cancelled")
    }),
  )

  flagOffIt.instance("7. flag-off retains 100% legacy behavior without delegation side-effects", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed("Legacy Parent")
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps({ text: "legacy result" })
      expect("delegation_id" in def.parameters.fields).toBe(false)
      expect("new_delegation" in def.parameters.fields).toBe(false)
      expect(def.jsonSchema?.properties?.delegation_id).toBeUndefined()
      expect(def.jsonSchema?.properties?.new_delegation).toBeUndefined()

      const result = yield* def.execute(
        phase2Input({
          description: "legacy task",
          prompt: "do legacy work",
          subagent_type: "general",
        }),
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const metadata = decodeRecord(result.metadata)
      expect(result).toBeDefined()
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
      expect(metadata.delegationID).toBeUndefined()
      expect(metadata.turnID).toBeUndefined()
      expect(metadata.participantID).toBeUndefined()

      const delegations = yield* db.select().from(DelegationTable).where(eq(DelegationTable.parent_session_id, chat.id))
      expect(delegations).toHaveLength(0)
      expect(yield* (yield* SessionTask.Service).get(chat.id)).toHaveLength(0)
    }),
  )
})
