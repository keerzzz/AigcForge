import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AssetError, AssetKindId, AssetSummary } from "../src/asset"
import { WorkflowAsset } from "../src/workflow-asset"

describe("AssetSummary", () => {
  test("validates minimal summary", () => {
    const s = Schema.decodeUnknownSync(AssetSummary)({
      kind: "prompt",
      name: "test",
      description: "",
      relativePath: "test.md",
      revision: "a".repeat(64),
    })
    expect(s.kind).toBe("prompt")
  })

  test("rejects unknown kind", () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetSummary)({
        kind: "bogus",
        name: "x",
        description: "",
        relativePath: "x.md",
        revision: "a".repeat(64),
      })
    ).toThrow()
  })
})

describe("WorkflowAsset", () => {
  test("Summary accepts kind workflow", () => {
    const s = Schema.decodeUnknownSync(WorkflowAsset.Summary)({
      kind: "workflow",
      name: "code-review",
      description: "Automated review pipeline",
      relativePath: "code-review.yaml",
      revision: "a".repeat(64),
    })
    expect(s.kind).toBe("workflow")
    expect(s.name).toBe("code-review")
  })

  test("Frontmatter accepts steps and triggers", () => {
    const f = Schema.decodeUnknownSync(WorkflowAsset.Frontmatter)({
      kind: "workflow",
      name: "code-review",
      description: "Automated review pipeline",
      version: "1.0.0",
      triggers: ["/review"],
      steps: [
        {
          id: "fetch_diff",
          name: "Fetch Git Diff",
          agent: "builtin",
          input: { command: "git diff" },
          next: "lint_scan",
        },
        {
          id: "lint_scan",
          name: "Lint Scan",
          agent: "builtin",
          input: { command: "bun run lint" },
          branches: { success: "report_good", failure: "report_issues" },
        },
        {
          id: "report_good",
          name: "Report Clean",
          agent: "builtin",
          input: { template: "Passed" },
          next: "END",
        },
      ],
    })
    expect(f.name).toBe("code-review")
    expect(f.steps.length).toBe(3)
    expect(f.steps[0].next).toBe("lint_scan")
    expect(f.steps[1].branches).toEqual({ success: "report_good", failure: "report_issues" })
  })

  test("Info decodes full workflow", () => {
    const i = Schema.decodeUnknownSync(WorkflowAsset.Info)({
      kind: "workflow",
      name: "release",
      description: "Release pipeline",
      relativePath: "release.yaml",
      revision: "b".repeat(64),
      version: "2.0.0",
      triggers: ["/release"],
      steps: [{ id: "s1", name: "Build", agent: "builtin", input: {} }],
    })
    expect(i.kind).toBe("workflow")
    expect(i.version).toBe("2.0.0")
    expect(i.triggers).toEqual(["/release"])
    expect(i.steps[0].name).toBe("Build")
  })

  test("rejects missing name", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkflowAsset.Summary)({
        kind: "workflow",
        name: "",
        description: "",
        relativePath: "x.yaml",
        revision: "a".repeat(64),
      })
    ).toThrow()
  })
})

describe("AssetError", () => {
  test("creates error with tagged reason", () => {
    const err = new AssetError({ kind: "mcp", reason: "unknown_kind", message: "Not registered" })
    expect(err.reason).toBe("unknown_kind")
    expect(err._tag).toBe("AssetError")
  })
})
