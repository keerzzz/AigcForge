export * as UrlParams from "./url-params"

/**
 * Rewrite the current URL's search params while preserving pathname and hash.
 *
 * The router's `setSearchParams` builds `${mergedSearch}${location.hash}` and
 * navigates with `resolve: false`. When the merged search is empty that target
 * collapses to a bare `#hash`, which resolves against the origin root — wiping
 * the path. Observed on the session route with `?insert=…#anchor` (S4 #4): the
 * one-shot cleanup sent the user to `/#anchor` instead of the session URL.
 * Building the absolute target here keeps path and anchor intact.
 */
export function withoutParams(
  location: { pathname: string; search: string; hash: string },
  drop: ReadonlyArray<string>,
): string {
  const params = new URLSearchParams(location.search)
  for (const key of drop) params.delete(key)
  const query = params.toString()
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`
}
