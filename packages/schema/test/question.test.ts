import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Question } from "../src/question"

const request = {
  id: "que_shared",
  sessionID: "ses_shared",
  questions: [
    { question: "Choose", header: "Choice", options: [{ label: "One", description: "First" }], custom: false },
  ],
  tool: { messageID: "msg_shared", callID: "call_shared" },
}

describe("canonical Question wire schema", () => {
  test("retains the current request contract without changing its payload", () => {
    expect(Schema.encodeSync(Question.Request)(Schema.decodeUnknownSync(Question.Request)(request))).toEqual(request)
  })

  test("rejects malformed IDs, nested options and optional flags", () => {
    expect(Schema.is(Question.Request)({ ...request, id: "invalid" })).toBe(false)
    expect(Schema.is(Question.Request)({ ...request, sessionID: "invalid" })).toBe(false)
    expect(
      Schema.is(Question.Request)({ ...request, questions: [{ ...request.questions[0], options: "invalid" }] }),
    ).toBe(false)
    expect(Schema.is(Question.Request)({ ...request, questions: [{ ...request.questions[0], custom: "yes" }] })).toBe(
      false,
    )
  })

  test("accepts ordered multi-select answers and rejects non-string answers", () => {
    expect(Schema.decodeUnknownSync(Question.Reply)({ answers: [["Two", "One"], []] })).toEqual({
      answers: [["Two", "One"], []],
    })
    expect(Schema.is(Question.Reply)({ answers: [[1]] })).toBe(false)
  })
})
