import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "../src/agent"
import { MetaAgentMemory } from "../src/agent/meta/memory"
import { Location } from "../src/location"
import { ProjectV2 } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionMessage } from "../src/session/message"
import { ApplicationTools } from "../src/tool/application-tools"
import { ToolRegistry } from "../src/tool/registry"
import { Tools } from "../src/tool/tools"
import { ToolOutputStore } from "../src/tool-output-store"
import { MemoryTool } from "../src/tool/memory"
import { executeTool, toolDefinitions } from "./lib/tool"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_memory_tool")
const assistantMessageID = SessionMessage.ID.make("msg_memory_tool")

const location = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("/project"),
    project: { id: ProjectV2.ID.make("proj_memory_tool"), directory: AbsolutePath.make("/project") },
  }),
)

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

const registry = ToolRegistry.layer.pipe(
  Layer.provide(ToolOutputStore.defaultLayer),
  Layer.provide(ApplicationTools.layer),
)
const toolsRegister = Layer.effect(
  Tools.Service,
  ToolRegistry.Service.use((reg) => Effect.succeed(Tools.Service.of({ register: reg.register }))),
).pipe(Layer.provide(registry))
const memoryTool = MemoryTool.layer.pipe(Layer.provide(toolsRegister), Layer.provide(memory), Layer.provide(location))
const it = testEffect(Layer.mergeAll(registry, memoryTool))

describe("MemoryTool", () => {
  it.effect("memory_record executes and routes the project from the location", () =>
    Effect.gen(function* () {
      recorded.length = 0
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, {
        sessionID,
        agent: AgentV2.ID.make("build"),
        assistantMessageID,
        call: {
          type: "tool-call",
          id: "call_mem_record",
          name: "memory_record",
          input: { fact_category: "protocol", content: "Never run tests from repo root" },
        },
      })
      expect(result).toEqual({ type: "text", value: "Recorded memory fact mem_tool_1" })
      expect(recorded.length).toBe(1)
      expect(recorded[0]).toMatchObject({
        sessionID,
        projectID: ProjectV2.ID.make("proj_memory_tool"),
        factCategory: "protocol",
        content: "Never run tests from repo root",
      })
    }),
  )

  it.effect("memory_record rejects invalid input through the input schema", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, {
        sessionID,
        agent: AgentV2.ID.make("build"),
        assistantMessageID,
        call: {
          type: "tool-call",
          id: "call_mem_bad",
          name: "memory_record",
          input: { fact_category: "not-a-category", content: "x" },
        },
      })
      expect(result.type).toBe("error")
    }),
  )

  it.effect("memory_search executes with the keyword", () =>
    Effect.gen(function* () {
      searched.length = 0
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, {
        sessionID,
        agent: AgentV2.ID.make("build"),
        assistantMessageID,
        call: {
          type: "tool-call",
          id: "call_mem_search",
          name: "memory_search",
          input: { keyword: "typecheck" },
        },
      })
      expect(result).toEqual({ type: "text", value: "No matching memory facts." })
      expect(searched.length).toBe(1)
      expect(searched[0]).toMatchObject({
        projectID: ProjectV2.ID.make("proj_memory_tool"),
        keyword: "typecheck",
      })
    }),
  )

  it.effect("registers under memory_record/memory_search permission actions", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const all = yield* toolDefinitions(registry)
      expect(all.some((definition) => definition.name === "memory_record")).toBe(true)
      expect(all.some((definition) => definition.name === "memory_search")).toBe(true)
      const filtered = yield* toolDefinitions(registry, [
        { action: "memory_record", resource: "*", effect: "deny" },
      ])
      expect(filtered.some((definition) => definition.name === "memory_record")).toBe(false)
      expect(filtered.some((definition) => definition.name === "memory_search")).toBe(true)
    }),
  )
})

describe("MemoryTool failures", () => {
  const failingMemory = Layer.mock(MetaAgentMemory.Service, {
    record: () =>
      Effect.fail(
        new MetaAgentMemory.NotMetaSessionError({ sessionID: SessionV2.ID.make("ses_unattached") }),
      ),
    query: () => Effect.succeed([]),
    search: () => Effect.succeed([]),
    remove: () => Effect.void,
  })
  const failingTool = MemoryTool.layer.pipe(
    Layer.provide(toolsRegister),
    Layer.provide(failingMemory),
    Layer.provide(location),
  )
  const it = testEffect(Layer.mergeAll(registry, failingTool))

  it.effect("surfaces service failures as a ToolFailure result", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(registry, {
        sessionID,
        agent: AgentV2.ID.make("build"),
        assistantMessageID,
        call: {
          type: "tool-call",
          id: "call_mem_fail",
          name: "memory_record",
          input: { fact_category: "api", content: "x" },
        },
      })
      expect(result.type).toBe("error")
      expect("value" in result && String(result.value)).toContain("meta agent")
    }),
  )
})
