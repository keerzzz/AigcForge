import { Context, Effect, Layer, Schema } from "effect"
import { CredentialScan } from "@aigcfroge/schema/credential-scan"

type Hit = {
  type: "api_key" | "bearer_token" | "private_key" | "env_line"
  lineIndex: number
  positionHint: string
}

const API_KEY_RE =
  /(?:(?:api[_-]?key|apikey)\s*[=:]\s*['"]?(?:sk-[a-zA-Z0-9]{20,}|[a-zA-Z0-9_\-]{16,})['"]?)/gi

const BEARER_TOKEN_RE =
  /(?:Authorization\s*[=:]\s*)?Bearer\s+(eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+|[a-zA-Z0-9_\-]{20,})/gi

const PRIVATE_KEY_RE = /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g

const ENV_LINE_RE =
  /^(?:DATABASE_URL|SECRET(?:_KEY)?|API_KEY(?:_\w+)?|ACCESS_KEY|SECRET_ACCESS_KEY|PRIVATE_KEY|TOKEN|PASSWORD|DB_[A-Z_]+)\s*=\s*['"]?.+['"]?$/gim

const PATTERNS: {
  type: "api_key" | "bearer_token" | "private_key" | "env_line"
  regex: RegExp
}[] = [
  { type: "api_key", regex: API_KEY_RE },
  { type: "bearer_token", regex: BEARER_TOKEN_RE },
  { type: "private_key", regex: PRIVATE_KEY_RE },
  { type: "env_line", regex: ENV_LINE_RE },
]

function scanText(text: string): Hit[] {
  const lines = text.split("\n")
  const lineHitSet = new Set<number>()
  const hits: Hit[] = []

  // Phase 1: multiline patterns (private_key) — run on full text
  for (const pattern of PATTERNS) {
    if (pattern.type !== "private_key") continue
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const blockStart = text.slice(0, match.index).split("\n").length - 1
      hits.push({ type: pattern.type, lineIndex: blockStart, positionHint: `Line ${blockStart + 1}` })
      const blockLines = match[0].split("\n").length
      for (let i = 0; i < blockLines; i++) lineHitSet.add(blockStart + i)
    }
  }

  // Phase 2: single-line patterns — scan each line
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (lineHitSet.has(lineIndex)) continue // already flagged by multiline pattern
    const line = lines[lineIndex]!
    const lineHits: { type: Hit["type"]; start: number }[] = []

    for (const pattern of PATTERNS) {
      if (pattern.type === "private_key") continue // handled in phase 1
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(line)) !== null) {
        lineHits.push({ type: pattern.type, start: match.index ?? 0 })
      }
    }

    // Deduplicate: keep only the leftmost match per position cluster
    lineHits.sort((a, b) => a.start - b.start)
    let lastStart = -1
    for (const hit of lineHits) {
      if (hit.start !== lastStart) {
        hits.push({ type: hit.type, lineIndex, positionHint: `Line ${lineIndex + 1}` })
        lastStart = hit.start
      }
    }
  }

  return hits
}

function stripText(text: string): string {
  let result = text
  for (const pattern of PATTERNS) {
    if (pattern.type === "private_key") {
      result = result.replace(pattern.regex, (match) => {
        const lines = match.split("\n")
        return `${lines[0]}\n[REDACTED]\n${lines[lines.length - 1]}`
      })
    } else {
      result = result.replace(pattern.regex, (match) => {
        const eqIdx = match.indexOf("=")
        const colonIdx = match.indexOf(":")
        if (eqIdx !== -1) return match.slice(0, eqIdx + 1) + "[REDACTED]"
        if (colonIdx !== -1) return match.slice(0, colonIdx + 1) + " [REDACTED]"
        return "[REDACTED]"
      })
    }
  }
  return result
}

export interface Interface {
  readonly scan: (text: string) => Effect.Effect<CredentialScan.ScanResult, never>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CredentialScanner") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
      scan: Effect.fn("CredentialScanner.scan")(function* (text: string) {
        const hits = scanText(text)
        const stripped = stripText(text)
        return new CredentialScan.ScanResult({ hits, stripped })
      }),
    }),
  ),
)

export * as CredentialScanner from "./credential-scanner"
