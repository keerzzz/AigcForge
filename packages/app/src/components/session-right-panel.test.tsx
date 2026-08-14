import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Right panel unified base shell contract tests (source contract assertions without solid-testing-library).
// Goal: all four session right panels unify into the SessionRightPanel shell (A-zone + SessionFileTree B-zone),
// reusing reviewPanel.opened() state; assistant B-zone matches work (project FileTree, closed by default).

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("SessionRightPanel (unified A/B shell)", () => {
  test("exports the shared SessionRightPanel shell", () => {
    const shell = read("session-right-panel.tsx")
    expect(shell).toContain("export function SessionRightPanel")
  })

  test("shell owns the review-panel id and reviewPanel open/close wiring", () => {
    const shell = read("session-right-panel.tsx")
    expect(shell).toContain('id="review-panel"')
    expect(shell).toContain("reviewPanel.opened()")
  })

  test("shell delegates its B zone to the shared SessionFileTree", () => {
    const shell = read("session-right-panel.tsx")
    expect(shell).toContain("<SessionFileTree")
  })

  test("all four mode panels delegate to SessionRightPanel", () => {
    expect(read("../pages/session/session-side-panel.tsx")).toContain("<SessionRightPanel")
    expect(read("chat/chat-right-panel.tsx")).toContain("<SessionRightPanel")
    expect(read("../pages/work-artifact-panel.tsx")).toContain("<SessionRightPanel")
    expect(read("../pages/session/assistant-session-panel.tsx")).toContain("<SessionRightPanel")
  })

  test("assistant drops the self-contained aside and its own opened state", () => {
    const assistant = read("../pages/session/assistant-session-panel.tsx")
    expect(assistant).not.toContain("assistant().opened")
    expect(assistant).not.toContain('data-component="assistant-session-panel"')
  })

  test("assistant B zone matches work (project FileTree, present but closed by default)", () => {
    const assistant = read("../pages/session/assistant-session-panel.tsx")
    expect(assistant).toContain("fileTree=")
    expect(assistant).toContain("<FileTree")
  })

  test("work regresses to the raised shell (no border-l plane style)", () => {
    const work = read("../pages/work-artifact-panel.tsx")
    expect(work).not.toContain('"border-l border-v2-border-border-base": reviewOpen()')
  })
})
