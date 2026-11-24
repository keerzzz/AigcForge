import { describe, expect } from "bun:test"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@omnixa/core/agent"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { MetaAgentMemory } from "@omnixa/core/agent/meta/memory"
import { MetaAgentMemoryTable, MetaAgentSessionTable, MetaAgentTable } from "@omnixa/core/meta-agent/sql"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Image } from "@omnixa/core/image"
import { Location } from "@omnixa/core/location"
import { Permission } from "@omnixa/core/permission"
import { ApprovalPresence } from "@omnixa/core/permission/approval-presence"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionSchema } from "@omnixa/core/session/schema"
import { SessionTable } from "@omnixa/core/session/sql"
import { Tool } from "@omnixa/core/tool"
import { MemoryTool } from "@omnixa/core/tool/memory"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_memory_tool")

const imageLayer = Layer.mock(Image.Service, {
  normalize: (_resource, content) => Effect.succeed(content),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [
  Image.node.replace(imageLayer),
])

const locationStore = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("/project"),
    project: {
      id: Project.ID.make("proj_memory_tool"),
      directory: AbsolutePath.make("/project"),
      canonical: AbsolutePath.make("/project"),
    },
  }),
)

const authorized: Permission.AssertInput[] = []
const routingPermission = Layer.mock(Permission.Service, {
  assert: (input) =>
    Effect.sync(() => {
      authorized.push(input)
    }),
})
const harness = (memory: Layer.Layer<MetaAgentMemory.Service>) =>
  Layer.mergeAll(registryLayer, locationStore, memory, routingPermission)

const recorded: MetaAgentMemory.RecordInput[] = []
const searched: MetaAgentMemory.SearchInput[] = []
const memory = Layer.mock(MetaAgentMemory.Service, {
  record: (input) =>
    Effect.sync(() => {
      recorded.push(input)
      return "mem_tool_1"
    }),
  query: () => Effect.succeed([]),
  search: (input) =>
    Effect.sync(() => {
      searched.push(input)
      return []
    }),
  remove: () => Effect.void,
})

const it = testEffect(harness(memory))

describe("MemoryTool", () => {
  it.effect("memory_record executes and routes the project from the location", () =>
    Effect.gen(function* () {
      recorded.length = 0
      authorized.length = 0
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mem_record",
          name: "memory_record",
          input: { fact_category: "protocol", content: "Never run tests from repo root" },
        },
      })
      expect(result.status).toBe("completed")
      expect(result.content).toEqual([{ type: "text", text: "Recorded memory fact mem_tool_1" }])
      expect(recorded.length).toBe(1)
      expect(recorded[0]).toMatchObject({
        sessionID,
        projectID: Project.ID.make("proj_memory_tool"),
        factCategory: "protocol",
        content: "Never run tests from repo root",
      })
      expect(authorized).toEqual([
        {
          action: "memory_record",
          resources: ["proj_memory_tool"],
          sessionID,
          agent: toolIdentity.agent,
          source: { type: "tool", messageID: toolIdentity.messageID, id: "call_mem_record" },
        },
      ])
    }),
  )

  it.effect("memory_record rejects invalid input through the input schema", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mem_bad",
          name: "memory_record",
          input: { fact_category: "not-a-category", content: "x" },
        },
      })
      expect(result.status).toBe("error")
    }),
  )

  it.effect("memory_record rejects content that exceeds the distilled-fact length cap", () =>
    Effect.gen(function* () {
      recorded.length = 0
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mem_long",
          name: "memory_record",
          input: { fact_category: "code_trap", content: "x".repeat(2001) },
        },
      })
      expect(result.status).toBe("error")
      expect(recorded.length).toBe(0)
    }),
  )

  it.effect("memory_search executes with the keyword", () =>
    Effect.gen(function* () {
      searched.length = 0
      authorized.length = 0
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mem_search",
          name: "memory_search",
          input: { keyword: "typecheck" },
        },
      })
      expect(result.status).toBe("completed")
      expect(result.content).toEqual([{ type: "text", text: "No matching memory facts." }])
      expect(searched.length).toBe(1)
      expect(searched[0]).toMatchObject({
        projectID: Project.ID.make("proj_memory_tool"),
        keyword: "typecheck",
      })
      expect(authorized).toEqual([
        {
          action: "memory_search",
          resources: ["proj_memory_tool"],
          sessionID,
          agent: toolIdentity.agent,
          source: { type: "tool", messageID: toolIdentity.messageID, id: "call_mem_search" },
        },
      ])
    }),
  )

  it.effect("registers under memory_record/memory_search permission actions", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const all = yield* toolDefinitions(registry)
      expect(all.some((definition) => definition.name === "memory_record")).toBe(true)
      expect(all.some((definition) => definition.name === "memory_search")).toBe(true)
      const filtered = yield* toolDefinitions(registry, [{ action: "memory_record", resource: "*", effect: "deny" }])
      expect(filtered.some((definition) => definition.name === "memory_record")).toBe(false)
      expect(filtered.some((definition) => definition.name === "memory_search")).toBe(true)
    }),
  )
})

const realAuthorization = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      Permission.node,
      MetaAgentMemory.node,
      Database.node,
      Agent.node,
      Bus.node,
      ApprovalPresence.node,
      Location.node,
    ]),
    [Location.node.replace(locationStore), Image.node.replace(imageLayer)],
  ),
)

const setupAuthorization = Effect.fnUntraced(function* (rules: Permission.Ruleset) {
  const db = (yield* Database.Service).db
  const location = yield* Location.Service
  const agents = yield* Agent.Service
  const memory = yield* MetaAgentMemory.Service
  const registry = yield* Tool.Service
  const permission = yield* Permission.Service
  const now = DateTime.toEpochMillis(yield* DateTime.now)
  const metaID = MetaAgent.ID.descending("mag_memory_authorization")
  yield* db.insert(ProjectTable).values({ id: location.project.id, worktree: location.directory, sandboxes: [] }).run()
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: location.project.id,
      directory: location.directory,
      slug: sessionID,
      title: "Memory authorization",
      version: "keeper",
      mode: "work",
      agent: "meta",
      attended: null,
    })
    .run()
  yield* db
    .insert(MetaAgentTable)
    .values({
      id: metaID,
      title: "Memory authorization",
      agent: "meta",
      model: { providerID: "fixture", id: "fixture" },
      time_created: now,
      time_updated: now,
    })
    .run()
  yield* db
    .insert(MetaAgentSessionTable)
    .values({
      meta_agent_id: metaID,
      session_id: sessionID,
      role: "orchestrator",
      time_created: now,
    })
    .run()
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("meta"), (agent) => {
      agent.permissions = [...rules]
    }),
  )
  yield* registerToolPlugin(MemoryTool.Plugin)
  return { memory, registry, permission, agents, location }
})

const memoryCall = (name: "memory_record" | "memory_search", id = name) => ({
  sessionID,
  ...toolIdentity,
  agent: Agent.ID.make("meta"),
  call: {
    type: "tool-call" as const,
    id,
    name,
    input:
      name === "memory_record"
        ? { fact_category: "api", content: "MC03 project fact" }
        : { keyword: "MC03 project fact" },
  },
})

const requestApproval = Effect.fnUntraced(function* (
  registry: Tool.Interface,
  call: Parameters<Tool.Snapshot["execute"]>[0] = memoryCall("memory_record"),
) {
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
  const fiber = yield* executeTool(registry, call).pipe(Effect.forkIn(yield* Effect.scope))
  const request = yield* awaitWithTimeout(Deferred.await(asked), "Memory tool did not request permission")
  return { fiber, request }
})

realAuthorization.live("queries and deletes through the registered current-project tools", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_*", resource: "*", effect: "allow" }])
    const foreignProject = Project.ID.make("proj_foreign_memory")
    const foreign = yield* seed.memory.record({
      sessionID,
      projectID: foreignProject,
      factCategory: "api",
      content: "foreign",
    })
    const owned = yield* seed.memory.record({
      sessionID,
      projectID: seed.location.project.id,
      factCategory: "protocol",
      content: "owned",
    })
    const query = yield* executeTool(seed.registry, {
      sessionID,
      ...toolIdentity,
      agent: Agent.ID.make("meta"),
      call: { type: "tool-call", id: "query", name: "memory_query", input: { fact_category: "protocol" } },
    })
    expect(query.status).toBe("completed")
    expect(query.content).toEqual([{ type: "text", text: `[protocol] ${owned}: owned` }])
    expect(Schema.decodeUnknownSync(MemoryTool.SearchOutput)(query.output).records).toMatchObject([
      { id: owned, content: "owned" },
    ])
    for (const id of [foreign, owned, owned, "missing"]) {
      const result = yield* executeTool(seed.registry, {
        sessionID,
        ...toolIdentity,
        agent: Agent.ID.make("meta"),
        call: { type: "tool-call", id: `delete-${id}`, name: "memory_delete", input: { id } },
      })
      expect(result.status).toBe("completed")
      expect(Schema.decodeUnknownSync(MemoryTool.RecordOutput)(result.output)).toEqual({ id })
      expect(result.content).toEqual([
        { type: "text", text: "Processed the memory deletion request for this project." },
      ])
    }
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
    expect((yield* seed.memory.query({ projectID: foreignProject })).map((fact) => fact.id)).toEqual([foreign])
  }),
)

realAuthorization.live("waits for default Build deletion approval before changing project facts", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([])
    yield* seed.agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
    const db = (yield* Database.Service).db
    yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, sessionID)).run()
    const id = yield* seed.memory.record({
      sessionID,
      projectID: seed.location.project.id,
      factCategory: "api",
      content: "approved deletion",
    })
    const approval = yield* requestApproval(seed.registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "default-delete", name: "memory_delete", input: { id } },
    })
    expect(approval.request).toMatchObject({
      action: "memory_delete",
      resources: [seed.location.project.id],
      sessionID,
      source: { type: "tool", messageID: toolIdentity.messageID, id: "default-delete" },
    })
    expect((yield* seed.memory.query({ projectID: seed.location.project.id })).map((fact) => fact.id)).toEqual([id])
    yield* seed.permission.reply({ requestID: approval.request.id, reply: "once" })
    expect((yield* awaitWithTimeout(Fiber.join(approval.fiber), "Approved deletion did not settle")).status).toBe(
      "completed",
    )
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
  }),
)

for (const name of ["memory_query", "memory_delete"] as const) {
  realAuthorization.live(`retains current project denial on captured ${name}`, () =>
    Effect.gen(function* () {
      const seed = yield* setupAuthorization([{ action: "memory_*", resource: "*", effect: "allow" }])
      const id = yield* seed.memory.record({
        sessionID,
        projectID: seed.location.project.id,
        factCategory: "api",
        content: "retained",
      })
      const captured = yield* seed.registry.snapshot()
      yield* seed.agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions.push({ action: name, resource: seed.location.project.id, effect: "deny" })
        }),
      )
      const result = yield* Effect.exit(
        captured.execute({
          sessionID,
          ...toolIdentity,
          agent: Agent.ID.make("meta"),
          call: { type: "tool-call", id: name, name, input: name === "memory_delete" ? { id } : {} },
        }),
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* seed.memory.query({ projectID: seed.location.project.id })).map((fact) => fact.id)).toEqual([id])
    }),
  )

  for (const disposition of ["once", "reject", "cancel"] as const) {
    realAuthorization.live(`settles ${name} permission ${disposition} without bypassing its leaf`, () =>
      Effect.gen(function* () {
        const seed = yield* setupAuthorization([{ action: name, resource: "*", effect: "ask" }])
        const id = yield* seed.memory.record({
          sessionID,
          projectID: seed.location.project.id,
          factCategory: "api",
          content: "pending fact",
        })
        const approval = yield* requestApproval(seed.registry, {
          sessionID,
          ...toolIdentity,
          agent: Agent.ID.make("meta"),
          call: { type: "tool-call", id: name, name, input: name === "memory_delete" ? { id } : {} },
        })
        expect(approval.request).toMatchObject({
          action: name,
          resources: [seed.location.project.id],
          source: { type: "tool", messageID: toolIdentity.messageID, id: name },
        })
        expect((yield* seed.memory.query({ projectID: seed.location.project.id })).map((fact) => fact.id)).toEqual([id])
        if (disposition === "cancel") yield* Fiber.interrupt(approval.fiber)
        if (disposition !== "cancel")
          yield* seed.permission.reply({ requestID: approval.request.id, reply: disposition })
        const exit = yield* awaitWithTimeout(Fiber.await(approval.fiber), "Memory approval did not settle")
        if (disposition === "once") {
          expect(Exit.isSuccess(exit) && exit.value.status).toBe("completed")
          if (name === "memory_query" && Exit.isSuccess(exit)) {
            expect(Schema.decodeUnknownSync(MemoryTool.SearchOutput)(exit.value.output).records).toMatchObject([
              { id, content: "pending fact" },
            ])
          }
        }
        if (disposition === "reject")
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeclinedError)
        if (disposition === "cancel") expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
        expect(yield* seed.permission.forSession(sessionID)).toEqual([])
        expect((yield* seed.memory.query({ projectID: seed.location.project.id })).map((fact) => fact.id)).toEqual(
          name === "memory_delete" && disposition === "once" ? [] : [id],
        )
      }),
    )
  }
}

realAuthorization.live("rejects unsafe legacy fact copies through public memory readers", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_*", resource: "*", effect: "allow" }])
    const id = yield* seed.memory.record({
      sessionID,
      projectID: seed.location.project.id,
      factCategory: "api",
      content: "safe",
    })
    const db = (yield* Database.Service).db
    for (const content of ["api_key=MC03_LEGACY_PUBLIC_FIXTURE", "x".repeat(2001)]) {
      yield* db.update(MetaAgentMemoryTable).set({ content }).where(eq(MetaAgentMemoryTable.id, id)).run()
      for (const name of ["memory_search", "memory_query"]) {
        const result = yield* executeTool(seed.registry, {
          sessionID,
          ...toolIdentity,
          agent: Agent.ID.make("meta"),
          call: { type: "tool-call", id: name, name, input: name === "memory_search" ? { keyword: "" } : {} },
        })
        expect(result.status).toBe("error")
        expect(result.error?.message).toContain(`Project memory fact ${id} cannot be copied into model data`)
        expect(result.error?.message).not.toContain(content)
        expect(result.output).toBeUndefined()
        expect(result.content).toBeUndefined()
      }
      expect((yield* seed.memory.query({ projectID: seed.location.project.id }))[0]?.content).toBe(content)
    }
  }),
)

for (const name of ["memory_record", "memory_search"] as const) {
  realAuthorization.live(`enforces current project denial on captured ${name}`, () =>
    Effect.gen(function* () {
      const seed = yield* setupAuthorization([{ action: "memory_*", resource: "*", effect: "allow" }])
      const captured = yield* seed.registry.snapshot()
      expect(captured.definitions.some((tool) => tool.name === name)).toBe(true)
      yield* seed.agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions.push({ action: name, resource: seed.location.project.id, effect: "deny" })
        }),
      )
      const result = yield* Effect.exit(captured.execute(memoryCall(name)))
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
    }),
  )
}

realAuthorization.live("returns controlled ownership rejection through authorized memory_record", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_record", resource: "*", effect: "allow" }])
    const db = (yield* Database.Service).db
    const metaID = MetaAgent.ID.descending("mag_memory_authorization")
    yield* db
      .update(SessionTable)
      .set({
        controller: new SessionSchema.RootController({ kind: "root", metaAgentID: metaID, rootSessionID: sessionID }),
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
    yield* db
      .update(MetaAgentSessionTable)
      .set({ role: "worker" })
      .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
      .run()
    const result = yield* executeTool(seed.registry, memoryCall("memory_record"))
    expect(result.status).toBe("error")
    expect(result.error?.message).toBe("Meta ownership or first binding is missing or inconsistent")
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toHaveLength(0)
  }),
)

realAuthorization.live("rejects credential content through authorized memory_record", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_record", resource: "*", effect: "allow" }])
    const call = memoryCall("memory_record")
    const result = yield* executeTool(seed.registry, {
      ...call,
      call: { ...call.call, input: { fact_category: "api", content: "api_key=MC03_PUBLIC_SENTINEL" } },
    })
    const rows = yield* seed.memory.query({ projectID: seed.location.project.id })
    expect(rows.length).toBe(0)
    expect(result.status).toBe("error")
    expect(result.error?.message).toBe("Project memory facts cannot contain credential material.")
    expect(result.error?.message).not.toContain("MC03_PUBLIC_SENTINEL")
  }),
)

realAuthorization.live("waits for real project approval before recording and permits subsequent search", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([
      { action: "memory_record", resource: "*", effect: "ask" },
      { action: "memory_search", resource: "*", effect: "allow" },
    ])
    const approval = yield* requestApproval(seed.registry)
    expect(approval.request).toMatchObject({
      action: "memory_record",
      resources: [seed.location.project.id],
      sessionID,
      source: { type: "tool", messageID: toolIdentity.messageID, id: "memory_record" },
    })
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
    yield* seed.permission.reply({ requestID: approval.request.id, reply: "once" })
    const recorded = yield* awaitWithTimeout(Fiber.join(approval.fiber), "Approved memory record did not settle")
    expect(recorded.status).toBe("completed")
    const records = yield* seed.memory.query({ projectID: seed.location.project.id })
    expect(records).toHaveLength(1)
    expect(records[0]?.content).toBe("MC03 project fact")
    const searched = yield* executeTool(seed.registry, memoryCall("memory_search"))
    expect(searched.status).toBe("completed")
    expect(Schema.decodeUnknownSync(MemoryTool.SearchOutput)(searched.output).records).toMatchObject([
      { id: records[0]?.id, content: "MC03 project fact" },
    ])
  }),
)

realAuthorization.live("rejects real memory approval without persisting a fact", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_record", resource: "*", effect: "ask" }])
    const approval = yield* requestApproval(seed.registry)
    yield* seed.permission.reply({ requestID: approval.request.id, reply: "reject" })
    const exit = yield* awaitWithTimeout(Fiber.await(approval.fiber), "Declined memory record did not settle")
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeclinedError)
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
  }),
)

realAuthorization.live("interrupts waiting memory approval without recording a fact", () =>
  Effect.gen(function* () {
    const seed = yield* setupAuthorization([{ action: "memory_record", resource: "*", effect: "ask" }])
    const approval = yield* requestApproval(seed.registry)
    yield* Fiber.interrupt(approval.fiber)
    const exit = yield* awaitWithTimeout(Fiber.await(approval.fiber), "Interrupted memory record did not settle")
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(yield* seed.permission.forSession(sessionID)).toEqual([])
    expect(yield* seed.memory.query({ projectID: seed.location.project.id })).toEqual([])
  }),
)

describe("MemoryTool failures", () => {
  const failingMemory = Layer.mock(MetaAgentMemory.Service, {
    record: () =>
      Effect.fail(new MetaAgentMemory.NotMetaSessionError({ sessionID: Session.ID.make("ses_unattached") })),
    query: () => Effect.succeed([]),
    search: () => Effect.succeed([]),
    remove: () => Effect.void,
  })
  const failing = testEffect(harness(failingMemory))

  failing.effect("surfaces service failures as a ToolFailure result", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(MemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call_mem_fail",
          name: "memory_record",
          input: { fact_category: "api", content: "x" },
        },
      })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("meta agent")
    }),
  )
})
