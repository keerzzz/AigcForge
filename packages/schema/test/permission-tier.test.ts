import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PermissionTier } from "../src/permission-tier"

describe("PermissionTier", () => {
  test("decodes the two allowed tiers", () => {
    expect(Schema.decodeUnknownSync(PermissionTier.ID)("propose")).toBe("propose")
    expect(Schema.decodeUnknownSync(PermissionTier.ID)("full")).toBe("full")
  })

  test("rejects unknown tiers", () => {
    expect(() => Schema.decodeUnknownSync(PermissionTier.ID)("admin")).toThrow()
    expect(() => Schema.decodeUnknownSync(PermissionTier.ID)(42)).toThrow()
  })

  test("defaults to propose", () => {
    expect(PermissionTier.Default).toBe("propose")
  })
})
