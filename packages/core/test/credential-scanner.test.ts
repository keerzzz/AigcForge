import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { CredentialScanner } from "@aigcfroge/core/credential-scanner"
import { testEffect } from "./lib/effect"

const it = testEffect(CredentialScanner.layer)
// Deliberately invalid key material; the body cannot encode a usable private key.
const body = "SYNTHETIC_INVALID_KEY_BODY_!_NOT_USABLE"
const lines = ["-----BEGIN RSA PRIVATE KEY-----", body, "-----END RSA PRIVATE KEY-----"]
const formats = [
  { name: "LF", value: lines.join("\n") },
  { name: "CRLF", value: lines.join("\r\n") },
  { name: "literal escaped newlines", value: lines.join("\\n") },
  { name: "one line", value: lines.join(" ") },
]

describe("CredentialScanner private key redaction", () => {
  formats.forEach((format) => {
    it.effect(`removes the complete matched key with ${format.name}`, () =>
      Effect.gen(function* () {
        const scanner = yield* CredentialScanner.Service
        const result = yield* scanner.scan(format.value)
        expect(result.hits.map((hit) => hit.type)).toContain("private_key")
        expect(result.stripped).toBe("[REDACTED]")
        expect(result.stripped).not.toContain(body)
      }),
    )
  })

  it.effect("keeps JSON parseable after redacting its escaped private key field", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan(JSON.stringify({ stepID: lines.join("\n"), detail: "Keep this result" }))
      expect(result.stripped).not.toContain(body)
      expect(result.stripped).not.toContain("PRIVATE KEY")
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(result.stripped)).toEqual({
        stepID: "[REDACTED]",
        detail: "Keep this result",
      })
    }),
  )

  it.effect("preserves surrounding text and keeps repeated redaction stable", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const first = yield* scanner.scan(`Before\n${lines.join("\n")}\nAfter`)
      const second = yield* scanner.scan(first.stripped)
      expect(first.stripped).toBe("Before\n[REDACTED]\nAfter")
      expect(second.stripped).toBe(first.stripped)
      expect(second.hits).toEqual([])
      const json = yield* scanner.scan(JSON.stringify({ value: lines.join("\n") }))
      expect((yield* scanner.scan(json.stripped)).stripped).toBe(json.stripped)
    }),
  )

  it.effect("preserves named credential redaction through the shared pattern registry", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const result = yield* scanner.scan("--token=synthetic_nonfunctional_value")
      expect(result.hits.map((hit) => hit.type)).toContain("named_credential")
      expect(result.stripped).toBe("--token=[REDACTED]")
      expect((yield* scanner.scan(result.stripped)).stripped).toBe(result.stripped)
    }),
  )
})
