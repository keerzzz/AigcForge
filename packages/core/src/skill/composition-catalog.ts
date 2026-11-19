export * as CompositionCatalog from "./composition-catalog"

import { Composition } from "@aigcfroge/schema/composition"
import { Result } from "effect"
import path from "path"
import { SkillFile } from "../config/plugin/skill-file"
import { AbsolutePath } from "../schema"
import { Skill } from "../skill"
import { SkillAssetPath } from "../skill-asset/path"

/** Converts only the selected consumer's frozen bodies. Live catalogs never participate. */
export function frozenSkills(
  directory: string,
  boundSkills: ReadonlyArray<Composition.SkillInfo>,
): Result.Result<ReadonlyArray<Skill.Info>, Composition.ResolveError> {
  return Result.gen(function* () {
    const catalog = yield* Result.all(
      boundSkills.map((skill) =>
        Result.gen(function* () {
          if (!("content" in skill) || typeof skill.content !== "string")
            return yield* Result.fail(
              new Composition.ResolveError({
                code: "missing_skill_content",
                message: `Frozen Skill ${skill.relativePath} is missing its body`,
              }),
            )
          const relativePath = yield* Result.try({
            try: () => SkillAssetPath.validateRelativePath(skill.relativePath),
            catch: (error) =>
              new Composition.ResolveError({
                code: "invalid_skill_path",
                message: error instanceof Error ? error.message : String(error),
              }),
          })
          const ownerRoot = path.resolve(skill.target?.root ?? SkillAssetPath.resolveOwnerRoot(directory))
          const filepath = path.resolve(ownerRoot, relativePath)
          return {
            id: SkillFile.id(ownerRoot, filepath),
            name: Skill.Name.make(skill.name),
            description: skill.description,
            path: AbsolutePath.make(filepath),
            content: skill.content,
          } satisfies Skill.Info
        }),
      ),
    )
    const collision = catalog.find(
      (skill, index) => catalog.findIndex((candidate) => candidate.id === skill.id) !== index,
    )
    if (collision)
      return yield* Result.fail(
        new Composition.ResolveError({
          code: "skill_id_conflict",
          message: `Frozen Skills resolve to the same Skill ID: ${collision.id}`,
        }),
      )
    return catalog
  })
}

/**
 * Creates a composition-local Skill catalog filtered to only the skills bound in
 * the Custom Session Snapshot.
 * @deprecated Historical matching helper. Runtime consumers use frozenSkills.
 */
export function createCompositionSkillCatalog(
  boundSkills: ReadonlyArray<Composition.AssetRef | Composition.SkillInfo>,
  allSkills: ReadonlyArray<Skill.Info>,
): ReadonlyArray<Skill.Info> {
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
    const skillPath = skill.path.replaceAll("\\", "/")
    for (const boundPath of boundSkillPaths) {
      if (skillPath.endsWith(boundPath)) return true
      const boundName = boundPath.replace(/\/SKILL\.md$/, "").replace(/\.md$/, "")
      if (skill.name === boundName) return true
    }
    return false
  })
}
