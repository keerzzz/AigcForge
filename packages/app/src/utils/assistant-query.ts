import type { QueryClient, QueryKey } from "@tanstack/solid-query"
import type { ServerScope } from "@/utils/server-scope"

export function assistantQueryKey<const Parts extends readonly unknown[]>(scope: ServerScope, ...parts: Parts) {
  return [scope, "assistant", ...parts] as const
}

export function assistantQueryOptions<const Parts extends readonly unknown[]>(scope: ServerScope, ...parts: Parts) {
  return {
    queryKey: assistantQueryKey(scope, ...parts),
    // Recover invalidations received while unmounted without adding reads on ordinary remounts.
    refetchOnMount: (query: { state: { isInvalidated: boolean } }) => query.state.isInvalidated,
  }
}

export function assistantKbQueryKeys(scope: ServerScope) {
  return [
    assistantQueryKey(scope, "kb"),
    assistantQueryKey(scope, "kb-search"),
    assistantQueryKey(scope, "kb-backlinks"),
    assistantQueryKey(scope, "dangling"),
  ] as const
}

export async function invalidateAssistantQueries(client: QueryClient, keys: ReadonlyArray<QueryKey>): Promise<void> {
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })))
}
