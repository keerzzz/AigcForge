export * as SessionIdentityQuery from "./session-identity-query"

import { useQuery } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import type { ServerSDK } from "@/context/server-sdk"

export type Target = {
  sdk: ServerSDK
  sessionID: string
}

export function use(target: Accessor<Target | undefined>) {
  return useQuery(() => {
    const current = target()
    return {
      queryKey: ["session", "identity", current?.sdk.scope ?? "", current?.sessionID ?? ""] as const,
      enabled: !!current,
      queryFn: async () => {
        if (!current) return undefined
        return (await current.sdk.client.session.identity({ sessionID: current.sessionID })).data
      },
    }
  })
}
