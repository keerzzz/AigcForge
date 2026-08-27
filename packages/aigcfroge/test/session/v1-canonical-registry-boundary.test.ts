import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// ADR-19 §2.1/§2.7 "V1 单向隔离": the V1 session tool assembly must keep using
// its OWN registry (`@/tool/registry`) and must never register anything into
// the canonical V2 `ToolRegistry` — otherwise V1 MCP tools would flow into
// `materialize()` and land in Custom Mode Snapshot catalogs and fingerprints.
//
// This is a source contract rather than a behavioural test on purpose: the two
// registries are distinct modules that share a name, so the boundary is one
// import line away from being erased by a refactor, and nothing else would
// fail. Isolation holds structurally today (V1 builds a local
// `Record<string, AITool>` from `mcp.tools()`), so there is no runtime seam to
// observe.
const V1_SESSION_TOOLS = join(import.meta.dir, "../../src/session/tools.ts")

describe("V1 / canonical registry boundary (ADR-19 §2.7)", () => {
  const source = readFileSync(V1_SESSION_TOOLS, "utf8")

  it("resolves ToolRegistry from the V1 module, not from core", () => {
    expect(source).toContain('import { ToolRegistry } from "@/tool/registry"')
    expect(source).not.toContain("@aigcfroge/core/tool/registry")
  })

  it("never registers V1 MCP tools into the canonical registry", () => {
    // V1 collects MCP tools into its own record; any `register`/`registerSession`
    // call here would mean V1 tools reach the canonical materialize path.
    expect(source).not.toMatch(/registry\.register(Session)?\s*\(/)
    expect(source).toMatch(/yield\* mcp\.tools\(\)/)
  })
})
