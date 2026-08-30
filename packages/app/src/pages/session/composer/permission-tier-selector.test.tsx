import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("permission-tier-selector", () => {
  const source = read("permission-tier-selector.tsx")

  test("declares the tier selector slot contract", () => {
    expect(source).toContain('data-slot="permission-tier-selector"')
    expect(source).toContain('data-slot="permission-tier-option"')
    expect(source).toContain('data-slot="permission-tier-label"')
  })

  test("only renders for chat/work/assistant × meta", () => {
    expect(source).toContain('mode !== "chat" && mode !== "work" && mode !== "assistant"')
    expect(source).toContain('agent === "meta"')
  })

  test("defaults to propose and supports both tiers", () => {
    expect(source).toContain('id: "propose"')
    expect(source).toContain('id: "full"')
    expect(source).toContain('option.id === "propose"')
  })
})

describe("session-composer-region tier wiring", () => {
  const source = read("session-composer-region.tsx")

  test("wires the selector for drafts and existing sessions", () => {
    expect(source).toContain("<PermissionTierSelector")
    expect(source).toContain("tabs.updateDraft(search.draftId, { permissionTier: tier })")
    expect(source).toContain("client.session.update({ sessionID: id, permissionTier: tier })")
  })
})

describe("submit draft tier passthrough", () => {
  const source = read("../../../components/prompt-input/submit.ts")

  test("passes the draft permission tier into session.create", () => {
    expect(source).toContain("permissionTier: draftTab?.permissionTier")
  })
})

describe("tabs DraftTab permission tier field", () => {
  const source = read("../../../context/tabs.tsx")

  test("carries the permissionTier field on drafts", () => {
    expect(source).toContain('permissionTier?: "propose" | "full"')
  })
})
