import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// Source-level contract only. Mounting a Solid component under bun is blocked by
// oven-sh/bun#28605 (see docs/technical-debt.md), so rendering, disabled-button
// logic and event-driven refetch are asserted for real by
// `packages/app/e2e/regression/workflow-runtime.spec.ts` against a mocked server,
// and the pure projection logic by `workflow-runtime-model.test.ts`. What is left
// here is what neither can see: that a removed workaround stays removed and that
// the panel is actually wired into a mount site.
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), "utf8")

describe("workflow runtime panel source contract", () => {
  test("never probes the generated SDK for optional mutation methods", () => {
    // The three mutation endpoints are part of the generated contract. Treating
    // them as optional hid a real OpenAPI identifier defect behind a
    // permanently-disabled UI, so the probe must not come back.
    for (const source of [read("workflow-runtime-model.ts"), read("workflow-runtime-panel.tsx")]) {
      expect(source).not.toContain("capabilities")
      expect(source).not.toContain("sdk_missing")
      expect(source).not.toContain("mutationUnavailable")
    }
  })

  test("is mounted by the custom session snapshot panel", () => {
    expect(read("../../components/custom/custom-snapshot-panel.tsx")).toContain("<WorkflowRuntimePanel")
  })
})
