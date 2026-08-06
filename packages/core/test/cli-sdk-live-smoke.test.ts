/**
 * Real-CLI smoke tests for the SDK-transport adapters (manual acceptance item
 * from the M4 approval — "真实 SDK it.live 冒烟").
 *
 * These exercise the production `adapter` exports against the real
 * `@anthropic-ai/claude-agent-sdk` query() and the real `@openai/codex-sdk`
 * Codex instance, verifying that a live stream/turn yields a DelegationResult
 * with a session id and that the id can resume the same external session.
 *
 * They only run when the matching CLI is on PATH (claude / codex) AND the
 * operator opts in via `AIGCFROGE_LIVE_CLI_SMOKE=1`; CI without the binaries
 * skips them. The env gate keeps the routine suite green even where a CLI is
 * installed but the LLM provider is unavailable/rate-limited (this machine's
 * CC Switch local proxy returned 403 "quota exhausted" on 2026-08-06).
 *
 * @see packages/core/src/tool/claude-code-sdk.ts
 * @see packages/core/src/tool/codex-sdk.ts
 */
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ClaudeCodeSdkAdapter } from "../src/tool/claude-code-sdk"
import { CodexSdkAdapter } from "../src/tool/codex-sdk"
import { which } from "../src/util/which"

const hasClaude = which("claude") !== null && process.env.AIGCFROGE_LIVE_CLI_SMOKE === "1"
const hasCodex = which("codex") !== null && process.env.AIGCFROGE_LIVE_CLI_SMOKE === "1"

const claudeIt = hasClaude ? test : test.skip
const codexIt = hasCodex ? test : test.skip

claudeIt(
  "real claude-code SDK: stream → DelegationResult with sessionId, then resume",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const adapter = ClaudeCodeSdkAdapter.adapter
        const cwd = process.cwd()
        const first = yield* adapter.execute!({
          prompt: "Reply with exactly the single word: OK",
          cwd,
        })
        expect(first.status).toBe("success")
        expect(first.summary.length).toBeGreaterThan(0)
        expect(first.sessionId).toBeTruthy()

        // Resume the same external session through the captured id.
        const resumed = yield* adapter.execute!({
          prompt: "Reply with exactly the single word: OKAY",
          cwd,
          resumeId: first.sessionId!,
        })
        expect(resumed.status).toBe("success")
        expect(resumed.sessionId).toBe(first.sessionId)
      }),
    ),
  { timeout: 180_000 },
)

codexIt(
  "real codex SDK: run → DelegationResult with sessionId, then resume",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const adapter = CodexSdkAdapter.adapter
        const cwd = process.cwd()
        const first = yield* adapter.execute!({
          prompt: "Reply with exactly the single word: OK",
          cwd,
        })
        expect(first.status).toBe("success")
        expect(first.summary.length).toBeGreaterThan(0)
        expect(first.sessionId).toBeTruthy()

        // Resuming a codex thread by id keeps the same thread.
        const resumed = yield* adapter.execute!({
          prompt: "Reply with exactly the single word: OKAY",
          cwd,
          resumeId: first.sessionId!,
        })
        expect(resumed.status).toBe("success")
      }),
    ),
  { timeout: 180_000 },
)
