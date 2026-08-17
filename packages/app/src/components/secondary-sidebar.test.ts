import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { computeAutoSync } from "./secondary-sidebar-autosync"

// Tests for the auto-sync decision logic extracted from SecondarySidebar's
// createEffect. Per AGENTS.md ("test actual implementation; do not duplicate
// logic into tests"), we test the pure function directly rather than re-encoding
// the decision logic in the test.
//
// The effect in secondary-sidebar.tsx calls computeAutoSync(dir, list) inside
// untrack, then applies the returned decisions to the collapsed/expanded stores.
// untrack is essential there (without it, a manual toggle re-runs the effect
// and overwrites the user's choice) — see the effect's comment for the rationale.

describe("computeAutoSync", () => {
  test("expands the project containing dir, collapses others", () => {
    const list = [
      { worktree: "/repo/active", sandboxes: [] as string[] },
      { worktree: "/repo/other", sandboxes: [] as string[] },
    ]

    expect(computeAutoSync("/repo/active", list)).toEqual([
      { worktree: "/repo/active", collapsed: false, expandWorktree: "/repo/active" },
      { worktree: "/repo/other", collapsed: true },
    ])
  })

  test("when dir is a sandbox, expands the sandbox workspace (not just the parent worktree)", () => {
    const list = [{ worktree: "/repo/main", sandboxes: ["/repo/main/.sandbox1"] }]

    expect(computeAutoSync("/repo/main/.sandbox1", list)).toEqual([
      { worktree: "/repo/main", collapsed: false, expandWorktree: "/repo/main/.sandbox1" },
    ])
  })

  test("when dir is not in any project, all projects collapse", () => {
    const list = [
      { worktree: "/repo/a", sandboxes: [] as string[] },
      { worktree: "/repo/b", sandboxes: [] as string[] },
    ]

    expect(computeAutoSync("/repo/unrelated", list)).toEqual([
      { worktree: "/repo/a", collapsed: true },
      { worktree: "/repo/b", collapsed: true },
    ])
  })

  test("handles missing sandboxes (undefined) as no extra workspaces", () => {
    const list = [{ worktree: "/repo/a" }]

    expect(computeAutoSync("/repo/a", list)).toEqual([
      { worktree: "/repo/a", collapsed: false, expandWorktree: "/repo/a" },
    ])
  })

  test("trailing-slash differences are normalized via pathKey (sandbox matches bare worktree)", () => {
    const list = [{ worktree: "/repo/active/", sandboxes: [] as string[] }]

    expect(computeAutoSync("/repo/active", list)).toEqual([
      { worktree: "/repo/active/", collapsed: false, expandWorktree: "/repo/active/" },
    ])
  })
})

describe("SecondarySidebar mode dispatch contract (Phase 5)", () => {
  const secondary = fs.readFileSync(path.resolve(__dirname, "secondary-sidebar.tsx"), "utf-8")
  const workspace = fs.readFileSync(path.resolve(__dirname, "../pages/mode-workspace.tsx"), "utf-8")

  test("ModeWorkspace keeps all mode slots mounted with display:none switching", () => {
    expect(workspace).toContain("For each={ALL_SLOTS}")
    expect(workspace).toContain('style={{ display: mode.currentMode === slot ? "" : "none" }}')
    expect(workspace).toContain('style={{ display: mode.currentMode === slot ? "flex" : "none" }}')
  })

  test("SecondarySidebar keeps explicit Chat/Work/Assistant owners", () => {
    expect(secondary).toContain("<ChatFeatureSidebar />")
    expect(secondary).toContain("<WorkSecondarySidebar")
    expect(secondary).toContain("<AssistantSessionSidebar")
    expect(secondary).not.toContain("MODE_SURFACES")
    expect(secondary).not.toContain("ModeRegistry")
  })

  test("SecondarySidebar does not use HomeSessionSearch for project or asset navigation", () => {
    expect(secondary).not.toContain("HomeSessionSearch")
  })

  test("documents the separate ChatFeatureSidebar secondary instance", () => {
    expect(secondary).toContain("secondary-sidebar instance")
    expect(secondary).toContain("ModeWorkspace mounts the primary slot instance")
  })
})
