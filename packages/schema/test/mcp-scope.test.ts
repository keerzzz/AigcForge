import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AbsolutePath } from "../src/schema"
import { McpScope } from "../src/mcp-scope"

const revision = "a".repeat(64)

describe("McpScope.McpConnectionHealth", () => {
  test("decodes the six contract states", () => {
    for (const state of ["connecting", "ready", "degraded", "offline", "auth-required", "revoked"] as const) {
      expect(Schema.decodeUnknownSync(McpScope.McpConnectionHealth)(state)).toBe(state)
    }
  })

  test("rejects unknown health states", () => {
    expect(() => Schema.decodeUnknownSync(McpScope.McpConnectionHealth)("healthy")).toThrow()
    expect(() => Schema.decodeUnknownSync(McpScope.McpConnectionHealth)("")).toThrow()
  })
})

describe("McpScope.McpServerBinding", () => {
  const stdioBinding = {
    serverName: "context7",
    ref: { relativePath: ".aigcfroge/mcp/context7.yaml", revision },
    transport: "stdio" as const,
    command: ["bun", "run", "server.ts"],
  }

  test("decodes a stdio binding without any secret material", () => {
    const decoded = McpScope.decodeBinding(stdioBinding)
    expect(decoded.serverName).toBe("context7")
    expect(decoded.ref.relativePath).toBe(".aigcfroge/mcp/context7.yaml")
    expect(decoded.transport).toBe("stdio")
  })

  test("decodes a remote binding and an optional opaque credential reference", () => {
    const decoded = McpScope.decodeBinding({
      serverName: "remote-tools",
      ref: { relativePath: ".aigcfroge/mcp/remote.yaml", revision },
      transport: "remote",
      url: "https://mcp.example.com/v1",
      credentialRef: "cred_" + "b".repeat(32),
    })
    expect(decoded.transport).toBe("remote")
    expect(String(decoded.credentialRef)).toBe("cred_" + "b".repeat(32))
  })

  test("secret-bearing fields fail closed instead of being stripped", () => {
    for (const secretKey of ["token", "clientSecret", "api_key", "env", "headers", "authorization"]) {
      const poisoned = { ...stdioBinding, [secretKey]: "sk-secret-material" }
      expect(() => McpScope.decodeBinding(poisoned), secretKey).toThrow()
    }
  })

  test("rejects absolute-path refs that could point outside the asset tree", () => {
    expect(() =>
      McpScope.decodeBinding({
        ...stdioBinding,
        ref: { relativePath: "/etc/aigcfroge/mcp.yaml", revision },
      }),
    ).toThrow()
  })

  test("stdio requires command; remote requires url; neither accepts both transports' fields swapped", () => {
    expect(() => McpScope.decodeBinding({ ...stdioBinding, command: undefined })).toThrow()
    expect(() =>
      McpScope.decodeBinding({
        serverName: "r",
        ref: { relativePath: "mcp/r.yaml", revision },
        transport: "remote",
      }),
    ).toThrow()
  })

  test("decode-time bounds cap identity fields", () => {
    expect(() => McpScope.decodeBinding({ ...stdioBinding, serverName: "n".repeat(129) })).toThrow()
    expect(() =>
      McpScope.decodeBinding({
        ...stdioBinding,
        ref: { relativePath: "p".repeat(513), revision },
      }),
    ).toThrow()
    expect(() =>
      McpScope.decodeBinding({
        ...stdioBinding,
        url: "https://x.test/" + "u".repeat(2048),
      }),
    ).toThrow()
    expect(() =>
      McpScope.decodeBinding({
        ...stdioBinding,
        command: Array.from({ length: 33 }, (_, i) => `arg-${i}`),
      }),
    ).toThrow()
  })
})

describe("McpScope.GrantScope", () => {
  test("decodes once, session, and location scopes", () => {
    expect(McpScope.decodeGrantScope({ level: "once" })).toEqual({ level: "once" })
    const session = McpScope.decodeGrantScope({ level: "session", sessionID: "ses_" + "1".repeat(16) })
    if (session.level === "session") expect(session.sessionID).toBe("ses_" + "1".repeat(16))
    expect(McpScope.decodeGrantScope({ level: "location" })).toEqual({ level: "location" })
  })

  test("rejects unknown scope levels and malformed session ids", () => {
    expect(() => McpScope.decodeGrantScope({ level: "global" })).toThrow()
    expect(() => McpScope.decodeGrantScope({ level: "session", sessionID: "not-a-session-id" })).toThrow()
    expect(() => McpScope.decodeGrantScope({ level: "session" })).toThrow()
  })

  test("a location scope cannot smuggle foreign location identity (excess keys fail)", () => {
    expect(() => McpScope.decodeGrantScope({ level: "location", locationID: "/other/location" })).toThrow()
  })
})

describe("McpScope.McpCredentialBinding", () => {
  test("round-trips a valid binding with sentinel workspace", () => {
    const decoded = new McpScope.McpCredentialBinding({
      id: "mcb_" + "a".repeat(24),
      directory: AbsolutePath.make("/tmp/a"),
      workspaceID: "",
      serverName: "git",
      credentialRef: McpScope.CredentialRef.make("cred_" + "b".repeat(32)),
      bindingRevision: 1,
      timeCreated: 1000,
      timeUpdated: 1000,
    })
    expect(decoded.workspaceID).toBe("")
    expect(McpScope.normalizeWorkspaceId(undefined)).toBe("")
    expect(McpScope.normalizeWorkspaceId("wrk_123")).toBe("wrk_123")
    expect(McpScope.denormalizeWorkspaceId("")).toBeUndefined()
    expect(McpScope.denormalizeWorkspaceId("wrk_123")).toBe("wrk_123")
  })

  test("rejects invalid mcb_ prefix and credentialRef brand", () => {
    expect(
      () =>
        new McpScope.McpCredentialBinding({
          id: "bad_" + "a".repeat(24),
          directory: AbsolutePath.make("/tmp/a"),
          workspaceID: "",
          serverName: "git",
          credentialRef: McpScope.CredentialRef.make("cred_" + "b".repeat(32)),
          bindingRevision: 1,
          timeCreated: 1000,
          timeUpdated: 1000,
        }),
    ).toThrow()
    expect(
      () =>
        new McpScope.McpCredentialBinding({
          id: "mcb_" + "a".repeat(24),
          directory: AbsolutePath.make("/tmp/a"),
          workspaceID: "",
          serverName: "git",
          // Type-negative on purpose: an unbranded ref must be rejected at
          // construction, so the compile error is the premise of the assertion.
          // @ts-expect-error credentialRef requires the CredentialRef brand
          credentialRef: "badref",
          bindingRevision: 1,
          timeCreated: 1000,
          timeUpdated: 1000,
        }),
    ).toThrow()
  })

  test("decodeBinding rejects command containing secret-like material (stopgap 2)", () => {
    const base = {
      serverName: "git",
      ref: { relativePath: "mcp/git.yaml", revision },
      transport: "stdio" as const,
      command: ["echo", "api_key=sk-12345678901234567890"],
    }
    expect(() => McpScope.decodeBinding(base)).toThrow()
    expect(() =>
      McpScope.decodeBinding({
        serverName: "git",
        ref: { relativePath: "mcp/git.yaml", revision },
        transport: "remote" as const,
        url: "https://example.com?token=Bearer eyJ12345678901234567890.eyJ1234567890.abc",
      }),
    ).toThrow()
  })
})

describe("McpScope.ScopedGrant", () => {
  const base = {
    id: "grt_" + "c".repeat(24),
    scope: { level: "once" as const },
    action: "bash",
    resources: ["/workspace/build.sh"],
    effect: "allow" as const,
    issuedAt: 1000,
  }

  test("round-trips a minimal once grant", () => {
    const decoded = McpScope.decodeGrant(base)
    expect(decoded.id.startsWith("grt_")).toBe(true)
    expect(decoded.action).toBe("bash")
    expect(decoded.effect).toBe("allow")
  })

  test("agent, revision, expiry, and revocation are typed data fields", () => {
    const decoded = McpScope.decodeGrant({
      ...base,
      scope: { level: "session", sessionID: "ses_" + "2".repeat(16) },
      agent: "custom-coder",
      revision,
      expiresAt: 2000,
      revokedAt: 1500,
    })
    expect(decoded.agent).toBe("custom-coder")
    expect(String(decoded.revision)).toBe(revision)
    expect(decoded.revokedAt).toBe(1500)
  })

  test("expiry must be strictly after issuance", () => {
    expect(() => McpScope.decodeGrant({ ...base, expiresAt: 1000 })).toThrow()
    expect(() => McpScope.decodeGrant({ ...base, expiresAt: 999 })).toThrow()
  })

  test("grants only ever carry allow; deny stays in policy rulesets", () => {
    expect(() => McpScope.decodeGrant({ ...base, effect: "deny" })).toThrow()
  })

  test("decode-time bounds: id prefix, action length, resource count and length", () => {
    expect(() => McpScope.decodeGrant({ ...base, id: "wrong_" + "c".repeat(24) })).toThrow()
    expect(() => McpScope.decodeGrant({ ...base, action: "a".repeat(129) })).toThrow()
    expect(() =>
      McpScope.decodeGrant({
        ...base,
        resources: Array.from({ length: 33 }, (_, i) => `/r/${i}`),
      }),
    ).toThrow()
    expect(() => McpScope.decodeGrant({ ...base, resources: ["r".repeat(1025)] })).toThrow()
  })

  test("excess fields fail closed, including foreign scope identity on grants", () => {
    expect(() => McpScope.decodeGrant({ ...base, locationDirectory: "/elsewhere" })).toThrow()
  })
})
