export * as ImportParser from "./import-parser"

import { Context, Effect, Layer } from "effect"
import {
  ImportParser as SchemaImportParser,
} from "@aigcfroge/schema/import-parser"

// -- Service interface --

export interface Interface {
  readonly parse: (
    input: string,
    options?: { readonly maxBytes?: number },
  ) => Effect.Effect<SchemaImportParser.Result>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ImportParser") {}

// -- Block type detection --

/**
 * Per-candidate ceiling. Must match `ImportParser.Candidate`'s `Template` check in
 * packages/schema, or constructing a Candidate throws out of a `never`-error Effect.
 */
const MAX_CANDIDATE_BYTES = 100_000

/**
 * Whole-input ceiling. Deliberately larger than the per-candidate ceiling: a long
 * document with several small code blocks is a legitimate import, and each block is
 * bounded separately below. Bounds the noise-stripping and extraction scans.
 */
const MAX_BYTES = 200 * 1024

const fencedCodeBlock = /^(`{3,}|~{3,})([^\s\n]*)[^\n]*\n([\s\S]*?)\n?\1/mg

interface ExtractedBlock {
  readonly lang: string
  readonly body: string
  readonly headerBefore?: string
}

interface Extraction {
  readonly blocks: ExtractedBlock[]
  /** Prose between/around the fences. Discarded from candidates, so noise found
   *  here is reported as a warning; noise inside a block body is content. */
  readonly outside: string
  readonly fenced: boolean
}

function extractBlocks(input: string): Extraction {
  const blocks: ExtractedBlock[] = []
  const outsideParts: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(fencedCodeBlock.source, fencedCodeBlock.flags)
  let lastIndex = 0

  while ((match = re.exec(input)) !== null) {
    const lang = (match[2] ?? "").toLowerCase().replace(/[^a-z0-9_+-]/g, "")
    const body = match[3]
    const textBefore = input.slice(lastIndex, match.index)
    outsideParts.push(textBefore)
    const headerMatch = textBefore.match(/#+\s+([^\n]+)$/m)
    const headerBefore = headerMatch ? headerMatch[1].trim() : undefined
    blocks.push({ lang, body, headerBefore })
    lastIndex = re.lastIndex
  }

  // If no fenced blocks found, treat whole input as plain text
  if (blocks.length === 0) {
    const trimmed = input.trim()
    if (trimmed) {
      blocks.push({ lang: "", body: trimmed })
    }
    return { blocks, outside: "", fenced: false }
  }

  outsideParts.push(input.slice(lastIndex))
  return { blocks, outside: outsideParts.join("\n"), fenced: true }
}

// -- Noise stripping --

const THINKING_TAGS = [
  { open: "<thinking", close: "</thinking>" },
  { open: "<thought", close: "</thought>" },
] as const

/**
 * Strip `<thinking>`/`<thought>` spans using linear indexOf scanning.
 * A lazy `[\s\S]*?` regex rescans to end-of-input from every unclosed open tag,
 * which is quadratic on adversarial paste input; indexOf bounds each tag type to
 * two scans regardless of how many unclosed tags the input contains.
 */
function stripThinking(text: string): { cleaned: string; stripped: boolean } {
  const lower = text.toLowerCase()
  let out = ""
  let cursor = 0
  let stripped = false
  for (;;) {
    let best: { readonly close: string; readonly openAt: number; readonly closeAt: number } | undefined
    for (const tag of THINKING_TAGS) {
      const openAt = lower.indexOf(tag.open, cursor)
      if (openAt === -1) continue
      const closeAt = lower.indexOf(tag.close, openAt + tag.open.length)
      if (closeAt === -1) continue
      if (!best || openAt < best.openAt) best = { close: tag.close, openAt, closeAt }
    }
    if (!best) break
    out += text.slice(cursor, best.openAt)
    cursor = best.closeAt + best.close.length
    stripped = true
  }
  return { cleaned: stripped ? out + text.slice(cursor) : text, stripped }
}

function stripProseNoise(input: string): { cleaned: string; warnings: string[] } {
  const warnings: string[] = []
  let { cleaned: text, stripped } = stripThinking(input)
  if (stripped) {
    warnings.push("stripped_thinking")
  }

  // Strip conversational wrapper lines only for raw prose. Warn only when a line
  // was actually removed — a warning on unchanged text tells the user their
  // content was edited when it was not.
  const withoutTurns = text.replace(/^(User|Assistant|Human|AI):\s.*$/gm, "")
  if (withoutTurns !== text) {
    text = withoutTurns
    warnings.push("stripped_conversation")
  }

  // Strip metadata comments
  const withoutComments = text.replace(/^<!--[\s\S]*?-->|^\/\*[\s\S]*?\*\//gm, "")
  if (withoutComments !== text) {
    text = withoutComments
    warnings.push("stripped_comments")
  }

  // Compress consecutive blank lines
  text = text.replace(/\n{4,}/g, "\n\n\n")

  return { cleaned: text.trim(), warnings }
}

// -- Type inference --

function inferKind(lang: string, blockContent: string): string {
  const lower = lang.toLowerCase()

  if (lower === "yaml" || lower === "yml") {
    const content = blockContent.trim()
    if (/\bkind:\s*workflow\b/.test(content) || /^\s*steps:/m.test(content)) {
      return "workflow"
    }
    if (/\bkind:\s*plugin\b/.test(content) || (/^\s*name:\s*\S/m.test(content) && (/^\s*hooks:/m.test(content) || /^\s*tools:/m.test(content)))) {
      return "plugin"
    }
    if (/^\s*triggers:/m.test(content) || /^\s*context:/m.test(content) || /\bkind:\s*skill\b/.test(content)) {
      return "skill"
    }
    return "prompt"
  }

  if (lower === "json" || lower === "jsonc") {
    try {
      const parsed = JSON.parse(blockContent)
      if (parsed && typeof parsed === "object" && "mcpServers" in parsed) {
        return "mcp"
      }
      if (parsed && typeof parsed === "object" && "commands" in parsed) {
        return "command"
      }
    } catch {
      // JSON parse failed → fall through
    }
    return "prompt"
  }

  if (lower === "sh" || lower === "bash" || lower === "zsh" || lower === "shell") {
    return "command"
  }

  return "prompt"
}

// -- Name inference --

function cleanSegmentName(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
}

function safeSliceCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join("").trim()
}

function inferName(block: ExtractedBlock, index: number): string {
  if (block.headerBefore) {
    const cleaned = cleanSegmentName(block.headerBefore)
    if (cleaned) return safeSliceCodePoints(cleaned, 80)
  }

  const lines = block.body.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith("#!")) continue // Skip shebang lines
    const cleaned = cleanSegmentName(trimmed)
    if (cleaned) {
      return safeSliceCodePoints(cleaned, 80)
    }
  }

  return `Imported Asset ${index + 1}`
}

// -- Main parse function --

function parseInput(
  input: string,
  options?: { readonly maxBytes?: number },
): SchemaImportParser.Result {
  const maxBytes = options?.maxBytes ?? MAX_BYTES

  // 1. Size check
  const byteLength = new TextEncoder().encode(input).length
  if (byteLength > maxBytes) {
    return SchemaImportParser.Result.make({
      candidates: [],
      warnings: [],
      errors: [new SchemaImportParser.ParseError({ section: "Input", reason: "too_large" })],
    })
  }

  if (!input.trim()) {
    return SchemaImportParser.Result.make({
      candidates: [],
      warnings: [],
      errors: [new SchemaImportParser.ParseError({ section: "Input", reason: "empty" })],
    })
  }

  // 2. Strip thinking spans globally: they are model scratch space, never asset
  //    content, wherever they appear. Conversation-turn and comment stripping is
  //    NOT global — it runs per-block below, and only on the plain-text fallback,
  //    so `User:` / `Assistant:` lines inside a fenced template survive verbatim.
  const warnings: string[] = []
  const { cleaned: unthoughtInput, stripped: hadThinking } = stripThinking(input)
  if (hadThinking) {
    warnings.push("stripped_thinking")
  }

  // 3. Extract blocks FIRST
  const extraction = extractBlocks(unthoughtInput)
  const rawBlocks = extraction.blocks
  if (rawBlocks.length === 0) {
    return SchemaImportParser.Result.make({
      candidates: [],
      warnings,
      errors: [new SchemaImportParser.ParseError({ section: "Input", reason: "empty" })],
    })
  }

  const errors: Array<SchemaImportParser.ParseError> = []
  const candidates: Array<SchemaImportParser.Candidate> = []
  const seenNames = new Set<string>()

  // Prose outside the fences is discarded, so report noise found there. Noise
  // inside a block body is preserved content and must NOT raise a warning.
  if (extraction.fenced && extraction.outside) {
    if (/^(User|Assistant|Human|AI):\s.*$/m.test(extraction.outside)) {
      warnings.push("stripped_conversation")
    }
    if (/^<!--[\s\S]*?-->|^\/\*[\s\S]*?\*\//m.test(extraction.outside)) {
      warnings.push("stripped_comments")
    }
  }

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i]
    let template = block.body.trim()

    // If it was plain text fallback (no fenced blocks), apply prose noise stripping
    if (rawBlocks.length === 1 && block.lang === "" && !input.includes("```") && !input.includes("~~~")) {
      const prose = stripProseNoise(template)
      template = prose.cleaned
      for (const w of prose.warnings) {
        if (!warnings.includes(w)) warnings.push(w)
      }
    }

    if (!template) {
      continue
    }

    const templateBytes = new TextEncoder().encode(template).length
    if (templateBytes > MAX_CANDIDATE_BYTES) {
      errors.push(new SchemaImportParser.ParseError({ section: `Block ${i + 1}`, reason: "too_large" }))
      continue
    }

    const kind = inferKind(block.lang, template)
    let candidateName = inferName(block, i)
    if (!candidateName) {
      candidateName = `Imported Asset ${i + 1}`
    }

    if (seenNames.has(candidateName)) {
      let suffix = 2
      let disambiguated = safeSliceCodePoints(`${candidateName} ${suffix}`, 80)
      while (seenNames.has(disambiguated)) {
        suffix++
        disambiguated = safeSliceCodePoints(`${candidateName} ${suffix}`, 80)
      }
      candidateName = disambiguated
    }
    seenNames.add(candidateName)

    try {
      candidates.push(
        new SchemaImportParser.Candidate({
          kind,
          name: candidateName,
          description: "",
          template,
        }),
      )
    } catch (e: any) {
      errors.push(new SchemaImportParser.ParseError({ section: `Block ${i + 1}`, reason: e?.message ?? "validation_failed" }))
    }
  }

  if (candidates.length === 0 && errors.length === 0) {
    errors.push(new SchemaImportParser.ParseError({ section: "Input", reason: "empty" }))
  }

  return SchemaImportParser.Result.make({ candidates, warnings, errors })
}

// -- Layer --

export const ImportParserLive = Layer.effect(
  Service,
  Effect.sync(() => Service.of({
    parse: (input: string, options?: { readonly maxBytes?: number }) =>
      Effect.sync(() => parseInput(input, options)),
  })),
)
