import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@aigcfroge/plugin/tui"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createTuiApiAdapters } from "../../src/plugin/adapters"
import { mount } from "../cli/cmd/tui/sync-fixture"
import { createTuiAdapterInput } from "../fixture/tui-plugin"
import { tmpdir } from "../fixture/fixture"

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

async function withAdapters(
  run: (api: Omit<TuiPluginApi, "lifecycle">, sync: Parameters<typeof createTuiApiAdapters>[0]["sync"]) => void,
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const ctx = await mount(undefined, tmp.path)
  try {
    const input = createTuiAdapterInput({ sync: ctx.sync, renderer: ctx.app.renderer, kv: ctx.kv })
    createRoot((dispose) => {
      try {
        run(createTuiApiAdapters(input), ctx.sync)
      } finally {
        dispose()
      }
    })
  } finally {
    ctx.app.renderer.destroy()
  }
}

describe("TUI plugin Task contract through createTuiApiAdapters", () => {
  test("does not expose the retired session.todo accessor", async () => {
    await withAdapters((api) => {
      // @ts-expect-error Task is the only current contract; todo is not a plugin API.
      expect(api.state.session.todo).toBeUndefined()
      expect("todo" in api.state.session).toBe(false)
      expect(api.state.session.task("missing-session")).toEqual([])
    })
  })

  test("preserves all six states, stable identity, revision, ownership, schedule and DAG fields", async () => {
    await withAdapters((api, sync) => {
      const statuses: SessionTaskInfo["status"][] = [
        "pending",
        "in_progress",
        "completed",
        "cancelled",
        "scheduled",
        "failed",
      ]
      const tasks = statuses.map((status, index) =>
        task({
          id: `tsk_${status}`,
          status,
          revision: index + 2,
          priority: "high",
          agentID: `agent_${index}`,
          parentID: "tsk_parent",
          spawnedFrom: "tsk_schedule",
          dependsOn: ["tsk_dependency"],
          outputDigest: `result ${status}`,
          createdAt: 100,
          updatedAt: 200 + index,
          ...(status === "scheduled"
            ? { scheduledAt: 300, nextRun: 400, recurrence: { cron: "0 9 * * *", timezone: "UTC", enabled: true } }
            : {}),
        }),
      )
      sync.set("task", "sess_1", tasks)

      const current = api.state.session.task("sess_1")
      expect(current).toBe(sync.data.task.sess_1)
      expect(current).toEqual(tasks)
      expect(current.map((item) => item.status)).toEqual(statuses)
    })
  })

  test("does not invent ownership for an unassigned task", async () => {
    await withAdapters((api, sync) => {
      sync.set("task", "sess_1", [task()])

      expect(api.state.session.task("sess_1")[0]).toEqual(task())
      expect(api.state.session.task("sess_1")[0].agentID).toBeUndefined()
      expect("agentID" in api.state.session.task("sess_1")[0]).toBe(false)
    })
  })

  test("keeps sessions isolated and exposes store changes, switches and clears reactively", async () => {
    await withAdapters((api, sync) => {
      sync.set("task", "sess_1", [task()])
      sync.set("task", "sess_2", [task({ id: "tsk_2", sessionID: "sess_2", status: "scheduled", revision: 5 })])
      const [sessionID, setSessionID] = createSignal("sess_1")
      const current = createMemo(() =>
        api.state.session.task(sessionID()).map((item) => ({
          id: item.id,
          sessionID: item.sessionID,
          revision: item.revision,
          status: item.status,
        })),
      )

      expect(current()).toEqual([{ id: "tsk_1", sessionID: "sess_1", revision: 1, status: "pending" }])
      sync.set("task", "sess_1", 0, { status: "failed", revision: 2 })
      expect(current()).toEqual([{ id: "tsk_1", sessionID: "sess_1", revision: 2, status: "failed" }])
      expect(api.state.session.task("sess_2")[0].status).toBe("scheduled")
      expect(api.state.session.task("sess_2")[0].revision).toBe(5)

      setSessionID("sess_2")
      expect(current()).toEqual([{ id: "tsk_2", sessionID: "sess_2", revision: 5, status: "scheduled" }])
      sync.set("task", "sess_1", [])
      expect(current()).toEqual([{ id: "tsk_2", sessionID: "sess_2", revision: 5, status: "scheduled" }])
      expect(api.state.session.task("sess_1")).toEqual([])
      sync.set("task", "sess_2", [])
      expect(current()).toEqual([])

      sync.set("task", "sess_2", [task({ id: "tsk_3", sessionID: "sess_2", status: "cancelled", revision: 8 })])
      expect(current()).toEqual([{ id: "tsk_3", sessionID: "sess_2", revision: 8, status: "cancelled" }])
      expect(api.state.session.task("missing-session")).toEqual([])
    })
  })
})
