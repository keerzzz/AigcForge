import { describe, expect, test } from "bun:test"
import { findBadBunCwdRun, parseAddedLines } from "./changed-lines"

const added = (...lines: number[]) => new Set(lines)

describe("parseAddedLines", () => {
  test("collects added lines per file from a unified=0 diff", () => {
    const diff = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+line2",
      " line3",
      "+line4",
    ].join("\n")
    expect(parseAddedLines(diff).get("docs/a.md")).toEqual(new Set([2, 4]))
  })

  test("a hunk whose start is zero (new file) still records the added offset", () => {
    const diff = ["diff --git a/x.md b/x.md", "+++ b/x.md", "@@ -0,0 +1,2 @@", "+a", "+b"].join("\n")
    expect(parseAddedLines(diff).get("x.md")).toEqual(new Set([1, 2]))
  })

  test("dropped lines are not added", () => {
    const diff = ["diff --git a/y.md b/y.md", "+++ b/y.md", "@@ -1,2 +1,1 @@", "-old", "+new"].join("\n")
    expect(parseAddedLines(diff).get("y.md")).toEqual(new Set([1]))
  })
})

describe("findBadBunCwdRun", () => {
  const content = [
    "line1",
    "bun --cwd packages/core test", // valid: no run between --cwd and script
    "line3",
    "bun --cwd packages/core run test", // INVALID: --cwd before run
    "line5",
  ].join("\n")

  test("an added violation is reported", () => {
    expect(findBadBunCwdRun(added(4), content)).toHaveLength(1)
  })

  test("a historical (non-added) violation is not reported", () => {
    // The bad line is line 4 but only line 2 is added → no report.
    expect(findBadBunCwdRun(added(2), content)).toHaveLength(0)
  })

  test("a deleted line is not reported (it is not added)", () => {
    expect(findBadBunCwdRun(added(5), content)).toHaveLength(0)
  })

  test("`bun --cwd <pkg> <script>` is accepted", () => {
    expect(findBadBunCwdRun(added(2), content)).toHaveLength(0)
  })

  test("`bun run --cwd <pkg> <script>` is accepted", () => {
    const ok = "bun run --cwd packages/core test"
    expect(findBadBunCwdRun(added(1), ok)).toHaveLength(0)
  })

  test("`--cwd=` equals form is rejected", () => {
    const bad = "bun --cwd=packages/core run test"
    expect(findBadBunCwdRun(added(1), bad)).toHaveLength(1)
  })

  test("a quoted path with spaces is rejected", () => {
    const bad = 'bun --cwd "my folder/with spaces" run test'
    expect(findBadBunCwdRun(added(1), bad)).toHaveLength(1)
  })

  test("a Windows path is rejected", () => {
    const bad = "bun --cwd C:\\Users\\aigcfroge\\pkg run test"
    expect(findBadBunCwdRun(added(1), bad)).toHaveLength(1)
  })

  test("a valid command on the same line as nothing else is fine", () => {
    const ok = "See docs: bun --cwd packages/app typecheck"
    expect(findBadBunCwdRun(added(1), ok)).toHaveLength(0)
  })

  test("a line that describes the anti-pattern (reject/forbid) is not flagged", () => {
    const described = "拒绝 `bun --cwd <pkg> run <script>`，接受 `bun --cwd <pkg> <script>`"
    expect(findBadBunCwdRun(added(1), described)).toHaveLength(0)
  })

  test("an English line that describes the anti-pattern is not flagged", () => {
    for (const described of [
      "Never use `bun --cwd <pkg> run <script>` — it silently does nothing.",
      "Do not run `bun --cwd packages/core run test`; it exits 0 without running.",
      "Forbidden form: `bun --cwd packages/core run test`.",
    ]) {
      expect(findBadBunCwdRun(added(1), described)).toHaveLength(0)
    }
  })

  test("a line that instructs the command is still flagged even with prose around it", () => {
    const instructed = "运行方式：bun --cwd packages/core run test 即可"
    expect(findBadBunCwdRun(added(1), instructed)).toHaveLength(1)
  })
})
