import { describe, expect, test } from "bun:test"
import { buildKbTagTree, sessionHighlightIDs, type KbTagNode } from "./assistant-nav-model"
import type { KbNoteNote, PersonalMemoryInfo, ScheduleInfo } from "@aigcfroge/sdk/v2/client"

// 批次 2 G3：实体导航树数据模型（标签层级聚合 + 计数）与会话列表联动
// （提醒 sessionID / 记忆 sourceSessionID 反查；知识库退化为全量）。

const note = (id: string, title: string, tags: string[]): KbNoteNote =>
  ({ id, title, content: "", scope: "global", tags, format: "note", createdAt: 0, updatedAt: 0 }) as KbNoteNote

describe("buildKbTagTree", () => {
  test("aggregates notes by tag with counts (alphabetical order)", () => {
    const tree = buildKbTagTree([note("a", "A", ["work"]), note("b", "B", ["work"]), note("c", "C", ["personal"])])
    expect(tree.map((n) => n.tag)).toEqual(["personal", "work"])
    expect(tree[1]?.count).toBe(2)
    expect(tree[0]?.count).toBe(1)
  })

  test("splits hierarchical tags #tag/subtag into nested nodes", () => {
    const tree = buildKbTagTree([
      note("a", "A", ["work/planning"]),
      note("b", "B", ["work/review"]),
      note("c", "C", ["work"]),
    ])
    expect(tree).toHaveLength(1)
    const work = tree[0] as KbTagNode
    expect(work.tag).toBe("work")
    expect(work.count).toBe(3)
    expect(work.children?.map((n) => n.tag)).toEqual(["planning", "review"])
  })

  test("keeps untagged notes in a dedicated bucket", () => {
    const tree = buildKbTagTree([note("a", "A", []), note("b", "B", [])])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.tag).toBe("__untagged__")
    expect(tree[0]?.count).toBe(2)
    expect(tree[0]?.notes).toHaveLength(2)
  })

  test("sorts tag groups alphabetically for stable navigation", () => {
    const tree = buildKbTagTree([note("a", "A", ["zeta"]), note("b", "B", ["alpha"])])
    expect(tree.map((n) => n.tag)).toEqual(["alpha", "zeta"])
  })

  test("counts a note once when it carries overlapping hierarchical tags (LOW fix)", () => {
    const tree = buildKbTagTree([note("a", "A", ["work", "work/planning"]), note("b", "B", ["work/planning"])])
    expect(tree).toHaveLength(1)
    const work = tree[0] as KbTagNode
    expect(work.count).toBe(2)
    const planning = work.children?.[0]
    expect(planning?.count).toBe(2)
  })

  test("dedupes across sibling subtrees sharing the same note (LOW fix)", () => {
    const tree = buildKbTagTree([note("a", "A", ["work/planning", "work/review"])])
    expect(tree[0]?.count).toBe(1)
  })
})

describe("sessionHighlightIDs (D5 会话列表联动)", () => {
  const reminders: ScheduleInfo[] = [
    { id: "sch_1", sessionID: "sess_1", kind: "reminder", content: "r1", dueAt: 1, timezone: "UTC", status: "pending", attempts: 0, deliveryKey: "k", createdAt: 0, updatedAt: 0 } as ScheduleInfo,
    { id: "sch_2", sessionID: "sess_2", kind: "reminder", content: "r2", dueAt: 1, timezone: "UTC", status: "pending", attempts: 0, deliveryKey: "k", createdAt: 0, updatedAt: 0 } as ScheduleInfo,
  ]
  const memories: PersonalMemoryInfo[] = [
    {
      id: "mem_1",
      content: "m1",
      source: "derived",
      trustLevel: "medium",
      sensitivityLevel: "low",
      status: "confirmed",
      sourceSessionID: "sess_3",
      createdAt: 0,
      updatedAt: 0,
    },
  ]

  test("highlights the session that created a selected reminder", () => {
    const ids = sessionHighlightIDs({ selection: { kind: "reminders", itemId: "sch_1" }, reminders, memories })
    expect(ids).toEqual(new Set(["sess_1"]))
  })

  test("highlights the source session of a selected memory", () => {
    const ids = sessionHighlightIDs({ selection: { kind: "memory", itemId: "mem_1" }, reminders, memories })
    expect(ids).toEqual(new Set(["sess_3"]))
  })

  test("knowledge base selection degrades to the full list (no session backlink)", () => {
    const ids = sessionHighlightIDs({ selection: { kind: "kb" }, reminders, memories })
    expect(ids.size).toBe(0)
    const dangling = sessionHighlightIDs({ selection: { kind: "dangling" }, reminders, memories })
    expect(dangling.size).toBe(0)
  })

  test("unknown or missing item ids highlight nothing", () => {
    expect(sessionHighlightIDs({ selection: { kind: "reminders", itemId: "sch_nope" }, reminders, memories }).size).toBe(0)
    expect(sessionHighlightIDs({ selection: undefined, reminders, memories }).size).toBe(0)
  })

  test("a reminder without a session backlink highlights nothing", () => {
    const orphan = reminders.map((r) => ({ ...r, sessionID: "" }))
    const ids = sessionHighlightIDs({ selection: { kind: "reminders", itemId: "sch_1" }, reminders: orphan, memories })
    expect(ids.size).toBe(0)
  })
})
