import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { QuestionV2 } from "@aigcfroge/core/question"
import { SessionV2 } from "@aigcfroge/core/session"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { WorkPresetTool } from "@aigcfroge/core/tool/work-preset"
import { QuestionTool } from "@aigcfroge/core/tool/question"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_work_clarify_e2e")
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    effectiveRules: () => Effect.succeed([]),
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer
const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: () => Effect.succeed([["写实"], ["60秒以内"], ["抖音/快手"], ["B站"], ["大学生"]]),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  Layer.mergeAll(
    registry,
    permission,
    question,
    WorkPresetTool.layer.pipe(Layer.provide(registry)),
    QuestionTool.layer.pipe(Layer.provide(registry), Layer.provide(permission), Layer.provide(question)),
  ),
)

describe("Work clarification closed loop", () => {
  it.effect("loads preset guidance then gathers answers via the question tool", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      const loaded = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-load-preset",
          name: "work-preset",
          input: { presetID: "storyboard-video" },
        },
      })
      expect(loaded.result.type).toBe("text")
      expect(loaded.result.value).toContain("视频分镜脚本")

      const answered = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-answer",
          name: "question",
          input: { questions: [{ question: "视频主题是什么？", header: "topic", options: [] }] },
        },
      })
      expect(answered.result.type).toBe("text")
      expect(answered.result.value).toContain("User has answered your questions")
      expect(answered.result.value).toContain("写实")
    }),
  )
})
