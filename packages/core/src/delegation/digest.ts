export * as DelegationDigest from "./digest"

import { createHash } from "node:crypto"
import type { ChangeKind } from "@aigcfroge/schema/delegation"

export interface RevisionDigestInput {
  commitSha: string
  normalizedDiff: string
}

/**
 * Calculates a deterministic revision digest from commitSha and normalizedDiff.
 * Non-code parameters (tokens, timestamps, authorizations) are strictly excluded.
 */
export function calculateRevisionDigest(input: RevisionDigestInput): string {
  const hash = createHash("sha256").update(input.commitSha).update("\n").update(input.normalizedDiff).digest("hex")
  return `rev_${hash}`
}

export interface ClassifyChangeKindInput {
  baseCommitSha: string
  targetCommitSha: string
  baseDiff: string
  targetDiff: string
}

/**
 * Classifies the relationship between two revisions into a ChangeKind.
 * Note: formatting_only is conservatively classified as rework in this phase.
 */
export function classifyChangeKind(input: ClassifyChangeKindInput): ChangeKind {
  if (input.baseCommitSha === input.targetCommitSha && input.baseDiff === input.targetDiff) {
    return "no_change"
  }

  if (input.baseDiff === input.targetDiff) {
    return "no_code_change"
  }

  // Any difference in diff is treated as rework (formatting_only conservatively downgraded)
  return "rework"
}
