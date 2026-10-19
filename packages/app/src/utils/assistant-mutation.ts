import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { QueryClient, QueryKey } from "@tanstack/solid-query"
import { invalidateAssistantQueries } from "./assistant-query"

type Operation = { keys: ReadonlyArray<QueryKey>; current: () => boolean }

/** Keep a completed write separate from its retryable authoritative refresh. */
export function create(input: { client: QueryClient; onComplete: () => void }) {
  const [state, setState] = createStore<{
    phase: "idle" | "writing" | "write-failed" | "refreshing" | "refresh-failed"
    error?: unknown
  }>({ phase: "idle" })
  let active: Operation | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    active = undefined
  })
  const current = (operation: Operation) => !disposed && active === operation && operation.current()
  const blocked = () => state.phase === "writing" || state.phase === "refreshing" || state.phase === "refresh-failed"

  async function refresh(operation: Operation) {
    if (current(operation)) setState({ phase: "refreshing", error: undefined })
    try {
      // A replaced editor's write still invalidates its captured original resources.
      await invalidateAssistantQueries(input.client, operation.keys, { throwOnError: true })
    } catch (error) {
      if (current(operation)) setState({ phase: "refresh-failed", error })
      return
    }
    if (!current(operation)) return
    active = undefined
    setState({ phase: "idle", error: undefined })
    input.onComplete()
  }

  return {
    state,
    blocked,
    reset() {
      active = undefined
      setState({ phase: "idle", error: undefined })
    },
    async run(action: () => Promise<unknown>, keys: ReadonlyArray<QueryKey>, isCurrent: () => boolean = () => true) {
      if (disposed || blocked()) return
      const operation = { keys, current: isCurrent }
      active = operation
      setState({ phase: "writing", error: undefined })
      try {
        await action()
      } catch (error) {
        if (current(operation)) setState({ phase: "write-failed", error })
        return
      }
      await refresh(operation)
    },
    async retry() {
      const operation = active
      if (!operation || state.phase !== "refresh-failed" || !current(operation)) return
      await refresh(operation)
    },
  }
}

export * as AssistantMutation from "./assistant-mutation"
