import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { SkillFile } from "../src/config/plugin/skill-file"
import { Skill } from "../src/skill"
import { CompositionCatalog, createCompositionSkillCatalog } from "../src/skill/composition-catalog"
import { AbsolutePath } from "../src/schema"

describe("createCompositionSkillCatalog", () => {
  const allSkills: Skill.Info[] = [
    Skill.Info.make({
      id: Skill.ID.make("git-tools"),
      name: Skill.Name.make("git-tools"),
      description: "Git commands",
      path: AbsolutePath.make("/project/.aigcfroge/skills/git-tools/SKILL.md"),
      content: "git skill content",
    }),
    Skill.Info.make({
      id: Skill.ID.make("global-unbound"),
      name: Skill.Name.make("global-unbound"),
      description: "Global skill not in binding",
      path: AbsolutePath.make("/project/.aigcfroge/skills/global-unbound/SKILL.md"),
      content: "unbound content",
    }),
    Skill.Info.make({
      id: Skill.ID.make("linter"),
      name: Skill.Name.make("linter"),
      description: "Code linting",
      path: AbsolutePath.make("/project/.aigcfroge/skills/linter/SKILL.md"),
      content: "linter content",
    }),
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
    expect(catalog[0].name).toBe(Skill.Name.make("git-tools"))
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
    expect(catalog.map((s) => s.name)).toEqual([Skill.Name.make("git-tools"), Skill.Name.make("linter")])
  })
})

describe("CompositionCatalog.frozenSkills", () => {
  const revision = Composition.Revision.make("a".repeat(64))
  const frozen = (relativePath: string, content = "Frozen instructions", target?: AssetPlacement.Target) =>
    new Composition.SnapshotSkillData({
      name: "Display name",
      description: "Frozen description",
      relativePath,
      revision,
      content,
      ...(target === undefined ? {} : { target }),
    })

  test("reuses file parsing IDs and preserves frozen bodies for flat and nested assets", () => {
    const directory = "/project"
    const ownerRoot = "/project/.aigcfroge/skills"
    const assets = [frozen("review.md"), frozen("tools/lint/SKILL.md", "Frozen nested instructions")]
    const result = CompositionCatalog.frozenSkills(directory, assets)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success).toEqual([
      {
        id: SkillFile.id(ownerRoot, `${ownerRoot}/review.md`),
        name: Skill.Name.make("Display name"),
        description: "Frozen description",
        path: AbsolutePath.make(`${ownerRoot}/review.md`),
        content: "Frozen instructions",
      },
      {
        id: SkillFile.id(ownerRoot, `${ownerRoot}/tools/lint/SKILL.md`),
        name: Skill.Name.make("Display name"),
        description: "Frozen description",
        path: AbsolutePath.make(`${ownerRoot}/tools/lint/SKILL.md`),
        content: "Frozen nested instructions",
      },
    ])
    assets.forEach((asset, index) => {
      const parsed = SkillFile.parse(
        ownerRoot,
        result.success[index].path,
        `---\nname: Display name\n---\n${asset.content}`,
      )
      expect(parsed).toMatchObject({ _tag: "Parsed", skill: { id: result.success[index].id } })
    })
    expect(assets[0].content).toBe("Frozen instructions")
  })

  test("keeps an explicitly empty frozen catalog and frozen empty body", () => {
    expect(CompositionCatalog.frozenSkills("/project", [])).toEqual(Result.succeed([]))
    const result = CompositionCatalog.frozenSkills("/project", [frozen("empty.md", "")])
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success[0].content).toBe("")
  })

  test("uses each frozen source root after adoption into another Location", () => {
    const targets = [
      new AssetPlacement.Target({ scope: "global", root: AbsolutePath.make("/global/skills") }),
      new AssetPlacement.Target({ scope: "project", root: AbsolutePath.make("/original/.aigcfroge/skills") }),
      new AssetPlacement.Target({ scope: "location", root: AbsolutePath.make("/original/child/.aigcfroge/skills") }),
    ]
    targets.forEach((target) => {
      const asset = frozen("review.md", `Frozen ${target.scope} body`, target)
      const result = CompositionCatalog.frozenSkills("/adopted", [asset])
      if (Result.isFailure(result)) throw result.failure
      expect(result.success[0]).toEqual({
        id: SkillFile.id(target.root, `${target.root}/review.md`),
        name: Skill.Name.make("Display name"),
        description: "Frozen description",
        path: AbsolutePath.make(`${target.root}/review.md`),
        content: `Frozen ${target.scope} body`,
      })
      expect(
        SkillFile.parse(target.root, result.success[0].path, `---\nname: Display name\n---\n${asset.content}`),
      ).toMatchObject({ _tag: "Parsed", skill: { id: result.success[0].id } })
    })
    const result = CompositionCatalog.frozenSkills("/adopted", [
      frozen("review.md", "", targets[0]),
      frozen("lint/SKILL.md", "Frozen project body", targets[1]),
    ])
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.map((skill) => skill.path)).toEqual([
      AbsolutePath.make("/global/skills/review.md"),
      AbsolutePath.make("/original/.aigcfroge/skills/lint/SKILL.md"),
    ])
    expect(result.success[0].content).toBe("")
  })

  test("retains same-consumer Skill ID conflicts across distinct frozen owners", () => {
    expect(
      CompositionCatalog.frozenSkills("/adopted", [
        frozen(
          "review.md",
          "Frozen global body",
          new AssetPlacement.Target({
            scope: "global",
            root: AbsolutePath.make("/global/skills"),
          }),
        ),
        frozen(
          "review.md",
          "Frozen project body",
          new AssetPlacement.Target({
            scope: "project",
            root: AbsolutePath.make("/original/.aigcfroge/skills"),
          }),
        ),
      ]),
    ).toMatchObject({ _tag: "Failure", failure: { code: "skill_id_conflict" } })
  })

  test("fails closed when a historical skill lacks frozen content", () => {
    const result = CompositionCatalog.frozenSkills("/project", [
      new Composition.SkillInfo({
        name: "Historical",
        description: "Only a summary",
        relativePath: "review.md",
        revision,
      }),
    ])
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "missing_skill_content" } })
  })

  test("rejects paths outside the owner root and ambiguous Skill IDs", () => {
    for (const relativePath of ["../private.md", "/private.md", "review/../../private.md"])
      expect(CompositionCatalog.frozenSkills("/project", [frozen(relativePath)])).toMatchObject({
        _tag: "Failure",
        failure: { code: "invalid_skill_path" },
      })
    expect(
      CompositionCatalog.frozenSkills("/project", [frozen("one/review/SKILL.md"), frozen("two/review/SKILL.md")]),
    ).toMatchObject({
      _tag: "Failure",
      failure: { code: "skill_id_conflict" },
    })
  })
})
