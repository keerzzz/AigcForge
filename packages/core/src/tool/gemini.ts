export * as GeminiAdapter from "./gemini"

import { Effect } from "effect"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapter } from "./cli-adapter"

const COMMAND = "gemini"

export const adapter: CliAdapter = {
  name: "gemini",
  command: COMMAND,
  description: "Gemini CLI — Google's AI-powered command-line assistant",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string; resumeId?: string }) =>
    Effect.succeed(["-p", input.prompt, ...(input.resumeId ? ["--resume", input.resumeId] : [])]),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const result = DelegationParser.parseDelegationResult(stdout)
      if (result) return result
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),

  parseResumeHint: (stdout: string) => {
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === "session.resume_hint" && typeof parsed.sessionID === "string") return parsed.sessionID
      } catch {
        continue
      }
    }
    return undefined
  },
}
