export * as CodexAcpAdapter from "./codex-acp"

import { Effect } from "effect"
import { makeBridgeConnectionFactory } from "../acp-client/process"
import { which } from "../util/which"
import { makeAcpAdapter, type AcpConnectionFactory } from "./acp"
import type { CliAdapter } from "./cli-adapter"

/**
 * A `transport: "acp"` adapter driving the `codex-acp` bridge process
 * (`@zed-industries/codex-acp`). Tests inject a mock connection factory;
 * production uses the real bridge.
 */
export const makeCodexAcpAdapter = (connectionFactory: AcpConnectionFactory, name = "codex"): CliAdapter =>
  makeAcpAdapter({
    name,
    command: "codex-acp",
    description: "Codex — OpenAI's coding agent (ACP transport)",
    detect: () => Effect.sync(() => which("codex-acp") !== null),
    connectionFactory,
  })

// Production adapter backed by the real `codex-acp` stdio bridge. Only listed
// when the bridge binary is on PATH (see detect); the SDK/jsonl transports
// remain the default otherwise.
export const adapter: CliAdapter = makeCodexAcpAdapter(makeBridgeConnectionFactory({ command: "codex-acp", args: ["--stdio"] }))
