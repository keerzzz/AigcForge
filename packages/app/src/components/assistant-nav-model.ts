import type { KbNoteNote, PersonalMemoryInfo, ScheduleInfo } from "@aigcfroge/sdk/v2/client"

/**
 * 实体导航树数据模型（批次 2 G3 / D4，计划 §3.2）：提醒/记忆/知识库分类 +
 * 计数，知识库按 tags 层级聚合；会话列表联动（D5，计划 §3.3）从导航选中态
 * 反查会话（提醒 Schedule.Info.sessionID / 记忆 sourceSessionID），知识库笔记
 * 无会话反链 → 退化为全量。
 */

export type AssistantNavSelection =
  | { kind: "reminders"; itemId?: string }
  | { kind: "memory"; itemId?: string }
  | { kind: "kb"; itemId?: string }
  | { kind: "dangling" }
  | undefined

export type KbTagNode = {
  tag: string
  count: number
  notes: KbNoteNote[]
  children?: KbTagNode[]
}

const UNTAGGED = "__untagged__"

/** 笔记按 tags 层级聚合（#tag/subtag → 两级树），计数 = 叶子笔记数。 */
export function buildKbTagTree(notes: KbNoteNote[]): KbTagNode[] {
  const root = new Map<string, KbTagNode>()
  const untagged: KbTagNode = { tag: UNTAGGED, count: 0, notes: [] }

  for (const note of notes) {
    if (!note.tags || note.tags.length === 0) {
      untagged.count += 1
      untagged.notes.push(note)
      continue
    }
    for (const raw of note.tags) {
      const parts = raw.split("/").filter((part) => part.length > 0)
      const [head, ...rest] = parts
      if (!head) continue
      let node = root.get(head)
      if (!node) {
        node = { tag: head, count: 0, notes: [] }
        root.set(head, node)
      }
      let cursor = node
      for (const part of rest) {
        const children = cursor.children ?? (cursor.children = [])
        let child = children.find((item) => item.tag === part)
        if (!child) {
          child = { tag: part, count: 0, notes: [] }
          children.push(child)
        }
        cursor = child
      }
      cursor.count += 1
      cursor.notes.push(note)
    }
  }

  const sortTree = (nodes: KbTagNode[]) => {
    nodes.sort((a, b) => a.tag.localeCompare(b.tag))
    for (const node of nodes) {
      if (node.children) sortTree(node.children)
    }
  }
  // 节点计数 = 子树聚合（直接标签 + 子标签），与"分类计数"心智一致。
  const aggregate = (node: KbTagNode): number => {
    const children = node.children ?? []
    const sum = children.reduce((total, child) => total + aggregate(child), 0)
    node.count = node.count + sum
    return node.count
  }
  const groups = [...root.values()]
  sortTree(groups)
  for (const group of groups) aggregate(group)
  const result = [...groups]
  if (untagged.count > 0) result.push(untagged)
  return result
}

/** 导航选中态 → 会话列表高亮集合（D5；知识库/悬空 → 空集 = 全量）。 */
export function sessionHighlightIDs(input: {
  selection: AssistantNavSelection
  reminders: ScheduleInfo[]
  memories: PersonalMemoryInfo[]
}): Set<string> {
  const selection = input.selection
  if (!selection) return new Set<string>()
  if (selection.kind === "reminders") {
    const reminder = selection.itemId ? input.reminders.find((item) => item.id === selection.itemId) : undefined
    return reminder?.sessionID ? new Set([reminder.sessionID]) : new Set<string>()
  }
  if (selection.kind === "memory") {
    const memory = selection.itemId ? input.memories.find((item) => item.id === selection.itemId) : undefined
    return memory?.sourceSessionID ? new Set([memory.sourceSessionID]) : new Set<string>()
  }
  return new Set<string>()
}
