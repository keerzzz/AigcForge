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
 * Replaces the placeholder or an exactly matched, previously generated catalog.
 * Frozen callers supply the original pool so unrelated authored text stays intact.
 */
export function fillSubagentsList(
  prompt: string,
  subagents: ReadonlyArray<{ id: string; description: string }>,
  previousSubagents?: ReadonlyArray<{ id: string; description: string }>,
): string {
  const render = (pool: ReadonlyArray<{ id: string; description: string }>) =>
    pool
      .filter((agent) => agent.id !== "meta")
      .map((agent) => `- **${agent.id}**: ${agent.description || "No description"}`)
      .join("\n") || "(no subagents registered)"
  const list = render(subagents)
  if (prompt.includes("{{SUBAGENTS_LIST}}")) return prompt.replace("{{SUBAGENTS_LIST}}", list)
  if (previousSubagents === undefined) return prompt
  const opening = "## Available Subagents"
  const closing = "## Available CLI Tools"
  const start = prompt.indexOf(opening)
  const end = prompt.indexOf(closing)
  if (
    start < 0 ||
    end <= start ||
    prompt.indexOf(opening, start + opening.length) !== -1 ||
    prompt.indexOf(closing, end + closing.length) !== -1 ||
    (start > 0 && prompt[start - 1] !== "\n") ||
    prompt[start + opening.length] !== "\n" ||
    prompt.slice(end - 2, end) !== "\n\n" ||
    (end + closing.length < prompt.length && prompt[end + closing.length] !== "\n") ||
    /^[ \t]*(?:`{3,}|~{3,})/m.test(prompt.slice(0, end)) ||
    prompt.slice(start + opening.length + 1, end - 2) !== render(previousSubagents)
  )
    return prompt
  return prompt.slice(0, start + opening.length + 1) + list + prompt.slice(end - 2)
}

/**
 * The message rendered when no external CLI tools are detectable. Kept as a
 * stable marker: `fillCliList` replaces either the `{{CLI_LIST}}` placeholder
 * or this marker, so a later fill can overwrite an earlier empty fill
 * (transforms may run in any order across core plugin init and the aigcfroge
 * filler).
 */
export const NO_CLI_MESSAGE = "(no external CLI tools configured)"

/**
 * Fills {{CLI_LIST}} with a list of available CLI tools.
 * Accepts an optional array of CLI names; if empty, shows a default message.
 * Order-independent: re-filling an already-filled prompt replaces the previous
 * list or the {@link NO_CLI_MESSAGE} marker.
 */
export function fillCliList(prompt: string, clis: string[]): string {
  const list = clis.map((name) => `- ${name}`).join("\n") || NO_CLI_MESSAGE
  if (prompt.includes("{{CLI_LIST}}")) return prompt.replace("{{CLI_LIST}}", list)
  return prompt.replace(NO_CLI_MESSAGE, list)
}

/**
 * Fills {{ASSETS_LIST}} with a list of available chat mode assets grouped by kind.
 * Accepts an array of { kind, name } objects; kinds and names are sorted alphabetically.
 * Shows "(no assets available)" when the list is empty.
 */
export function fillAssetsList(
  prompt: string,
  assets: ReadonlyArray<{ kind: string; name: string }>,
  previousSkills?: ReadonlyArray<string>,
): string {
  if (previousSkills === undefined) return prompt.replace("{{ASSETS_LIST}}", formatAssetsList(assets))

  return refillSkills(prompt, assets, previousSkills)
}

function formatAssetsList(assets: ReadonlyArray<{ kind: string; name: string }>) {
  if (assets.length === 0) return "(no assets available)"

  const byKind = new Map<string, string[]>()
  for (const asset of assets) {
    let list = byKind.get(asset.kind)
    if (!list) {
      list = []
      byKind.set(asset.kind, list)
    }
    list.push(asset.name)
  }

  for (const names of byKind.values()) {
    names.sort()
  }

  const sortedKinds = Array.from(byKind.keys()).sort()
  const lines = sortedKinds.map((kind) => {
    const plural = kind.endsWith("s") ? kind : `${kind}s`
    return `- **${plural}**: ${byKind.get(kind)?.join(", ")}`
  })

  return lines.join("\n")
}

function refillSkills(
  prompt: string,
  assets: ReadonlyArray<{ kind: string; name: string }>,
  previousSkills: ReadonlyArray<string>,
) {
  if (
    previousSkills.length === 0 ||
    assets.some((asset) => asset.kind !== "skill" || !previousSkills.includes(asset.name)) ||
    [...previousSkills, ...assets.map((asset) => asset.name)].some((name) => /[\r\n]/.test(name))
  )
    return prompt

  const opening = "## Available Assets"
  const closing = "## Protocol Documents"
  const start = prompt.indexOf(opening)
  const end = prompt.indexOf(closing)
  if (
    start < 0 ||
    end <= start ||
    prompt.indexOf(opening, start + opening.length) !== -1 ||
    prompt.indexOf(closing, end + closing.length) !== -1 ||
    (start > 0 && prompt[start - 1] !== "\n") ||
    prompt[start + opening.length] !== "\n" ||
    prompt.slice(end - 2, end) !== "\n\n" ||
    (end + closing.length < prompt.length && prompt[end + closing.length] !== "\n") ||
    /^[ \t]*(?:`{3,}|~{3,})/m.test(prompt.slice(0, end))
  )
    return prompt

  const lines = prompt.slice(start + opening.length + 1, end - 2).split("\n")
  const previous = formatAssetsList(previousSkills.map((name) => ({ kind: "skill", name })))
  if (
    lines.filter((line) => line.startsWith("- **skills**:")).length !== 1 ||
    !lines.includes(previous) ||
    lines.some((line) => !/^- \*\*[a-z]+\*\*: .+$/.test(line))
  )
    return prompt

  const next = lines.flatMap((line) =>
    line !== previous ? [line] : assets.length === 0 ? [] : [formatAssetsList(assets)],
  )
  return (
    prompt.slice(0, start + opening.length + 1) + (next.join("\n") || "(no assets available)") + prompt.slice(end - 2)
  )
}

/**
 * Renders the full prompt with all known fillers.
 * CLI_LIST requires the service to be present (aigcfroge layer provides it).
 */
export function renderPrompt(prompt: string, subagents: ReadonlyArray<{ id: string; description: string }>): string {
  return fillCliList(fillSubagentsList(prompt, subagents), [])
}
