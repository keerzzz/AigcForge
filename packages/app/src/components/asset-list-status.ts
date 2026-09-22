export type AssetListStatus = "idle" | "loading" | "ready" | "partial" | "error"

export type AssetListResourceState = "unresolved" | "pending" | "ready" | "refreshing" | "errored"

/**
 * Shared status fold for multi-endpoint asset reads.
 *
 * A settled result stays visible while the same source refetches, but it must
 * never be treated as current after the location/server source changes.
 */
export function assetListStatus(input: {
  source: unknown | undefined
  settledSource: unknown | undefined
  state: AssetListResourceState
  failed: readonly string[] | undefined
  total: number
}): AssetListStatus {
  if (input.source === undefined) return "idle"
  if (input.state === "errored") return "error"
  if (input.settledSource !== input.source || input.failed === undefined) return "loading"
  if (input.failed.length >= input.total) return "error"
  if (input.failed.length > 0) return "partial"
  return "ready"
}

/** Empty affordances require a clean settled read, never a pending or failed one. */
export const assetListIsEmpty = (input: { status: AssetListStatus; count: number }) =>
  input.status === "ready" && input.count === 0
