import { describe, expect, test } from "bun:test"
import {
  ASSET_KINDS,
  catalogStatus,
  foldAssetCatalog,
  listOutcome,
  showsEmptyState,
  type ListOutcome,
} from "./custom-asset-catalog"

const ok = <T>(assets: T[]): ListOutcome<T> => ({ ok: true, assets })
const failed = <T>(): ListOutcome<T> => ({ ok: false })

const fold = (over: Partial<Parameters<typeof foldAssetCatalog>[0]> = {}) =>
  foldAssetCatalog({
    agents: ok([{ name: "a" }]),
    workflows: ok([{ name: "w" }]),
    prompts: ok([{ name: "p" }]),
    skills: ok([{ name: "s" }]),
    commands: ok([{ name: "c" }]),
    ...over,
  })

describe("listOutcome", () => {
  test("treats a rejection as a failure", () => {
    expect(listOutcome({ status: "rejected", reason: new Error("boom") })).toEqual({ ok: false })
  })

  test("treats a 2xx body with no assets as a genuine empty list, not a failure", () => {
    // The distinction is the whole defect: an empty list is data, a rejection is
    // not, and collapsing them is what hid server errors behind an empty sidebar.
    expect(listOutcome({ status: "fulfilled", value: { data: { assets: [] } } })).toEqual({ ok: true, assets: [] })
    expect(listOutcome({ status: "fulfilled", value: { data: undefined } })).toEqual({ ok: true, assets: [] })
    expect(listOutcome({ status: "fulfilled", value: {} })).toEqual({ ok: true, assets: [] })
  })

  test("passes the assets through untouched", () => {
    expect(listOutcome({ status: "fulfilled", value: { data: { assets: [{ name: "x" }] } } })).toEqual({
      ok: true,
      assets: [{ name: "x" }],
    })
  })
})

describe("foldAssetCatalog", () => {
  test("reports no failures when every list settled", () => {
    expect(fold().failed).toEqual([])
  })

  test("keeps the lists that succeeded when one kind fails", () => {
    // P2-10: a failing kind must not blank the other four.
    const catalog = fold({ skills: failed() })

    expect(catalog.failed).toEqual(["skills"])
    expect(catalog.skills).toEqual([])
    expect(catalog.agents).toEqual([{ name: "a" }])
    expect(catalog.commands).toEqual([{ name: "c" }])
  })

  test("names every failing kind", () => {
    const catalog = fold({ agents: failed(), commands: failed() })
    expect(catalog.failed).toEqual(["agents", "commands"])
  })
})

describe("catalogStatus", () => {
  test("reports idle without a directory SDK", () => {
    expect(catalogStatus({ source: undefined, settledSource: undefined, state: "unresolved", failed: undefined })).toBe(
      "idle",
    )
  })

  test("reports loading before anything settles", () => {
    const source = {}
    expect(catalogStatus({ source, settledSource: undefined, state: "pending", failed: undefined })).toBe("loading")
  })

  test("keeps showing settled data across a same-source refetch", () => {
    const source = {}
    expect(catalogStatus({ source, settledSource: source, state: "refreshing", failed: [] })).toBe("ready")
  })

  test("hides settled data while a different source is loading", () => {
    expect(catalogStatus({ source: {}, settledSource: {}, state: "refreshing", failed: [] })).toBe("loading")
  })

  test("separates a clean read from a partial one and from a total failure", () => {
    const source = {}
    expect(catalogStatus({ source, settledSource: source, state: "ready", failed: [] })).toBe("ready")
    expect(catalogStatus({ source, settledSource: source, state: "ready", failed: ["skills"] })).toBe("partial")
    expect(catalogStatus({ source, settledSource: source, state: "ready", failed: [...ASSET_KINDS] })).toBe("error")
  })
})

describe("showsEmptyState", () => {
  test("offers the starter prompt only after a clean read found nothing", () => {
    expect(showsEmptyState({ status: "ready", agentCount: 0 })).toBe(true)
    expect(showsEmptyState({ status: "ready", agentCount: 1 })).toBe(false)
  })

  test("never offers it on a failed or partial read", () => {
    // P2-13: the zero-agents branch offers "create starter agent", so showing it
    // after a failed fetch invites the user to paper over a server error.
    expect(showsEmptyState({ status: "error", agentCount: 0 })).toBe(false)
    expect(showsEmptyState({ status: "partial", agentCount: 0 })).toBe(false)
    expect(showsEmptyState({ status: "loading", agentCount: 0 })).toBe(false)
  })
})
