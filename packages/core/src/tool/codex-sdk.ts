export * as CodexSdkAdapter from "./codex-sdk"

import { Effect } from "effect"
import { Codex as RealCodex } from "@openai/codex-sdk"
import { which } from "../util/which"
import type { CliAdapter } from "./cli-adapter"

/**
 * The minimal Codex SDK surface this adapter drives. Injected so unit tests
 * provide a fake and production passes the real `@openai/codex-sdk` `Codex`
 * instance. `run()` returns the completed turn whose `finalResponse` is the
 * agent's final text; resume reopens a thread by id.
 */
export interface CodexSdk {
  startThread(options?: { workingDirectory?: string; approvalPolicy?: string }): {
    id?: string | null
    run(input: string): Promise<{ finalResponse: string }>
  }
  resumeThread(id: string, options?: { workingDirectory?: string; approvalPolicy?: string }): {
    id?: string | null
    run(input: string): Promise<{ finalResponse: string }>
  }
}

export const makeCodexSdkAdapter = (sdk: CodexSdk, name = "codex"): CliAdapter => ({
  name,
  command: "codex",
  description: "Codex — OpenAI's coding agent (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which("codex") !== null),
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId }) =>
    Effect.gen(function* () {
      // approvalPolicy "never" auto-denies permission prompts — the unattended
      // default for external-CLI delegation; interactive approval wiring is a
      // follow-up (codex surfaces approvals as stream events, not a callback).
      const options = { workingDirectory: cwd, approvalPolicy: "never" as const }
      const thread = resumeId ? sdk.resumeThread(resumeId, options) : sdk.startThread(options)
      const turn = yield* Effect.promise(() => thread.run(prompt))
      return {
        status: "success" as const,
        summary: turn.finalResponse || "Task completed",
        // The thread id lets the next same-parent delegation resume this thread.
        sessionId: thread.id ?? undefined,
      }
    }),
})

// Production adapter backed by the real Codex SDK. The SDK's richer types are
// cast to the minimal seam — a third-party compatibility escape (we only need
// startThread/resumeThread/run for one-shot + resume delegation).
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- third-party SDK surface intentionally narrowed to the minimal seam
export const adapter: CliAdapter = makeCodexSdkAdapter(new RealCodex() as unknown as CodexSdk)
