/**
 * Pure decisions behind the tab close transaction (`TabsProvider.removeTab`).
 *
 * Kept apart from the provider so the rules the transaction depends on are testable
 * without mounting the shell: the successor handoff order, the `recent` pointer move,
 * and the fact that a tab is matched by key — never by the index it had when the close
 * started, because a confirmation can keep the close pending while other tabs change.
 */

export type TabClosePlan<T> = {
  /** Tabs that remain once the closing key is gone. */
  remaining: T[]
  /** The tab to hand off to: right neighbour first, left neighbour after that, none → Home. */
  successor?: T
  /** The `recent` pointer after the close; unchanged unless it pointed at the closing tab. */
  recent?: string
}

export function planTabClose<T>(input: {
  tabs: readonly T[]
  keyOf: (tab: T) => string
  closingKey: string
  recentKey?: string
}): TabClosePlan<T> | undefined {
  const index = input.tabs.findIndex((tab) => input.keyOf(tab) === input.closingKey)
  if (index === -1) return undefined
  const successor = input.tabs[index + 1] ?? input.tabs[index - 1]
  return {
    remaining: input.tabs.filter((tab) => input.keyOf(tab) !== input.closingKey),
    successor,
    recent: input.recentKey === input.closingKey ? successor && input.keyOf(successor) : input.recentKey,
  }
}
