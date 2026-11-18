import { describe, expect, test } from "bun:test"
import { ProductMode } from "@aigcfroge/schema/product-mode"

/**
 * S7 — which modes an ordinary "new session" can create.
 *
 * The defect this owns: `launchModeSession(mode: Mode)` accepted the whole five-mode union at
 * ~20 client call sites, none of which knew that `custom` has no generic creation path
 * (`core/product-mode-policy.assertCreationSupported` rejects it — custom sessions are created
 * atomically from a composition snapshot). So Home could hand the user a draft whose first send
 * was guaranteed to fail, and a sixth mode would inherit the same assumption silently.
 *
 * Both halves are asserted here because they fail differently: the runtime predicate is what
 * the server policy shares, and the type is what stops a client passing `custom` at all.
 */
describe("isGenericSessionMode", () => {
  test("the four ordinary modes can be created generically", () => {
    expect(ProductMode.isGenericSessionMode("chat")).toBe(true)
    expect(ProductMode.isGenericSessionMode("coding")).toBe(true)
    expect(ProductMode.isGenericSessionMode("work")).toBe(true)
    expect(ProductMode.isGenericSessionMode("assistant")).toBe(true)
  })

  test("custom cannot", () => {
    expect(ProductMode.isGenericSessionMode("custom")).toBe(false)
  })

  test("an unknown mode cannot, and prototype keys are not modes", () => {
    expect(ProductMode.isGenericSessionMode("sixth")).toBe(false)
    expect(ProductMode.isGenericSessionMode("")).toBe(false)
    // `Object.hasOwn` rather than `in`, so an inherited property cannot answer for a mode.
    expect(ProductMode.isGenericSessionMode("toString")).toBe(false)
    expect(ProductMode.isGenericSessionMode("constructor")).toBe(false)
  })

  test("the default mode is generically creatable", () => {
    // Callers resolve `undefined` to the default before asking, so the default has to be in
    // the set or every unspecified creation would be rejected.
    expect(ProductMode.isGenericSessionMode(ProductMode.Default)).toBe(true)
  })
})

describe("GenericSessionMode", () => {
  test("accepts the four ordinary modes", () => {
    const modes: ProductMode.GenericSessionMode[] = ["chat", "coding", "work", "assistant"]
    expect(modes).toHaveLength(4)
  })

  test("rejects custom at compile time", () => {
    // @ts-expect-error custom has no generic creation path, so it must not be assignable
    const mode: ProductMode.GenericSessionMode = "custom"
    // The suppression above IS the assertion — it fails the build the day the assignment
    // becomes legal. Comparing against the literal would re-introduce the same type error in
    // the matcher, so the runtime check only keeps the binding alive.
    expect(typeof mode).toBe("string")
  })

  test("rejects a mode that does not exist", () => {
    // @ts-expect-error a future mode has to declare itself in GENERIC_CREATION first
    const mode: ProductMode.GenericSessionMode = "sixth"
    expect(typeof mode).toBe("string")
  })

  test("is a subset of the full mode union", () => {
    const generic: ProductMode.GenericSessionMode = "chat"
    const any: ProductMode.ID = generic
    expect(any).toBe("chat")
  })
})
