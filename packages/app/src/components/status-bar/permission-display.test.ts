import { describe, expect, test } from "bun:test"
import { permissionDisplay } from "./permission-display"

describe("permissionDisplay", () => {
  test("stays silent for the default propose tier", () => {
    expect(permissionDisplay({ declaredTier: "propose", effect: "ask", health: "ready" })).toBeUndefined()
  })

  test("warns for the full tier and carries the owner's effect", () => {
    expect(permissionDisplay({ declaredTier: "full", effect: "allow", health: "ready" })).toEqual({
      kind: "full",
      effect: "allow",
    })
  })

  test("lets capability health outrank the tier and keeps the reason code", () => {
    expect(permissionDisplay({ declaredTier: "propose", health: "blocked", reason: "custom-mode-disabled" })).toEqual({
      kind: "blocked",
      reason: "custom-mode-disabled",
    })
    expect(
      permissionDisplay({ declaredTier: "full", health: "degraded", reason: "mode-detail-not-projected" }),
    ).toEqual({
      kind: "degraded",
      reason: "mode-detail-not-projected",
    })
  })

  test("omits absent fields instead of inventing them", () => {
    expect(permissionDisplay({ declaredTier: "full" })).toEqual({ kind: "full" })
  })
})
