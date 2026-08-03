import { describe, expect, test } from "bun:test"
import { computeTodoProgress, flipTaskStatus, normalizePriority, normalizeStatus } from "./session-todo-progress-model"

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
