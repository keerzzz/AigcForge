import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryObserver } from "@tanstack/solid-query"
import { ServerConnection } from "@/context/server"
import { ServerScope } from "@/utils/server-scope"
import {
  assistantKbQueryKeys,
  assistantQueryKey,
  assistantQueryOptions,
  invalidateAssistantQueries,
} from "./assistant-query"

const disposers: Array<() => void> = []

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
})

describe("assistantQueryKey", () => {
  test("scopes assistant data by server", () => {
    const remote = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.example"))
    expect(assistantQueryKey(ServerScope.local, "pending")).toEqual([ServerScope.local, "assistant", "pending"])
    expect(assistantQueryKey(remote, "pending")).not.toEqual(assistantQueryKey(ServerScope.local, "pending"))
  })

  test("preserves resource-specific key parts", () => {
    expect(assistantQueryKey(ServerScope.local, "kb-backlinks", "note-1")).toEqual([
      ServerScope.local,
      "assistant",
      "kb-backlinks",
      "note-1",
    ])
  })
})

describe("assistantQueryOptions", () => {
  test("preserves server scope and resource-specific key parts", () => {
    const remote = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.example"))
    expect(assistantQueryOptions(remote, "kb-backlinks", "note-1").queryKey).toEqual(
      assistantQueryKey(remote, "kb-backlinks", "note-1"),
    )
  })

  test("loads cold data and refetches an invalidated query on remount despite the global mount default", async () => {
    const client = createQueryClient()
    const calls: string[] = []
    const options = {
      ...assistantQueryOptions(ServerScope.local, "memory"),
      queryFn: async () => {
        calls.push("read")
        return calls.length === 1 ? "cached" : "fresh"
      },
    }
    const first = new QueryObserver(client, options)
    const unmount = first.subscribe(() => {})
    disposers.push(unmount)
    await expect(client.getQueryCache().find({ queryKey: options.queryKey })?.promise).resolves.toBe("cached")
    expect(calls).toHaveLength(1)
    unmount()

    await invalidateAssistantQueries(client, [options.queryKey])
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true)
    expect(calls).toHaveLength(1)

    const remounted = new QueryObserver(client, options)
    disposers.push(remounted.subscribe(() => {}))
    await expect(client.getQueryCache().find({ queryKey: options.queryKey })?.promise).resolves.toBe("fresh")
    expect(remounted.getCurrentResult().data).toBe("fresh")
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(false)
    expect(calls).toHaveLength(2)
  })

  test("does not refetch stale but uninvalidated cached data on mount or remount", () => {
    const client = createQueryClient()
    const calls: string[] = []
    const options = {
      ...assistantQueryOptions(ServerScope.local, "pending"),
      queryFn: async () => {
        calls.push("read")
        return "fresh"
      },
    }
    client.setQueryData(options.queryKey, "cached", { updatedAt: 1 })
    const first = new QueryObserver(client, options)
    const unmount = first.subscribe(() => {})
    disposers.push(unmount)
    expect(first.getCurrentResult().data).toBe("cached")
    expect(first.getCurrentResult().isStale).toBe(true)
    expect(calls).toHaveLength(0)
    unmount()

    const remounted = new QueryObserver(client, options)
    disposers.push(remounted.subscribe(() => {}))
    expect(remounted.getCurrentResult().data).toBe("cached")
    expect(remounted.getCurrentResult().fetchStatus).toBe("idle")
    expect(calls).toHaveLength(0)
  })

  test("keeps an invalidated query idle until its observer is enabled", async () => {
    const client = createQueryClient()
    const calls: string[] = []
    const options = {
      ...assistantQueryOptions(ServerScope.local, "kb"),
      queryFn: async () => {
        calls.push("read")
        return "fresh"
      },
    }
    client.setQueryData(options.queryKey, "cached")
    await invalidateAssistantQueries(client, [options.queryKey])
    const observer = new QueryObserver(client, { ...options, enabled: false })
    disposers.push(observer.subscribe(() => {}))
    expect(observer.getCurrentResult().data).toBe("cached")
    expect(observer.getCurrentResult().fetchStatus).toBe("idle")
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true)
    expect(calls).toHaveLength(0)

    observer.setOptions({ ...options, enabled: true })
    await expect(client.getQueryCache().find({ queryKey: options.queryKey })?.promise).resolves.toBe("fresh")
    expect(observer.getCurrentResult().data).toBe("fresh")
    expect(calls).toHaveLength(1)
  })
})

describe("invalidateAssistantQueries", () => {
  test("propagates an explicitly requested refetch failure while preserving cached data", async () => {
    const client = createQueryClient()
    const failure = new Error("readback rejected")
    const options = {
      ...assistantQueryOptions(ServerScope.local, "kb"),
      queryFn: async () => {
        throw failure
      },
    }
    client.setQueryData(options.queryKey, "previous")
    disposers.push(new QueryObserver(client, options).subscribe(() => {}))
    await expect(invalidateAssistantQueries(client, [options.queryKey], { throwOnError: true })).rejects.toBe(failure)
    expect(client.getQueryData<string>(options.queryKey)).toBe("previous")
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true)
  })

  test("waits for neighboring refetches to settle before exposing a strict refresh failure", async () => {
    const client = createQueryClient()
    const failure = new Error("first readback rejected")
    const second = Promise.withResolvers<string>()
    const firstOptions = {
      ...assistantQueryOptions(ServerScope.local, "kb"),
      queryFn: async () => {
        throw failure
      },
    }
    const secondOptions = {
      ...assistantQueryOptions(ServerScope.local, "dangling"),
      queryFn: () => second.promise,
    }
    client.setQueryData(firstOptions.queryKey, "old note")
    client.setQueryData(secondOptions.queryKey, "old links")
    disposers.push(new QueryObserver(client, firstOptions).subscribe(() => {}))
    disposers.push(new QueryObserver(client, secondOptions).subscribe(() => {}))
    const state = { settled: false }
    const result = invalidateAssistantQueries(client, [firstOptions.queryKey, secondOptions.queryKey], {
      throwOnError: true,
    })
    void result.catch(() => {
      state.settled = true
    })
    await expect(client.getQueryCache().find({ queryKey: firstOptions.queryKey })?.promise).rejects.toBe(failure)
    expect(state.settled).toBe(false)
    second.resolve("new links")
    await expect(result).rejects.toBe(failure)
    expect(client.getQueryData<string>(secondOptions.queryKey)).toBe("new links")
    expect(state.settled).toBe(true)
  })

  test("invalidates only the supplied resources and their descendants in the captured server scope", async () => {
    const client = createQueryClient()
    const remote = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.example"))
    const affected = [
      assistantQueryKey(ServerScope.local, "kb"),
      assistantQueryKey(ServerScope.local, "kb-search", "first"),
      assistantQueryKey(ServerScope.local, "kb-search", "second"),
      assistantQueryKey(ServerScope.local, "kb-backlinks", "note-1"),
      assistantQueryKey(ServerScope.local, "dangling"),
    ]
    const unrelated = [
      assistantQueryKey(ServerScope.local, "pending"),
      assistantQueryKey(ServerScope.local, "memory"),
      assistantQueryKey(remote, "kb"),
      assistantQueryKey(remote, "kb-search", "first"),
      assistantQueryKey(remote, "kb-backlinks", "note-1"),
      assistantQueryKey(remote, "dangling"),
    ]
    ;[...affected, ...unrelated].forEach((queryKey) => client.setQueryData(queryKey, "cached"))

    await expect(invalidateAssistantQueries(client, assistantKbQueryKeys(ServerScope.local))).resolves.toBeUndefined()

    affected.forEach((queryKey) => expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true))
    unrelated.forEach((queryKey) => expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false))
  })

  test("starts active refetches together and resolves only when all supplied invalidations finish", async () => {
    const client = createQueryClient()
    const calls: string[] = []
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const pendingOptions = {
      ...assistantQueryOptions(ServerScope.local, "pending"),
      queryFn: () => {
        calls.push("pending")
        return first.promise
      },
    }
    const memoryOptions = {
      ...assistantQueryOptions(ServerScope.local, "memory"),
      queryFn: () => {
        calls.push("memory")
        return second.promise
      },
    }
    client.setQueryData(pendingOptions.queryKey, "cached-pending")
    client.setQueryData(memoryOptions.queryKey, "cached-memory")
    disposers.push(new QueryObserver(client, pendingOptions).subscribe(() => {}))
    disposers.push(new QueryObserver(client, memoryOptions).subscribe(() => {}))
    expect(calls).toHaveLength(0)

    const state = { settled: false }
    const invalidation = invalidateAssistantQueries(client, [pendingOptions.queryKey, memoryOptions.queryKey])
    void invalidation.then(() => {
      state.settled = true
    })
    expect(calls).toEqual(["pending", "memory"])
    first.resolve("fresh-pending")
    await expect(client.getQueryCache().find({ queryKey: pendingOptions.queryKey })?.promise).resolves.toBe(
      "fresh-pending",
    )
    expect(state.settled).toBe(false)
    expect(client.getQueryState(memoryOptions.queryKey)?.fetchStatus).toBe("fetching")

    second.resolve("fresh-memory")
    await expect(invalidation).resolves.toBeUndefined()
    expect(client.getQueryData<string>(pendingOptions.queryKey)).toBe("fresh-pending")
    expect(client.getQueryData<string>(memoryOptions.queryKey)).toBe("fresh-memory")
    expect(state.settled).toBe(true)
  })
})

function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
        gcTime: Infinity,
      },
    },
  })
  disposers.push(() => client.clear())
  return client
}
