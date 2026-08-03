import { describe, expect, test } from "bun:test"
import {
  computeTodoProgress,
  flipTaskStatus,
  normalizePriority,
  normalizeStatus,
  pickProgressTodos,
  type TodoProgressInput,
} from "./session-todo-progress-model"

describe("computeTodoProgress", () => {
  test("empty array has total 0 and ratio 0", () => {
    const p = computeTodoProgress([])
    expect(p.total).toBe(0)
    expect(p.done).toBe(0)
    expect(p.doneRatio).toBe(0)
    expect(p.nodes).toEqual([])
  })

  test("doneRatio is completed over total; cancelled is not counted as done", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "in_progress" },
      { content: "d", status: "pending" },
      { content: "e", status: "cancelled" },
    ])
    expect(p.total).toBe(5)
    expect(p.done).toBe(2)
    expect(p.doneRatio).toBe(2 / 5)
  })

  test("all completed pushes doneRatio to 1", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
    ])
    expect(p.doneRatio).toBe(1)
  })

  test("all pending keeps doneRatio at 0", () => {
    const p = computeTodoProgress([{ content: "a", status: "pending" }])
    expect(p.doneRatio).toBe(0)
  })

  test("illegal status is normalized to pending without crashing", () => {
    const p = computeTodoProgress([{ content: "a", status: "bogus" }])
    expect(p.nodes[0]?.status).toBe("pending")
    expect(p.doneRatio).toBe(0)
  })

  test("single node is positioned at 50% (no divide-by-zero)", () => {
    const p = computeTodoProgress([{ content: "only", status: "pending" }])
    expect(p.nodes).toHaveLength(1)
    expect(p.nodes[0]?.pct).toBe(50)
  })

  test("multiple nodes spread across 0-100", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
      { content: "c", status: "pending" },
    ])
    expect(p.nodes.map((n) => n.pct)).toEqual([0, 50, 100])
  })

  test("anchor is the first in_progress node", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "in_progress" },
    ])
    expect(p.nodes.findIndex((n) => n.anchor)).toBe(1)
  })

  test("no in_progress leaves no anchor", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "completed" },
    ])
    expect(p.nodes.some((n) => n.anchor)).toBe(false)
  })

  test(">20 nodes are downsampled to first, anchor, and last with original positions", () => {
    const todos = Array.from({ length: 25 }, (_, i) => ({
      content: `t${i}`,
      status: i === 10 ? "in_progress" : "pending",
    }))
    const p = computeTodoProgress(todos)
    expect(p.total).toBe(25)
    expect(p.nodes.length).toBeLessThan(25)
    expect(p.nodes[0]?.pct).toBe(0)
    expect(p.nodes.at(-1)?.pct).toBe(100)
    // the in_progress anchor (index 10) survives downsampling at its original pct
    expect(p.nodes.some((n) => n.pct === (10 / 24) * 100)).toBe(true)
  })

  test("downsampling marks each omitted gap with an ellipsis midpoint", () => {
    const todos = Array.from({ length: 25 }, (_, i) => ({
      content: `t${i}`,
      status: i === 10 ? "in_progress" : "pending",
    }))
    const p = computeTodoProgress(todos)
    // gaps 0→10 and 10→24 both omit nodes, so two ellipsis markers appear at
    // the gap midpoints (plan §5.5 "中间省略点")
    expect(p.ellipsis).toEqual([((10 / 24) * 100) / 2, ((10 / 24) * 100 + 100) / 2])
  })

  test("downsampling without an interior anchor marks one ellipsis gap", () => {
    const todos = Array.from({ length: 25 }, (_, i) => ({ content: `t${i}`, status: "pending" }))
    const p = computeTodoProgress(todos)
    expect(p.nodes).toHaveLength(2)
    expect(p.ellipsis).toEqual([50])
  })

  test("at or below the limit no ellipsis markers appear", () => {
    const p = computeTodoProgress(Array.from({ length: 20 }, (_, i) => ({ content: `t${i}`, status: "pending" })))
    expect(p.nodes).toHaveLength(20)
    expect(p.ellipsis).toEqual([])
  })

  test("cancelled nodes are excluded from done but still rendered greyed", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "cancelled" },
    ])
    expect(p.done).toBe(1)
    expect(p.nodes.map((n) => n.status)).toEqual(["completed", "cancelled"])
  })
})

describe("normalizeStatus", () => {
  test("keeps valid literal statuses", () => {
    expect(normalizeStatus("pending")).toBe("pending")
    expect(normalizeStatus("in_progress")).toBe("in_progress")
    expect(normalizeStatus("completed")).toBe("completed")
    expect(normalizeStatus("cancelled")).toBe("cancelled")
  })

  test("maps illegal or empty values to pending", () => {
    expect(normalizeStatus("anything")).toBe("pending")
    expect(normalizeStatus("")).toBe("pending")
  })
})

describe("flipTaskStatus", () => {
  test("checking an unfinished task completes it", () => {
    expect(flipTaskStatus("pending")).toBe("completed")
    expect(flipTaskStatus("in_progress")).toBe("completed")
  })

  test("unchecking a completed task returns it to pending", () => {
    expect(flipTaskStatus("completed")).toBe("pending")
  })

  test("cancelled tasks are left untouched", () => {
    expect(flipTaskStatus("cancelled")).toBe("cancelled")
  })
})

describe("normalizePriority", () => {
  test("keeps valid literal priorities", () => {
    expect(normalizePriority("high")).toBe("high")
    expect(normalizePriority("low")).toBe("low")
  })

  test("maps missing or illegal priorities to medium", () => {
    expect(normalizePriority(undefined)).toBe("medium")
    expect(normalizePriority("urgent")).toBe("medium")
  })
})

describe("pickProgressTodos (⑦ double-source freshness)", () => {
  const t = (content: string, status: string): TodoProgressInput => ({ content, status })
  const seed = [t("a", "pending"), t("b", "pending")]
  const live = [t("a", "pending"), t("b", "completed")]

  test("V1: seeded session_task is not locked when a later todo.updated arrives", () => {
    expect(pickProgressTodos(seed, 100, live, 200)).toEqual(live)
  })

  test("V1: the todo.updated stream keeps winning while it continues", () => {
    const more = [t("a", "completed"), t("b", "completed")]
    expect(pickProgressTodos(seed, 100, more, 300)).toEqual(more)
  })

  test("V1: empty task seed defers to the populated todo source", () => {
    expect(pickProgressTodos([], 100, live, 150)).toEqual(live)
  })

  test("V2: paired todo.updated echo arriving after task.updated (same content) stays on the id-bearing task source", () => {
    const list = [t("a", "in_progress"), t("b", "pending")]
    const echo = list.map((x) => ({ ...x }))
    // The echo has the newer timestamp, but equal content — writeback must survive.
    expect(pickProgressTodos(list, 100, echo, 101)).toEqual(list)
  })

  test("V2: equivalence ignores ids (the todo projection is id-less)", () => {
    const withIds = [
      { id: "x1", content: "a", status: "pending" },
      { id: "x2", content: "b", status: "pending" },
    ]
    const echo = [t("a", "pending"), t("b", "pending")]
    expect(pickProgressTodos(withIds, 100, echo, 101)).toEqual(withIds)
  })

  test("diverging sources pick the later writer", () => {
    expect(pickProgressTodos(live, 300, seed, 200)).toEqual(live)
  })

  test("tie on timestamps with diverging content prefers the id-bearing task source", () => {
    expect(pickProgressTodos(live, 200, seed, 200)).toEqual(live)
  })

  test("no task source yet defers to todo once it has written", () => {
    expect(pickProgressTodos(undefined, undefined, live, 150)).toEqual(live)
  })

  test("only a task source renders it", () => {
    expect(pickProgressTodos(seed, 100, undefined, undefined)).toEqual(seed)
  })

  test("both sources empty yields an empty list", () => {
    expect(pickProgressTodos(undefined, undefined, undefined, undefined)).toEqual([])
  })
})

describe("fillEndPct (M7 决策 4 填充终点索引语义)", () => {
  test("with an in_progress anchor the fill ends at the anchor's pct", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
    ])
    expect(p.fillEndPct).toBe(50)
    expect(p.nodes.find((n) => n.anchor)?.pct).toBe(50)
  })

  test("no anchor: ends at the last completed node's pct", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
      { content: "c", status: "completed" },
      { content: "d", status: "pending" },
    ])
    expect(p.fillEndPct).toBeCloseTo((2 / 3) * 100, 5)
  })

  test("all completed runs through to 100", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
    ])
    expect(p.fillEndPct).toBe(100)
  })

  test("empty array has fillEndPct 0", () => {
    expect(computeTodoProgress([]).fillEndPct).toBe(0)
  })

  test("single in_progress node anchors the fill at its centered pct", () => {
    expect(computeTodoProgress([{ content: "x", status: "in_progress" }]).fillEndPct).toBe(50)
  })

  test("all pending (no in_progress, no completed) has fillEndPct 0", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
    ])
    expect(p.fillEndPct).toBe(0)
  })

  test("lastCompletedPct is the last completed node even with a later anchor", () => {
    const p = computeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "in_progress" },
      { content: "d", status: "pending" },
    ])
    expect(p.lastCompletedPct).toBeCloseTo((1 / 3) * 100, 5)
    // fill stops at the anchor (决策 4), not the last completed node.
    expect(p.fillEndPct).toBeCloseTo((2 / 3) * 100, 5)
  })

  test("lastCompletedPct is 0 when nothing is completed", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "in_progress" },
    ])
    expect(p.lastCompletedPct).toBe(0)
  })

  test("lastCompletedPct follows the inset pct when a track width is given", () => {
    const p = computeTodoProgress(
      [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ],
      { trackWidth: 200 },
    )
    expect(p.lastCompletedPct).toBeCloseTo(4, 5)
    expect(p.fillEndPct).toBeCloseTo(96, 5)
  })
})

describe("pct inset (M7 决策 3 两端 8px 内缩)", () => {
  const width = 200 // 8px = 4% of the track width

  test("nodes are inset 8px from each edge when a track width is given", () => {
    const p = computeTodoProgress(
      [
        { content: "a", status: "pending" },
        { content: "b", status: "pending" },
        { content: "c", status: "pending" },
      ],
      { trackWidth: width },
    )
    expect(p.nodes[0]?.pct).toBeCloseTo(4, 5)
    expect(p.nodes[1]?.pct).toBe(50)
    expect(p.nodes[2]?.pct).toBeCloseTo(96, 5)
  })

  test("single node stays centered regardless of the inset", () => {
    const p = computeTodoProgress([{ content: "only", status: "pending" }], { trackWidth: width })
    expect(p.nodes[0]?.pct).toBe(50)
  })

  test("without a track width the inset is zero (index pct preserved)", () => {
    const p = computeTodoProgress([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
      { content: "c", status: "pending" },
    ])
    expect(p.nodes.map((n) => n.pct)).toEqual([0, 50, 100])
  })

  test("fillEndPct follows the inset pct of a leading anchor", () => {
    const p = computeTodoProgress(
      [
        { content: "a", status: "in_progress" },
        { content: "b", status: "pending" },
      ],
      { trackWidth: width },
    )
    expect(p.nodes[0]?.pct).toBeCloseTo(4, 5)
    expect(p.fillEndPct).toBeCloseTo(4, 5)
  })
})
