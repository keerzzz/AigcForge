import { pathKey } from "@/utils/path-key"

// Auto-sync decision logic — extracted as a pure function so it can be tested
// directly (AGENTS.md: "test actual implementation; do not duplicate logic").
//
// The effect in secondary-sidebar.tsx calls computeAutoSync(dir, list) inside
// untrack, then applies the returned decisions to the collapsed/expanded stores.
// untrack is essential there: without it, a manual toggle re-runs the effect
// and overwrites the user's choice — see the effect's comment for the rationale.
export type AutoSyncDecision = {
  worktree: string
  collapsed: boolean
  expandWorktree?: string
}

export function computeAutoSync(
  dir: string,
  list: readonly { worktree: string; sandboxes?: readonly string[] }[],
): AutoSyncDecision[] {
  const dirKey = pathKey(dir)
  return list.map((project) => {
    const dirs = [project.worktree, ...(project.sandboxes ?? [])]
    const activeWs = dirs.find((w) => pathKey(w) === dirKey)
    if (activeWs) {
      return { worktree: project.worktree, collapsed: false, expandWorktree: activeWs }
    }
    return { worktree: project.worktree, collapsed: true }
  })
}
