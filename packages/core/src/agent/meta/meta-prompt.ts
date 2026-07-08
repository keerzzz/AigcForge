export * as MetaPrompt from "./meta-prompt"

import { Context, Effect } from "effect"

/**
 * Fills {{SUBAGENTS_LIST}} and {{CLI_LIST}} placeholders in the meta agent
 * system prompt. SUBAGENTS_LIST is filled from AgentV2.all(). CLI_LIST
 * requires the aigcfroge AdapterRegistry (provided via seam).
 */
export interface Interface {
  readonly fill: (prompt: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MetaPromptFiller") {}

/**
 * Fills {{SUBAGENTS_LIST}} with a list of subagents (agents whose mode !== "primary").
 * This is a pure function; takes the list of agent info items as input.
 */
export function fillSubagentsList(
  prompt: string,
  subagents: ReadonlyArray<{ id: string; description: string }>,
): string {
  const list = subagents
    .filter((a) => a.id !== "meta")
    .map((a) => `- **${a.id}**: ${a.description || "No description"}`)
    .join("\n")
  return prompt.replace("{{SUBAGENTS_LIST}}", list || "(no subagents registered)")
}

/**
 * Fills {{CLI_LIST}} with a list of available CLI tools.
 * Accepts an optional array of CLI names; if empty, shows a default message.
 */
export function fillCliList(prompt: string, clis: string[]): string {
  const list = clis.map((name) => `- ${name}`).join("\n")
  return prompt.replace("{{CLI_LIST}}", list || "(no external CLI tools configured)")
}

/**
 * Renders the full prompt with all known fillers.
 * CLI_LIST requires the service to be present (aigcfroge layer provides it).
 */
export function renderPrompt(prompt: string, subagents: ReadonlyArray<{ id: string; description: string }>): string {
  return fillCliList(fillSubagentsList(prompt, subagents), [])
}
