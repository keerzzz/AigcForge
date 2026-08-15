import type { SessionCapture } from "@aigcfroge/schema/session-capture"

/** Part types that represent interactive UI rather than content */
const INTERACTIVE_TYPES = new Set(["question", "confirm", "shell"])

/** Minimal part shape we consume */
interface PartLike {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

/**
 * Extract text content from message parts.
 * - Includes text parts (non-synthetic, non-ignored)
 * - Excludes reasoning parts by default (PRD §8.2, ADR-13) unless includeReasoning is true
 * - Filters tool calls and interactive UI parts
 */
export function extractMessageContent(parts: PartLike[], includeReasoning = false): string {
  return parts
    .filter((p) => {
      if (INTERACTIVE_TYPES.has(p.type)) return false
      if (p.type === "text") return !p.synthetic && !p.ignored
      if (p.type === "reasoning") return includeReasoning
      return false
    })
    .map((p) => p.text ?? "")
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
}

/**
 * Wrap captured content with source metadata markers.
 */
export function wrapCaptureContent(content: string, source: SessionCapture.CaptureSource): string {
  const escaped = content.replaceAll(/<\/captured_content\s*>/gi, "<\\/captured_content>")
  return `<captured_content source_session="${source.sessionID}" source_message="${source.messageID}">\n${escaped}\n</captured_content>`
}

/**
 * Generate the seed prompt for the chat orchestrator.
 * Combines the wrapped content with an i18n instruction.
 */
export function captureSeedPrompt(
  content: string,
  source: SessionCapture.CaptureSource,
  t: (key: string) => string,
): string {
  const wrapped = wrapCaptureContent(content, source)
  return `${wrapped}\n\n${t("chatCapture.instruction")}`
}
