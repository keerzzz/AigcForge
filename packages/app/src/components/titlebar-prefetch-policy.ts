export type PrefetchTabOptions = {
  tabIndex: number
  activeIndex: number
  totalTabs: number
  distance?: number
}

/**
 * Determines whether a tab in the titlebar should be prefetched based on its proximity
 * to the active tab. Only the active tab and its immediate neighbors (within distance, default 1)
 * are eagerly prefetched to eliminate multi-tab prefetch storms.
 */
export function shouldPrefetchTab(options: PrefetchTabOptions): boolean {
  if (options.activeIndex < 0 || options.activeIndex >= options.totalTabs) {
    return false
  }
  const maxDistance = options.distance ?? 1
  return Math.abs(options.tabIndex - options.activeIndex) <= maxDistance
}
