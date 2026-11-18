import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

test("input membership preserves its durable anchor and exact operation reference while old deliveries omit it", () => {
  const payload = { sessionID: "ses_result", inboxID: "msg_input" }
  const membership = {
    anchorInputID: "msg_first",
    operationRef: { sourceSessionID: "ses_origin", operationID: "top_input_result" },
  }
  const decode = Schema.decodeUnknownSync(SessionEvent.InboxDelivered.data)
  const encode = Schema.encodeSync(Schema.toCodecJson(SessionEvent.InboxDelivered.data))
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, membership }))).toEqual({ ...payload, membership })
  expect(encode(decode({ ...payload, membership: { anchorInputID: "msg_first" } }))).toEqual({
    ...payload,
    membership: { anchorInputID: "msg_first" },
  })
  expect(() => decode({ ...payload, membership: { operationRef: membership.operationRef } })).toThrow()
  expect(() =>
    decode({ ...payload, membership: { ...membership, operationRef: { operationID: "top_input_result" } } }),
  ).toThrow()
  expect(SessionEvent.InboxDelivered.durable).toEqual({ aggregate: "sessionID", version: 1 })
})

test("completed steps retain an optional result anchor without adding a new durable event version", () => {
  const payload = { sessionID: "ses_result", assistantMessageID: "msg_result" }
  const decode = Schema.decodeUnknownSync(SessionEvent.Step.Completed.data)
  const encode = Schema.encodeSync(Schema.toCodecJson(SessionEvent.Step.Completed.data))
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, resultAnchorInputID: "msg_input" }))).toEqual({
    ...payload,
    resultAnchorInputID: "msg_input",
  })
  expect(() => decode({ ...payload, resultAnchorInputID: 1 })).toThrow()
  expect(SessionEvent.Step.Completed.durable).toEqual({ aggregate: "sessionID", version: 1 })
})

test("operation admission keeps the trusted reference separate from user metadata", () => {
  const payload = {
    sessionID: "ses_result",
    inboxID: "msg_input",
    item: {
      type: "user",
      payload: { text: "Run this work", metadata: { operationID: "top_forged" } },
      delivery: "queue",
    },
  }
  const operation = { sourceSessionID: "ses_origin", operationID: "top_input_result" }
  const decode = Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)
  const encode = Schema.encodeSync(Schema.toCodecJson(SessionEvent.InboxEnqueued.data))
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, operation }))).toEqual({ ...payload, operation })
  expect(() => decode({ ...payload, operation: { operationID: operation.operationID } })).toThrow()
  expect(SessionEvent.InboxEnqueued.durable).toEqual({ aggregate: "sessionID", version: 1 })
})

test("execution outcomes round trip their optional input result anchors", () => {
  const cases = [
    { schema: SessionEvent.Execution.Succeeded.data, payload: { sessionID: "ses_result" } },
    {
      schema: SessionEvent.Execution.Failed.data,
      payload: { sessionID: "ses_result", error: { type: "provider.invalid-request", message: "Invalid request" } },
    },
    { schema: SessionEvent.Execution.Interrupted.data, payload: { sessionID: "ses_result", reason: "user" } },
  ] as const
  cases.forEach((item) => {
    const decode = Schema.decodeUnknownSync(item.schema)
    const encode = Schema.encodeSync(Schema.toCodecJson(item.schema))
    expect(encode(decode(item.payload))).toEqual(item.payload)
    expect(encode(decode({ ...item.payload, resultAnchorInputID: "msg_input" }))).toEqual({
      ...item.payload,
      resultAnchorInputID: "msg_input",
    })
    expect(() => decode({ ...item.payload, resultAnchorInputID: 1 })).toThrow()
  })
})

test("step continuation facts are optional for retained history and encode false explicitly", () => {
  const payload = {
    sessionID: "ses_result",
    assistantMessageID: "msg_result",
    finish: "tool-calls" as const,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const decode = Schema.decodeUnknownSync(SessionEvent.Step.Ended.data)
  const encode = Schema.encodeSync(SessionEvent.Step.Ended.data)
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, needsContinuation: false }))).toEqual({ ...payload, needsContinuation: false })
  expect(encode(decode({ ...payload, needsContinuation: true }))).toEqual({ ...payload, needsContinuation: true })
  expect(() => decode({ ...payload, needsContinuation: "false" })).toThrow()
  expect(SessionEvent.Step.Ended.durable).toEqual({ aggregate: "sessionID", version: 1 })
})

test("assistant projection preserves optional continuation policy without inferring it from finish", () => {
  const payload = {
    id: "msg_result",
    type: "assistant" as const,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [],
    finish: "tool-calls" as const,
    time: { created: 1, completed: 2 },
  }
  const decode = Schema.decodeUnknownSync(SessionMessage.Assistant)
  const encode = Schema.encodeSync(SessionMessage.Assistant)
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, needsContinuation: false }))).toEqual({ ...payload, needsContinuation: false })
  expect(() => decode({ ...payload, needsContinuation: 0 })).toThrow()
})

test("retained fork events omit child ownership and new child forks encode it explicitly", () => {
  const payload = {
    sessionID: "ses_child",
    parentID: "ses_parent",
    boundary: { type: "through" as const, messageID: "msg_parent" },
  }
  const decode = Schema.decodeUnknownSync(SessionEvent.Forked.data)
  const encode = Schema.encodeSync(SessionEvent.Forked.data)
  expect(encode(decode(payload))).toEqual(payload)
  expect(encode(decode({ ...payload, child: true }))).toEqual({ ...payload, child: true })
  expect(encode(decode({ ...payload, child: false }))).toEqual({ ...payload, child: false })
  expect(() => decode({ ...payload, child: "true" })).toThrow()
  expect(SessionEvent.Forked.durable).toEqual({ aggregate: "sessionID", version: 2 })
})
