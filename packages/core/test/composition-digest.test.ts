import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { computeCompositionDigest } from "../src/composition/digest"

describe("computeCompositionDigest", () => {
  const input1 = Schema.decodeUnknownSync(Composition.CompositionInput)({
    source: "temporary",
    agents: [
      {
        kind: "agent",
        relativePath: "coder.md",
        revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    bindings: {
      "agents/coder": {
        prompts: [
          {
            kind: "prompt",
            relativePath: "system.md",
            revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
        skills: [
          {
            kind: "skill",
            relativePath: "git/SKILL.md",
            revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      },
    },
    presentation: "native",
    requestedCapabilities: ["workspace.read"],
  })

  test("produces deterministic 64-char hex digest", () => {
    const d1 = computeCompositionDigest(input1)
    const d2 = computeCompositionDigest(input1)
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })

  test("different inputs produce different digests", () => {
    const input2 = Schema.decodeUnknownSync(Composition.CompositionInput)({
      source: "profile",
      profilePath: "dev.yaml",
      profileRevision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    })
    const d1 = computeCompositionDigest(input1)
    const d2 = computeCompositionDigest(input2)
    expect(d1).not.toBe(d2)
  })
})
