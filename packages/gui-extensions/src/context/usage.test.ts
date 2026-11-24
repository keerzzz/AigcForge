import { expect, test } from "bun:test"
import type { SessionAttemptInfo, SessionMessageAssistant, SessionMessageInfo } from "@omnixa/client/promise"
import { createStore } from "solid-js/store"
import { sessionContextUsage } from "./usage"

const assistant: SessionMessageAssistant = {
  id: "msg_usage",
  type: "assistant",
  agent: "build",
  model: { providerID: "initial", id: "first" },
  content: [],
  tokens: { input: 300, output: 50, reasoning: 20, cache: { read: 200, write: 30 } },
  time: { created: 1_000 },
}

const initial: SessionAttemptInfo = {
  ordinal: 0,
  attemptID: "attempt_initial",
  agent: "build",
  selection: { type: "group", groupID: "balanced" },
  model: assistant.model,
  apiModelID: "first",
  quote: { status: "unknown" },
  goalRefs: [],
  transition: "initial",
  started: 1_000,
  observations: [],
  terminal: {
    status: "failed",
    ended: 1_200,
    outputStarted: true,
    usage: { input: 200, output: 20, reasoning: 10, cache: { read: 100, write: 20 } },
  },
}

const fallback: SessionAttemptInfo = {
  ...initial,
  ordinal: 1,
  attemptID: "attempt_fallback",
  model: { providerID: "fallback", id: "second" },
  apiModelID: "second",
  transition: "fallback",
  started: 1_300,
  terminal: {
    status: "completed",
    ended: 1_800,
    outputStarted: true,
    usage: { input: 100, output: 30, reasoning: 10, cache: { read: 100, write: 10 } },
  },
}

test("reports the latest physical model and usage without summing retry receipts", () => {
  const result = sessionContextUsage([{ ...assistant, attempts: [initial, fallback] }])

  expect(result?.total).toBe(250)
  expect(result?.tokens).toEqual(fallback.terminal?.usage)
  expect(result?.model).toEqual(fallback.model)
  expect(assistant.tokens?.input).toBe(300)
})

test.each([
  { name: "running physical request", attempts: [{ ...fallback, terminal: undefined }] },
  {
    name: "missing physical usage",
    attempts: [{ ...fallback, terminal: { ...fallback.terminal!, usage: undefined } }],
  },
  { name: "empty physical receipts", attempts: [] },
])("keeps $name unknown instead of reusing accumulated Step tokens", ({ attempts }) => {
  const result = sessionContextUsage([{ ...assistant, attempts: [...attempts] }])

  expect(result?.tokens).toBeUndefined()
  expect(result?.total).toBeUndefined()
})

test("preserves legacy usage and ignores a legacy request before it reports usage", () => {
  const messages: SessionMessageInfo[] = [assistant, { ...assistant, id: "msg_running", tokens: undefined }]

  expect(sessionContextUsage(messages)?.total).toBe(600)
  expect(sessionContextUsage(messages)?.message.id).toBe(assistant.id)
  expect(sessionContextUsage([])).toBeUndefined()
})

test("reads nested receipt updates before logical completion and after a new fallback", () => {
  const [state, setState] = createStore<{ messages: SessionMessageAssistant[] }>({
    messages: [{ ...assistant, tokens: undefined, attempts: [{ ...initial, terminal: undefined }] }],
  })

  const current = () => sessionContextUsage(state.messages)

  expect(current()?.total).toBeUndefined()
  setState("messages", 0, "attempts", 0, "terminal", initial.terminal)
  expect(current()?.total).toBe(350)

  setState("messages", 0, "attempts", (attempts) => [...(attempts ?? []), { ...fallback, terminal: undefined }])
  expect(current()?.total).toBeUndefined()
  expect(current()?.model).toEqual(fallback.model)

  setState("messages", 0, "attempts", 1, "terminal", fallback.terminal)
  expect(current()?.total).toBe(250)
  setState("messages", 0, "tokens", assistant.tokens)
  expect(current()?.total).toBe(250)
})
