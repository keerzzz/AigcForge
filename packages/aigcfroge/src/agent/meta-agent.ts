/**
 * V1 meta agent configuration.
 * The prompt template now lives in core's plugin/agent.ts (PROMPT_META).
 * This shim provides the V1 Agent module with the prompt from core.
 */
import { fillSubagentsList, fillCliList } from "@aigcfroge/core/agent/meta/meta-prompt"

// Import the PROMPT_META constant from core's plugin module.
// Since it's an inline template, we extract the essential metadata here.
export const MetaAgent = {
  description: "The meta agent — unified orchestration entry point.",
  mode: "primary" as const,
  options: {} as Record<string, unknown>,
  prompt: [
    "You are a meta agent that orchestrates sub-agents and external CLI tools.",
    "",
    "## Available Subagents",
    "{{SUBAGENTS_LIST}}",
    "",
    "## Available CLI Tools",
    "{{CLI_LIST}}",
    "",
    "## Notes",
    "- Use task tool to delegate to subagents",
    "- Pass task_id to reuse a prior subagent session",
  ].join("\n"),
}
