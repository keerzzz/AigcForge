export * as ClaudeCodeAdapter from "./claude-code"

import { Effect } from "effect"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapter } from "./cli-adapter"

const COMMAND = "claude"

export const adapter: CliAdapter = {
  name: "claude-code",
  command: COMMAND,
  description: "Claude Code CLI — Anthropic's official AI coding assistant",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string; resumeId?: string }) =>
    Effect.succeed(
      input.resumeId
        ? ["--print", "--output-format", "stream-json", "--resume", input.resumeId]
        : ["--print", "--output-format", "stream-json", input.prompt],
    ),

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

  parseResumeHint: (stdout: string) => {
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === "session.resume_hint" && typeof parsed.sessionID === "string") return parsed.sessionID
      } catch { continue }
    }
    return undefined
  },
}
