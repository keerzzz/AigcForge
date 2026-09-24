/**
 * Presentation-tagging contract (S3 §6.2).
 *
 * The matrix projects run `PRESENTATION_GREP` instead of the full suite, which is
 * only safe while two invariants hold: the grep actually reaches the specs that
 * assert presentation behaviour, and no spec branches on the project name without
 * carrying the tag (a project-aware spec without the tag would silently stop
 * running in the very project it was written for).
 *
 * Both are checked against the source tree rather than restated by hand, so
 * renaming a tag or dropping it from a spec fails here instead of quietly
 * shrinking the matrix. Node-side: no browser needed.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { MATRIX_PROJECTS, PRESENTATION_GREP, PRESENTATION_TAGS } from "../presentation-matrix"

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(here, "..")

function specSources(): Array<{ file: string; source: string }> {
  const files: string[] = []
  for (const dir of ["regression", "smoke"]) {
    const full = path.join(e2eRoot, dir)
    for (const name of readdirSync(full).filter((entry) => entry.endsWith(".spec.ts"))) {
      files.push(path.join(full, name))
    }
  }
  return files.map((file) => ({
    file: path.relative(e2eRoot, file).split(path.sep).join("/"),
    source: readFileSync(file, "utf8"),
  }))
}

function taggedTitles(source: string): string[] {
  const titles: string[] = []
  for (const tag of PRESENTATION_TAGS) {
    if (!source.includes(`"${tag}"`)) continue
    titles.push(tag)
  }
  return titles
}

/**
 * Playwright's own project name, as specs actually read it.
 *
 * This used to be the bare substring `project.name`, which flagged any fixture carrying a
 * `project` object. Measured at HEAD: `smoke/session-timeline.spec.ts:343` passes
 * `fixture.project.name` to a helper, nothing in that file branches on the Playwright project, and
 * the gate failed on it — a red gate that made the whole suite unfinishable for a false positive.
 * Narrowed to the access forms that do branch on it. The blind spot is stated rather than hidden:
 * a spec that renames it first (`const { project } = test.info()`) is not caught.
 */
const PROJECT_NAME = /(?:testInfo|\binfo)\.project\.name|test\.info\(\)\.project\.name/

test("the grep the matrix projects use matches every declared tag", () => {
  expect(PRESENTATION_TAGS.length).toBeGreaterThan(0)
  for (const tag of PRESENTATION_TAGS) {
    expect(new RegExp(PRESENTATION_GREP).test(tag), `${tag} is reachable through PRESENTATION_GREP`).toBe(true)
  }
  expect(MATRIX_PROJECTS.length, "matrix projects are declared").toBeGreaterThan(0)
})

// Pinned so a later edit cannot quietly loosen the rule (and let a project-aware spec stop
// running in the matrix) or over-tighten it back into the false positive above.
test("the project-name rule matches the Playwright access and not a fixture field", () => {
  expect(PROJECT_NAME.test("report({ browser: testInfo.project.name, viewports, results })")).toBe(true)
  expect(PROJECT_NAME.test("if (testInfo.project.name !== 'chromium') return")).toBe(true)
  expect(PROJECT_NAME.test("await selectHomeProject(page, fixture.project.name)")).toBe(false)
  expect(
    path.win32.relative("C:\\e2e", "C:\\e2e\\regression\\presentation-matrix.spec.ts").split(path.win32.sep).join("/"),
  ).toBe("regression/presentation-matrix.spec.ts")
})

test("every spec that branches on the project name carries a presentation tag", () => {
  const offenders: string[] = []
  for (const { file, source } of specSources()) {
    if (!PROJECT_NAME.test(source)) continue
    if (taggedTitles(source).length === 0) offenders.push(file)
  }
  expect(offenders, "project-aware specs must carry @presentation or @a11y or they stop running in the matrix").toEqual(
    [],
  )
})

test("the specs that define the matrix carry a tag", () => {
  // Named rather than "any tagged spec exists": these are the files whose whole
  // purpose is presentation or a11y, so losing their tag is a regression even if
  // other specs keep the mechanism alive.
  const required: Record<string, string> = {
    "regression/presentation-matrix.spec.ts": "@presentation",
    "regression/mode-slot-fallback-a11y.spec.ts": "@a11y",
    "regression/global-shell-presentation.spec.ts": "@presentation",
  }
  const sources = new Map(specSources().map((entry) => [entry.file, entry.source]))
  for (const [file, tag] of Object.entries(required)) {
    const source = sources.get(file)
    expect(source, `${file} still exists`).toBeDefined()
    expect(source?.includes(`"${tag}"`), `${file} carries ${tag}`).toBe(true)
  }
})

/**
 * The workflow names the Playwright projects to run, so it is a second source of
 * truth next to `MATRIX_PROJECTS`. It drifted once: the locale collapse dropped
 * `chromium-zht` from the config while the workflow kept passing it, and
 * Playwright failed the whole job with `Project(s) "chromium-zht" not found`
 * before a single test ran. Compared here rather than restated by hand.
 */
test("the CI project list matches the matrix definition", () => {
  const workflow = readFileSync(path.resolve(e2eRoot, "..", "..", "..", ".github/workflows/test.yml"), "utf8")
  const line = workflow.split("\n").find((entry) => entry.includes("test:e2e:local --project="))
  if (!line) throw new Error("the workflow no longer runs an explicit e2e project list; update this contract")
  const projects = [...line.matchAll(/--project=([\w-]+)/g)].map((match) => match[1])
  expect(projects).toEqual(["chromium", ...MATRIX_PROJECTS])
})
