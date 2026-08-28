import { describe, expect, test } from "bun:test"
import { CredentialScan } from "../src/credential-scan"

const SECRET = "sk-live-abcdefghijklmnopqrstuvwxyz012345"

/**
 * This scan is defence in depth, not the admission boundary — that is
 * `McpScope.decodeBinding`'s excess-key rejection plus the `credentialRef`
 * indirection. A denylist can never be complete, so these cases pin the shapes
 * that were measured escaping it, and the controls pin the false-reject budget:
 * a rejection here is a user hitting a wall, so an over-eager pattern is its own
 * defect.
 */
describe("CredentialScan.containsSecret", () => {
  test("catches named credential assignments behind a flag prefix", () => {
    // `ENV_LINE_RE` is `^`-anchored, so every one of these used to pass.
    expect(CredentialScan.containsSecret(`--token=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret(`--env=TOKEN=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret(`--api-key=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret("--client-secret=abcdefghijklmnop")).toBe(true)
    expect(CredentialScan.containsSecret("--password=hunter2hunter2hunter2")).toBe(true)
  })

  test("catches credentials in a URL query string", () => {
    expect(CredentialScan.containsSecret(`https://h.example/mcp?token=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret(`https://h.example/mcp?api_key=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret("https://h.example/mcp?access_token=abcdefghijklmnop")).toBe(true)
  })

  test("catches percent- and plus-encoded bearer tokens", () => {
    // `BEARER_TOKEN_RE` requires `Bearer\s+`, so it can never match a real URL.
    expect(CredentialScan.containsSecret("https://h.example/mcp?Authorization=Bearer%20QQQQQQQQQQQQQQQQ")).toBe(true)
    expect(CredentialScan.containsSecret("Authorization=Bearer+QQQQQQQQQQQQQQQQ")).toBe(true)
  })

  test("still catches the original shapes", () => {
    expect(CredentialScan.containsSecret(`api_key=${SECRET}`)).toBe(true)
    expect(CredentialScan.containsSecret("Authorization: Bearer eyJabcdefghij.abcdefghij.signature")).toBe(true)
    expect(CredentialScan.containsSecret("TOKEN=abcdefghijklmnop")).toBe(true)
    expect(
      CredentialScan.containsSecret("-----BEGIN RSA PRIVATE KEY-----\nabcdef\n-----END RSA PRIVATE KEY-----"),
    ).toBe(true)
  })

  test("does not reject legitimate command arguments or URLs", () => {
    expect(CredentialScan.containsSecret("--port=3000")).toBe(false)
    expect(CredentialScan.containsSecret("/usr/local/lib/node_modules/some-mcp-server/dist/index.js")).toBe(false)
    expect(CredentialScan.containsSecret("https://h.example/mcp")).toBe(false)
    expect(CredentialScan.containsSecret("https://h.example/mcp?workspace=team-alpha&mode=readonly")).toBe(false)
    // A long hex path segment is not a credential; no generic high-entropy rule.
    expect(CredentialScan.containsSecret("https://h.example/mcp/v1/abcdef0123456789abcdef0123456789")).toBe(false)
    expect(CredentialScan.containsSecret("bun run server.ts")).toBe(false)
  })

  test("is reentrant across calls despite the shared global patterns", () => {
    const text = `--token=${SECRET}`
    expect(CredentialScan.containsSecret(text)).toBe(true)
    expect(CredentialScan.containsSecret(text)).toBe(true)
    expect(CredentialScan.containsSecret(text)).toBe(true)
  })
})
