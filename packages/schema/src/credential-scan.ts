import { Schema } from "effect"

export const API_KEY_RE = /(?:(?:api[_-]?key|apikey)\s*[=:]\s*['"]?(?:sk-[a-zA-Z0-9]{20,}|[a-zA-Z0-9_-]{16,})['"]?)/gi

export const BEARER_TOKEN_RE =
  /(?:Authorization\s*[=:]\s*)?Bearer\s+(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]{20,})/gi

export const PRIVATE_KEY_RE =
  /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g

export const ENV_LINE_RE =
  /^(?:DATABASE_URL|SECRET(?:_KEY)?|API_KEY(?:_\w+)?|ACCESS_KEY|SECRET_ACCESS_KEY|PRIVATE_KEY|TOKEN|PASSWORD|DB_[A-Z_]+)\s*=\s*['"]?.+['"]?$/gim

export const SECRET_PATTERNS = [API_KEY_RE, BEARER_TOKEN_RE, PRIVATE_KEY_RE, ENV_LINE_RE] as const

export const containsSecret = (text: string): boolean => {
  for (const re of SECRET_PATTERNS) {
    // A fresh RegExp per pattern: the shared globals carry `lastIndex`, so
    // testing the module-level instance would skip matches on the next call.
    if (new RegExp(re.source, re.flags).test(text)) return true
  }
  return false
}

export class ScanResult extends Schema.Class<ScanResult>("CredentialScan.ScanResult")({
  hits: Schema.Array(
    Schema.Struct({
      type: Schema.Literals(["api_key", "bearer_token", "private_key", "env_line"]),
      lineIndex: Schema.Number,
      positionHint: Schema.String,
    }),
  ),
  stripped: Schema.String,
}) {}

export * as CredentialScan from "./credential-scan"
