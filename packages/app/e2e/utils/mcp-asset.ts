import type { Page } from "@playwright/test"
import type { McpAssetApplyOutput, JsonValue, SessionMessageInfo } from "@omnixa/client/promise"
import { SkillAssets } from "./skill-asset"

export function body() {
  return {
    name: "Review",
    description: "Review MCP configuration",
    command: "/tmp/review  server",
    args: ["review-server.cjs", "--label", "quoted value"],
    env: { REVIEW_LABEL: 'quoted "value"\nsecond line', EMPTY: "" },
    configJson: '{\n  "transport": "stdio",\n  "enabled": false\n}\n',
  }
}

export function info(
  revision: string,
  input: Omit<McpAssetApplyOutput, "kind" | "relativePath" | "revision"> = body(),
): McpAssetApplyOutput {
  return { kind: "mcp", ...input, relativePath: "Review.md", revision: revision.repeat(64) }
}

export function history(
  label: string,
  input: Record<string, JsonValue> = body(),
  metadata: Record<string, JsonValue> | null = SkillAssets.facts(),
): SessionMessageInfo[] {
  return SkillAssets.history(label, input, metadata, "mcp")
}

export function mock(page: Page, input: Parameters<typeof SkillAssets.mock>[1]) {
  return SkillAssets.mock(page, { ...input, kind: "mcp" })
}

export * as McpAssets from "./mcp-asset"
