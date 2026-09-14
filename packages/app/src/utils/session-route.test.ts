import { describe, expect, test } from "bun:test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { ServerConnection, canonicalServerUrl } from "@/context/server"
import { parseServerKey, requireServerKey, sessionHref } from "./session-route"

describe("session routes", () => {
  test("builds and decodes a server-keyed session route", () => {
    const server = ServerConnection.Key.make("https://example.com:4096")
    const href = sessionHref(server, "session-1")

    expect(href).toBe("/server/aHR0cHM6Ly9leGFtcGxlLmNvbTo0MDk2/session/session-1")
    expect(requireServerKey(href.split("/")[2])).toBe(server)
  })

  test("rejects malformed server keys as a typed result, not an exception", () => {
    expect(parseServerKey("not-base64")).toEqual({ ok: false })
    expect(parseServerKey(undefined)).toEqual({ ok: false })
    expect(() => requireServerKey("not-base64")).toThrow("Invalid server route")
  })

  test("canonicalizes the localhost alias on the way in (plan §7.1 附则)", () => {
    const legacy = base64Encode("http://localhost:4096")
    const parsed = parseServerKey(legacy)

    expect(parsed).toEqual({ ok: true, key: ServerConnection.Key.make("http://127.0.0.1:4096") })
    // A stored `localhost` key is the same server as the canonical spelling.
    expect(
      ServerConnection.sameKey(ServerConnection.Key.make("http://localhost:4096"), parsed.ok ? parsed.key : ""),
    ).toBe(true)
  })
})

describe("server host canonicalization", () => {
  test("folds loopback aliases, case, default ports, and trailing slashes", () => {
    expect(canonicalServerUrl("http://localhost:4096")).toBe("http://127.0.0.1:4096")
    expect(canonicalServerUrl("http://127.0.0.1:4096/")).toBe("http://127.0.0.1:4096")
    expect(canonicalServerUrl("HTTP://LocalHost:80")).toBe("http://127.0.0.1")
    expect(canonicalServerUrl("https://Example.COM:443")).toBe("https://example.com")
    expect(canonicalServerUrl("localhost:4096")).toBe("http://127.0.0.1:4096")
  })

  test("keeps non-loopback hosts and explicit ports distinct", () => {
    expect(canonicalServerUrl("http://127.0.0.1:4096")).not.toBe(canonicalServerUrl("http://127.0.0.1:4097"))
    expect(canonicalServerUrl("https://example.com:4096")).not.toBe(canonicalServerUrl("http://example.com:4096"))
  })

  test("does not fold the IPv6 loopback into the IPv4 loopback", () => {
    expect(canonicalServerUrl("http://[::1]:4096")).toBe("http://[::1]:4096")
    expect(canonicalServerUrl("http://[::1]:4096")).not.toBe(canonicalServerUrl("http://127.0.0.1:4096"))
  })

  test("routes sidecar/wsl/ssh keys by connection type, never through URL canonicalization", () => {
    // `canonicalServerUrl` parses any scheme-less string as http, so it happily
    // returns "http://sidecar" for a literal key — it is `key()`'s per-type
    // dispatch, not an undefined check, that keeps non-URL keys literal.
    expect(canonicalServerUrl("sidecar")).toBe("http://sidecar")

    const sidecar = ServerConnection.Key.make("sidecar")
    const wsl = ServerConnection.Key.make("wsl:Ubuntu")
    const ssh = ServerConnection.Key.make("ssh:example.com")

    expect(
      String(ServerConnection.key({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })),
    ).toBe("sidecar")
    expect(
      String(
        ServerConnection.key({
          type: "sidecar",
          variant: "wsl",
          distro: "Ubuntu",
          http: { url: "http://127.0.0.1:4096" },
        }),
      ),
    ).toBe("wsl:Ubuntu")
    expect(
      String(ServerConnection.key({ type: "ssh", host: "example.com", http: { url: "http://127.0.0.1:4096" } })),
    ).toBe("ssh:example.com")
    expect(ServerConnection.sameKey(sidecar, sidecar)).toBe(true)
    expect(ServerConnection.sameKey(wsl, wsl)).toBe(true)
    expect(ServerConnection.sameKey(ssh, ssh)).toBe(true)
    expect(ServerConnection.sameKey(sidecar, "sidecar2")).toBe(false)
  })
})
