import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Phase 2 source-contract tests: lock the real Coding/Location owner boundary.
// Facts asserted (main baseline, verified):
// - Coding sidebar (CodingProjectColumnSidebar) is built on HomeProjectColumn from
//   coding-project-column.tsx; it is NOT ModeLocationNewSession.
// - Work/Assistant sidebars consume ModeLocationNewSession.
// - Chat's ChatFeatureSidebar inlines its own Location + new/add-project logic and
//   additionally owns the feature tree/counts; it does NOT consume ModeLocationNewSession.
// - ModeLocationNewSession does not read CodingSelectionCtx or create a second
//   server/project selection.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const slots = read("../pages/mode-workspace-slots.tsx")
const surfaces = read("../components/mode-surfaces.tsx")
const location = read("../components/mode-location-new-session.tsx")
const chatSidebar = read("../components/mode-surfaces.tsx")
const coding = read("../pages/coding-project-column.tsx")

describe("Coding project tree owner (not ModeLocationNewSession)", () => {
  test("CodingProjectColumnSidebar renders HomeProjectColumn from the Coding owner", () => {
    expect(slots).toContain('import { HomeProjectColumn } from "@/pages/coding-project-column"')
    expect(slots).toContain("<HomeProjectColumn")
  })

  test("CodingProjectColumnSidebar does not render ModeLocationNewSession", () => {
    expect(slots).toContain("export function CodingProjectColumnSidebar()")
    const codingSidebar = slots.slice(
      slots.indexOf("export function CodingProjectColumnSidebar"),
      slots.indexOf("export function CodingSessionListMain"),
    )
    expect(codingSidebar).not.toContain("ModeLocationNewSession")
  })

  test("Coding owner file declares it is the Coding owner, not shared Location", () => {
    expect(coding).toMatch(/Coding (project|owner)/i)
  })
})

describe("Work/Assistant consume ModeLocationNewSession", () => {
  test("WorkProjectColumnSidebar returns ModeLocationNewSession with mode work", () => {
    const workSection = slots.slice(slots.indexOf("export function WorkProjectColumnSidebar"))
    expect(workSection).toContain("ModeLocationNewSession")
    expect(workSection).toContain('mode="work"')
  })

  test("Assistant feature sidebar consumes ModeLocationNewSession with mode assistant", () => {
    const assistant = read("../components/assistant-feature-sidebar.tsx")
    expect(assistant).toContain("ModeLocationNewSession")
    expect(assistant).toContain('mode="assistant"')
  })
})

describe("Chat owns its inline Location + feature tree", () => {
  test("MODE_SURFACES chat Sidebar is ChatFeatureSidebar (not ModeLocationNewSession)", () => {
    expect(surfaces).toContain("Sidebar: ChatFeatureSidebar")
  })

  test("ChatFeatureSidebar inlines Location and new/add-project logic", () => {
    expect(chatSidebar).toContain("export function ChatFeatureSidebar()")
    expect(chatSidebar).toContain('language.t("chat.feature.project")')
    expect(chatSidebar).toContain("launchModeSession")
    expect(chatSidebar).toContain("addProject")
  })

  test("ChatFeatureSidebar owns the feature tree and counts, not ModeLocationNewSession", () => {
    const chatSection = chatSidebar.slice(
      chatSidebar.indexOf("export function ChatFeatureSidebar"),
      chatSidebar.indexOf("const MODE_SURFACES"),
    )
    expect(chatSection).not.toContain("<ModeLocationNewSession")
    expect(chatSection).toContain("CHAT_FEATURES")
    expect(chatSection).toContain("countFor")
  })
})

describe("ModeLocationNewSession has no Coding selection coupling", () => {
  test("does not import or read CodingSelectionCtx", () => {
    expect(location).not.toContain("CodingSelectionCtx")
    expect(location).not.toContain("useCodingSelection")
  })
})
