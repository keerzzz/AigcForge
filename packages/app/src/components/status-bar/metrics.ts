export type MetricGroup = "tokens" | "context" | "cache" | "cost"

export const METRIC_GROUP_I18N: Record<MetricGroup, string> = {
  tokens: "statusBar.metrics.group.tokens",
  context: "statusBar.metrics.group.context",
  cache: "statusBar.metrics.group.cache",
  cost: "statusBar.metrics.group.cost",
}

export type StatusBarMetric = {
  readonly id: string
  readonly group: MetricGroup
  readonly labelKey: string
  readonly value: () => string
  readonly available: () => boolean
}
