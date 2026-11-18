import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Hash } from "@aigcfroge/util/hash"

// Parity test carried over from the fork's core/util/hash.ts (sha1/sha256 via
// @noble/hashes) after consolidating on the upstream @aigcfroge/util/hash module.
describe("util.hash", () => {
  test("matches the Node digest for strings and byte buffers", () => {
    const input = "AigcForge 哈希"
    const bytes = Buffer.from(new TextEncoder().encode(input))

    expect(Hash.fast(input)).toBe(createHash("sha1").update(input).digest("hex"))
    expect(Hash.sha256(input)).toBe(createHash("sha256").update(input).digest("hex"))
    expect(Hash.fast(bytes)).toBe(Hash.fast(input))
    expect(Hash.sha256(bytes)).toBe(Hash.sha256(input))
  })
})
