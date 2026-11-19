import type { Page } from "@playwright/test"
import type { PluginAssetApplyOutput, JsonValue, SessionMessageInfo } from "@aigcfroge/client/promise"
import { SkillAssets } from "./skill-asset"

export function body() {
  return {
    name: "Review",
    description: "Review plugin declaration",
    content:
      '\uFEFF# Keep this comment\nkind: plugin\nname: Review\ndescription: Review plugin declaration\nversion: "1.0.0"\nsource:\n  type: mcp\n  mcp:\n    name: review-server\nhooks:\n  - event: PreToolUse\n    command: "node  review.cjs"\n    timeout: .nan\nextra: preserved\n',
  }
}

export function info(revision: string, content = body().content): PluginAssetApplyOutput {
  return {
    kind: "plugin",
    ...body(),
    content,
    relativePath: "Review.plugin.yaml",
    revision: revision.repeat(64),
    version: "1.0.0",
    source: { type: "mcp", mcp: { name: "review-server" } },
    hooks: [{ event: "PreToolUse", command: "node  review.cjs", timeout: "NaN" }],
  }
}

export function history(label: string, input: Record<string, JsonValue> = body()): SessionMessageInfo[] {
  return SkillAssets.history(label, input, SkillAssets.facts("Review.plugin.yaml"), "plugin")
}

export function mock(page: Page, input: Parameters<typeof SkillAssets.mock>[1]) {
  return SkillAssets.mock(page, { ...input, kind: "plugin" })
}

export * as PluginAssets from "./plugin-asset"
