import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// M2 permission-dock wiring contract (plan §4.2). The app has no DOM-render
// unit-test harness for Solid components (no solid-testing-library); the
// established pattern is source-level wiring assertions: the dock must surface
// external-cli dispatch metadata (description / cli_target / execution_type)
// when present, without touching the existing patterns list.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("SessionPermissionDock", () => {
  test("renders request metadata description and cli_target when present", () => {
    const dock = read("session-permission-dock.tsx")
    // Metadata block is rendered independently of the patterns list.
    expect(dock).toContain('data-slot="permission-metadata"')
    // Description surfaced when the task tool sent one.
    expect(dock).toContain("props.request.metadata?.description")
    // External-CLI target surfaced when the request is a CLI dispatch.
    expect(dock).toContain("props.request.metadata?.cli_target")
  })

  test("keeps the existing patterns list rendering untouched", () => {
    const dock = read("session-permission-dock.tsx")
    expect(dock).toContain('data-slot="permission-patterns"')
    expect(dock).toContain("props.request.patterns.length > 0")
  })
})
