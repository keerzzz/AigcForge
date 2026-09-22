import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Reuse contract: the Custom sidebar has no render harness, and this asserts the
// loading path shares the existing SessionSkeleton rather than forking a new
// skeleton component. Empty fallbacks are gated on a settled clean read.
describe("custom sidebar loading contract", () => {
  test("uses the shared skeleton before any empty fallback", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "custom-sidebar.tsx"), "utf8")
    expect(source).toContain("when={status() !== \"loading\"}")
    expect(source).toContain("<SessionSkeleton count={6} />")
  })
})
