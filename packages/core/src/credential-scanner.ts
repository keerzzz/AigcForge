import { Context, Effect, Layer } from "effect"
import { CredentialScan, SECRET_PATTERN_LIST } from "@aigcfroge/schema/credential-scan"

type Hit = {
  type: (typeof SECRET_PATTERN_LIST)[number]["type"]
  lineIndex: number
  positionHint: string
}

function scanText(text: string): Hit[] {
  const lines = text.split("\n")
  const lineHitSet = new Set<number>()
  const hits: Hit[] = []

  // Phase 1: multiline patterns (private_key) — run on full text
  for (const pattern of SECRET_PATTERN_LIST) {
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
    const line = lines[lineIndex]
    const lineHits: { type: Hit["type"]; start: number }[] = []

    for (const pattern of SECRET_PATTERN_LIST) {
      if (pattern.type === "private_key") continue // handled in phase 1
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(line)) !== null) {
        lineHits.push({ type: pattern.type, start: match.index })
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
  for (const pattern of SECRET_PATTERN_LIST) {
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
  readonly scan: (text: string) => Effect.Effect<CredentialScan.ScanResult>
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
