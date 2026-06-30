import type { IntentCategory, Complexity } from "./intent"

export interface EngineDispatchEntry {
  type: "subagent" | "external-cli" | "workflow"
  target: string
}

export const ENGINE_DISPATCH: Record<string, EngineDispatchEntry> = {
  content_creation: { type: "subagent", target: "general" },
  code_understanding: { type: "subagent", target: "explore" },
  code_modification: { type: "subagent", target: "build" },
  configuration: { type: "subagent", target: "general" },
  workflow: { type: "workflow", target: "builtin" },
  "claude-code": { type: "external-cli", target: "claude-code" },
  gemini: { type: "external-cli", target: "gemini" },
  codex: { type: "external-cli", target: "codex" },
}

export const COMPLEXITY_DEFAULT_ENGINE: Record<Complexity, string> = {
  simple: "general",
  moderate: "build",
  complex: "build",
}

export interface SelectEngineInput {
  category: IntentCategory
  complexity: Complexity
}

export function selectEngine(input: SelectEngineInput): { engine: string } {
  if (input.category !== "unknown") {
    const entry = ENGINE_DISPATCH[input.category]
    if (entry) return { engine: entry.target }
  }

  const byComplexity = COMPLEXITY_DEFAULT_ENGINE[input.complexity]
  return { engine: byComplexity }
}

export * as MetaEngine from "./engine-selector"
