import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { WorkPresetTool } from "@aigcfroge/core/tool/work-preset"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool, toolDefinitions } from "./lib/tool"
import { SessionV2 } from "@aigcfroge/core/session"

const sessionID = SessionV2.ID.make("ses_work_preset_tool_test")
const registry = ToolRegistry.defaultLayer
const tool = WorkPresetTool.layer.pipe(Layer.provide(registry))
const it = testEffect(Layer.mergeAll(registry, tool))

describe("WorkPresetTool", () => {
  it.effect("registers the work-preset tool", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual(["work-preset"])
    }),
  )

  it.effect("returns preset guidance and questions for a known preset id", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-work-preset",
          name: "work-preset",
          input: { presetID: "storyboard-video" },
        },
      })
      expect(result.result.type).toBe("text")
      const text = result.result.value
      expect(text).toContain("视频分镜脚本")
      expect(text).toContain("视频主题")
    }),
  )

  it.effect("fails with a typed error for an unknown preset id", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-work-preset",
          name: "work-preset",
          input: { presetID: "no-such-preset" },
        },
      })
      expect(result.result.type).toBe("error")
    }),
  )
})
