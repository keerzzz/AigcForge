import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@aigcfroge/core/session"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { Tool } from "@aigcfroge/core/tool"
import { ProposeMemoryTool } from "@aigcfroge/core/tool/propose-memory"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity, type ToolExecution } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const sessionID = Session.ID.make("ses_memory_tool_test")

const it = testEffect(PersonalMemory.layer.pipe(Layer.provideMerge(PluginTestLayer)))

const textOf = (result: ToolExecution) =>
  result.content?.map((item) => (item.type === "text" ? item.text : "")).join("") ?? ""

describe("propose_memory tool", () => {
  it.effect("registers memory_propose", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(ProposeMemoryTool.Plugin)
      const names = (yield* toolDefinitions(yield* Tool.Service)).map((definition) => definition.name)
      expect(names).toContain("memory_propose")
    }),
  )

  it.effect("rejects high-sensitivity content (never stored, PRD §9)", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(ProposeMemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-memory-high",
          name: "memory_propose",
          input: {
            content: "password is hunter2",
            source: "explicit",
            trustLevel: "high",
            sensitivityLevel: "high",
          },
        },
      })
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("Sensitive information is never stored")
      // Nothing landed in the pending queue.
      const memories = yield* PersonalMemory.Service
      expect(yield* memories.listPending()).toHaveLength(0)
    }),
  )

  it.effect("proposes low-sensitivity content as a pending entry awaiting user confirmation", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(ProposeMemoryTool.Plugin)
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-memory-low",
          name: "memory_propose",
          input: {
            content: "User prefers concise answers",
            source: "explicit",
            trustLevel: "high",
            sensitivityLevel: "low",
          },
        },
      })
      expect(result.status).toBe("completed")
      expect(textOf(result)).toContain("Memory proposed")

      const memories = yield* PersonalMemory.Service
      const pending = yield* memories.listPending()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.status).toBe("pending")
      expect(pending[0]?.content).toBe("User prefers concise answers")
    }),
  )
})
