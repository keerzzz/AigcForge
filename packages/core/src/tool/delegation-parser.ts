export * as DelegationParser from "./delegation-parser"

import { Effect, Option, Schema } from "effect"
import { Delegation } from "@aigcfroge/schema/delegation"
import type { DelegationResult } from "./cli-adapter"

const TAG_PATTERNS = [
  /<summary>([^<]*)<\/summary>/,
  /<task_result>([\s\S]*?)<\/task_result>/,
  /<task_error>([\s\S]*?)<\/task_error>/,
  /<result[^>]*>([\s\S]*?)<\/result>/,
]

const FILE_PATTERNS = [
  /created[:\s]+(?:\[([^\]]+)\]|([^\n]+))/i,
  /modified[:\s]+(?:\[([^\]]+)\]|([^\n]+))/i,
  /deleted[:\s]+(?:\[([^\]]+)\]|([^\n]+))/i,
]

const STATUS_PATTERN = /status["']?\s*[:=]\s*["'](\w+)["']/

export function parseDelegationResult(text: string): DelegationResult | undefined {
  if (!text || text.trim().length === 0) return undefined

  // Extract status
  const statusMatch = text.match(STATUS_PATTERN)
  const status =
    statusMatch?.[1] === "partial"
      ? ("partial" as const)
      : statusMatch?.[1] === "failed"
        ? ("failed" as const)
        : ("success" as const)

  // Extract summary
  let summary = ""
  for (const pattern of TAG_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]?.trim()) {
      summary = match[1].trim()
      break
    }
  }

  // Extract files
  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  const fileMatch1 = text.match(FILE_PATTERNS[0])
  const fileMatch2 = text.match(FILE_PATTERNS[1])
  const fileMatch3 = text.match(FILE_PATTERNS[2])

  if (fileMatch1) {
    const vals = (fileMatch1[1] ?? fileMatch1[2] ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    created.push(...vals)
  }
  if (fileMatch2) {
    const vals = (fileMatch2[1] ?? fileMatch2[2] ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    modified.push(...vals)
  }
  if (fileMatch3) {
    const vals = (fileMatch3[1] ?? fileMatch3[2] ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    deleted.push(...vals)
  }

  // Extract errors from stderr lines
  const errors: string[] = []
  const errMatch = text.match(/<error>([^<]*)<\/error>/g)
  if (errMatch) {
    for (const e of errMatch) {
      const content = e.replace(/<\/?error>/g, "").trim()
      if (content) errors.push(content)
    }
  }

  // Fallback summary
  if (!summary) {
    summary = text.includes("<task_error>") ? text.slice(0, 200).trim() : text.slice(0, 200).trim()
  }

  // Extract the canonical review envelope. A parser result is never allowed to
  // manufacture a valid approval: missing and malformed envelopes remain typed
  // invalid outcomes for the delegation barrier to handle.
  const reviewMatch = text.match(/<review>([\s\S]*?)<\/review>/)
  const review: DelegationResult["review"] = (() => {
    if (!reviewMatch?.[1]) return { status: "invalid" as const, reason: "missing" as const }
    const decodedJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(reviewMatch[1].trim())
    if (Option.isNone(decodedJson)) return { status: "invalid" as const, reason: "malformed" as const }
    const envelope = Schema.decodeUnknownOption(Delegation.ReviewEnvelope)(decodedJson.value)
    return Option.isSome(envelope)
      ? { status: "valid" as const, envelope: envelope.value }
      : { status: "invalid" as const, reason: "malformed" as const }
  })()

  return {
    status,
    summary: summary || "Task completed",
    review,
    files:
      created.length || modified.length || deleted.length
        ? {
            created: created.length ? created : undefined,
            modified: modified.length ? modified : undefined,
            deleted: deleted.length ? deleted : undefined,
          }
        : undefined,
    errors: errors.length ? errors : undefined,
  }
}

export function parseDelegationOutput(stdout: string, stderr: string): Effect.Effect<DelegationResult> {
  return Effect.sync(() => {
    // First try structured parsing from stdout
    const result = parseDelegationResult(stdout)
    if (result) return result

    // Fallback: extract first 200 chars as summary
    const summary = stdout.trim().slice(0, 200) || "Task completed (no output)"
    return {
      status: stderr ? ("failed" as const) : ("success" as const),
      summary,
      errors: stderr ? [stderr.trim().slice(0, 500)] : undefined,
    }
  })
}
