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

const MAX_BYTES = 200 * 1024 // 200KB

const fencedCodeBlock = /^(`{3,}|~{3,})(\w*)\s*\n([\s\S]*?)\n?\1/mg

function extractBlocks(input: string): Array<{ lang: string; body: string }> {
  const blocks: Array<{ lang: string; body: string }> = []
  let match: RegExpExecArray | null
  const re = new RegExp(fencedCodeBlock.source, fencedCodeBlock.flags)
  while ((match = re.exec(input)) !== null) {
    const lang = match[2]?.toLowerCase() ?? ""
    const body = match[3]
    blocks.push({ lang, body })
  }
  // If no fenced blocks found, treat as plain text
  if (blocks.length === 0) {
    const trimmed = input.trim()
    if (trimmed) {
      blocks.push({ lang: "", body: trimmed })
    }
  }
  return blocks
}

// -- Noise stripping --

const THINKING_RE = /<thinking>[\s\S]*?<\/thinking>|<thought>[\s\S]*?<\/thought>/gi
const CONVERSATION_RE = /^(User|Assistant|Human|AI):\s.*$/gm
const COMMENT_RE = /^<!--[\s\S]*?-->|^\/\*[\s\S]*?\*\//gm

function stripNoise(input: string): { cleaned: string; warnings: string[] } {
  const warnings: string[] = []
  let text = input

  // Strip thinking blocks
  THINKING_RE.lastIndex = 0
  if (THINKING_RE.test(text)) {
    text = text.replace(THINKING_RE, "")
    warnings.push("stripped_thinking")
  }

  // Strip conversation lines
  CONVERSATION_RE.lastIndex = 0
  if (CONVERSATION_RE.test(text)) {
    text = text.replace(CONVERSATION_RE, "")
    warnings.push("stripped_conversation")
  }

  // Strip metadata comments
  text = text.replace(COMMENT_RE, "")

  // Compress >3 consecutive blank lines
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
    if (/^\s*name:\s*\S/m.test(content) && /^\s*tools:/m.test(content) && /^\s*hooks:/m.test(content)) {
      return "plugin"
    }
    if (/^\s*triggers:/m.test(content) || /^\s*context:/m.test(content)) {
      return "skill"
    }
    return "prompt"
  }

  if (lower === "json") {
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

  if (lower === "sh" || lower === "bash" || lower === "zsh") {
    return "command"
  }

  return "prompt"
}

// -- Name inference --

function inferName(input: string, blockContent: string, index: number): string {
  const headingMatch = input.match(/^#\s+(.+)$/m)
  if (headingMatch) {
    return headingMatch[1].trim().slice(0, 80)
  }

  const commentMatch = blockContent.match(/^#\s+(.+)$/m)
  if (commentMatch) {
    return commentMatch[1].trim().slice(0, 80)
  }

  const firstLine = blockContent.split("\n").find((l) => l.trim().length > 0)
  if (firstLine) {
    return firstLine.trim().slice(0, 80)
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

  // 2. Strip noise
  const { cleaned, warnings } = stripNoise(input)

  // 3. Extract blocks from cleaned text
  const blocks = extractBlocks(cleaned)

  if (blocks.length === 0) {
    return SchemaImportParser.Result.make({
      candidates: [],
      warnings,
      errors: [new SchemaImportParser.ParseError({ section: "Input", reason: "empty" })],
    })
  }

  // 4. Parse each block into a candidate
  const errors: Array<SchemaImportParser.ParseError> = []
  const candidates: Array<SchemaImportParser.Candidate> = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const kind = inferKind(block.lang, block.body)
    const name = inferName(cleaned, block.body, i)
    const description = ""
    const template = block.body.trim()

    if (!template) {
      continue
    }

    candidates.push(
      new SchemaImportParser.Candidate({ kind, name, description, template }),
    )
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
