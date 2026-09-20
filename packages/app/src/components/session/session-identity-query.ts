export * as SessionIdentityQuery from "./session-identity-query"

import { type QueryClient, useQuery } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import type { ServerSDK } from "@/context/server-sdk"

export type Target = {
  sdk: ServerSDK
  sessionID: string
}

export function key(scope: ServerSDK["scope"] | "", sessionID: string) {
  return ["session", "identity", scope, sessionID] as const
}

export async function invalidate(client: QueryClient, scope: ServerSDK["scope"], sessionID: string) {
  const filter = { queryKey: key(scope, sessionID), exact: true }
  // Cancel even an initial read: invalidation alone can join its pre-mutation response.
  await client.cancelQueries(filter)
  // A read failure must not turn an acknowledged mutation into a reported write failure.
  // Consumers present the query's unavailable state instead of stale permissions.
  await client.invalidateQueries({ ...filter, refetchType: "all" })
}

export function use(target: Accessor<Target | undefined>) {
  const query = useQuery(() => {
    const current = target()
    return {
      queryKey: key(current?.sdk.scope ?? "", current?.sessionID ?? ""),
      enabled: !!current,
      queryFn: async ({ signal }) => {
        if (!current) return undefined
        return (
          await current.sdk.client.session.identity({ sessionID: current.sessionID }, { signal, throwOnError: true })
        ).data
      },
    }
  })
  return {
    // TanStack retains data on refetch failure; it is no longer an authoritative identity.
    get data() {
      return query.isError ? undefined : query.data
    },
    get isError() {
      return query.isError
    },
    get isSuccess() {
      return query.isSuccess
    },
    refetch: query.refetch,
  }
}
