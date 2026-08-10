export * as ConfigCliAdapter from "./cli-config-adapter"

import { Effect } from "effect"
import { ConfigCliAgent } from "../config/cli-agent"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import { adapter as claudeCodeAdapter } from "./claude-code"
import { adapter as codexAdapter } from "./codex"
import type { CliAdapter } from "./cli-adapter"

const interpolate = (args: readonly string[], prompt: string, resumeId?: string) =>
  args.map((arg) => arg.replaceAll("{prompt}", prompt).replaceAll("{resumeId}", resumeId ?? ""))

/**
 * Materialize a config-defined `cli_agents` entry as a standard `CliAdapter`.
 * `output` selects the existing parsing strategy (claude-jsonl / codex-jsonl /
 * plain); `args` support `{prompt}` and `{resumeId}` placeholders.
 */
export function fromConfig(name: string, info: ConfigCliAgent.Info): CliAdapter {
  return {
    name,
    command: info.command,
    description: info.description ?? `${name} CLI agent`,
    detect: () => Effect.sync(() => which(info.command) !== null),
    buildArgs: ({ prompt, resumeId }) =>
      Effect.sync(() => (info.args ? interpolate(info.args, prompt, resumeId) : [prompt])),
    parseOutput: (stdout, stderr) => {
      switch (info.output ?? "plain") {
        case "claude-jsonl":
          return claudeCodeAdapter.parseOutput(stdout, stderr)
        case "codex-jsonl":
          return codexAdapter.parseOutput(stdout, stderr)
        case "plain":
        default:
          return DelegationParser.parseDelegationOutput(stdout, stderr)
      }
    },
    parseResumeHint: (stdout) => {
      switch (info.output ?? "plain") {
        case "claude-jsonl":
          return claudeCodeAdapter.parseResumeHint?.(stdout)
        case "codex-jsonl":
          return codexAdapter.parseResumeHint?.(stdout)
        case "plain":
        default:
          return undefined
      }
    },
    timeout: info.timeout,
    transport: info.transport,
  }
}
