import { describe, expect, test } from "bun:test"
import { calculateRevisionDigest, classifyChangeKind } from "../src/delegation/digest"

describe("Delegation Revision Digest and ChangeKind (Phase 1)", () => {
  test("calculateRevisionDigest generates deterministic digest from commitSha and normalizedDiff", () => {
    const inputA = {
      commitSha: "917881a45e622a4434d7528c4915cc5f77ee3005",
      normalizedDiff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n",
    }
    const inputB = { ...inputA }
    const inputC = {
      ...inputA,
      commitSha: "0000000000000000000000000000000000000000",
    }

    const digestA = calculateRevisionDigest(inputA)
    const digestB = calculateRevisionDigest(inputB)
    const digestC = calculateRevisionDigest(inputC)

    expect(digestA.length).toBe(68)
    expect(/^rev_[a-f0-9]{64}$/.test(digestA)).toBe(true)
    expect(digestA).toBe(digestB) // Deterministic
    expect(digestA).not.toBe(digestC) // Sensitive to commitSha

    // Exact-byte sensitivity: whitespace differences MUST produce different digests (no .trim() collision)
    const digestX = calculateRevisionDigest({ commitSha: "sha_1", normalizedDiff: "x" })
    const digestXSpaced = calculateRevisionDigest({ commitSha: "sha_1", normalizedDiff: " x " })
    expect(digestX).not.toBe(digestXSpaced)
  })

  test("classifyChangeKind distinguishes no_change, no_code_change, and rework (G3)", () => {
    const diff = "--- a/foo.ts\n+++ b/foo.ts\n"
    // Identical commit + identical diff
    expect(
      classifyChangeKind({
        baseCommitSha: "sha_1",
        targetCommitSha: "sha_1",
        baseDiff: diff,
        targetDiff: diff,
      }),
    ).toBe("no_change")

    // Different commit (e.g. empty commit or rebase), identical code diff
    expect(
      classifyChangeKind({
        baseCommitSha: "sha_1",
        targetCommitSha: "sha_2",
        baseDiff: diff,
        targetDiff: diff,
      }),
    ).toBe("no_code_change")

    // Modified diff -> rework
    expect(
      classifyChangeKind({
        baseCommitSha: "sha_1",
        targetCommitSha: "sha_2",
        baseDiff: diff,
        targetDiff: diff + "+extra line\n",
      }),
    ).toBe("rework")
  })
})
