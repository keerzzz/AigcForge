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

export type StatusBarSource = {
  readonly label: () => string
  readonly connection: () => {
    readonly state: ConnectionState
    readonly serverName: string
    readonly serverKey: ServerConnection.Key
  }
  readonly model: () => StatusBarModelInfo | undefined
  readonly cache: () => StatusBarCacheInfo | undefined
  readonly allMetrics: () => StatusBarMetric[]
  readonly pinnedMetrics: () => StatusBarMetric[]
  readonly togglePin: (metricID: string) => void
}
