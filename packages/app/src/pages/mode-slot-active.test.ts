import { afterEach, describe, expect, test } from "bun:test"
import { CancelledError, QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from "@tanstack/solid-query"
import { createComponent, createEffect, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { ModeSlotActiveProvider, useModeQueryActivity, whenActive } from "@/pages/mode-slot-active"

// The contract these pin is Solid's: `createResource` skips its fetcher when the
// source is undefined/null/false. An object source is always truthy, so gating has to
// collapse to undefined rather than to a falsy-but-present value.

describe("whenActive", () => {
  test("passes the source through while the slot is on screen", () => {
    expect(whenActive(true, () => ({ sdk: "x" }))).toEqual({ sdk: "x" })
  })

  test("collapses an object source to undefined while the slot is hidden", () => {
    expect(whenActive(false, () => ({ sdk: "x" }))).toBeUndefined()
  })

  test("does not evaluate the source while hidden", () => {
    // The source itself reads signals and can build request payloads; running it for
    // a hidden slot is the cost being avoided, not just the fetch.
    let reads = 0
    whenActive(false, () => {
      reads++
      return 1
    })
    expect(reads).toBe(0)

    whenActive(true, () => {
      reads++
      return 1
    })
    expect(reads).toBe(1)
  })

  test("preserves a legitimately undefined source when active", () => {
    // "No SDK yet" and "slot hidden" both mean skip, so they are allowed to look the
    // same to the resource — but the active path must not invent a value.
    expect(whenActive(true, () => undefined)).toBeUndefined()
  })
})

const disposers: Array<() => void> = []

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
})

describe("useModeQueryActivity", () => {
  test("skips a hidden slot, cancels its pending read, and resumes without accepting the stale response", async () => {
    const started = Promise.withResolvers<void>()
    const first = Promise.withResolvers<string>()
    let calls = 0
    const mounted = mountQueries([
      {
        scope: "a",
        active: false,
        read: () => {
          calls++
          started.resolve()
          return calls === 1 ? first.promise : Promise.resolve("fresh")
        },
      },
    ])

    expect(calls).toBe(0)
    mounted.setActive(0, true)
    await bounded(started.promise)
    const pending = queryPromise(mounted.client, "a")
    mounted.setActive(0, false)
    await expect(bounded(pending)).rejects.toBeInstanceOf(CancelledError)
    expect(mounted.client.getQueryState(queryKey("a"))?.fetchStatus).toBe("idle")

    // Like an SDK call that does not consume Query's signal, the transport may
    // finish after cancellation. Its result must not replace the mounted state.
    first.resolve("stale")
    await bounded(first.promise)
    expect(mounted.client.getQueryData(queryKey("a"))).toBeUndefined()
    expect(calls).toBe(1)

    mounted.setActive(0, true)
    await reactiveReady(() => mounted.result(0).data === "fresh")
    expect(calls).toBe(2)
  })

  test("cancels an already scheduled retry when the observer becomes inactive", async () => {
    const started = Promise.withResolvers<void>()
    const first = Promise.withResolvers<string>()
    let calls = 0
    const mounted = mountQueries([
      {
        scope: "a",
        active: true,
        read: () => {
          calls++
          started.resolve()
          return calls === 1 ? first.promise : Promise.resolve("recovered")
        },
      },
    ])

    await bounded(started.promise)
    const pending = queryPromise(mounted.client, "a")
    const retryScheduled = cacheReady(
      mounted.client,
      () => mounted.client.getQueryState(queryKey("a"))?.fetchFailureCount === 1,
    )
    first.reject(new Error("controlled first read failure"))
    await retryScheduled
    mounted.setActive(0, false)
    // Waiting for the actual retryer to terminate distinguishes cancellation
    // from enabled=false, which alone leaves the scheduled retry running.
    await expect(bounded(pending)).rejects.toBeInstanceOf(CancelledError)
    expect(calls).toBe(1)
    expect(mounted.client.getQueryState(queryKey("a"))?.fetchStatus).toBe("idle")

    mounted.setActive(0, true)
    await reactiveReady(() => mounted.result(0).data === "recovered")
    expect(calls).toBe(2)
  })

  test("keeps a shared request alive while another mounted observer is visible", async () => {
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<string>()
    let calls = 0
    const read = () => {
      calls++
      started.resolve()
      return response.promise
    }
    const mounted = mountQueries([
      { scope: "a", active: true, read },
      { scope: "a", active: true, read },
    ])

    await bounded(started.promise)
    const pending = queryPromise(mounted.client, "a")
    mounted.setActive(0, false)
    expect(mounted.client.getQueryState(queryKey("a"))?.fetchStatus).toBe("fetching")
    response.resolve("shared")
    await expect(bounded(pending)).resolves.toBe("shared")
    await reactiveReady(() => mounted.result(0).data === "shared" && mounted.result(1).data === "shared")
    expect(calls).toBe(1)
  })

  test("does not cancel an inactive fetch belonging to another server scope", async () => {
    const started = Promise.withResolvers<void>()
    const first = Promise.withResolvers<string>()
    const otherStarted = Promise.withResolvers<void>()
    const other = Promise.withResolvers<string>()
    const mounted = mountQueries([
      {
        scope: "a",
        active: true,
        read: () => {
          started.resolve()
          return first.promise
        },
      },
    ])
    // A QueryClient fetch with no observers is inactive. It proves the scope
    // filter, independently of the shared-active-observer exemption above.
    const background = mounted.client.fetchQuery({
      queryKey: queryKey("b"),
      queryFn: () => {
        otherStarted.resolve()
        return other.promise
      },
    })

    await bounded(Promise.all([started.promise, otherStarted.promise]))
    const pending = queryPromise(mounted.client, "a")
    mounted.setActive(0, false)
    await expect(bounded(pending)).rejects.toBeInstanceOf(CancelledError)
    expect(mounted.client.getQueryState(queryKey("b"))?.fetchStatus).toBe("fetching")
    other.resolve("server-b")
    await expect(bounded(background)).resolves.toBe("server-b")
    first.resolve("server-a-late")
    await bounded(first.promise)
    expect(mounted.client.getQueryData(queryKey("a"))).toBeUndefined()
    expect(mounted.client.getQueryData<string>(queryKey("b"))).toBe("server-b")
  })
})

function queryKey(scope: string) {
  return [scope, "records", "shared"] as const
}

function mountQueries(slots: Array<{ scope: string; active: boolean; read: () => Promise<string> }>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 0, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  })
  const results: UseQueryResult<string, Error>[] = []
  const owner = createRoot((dispose) => {
    const [state, setState] = createStore({ active: slots.map((slot) => slot.active) })
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return slots.map((slot, index) =>
          createComponent(ModeSlotActiveProvider, {
            value: () => state.active[index],
            get children() {
              const active = useModeQueryActivity(() => [slot.scope, "records"])
              results[index] = useQuery(() => ({
                enabled: active(),
                queryKey: queryKey(slot.scope),
                queryFn: slot.read,
              }))
              return null
            },
          }),
        )
      },
    })
    return { dispose, setActive: (index: number, active: boolean) => setState("active", index, active) }
  })
  disposers.push(() => {
    owner.dispose()
    client.clear()
  })
  return { client, setActive: owner.setActive, result: (index: number) => results[index] }
}

function queryPromise(client: QueryClient, scope: string) {
  const pending = client.getQueryCache().find({ queryKey: queryKey(scope), exact: true })?.promise
  if (!pending) throw new Error(`Expected a running query for scope ${scope}`)
  return pending
}

function cacheReady(client: QueryClient, ready: () => boolean) {
  const pending = Promise.withResolvers<void>()
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (ready()) pending.resolve()
  })
  if (ready()) pending.resolve()
  return bounded(pending.promise).finally(unsubscribe)
}

function reactiveReady(ready: () => boolean) {
  const pending = Promise.withResolvers<void>()
  const dispose = createRoot((stop) => {
    createEffect(() => {
      if (ready()) pending.resolve()
    })
    return stop
  })
  return bounded(pending.promise).finally(dispose)
}

function bounded<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    // This is only a failure deadline; successful waits end on Query/Solid events.
    const timer = setTimeout(() => reject(new Error("Query lifecycle readiness timed out")), 2_000)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
