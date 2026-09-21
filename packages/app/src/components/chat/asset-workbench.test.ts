import { createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
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
  countAssetsByKind,
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
  // S6: the server projection carries the modes this agent may serve as primary.
  primaryModes: ["coding"],
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

// S3-3: the sidebar's old number was `projectCount + systemCountFor(unshadowed system)`,
// computed from its own duplicated request set. These cases pin the replacement —
// a per-kind tally of the merged rows — against that formula, including the plugin
// case the two rules could plausibly have disagreed on (bridged rows ride inside the
// project array, so `mergeAssets` never shadows them against project plugins).
describe("countAssetsByKind", () => {
  const projectPlugin = { kind: "plugin" as const, name: "shared", description: "", relativePath: "p", revision: "" }
  const bridgedPlugin = {
    kind: "plugin" as const,
    name: "shared",
    description: "",
    relativePath: "b",
    revision: "",
    origin: "system" as const,
  }
  const systemRows = [
    { kind: "skill" as const, name: "fmt", description: "" },
    { kind: "skill" as const, name: "lint", description: "" },
    { kind: "command" as const, name: "run", description: "" },
  ]

  test("counts each merged row by its kind", () => {
    const merged = mergeAssets(
      [{ kind: "prompt", name: "p", description: "", relativePath: "p", revision: "" }],
      systemRows,
    )
    expect(countAssetsByKind(merged)).toEqual({ prompt: 1, skill: 2, command: 1 })
  })

  test("older formula agrees for system-shadowed kinds", () => {
    const project = [{ kind: "skill" as const, name: "fmt", description: "", relativePath: "fmt", revision: "" }]
    const merged = mergeAssets(project, systemRows)
    // `fmt` is project-owned here, so only `lint` comes from the system: the tally
    // equals project count + unshadowed system count, which is what the sidebar used.
    expect(countAssetsByKind(merged).skill).toBe(1 + 1)
  })

  test("counts bridged plugins as plugin, and does not dedup them against a same-named project plugin", () => {
    const merged = mergeAssets([projectPlugin, bridgedPlugin], [])
    expect(countAssetsByKind(merged).plugin).toBe(2)
  })

  test("systemAssets contributes no plugin rows, so plugin counts are project plus bridged only", () => {
    const system = systemAssets({ commands: [{ name: "c", source: "command" }], agents: [], mcp: {} })
    expect(system.filter((row) => row.kind === "plugin")).toEqual([])
    expect(countAssetsByKind(mergeAssets([projectPlugin, bridgedPlugin], system))).toEqual({ plugin: 2, command: 1 })
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

// Still source-level, and knowingly so: both assert that the panel REUSES the shared
// file-tab strip and diff variant rather than forking its own, which is a property of the
// module graph, not of a render. The behavioural equivalent needs an overwrite-diff e2e
// (recorded in docs/technical-debt.md alongside the Work panel's twin block).
describe("Chat right panel shared detail mechanisms (Phase 3)", () => {
  const panel = fs.readFileSync(path.resolve(__dirname, "chat-right-panel.tsx"), "utf-8")

  test("uses the shared file-tab strip and Chat diff variant", () => {
    expect(panel).toContain("<SessionFileTabStrip")
    expect(panel).toContain("<TextDiffView")
    expect(panel).toContain('variant="chat"')
  })

  test("keeps Chat asset file-tree ownership explicit", () => {
    expect(panel).toContain('path=".aigcfroge"')
    expect(panel).toContain("searchAllowed")
  })
})
