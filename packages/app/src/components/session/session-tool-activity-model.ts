import type { Part } from "@aigcfroge/sdk/v2/client"

export type ToolCategory = "general" | "command" | "skill" | "mcp" | "agent" | "asset"

export type ToolActivityItem = {
  name: string
  count: number
  errors: number
  blocked: number
}

export type ToolActivity = {
  category: ToolCategory
  label: string
  total: number
  items: ToolActivityItem[]
}

const classifyTool = (tool: string): ToolCategory => {
  if (tool === "skill") return "skill"
  if (tool === "task") return "agent"
  if (tool === "bash") return "command"
  if (tool === "list_assets" || (tool.startsWith("propose_") && tool.endsWith("_asset"))) return "asset"
  if (tool.startsWith("mcp_") || tool === "list_mcp_resources" || tool === "list_mcp_resource_templates" || tool === "read_mcp_resource") return "mcp"
  return "general"
}

const CATEGORY_ORDER: ToolCategory[] = ["general", "command", "skill", "mcp", "agent", "asset"]
const CATEGORY_LABEL: Record<ToolCategory, string> = {
  general: "toolActivity.category.general",
  command: "toolActivity.category.command",
  skill: "toolActivity.category.skill",
  mcp: "toolActivity.category.mcp",
  agent: "toolActivity.category.agent",
  asset: "toolActivity.category.asset",
}

// "blocked" counts doom_loop rejections surfaced as tool errors. Detection
// matches the runner's error text ("... blocked by doom_loop approval",
// session/runner/llm.ts), so it covers denied/rejected approvals only - a
// CorrectedError carries the user's feedback text instead and is not counted.
// Stats reflect the current context window: compaction rewrites history and
// drops older parts, shrinking the counts.
const isDoomLoopBlock = (error: string) => error.includes("blocked by doom_loop")

export function aggregateToolActivity(
  parts: readonly Part[],
): ToolActivity[] {
  const counts = new Map<string, ToolActivityItem>()

  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed" && part.state.status !== "error") continue
    const item = counts.get(part.tool) ?? { name: part.tool, count: 0, errors: 0, blocked: 0 }
    if (part.state.status === "completed") item.count += 1
    if (part.state.status === "error") {
      item.errors += 1
      if (isDoomLoopBlock(part.state.error)) item.blocked += 1
    }
    counts.set(part.tool, item)
  }

  const grouped = new Map<ToolCategory, ToolActivityItem[]>()
  for (const item of counts.values()) {
    const category = classifyTool(item.name)
    const group = grouped.get(category) ?? []
    group.push(item)
    grouped.set(category, group)
  }

  return CATEGORY_ORDER
    .map((category) => {
      const items = grouped.get(category)
      if (!items || items.length === 0) return null

      const sorted = items.sort((a, b) => b.count + b.errors - (a.count + a.errors)).slice(0, 10)

      return {
        category,
        label: CATEGORY_LABEL[category],
        total: sorted.reduce((sum, item) => sum + item.count, 0),
        items: sorted,
      } satisfies ToolActivity
    })
    .filter((x): x is ToolActivity => x !== null)
}
