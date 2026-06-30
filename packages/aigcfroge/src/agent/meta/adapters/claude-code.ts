import { Effect } from "effect"
import { which } from "@aigcfroge/core/util/which"
import { DelegationParser } from "./delegation-parser"

const COMMAND = "claude"

export const adapter = {
  name: "claude-code",
  command: COMMAND,
  description: "Claude Code CLI — Anthropic's official AI coding assistant",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string }) =>
    Effect.succeed(["--print", "--output-format", "stream-json", input.prompt] as const),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const lines = stdout.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === "result" || parsed.type === "completion") {
            const text = parsed.text ?? parsed.content ?? ""
            const result = DelegationParser.parseDelegationResult(text)
            if (result) return result
          }
        } catch {
          continue
        }
      }
      // Fallback to generic parsing
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),
} as const

export * as ClaudeCodeAdapter from "./claude-code"
