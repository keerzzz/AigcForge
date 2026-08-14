import type { KbNoteNote, PersonalMemoryInfo, ScheduleInfo } from "@aigcfroge/sdk/v2/client"

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

/** Builds an arbitrary-depth tag tree and deduplicated subtree counts. */
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
  // A note with overlapping tags such as "a" and "a/b" counts once per subtree.
  const aggregate = (node: KbTagNode): number => {
    const seen = new Set<string>()
    const collect = (current: KbTagNode): number => {
      let count = 0
      for (const note of current.notes) {
        if (seen.has(note.id)) continue
        seen.add(note.id)
        count += 1
      }
      for (const child of current.children ?? []) count += collect(child)
      return count
    }
    node.count = collect(node)
    return node.count
  }
  const groups = [...root.values()]
  sortTree(groups)
  for (const group of groups) aggregate(group)
  const result = [...groups]
  if (untagged.count > 0) result.push(untagged)
  return result
}

/** Resolves the source Session highlighted by the selected Assistant entity. */
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
