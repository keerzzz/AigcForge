import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("ModeWorkspace", () => {
  test("mode-workspace.tsx exists and exports ModeWorkspace", () => {
    const filePath = path.resolve(__dirname, "mode-workspace.tsx")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function ModeWorkspace")
  })

  test("mode-workspace-context.ts exports the asset and location owners", () => {
    const filePath = path.resolve(__dirname, "mode-workspace-context.ts")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function useModeWorkspaceAssets")
    expect(content).toContain("export function useModeDirectory")
  })

  test("mode-workspace-slots.tsx exports main slot components", () => {
    const filePath = path.resolve(__dirname, "mode-workspace-slots.tsx")
    expect(fs.existsSync(filePath)).toBe(true)
    const content = fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("export function CodingSessionListMain")
    expect(content).toContain("export function ChatAssetWorkbenchMain")
  })

  test("keeps WorkPresetCard local without adding a cross-mode Session list wrapper", () => {
    const content = fs.readFileSync(path.resolve(__dirname, "mode-workspace-slots.tsx"), "utf-8")
    expect(content).toContain("function WorkPresetCard")
    expect(content).not.toContain("ModeSessionListSection")
  })
})
