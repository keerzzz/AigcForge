export interface MentionTarget {
  readonly name: string
  readonly type: "subagent" | "external-cli"
  readonly prompt: string
  readonly position: number
}

export type WorkflowMode = "parallel" | "pipeline"

export interface ParsedInput {
  readonly text: string
  readonly mentions: MentionTarget[]
  readonly workflow?: WorkflowMode
}

const PIPELINE_KEYWORDS = /^(先|first|then)/i
const PARALLEL_KEYWORDS = /(同时|并行|parallel|和|and|与)/i

export function parse(input: string, knownAgents: string[], knownCLIs: string[]): ParsedInput {
  const trimmed = input.trim()

  if (!trimmed) {
    return { text: input, mentions: [] }
  }

  const known = new Set([...knownAgents, ...knownCLIs])
  const mentions: MentionTarget[] = []
  let workflow: WorkflowMode | undefined

  // Match @name patterns (names can include hyphens, e.g. @claude-code)
  const mentionRegex = /@([\w-]+)/g
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(trimmed)) !== null) {
    const name = match[1]
    if (!known.has(name)) continue

    // Determine type
    const type = knownCLIs.includes(name) ? "external-cli" : "subagent"

    // Extract prompt after this @name until next @name or end
    const afterAt = trimmed.slice(match.index + match[0].length).trim()
    const nextAt = afterAt.search(/@[\w-]+/)
    const prompt = nextAt >= 0 ? afterAt.slice(0, nextAt).trim() : afterAt.trim()

    mentions.push({
      name,
      type,
      prompt,
      position: match.index,
    })
  }

  // Determine workflow mode from text context
  if (mentions.length > 1) {
    if (PIPELINE_KEYWORDS.test(trimmed)) {
      workflow = "pipeline"
    } else if (PARALLEL_KEYWORDS.test(trimmed)) {
      workflow = "parallel"
    } else {
      // Default: no explicit workflow
    }
  }

  // Strip @mentions from text to get clean text
  const text = trimmed.replace(/@[\w-]+\s*/g, "").trim()

  return { text, mentions, workflow }
}

export * as MetaMention from "./mention"
