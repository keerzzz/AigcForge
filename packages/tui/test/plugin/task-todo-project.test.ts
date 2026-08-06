import { describe, expect, test } from "bun:test"
import { projectTodoFromTask } from "../../src/plugin/task-todo-project"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2"

function task(overrides: Partial<SessionTaskInfo> = {}): SessionTaskInfo {
  return {
    id: "tsk_1",
    content: "do the thing",
    status: "pending",
    priority: "medium",
    revision: 1,
    sessionID: "sess_1",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe("projectTodoFromTask", () => {
  // Pinned projection rule: the legacy Todo status set (pending/in_progress/
  // completed/cancelled) cannot represent scheduled, so it degrades to pending.
  // Any change to this mapping is a breaking change for third-party plugins
  // still reading state.session.todo().
  test("maps scheduled to pending", () => {
    expect(projectTodoFromTask(task({ status: "scheduled" }))).toEqual({
      content: "do the thing",
      status: "pending",
    })
  })

  test("passes through the four legacy statuses unchanged", () => {
    for (const status of ["pending", "in_progress", "completed", "cancelled"] as const) {
      expect(projectTodoFromTask(task({ status })).status).toBe(status)
    }
  })

  test("passes through failed", () => {
    expect(projectTodoFromTask(task({ status: "failed" })).status).toBe("failed")
  })

  test("exposes only the legacy content/status subset", () => {
    const projected = projectTodoFromTask(task({ priority: "high" }))
    expect(Object.keys(projected).sort()).toEqual(["content", "status"])
  })
})
