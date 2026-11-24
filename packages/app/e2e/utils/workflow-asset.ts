import type { Page } from "@playwright/test"
import type { JsonValue, SessionMessageInfo, WorkflowAssetApplyOutput } from "@omnixa/client/promise"
import { SkillAssets } from "./skill-asset"

export function body() {
  return {
    name: "Review.plugin",
    description: "Review workflow declaration",
    content: [
      "\uFEFF# Keep the original workflow declaration",
      "# " + "请保留原始换行和注释；逐项检查节点、分支、并行目标与输入，再确认保存。".repeat(8),
      "kind: workflow",
      "name: Review.plugin",
      "description: Review workflow declaration",
      'version: "3"',
      "triggers: [manual, pull-request]",
      "extra: preserved",
      "steps:",
      "  - id: inspect",
      "    name: Inspect changes",
      "    agent: reviewer",
      "    input: { options: { paths: [src/a.ts, null], strict: true }, labels: [review], budget: 12, empty: null }",
      "    next: report",
      "    branches: { approved: report, rejected: END }",
      "    parallel: [verify]",
      "    failurePolicy: retry",
      "    maxAttempts: 3",
      "    timeoutSeconds: 90",
      "  - id: verify",
      "    name: Verify findings",
      "    agent: checker",
      "    input: { command: test }",
      "    next: report",
      "  - id: report",
      "    name: Report findings",
      "    agent: writer",
      "    next: END",
      "",
    ].join("\r\n"),
  }
}

export function info(revision: string, content = body().content): WorkflowAssetApplyOutput {
  return {
    kind: "workflow",
    ...body(),
    content,
    relativePath: "Review.plugin.yaml",
    revision: revision.repeat(64),
    version: "3",
    triggers: ["manual", "pull-request"],
    steps: [
      {
        id: "inspect",
        name: "Inspect changes",
        agent: "reviewer",
        input: { options: { paths: ["src/a.ts", null], strict: true }, labels: ["review"], budget: 12, empty: null },
        next: "report",
        branches: { approved: "report", rejected: "END" },
        parallel: ["verify"],
        failurePolicy: "retry",
        maxAttempts: 3,
        timeoutSeconds: 90,
      },
      {
        id: "verify",
        name: "Verify findings",
        agent: "checker",
        input: { command: "test" },
        next: "report",
        failurePolicy: "abort",
        maxAttempts: 1,
      },
      {
        id: "report",
        name: "Report findings",
        agent: "writer",
        input: {},
        next: "END",
        failurePolicy: "abort",
        maxAttempts: 1,
      },
    ],
  }
}

export function history(label: string, input: Record<string, JsonValue> = body()): SessionMessageInfo[] {
  return SkillAssets.history(label, input, SkillAssets.facts("Review.plugin.yaml"), "workflow")
}

export function mock(page: Page, input: Parameters<typeof SkillAssets.mock>[1]) {
  return SkillAssets.mock(page, { ...input, kind: "workflow" })
}

export * as WorkflowAssets from "./workflow-asset"
