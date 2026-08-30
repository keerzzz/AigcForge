import { describe, expect, test } from "bun:test"
import { taskAgentLabel } from "../../src/routes/session"
import { permissionTaskTitle } from "../../src/routes/session/permission"

// M2 TUI presentation contract. The routes/session Task() and PermissionPrompt
// can't be frame-rendered without the full sync/sdk runtime, so the pure
// formatters that drive their titles are tested directly (the
// inline-tool-wrap-snapshot precedent).

describe("TUI external-cli task display", () => {
  test("taskAgentLabel prefers metadata.cli for external-cli dispatch", () => {
    expect(
      taskAgentLabel(
        { execution_type: "external-cli", cli: "claude-code" },
        { subagent_type: "build", cli_target: "claude-code" },
      ),
    ).toBe("claude-code")
  })

  test("taskAgentLabel falls back to input.cli_target when metadata.cli is absent", () => {
    expect(taskAgentLabel({ execution_type: "external-cli" }, { subagent_type: "build", cli_target: "gemini" })).toBe(
      "gemini",
    )
  })

  test("taskAgentLabel defaults to CLI with no target anywhere", () => {
    expect(taskAgentLabel({ execution_type: "external-cli" }, {})).toBe("CLI")
  })

  test("taskAgentLabel titles a plain subagent from subagent_type", () => {
    expect(taskAgentLabel({}, { subagent_type: "explore" })).toBe("Explore")
  })

  test("permissionTaskTitle shows the CLI target for external-cli", () => {
    expect(permissionTaskTitle({ execution_type: "external-cli", cli_target: "claude-code" })).toBe("Claude-Code CLI")
  })

  test("permissionTaskTitle defaults external-cli to a plain CLI label without a target", () => {
    expect(permissionTaskTitle({ execution_type: "external-cli" })).toBe("CLI")
  })

  test("permissionTaskTitle keeps the subagent form for internal delegations", () => {
    expect(permissionTaskTitle({ subagent_type: "build" })).toBe("Build Task")
  })
})
