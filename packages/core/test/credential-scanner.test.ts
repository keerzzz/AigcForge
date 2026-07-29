import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CredentialScanner } from "@aigcfroge/core/credential-scanner"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(CredentialScanner.layer))

describe("CredentialScanner", () => {
  it.effect("detects API key patterns", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("api_key=sk-abc123def456ghi789jkl")
      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0]?.type).toBe("api_key")
    }),
  )

  it.effect("detects bearer token patterns", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dkWG4ysT1QfT1g")
      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits.some((h) => h.type === "bearer_token")).toBe(true)
    }),
  )

  it.effect("detects private key patterns", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----")
      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0]?.type).toBe("private_key")
    }),
  )

  it.effect("detects .env line patterns", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("DATABASE_URL=postgres://user:pass@localhost:5432/db")
      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0]?.type).toBe("env_line")
    }),
  )

  it.effect("returns stripped content without credentials", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const input = "api_key=sk-abc123def456ghi789jkl"
      const result = yield* scanner.scan(input)
      expect(result.stripped).not.toContain("sk-abc123def456ghi789jkl")
      expect(result.stripped).toContain("[REDACTED]")
    }),
  )

  it.effect("no false positives on normal text", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("This is a normal message about the project architecture and design decisions.")
      expect(result.hits.length).toBe(0)
      expect(result.stripped).toBe("This is a normal message about the project architecture and design decisions.")
    }),
  )

  it.effect("returns structured scan result with hit type and position", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const input = "line one\napi_key=sk-abc123\ntoken=secret-token-abc"
      const result = yield* scanner.scan(input)
      expect(result.hits.length).toBeGreaterThan(0)
      for (const hit of result.hits) {
        expect(hit.type).toBeString()
        expect(typeof hit.lineIndex).toBe("number")
        expect(hit.positionHint).toBeString()
      }
    }),
  )
})
