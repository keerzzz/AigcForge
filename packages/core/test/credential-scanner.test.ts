import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CredentialScanner } from "@aigcfroge/core/credential-scanner"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
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

  describe("redactStderrLine covers flag-prefixed and encoded credentials", () => {
    it.effect("redacts --token=…", () =>
      Effect.gen(function* () {
        const scanner = yield* CredentialScanner.Service
        const { redacted, secretHits } = yield* McpConnection.redactStderrLine(scanner, "--token=ghp_aaaaaaaaaaaaaaaa")
        expect(redacted).not.toContain("ghp_aaaaaaaaaaaaaaaa")
        expect(secretHits).toBeGreaterThan(0)
      }),
    )

    it.effect("redacts --env=TOKEN=…", () =>
      Effect.gen(function* () {
        const scanner = yield* CredentialScanner.Service
        const { redacted, secretHits } = yield* McpConnection.redactStderrLine(scanner, "--env=TOKEN=bbbbbbbbbbbbbbbb")
        expect(redacted).not.toContain("bbbbbbbbbbbbbbbb")
        expect(secretHits).toBeGreaterThan(0)
      }),
    )

    it.effect("redacts ?token=… in URLs", () =>
      Effect.gen(function* () {
        const scanner = yield* CredentialScanner.Service
        const { redacted, secretHits } = yield* McpConnection.redactStderrLine(
          scanner,
          "https://h.example/mcp?token=cccccccccccccccc",
        )
        expect(redacted).not.toContain("cccccccccccccccc")
        expect(secretHits).toBeGreaterThan(0)
      }),
    )

    it.effect("redacts percent-encoded bearer tokens", () =>
      Effect.gen(function* () {
        const scanner = yield* CredentialScanner.Service
        const { redacted, secretHits } = yield* McpConnection.redactStderrLine(
          scanner,
          "?Authorization=Bearer%20dddddddddddddddd",
        )
        expect(redacted).not.toContain("Bearer%20dddddddddddddddd")
        expect(secretHits).toBeGreaterThan(0)
      }),
    )
  })

  it.effect("false-reject budget: legitimate command arguments and URLs pass through untouched", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const legitimate = [
        "--port=3000",
        "/usr/local/lib/node_modules/some-mcp-server/dist/index.js",
        "https://h.example/mcp",
        "https://h.example/mcp?workspace=team-alpha&mode=readonly",
        "https://h.example/mcp/v1/abcdef0123456789abcdef0123456789",
        "bun run server.ts",
      ]
      for (const text of legitimate) {
        const result = yield* scanner.scan(text)
        expect(result.hits).toHaveLength(0)
        expect(result.stripped).toBe(text)
      }
    }),
  )
})
