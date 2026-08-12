import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { SessionV2 } from "@aigcfroge/core/session"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { ProposeMemoryTool } from "@aigcfroge/core/tool/propose-memory"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_memory_tool_test")

const mockPermission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
})

const it = testEffect(
  ProposeMemoryTool.layer.pipe(
    Layer.provideMerge(PersonalMemory.layer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(ToolRegistry.defaultLayer),
    Layer.provideMerge(mockPermission),
  ),
)

describe("propose_memory tool", () => {
  it.effect("registers memory_propose", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const names = (yield* toolDefinitions(registry)).map((definition) => definition.name)
      expect(names).toContain("memory_propose")
    }),
  )

  it.effect("rejects high-sensitivity content (never stored, PRD §9)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
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
      expect(result.result.type).toBe("error")
      expect(result.result.value).toContain("Sensitive information is never stored")
      // Nothing landed in the pending queue.
      const memories = yield* PersonalMemory.Service
      expect(yield* memories.listPending()).toHaveLength(0)
    }),
  )

  it.effect("proposes low-sensitivity content as a pending entry awaiting user confirmation", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
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
      expect(result.result.type).toBe("text")
      expect(result.result.value).toContain("Memory proposed")

      const memories = yield* PersonalMemory.Service
      const pending = yield* memories.listPending()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.status).toBe("pending")
      expect(pending[0]?.content).toBe("User prefers concise answers")
    }),
  )
})
