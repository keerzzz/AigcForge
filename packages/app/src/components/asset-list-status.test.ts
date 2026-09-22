import { describe, expect, test } from "bun:test"
import { assetListIsEmpty, assetListStatus } from "./asset-list-status"

describe("assetListStatus", () => {
  test("keeps an unresolved read in loading", () => {
    expect(assetListStatus({ loading: true, failed: undefined, total: 7 })).toBe("loading")
  })

  test("keeps existing rows visible during a refetch", () => {
    expect(assetListStatus({ loading: true, failed: [], total: 7 })).toBe("ready")
  })

  test("distinguishes partial and complete failure", () => {
    expect(assetListStatus({ loading: false, failed: ["prompt"], total: 7 })).toBe("partial")
    expect(assetListStatus({ loading: false, failed: ["a", "b", "c", "d", "e", "f", "g"], total: 7 })).toBe("error")
  })
})

describe("assetListIsEmpty", () => {
  test("shows empty only after a clean read", () => {
    expect(assetListIsEmpty({ status: "ready", count: 0 })).toBe(true)
    expect(assetListIsEmpty({ status: "loading", count: 0 })).toBe(false)
    expect(assetListIsEmpty({ status: "partial", count: 0 })).toBe(false)
  })
})
