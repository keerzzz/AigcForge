import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), "utf8")

const sidebar = read("custom-sidebar.tsx")
const builder = read("custom-builder-main.tsx")

describe("Custom Builder configuration surface", () => {
  test("offers workflow selection in the existing asset sidebar", () => {
    expect(sidebar).toContain("workflowAsset.list()")
    expect(sidebar).toContain("toggleWorkflow")
    expect(sidebar).toContain('"custom.sidebar.workflows"')
  })

  test("offers command consumer binding in the existing asset sidebar", () => {
    expect(sidebar).toContain("commandAsset.list()")
    expect(sidebar).toContain("toggleCommand")
    expect(sidebar).toContain('"custom.sidebar.commands"')
    expect(sidebar).toContain("agents/")
  })

  test("shows the selected workflow and command bindings in the composition config", () => {
    expect(builder).toContain("draft.state.workflow")
    expect(builder).toContain("boundCommands")
    expect(builder).toContain('"custom.builder.workflow"')
    expect(builder).toContain('"custom.builder.commandBindings"')
  })
})
