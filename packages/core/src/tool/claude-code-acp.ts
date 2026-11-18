export * as ClaudeCodeAcpAdapter from "./claude-code-acp.js"

import { Effect } from "effect"
import { makeBridgeConnectionFactory } from "../acp-client/process"
import { which } from "../util/which"
import { makeAcpAdapter, type AcpConnectionFactory } from "./acp.js"
import type { CliAdapterValue } from "./cli-adapter.js"

/**
 * A `transport: "acp"` adapter driving the `claude-code-acp` bridge process.
 * Tests inject a mock connection factory; production uses the real bridge.
 */
export const makeClaudeCodeAcpAdapter = (
  connectionFactory?: AcpConnectionFactory,
  name = "claude-code",
  command = "claude-code-acp",
): CliAdapterValue => ({
  ...makeAcpAdapter({
    name,
    command,
    description: "Claude Code — Anthropic's official AI coding assistant (ACP transport)",
    detect: () => Effect.sync(() => which(command) !== null),
    connectionFactory: connectionFactory ?? makeBridgeConnectionFactory({ command, args: [] }),
  }),
  forCommand: (command) => makeClaudeCodeAcpAdapter(connectionFactory, name, command),
})

// Production adapter backed by the real `claude-code-acp` stdio bridge. Only
// listed when the bridge binary is on PATH (see detect); the SDK/jsonl
// transports remain the default otherwise.
export const adapter: CliAdapterValue = makeClaudeCodeAcpAdapter()
