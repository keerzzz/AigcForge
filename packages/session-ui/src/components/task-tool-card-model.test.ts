/**
 * `taskCardModel` contract tests — the pure function that shapes a `task` tool
 * card from its call input + result metadata. Covers the M2 presentation layer
 * independently of any renderer:
 *
 * - external-cli recognition (`execution_type` / `cli`)
 * - title resolution (metadata.cli → input.cli_target → fallback)
 * - 4-state status mapping (running / completed / failed / timeout)
 * - summary extraction from the rendered `<task_result>` / `<task_error>` text
 * - subagent fallback with no metadata
 *
 * @see packages/session-ui/src/components/task-tool-card-model.ts
 */

import { describe, expect, test } from "bun:test"
import { taskCardModel } from "./task-tool-card-model"

describe("taskCardModel", () => {
  test("recognizes external-cli from metadata.execution_type and resolves title/summary/href", () => {
    const model = taskCardModel(
      { description: "Run the build", subagent_type: "build" },
      { sessionId: "ses_cli_1", cli: "claude-code", execution_type: "external-cli", status: "success" },
      '<task id="ses_cli_1" state="completed"><summary>CLI task summary</summary><task_result>\nDone the work\n</task_result></task>',
    )
    expect(model.isExternalCli).toBe(true)
    expect(model.title).toBe("claude-code")
    expect(model.subtitle).toBe("Run the build")
    expect(model.status).toBe("completed")
    expect(model.href).toBe("ses_cli_1")
    expect(model.summary).toBe("Done the work")
  })

  test("falls back to input.cli_target when metadata.cli is absent", () => {
    const model = taskCardModel(
      { cli_target: "gemini", description: "x" },
      { execution_type: "external-cli", status: "success" },
    )
    expect(model.isExternalCli).toBe(true)
    expect(model.title).toBe("gemini")
  })

  test("defaults the external-cli title when neither metadata.cli nor cli_target exists", () => {
    const model = taskCardModel({}, { execution_type: "external-cli", status: "success" })
    expect(model.isExternalCli).toBe(true)
    expect(model.title).toBe("CLI")
  })

  test("subagent delegation is not external-cli and titles from subagent_type", () => {
    const model = taskCardModel({ subagent_type: "explore", description: "Investigate" }, undefined)
    expect(model.isExternalCli).toBe(false)
    expect(model.title).toBe("Explore")
    expect(model.subtitle).toBe("Investigate")
    expect(model.status).toBe("completed")
    expect(model.href).toBeUndefined()
  })

  test("subagent with no metadata falls back to a completed default title", () => {
    const model = taskCardModel({ description: "x" }, undefined)
    expect(model.isExternalCli).toBe(false)
    expect(model.title).toBe("Agent")
    expect(model.status).toBe("completed")
  })

  test("maps a failed CLI status to failed", () => {
    const model = taskCardModel(
      {},
      { execution_type: "external-cli", status: "failed" },
      "<task_error>boom</task_error>",
    )
    expect(model.status).toBe("failed")
  })

  test("maps a timed-out CLI to timeout instead of a plain failure", () => {
    const model = taskCardModel(
      {},
      { execution_type: "external-cli", status: "failed" },
      "<task_error>Timed out after 300s</task_error>",
    )
    expect(model.status).toBe("timeout")
  })

  test("reports running while the CLI has not settled", () => {
    const model = taskCardModel({}, { execution_type: "external-cli" })
    expect(model.status).toBe("running")
  })

  test("recognizes a running external-cli from the tool input execution_type alone", () => {
    const model = taskCardModel({ execution_type: "external-cli", cli_target: "codex" }, undefined)
    expect(model.isExternalCli).toBe(true)
    expect(model.title).toBe("codex")
    expect(model.status).toBe("running")
  })

  test("extracts summary from task_error tags on failure", () => {
    const model = taskCardModel(
      {},
      { execution_type: "external-cli", status: "failed" },
      '<task id="x" state="error"><task_error>\nCLI blew up\n</task_error></task>',
    )
    expect(model.summary).toBe("CLI blew up")
  })

  test("leaves summary undefined for subagent cards or missing output", () => {
    expect(taskCardModel({ subagent_type: "build" }, undefined).summary).toBeUndefined()
    expect(taskCardModel({}, { execution_type: "external-cli", status: "success" }).summary).toBeUndefined()
    expect(taskCardModel({}, { execution_type: "external-cli", status: "failed" }).summary).toBeUndefined()
  })
})
