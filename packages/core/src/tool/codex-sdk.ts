export * as CodexSdkAdapter from "./codex-sdk"

import { Duration, Effect } from "effect"
import { CliExecutable } from "./cli-executable"
import { which } from "../util/which"
import type { CliAdapter } from "./cli-adapter"
import { DelegationParser } from "./delegation-parser"

/**
 * The minimal Codex SDK surface this adapter drives. Injected so unit tests
 * provide a fake and production passes the real `@openai/codex-sdk` `Codex`
 * instance. `run()` returns the completed turn whose `finalResponse` is the
 * agent's final text; resume reopens a thread by id.
 */
export interface CodexSdk {
  startThread(options?: { workingDirectory?: string; approvalPolicy?: "never" }): {
    id?: string | null
    run(input: string, options?: { signal?: AbortSignal }): Promise<{ finalResponse: string }>
  }
  resumeThread(
    id: string,
    options?: { workingDirectory?: string; approvalPolicy?: "never" },
  ): {
    id?: string | null
    run(input: string, options?: { signal?: AbortSignal }): Promise<{ finalResponse: string }>
  }
}

export const makeCodexSdkAdapter = (
  sdk: CodexSdk | (() => Promise<CodexSdk>),
  name = "codex",
): CliAdapter & Required<Pick<CliAdapter, "execute">> => ({
  name,
  command: "codex",
  description: "Codex — OpenAI's coding agent (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which("codex") !== null),
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId, timeoutMs }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client =
          typeof sdk === "function"
            ? yield* Effect.tryPromise({
                try: sdk,
                catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
              })
            : sdk
        // approvalPolicy "never" auto-denies permission prompts — the unattended
        // default for external-CLI delegation; interactive approval wiring is a
        // follow-up (codex surfaces approvals as stream events, not a callback).
        const options = { workingDirectory: cwd, approvalPolicy: "never" as const }
        const thread = yield* Effect.try({
          try: () => (resumeId ? client.resumeThread(resumeId, options) : client.startThread(options)),
          catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
        })
        const abortController = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller) => Effect.sync(() => controller.abort()),
        )
        const turnResult = yield* Effect.tryPromise({
          try: () => thread.run(prompt, { signal: abortController.signal }),
          catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
        }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(timeoutMs ?? 300_000),
            orElse: () =>
              Effect.succeed({
                timedOut: true as const,
                status: "failed" as const,
                summary: `CLI "${name}" SDK execution timed out`,
                errorCode: "timeout",
                recoveryRequired: true,
                errors: ["Timed out"],
              }),
          }),
          Effect.catch((error) =>
            Effect.succeed({
              status: "failed" as const,
              summary: `CLI "${name}" SDK execution failed: ${error.message}`,
              errorCode: "provider_error",
              recoveryRequired: true,
              errors: [error.message],
            }),
          ),
        )
        // The SDK assigns the id after the turn starts, including failed turns.
        const sessionId = thread.id ?? resumeId ?? undefined
        if (!("finalResponse" in turnResult)) {
          return { ...turnResult, ...(sessionId ? { sessionId } : {}) }
        }
        const summary = turnResult.finalResponse.trim()
        if (!summary) {
          return {
            status: "failed" as const,
            summary: `CLI "${name}" completed without a final response`,
            ...(sessionId ? { sessionId } : {}),
            errors: ["completed without a final response"],
            errorCode: "malformed_output",
            recoveryRequired: true,
          }
        }
        if (!sessionId) {
          return {
            status: "failed" as const,
            summary: `CLI "${name}" completed without a persistent thread id`,
            errors: ["completed without a persistent thread id"],
          }
        }
        const parsed = DelegationParser.parseDelegationResult(turnResult.finalResponse)
        return { status: "success" as const, summary, sessionId, review: parsed?.review }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            status: "failed" as const,
            summary: `CLI "${name}" SDK initialization failed: ${error.message}`,
            ...(resumeId ? { sessionId: resumeId } : {}),
            errorCode: "cli_unavailable",
            recoveryRequired: true,
            errors: [error.message],
          }),
        ),
      ),
    ),
})

// Discovery never constructs an SDK client. Resolve the user's local CLI only
// when executing; the SDK must not search this application's npm dependencies.
export const adapter: CliAdapter = makeCodexSdkAdapter(async () => {
  const codexPathOverride = CliExecutable.resolve("codex")
  const { Codex } = await import("@openai/codex-sdk")
  return new Codex({ codexPathOverride })
})
