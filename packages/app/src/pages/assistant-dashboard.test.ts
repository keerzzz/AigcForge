import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Error-visibility contract: this page has no render harness; the test pins that
// mutations are routed through a visible error state instead of console-only catches.
describe("AssistantDashboard mutation error surface", () => {
  test("does not swallow mutation failures in console-only catches", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "assistant-dashboard.tsx"), "utf8")
    expect(source).not.toContain(".catch(console.error)")
    expect(source).toContain('data-component="assistant-mutation-error"')
    expect(source).toContain('role="alert"')
  })
})
