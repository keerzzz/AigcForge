import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { FSUtil } from "@aigcfroge/core/fs-util"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { TestInstance } from "../fixture/fixture"
import { CliAdapterRegistry } from "../../src/agent/meta/adapters/registry"

// Direct service calls use the same decoded input shape as the HttpApi handler.
const decodePrompt = Schema.decodeUnknownSync(SessionPrompt.PromptInput)

const it = testEffect(
  Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, TestLLMServer.layer, FSUtil.defaultLayer)
    .pipe(Layer.provide(CliAdapterRegistry.defaultLayer))
    .pipe(Layer.provide(Ripgrep.defaultLayer)),
)

describe("StructuredOutput Integration", () => {
  it.instance(
    "produces structured output with simple schema",
    () =>
      Effect.gen(function* () {
        const context = yield* setup("Structured Output Test")
        yield* context.llm.tool("StructuredOutput", { answer: 4, explanation: "Two plus two is four." })

        const result = yield* context.prompt.prompt(
          decodePrompt({
            sessionID: context.session.id,
            agent: "build",
            parts: [
              {
                type: "text",
                text: "What is 2 + 2? Provide a simple answer.",
              },
            ],
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  answer: { type: "number", description: "The numerical answer" },
                  explanation: { type: "string", description: "Brief explanation" },
                },
                required: ["answer"],
              },
              retryCount: 0,
            },
          }),
        )

        // Verify structured output was captured (only on assistant messages)
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeDefined()
          expect(typeof result.info.structured).toBe("object")

          const output = result.info.structured
          expect(output.answer).toBe(4)

          // Verify no error was set
          expect(result.info.error).toBeUndefined()
        }
        const stored = yield* context.sessions.messages({ sessionID: context.session.id })
        expect(stored.find((message) => message.info.id === result.info.id)?.info).toMatchObject({
          role: "assistant",
          structured: { answer: 4, explanation: "Two plus two is four." },
        })
        const request = (yield* context.llm.inputs).at(0)
        expect(request).toMatchObject({ model: "test-model", tool_choice: "required", stream: true })
        expect(request?.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "function",
              function: expect.objectContaining({
                name: "StructuredOutput",
                parameters: expect.objectContaining({ type: "object", required: ["answer"] }),
              }),
            }),
          ]),
        )

        expect(yield* context.llm.calls).toBe(1)
        expect(yield* context.llm.pending).toBe(0)
      }),
    { git: true },
    60000,
  )

  it.instance(
    "produces structured output with nested objects",
    () =>
      Effect.gen(function* () {
        const context = yield* setup("Nested Schema Test")
        yield* context.llm.tool("StructuredOutput", {
          company: { name: "Anthropic", founded: 2021 },
          products: ["Claude"],
        })

        const result = yield* context.prompt.prompt(
          decodePrompt({
            sessionID: context.session.id,
            agent: "build",
            parts: [
              {
                type: "text",
                text: "Tell me about Anthropic company in a structured format.",
              },
            ],
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  company: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      founded: { type: "number" },
                    },
                    required: ["name", "founded"],
                  },
                  products: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["company"],
              },
              retryCount: 0,
            },
          }),
        )

        // Verify structured output was captured (only on assistant messages)
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeDefined()
          const output = result.info.structured

          expect(output.company).toBeDefined()
          expect(output.company.name).toBe("Anthropic")
          expect(typeof output.company.founded).toBe("number")

          expect(output.products).toEqual(["Claude"])

          // Verify no error was set
          expect(result.info.error).toBeUndefined()
        }

        expect(yield* context.llm.calls).toBe(1)
        expect(yield* context.llm.pending).toBe(0)
      }),
    { git: true },
    60000,
  )

  it.instance(
    "works with text outputFormat (default)",
    () =>
      Effect.gen(function* () {
        const context = yield* setup("Text Output Test")
        yield* context.llm.text("Hello.")

        const result = yield* context.prompt.prompt(
          decodePrompt({
            sessionID: context.session.id,
            agent: "build",
            parts: [
              {
                type: "text",
                text: "Say hello.",
              },
            ],
            format: {
              type: "text",
            },
          }),
        )

        // Verify no structured output (text mode) and no error
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeUndefined()
          expect(result.info.error).toBeUndefined()
        }

        // Verify we got a response with parts
        expect(result.parts).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "text", text: "Hello." })]),
        )
        const request = (yield* context.llm.inputs).at(0)
        expect(request?.tool_choice).not.toBe("required")
        expect(request?.tools).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ function: expect.objectContaining({ name: "StructuredOutput" }) }),
          ]),
        )

        expect(yield* context.llm.calls).toBe(1)
        expect(yield* context.llm.pending).toBe(0)
      }),
    { git: true },
    60000,
  )

  it.instance(
    "stores outputFormat on user message",
    () =>
      Effect.gen(function* () {
        const context = yield* setup("OutputFormat Storage Test")
        yield* context.llm.tool("StructuredOutput", { result: 2 })

        const result = yield* context.prompt.prompt(
          decodePrompt({
            sessionID: context.session.id,
            agent: "build",
            parts: [
              {
                type: "text",
                text: "What is 1 + 1?",
              },
            ],
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  result: { type: "number" },
                },
                required: ["result"],
              },
              retryCount: 3,
            },
          }),
        )

        expect(result.info).toMatchObject({ role: "assistant", structured: { result: 2 } })
        expect(result.info.role === "assistant" && result.info.error).toBeUndefined()

        // Get all messages from session
        const messages = yield* context.sessions.messages({ sessionID: context.session.id })
        const userMessage = messages.find((m) => m.info.role === "user")

        // Verify outputFormat was stored on user message
        expect(userMessage).toBeDefined()
        if (userMessage?.info.role === "user") {
          expect(userMessage.info.format).toBeDefined()
          expect(userMessage.info.format?.type).toBe("json_schema")
          if (userMessage.info.format?.type === "json_schema") {
            expect(userMessage.info.format.retryCount).toBe(3)
          }
        }

        expect(yield* context.llm.calls).toBe(1)
        expect(yield* context.llm.pending).toBe(0)
      }),
    { git: true },
    60000,
  )

  test("unit test: StructuredOutputError is properly structured", () => {
    const error = new SessionV1.StructuredOutputError({
      message: "Failed to produce valid structured output after 3 attempts",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toContain("3 attempts")
    expect(error.data.retries).toBe(3)

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.retries).toBe(3)
  })
})

const setup = Effect.fn("StructuredOutputTest.setup")(function* (title: string) {
  const llm = yield* TestLLMServer
  const directory = (yield* TestInstance).directory
  yield* (yield* FSUtil.Service).writeWithDirs(
    path.join(directory, "aigcfroge.json"),
    JSON.stringify({
      model: "test/test-model",
      enabled_providers: ["test"],
      provider: {
        test: {
          name: "Test",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 100000, output: 10000 },
              cost: { input: 0, output: 0 },
            },
          },
          options: { apiKey: "test-key", baseURL: llm.url },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  return {
    llm,
    sessions,
    prompt: yield* SessionPrompt.Service,
    session: yield* sessions.create({ mode: "coding", title }),
  }
})
