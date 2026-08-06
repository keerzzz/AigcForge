export * as ClaudeCodeAcpAdapter from "./claude-code-acp"

import { Effect } from "effect"
import { makeBridgeConnectionFactory } from "../acp-client/process"
import { which } from "../util/which"
import { makeAcpAdapter, type AcpConnectionFactory } from "./acp"
import type { CliAdapter } from "./cli-adapter"

/**
 * A `transport: "acp"` adapter driving the `claude-code-acp` bridge process.
 * Tests inject a mock connection factory; production uses the real bridge.
 */
export const makeClaudeCodeAcpAdapter = (connectionFactory: AcpConnectionFactory, name = "claude-code"): CliAdapter =>
  makeAcpAdapter({
    name,
    command: "claude-code-acp",
    description: "Claude Code — Anthropic's official AI coding assistant (ACP transport)",
    detect: () => Effect.sync(() => which("claude-code-acp") !== null),
    connectionFactory,
  })

// Production adapter backed by the real `claude-code-acp` stdio bridge. Only
// listed when the bridge binary is on PATH (see detect); the SDK/jsonl
// transports remain the default otherwise.
export const adapter: CliAdapter = makeClaudeCodeAcpAdapter(makeBridgeConnectionFactory({ command: "claude-code-acp", args: ["--stdio"] }))
