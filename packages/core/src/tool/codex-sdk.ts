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
    run(input: string, options?: { signal?: AbortSignal }): Promise<{ finalResponse: string }>
  }
  resumeThread(
    id: string,
    options?: { workingDirectory?: string; approvalPolicy?: string },
  ): {
    id?: string | null
    run(input: string, options?: { signal?: AbortSignal }): Promise<{ finalResponse: string }>
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
    Effect.scoped(
      Effect.gen(function* () {
        // approvalPolicy "never" auto-denies permission prompts — the unattended
        // default for external-CLI delegation; interactive approval wiring is a
        // follow-up (codex surfaces approvals as stream events, not a callback).
        const options = { workingDirectory: cwd, approvalPolicy: "never" as const }
        const thread = resumeId ? sdk.resumeThread(resumeId, options) : sdk.startThread(options)
        const abortController = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller) => Effect.sync(() => controller.abort()),
        )
        const turn = yield* Effect.tryPromise({
          try: () => thread.run(prompt, { signal: abortController.signal }),
          catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
        })
        const summary = turn.finalResponse.trim()
        const sessionId = thread.id ?? undefined
        if (!summary) {
          return {
            status: "failed" as const,
            summary: `CLI "${name}" completed without a final response`,
            ...(sessionId ? { sessionId } : {}),
            errors: ["completed without a final response"],
          }
        }
        if (!sessionId) {
          return {
            status: "failed" as const,
            summary: `CLI "${name}" completed without a persistent thread id`,
            errors: ["completed without a persistent thread id"],
          }
        }
        return { status: "success" as const, summary, sessionId }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            status: "failed" as const,
            summary: `CLI "${name}" SDK execution failed: ${error.message}`,
            errors: [error.message],
          }),
        ),
      ),
    ),
})

// Production adapter backed by the real Codex SDK. The SDK's richer types are
// cast to the minimal seam — a third-party compatibility escape (we only need
// startThread/resumeThread/run for one-shot + resume delegation).
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- third-party SDK surface intentionally narrowed to the minimal seam
export const adapter: CliAdapter = makeCodexSdkAdapter(new RealCodex() as unknown as CodexSdk)
