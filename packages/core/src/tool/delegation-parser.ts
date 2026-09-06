export * as DelegationParser from "./delegation-parser"

import { Effect } from "effect"
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

  // Extract review envelope (fail closed to changes_requested)
  const reviewMatch = text.match(/<review>([\s\S]*?)<\/review>/)
  let review: DelegationResult["review"] = {
    reviewedRevisionDigest: undefined,
    verdict: "changes_requested",
  }
  if (reviewMatch?.[1]) {
    try {
      const parsed: unknown = JSON.parse(reviewMatch[1].trim())
      if (typeof parsed === "object" && parsed !== null) {
        const digestCandidate =
          Reflect.get(parsed, "reviewed_revision_digest") ??
          Reflect.get(parsed, "reviewedRevisionDigest") ??
          Reflect.get(parsed, "digest")
        const reviewedRevisionDigest =
          typeof digestCandidate === "string" && digestCandidate.trim().length > 0 ? digestCandidate.trim() : undefined
        const verdictCandidate = Reflect.get(parsed, "verdict")
        const isValidVerdict =
          verdictCandidate === "approved" || verdictCandidate === "changes_requested" || verdictCandidate === "rejected"
        if (isValidVerdict && reviewedRevisionDigest) {
          review = {
            reviewedRevisionDigest,
            verdict: verdictCandidate,
          }
        }
      }
    } catch {
      // Invalid JSON fails closed to default changes_requested
    }
  }

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
