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

  buildArgs: (input: { prompt: string; cwd: string }) =>
    Effect.succeed(["exec", input.prompt] as const),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const result = DelegationParser.parseDelegationResult(stdout)
      if (result) return result
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),
}
