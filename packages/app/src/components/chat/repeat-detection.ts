/**
 * Repeat detection for session capture.
 * Pure functions — no internal state. Caller scopes prompts to a single session.
 *
 * Uses Jaccard similarity on normalized word tokens (CJK: character bigrams).
 */

const DEFAULT_THRESHOLD = 0.7
const MIN_SIMILAR_COUNT = 3

const CJK_RE = /[一-鿿㐀-䶿豈-﫿]/

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\p{L}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function hasCJK(text: string): boolean {
  return CJK_RE.test(text)
}

/**
 * Tokenize text for Jaccard comparison.
 * For CJK text: character bigrams (overlapping 2-char windows).
 * For non-CJK text: whitespace-separated words.
 */
function tokenize(text: string): string[] {
  const normalized = normalize(text)
  if (!normalized) return []
  if (hasCJK(normalized)) {
    const chars = Array.from(normalized.replace(/\s+/g, ""))
    if (chars.length <= 1) return chars
    const bigrams: string[] = []
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1])
    }
    return bigrams
  }
  return normalized.split(/\s+/).filter(Boolean)
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b))
}

export interface RepeatMatch {
  readonly count: number
  readonly lastSimilarity: number
}

/**
 * Count how many prompts in the history are similar to `current` (≥ threshold).
 * Returns undefined if count < MIN_SIMILAR_COUNT.
 */
export function countSimilarPrompts(
  current: string,
  history: string[],
  threshold: number = DEFAULT_THRESHOLD,
): RepeatMatch | undefined {
  const tokens = tokenize(current)
  let count = 0
  let best = 0
  for (const entry of history) {
    const sim = jaccardSimilarity(tokens, tokenize(entry))
    if (sim >= threshold) {
      count++
      if (sim > best) best = sim
    }
  }
  return count >= MIN_SIMILAR_COUNT ? { count, lastSimilarity: best } : undefined
}

/**
 * Extract user prompts from session messages in chronological order.
 * Each prompt is normalized text from the message's text parts.
 * Parts are accessed via the provided getParts function (not from message.parts,
 * since Message types don't carry inline parts).
 */
export function extractUserPrompts(
  messages: Array<{ role: string; id: string }>,
  getParts: (messageID: string) => Array<{ type: string; text?: string }>,
): string[] {
  return messages
    .filter((m) => m.role === "user")
    .map((m) =>
      getParts(m.id)
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(" "),
    )
    .map(normalize)
    .filter((text) => text.length > 0)
}

/** Reset helper — returns a clean state object for createStore */
export function freshRepeatState() {
  return { show: false, message: "", dismissCount: 0 }
}
