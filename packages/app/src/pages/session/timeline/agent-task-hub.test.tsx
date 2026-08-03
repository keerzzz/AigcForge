import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// M4 AgentTaskHub entry contract (plan §5.7). The app has no DOM-render
// unit-test harness for Solid components (no solid-testing-library); per the
// mode-workspace.test.tsx precedent this verifies the source-level wiring
// contract, while the behavioural path (open dropdown → click 智能体 → popover
// renders the agent list → PATCH writeback) is covered by the Step-5 E2E.

const hubKeys = [
  "session.agentHub.agents",
  "session.agentHub.derived",
  "session.agentHub.active",
  "session.agentHub.empty",
  "session.agentHub.new",
  "session.agentHub.new.tooltip",
  "session.agentHub.unassigned",
  "session.agentHub.loadFailed",
] as const

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("AgentTaskHub", () => {
  test("panel lives in timeline (not composer) and renders the three zones", () => {
    const panelPath = path.resolve(__dirname, "agent-task-hub.tsx")
    expect(fs.existsSync(panelPath)).toBe(true)
    const panel = read("agent-task-hub.tsx")
    // Zone 1: selectable agent list. Zone 2: derived tasks. Zone 3: new entry.
    expect(panel).toContain('data-component="agent-task-hub-agent"')
    expect(panel).toContain('data-component="agent-task-hub-task"')
    expect(panel).toContain('data-component="agent-task-hub-new"')
    expect(panel).toContain('data-component="agent-task-hub-agents"')
    expect(panel).toContain('data-component="agent-task-hub-empty"')
  })

  test("no agent-task-hub residue remains in the composer region", () => {
    const composerDir = path.resolve(__dirname, "../composer")
    const hits: string[] = []
    for (const entry of fs.readdirSync(composerDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (read(`../composer/${entry.name}`).includes("agent-task-hub")) hits.push(entry.name)
    }
    expect(hits).toEqual([])
  })

  test("timeline entry wires the hub menu item and popover anchor", () => {
    const timeline = read("message-timeline.tsx")
    // dot-grid dropdown gains the "智能体" menu item (plan §5.7).
    expect(timeline).toContain('language.t("session.agentHub.agents")')
    // Popover opens from the more button via the M3 pending-delay pattern.
    expect(timeline).toMatch(/<AgentTaskHub[\s\S]*?anchorRef=\{\(\) => more\}/)
    expect(timeline).toMatch(/pendingHub/)
  })

  test("hub i18n keys exist in en, zh and zht", async () => {
    const english = (await import("../../../i18n/en")).dict as Readonly<Record<string, string>>
    for (const key of hubKeys) expect(english[key], `en missing ${key}`).toBeDefined()
    const zh = (await import("../../../i18n/zh")).dict as Readonly<Record<string, string>>
    for (const key of hubKeys) expect(zh[key], `zh missing ${key}`).toBeDefined()
    const zht = (await import("../../../i18n/zht")).dict as Readonly<Record<string, string>>
    for (const key of hubKeys) expect(zht[key], `zht missing ${key}`).toBeDefined()
  })
})
