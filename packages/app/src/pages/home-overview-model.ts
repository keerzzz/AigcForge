import type { ProductMode } from "@aigcfroge/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

export function countByMode(records: ReadonlyArray<{ session: { mode?: ProductMode } }>) {
  const count = { coding: 0, chat: 0, work: 0 }
  for (const r of records) {
    const m = r.session.mode
    if (m === "chat" || m === "work") count[m] += 1
    else count.coding += 1 // undefined 归 coding（D3）
  }
  return count
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
  if (idx === -1) return { rest: [...records] } // 已归档/不存在 → 无置顶
  return { pinned: records[idx], rest: records.filter((_, i) => i !== idx) }
}
