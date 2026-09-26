import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Structural owner checks complement the browser interaction and computed-style regressions.
// Removing the resident text surface must not remove permission capabilities or the approval dock.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const composerPath = "../pages/session/composer/session-composer-region.tsx"

describe("permission capability stays in the owner", () => {
  test("the permission owner keeps the break-glass lease endpoints", () => {
    const owner = read("permission.tsx")
    expect(owner).toContain("client.permission.override.get")
    expect(owner).toContain("client.permission.override.put")
    expect(owner).toContain("client.permission.override.delete")
  })

  test("the permission owner keeps the tier mutation endpoint", () => {
    const owner = read("permission.tsx")
    expect(owner).toContain("client.session.update")
    expect(owner).toContain("permissionTier")
  })
})

describe("composer region carries no resident permission surface (opencode parity)", () => {
  test("the composer never called the permission endpoints directly", () => {
    const composer = read(composerPath)
    expect(composer).not.toContain("client.permission.override")
    expect(composer).not.toContain("client.session.update")
  })

  // Keep the removed resident surface from returning above the composer.
  test("the composer no longer renders the resident permission control surface", () => {
    const composer = read(composerPath)
    expect(composer).not.toContain("permission-control-surface")
    expect(composer).not.toContain("permission-tier-control")
    expect(composer).not.toContain("SessionPermissionOverrideControl")
  })

  test("the composer no longer wires the tier / break-glass mutation entries", () => {
    const composer = read(composerPath)
    expect(composer).not.toContain("setPermissionTier")
    expect(composer).not.toContain("refreshOverride")
    expect(composer).not.toContain("updateOverride")
    expect(composer).not.toContain("overrideEnabled")
  })

  test("the composer still renders the transient permission approval dock", () => {
    const composer = read(composerPath)
    expect(composer).toContain("SessionPermissionDock")
    expect(composer).toContain("permissionRequest()")
  })
})

describe("break-glass override moved to the prompt input as a shield", () => {
  test("the prompt input hosts the override control and wires the owner", () => {
    const prompt = read("../components/prompt-input.tsx")
    expect(prompt).toContain("SessionPermissionOverrideControl")
    expect(prompt).toContain("permission.refreshOverride")
    expect(prompt).toContain("permission.overrideEnabled")
  })
})
