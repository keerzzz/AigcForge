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

  buildArgs: ({ prompt, resumeId }) =>
    Effect.succeed([
      "-p",
      "--no-chrome",
      "--output-format",
      "json",
      ...(resumeId ? ["--resume", resumeId] : []),
      prompt,
    ]),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const lines = stdout.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type !== "result" && parsed.type !== "completion") continue
          const text = typeof parsed.result === "string" ? parsed.result : (parsed.text ?? parsed.content ?? "")
          if (parsed.is_error === true) {
            return {
              status: "failed" as const,
              summary: text || stderr || "Claude Code reported an error",
              errors: [text || stderr],
            }
          }
          return yield* DelegationParser.parseDelegationOutput(text, stderr)
        } catch {
          continue
        }
      }
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),

  parseResumeHint: (stdout: string) => {
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (typeof parsed.session_id === "string") return parsed.session_id
        if (typeof parsed.sessionID === "string") return parsed.sessionID
      } catch {
        continue
      }
    }
    return undefined
  },
}
