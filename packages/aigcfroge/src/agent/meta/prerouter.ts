import { classify, type IntentCategory, type Complexity } from "./intent"
import { parse, type MentionTarget } from "./mention"
import { selectEngine } from "./engine-selector"

export interface RouteTarget {
  engine: string
  prompt: string
  mention?: MentionTarget
}

export type Confidence = "high" | "medium" | "pass_through"

export interface RouteResult {
  readonly routed: boolean
  readonly confidence: Confidence
  readonly targets: RouteTarget[]
  readonly category: IntentCategory
  readonly complexity: Complexity
  readonly reason: string
}

const HIGH_CONFIDENCE_CATEGORIES = new Set<IntentCategory>([
  "code_modification",
  "code_understanding",
  "mention",
  "workflow",
])

const MEDIUM_CONFIDENCE_CATEGORIES = new Set<IntentCategory>([
  "content_creation",
  "configuration",
])

/**
 * PreRoute: deterministic, code-driven routing pipeline.
 *
 * Takes raw user input, runs it through the full classification pipeline,
 * and returns either a direct route (skip LLM) or pass-through (let LLM handle).
 */
export function preRoute(input: string): RouteResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return {
      routed: false,
      confidence: "pass_through",
      targets: [],
      category: "unknown",
      complexity: "simple",
      reason: "empty input",
    }
  }

  // Step 1: Check for @mentions first (highest precedence)
  const parsed = parse(trimmed, ["build", "explore", "plan", "general"], ["claude-code", "gemini", "codex", "opencode"])
  const hasAtMention = parsed.mentions.length > 0

  // Step 2: Classify intent from cleaned text (without @mentions)
  const classified = classify(parsed.text || trimmed)

  // Step 3: If @mentions found, route to each mentioned engine
  if (hasAtMention) {
    const targets: RouteTarget[] = parsed.mentions.map((m) => ({
      engine: m.name,
      prompt: m.prompt,
      mention: m,
    }))

    const workflowMode = parsed.workflow
    const reason = workflowMode
      ? `@mention → ${workflowMode} workflow: ${targets.map((t) => t.engine).join(" → ")}`
      : `@mention → direct route: ${targets.map((t) => t.engine).join(", ")}`

    return {
      routed: true,
      confidence: "high",
      targets,
      category: "mention",
      complexity: targets.length > 1 ? "complex" : "moderate",
      reason,
    }
  }

  // Step 4: Route by intent category
  if (classified.category === "unknown") {
    return {
      routed: false,
      confidence: "pass_through",
      targets: [],
      category: "unknown",
      complexity: classified.complexity,
      reason: `classify returned "unknown" — pass to LLM`,
    }
  }

  // Step 5: Select engine
  const { engine } = selectEngine({ category: classified.category, complexity: classified.complexity })

  const isHigh = HIGH_CONFIDENCE_CATEGORIES.has(classified.category)
  const isMedium = MEDIUM_CONFIDENCE_CATEGORIES.has(classified.category)
  const confidence: Confidence = isHigh ? "high" : isMedium ? "medium" : "pass_through"

  const target: RouteTarget = { engine, prompt: parsed.text || trimmed }

  return {
    routed: confidence !== "pass_through",
    confidence,
    targets: [target],
    category: classified.category,
    complexity: classified.complexity,
    reason: `intent="${classified.category}" complexity="${classified.complexity}" → ${engine}`,
  }
}

export * as PreRouter from "./prerouter"
