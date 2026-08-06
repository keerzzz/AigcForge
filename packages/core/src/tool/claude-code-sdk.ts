export * as ClaudeCodeSdkAdapter from "./claude-code-sdk"

import { Effect } from "effect"
import * as ClaudeAgentSdk from "@anthropic-ai/claude-agent-sdk"
import { which } from "../util/which"
import type { CliAdapter, SdkPermissionRequest } from "./cli-adapter"

/**
 * The minimal Claude Agent SDK surface this adapter drives. Injected so unit
 * tests provide a fake and production passes the real
 * `@anthropic-ai/claude-agent-sdk` `query()` function.
 */
export interface ClaudeSdk {
  query(input: {
    prompt: string
    options?: {
      cwd?: string
      resume?: string
      canUseTool?: (
        toolName: string,
        input: Record<string, unknown>,
      ) => Promise<{ behavior: "allow" | "deny"; message?: string } | null>
    }
  }): AsyncIterable<{ type: string; result?: string; is_error?: boolean }>
}

const toSdkPermissionResult = (decision: "allow" | "deny") =>
  decision === "allow"
    ? { behavior: "allow" as const }
    : { behavior: "deny" as const, message: "denied by AigcForge permission policy" }

export const makeClaudeCodeSdkAdapter = (sdk: ClaudeSdk, name = "claude-code"): CliAdapter => ({
  name,
  command: "claude",
  description: "Claude Code — Anthropic's official AI coding assistant (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which("claude") !== null),
  // Unused for the SDK transport; kept to satisfy the jsonl-shaped interface.
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId, canUseTool }) =>
    Effect.gen(function* () {
      let sdkPermission: ((
        toolName: string,
        input: Record<string, unknown>,
      ) => Promise<{ behavior: "allow" | "deny"; message?: string } | null>) | undefined
      if (canUseTool) {
        sdkPermission = async (toolName: string, input: Record<string, unknown>) => {
          const request: SdkPermissionRequest = { toolName, input }
          return toSdkPermissionResult(await canUseTool(request))
        }
      }
      const query = sdk.query({
        prompt,
        options: { cwd, resume: resumeId, canUseTool: sdkPermission },
      })

      const collected = yield* Effect.promise(async () => {
        let summary = ""
        let isError = false
        for await (const message of query) {
          if (message.type === "result") {
            isError = message.is_error === true
            if (message.result) summary = message.result
          }
        }
        return { summary, isError }
      })
      return {
        status: collected.isError ? ("failed" as const) : ("success" as const),
        summary: collected.summary || "Task completed",
      }
    }),
})

// Production adapter backed by the real Claude Agent SDK. The SDK's richer
// types are cast to the minimal seam — a third-party compatibility escape (the
// SDK emits a superset of SDKMessage shapes we intentionally ignore).
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- third-party SDK surface intentionally narrowed to the minimal seam
export const adapter: CliAdapter = makeClaudeCodeSdkAdapter(ClaudeAgentSdk as unknown as ClaudeSdk)
