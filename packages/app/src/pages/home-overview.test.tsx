import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("HomeOverview", () => {
  test("home-overview.tsx exists and exports HomeOverview and HomeOverviewSidebar", () => {
    const filePath = path.resolve(__dirname, "home-overview.tsx")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function HomeOverview")
    expect(content).toContain("export function HomeOverviewSidebar")
  })

  test("session-mode-badge.tsx exports SessionModeBadge", () => {
    const filePath = path.resolve(__dirname, "../components/session-mode-badge.tsx")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function SessionModeBadge")
  })

  test("home-overview-model.ts exports countByMode and pinLastActive", () => {
    const filePath = path.resolve(__dirname, "home-overview-model.ts")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function countByMode")
    expect(content).toContain("export function pinLastActive")
  })
})
