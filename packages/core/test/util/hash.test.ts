import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Hash } from "@aigcfroge/core/util/hash"

describe("util.hash", () => {
  test("matches the Node digest for strings and byte arrays", () => {
    const input = "AigcForge 哈希"
    const encoded = new TextEncoder().encode(input)

    expect(Hash.fast(input)).toBe(createHash("sha1").update(input).digest("hex"))
    expect(Hash.sha256(input)).toBe(createHash("sha256").update(input).digest("hex"))
    expect(Hash.fast(encoded)).toBe(Hash.fast(input))
    expect(Hash.sha256(encoded)).toBe(Hash.sha256(input))
  })
})
