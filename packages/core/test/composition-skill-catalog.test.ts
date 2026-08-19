import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { SkillV2 } from "../src/skill"
import { createCompositionSkillCatalog } from "../src/skill/composition-catalog"
import { AbsolutePath } from "../src/schema"

describe("createCompositionSkillCatalog", () => {
  const allSkills: SkillV2.Info[] = [
    {
      name: "git-tools",
      description: "Git commands",
      location: AbsolutePath.make("/project/.aigcfroge/skills/git-tools/SKILL.md"),
      content: "git skill content",
    },
    {
      name: "global-unbound",
      description: "Global skill not in binding",
      location: AbsolutePath.make("/project/.aigcfroge/skills/global-unbound/SKILL.md"),
      content: "unbound content",
    },
    {
      name: "linter",
      description: "Code linting",
      location: AbsolutePath.make("/project/.aigcfroge/skills/linter/SKILL.md"),
      content: "linter content",
    },
  ]

  const boundRefs = [
    Schema.decodeUnknownSync(Composition.AssetRef)({
      kind: "skill",
      relativePath: "git-tools/SKILL.md",
      revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }),
  ]

  test("isolates skills to only explicitly bound references", () => {
    const catalog = createCompositionSkillCatalog(boundRefs, allSkills)
    expect(catalog).toHaveLength(1)
    expect(catalog[0].name).toBe("git-tools")
  })

  test("returns empty catalog when no skills bound", () => {
    const catalog = createCompositionSkillCatalog([], allSkills)
    expect(catalog).toHaveLength(0)
  })

  test("handles matching by relativePath and skill name segment", () => {
    const twoBound = [
      Schema.decodeUnknownSync(Composition.AssetRef)({
        kind: "skill",
        relativePath: "git-tools/SKILL.md",
        revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      }),
      Schema.decodeUnknownSync(Composition.AssetRef)({
        kind: "skill",
        relativePath: "linter/SKILL.md",
        revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      }),
    ]
    const catalog = createCompositionSkillCatalog(twoBound, allSkills)
    expect(catalog).toHaveLength(2)
    expect(catalog.map((s) => s.name)).toEqual(["git-tools", "linter"])
  })
})
