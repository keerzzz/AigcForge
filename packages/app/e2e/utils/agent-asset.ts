import type { Page } from "@playwright/test"
import type { AgentAssetApplyOutput, JsonValue, SessionMessageInfo } from "@aigcfroge/client/promise"
import { SkillAssets } from "./skill-asset"

export function body() {
  return {
    name: "Review",
    description: "Review the actual code",
    config:
      'mode: subagent\npermissions:\n  - action: read\n    resource: "*"\n    effect: allow\n  - action: bash\n    resource: "*"\n    effect: allow',
    source: "Inspect the actual source carefully.\n",
  }
}

export function warnings(): AgentAssetApplyOutput["warnings"] {
  return [
    { code: "wildcard_allow", action: "read", resource: "*" },
    { code: "dangerous_allow", action: "bash", resource: "*" },
  ]
}

export function info(revision: string, config = body().config, source = body().source): AgentAssetApplyOutput["asset"] {
  return {
    kind: "agent",
    ...body(),
    config,
    source,
    relativePath: "Review.md",
    revision: revision.repeat(64),
    handoffs: [],
  }
}

export function history(
  label: string,
  input: Record<string, JsonValue> = body(),
  metadata: Record<string, JsonValue> | null = { ...SkillAssets.facts(), warnings: warnings() },
): SessionMessageInfo[] {
  return SkillAssets.history(label, input, metadata, "agent")
}

export function mock(page: Page, input: Parameters<typeof SkillAssets.mock>[1]) {
  return SkillAssets.mock(page, { ...input, kind: "agent" })
}

export * as AgentAssets from "./agent-asset"
