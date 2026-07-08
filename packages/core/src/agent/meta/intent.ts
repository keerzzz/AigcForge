export type IntentCategory =
  | "content_creation"
  | "code_understanding"
  | "code_modification"
  | "configuration"
  | "workflow"
  | "mention"
  | "unknown"

export type Complexity = "simple" | "moderate" | "complex"

export interface IntentResult {
  category: IntentCategory
  complexity: Complexity
  needsExploration: boolean
  isMention: boolean
}

const CONTENT_PATTERNS = /^(create|generate|write|make|生成|创建|写)/i

const UNDERSTAND_PATTERNS =
  /^(explain|how (does|do|is|are|can)\s|what (is|are|does|do)\s|why (does|do)\s|describe|解释|怎么|是什么|如何)/i

const MODIFY_PATTERNS = /^(refactor|fix|repair|add|change|update|modify|重构|修复|添加|改)/i

const CONFIG_PATTERNS =
  /^(create|configure|connect|set.?up|add).*(agent|mcp|workflow|command)|(agent|mcp|workflow|command).*(config|setup)/i

const WORKFLOW_PATTERNS = /^(先.*再|pipeline|工作流|并行|同时|parallel|fan.?out)/i

const MENTION_PATTERN = /@\w+/

export function classify(input: string): IntentResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { category: "unknown", complexity: "simple", needsExploration: false, isMention: false }
  }

  const hasMention = MENTION_PATTERN.test(trimmed)

  if (hasMention) {
    return { category: "mention", complexity: "moderate", needsExploration: false, isMention: true }
  }

  if (WORKFLOW_PATTERNS.test(trimmed)) {
    return { category: "workflow", complexity: "complex", needsExploration: false, isMention: false }
  }

  if (CONFIG_PATTERNS.test(trimmed)) {
    return { category: "configuration", complexity: "simple", needsExploration: false, isMention: false }
  }

  if (MODIFY_PATTERNS.test(trimmed)) {
    return { category: "code_modification", complexity: "moderate", needsExploration: true, isMention: false }
  }

  if (UNDERSTAND_PATTERNS.test(trimmed)) {
    return { category: "code_understanding", complexity: "simple", needsExploration: true, isMention: false }
  }

  if (CONTENT_PATTERNS.test(trimmed)) {
    return { category: "content_creation", complexity: "simple", needsExploration: false, isMention: false }
  }

  return { category: "unknown", complexity: "moderate", needsExploration: false, isMention: false }
}

export * as MetaIntent from "./intent"
