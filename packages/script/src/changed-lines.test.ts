import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ChangedLines } from "./changed-lines"

const { findBadBunCwdRun, isCommandGateExempt, isIgnoredOnly, parseAddedLines } = ChangedLines

const added = (...lines: number[]) => new Set(lines)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

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

  test("decodes a C-quoted UTF-8 path", () => {
    const diff = [
      'diff --git "a/docs/\\344\\270\\255.md" "b/docs/\\344\\270\\255.md"',
      '+++ "b/docs/\\344\\270\\255.md"',
      "@@ -0,0 +1 @@",
      "+new",
    ].join("\n")
    expect(parseAddedLines(diff).get("docs/中.md")).toEqual(new Set([1]))
  })

  test("decodes common escapes in a C-quoted path", () => {
    const diff = [
      'diff --git "a/docs/a\\tb.md" "b/docs/a\\tb.md"',
      '+++ "b/docs/a\\tb.md"',
      "@@ -0,0 +2 @@",
      "+new",
    ].join("\n")
    expect(parseAddedLines(diff).get("docs/a\tb.md")).toEqual(new Set([2]))
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
    const bad = "bun --cwd C:\\Users\\omnixa\\pkg run test"
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

  test("rejection of another command does not suppress the invalid command", () => {
    const instructed = "Do not use npm; run bun --cwd packages/app run test:unit."
    expect(findBadBunCwdRun(added(1), instructed)).toHaveLength(1)
  })

  test("a conditional failure does not describe the invalid command as rejected", () => {
    const instructed = "If tests do not pass, run bun --cwd packages/core run test."
    expect(findBadBunCwdRun(added(1), instructed)).toHaveLength(1)
  })

  test("joins shell backslash continuations and reports an added constituent line", () => {
    const multiline = "bun --cwd packages/core \\\n  run test"
    expect(findBadBunCwdRun(added(2), multiline)).toEqual([{ line: 2, text: "bun --cwd packages/core  run test" }])
  })

  test("a line that instructs the command is still flagged even with prose around it", () => {
    const instructed = "运行方式：bun --cwd packages/core run test 即可"
    expect(findBadBunCwdRun(added(1), instructed)).toHaveLength(1)
  })
})

describe("isCommandGateExempt", () => {
  test("meta documentation that describes the anti-pattern is exempt", () => {
    expect(isCommandGateExempt("docs/technical-debt.md")).toBe(true)
    expect(isCommandGateExempt("docs/plan/custom-m3.md")).toBe(true)
  })

  test("instructional documentation stays gated", () => {
    expect(isCommandGateExempt("docs/testing.md")).toBe(false)
    expect(isCommandGateExempt("AGENTS.md")).toBe(false)
    expect(isCommandGateExempt("packages/app/README.md")).toBe(false)
  })
})

describe("isIgnoredOnly", () => {
  // oxlint prints a human notice before the JSON report and exits 1 when every
  // input is excluded, which happens for a version-only or docs-only change.
  const notice = "No files found to lint. Please check your paths and ignore patterns.\n"
  const report = (files: number, diagnostics: unknown[] = []) =>
    JSON.stringify({ diagnostics, number_of_files: files, number_of_rules: 128 })

  test("an empty report behind the notice is not a lint failure", () => {
    expect(isIgnoredOnly(notice + report(0))).toBe(true)
  })

  test("a report that linted files still fails, even with no diagnostics", () => {
    expect(isIgnoredOnly(notice + report(1))).toBe(false)
  })

  test("a report carrying diagnostics is never treated as ignored-only", () => {
    expect(isIgnoredOnly(notice + report(0, [{ message: "boom" }]))).toBe(false)
  })

  test("output without a JSON report is not ignored-only", () => {
    expect(isIgnoredOnly("")).toBe(false)
    expect(isIgnoredOnly(notice)).toBe(false)
    expect(isIgnoredOnly("not json {")).toBe(false)
  })
})

describe("lint-changed script", () => {
  test.each([
    {
      name: "passes a version-only change with no source files",
      file: undefined,
      content: "",
      exitCode: 0,
      output: "no changed JavaScript or TypeScript files",
    },
    {
      name: "passes when an untracked declaration is the only source input",
      file: "generated.d.ts",
      content: "export declare const generated: string\n",
      exitCode: 0,
      output: "all changed JavaScript or TypeScript files are ignored",
    },
    {
      name: "passes a lintable source without violations",
      file: "source.ts",
      content: "export const value = 1\n",
      exitCode: 0,
      output: "Incremental lint passed: 1 changed files",
    },
    {
      name: "rejects a new guarded lint violation",
      file: "source.ts",
      content: "const unused = 1\n",
      exitCode: 1,
      output: "eslint(no-unused-vars)",
    },
  ])("$name", async (input) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "omnixa-lint-changed-"))
    directories.push(root)
    await Bun.write(path.join(root, ".gitignore"), "node_modules\n")
    await Bun.write(path.join(root, ".oxlintrc.json"), JSON.stringify({ ignorePatterns: ["**/*.d.ts"] }))
    await Bun.write(path.join(root, "package.json"), JSON.stringify({ version: "0.0.8" }))
    await $`git -C ${root} init -b main`.quiet()
    await $`git -C ${root} config user.email lint-test@example.invalid`.quiet()
    await $`git -C ${root} config user.name lint-test`.quiet()
    await $`git -C ${root} add .`.quiet()
    await $`git -C ${root} commit -m initial`.quiet()
    await symlink(path.resolve(import.meta.dir, "../../../node_modules"), path.join(root, "node_modules"), "junction")
    await Bun.write(path.join(root, "package.json"), JSON.stringify({ version: "0.0.9" }))
    if (input.file) await Bun.write(path.join(root, input.file), input.content)

    const child = Bun.spawn(
      [process.execPath, path.resolve(import.meta.dir, "../../../script/lint-changed.ts"), "HEAD"],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, output: stdout + stderr }).toEqual({
      exitCode: input.exitCode,
      output: expect.stringContaining(input.output),
    })
  })
})
