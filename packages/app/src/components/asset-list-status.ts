export type AssetListStatus = "loading" | "ready" | "partial" | "error"

/**
 * Shared status fold for multi-endpoint asset reads.
 *
 * `failed === undefined` means the read has not settled yet. Existing rows
 * deliberately stay visible during a refetch, so `loading` is ignored once a
 * settled result exists.
 */
export function assetListStatus(input: {
  loading: boolean
  failed: readonly string[] | undefined
  total: number
}): AssetListStatus {
  if (input.failed === undefined) return "loading"
  if (input.failed.length >= input.total) return "error"
  if (input.failed.length > 0) return "partial"
  return "ready"
}

/** Empty affordances require a clean settled read, never a pending or failed one. */
export const assetListIsEmpty = (input: { status: AssetListStatus; count: number }) =>
  input.status === "ready" && input.count === 0
