import { describe, expect, test } from "bun:test"
import { countByMode, pinLastActive } from "./home-overview-model"

describe("countByMode", () => {
  test("counts chat and work sessions into their own buckets", () => {
    const records = [
      { session: { mode: "chat" as const } },
      { session: { mode: "chat" as const } },
      { session: { mode: "work" as const } },
    ]
    expect(countByMode(records)).toEqual({ coding: 0, chat: 2, work: 1 })
  })

  test("undefined-mode sessions count as coding (D3)", () => {
    const records = [{ session: {} }, { session: { mode: "coding" as const } }]
    expect(countByMode(records)).toEqual({ coding: 2, chat: 0, work: 0 })
  })

  test("empty records yield zero counts", () => {
    expect(countByMode([])).toEqual({ coding: 0, chat: 0, work: 0 })
  })
})

describe("pinLastActive", () => {
  const record = (id: string, directory: string) => ({
    session: { id, directory, title: `session ${id}` },
  })

  test("pins the matching record first and removes it from rest", () => {
    const records = [record("a", "/proj"), record("b", "/proj"), record("c", "/other")]
    const result = pinLastActive(records, { directory: "/proj", sessionID: "b" })
    expect(result.pinned).toEqual(record("b", "/proj"))
    expect(result.rest.map((r) => r.session.id)).toEqual(["a", "c"])
  })

  test("no match returns no pinned record and keeps all records", () => {
    const records = [record("a", "/proj")]
    const result = pinLastActive(records, { directory: "/proj", sessionID: "ghost" })
    expect(result.pinned).toBeUndefined()
    expect(result.rest).toHaveLength(1)
  })

  test("archived (no longer listed) last active yields no pinned group", () => {
    const records = [record("a", "/proj")]
    const result = pinLastActive(records, { directory: "/gone", sessionID: "a" })
    expect(result.pinned).toBeUndefined()
    expect(result.rest).toHaveLength(1)
  })

  test("pathKey normalizes directory comparison (trailing slash)", () => {
    const records = [record("a", "/proj")]
    const result = pinLastActive(records, { directory: "/proj/", sessionID: "a" })
    expect(result.pinned).toEqual(record("a", "/proj"))
    expect(result.rest).toHaveLength(0)
  })

  test("undefined last active never pins", () => {
    const records = [record("a", "/proj")]
    const result = pinLastActive(records, undefined)
    expect(result.pinned).toBeUndefined()
    expect(result.rest).toHaveLength(1)
  })
})
