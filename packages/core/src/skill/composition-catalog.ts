export * as CompositionCatalog from "./composition-catalog"

// De-scoped for M0: no production caller by design. This is the composition-local Skill
// catalog seam for the M1 Runner (implementation plan §5.3: Custom Session Skill guidance
// and `skill` tool lookup must read the Snapshot-local catalog). The Resolver/Snapshot
// skills source of truth is the revision-bearing SkillAsset registry with exact path
// lookups; routing resolve/freeze through this revision-less SkillV2 view would only
// re-filter already-resolved bindings with lossy path/name matching, so M0 intentionally
// does not consume it. Wire it when the M1 Runner consumes the Snapshot skill catalog.
// Tracked in docs/technical-debt.md §3 (Custom Mode 平台任务).

import { Composition } from "@aigcfroge/schema/composition"
import { SkillV2 } from "../skill"

export function createCompositionSkillCatalog(
  boundRefs: ReadonlyArray<Composition.AssetRef>,
  allSkills: ReadonlyArray<SkillV2.Info>,
): ReadonlyArray<SkillV2.Info> {
  const boundSkillPaths = new Set(
    boundRefs.filter((ref) => ref.kind === "skill").map((ref) => ref.relativePath.replaceAll("\\", "/")),
  )

  return allSkills.filter((skill) => {
    // Check match against relativePath or normalized location suffix
    const skillPath = skill.location ? skill.location.replaceAll("\\", "/") : ""
    for (const boundPath of boundSkillPaths) {
      if (skillPath.endsWith(boundPath)) return true
      const boundName = boundPath.replace(/\/SKILL\.md$/, "").replace(/\.md$/, "")
      if (skill.name === boundName) return true
    }
    return false
  })
}
