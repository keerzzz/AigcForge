import { Effect } from "effect"
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

const EXTERNAL_CLI_NAMES = ["claude-code", "gemini", "codex", "opencode"]

/**
 * PreRoute: deterministic, code-driven routing pipeline.
 *
 * Takes raw user input, runs it through the full classification pipeline,
 * and returns either a direct route (skip LLM) or pass-through (let LLM handle).
 *
 * @param knownCLIs - Optional list of available external CLI tool names.
 *   When provided, these are used for @mention routing instead of the
 *   hardcoded default list. Pass [] to disable external CLI routing.
 */
export function preRoute(input: string, knownCLIs?: string[]): RouteResult {
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
  const cliNames = knownCLIs ?? EXTERNAL_CLI_NAMES
  const parsed = parse(trimmed, ["build", "explore", "plan", "general"], cliNames)
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

  // Step 4: Classify intent
  const { category, complexity } = classified

  if (HIGH_CONFIDENCE_CATEGORIES.has(category) || MEDIUM_CONFIDENCE_CATEGORIES.has(category)) {
    const result = selectEngine({ category, complexity })
    const confidence: Confidence = HIGH_CONFIDENCE_CATEGORIES.has(category) ? "high" : "medium"

    return {
      routed: true,
      confidence,
      targets: [{ engine: result.engine, prompt: trimmed }],
      category,
      complexity,
      reason: `${category} → ${result.engine} (${confidence} confidence)`,
    }
  }

  return {
    routed: false,
    confidence: "pass_through",
    targets: [],
    category,
    complexity,
    reason: `uncertain intent: ${category}`,
  }
}

/** Effect-wrapped version for V2 runner integration. */
export const preRouteEffect = Effect.fn("PreRouter.preRoute")(
  (input: string, knownCLIs?: string[]) => Effect.succeed(preRoute(input, knownCLIs)),
)

export * as PreRouter from "./prerouter"
