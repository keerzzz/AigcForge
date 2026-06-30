import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          tool_call: true,
          options: {},
        },
      },
      options: {
        baseURL: "http://127.0.0.1:1",
        apiKey: "test-key",
      },
    },
  },
  model: "test/test-model",
}

const it = testEffect(
  Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer).pipe(Layer.provide(Ripgrep.defaultLayer)),
)

it.instance(
  "omitted-agent prompt keeps meta for routes that are not safe primary-agent direct routes",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      for (const text of [
        "@codex review this",
        "@claude-code inspect this",
        "先做 A 再做 B",
        "@explore 查找代码 @build 实现修复",
        "explain how authentication works",
      ]) {
        const message = yield* prompt.prompt({
          sessionID: session.id,
          model: ref,
          noReply: true,
          parts: [{ type: "text", text }],
        })

        expect(message.info.role).toBe("user")
        if (message.info.role === "user") expect(message.info.agent).toBe("meta")
      }
    }),
  { config: cfg },
)

it.instance(
  "omitted-agent prompt direct-routes high-confidence primary-agent targets",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      for (const text of ["fix login bug", "@build 修复这个 bug"]) {
        const message = yield* prompt.prompt({
          sessionID: session.id,
          model: ref,
          noReply: true,
          parts: [{ type: "text", text }],
        })

        expect(message.info.role).toBe("user")
        if (message.info.role === "user") expect(message.info.agent).toBe("build")
      }
    }),
  { config: cfg },
)
