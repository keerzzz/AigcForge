import { describe, expect, test } from "bun:test"
import { Omnixa } from "@omnixa/client"
import { Effect } from "effect"
import { GoalCommand } from "../src/commands/handlers/goal"
import { ScheduleCommand } from "../src/commands/handlers/schedule"

const session = {
  id: "ses_goal_cli",
  projectID: "project",
  agent: "meta",
  location: { directory: "/saved workspace" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
}
const schedule = {
  id: "sch_cli",
  sessionID: session.id,
  kind: "reminder",
  content: "Saved reminder",
  dueAt: 100,
  timezone: "Asia/Shanghai",
  revision: 4,
  status: "paused",
  executionPolicy: { delivery: "queue", missed: "catch_up" },
  createdAt: 1,
  updatedAt: 1,
}

describe("Goal and Schedule CLI API consumers", () => {
  test("routes Goal read and exact confirmation through the saved Session Location", async () => {
    const requests: { url: URL; method: string; body?: unknown }[] = []
    using server = apiServer(async (request, url) => {
      if (url.pathname === `/api/session/${session.id}`) return { data: session }
      requests.push({ url, method: request.method, body: request.method === "POST" ? await request.json() : undefined })
      return { data: request.method === "POST" ? { id: "gol_cli", revision: 3 } : null }
    })
    const client = Omnixa.make({ baseUrl: server.url.toString() })
    await Effect.runPromise(GoalCommand.execute(client, { sessionID: session.id, action: "read", goal: "gol_cli" }))
    const payload = { expectedRevision: 3, evidenceIDs: ["command:exact"], evidenceSetDigest: "a1".repeat(32) }
    await Effect.runPromise(
      GoalCommand.execute(client, {
        sessionID: session.id,
        action: "confirm",
        goal: "gol_cli",
        data: JSON.stringify(payload),
      }),
    )
    expect(requests.map((request) => request.url.pathname)).toEqual([
      `/api/session/${session.id}/goal/gol_cli`,
      `/api/session/${session.id}/goal/gol_cli/confirm`,
    ])
    expect(requests[1].body).toEqual(payload)
    requests.forEach((request) => {
      expect(request.url.searchParams.get("directory")).toBe(session.location.directory)
      expect(request.url.searchParams.get("workspace")).toBeNull()
    })
    await expect(
      Effect.runPromise(GoalCommand.execute(client, { sessionID: session.id, action: "confirm", goal: "gol_cli" })),
    ).rejects.toThrow("reviewed expectedRevision")
    expect(requests).toHaveLength(2)
  })

  test("requires a caller-selected revision for Goal mutation and preserves that revision", async () => {
    const bodies: unknown[] = []
    using server = apiServer(async (request, url) => {
      if (url.pathname === `/api/session/${session.id}`) return { data: session }
      bodies.push(await request.json())
      return { data: { id: "gol_cli" } }
    })
    const client = Omnixa.make({ baseUrl: server.url.toString() })
    await expect(
      Effect.runPromise(GoalCommand.execute(client, { sessionID: session.id, action: "resume", goal: "gol_cli" })),
    ).rejects.toThrow("requires --revision")
    expect(bodies).toEqual([])
    await Effect.runPromise(
      GoalCommand.execute(client, { sessionID: session.id, action: "resume", goal: "gol_cli", revision: 7 }),
    )
    expect(bodies).toEqual([{ expectedRevision: 7 }])
  })

  test("creates a Schedule in the selected Session and preserves the target policy", async () => {
    const writes: { url: URL; body: unknown }[] = []
    using server = apiServer(async (request, url) => {
      if (url.pathname === `/api/session/${session.id}`) return { data: session }
      writes.push({ url, body: await request.json() })
      return schedule
    })
    const client = Omnixa.make({ baseUrl: server.url.toString() })
    const payload = {
      kind: "prompt",
      content: "Timed task",
      timezone: "Asia/Shanghai",
      dueAt: 100,
      target: { policy: "existing", sessionID: "ses_target" },
    }
    await Effect.runPromise(
      ScheduleCommand.execute(client, { sessionID: session.id, action: "create", data: JSON.stringify(payload) }),
    )
    expect(writes[0].body).toEqual({ ...payload, sessionID: session.id })
    expect(writes[0].url.pathname).toBe("/schedule/rule")
    expect(writes[0].url.searchParams.get("directory")).toBe(session.location.directory)
    expect(writes[0].url.searchParams.get("workspace")).toBeNull()
  })

  test("reads occurrence history and cancels only a selected Session occurrence", async () => {
    const mutations: unknown[] = []
    using server = apiServer(async (request, url) => {
      if (url.pathname === `/api/session/${session.id}`) return { data: session }
      if (url.pathname === `/schedule/rule/${schedule.id}`) return schedule
      if (url.pathname === `/schedule/rules/${session.id}`) return [schedule]
      if (url.pathname === `/schedule/rule/${schedule.id}/runs`) return [{ id: "occ_cli", scheduleID: schedule.id }]
      mutations.push(url.pathname)
      return { id: "occ_cli", status: "cancelled" }
    })
    const client = Omnixa.make({ baseUrl: server.url.toString() })
    expect(
      await Effect.runPromise(
        ScheduleCommand.execute(client, { sessionID: session.id, action: "history", id: schedule.id }),
      ),
    ).toMatchObject([{ id: "occ_cli" }])
    await expect(
      Effect.runPromise(
        ScheduleCommand.execute(client, { sessionID: session.id, action: "cancel-run", occurrence: "occ_other" }),
      ),
    ).rejects.toThrow("does not belong")
    expect(mutations).toEqual([])
    await Effect.runPromise(
      ScheduleCommand.execute(client, { sessionID: session.id, action: "cancel-run", occurrence: "occ_cli" }),
    )
    expect(mutations).toEqual(["/schedule/run/occ_cli/cancel"])
  })
})

function apiServer(handle: (request: Request, url: URL) => Promise<unknown>) {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const result = await handle(request, new URL(request.url))
      return Response.json(result)
    },
  })
  return {
    url: server.url,
    [Symbol.dispose]() {
      server.stop(true)
    },
  }
}
