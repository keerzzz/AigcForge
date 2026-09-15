import type { ServerConnection } from "@/context/server"
import type { StatusBarMetric } from "./metrics"

export type ConnectionState = "online" | "offline" | "reconnecting"

export type StatusBarModelInfo = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
  readonly displayName: string
}

export type StatusBarCacheInfo = {
  readonly hitRate: number
  readonly read: number
  readonly write: number
}

/**
 * What the bar shows for the session's permission posture (S6 §9.2). Sourced from
 * the ADR-23 projection; `effect` is the owner's baseline verdict and is absent
 * when only the transitional tier fallback was available — the bar never invents
 * one. Break-glass lease state is not part of this projection: the lease owner
 * lives with the composer control, and duplicating it here would create the
 * second truth source ADR-23 forbids.
 */
export type StatusBarPermissionInfo = {
  readonly kind: "full" | "degraded" | "blocked"
  readonly reason?: string
  readonly effect?: "allow" | "ask" | "deny"
}

export type StatusBarSource = {
  readonly label: () => string | undefined
  readonly connection: () => {
    readonly state: ConnectionState
    readonly serverName: string
    readonly serverKey: ServerConnection.Key
  }
  readonly model: () => StatusBarModelInfo | undefined
  readonly permission: () => StatusBarPermissionInfo | undefined
  readonly cache: () => StatusBarCacheInfo | undefined
  readonly allMetrics: () => StatusBarMetric[]
  readonly pinnedMetrics: () => StatusBarMetric[]
  readonly togglePin: (metricID: string) => void
  readonly openContext: () => void
}
