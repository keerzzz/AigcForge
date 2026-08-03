import { describe, expect, test } from "bun:test"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import {
  activeTaskCount,
  aggregateAgentTasks,
  countByStatus,
  unassignedTasks,
  type AgentTaskRow,
} from "./agent-task-hub-model"

const task = (over: Partial<AgentTaskRow> = {}): SessionTaskInfo => ({
  id: "tsk_1",
  content: "audit",
  status: "pending",
  priority: "medium",
  sessionID: "ses_a",
  agentID: "build",
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe("aggregateAgentTasks", () => {
  test("flattens tasks across sessions with the session tagged", () => {
    const rows = aggregateAgentTasks({
      ses_a: [task({ id: "tsk_a", content: "a" })],
      ses_b: [task({ id: "tsk_b", content: "b", sessionID: "ses_b" })],
    })
    expect(rows.map((row) => row.id)).toEqual(["tsk_a", "tsk_b"])
    expect(rows[0]?.sessionID).toBe("ses_a")
    expect(rows[1]?.sessionID).toBe("ses_b")
  })

  test("narrows to one owning agent when agentID is supplied", () => {
    const rows = aggregateAgentTasks(
      {
        ses_a: [task({ id: "tsk_build", agentID: "build" }), task({ id: "tsk_audit", agentID: "auditor" })],
      },
      "build",
    )
    expect(rows.map((row) => row.id)).toEqual(["tsk_build"])
  })

  test("empty sessions yield no rows", () => {
    expect(aggregateAgentTasks({})).toEqual([])
    expect(aggregateAgentTasks({ ses_a: [] })).toEqual([])
  })
})

describe("activeTaskCount / countByStatus", () => {
  test("counts only non-terminal statuses", () => {
    const rows = [
      task({ status: "scheduled" }),
      task({ status: "pending" }),
      task({ status: "in_progress" }),
      task({ status: "completed" }),
      task({ status: "cancelled" }),
      task({ status: "failed" }),
    ]
    expect(activeTaskCount(rows)).toBe(3)
  })

  test("breaks counts down by status", () => {
    const rows = [task({ status: "scheduled" }), task({ status: "scheduled" }), task({ status: "completed" })]
    expect(countByStatus(rows)).toEqual({ scheduled: 2, completed: 1 })
  })
})

describe("unassignedTasks", () => {
  test("buckets tasks without an owning agent across sessions", () => {
    const rows = unassignedTasks({
      ses_a: [task({ id: "tsk_owned", agentID: "build" }), task({ id: "tsk_orphan", agentID: undefined })],
      ses_b: [task({ id: "tsk_orphan_2", agentID: undefined, sessionID: "ses_b" })],
    })
    expect(rows.map((row) => row.id).sort()).toEqual(["tsk_orphan", "tsk_orphan_2"])
    expect(rows.every((row) => row.agentID === undefined)).toBe(true)
  })

  test("scheduled jobs flow through the per-agent aggregation", () => {
    const rows = aggregateAgentTasks(
      {
        ses_a: [
          task({
            id: "tsk_nightly",
            agentID: "build",
            status: "scheduled",
            scheduledAt: 1700000000000,
            recurrence: { cron: "0 9 * * *", enabled: true },
          }),
        ],
      },
      "build",
    )
    expect(rows.map((row) => row.id)).toEqual(["tsk_nightly"])
  })
})
