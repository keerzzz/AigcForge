import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

describe("DelegationPanel AgentTaskHub wiring", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "agent-task-hub.tsx"), "utf8")

  test("renders functional states and participant navigation in the existing hub", () => {
    expect(source).toContain('data-component="delegation-panel"')
    expect(source).toContain('data-component="delegation-card"')
    expect(source).toContain("data-status={delegation.status}")
    expect(source).toContain('data-component="delegation-participants"')
    expect(source).toContain("openParticipant(participant.href)")
  })

  test("renders explicit history, loading, empty and error states", () => {
    expect(source).toContain('language.t("session.agentHub.delegations")')
    expect(source).toContain('language.t("session.agentHub.delegations.showHistory")')
    expect(source).toContain('data-component="delegation-panel-loading"')
    expect(source).toContain('data-component="delegation-panel-empty"')
    expect(source).toContain('data-component="delegation-panel-error"')
  })

  test("keeps the panel in the responsive popover boundary", () => {
    expect(source).toContain('style={{ "min-width": "320px", "max-height": "min(70vh, 520px)" }}')
    expect(source).toContain('class="flex flex-wrap gap-1"')
  })
})
