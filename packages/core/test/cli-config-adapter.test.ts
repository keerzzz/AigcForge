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
import { Effect, Layer } from "effect"
import { Config } from "@omnixa/schema/config"
import { CliAdapter } from "@omnixa/core/tool/cli-adapter"
import { CodexAppServer } from "@omnixa/core/tool/codex-app-server"
import { testEffect } from "./lib/effect"
import { fromConfig } from "@omnixa/core/tool/cli-config-adapter"

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

  test("parseResumeHint captures the session id from claude-jsonl result frames", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "claude-jsonl" })
    const stdout = JSON.stringify({ type: "result", session_id: "ext_claude_1", result: "done" })
    expect(adapter.parseResumeHint?.(stdout)).toBe("ext_claude_1")
  })

  test("parseResumeHint captures the thread id from codex-jsonl thread.started frames", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "codex-jsonl" })
    const stdout = JSON.stringify({ type: "thread.started", thread_id: "ext_codex_1" })
    expect(adapter.parseResumeHint?.(stdout)).toBe("ext_codex_1")
  })

  test("parseResumeHint ignores unknown output types", () => {
    const adapter = fromConfig("my-cli", { command: "my-cli", output: "plain" })
    const stdout = JSON.stringify({ type: "result", session_id: "ext_ignored" })
    expect(adapter.parseResumeHint?.(stdout)).toBeUndefined()
  })

  test("detect resolves through the configured command", () => {
    const adapter = fromConfig("my-cli", { command: "definitely-not-a-real-cli-xyz" })
    expect(Effect.runSync(adapter.detect())).toBe(false)
  })
})

const configTest = testEffect(Layer.empty)
configTest.effect("MC06 resolves two Location configurations without changing the static registry", () =>
  Effect.gen(function* () {
    const previous = CliAdapter.getCliAdapter("codex")
    const descriptor = CodexAppServer.adapter
    CliAdapter.registerCliAdapter("codex", descriptor)
    yield* Effect.addFinalizer(() => Effect.sync(() => CliAdapter.registerCliAdapter("codex", previous ?? descriptor)))
    const first = new Config.Document({
      type: "document",
      info: { cli_agents: { codex: { command: "/one/codex", transport: "app-server", timeout: 1234 } } },
    })
    const second = new Config.Document({
      type: "document",
      info: { cli_agents: { codex: { command: "/two/codex", transport: "app-server", timeout: 5678 } } },
    })
    const one = yield* CliAdapter.resolve([first], "codex")
    const two = yield* CliAdapter.resolve([first, second], "codex")
    expect(one.command).toBe("/one/codex")
    expect(one.timeout).toBe(1234)
    expect(two.command).toBe("/two/codex")
    expect(two.timeout).toBe(5678)
    expect(one.execute).not.toBe(two.execute)
    expect(CliAdapter.getCliAdapter("codex")).toBe(descriptor)
    expect(CliAdapter.listCliAdapters().find((value) => value.name === descriptor.name)).toBe(descriptor)
    for (const info of [
      { transport: "sdk" as const, command: "codex" },
      { transport: "app-server" as const, command: "codex", args: ["--danger"] },
    ]) {
      expect(
        yield* CliAdapter.resolve(
          [new Config.Document({ type: "document", info: { cli_agents: { codex: info } } })],
          "codex",
        ).pipe(Effect.flip),
      ).toBeInstanceOf(CliAdapter.UnavailableError)
    }
    CliAdapter.registerCliAdapter("codex", { ...descriptor, forCommand: undefined })
    expect(yield* CliAdapter.resolve([first], "codex").pipe(Effect.flip)).toBeInstanceOf(CliAdapter.UnavailableError)
    CliAdapter.registerCliAdapter("codex", { ...descriptor, forCommand: () => ({ ...descriptor, execute: undefined }) })
    expect(yield* CliAdapter.resolve([first], "codex").pipe(Effect.flip)).toBeInstanceOf(CliAdapter.UnavailableError)
  }),
)
