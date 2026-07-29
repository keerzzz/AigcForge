/**
 * Simple text similarity for detecting repeated instructions within a session.
 * Uses Jaccard similarity on normalized word tokens with a configurable threshold.
 */

const DEFAULT_THRESHOLD = 0.7

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(Boolean))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b))
}

export interface RepeatMatch {
  readonly index: number
  readonly similarity: number
  readonly text: string
}

export function findSimilarPrompt(
  current: string,
  history: string[],
  threshold: number = DEFAULT_THRESHOLD,
): RepeatMatch | undefined {
  let best: RepeatMatch | undefined
  for (let i = 0; i < history.length; i++) {
    const sim = textSimilarity(current, history[i]!)
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { index: i, similarity: sim, text: history[i]! }
    }
  }
  return best
}

export function createPromptHistory(): {
  readonly push: (text: string) => void
  readonly findSimilar: (text: string, threshold?: number) => RepeatMatch | undefined
  readonly all: () => readonly string[]
} {
  const entries: string[] = []
  return {
    push: (text: string) => {
      const normalized = normalize(text)
      if (normalized && normalized !== entries[entries.length - 1]) {
        entries.push(normalized)
      }
    },
    findSimilar: (text: string, threshold?: number) => {
      return findSimilarPrompt(normalize(text), entries, threshold)
    },
    all: () => entries,
  }
}
