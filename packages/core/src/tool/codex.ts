export * as CodexAdapter from "./codex"

import { Effect } from "effect"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapter } from "./cli-adapter"

const COMMAND = "codex"

export const adapter: CliAdapter = {
  name: "codex",
  command: COMMAND,
  description: "Codex CLI — OpenAI's coding agent in the terminal",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string; resumeId?: string }) =>
    Effect.succeed(
      input.resumeId ? ["exec", "resume", "--json", input.resumeId, input.prompt] : ["exec", "--json", input.prompt],
    ),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const lines = stdout.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
            continue
          }
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

  parseResumeHint: (stdout: string) => {
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === "session.resume_hint" && typeof parsed.sessionID === "string") return parsed.sessionID
        if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") return parsed.thread_id
      } catch {
        continue
      }
    }
    return undefined
  },
}
