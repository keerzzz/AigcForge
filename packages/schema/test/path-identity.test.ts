import { describe, expect, test } from "bun:test"
import { PathIdentity } from "@aigcfroge/schema/path-identity"
import { Schema } from "effect"

const refs = {
  left: { path: "/tmp/project" },
  right: { path: "/tmp/project-link" },
}

describe("PathIdentity", () => {
  test("round-trips both proved evidence methods", () => {
    for (const evidence of [
      { method: "realpath", path: "/tmp/project" } as const,
      { method: "device-inode", device: 7, inode: 41 } as const,
    ]) {
      const decoded = Schema.decodeUnknownSync(PathIdentity.Result)({ status: "same", refs, evidence })
      expect(Schema.encodeSync(PathIdentity.Result)(decoded)).toEqual({ status: "same", refs, evidence })
    }
  })

  test("round-trips typed unknown reasons", () => {
    for (const reason of [
      "no-local-proof",
      "stat-unavailable",
      "inode-unavailable",
      "not-same-realpath",
      "recorded-relation-unverified",
    ] as const) {
      const decoded = Schema.decodeUnknownSync(PathIdentity.Result)({ status: "unknown", reason })
      expect(Schema.encodeSync(PathIdentity.Result)(decoded)).toEqual({ status: "unknown", reason })
    }
  })

  test("rejects a different result and unproved sameness", () => {
    expect(() => Schema.decodeUnknownSync(PathIdentity.Result)({ status: "different", refs })).toThrow()
    expect(() => Schema.decodeUnknownSync(PathIdentity.Result)({ status: "same", refs })).toThrow()
  })
})
