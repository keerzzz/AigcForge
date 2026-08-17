import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("mode launch helper call-site contract (Phase 7)", () => {
  test("project-opening mode entry points use launchModeSession", () => {
    for (const file of [
      "../app.tsx",
      "../components/mode-location-new-session.tsx",
      "../components/mode-surfaces.tsx",
      "../components/secondary-sidebar.tsx",
      "../components/titlebar.tsx",
      "./assistant-dashboard.tsx",
      "./home-overview.tsx",
      "./mode-workspace-slots.tsx",
      "./session.tsx",
    ]) {
      const source = read(file)
      expect(source).toContain("launchModeSession")
      expect(source).not.toContain("openProjectNewSession(")
    }
  })

  test("non-project lifecycle exceptions retain their Draft fields and prompts", () => {
    const titlebar = read("../components/titlebar.tsx")
    const assetSelector = read("../components/chat/asset-session-selector.tsx")
    const command = read("./session/use-session-commands.tsx")
    const timeline = read("./session/timeline/message-timeline.tsx")

    expect(titlebar).toContain("...modeDraft(mode.currentMode)")
    expect(assetSelector).toContain('...modeDraft("chat")')
    expect(assetSelector).toContain("tabs.newDraft(")
    expect(command).toContain("mode: mode.currentMode")
    expect(timeline).toContain("mode: mode.currentMode")
  })
})
