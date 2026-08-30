import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AssetError, AssetSummary } from "../src/asset"
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
      }),
    ).toThrow()
  })
})

describe("WorkflowAsset", () => {
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
    expect(f.kind).toBe("workflow")
    expect(f.name).toBe("code-review")
    expect(f.steps.length).toBe(3)
    expect(f.steps[0].next).toBe("lint_scan")
    expect(f.steps[1].branches).toEqual({ success: "report_good", failure: "report_issues" })
  })

  test("Name rejects empty string", () => {
    expect(() => Schema.decodeSync(WorkflowAsset.Name)("")).toThrow()
  })

  test("Name accepts valid string", () => {
    expect(() => Schema.decodeSync(WorkflowAsset.Name)("code-review")).not.toThrow()
  })

  test("Description rejects string over 300 code points", () => {
    expect(() => Schema.decodeSync(WorkflowAsset.Description)("x".repeat(301))).toThrow()
  })

  test("Revision rejects non-hex string", () => {
    expect(() => Schema.decodeSync(WorkflowAsset.Revision)("z".repeat(64))).toThrow()
  })

  test("Revision accepts 64-char hex string", () => {
    expect(() => Schema.decodeSync(WorkflowAsset.Revision)("a".repeat(64))).not.toThrow()
  })
})

describe("AssetError", () => {
  test("creates error with tagged reason", () => {
    const err = new AssetError({ kind: "mcp", reason: "unknown_kind", message: "Not registered" })
    expect(err.reason).toBe("unknown_kind")
    expect(err._tag).toBe("AssetError")
  })
})
