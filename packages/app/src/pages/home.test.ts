import { describe, expect, test } from "bun:test"
import { filterSessionsByMode } from "./layout/helpers"

describe("filterSessionsByMode", () => {
  test("keeps only sessions whose mode matches", () => {
    const records = [
      { session: { mode: "work" as const } },
      { session: { mode: "chat" as const } },
      { session: { mode: "coding" as const } },
    ]
    expect(filterSessionsByMode(records, "work")).toHaveLength(1)
  })

  test("undefined-mode sessions surface only in coding mode", () => {
    const records = [{ session: {} }, { session: { mode: "coding" as const } }]
    expect(filterSessionsByMode(records, "work")).toHaveLength(0)
    expect(filterSessionsByMode(records, "coding")).toHaveLength(2)
  })
})
