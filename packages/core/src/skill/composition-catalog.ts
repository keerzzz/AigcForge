export * as CompositionCatalog from "./composition-catalog"

import { Composition } from "@aigcfroge/schema/composition"
import { SkillV2 } from "../skill"

/**
 * Creates a composition-local Skill catalog filtered to only the skills bound in
 * the Custom Session Snapshot.
 */
export function createCompositionSkillCatalog(
  boundSkills: ReadonlyArray<Composition.AssetRef | Composition.SkillInfo>,
  allSkills: ReadonlyArray<SkillV2.Info>,
): ReadonlyArray<SkillV2.Info> {
  const boundSkillPaths = new Set<string>()
  const boundSkillNames = new Set<string>()

  for (const item of boundSkills) {
    if ("kind" in item && item.kind === "skill") {
      boundSkillPaths.add(item.relativePath.replaceAll("\\", "/"))
      const boundName = item.relativePath
        .replaceAll("\\", "/")
        .replace(/\/SKILL\.md$/, "")
        .replace(/\.md$/, "")
        .split("/")
        .pop()
      if (boundName) boundSkillNames.add(boundName)
    } else if ("name" in item && "relativePath" in item) {
      boundSkillNames.add(item.name)
      boundSkillPaths.add(item.relativePath.replaceAll("\\", "/"))
    }
  }

  return allSkills.filter((skill) => {
    if (boundSkillNames.has(skill.name)) return true
    const skillPath = skill.location ? skill.location.replaceAll("\\", "/") : ""
    for (const boundPath of boundSkillPaths) {
      if (skillPath.endsWith(boundPath)) return true
      const boundName = boundPath.replace(/\/SKILL\.md$/, "").replace(/\.md$/, "")
      if (skill.name === boundName) return true
    }
    return false
  })
}
