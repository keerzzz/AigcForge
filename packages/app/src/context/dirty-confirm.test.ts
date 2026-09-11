import { describe, expect, test } from "bun:test"
import { createDirtyConfirmQueue } from "./dirty-confirm"

/**
 * The close transaction and the route guard share one confirmation queue, so the
 * contract that matters is the scheduling one: one presenter at a time, one request
 * per key, exactly one settlement — no dialog replacing another dialog, no promise
 * left pending after the owner unmounts.
 */
function presenter() {
  const calls: string[] = []
  const resolvers = new Map<string, Array<(value: boolean) => void>>()
  const present = (key: string) => {
    calls.push(key)
    return new Promise<boolean>((resolve) => {
      resolvers.set(key, [...(resolvers.get(key) ?? []), resolve])
    })
  }
  const resolve = (key: string, value: boolean) => {
    const list = resolvers.get(key) ?? []
    for (const done of list) done(value)
    resolvers.delete(key)
  }
  return { present, calls, resolve }
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0))

describe("dirty confirmation queue", () => {
  test("presents once per key and shares the settlement with concurrent callers", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const first = queue.confirm("draft:a")
    const second = queue.confirm("draft:a")

    expect(p.calls).toEqual(["draft:a"])
    p.resolve("draft:a", false)
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(queue.pending()).toBe(0)
  })

  test("different keys run FIFO: the next dialog appears only after the previous settles", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const first = queue.confirm("draft:a")
    const second = queue.confirm("session:b")
    const third = queue.confirm("draft:c")

    expect(p.calls).toEqual(["draft:a"])
    p.resolve("draft:a", true)
    expect(await first).toBe(true)
    await flush()
    expect(p.calls).toEqual(["draft:a", "session:b"])

    p.resolve("session:b", false)
    expect(await second).toBe(false)
    await flush()
    expect(p.calls).toEqual(["draft:a", "session:b", "draft:c"])

    p.resolve("draft:c", true)
    expect(await third).toBe(true)
    expect(queue.pending()).toBe(0)
  })

  test("a key confirmed again after settling starts a fresh request", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const first = queue.confirm("draft:a")
    p.resolve("draft:a", false)
    expect(await first).toBe(false)

    const second = queue.confirm("draft:a")
    await flush()
    expect(p.calls).toEqual(["draft:a", "draft:a"])
    p.resolve("draft:a", true)
    expect(await second).toBe(true)
  })

  test("a late settlement from an already-settled request cannot move the queue", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const first = queue.confirm("draft:a")
    p.resolve("draft:a", true)
    expect(await first).toBe(true)

    // The replaced dialog resolves after the fact; the settled request must stay settled.
    p.resolve("draft:a", false)
    await flush()
    expect(queue.pending()).toBe(0)

    const next = queue.confirm("draft:a")
    await flush()
    expect(p.calls).toEqual(["draft:a", "draft:a"])
    p.resolve("draft:a", false)
    expect(await next).toBe(false)
  })

  test("a presenter that never settles keeps later keys queued instead of replacing the dialog", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const first = queue.confirm("draft:a")
    const second = queue.confirm("draft:b")
    await flush()

    expect(p.calls).toEqual(["draft:a"])
    expect(queue.pending()).toBe(2)

    p.resolve("draft:a", false)
    expect(await first).toBe(false)
    await flush()
    expect(p.calls).toEqual(["draft:a", "draft:b"])

    p.resolve("draft:b", false)
    expect(await second).toBe(false)
  })

  test("dispose settles every pending request false and refuses new ones", async () => {
    const p = presenter()
    const queue = createDirtyConfirmQueue(p.present)

    const pending = queue.confirm("draft:a")
    const queued = queue.confirm("draft:b")
    expect(p.calls).toEqual(["draft:a"])

    queue.dispose()

    expect(await pending).toBe(false)
    expect(await queued).toBe(false)
    expect(queue.pending()).toBe(0)
    expect(await queue.confirm("draft:c")).toBe(false)
    expect(p.calls).toEqual(["draft:a"])
  })
})
