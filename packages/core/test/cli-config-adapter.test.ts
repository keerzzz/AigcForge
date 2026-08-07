/**
 * `ConfigCliAdapter` factory contract — M3 Phase A.
 *
 * A config-defined `cli_agents` entry must materialize as a standard `CliAdapter`:
 * argv placeholders interpolate `{prompt}`/`{resumeId}`, the three output
 * strategies reuse the existing parsers, and timeout passes through.
 *
 * @see packages/core/src/tool/cli-config-adapter.ts
 */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { fromConfig } from "@aigcfroge/core/tool/cli-config-adapter"

describe("ConfigCliAdapter factory", () => {
  test("interpolates {prompt} and {resumeId} placeholders into argv", () => {
    const adapter = fromConfig("my-cli", {
      command: "my-cli",
      args: ["exec", "{prompt}", "--resume", "{resumeId}"],
    })
    const args = Effect.runSync(adapter.buildArgs({ prompt: "do it", cwd: "/p", resumeId: "ext_1" }))
    expect(args).toEqual(["exec", "do it", "--resume", "ext_1"])
  })

  test("leaves an empty resumeId placeholder as empty when no resume", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", args: ["--resume", "{resumeId}", "{prompt}"] })
    const args = Effect.runSync(adapter.buildArgs({ prompt: "fresh", cwd: "/p" }))
    expect(args).toEqual(["--resume", "", "fresh"])
  })

  test("passes timeout through to the adapter", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", timeout: 60000 })
    expect(adapter.timeout).toBe(60000)
  })

  test("parses plain output via the tagged parser", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "plain" })
    const result = Effect.runSync(adapter.parseOutput("<task_result>\nDone\n</task_result>", ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Done")
  })

  test("parses claude-jsonl output frames", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "claude-jsonl" })
    const stdout = JSON.stringify({ type: "result", content: "<task_result>\nClaude done\n</task_result>" })
    const result = Effect.runSync(adapter.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Claude done")
  })

  test("parses codex-jsonl output frames", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "codex-jsonl" })
    const stdout = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "<task_result>\nCodex done\n</task_result>" },
    })
    const result = Effect.runSync(adapter.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Codex done")
  })

  test("detect resolves through the configured command", () => {
    const adapter = fromConfig("my-cli", { command: "definitely-not-a-real-cli-xyz" })
    expect(Effect.runSync(adapter.detect())).toBe(false)
  })
})
