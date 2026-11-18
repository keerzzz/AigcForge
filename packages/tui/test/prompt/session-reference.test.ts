import { expect, test } from "bun:test"
import { sessionReferenceText } from "../../src/prompt/session-reference"

test("Session reference text retains exact identity and a readable title", () => {
  expect(sessionReferenceText({ id: "ses_shared", title: "中文 result\nsecond line" }, "https://one.example")).toBe(
    "Referenced Session: 中文 result second line (server https://one.example, Session ses_shared, scope identity)",
  )
  expect(sessionReferenceText({ id: "ses_shared", title: undefined }, "https://two.example")).toBe(
    "Referenced Session: Untitled session (server https://two.example, Session ses_shared, scope identity)",
  )
})
