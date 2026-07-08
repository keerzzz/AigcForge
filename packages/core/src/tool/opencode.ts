export * as OpenCodeAdapter from "./opencode"

import { Effect } from "effect"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapter } from "./cli-adapter"

const COMMAND = "opencode"

export const adapter: CliAdapter = {
  name: "opencode",
  command: COMMAND,
  description: "OpenCode — open-source AI coding assistant in the terminal",

  detect: () => Effect.sync(() => which(COMMAND) !== null),

  buildArgs: (input: { prompt: string; cwd: string }) =>
    Effect.succeed(["run", input.prompt] as const),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      // Try structured parsing from stdout first — opencode may emit JSON or
      // tagged result blocks. stderr alone does not indicate failure (opencode
      // writes logs/warnings there even on success).
      const result = DelegationParser.parseDelegationResult(stdout)
      if (result) return result
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),
}
