import { describe, expect, test } from "bun:test"
import { createStore, produce, reconcile } from "solid-js/store"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import { createTaskReadback, pickTarget } from "./directory-sync"

describe("pickTarget", () => {
  test("returns requested directory when it differs from own", () => {
    expect(pickTarget("/tmp/project", "/tmp/worktree")).toBe("/tmp/worktree")
  })

  test("returns own directory when requested is undefined or same", () => {
    expect(pickTarget("/tmp/project", undefined)).toBe("/tmp/project")
    expect(pickTarget("/tmp/project", "/tmp/project")).toBe("/tmp/project")
  })
})

describe("Task full-list readback", () => {
  for (const empty of [false, true]) {
    test(`later ${empty ? "empty" : "populated"} success replaces the earlier rendered read`, async () => {
      const fixture = taskReadbackFixture()
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const second = await fixture.next()
      first.reply.resolve([taskRow(90)])
      await a
      expect(fixture.store.ses_a).toEqual([taskRow(90)])
      // A full list can have lower row revisions, or no rows at all.
      second.reply.resolve(empty ? [] : [taskRow(1)])
      await b
      expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
    })

    test(`earlier read cannot replace the newer ${empty ? "clear" : "data"} response`, async () => {
      const fixture = taskReadbackFixture()
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const second = await fixture.next()
      second.reply.resolve(empty ? [] : [taskRow(1)])
      await b
      first.reply.resolve([taskRow(90)])
      await a
      expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
    })

    for (const allFirst of [false, true]) {
      test(`Hub and Session share read order: allFirst=${allFirst}, empty=${empty}`, async () => {
        const fixture = taskReadbackFixture()
        const a = allFirst
          ? fixture.owner.loadAll({ directory: "/a" })
          : fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
        const first = await fixture.next()
        const b = allFirst
          ? fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
          : fixture.owner.loadAll({ directory: "/a" })
        const second = await fixture.next()
        second.reply.resolve(empty ? [] : [taskRow(1)])
        await b
        first.reply.resolve([taskRow(90)])
        await a
        expect(fixture.store.ses_a).toEqual(empty ? [] : [taskRow(1)])
      })
    }
  }

  test("an empty Hub snapshot excludes previously unseen rows from an older Hub request", async () => {
    const fixture = taskReadbackFixture()
    const a = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    const b = fixture.owner.loadAll({ directory: "/a" })
    const second = await fixture.next()
    second.reply.resolve([])
    await b
    first.reply.resolve([taskRow(90, "ses_unseen")])
    await a
    expect(fixture.store.ses_unseen).toBeUndefined()
    const c = fixture.owner.load({ directory: "/a", sessionID: "ses_unseen" })
    const third = await fixture.next()
    third.reply.resolve([taskRow(1, "ses_unseen")])
    await c
    expect(fixture.store.ses_unseen).toEqual([taskRow(1, "ses_unseen")])
  })

  test("a failed newer GET preserves the rendered list and the next GET recovers", async () => {
    const fixture = taskReadbackFixture()
    const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const first = await fixture.next()
    const b = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const second = await fixture.next()
    first.reply.resolve([taskRow(1)])
    await a
    const failed = b.catch((error: unknown) => error)
    second.reply.reject(new Error("read failed"))
    expect(await failed).toEqual(new Error("read failed"))
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    const recovery = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    const third = await fixture.next()
    third.reply.resolve([taskRow(2)])
    await recovery
    expect(fixture.store.ses_a).toEqual([taskRow(2)])
  })

  for (const value of [undefined, []]) {
    test(`explicit ${value ? "clear" : "eviction"} invalidates both Session and Hub reads`, async () => {
      const fixture = taskReadbackFixture()
      fixture.owner.set("ses_a", [taskRow(1)])
      const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
      const first = await fixture.next()
      const b = fixture.owner.loadAll({ directory: "/a" })
      const second = await fixture.next()
      fixture.owner.set("ses_a", value)
      first.reply.resolve([taskRow(2)])
      second.reply.resolve([taskRow(3)])
      await Promise.all([a, b])
      expect(fixture.store.ses_a).toEqual(value)
    })
  }

  test("event invalidations coalesce, invalidate held reads, and reload after another event", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    const stale = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    const refresh = fixture.owner.refresh("/a", "ses_a")
    expect(fixture.owner.refresh("/a/", "ses_a")).toBe(refresh)
    const second = await fixture.next()
    expect(fixture.calls).toHaveLength(2)
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(refresh)
    second.reply.resolve([taskRow(2)])
    const third = await fixture.next()
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    third.reply.resolve([])
    await refresh
    first.reply.resolve([taskRow(90)])
    await stale
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.calls).toHaveLength(3)
  })

  test("a refresh error does not poison the next event, including an already queued event", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    const a = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    const failed = a.catch((error: unknown) => error)
    first.reply.reject(new Error("read failed"))
    expect(await failed).toEqual(new Error("read failed"))
    expect(fixture.store.ses_a).toEqual([taskRow(1)])
    const b = fixture.owner.refresh("/a", "ses_a")
    const second = await fixture.next()
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(b)
    second.reply.reject(new Error("superseded failure"))
    const third = await fixture.next()
    third.reply.resolve([taskRow(3)])
    await b
    expect(fixture.store.ses_a).toEqual([taskRow(3)])
  })

  test("explicit clear cancels an event refresh without automatically reviving its tasks", async () => {
    const fixture = taskReadbackFixture()
    const pending = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    fixture.owner.refresh("/a", "ses_a")
    fixture.owner.set("ses_a", [])
    first.reply.resolve([taskRow(1)])
    await pending
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.calls).toHaveLength(1)
  })

  test("Hub clears absent sessions but cannot overwrite a session invalidated after its start", async () => {
    const fixture = taskReadbackFixture()
    fixture.owner.set("ses_a", [taskRow(1)])
    fixture.owner.set("ses_b", [taskRow(1, "ses_b")])
    const pending = fixture.owner.loadAll({ directory: "/a" })
    const first = await fixture.next()
    fixture.owner.set("ses_b", [])
    first.reply.resolve([taskRow(3, "ses_b"), taskRow(1, "ses_c")])
    await pending
    expect(fixture.store.ses_a).toEqual([])
    expect(fixture.store.ses_b).toEqual([])
    expect(fixture.store.ses_c).toEqual([taskRow(1, "ses_c")])
  })

  test("component abort, directory disposal and reconnect reject their old read generations", async () => {
    const fixture = taskReadbackFixture()
    const controller = new AbortController()
    const a = fixture.owner.load({ directory: "/a", sessionID: "ses_a", signal: controller.signal })
    const first = await fixture.next()
    controller.abort()
    first.reply.resolve([taskRow(1)])
    await a
    expect(fixture.store.ses_a).toBeUndefined()
    const b = fixture.owner.loadAll({ directory: "/a" })
    const second = await fixture.next()
    fixture.owner.disposeDirectory("/a/")
    const c = fixture.owner.loadAll({ directory: "/b" })
    const third = await fixture.next()
    fixture.owner.reset()
    const d = fixture.owner.load({ directory: "/b", sessionID: "ses_a" })
    const fourth = await fixture.next()
    fourth.reply.resolve([])
    await d
    second.reply.resolve([taskRow(2)])
    third.reply.resolve([taskRow(3)])
    await Promise.all([b, c])
    expect(fixture.store.ses_a).toEqual([])
  })

  test("disposal cannot delete a newer coalesced refresh or leak into another server owner", async () => {
    const fixture = taskReadbackFixture()
    const other = taskReadbackFixture()
    other.owner.set("ses_a", [taskRow(4)])
    const a = fixture.owner.refresh("/a", "ses_a")
    const first = await fixture.next()
    fixture.owner.disposeDirectory("/a")
    const b = fixture.owner.refresh("/a", "ses_a")
    const second = await fixture.next()
    first.reply.resolve([taskRow(1)])
    await a
    expect(fixture.owner.refresh("/a", "ses_a")).toBe(b)
    second.reply.resolve([taskRow(2)])
    const third = await fixture.next()
    fixture.owner.dispose()
    third.reply.resolve([taskRow(3)])
    await b
    await fixture.owner.load({ directory: "/a", sessionID: "ses_a" })
    expect(fixture.store.ses_a).toBeUndefined()
    expect(other.store.ses_a).toEqual([taskRow(4)])
    expect(fixture.calls).toHaveLength(3)
  })
})

function taskRow(revision: number, sessionID = "ses_a"): SessionTaskInfo {
  return {
    id: `tsk_${sessionID}`,
    sessionID,
    content: `revision ${revision}`,
    status: "pending",
    priority: "medium",
    revision,
    createdAt: 1,
    updatedAt: 1,
  }
}

function taskReadbackFixture() {
  type Source = { directory: string; sessionID?: string; signal?: AbortSignal }
  type Read = { source: Source; reply: ReturnType<typeof Promise.withResolvers<SessionTaskInfo[]>> }
  const calls: Read[] = []
  const queued: Read[] = []
  const waiters: Array<(read: Read) => void> = []
  const [store, setStore] = createStore<Record<string, SessionTaskInfo[] | undefined>>({})
  const read = (source: Source) => {
    const request: Read = { source, reply: Promise.withResolvers<SessionTaskInfo[]>() }
    calls.push(request)
    const waiter = waiters.shift()
    if (waiter) waiter(request)
    if (!waiter) queued.push(request)
    return request.reply.promise
  }
  const owner = createTaskReadback({
    get: read,
    list: read,
    keys: () => Object.keys(store),
    write(sessionID, tasks) {
      if (tasks === undefined) {
        setStore(
          produce((draft) => {
            delete draft[sessionID]
          }),
        )
        return
      }
      setStore(sessionID, reconcile(tasks, { key: "id" }))
    },
  })
  return {
    owner,
    store,
    calls,
    next() {
      const request = queued.shift()
      if (request) return Promise.resolve(request)
      return new Promise<Read>((resolve) => waiters.push(resolve))
    },
  }
}
