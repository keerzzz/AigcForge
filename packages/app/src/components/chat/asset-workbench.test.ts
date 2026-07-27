import { createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import type { Agent, Command, PromptAssetInvalidEntry } from "@aigcfroge/sdk/v2/client"
import type { AssetKindId } from "@aigcfroge/schema/asset"
import {
  buildRows,
  createAssetWorkbenchStore,
  filterByKind,
  filterBySearch,
  isNewButtonDisabled,
  mergeAssets,
  sortRows,
  systemAssets,
  systemCountFor,
  type AssetInput,
} from "./asset-workbench"

const asset = (over: Partial<AssetInput> = {}): AssetInput => ({
  kind: "prompt",
  name: "my-prompt",
  description: "a prompt",
  relativePath: "my-prompt.md",
  revision: "a".repeat(64),
  ...over,
})

const invalid = (
  over: Partial<PromptAssetInvalidEntry> & { kind?: AssetKindId } = {},
): PromptAssetInvalidEntry & { kind: AssetKindId } => ({
  relativePath: "broken.md",
  errorTag: "parse_error",
  kind: "prompt",
  ...over,
})

const systemAsset = (over: Partial<AssetInput> = {}): AssetInput => ({
  kind: "skill",
  name: "fmt",
  description: "format code",
  relativePath: "fmt",
  revision: "",
  origin: "system",
  ...over,
})

const cmd = (over: Partial<Command> = {}): Command => ({
  name: "run",
  template: "run it",
  hints: [],
  ...over,
})

const agent = (over: Partial<Agent> = {}): Agent => ({
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
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

  test("invalid rows carry their own kind instead of defaulting to prompt", () => {
    const rows = buildRows([], [invalid({ kind: "skill" })])
    expect(rows[0].kind).toBe("skill")
    expect(filterByKind(rows, "prompt")).toHaveLength(0)
    expect(filterByKind(rows, "skill")).toHaveLength(1)
  })
})

describe("buildRows origin", () => {
  test("defaults origin to project when input omits it", () => {
    const rows = buildRows([asset()], [])
    expect(rows[0].origin).toBe("project")
  })

  test("carries system origin from input", () => {
    const rows = buildRows([systemAsset()], [])
    expect(rows[0]).toMatchObject({ name: "fmt", origin: "system", invalid: false })
  })

  test("invalid rows are always project origin", () => {
    const rows = buildRows([], [invalid()])
    expect(rows[0].origin).toBe("project")
  })
})

describe("systemAssets", () => {
  test("splits command list into skill and command kinds", () => {
    const items = systemAssets({
      commands: [cmd({ name: "fmt", description: "format", source: "skill" }), cmd({ name: "run" })],
      agents: [],
      mcp: {},
    })
    expect(items).toEqual([
      { kind: "skill", name: "fmt", description: "format" },
      { kind: "command", name: "run", description: "" },
    ])
  })

  test("maps mcp record keys to mcp assets and skips hidden agents", () => {
    const items = systemAssets({
      commands: [],
      agents: [agent({ name: "build", description: "builds" }), agent({ name: "internal", hidden: true })],
      mcp: { github: {} },
    })
    expect(items).toEqual([
      { kind: "mcp", name: "github", description: "" },
      { kind: "agent", name: "build", description: "builds" },
    ])
  })
})

describe("mergeAssets", () => {
  test("appends system rows with system origin", () => {
    const merged = mergeAssets([asset()], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ kind: "skill", name: "fmt", origin: "system", relativePath: "fmt" })
  })

  test("dedups by kind+name, project wins", () => {
    const merged = mergeAssets([asset({ kind: "skill", name: "fmt" })], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(1)
    expect(merged[0].origin).toBe("project")
  })

  test("same name in different kinds is not a duplicate", () => {
    const merged = mergeAssets([asset({ name: "fmt" })], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(2)
  })
})

describe("systemCountFor", () => {
  const system = [
    { kind: "skill", name: "fmt" },
    { kind: "skill", name: "lint" },
    { kind: "command", name: "run" },
  ] as const

  test("counts system items of the given kind", () => {
    expect(systemCountFor(system, "skill", new Set())).toBe(2)
  })

  test("excludes names shadowed by project assets", () => {
    expect(systemCountFor(system, "skill", new Set(["fmt"]))).toBe(1)
  })

  test("returns 0 for kinds without system items", () => {
    expect(systemCountFor(system, "workflow", new Set())).toBe(0)
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

describe("isNewButtonDisabled", () => {
  test("returns true when onNew is undefined (backward compat)", () => {
    expect(isNewButtonDisabled(undefined)).toBe(true)
  })

  test("returns false when onNew callback is provided", () => {
    expect(isNewButtonDisabled(() => {})).toBe(false)
  })
})
