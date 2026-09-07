import type { ProductMode } from "@aigcfroge/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

export function countByMode(records: ReadonlyArray<{ session: { mode?: ProductMode } }>) {
  const count: Record<ProductMode, number> = { coding: 0, chat: 0, work: 0, assistant: 0, custom: 0 }
  for (const record of records) {
    count[record.session.mode ?? "coding"] += 1
  }
  return count
}

/**
 * The Home sidebar's mode filter rows: "all", then one per mode definition.
 *
 * Takes the definitions rather than importing them, so the test can hand it a list this
 * codebase does not have yet. That is the actual guarantee worth having — the rows are
 * whatever the definitions are, in their order — where asserting today's five modes would
 * only snapshot the current list and still let a sixth be dropped.
 *
 * A mode with no sessions counts 0 rather than rendering `undefined`, so a newly added mode
 * shows up empty instead of broken.
 */
export function modeFilters<Id extends string, Key extends string>(input: {
  readonly definitions: ReadonlyArray<{ readonly id: Id; readonly labelKey: Key }>
  readonly allLabel: string
  readonly total: number
  readonly counts: Readonly<Partial<Record<Id, number>>>
  readonly label: (key: Key) => string
}): Array<{ id: "all" | Id; label: string; count: number }> {
  return [
    { id: "all" as const, label: input.allLabel, count: input.total },
    ...input.definitions.map((definition) => ({
      id: definition.id,
      label: input.label(definition.labelKey),
      count: input.counts[definition.id] ?? 0,
    })),
  ]
}

export function countByProject(records: ReadonlyArray<{ project: { worktree: string } }>) {
  const count = new Map<string, number>()
  for (const r of records) count.set(r.project.worktree, (count.get(r.project.worktree) ?? 0) + 1)
  return count
}

export function pinLastActive<T extends { session: { id: string; directory: string } }>(
  records: ReadonlyArray<T>,
  lastActive: { directory: string; sessionID: string } | undefined,
): { pinned?: T; rest: T[] } {
  if (!lastActive) return { rest: [...records] }
  const idx = records.findIndex(
    (r) => pathKey(r.session.directory) === pathKey(lastActive.directory) && r.session.id === lastActive.sessionID,
  )
  if (idx === -1) return { rest: [...records] }
  return { pinned: records[idx], rest: records.filter((_, i) => i !== idx) }
}
