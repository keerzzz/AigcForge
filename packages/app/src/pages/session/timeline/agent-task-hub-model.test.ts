import { describe, expect, test } from "bun:test"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import {
  activeTaskCount,
  aggregateAgentTasks,
  countByStatus,
  derivedTasksBySource,
  newScheduledTask,
  scheduledAgentTasks,
  sessionCountForAgent,
  unassignedTasks,
  withoutTask,
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

describe("scheduledAgentTasks (Step 4 agent-view management list)", () => {
  test("returns only scheduled tasks owned by the agent across sessions", () => {
    const rows = scheduledAgentTasks(
      {
        ses_a: [
          task({ id: "tsk_nightly", agentID: "build", recurrence: { cron: "0 9 * * *", enabled: true } }),
          task({ id: "tsk_plain", agentID: "build" }),
        ],
        ses_b: [
          task({ id: "tsk_other_agent", agentID: "auditor", scheduledAt: 1600000000000 }),
          task({ id: "tsk_oneshot", agentID: "build", scheduledAt: 1600000000000 }),
        ],
      },
      "build",
    )
    expect(rows.map((row) => row.id).sort()).toEqual(["tsk_nightly", "tsk_oneshot"])
  })

  test("empty input yields no rows", () => {
    expect(scheduledAgentTasks({}, "build")).toEqual([])
  })
})

describe("sessionCountForAgent (detail header session count)", () => {
  test("counts sessions bound to the agent", () => {
    const sessions = [{ agent: "build" }, { agent: "build" }, { agent: "auditor" }, {}]
    expect(sessionCountForAgent(sessions, "build")).toBe(2)
    expect(sessionCountForAgent(sessions, "auditor")).toBe(1)
    expect(sessionCountForAgent(sessions, "meta")).toBe(0)
  })
})

describe("derivedTasksBySource (M5 zone 2b 任务衍生)", () => {
  test("groups spawnedFrom-carrying tasks by source message", () => {
    const groups = derivedTasksBySource({
      ses_a: [
        task({ id: "tsk_spawn_1", spawnedFrom: "msg_a" }),
        task({ id: "tsk_plain", agentID: "build" }),
        task({ id: "tsk_spawn_2", spawnedFrom: "msg_a", content: "second" }),
      ],
      ses_b: [task({ id: "tsk_spawn_3", spawnedFrom: "msg_b", sessionID: "ses_b" })],
    })
    expect(groups.map((group) => group.sourceMessageID)).toEqual(["msg_a", "msg_b"])
    expect(groups[0]?.rows.map((row) => row.id).sort()).toEqual(["tsk_spawn_1", "tsk_spawn_2"])
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(["tsk_spawn_3"])
  })

  test("tasks without spawnedFrom are excluded", () => {
    const groups = derivedTasksBySource({
      ses_a: [task({ id: "tsk_plain" }), task({ id: "tsk_other", spawnedFrom: "msg_x" })],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sourceMessageID).toBe("msg_x")
  })

  test("empty store yields no groups", () => {
    expect(derivedTasksBySource({})).toEqual([])
  })
})

describe("scheduled-task writeback helpers (Step 4)", () => {
  test("withoutTask drops the target id (task_schedule remove semantics)", () => {
    const tasks = [
      { id: "tsk_a", content: "a" },
      { id: "tsk_b", content: "b" },
      { id: "tsk_c", content: "c" },
    ]
    expect(withoutTask(tasks, "tsk_b").map((task) => task.id)).toEqual(["tsk_a", "tsk_c"])
  })

  test("newScheduledTask builds a mint-able write shape for the selected agent", () => {
    const recurring = newScheduledTask({
      content: "nightly",
      agentID: "build",
      recurrence: { cron: "0 9 * * *", enabled: true },
    })
    expect(recurring).toMatchObject({ content: "nightly", status: "scheduled", priority: "medium", agentID: "build" })
    expect(recurring.recurrence?.cron).toBe("0 9 * * *")
    expect(recurring.scheduledAt).toBeUndefined()
    expect(recurring.id).toBeUndefined()

    const oneshot = newScheduledTask({ content: "remind", agentID: "build", scheduledAt: 1700000000000 })
    expect(oneshot.scheduledAt).toBe(1700000000000)
    expect(oneshot.recurrence).toBeUndefined()
  })
})
