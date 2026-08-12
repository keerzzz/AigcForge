import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTask } from "../src/index"

const valid = {
  id: "tsk_abc123",
  content: "Audit auth",
  status: "in_progress",
  priority: "high",
  sessionID: "ses_xyz",
  parentID: "tsk_parent",
  outputDigest: "digest",
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
}

describe("SessionTask.Info", () => {
  test("decodes a valid M0 task", () => {
    const s = Schema.decodeUnknownSync(SessionTask.Info)(valid)
    expect(s.id).toBe("tsk_abc123")
    expect(s.content).toBe("Audit auth")
    expect(s.status).toBe("in_progress")
    expect(s.priority).toBe("high")
    expect(s.sessionID).toBe("ses_xyz")
    expect(s.parentID).toBe("tsk_parent")
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(SessionTask.Info)({ ...valid, status: "foo" })).toThrow()
  })

  test("rejects an unknown priority", () => {
    expect(() => Schema.decodeUnknownSync(SessionTask.Info)({ ...valid, priority: "bogus" })).toThrow()
  })

  test("omits optional fields without error", () => {
    const s = Schema.decodeUnknownSync(SessionTask.Info)({
      id: "tsk_1",
      content: "x",
      status: "pending",
      priority: "low",
      sessionID: "ses_1",
      revision: 1,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(s.parentID).toBeUndefined()
    expect(s.outputDigest).toBeUndefined()
    expect(s.agentID).toBeUndefined()
  })

  test("requires id", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        content: "x",
        status: "pending",
        priority: "low",
        sessionID: "ses_1",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("requires content", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        id: "tsk_1",
        status: "pending",
        priority: "low",
        sessionID: "ses_1",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("requires sessionID", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        id: "tsk_1",
        content: "x",
        status: "pending",
        priority: "low",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("TaskStatus literal set matches contract", () => {
    const statuses = Schema.decodeUnknownSync(SessionTask.TaskStatus)
    expect(statuses("pending")).toBe("pending")
    expect(statuses("in_progress")).toBe("in_progress")
    expect(statuses("completed")).toBe("completed")
    expect(statuses("cancelled")).toBe("cancelled")
    expect(statuses("scheduled")).toBe("scheduled")
    expect(statuses("failed")).toBe("failed")
  })
})
