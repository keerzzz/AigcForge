import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { QueryClient, QueryObserver } from "@tanstack/solid-query"
import { AssistantMutation } from "./assistant-mutation"
import { assistantQueryOptions } from "./assistant-query"
import { ServerScope } from "./server-scope"

const disposers: Array<() => void> = []
afterEach(() =>
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
)

describe("AssistantMutation", () => {
  test("locks an applied write through failed refreshes and retries only reads", async () => {
    const fixture = setup()
    const state = { fail: true, reads: 0 }
    const failure = new Error("refresh failed")
    const note = fixture.observe("kb", async () => {
      state.reads += 1
      if (state.fail) throw failure
      return "fresh"
    })
    const write = Promise.withResolvers<void>()
    const writes: string[] = []
    const request = fixture.mutation.run(() => {
      writes.push("write")
      return write.promise
    }, [note.options.queryKey])
    expect(fixture.mutation.state.phase).toBe("writing")
    await fixture.mutation.run(async () => {
      writes.push("duplicate")
    }, [note.options.queryKey])
    write.resolve()
    await request
    expect(fixture.mutation.state.phase).toBe("refresh-failed")
    expect(fixture.mutation.state.error).toBe(failure)
    expect(fixture.mutation.blocked()).toBe(true)
    expect(fixture.completed).toHaveLength(0)
    await fixture.mutation.run(async () => {
      writes.push("duplicate after write")
    }, [note.options.queryKey])
    await fixture.mutation.retry()
    expect(state.reads).toBe(2)
    expect(fixture.mutation.state.phase).toBe("refresh-failed")
    state.fail = false
    await Promise.all([fixture.mutation.retry(), fixture.mutation.retry()])
    expect(state.reads).toBe(3)
    expect(writes).toEqual(["write"])
    expect(fixture.completed).toEqual(["complete"])
    expect(fixture.mutation.state.phase).toBe("idle")
    expect(fixture.mutation.blocked()).toBe(false)
    expect(fixture.client.getQueryData<string>(note.options.queryKey)).toBe("fresh")
  })

  test("allows a new write attempt after a write failure without offering refresh-only recovery", async () => {
    const fixture = setup()
    const reads: string[] = []
    const writes: string[] = []
    const note = fixture.observe("kb", async () => {
      reads.push("read")
      return "fresh"
    })
    const failure = new Error("write rejected")
    await fixture.mutation.run(async () => {
      writes.push("failed write")
      throw failure
    }, [note.options.queryKey])
    expect(fixture.mutation.state.phase).toBe("write-failed")
    expect(fixture.mutation.state.error).toBe(failure)
    expect(fixture.mutation.blocked()).toBe(false)
    await fixture.mutation.retry()
    expect(reads).toHaveLength(0)
    await fixture.mutation.run(async () => {
      writes.push("new write")
    }, [note.options.queryKey])
    expect(writes).toEqual(["failed write", "new write"])
    expect(reads).toEqual(["read"])
    expect(fixture.completed).toEqual(["complete"])
  })

  for (const replacement of ["reset", "dispose"] as const) {
    test(`an old write still refreshes its resources after ${replacement} without completing the replacement`, async () => {
      const fixture = setup()
      const reads: string[] = []
      const first = fixture.observe("first", async () => {
        reads.push("first")
        return "fresh-first"
      })
      const second = fixture.observe("second", async () => {
        reads.push("second")
        return "fresh-second"
      })
      const oldWrite = Promise.withResolvers<void>()
      const newWrite = Promise.withResolvers<void>()
      const original = fixture.mutation.run(() => oldWrite.promise, [first.options.queryKey])
      if (replacement === "reset") fixture.mutation.reset()
      if (replacement === "dispose") fixture.dispose()
      const next = fixture.mutation.run(() => newWrite.promise, [second.options.queryKey])
      oldWrite.resolve()
      await original
      expect(reads).toEqual(["first"])
      expect(fixture.completed).toHaveLength(0)
      if (replacement === "reset") expect(fixture.mutation.state.phase).toBe("writing")
      newWrite.resolve()
      await next
      expect(reads).toEqual(replacement === "reset" ? ["first", "second"] : ["first"])
      expect(fixture.completed).toHaveLength(replacement === "reset" ? 1 : 0)
    })
  }

  test("keeps inactive resources invalidated until their observer is enabled", async () => {
    const fixture = setup()
    const reads: string[] = []
    const note = fixture.observe(
      "kb",
      async () => {
        reads.push("read")
        return "fresh"
      },
      false,
    )
    await fixture.mutation.run(async () => {}, [note.options.queryKey])
    expect(fixture.completed).toEqual(["complete"])
    expect(reads).toHaveLength(0)
    expect(fixture.client.getQueryState(note.options.queryKey)?.isInvalidated).toBe(true)
    note.observer.setOptions({ ...note.options, enabled: true })
    await expect(fixture.client.getQueryCache().find({ queryKey: note.options.queryKey })?.promise).resolves.toBe(
      "fresh",
    )
    expect(reads).toEqual(["read"])
  })
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, gcTime: Infinity } },
  })
  disposers.push(() => client.clear())
  const completed: string[] = []
  const root = createRoot((dispose) => ({
    dispose,
    mutation: AssistantMutation.create({ client, onComplete: () => completed.push("complete") }),
  }))
  disposers.push(root.dispose)
  return {
    client,
    completed,
    ...root,
    observe(resource: string, queryFn: () => Promise<string>, enabled = true) {
      const options = { ...assistantQueryOptions(ServerScope.local, resource), queryFn, enabled }
      client.setQueryData(options.queryKey, "cached")
      const observer = new QueryObserver(client, options)
      disposers.push(observer.subscribe(() => {}))
      return { options, observer }
    },
  }
}
