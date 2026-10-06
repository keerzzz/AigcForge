import { describe, expect, test } from "bun:test"
import { taskWriteSnapshot } from "./task-write-tool-model"

const snapshot = { id: "tsk_a", content: "Audit the call", status: "pending", priority: "high" }

describe("taskWriteSnapshot", () => {
  test("reads the batch snapshot from the call metadata", () => {
    expect(taskWriteSnapshot({ tasks: [{ content: "input only" }] }, { tasks: [snapshot] })).toEqual([
      { id: "tsk_a", content: "Audit the call", status: "pending" },
    ])
  })

  test("reads the single-task snapshot used by task_update", () => {
    expect(taskWriteSnapshot({ id: "tsk_a", content: "Audit the call" }, { task: snapshot })).toEqual([
      { id: "tsk_a", content: "Audit the call", status: "pending" },
    ])
  })

  test("falls back to the call input while the tool has no result metadata", () => {
    expect(taskWriteSnapshot({ tasks: [{ content: "Pending create", status: "pending" }] }, undefined)).toEqual([
      { content: "Pending create", status: "pending" },
    ])
  })

  test("ignores entries without usable content instead of inventing tasks", () => {
    expect(taskWriteSnapshot(undefined, { tasks: [snapshot, { status: "pending" }, null, "nope"] })).toEqual([
      { id: "tsk_a", content: "Audit the call", status: "pending" },
    ])
  })

  test("never derives content from a task store or other sources", () => {
    expect(taskWriteSnapshot({ ids: ["tsk_a"] }, { tasks: "not-an-array" })).toEqual([])
  })
})
