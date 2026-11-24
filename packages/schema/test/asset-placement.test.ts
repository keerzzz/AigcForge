import { describe, expect, test } from "bun:test"
import { Schema, SchemaAST } from "effect"
import { AssetPlacement } from "../src/asset-placement.js"
import { CommandAsset } from "../src/command-asset.js"
import { PromptAsset } from "../src/prompt-asset.js"
import { AbsolutePath } from "../src/schema.js"
import { SkillAsset } from "../src/skill-asset.js"

const target = { scope: "project" as const, root: "/workspace/.omnixa/skills" }
const summary = {
  kind: "skill" as const,
  name: "review",
  description: "Review changed code",
  relativePath: "review.md",
  revision: "a".repeat(64),
}
const candidate = {
  name: summary.name,
  description: summary.description,
  relativePath: summary.relativePath,
  slash: false,
  content: "Keep the reviewed body.\n",
  triggers: [],
  tags: [],
}
const info = { ...summary, ...candidate }
const inspection = {
  relativePath: summary.relativePath,
  exists: false,
  revision: null,
  nameConflict: false,
  pathConflict: false,
  target,
}

describe("AssetPlacement", () => {
  test.each(["project", "global", "location"] as const)("round-trips the %s scope and Target class", (scope) => {
    expect(Schema.encodeSync(AssetPlacement.Scope)(Schema.decodeUnknownSync(AssetPlacement.Scope)(scope))).toBe(scope)

    const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(AssetPlacement.Target))({ ...target, scope })
    expect(decoded).toBeInstanceOf(AssetPlacement.Target)
    expect(Schema.encodeSync(Schema.toCodecJson(AssetPlacement.Target))(decoded)).toEqual({ ...target, scope })
  })

  test("rejects values outside the finite scope contract", () => {
    ;["workspace", "Project", "global ", "", null, undefined, 1, true].forEach((scope) => {
      expect(() => Schema.decodeUnknownSync(AssetPlacement.Scope)(scope)).toThrow()
      expect(() => Schema.decodeUnknownSync(AssetPlacement.Target)({ ...target, scope })).toThrow()
    })
  })

  test("requires both Target fields", () => {
    expect(() => Schema.decodeUnknownSync(AssetPlacement.Target)({ scope: "project" })).toThrow()
    expect(() => Schema.decodeUnknownSync(AssetPlacement.Target)({ root: target.root })).toThrow()
    expect(() => Schema.decodeUnknownSync(AssetPlacement.Target)({ ...target, root: null })).toThrow()
  })

  test("preserves the existing AbsolutePath brand contract", () => {
    expect(AssetPlacement.Target.fields.root).toBe(AbsolutePath)
    ;["", "relative/skills", "/workspace/.omnixa/skills", "C:\\workspace\\.omnixa\\skills"].forEach((root) => {
      const decoded = Schema.decodeUnknownSync(AssetPlacement.Target)({ ...target, root })
      expect(decoded.root).toBe(Schema.decodeUnknownSync(AbsolutePath)(root))
      expect(Schema.encodeSync(AssetPlacement.Target)(decoded)).toEqual({ ...target, root })
    })
  })

  test("keeps root exports and composed contracts canonical", async () => {
    const entry = await import("../src/index.js")
    expect(entry.AssetPlacement).toBe(AssetPlacement)
    expect(entry.AssetPlacement.Scope).toBe(AssetPlacement.Scope)
    expect(entry.AssetPlacement.Target).toBe(AssetPlacement.Target)
    expect(AssetPlacement.Target.fields.scope).toBe(AssetPlacement.Scope)
    expect(SkillAsset.Inspection.fields.target).toBe(AssetPlacement.Target)
    expect(AssetPlacement.Scope.ast.annotations?.identifier).toBe("AssetPlacement.Scope")
    expect(AssetPlacement.Target.ast.annotations?.identifier).toBe("AssetPlacement.Target")
    expect(SkillAsset.Inspection.ast.annotations?.identifier).toBe("SkillAsset.Inspection")
  })
})

describe("SkillAsset placement contracts", () => {
  test("keeps omitted Info target absent without a default", () => {
    const decoded = Schema.decodeUnknownSync(SkillAsset.Info)(info)
    expect(decoded.target).toBeUndefined()
    const encoded = Schema.encodeSync(Schema.toCodecJson(SkillAsset.Info))(decoded)
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test("omits an explicitly undefined Info target before JSON serialization", () => {
    const decoded = Schema.decodeUnknownSync(SkillAsset.Info)(info)
    const encoded = Schema.encodeSync(SkillAsset.Info)(new SkillAsset.Info({ ...decoded, target: undefined }))
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test.each(["project", "global", "location"] as const)("round-trips an explicit %s Info target", (scope) => {
    const wire = { ...info, target: { ...target, scope } }
    const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(SkillAsset.Info))(wire)
    expect(decoded).toBeInstanceOf(SkillAsset.Info)
    expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
    expect(Schema.encodeSync(Schema.toCodecJson(SkillAsset.Info))(decoded)).toEqual(wire)
  })

  test("rejects a present malformed Info target instead of treating it as omitted", () => {
    ;[null, {}, { scope: "project" }, { ...target, scope: "workspace" }].forEach((value) => {
      expect(() => Schema.decodeUnknownSync(SkillAsset.Info)({ ...info, target: value })).toThrow()
    })
  })

  test("round-trips every inspection fact with its required Target", () => {
    ;[
      inspection,
      { ...inspection, exists: true, revision: summary.revision, nameConflict: true, pathConflict: true },
    ].forEach((wire) => {
      const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(SkillAsset.Inspection))(wire)
      expect(decoded).toBeInstanceOf(SkillAsset.Inspection)
      expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
      expect(Schema.encodeSync(Schema.toCodecJson(SkillAsset.Inspection))(decoded)).toEqual(wire)
    })
  })

  test("requires all five inspection facts and the target without filling missing values", () => {
    Object.keys(inspection).forEach((key) => {
      const partial = Object.fromEntries(Object.entries(inspection).filter((entry) => entry[0] !== key))
      expect(() => Schema.decodeUnknownSync(SkillAsset.Inspection)(partial)).toThrow()
    })
    expect(() =>
      Schema.decodeUnknownSync(SkillAsset.Inspection)({ ...inspection, revision: "not-a-revision" }),
    ).toThrow()
  })

  test("keeps placement out of legacy Summary and Candidate encodings", () => {
    const decodedSummary = Schema.decodeUnknownSync(SkillAsset.Summary)({ ...summary, target })
    const decodedCandidate = Schema.decodeUnknownSync(SkillAsset.Candidate)({ ...candidate, target })
    expect(decodedSummary).not.toHaveProperty("target")
    expect(decodedCandidate).not.toHaveProperty("target")
    expect(Schema.encodeSync(Schema.toCodecJson(SkillAsset.Summary))(decodedSummary)).toEqual(summary)
    expect(Schema.encodeSync(Schema.toCodecJson(SkillAsset.Candidate))(decodedCandidate)).toEqual(candidate)
  })
})

describe("CommandAsset placement contracts", () => {
  const target = { scope: "project" as const, root: "/workspace/.omnixa/commands" }
  const summary = {
    kind: "command" as const,
    name: "review-command",
    description: "Review the selected change",
    relativePath: "review-command.md",
    revision: "b".repeat(64),
  }
  const candidate = {
    name: summary.name,
    description: summary.description,
    relativePath: summary.relativePath,
    invocation: "/review-command",
    source: "Review $ARGUMENTS.\r\n",
  }
  const info = { ...summary, ...candidate }
  const inspection = {
    relativePath: summary.relativePath,
    exists: false,
    revision: null,
    nameConflict: false,
    pathConflict: false,
    target,
  }

  test("keeps Command inspection, revision and Target identities canonical", async () => {
    const entry = await import("../src/index.js")
    expect(entry.CommandAsset).toBe(CommandAsset)
    expect(CommandAsset.Inspection).toBeDefined()
    expect(CommandAsset.Inspection.fields.target).toBe(AssetPlacement.Target)
    expect(CommandAsset.Inspection.fields.revision).toBe(CommandAsset.BaseRevision)
    expect(CommandAsset.Inspection.ast.annotations?.identifier).toBe("CommandAsset.Inspection")
    expect(SchemaAST.resolveIdentifier(CommandAsset.Revision.ast)).toBe("CommandAsset.Revision")
  })

  test("round-trips all Command inspection facts with a nullable Command revision", () => {
    expect(CommandAsset.Inspection).toBeDefined()
    ;[
      inspection,
      { ...inspection, exists: true, revision: summary.revision, nameConflict: true, pathConflict: true },
    ].forEach((wire) => {
      const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(CommandAsset.Inspection))(wire)
      expect(decoded).toBeInstanceOf(CommandAsset.Inspection)
      expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
      expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Inspection))(decoded)).toEqual(wire)
    })
  })

  test("requires every Command inspection field without filling missing facts", () => {
    expect(CommandAsset.Inspection).toBeDefined()
    Object.keys(inspection).forEach((key) => {
      const partial = Object.fromEntries(Object.entries(inspection).filter((entry) => entry[0] !== key))
      expect(() => Schema.decodeUnknownSync(CommandAsset.Inspection)(partial)).toThrow()
    })
    expect(() =>
      Schema.decodeUnknownSync(CommandAsset.Inspection)({ ...inspection, revision: "not-a-revision" }),
    ).toThrow()
  })

  test("keeps an omitted Command Info target absent without a default", () => {
    const decoded = Schema.decodeUnknownSync(CommandAsset.Info)(info)
    expect(decoded.target).toBeUndefined()
    const encoded = Schema.encodeSync(Schema.toCodecJson(CommandAsset.Info))(decoded)
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test("omits an explicitly undefined Command Info target before JSON serialization", () => {
    const decoded = Schema.decodeUnknownSync(CommandAsset.Info)(info)
    const encoded = Schema.encodeSync(CommandAsset.Info)(new CommandAsset.Info({ ...decoded, target: undefined }))
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test.each(["project", "global", "location"] as const)("round-trips an explicit %s Command Info target", (scope) => {
    const wire = { ...info, target: { ...target, scope } }
    const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(CommandAsset.Info))(wire)
    expect(decoded).toBeInstanceOf(CommandAsset.Info)
    expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Info))(decoded)).toEqual(wire)
  })

  test("rejects a malformed Command Info target instead of treating it as omitted", () => {
    ;[null, {}, { scope: "project" }, { ...target, scope: "workspace" }].forEach((value) => {
      expect(() => Schema.decodeUnknownSync(CommandAsset.Info)({ ...info, target: value })).toThrow()
    })
  })

  test("keeps placement out of Command Summary and Candidate encodings", () => {
    const decodedSummary = Schema.decodeUnknownSync(CommandAsset.Summary)({ ...summary, target })
    const decodedCandidate = Schema.decodeUnknownSync(CommandAsset.Candidate)({ ...candidate, target })
    expect(decodedSummary).not.toHaveProperty("target")
    expect(decodedCandidate).not.toHaveProperty("target")
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Summary))(decodedSummary)).toEqual(summary)
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Candidate))(decodedCandidate)).toEqual(candidate)
  })

  test.each([
    { name: "omitted", fields: {} },
    { name: "empty", fields: { args: "" } },
  ])("preserves $name Command args and the literal source", (scenario) => {
    const candidateWire = Schema.decodeUnknownSync(Schema.Json)({ ...candidate, ...scenario.fields })
    const infoWire = Schema.decodeUnknownSync(Schema.Json)({ ...info, ...scenario.fields, target })
    const decodedCandidate = Schema.decodeUnknownSync(Schema.toCodecJson(CommandAsset.Candidate))(candidateWire)
    const decodedInfo = Schema.decodeUnknownSync(Schema.toCodecJson(CommandAsset.Info))(infoWire)
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Candidate))(decodedCandidate)).toEqual(candidateWire)
    expect(Schema.encodeSync(Schema.toCodecJson(CommandAsset.Info))(decodedInfo)).toEqual(infoWire)
    expect(candidate.source).toBe(decodedCandidate.source)
    expect(candidate.source).toBe(decodedInfo.source)
  })
})

describe("PromptAsset placement contracts", () => {
  const target = { scope: "project" as const, root: "/workspace/.omnixa/prompts" }
  const summary = {
    kind: "prompt" as const,
    name: "review-prompt",
    description: "Review the selected change",
    relativePath: "review-prompt.md",
    revision: "c".repeat(64),
  }
  const candidate = {
    name: summary.name,
    description: summary.description,
    relativePath: summary.relativePath,
    template: '\uFEFF  Review "{{selection}}" and $ARGUMENTS.\r\n\r\nKeep ${literal} and {{cursor}}.  \r\n',
  }
  const info = { ...summary, ...candidate }
  const inspection = {
    relativePath: summary.relativePath,
    exists: false,
    revision: null,
    nameConflict: false,
    pathConflict: false,
    target,
  }

  test("keeps Prompt inspection, revision and Target identities canonical", async () => {
    const entry = await import("../src/index.js")
    expect(entry.PromptAsset).toBe(PromptAsset)
    expect(PromptAsset.Inspection).toBeDefined()
    expect(PromptAsset.Inspection.fields.target).toBe(AssetPlacement.Target)
    expect(PromptAsset.Inspection.fields.revision).toBe(PromptAsset.BaseRevision)
    expect(PromptAsset.Inspection.ast.annotations?.identifier).toBe("PromptAsset.Inspection")
  })

  test("preserves the public Prompt identifiers used by generated contracts", () => {
    expect(PromptAsset.Inspection).toBeDefined()
    ;[
      { contract: PromptAsset.Name, identifier: "PromptAsset.Name" },
      { contract: PromptAsset.Description, identifier: "PromptAsset.Description" },
      { contract: PromptAsset.Revision, identifier: "PromptAsset.Revision" },
      { contract: PromptAsset.Template, identifier: "PromptAsset.Template" },
      { contract: PromptAsset.Summary, identifier: "PromptAsset.Summary" },
      { contract: PromptAsset.Info, identifier: "PromptAsset.Info" },
      { contract: PromptAsset.Candidate, identifier: "PromptAsset.Candidate" },
      { contract: PromptAsset.Frontmatter, identifier: "PromptAsset.Frontmatter" },
      { contract: PromptAsset.Inspection, identifier: "PromptAsset.Inspection" },
    ].forEach((entry) => {
      expect(SchemaAST.resolveIdentifier(entry.contract.ast)).toBe(entry.identifier)
    })
  })

  test.each(["project", "global", "location"] as const)("round-trips every %s Prompt inspection fact", (scope) => {
    expect(PromptAsset.Inspection).toBeDefined()
    ;[
      { ...inspection, target: { ...target, scope } },
      {
        ...inspection,
        exists: true,
        revision: summary.revision,
        nameConflict: true,
        pathConflict: true,
        target: { ...target, scope },
      },
    ].forEach((wire) => {
      const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(PromptAsset.Inspection))(wire)
      expect(decoded).toBeInstanceOf(PromptAsset.Inspection)
      expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
      expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Inspection))(decoded)).toEqual(wire)
    })
  })

  test("requires every Prompt inspection field and validates its nullable revision", () => {
    expect(PromptAsset.Inspection).toBeDefined()
    Object.keys(inspection).forEach((key) => {
      const partial = Object.fromEntries(Object.entries(inspection).filter((entry) => entry[0] !== key))
      expect(() => Schema.decodeUnknownSync(PromptAsset.Inspection)(partial)).toThrow()
    })
    ;["not-a-revision", "C".repeat(64), "c".repeat(63), undefined].forEach((revision) => {
      expect(() => Schema.decodeUnknownSync(PromptAsset.Inspection)({ ...inspection, revision })).toThrow()
    })
    expect(() =>
      Schema.decodeUnknownSync(PromptAsset.Inspection)({ ...inspection, target: { ...target, scope: "workspace" } }),
    ).toThrow()
  })

  test("keeps an omitted Prompt Info target absent without a default", () => {
    const decoded = Schema.decodeUnknownSync(PromptAsset.Info)(info)
    expect(decoded.target).toBeUndefined()
    const encoded = Schema.encodeSync(Schema.toCodecJson(PromptAsset.Info))(decoded)
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test("omits an explicitly undefined Prompt Info target before JSON serialization", () => {
    const decoded = Schema.decodeUnknownSync(PromptAsset.Info)(info)
    const encoded = Schema.encodeSync(PromptAsset.Info)(new PromptAsset.Info({ ...decoded, target: undefined }))
    expect(encoded).toEqual(info)
    expect(encoded).not.toHaveProperty("target")
  })

  test.each(["project", "global", "location"] as const)("round-trips an explicit %s Prompt Info target", (scope) => {
    const wire = { ...info, target: { ...target, scope } }
    const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(PromptAsset.Info))(wire)
    expect(decoded).toBeInstanceOf(PromptAsset.Info)
    expect(decoded.target).toBeInstanceOf(AssetPlacement.Target)
    expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Info))(decoded)).toEqual(wire)
    expect(decoded.template).toBe(PromptAsset.Template.make(candidate.template))
  })

  test("rejects a malformed Prompt Info target instead of treating it as omitted", () => {
    ;[null, {}, { scope: "project" }, { ...target, scope: "workspace" }].forEach((value) => {
      expect(() => Schema.decodeUnknownSync(PromptAsset.Info)({ ...info, target: value })).toThrow()
    })
  })

  test("keeps placement out of Prompt Summary and Candidate encodings", () => {
    const decodedSummary = Schema.decodeUnknownSync(PromptAsset.Summary)({ ...summary, target })
    const decodedCandidate = Schema.decodeUnknownSync(PromptAsset.Candidate)({ ...candidate, target })
    expect(decodedSummary).not.toHaveProperty("target")
    expect(decodedCandidate).not.toHaveProperty("target")
    expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Summary))(decodedSummary)).toEqual(summary)
    expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Candidate))(decodedCandidate)).toEqual(candidate)
  })

  test("preserves the complete Prompt candidate and literal template without interpolation", () => {
    const decodedCandidate = Schema.decodeUnknownSync(Schema.toCodecJson(PromptAsset.Candidate))(candidate)
    const decodedInfo = Schema.decodeUnknownSync(Schema.toCodecJson(PromptAsset.Info))(info)
    expect(decodedCandidate.template).toBe(PromptAsset.Template.make(candidate.template))
    expect(decodedInfo.template).toBe(PromptAsset.Template.make(candidate.template))
    expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Candidate))(decodedCandidate)).toEqual(candidate)
    expect(Schema.encodeSync(Schema.toCodecJson(PromptAsset.Info))(decodedInfo)).toEqual(info)
    Object.keys(candidate).forEach((key) => {
      const partial = Object.fromEntries(Object.entries(candidate).filter((entry) => entry[0] !== key))
      expect(() => Schema.decodeUnknownSync(PromptAsset.Candidate)(partial)).toThrow()
    })
    ;["", "x".repeat(100_001), null].forEach((template) => {
      expect(() => Schema.decodeUnknownSync(PromptAsset.Candidate)({ ...candidate, template })).toThrow()
    })
  })
})
