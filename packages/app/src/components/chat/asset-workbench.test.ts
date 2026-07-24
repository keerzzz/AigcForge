import { createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import type { PromptAssetInvalidEntry, PromptAssetSummary } from "@aigcfroge/sdk/v2/client"
import {
  buildRows,
  createAssetWorkbenchStore,
  filterByKind,
  filterBySearch,
  sortRows,
} from "./asset-workbench"

const asset = (over: Partial<PromptAssetSummary> = {}): PromptAssetSummary => ({
  kind: "prompt",
  name: "my-prompt",
  description: "a prompt",
  relativePath: "my-prompt.md",
  revision: "a".repeat(64),
  ...over,
})

const invalid = (over: Partial<PromptAssetInvalidEntry> = {}): PromptAssetInvalidEntry => ({
  relativePath: "broken.md",
  errorTag: "parse_error",
  ...over,
})

describe("buildRows", () => {
  test("merges valid assets and invalid entries", () => {
    const rows = buildRows([asset()], [invalid()])
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => !r.invalid)).toHaveLength(1)
    expect(rows.filter((r) => r.invalid)).toHaveLength(1)
  })

  test("valid rows carry name/description/revision", () => {
    const rows = buildRows([asset({ name: "x", description: "d", revision: "b".repeat(64) })], [])
    expect(rows[0]).toMatchObject({ name: "x", description: "d", revision: "b".repeat(64), invalid: false })
  })

  test("invalid rows carry errorTag and empty revision/name", () => {
    const rows = buildRows([], [invalid({ relativePath: "bad.md", errorTag: "bad_frontmatter" })])
    expect(rows[0]).toMatchObject({
      relativePath: "bad.md",
      errorTag: "bad_frontmatter",
      invalid: true,
      revision: "",
      name: "",
    })
  })
})

describe("filterBySearch", () => {
  const rows = buildRows(
    [asset({ name: "greet", description: "says hi", relativePath: "greet.md" })],
    [invalid({ relativePath: "broken.md" })],
  )

  test("empty or whitespace search returns all rows", () => {
    expect(filterBySearch(rows, "")).toHaveLength(2)
    expect(filterBySearch(rows, "   ")).toHaveLength(2)
  })

  test("matches name case-insensitive", () => {
    const matched = filterBySearch(rows, "GREET")
    expect(matched).toHaveLength(1)
    expect(matched[0].name).toBe("greet")
  })

  test("matches relativePath for invalid rows", () => {
    const matched = filterBySearch(rows, "broken")
    expect(matched).toHaveLength(1)
    expect(matched[0].invalid).toBe(true)
  })

  test("matches description", () => {
    const matched = filterBySearch(rows, "says")
    expect(matched).toHaveLength(1)
  })

  test("returns no rows on no match", () => {
    expect(filterBySearch(rows, "zzz")).toHaveLength(0)
  })
})

describe("filterByKind", () => {
  const rows = buildRows([asset()], [invalid()])

  test("all returns every row", () => {
    expect(filterByKind(rows, "all")).toHaveLength(2)
  })

  test("prompt returns prompt-kind rows", () => {
    expect(filterByKind(rows, "prompt")).toHaveLength(2)
  })
})

describe("sortRows", () => {
  test("sorts by name, invalid rows last", () => {
    const rows = buildRows(
      [asset({ name: "zebra", relativePath: "z.md" }), asset({ name: "alpha", relativePath: "a.md" })],
      [invalid({ relativePath: "broken.md" })],
    )
    const sorted = sortRows(rows)
    expect(sorted.map((r) => r.name)).toEqual(["alpha", "zebra", ""])
    expect(sorted[2].invalid).toBe(true)
  })
})

describe("createAssetWorkbenchStore", () => {
  test("select sets and clears selectedPath", () => {
    createRoot((dispose) => {
      const store = createAssetWorkbenchStore()
      expect(store.state.selectedPath).toBeUndefined()
      store.select("foo.md")
      expect(store.state.selectedPath).toBe("foo.md")
      store.select(undefined)
      expect(store.state.selectedPath).toBeUndefined()
      dispose()
    })
  })

  test("setKindFilter and setSearch update state", () => {
    createRoot((dispose) => {
      const store = createAssetWorkbenchStore()
      store.setKindFilter("prompt")
      store.setSearch("hello")
      expect(store.state.kindFilter).toBe("prompt")
      expect(store.state.search).toBe("hello")
      dispose()
    })
  })
})
