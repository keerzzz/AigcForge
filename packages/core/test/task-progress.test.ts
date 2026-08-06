import { describe, expect, test } from "bun:test"
import { childCompletionRatio } from "@aigcfroge/core/tool/task"

describe("childCompletionRatio (P2-b)", () => {
  test("returns undefined for an empty task list", () => {
    expect(childCompletionRatio([])).toBeUndefined()
  })

  test("returns 0 progress when no tasks are completed", () => {
    expect(childCompletionRatio([{ status: "pending" }, { status: "in_progress" }])).toEqual({
      progress: 0,
      current: 0,
      total: 2,
    })
  })

  test("returns the completed/total ratio", () => {
    expect(
      childCompletionRatio([
        { status: "completed" },
        { status: "completed" },
        { status: "in_progress" },
        { status: "pending" },
      ]),
    ).toEqual({ progress: 0.5, current: 2, total: 4 })
  })

  test("returns 1 when all tasks are completed", () => {
    expect(childCompletionRatio([{ status: "completed" }, { status: "completed" }])).toEqual({
      progress: 1,
      current: 2,
      total: 2,
    })
  })

  test("only counts completed status (cancelled/failed/scheduled do not count)", () => {
    expect(
      childCompletionRatio([
        { status: "completed" },
        { status: "cancelled" },
        { status: "failed" },
        { status: "scheduled" },
        { status: "pending" },
      ]),
    ).toEqual({ progress: 0.2, current: 1, total: 5 })
  })
})
