import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// M1.5 SessionTodoProgress contract (plan §4.3). The app has no DOM-render
// unit-test harness for Solid components (no solid-testing-library); per the
// agent-task-hub.test.tsx precedent this verifies the source-level wiring
// contract, while the behavioural path (中断 -> Resume -> 续传) is covered by
// the E2E regression spec.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const component = read("session-todo-progress.tsx")

describe("SessionTodoProgress (M1.5 Work resume)", () => {
  test("renders a Resume button gated by canResume AND work mode", () => {
    expect(component).toContain('data-component="session-todo-progress-resume"')
    // Mode-aware: only work sessions surface the button (Coding/Chat never do).
    expect(component).toContain('ledger().canResume && mode.currentMode === "work"')
    expect(component).toContain("useMode()")
  })

  test("resume click reuses the composer send channel (session.promptAsync), no new path", () => {
    expect(component).toContain("session.promptAsync")
  })

  test("fold-over step items render the outputDigest as secondary text", () => {
    expect(component).toContain('data-slot="step-digest"')
    expect(component).toContain("outputDigest")
  })

  test("the ledger view is derived with computeProgressLedger", () => {
    expect(component).toContain("computeProgressLedger")
    expect(component).toContain("ledger()")
  })

  test("uses the i18n keys the parity test enforces", () => {
    expect(component).toContain('language.t("work.resume.button")')
  })
})
