import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Source-contract tests for the Phase 1 owner extraction:
// - home-shared.tsx owns the shared Session building blocks (no page shell).
// - coding-project-column.tsx owns the Coding project/server tree (kept under its
//   compatible names for consumers, but no longer a Home page owner).
// - helpers.ts and consumers import from the new owners, not from a Home page.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const shared = read("home-shared.tsx")
const coding = read("coding-project-column.tsx")
const helpers = read("layout/helpers.ts")

describe("home-shared owner contract", () => {
  test("owns the shared Session record/group types and data pipeline", () => {
    expect(shared).toContain("export const HOME_SESSION_LIMIT")
    expect(shared).toContain("export type HomeSessionRecord")
    expect(shared).toContain("export type HomeSessionGroup")
    expect(shared).toContain("export function buildHomeSessionRecords")
    expect(shared).toContain("export function matchesHomeSessionSearch")
    expect(shared).toContain("export function homeSessionSearchKey")
    expect(shared).toContain("export function groupSessions")
  })

  test("owns the shared Session presentation components", () => {
    expect(shared).toContain("export function HomeSessionLeading")
    expect(shared).toContain("export function HomeSessionSearch")
    expect(shared).toContain("export function HomeSessionSearchResultRow")
    expect(shared).toContain("export function HomeSessionGroupHeader")
    expect(shared).toContain("export function HomeSessionRow")
    expect(shared).toContain("export function HomeSessionSkeleton")
  })

  test("is no longer a page shell: no HomeProjectColumn ownership", () => {
    expect(shared).not.toContain("export function HomeProjectColumn")
  })
})

describe("coding-project-column owner contract", () => {
  test("owns the Coding project/server tree under its compatible name", () => {
    expect(coding).toContain("export function HomeProjectColumn")
    expect(coding).toContain("export function HomeProjectRow")
  })

  test("declares that it is the Coding owner, not a Home page owner", () => {
    expect(coding).toMatch(/Coding (project|owner)/i)
  })
})

describe("consumer contract", () => {
  test("helpers imports HomeSessionRecord from the shared owner, not a Home page", () => {
    expect(helpers).toContain('from "@/pages/home-shared"')
    expect(helpers).not.toContain('from "@/pages/home"')
  })
})
