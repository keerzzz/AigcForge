import { Effect } from "effect"
import { which } from "@aigcfroge/core/util/which"
import { DelegationParser } from "./delegation-parser"

const COMMAND = "codex"

export const adapter = {
  name: "codex",
  command: COMMAND,
  description: "Codex CLI — OpenAI's coding agent in the terminal",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string }) =>
    Effect.succeed(["exec", "--json", input.prompt] as const),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const lines = stdout.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === "text.delta") {
            const text = typeof parsed.text === "string" ? parsed.text : ""
            const inner = DelegationParser.parseDelegationResult(text)
            if (inner) return inner
          }
          if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
            const text = typeof parsed.item.text === "string" ? parsed.item.text : ""
            const inner = DelegationParser.parseDelegationResult(text)
            if (inner) return inner
          }
        } catch {
          continue
        }
      }

      const result = DelegationParser.parseDelegationResult(stdout)
      if (result) return result
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),
} as const

export * as CodexAdapter from "./codex"
