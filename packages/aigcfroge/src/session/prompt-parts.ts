export * as PromptParts from "./prompt-parts"

import { Effect, FileSystem, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { fileURLToPath } from "url"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { FileAttachment, Prompt } from "@aigcfroge/schema/prompt"

/**
 * Legacy prompt-part normalization, extracted from `SessionPrompt.createUserMessage`
 * (S4 GREEN #1: the near-neighbour reusable owner). V1 part resolution and the
 * legacy→V2 canonical adapter both consume this module, so the mapping exists once.
 */

// MCP resource attachment gates, moved verbatim from prompt.ts so both part
// resolution paths share the same rules (S4 GREEN #2).
export const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
export const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

export function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

type LegacyPart =
  | SessionV1.TextPartInput
  | SessionV1.FilePartInput
  | SessionV1.AgentPartInput
  | SessionV1.SubtaskPartInput

const isTextPart = (part: LegacyPart): part is SessionV1.TextPartInput => part.type === "text"
const isFilePart = (part: LegacyPart): part is SessionV1.FilePartInput => part.type === "file"
const isAgentPart = (part: LegacyPart): part is SessionV1.AgentPartInput => part.type === "agent"

/**
 * The single mapping from legacy prompt parts to the canonical Core Prompt
 * (`@aigcfroge/schema/prompt`). File parts carry their raw URI here; the caller
 * materializes them at an effect boundary before the prompt reaches a provider.
 */
export function canonicalPromptFromParts(parts: readonly LegacyPart[]): Prompt {
  const text = parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n")
  const files = parts.filter(isFilePart).map((part) =>
    FileAttachment.create({
      uri: part.url,
      mime: part.mime,
      ...(part.filename ? { name: part.filename } : {}),
      ...(canonicalSource(part.source) ? { source: canonicalSource(part.source) } : {}),
    }),
  )
  const agents = parts
    .filter(isAgentPart)
    .map((part) =>
      part.source
        ? { name: part.name, source: { start: part.source.start, end: part.source.end, text: part.source.value } }
        : { name: part.name },
    )
  return Prompt.make({
    text,
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  })
}

// Legacy file sources are `{ type, text: { value, start, end }, ... }`; the canonical
// `Prompt.Source` is a flat `{ start, end, text }`.
const canonicalSource = (
  source: SessionV1.FilePartInput["source"],
): { start: number; end: number; text: string } | undefined =>
  source?.text ? { start: source.text.start, end: source.text.end, text: source.text.value } : undefined

export class UnmaterializedUriError extends Schema.TaggedErrorClass<UnmaterializedUriError>()(
  "PromptParts.UnmaterializedUriError",
  {
    uri: Schema.String,
  },
) {}

/**
 * Materialize a legacy file part into a provider-lowerable canonical
 * `FileAttachment` at the effect boundary. `file://` URIs are read and turned
 * into data URLs so `file://` never reaches a provider base64 validator
 * (S4 provider-lowering RED 1); remote/managed URIs are not implemented and
 * fail typed instead of leaking through as media bytes (RED 6).
 */
export const materializeFilePart = (
  fs: FileSystem.FileSystem,
  part: SessionV1.FilePartInput,
): Effect.Effect<FileAttachment, UnmaterializedUriError | PlatformError> =>
  Effect.gen(function* () {
    const url = new URL(part.url)
    if (url.protocol === "data:") {
      return FileAttachment.create({
        uri: part.url,
        mime: part.mime,
        ...(part.filename ? { name: part.filename } : {}),
      })
    }
    if (url.protocol === "file:") {
      const absolute = fileURLToPath(part.url)
      const bytes = yield* fs.readFile(absolute)
      const base64 = Buffer.from(bytes).toString("base64")
      return FileAttachment.create({
        uri: `data:${part.mime};base64,${base64}`,
        mime: part.mime,
        ...(part.filename ? { name: part.filename } : {}),
      })
    }
    // `http(s):`, `resource:` (MCP) and anything else: not materialized in the
    // legacy adapter yet — fail typed rather than forwarding the raw URI.
    return yield* new UnmaterializedUriError({ uri: part.url })
  })
