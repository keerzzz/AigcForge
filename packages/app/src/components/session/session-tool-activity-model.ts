import type { Part, ToolPart } from "@aigcfroge/sdk/v2/client"

export type ToolCategory = "read" | "write" | "command" | "mcp" | "skill" | "web" | "other"

export type ToolActivityItem = {
  name: string
  count: number
}

export type ToolActivity = {
  category: ToolCategory
  label: string
  total: number
  items: ToolActivityItem[]
}

const classifyTool = (tool: string): ToolCategory => {
  if (tool.startsWith("read")) return "read"
  if (tool.startsWith("edit") || tool.startsWith("write") || tool.startsWith("apply")) return "write"
  if (tool.startsWith("bash") || tool.startsWith("shell") || tool.startsWith("command")) return "command"
  if (tool.startsWith("mcp")) return "mcp"
  if (tool.startsWith("skill")) return "skill"
  if (tool.startsWith("web")) return "web"
  return "other"
}

const CATEGORY_ORDER: ToolCategory[] = ["read", "write", "command", "mcp", "skill", "web", "other"]
const CATEGORY_LABEL: Record<ToolCategory, string> = {
  read: "toolActivity.category.read",
  write: "toolActivity.category.write",
  command: "toolActivity.category.command",
  mcp: "toolActivity.category.mcp",
  skill: "toolActivity.category.skill",
  web: "toolActivity.category.web",
  other: "toolActivity.category.other",
}

export function aggregateToolActivity(
  parts: readonly Part[],
): ToolActivity[] {
  const toolParts = parts.filter((p): p is ToolPart => p.type === "tool" && p.state.status === "completed")
  const counts = new Map<string, number>()

  for (const part of toolParts) {
    counts.set(part.tool, (counts.get(part.tool) ?? 0) + 1)
  }

  const grouped = new Map<ToolCategory, Map<string, number>>()
  for (const [tool, count] of counts) {
    const category = classifyTool(tool)
    let group = grouped.get(category)
    if (!group) {
      group = new Map()
      grouped.set(category, group)
    }
    group.set(tool, count)
  }

  return CATEGORY_ORDER
    .map((category) => {
      const items = grouped.get(category)
      if (!items || items.size === 0) return null

      const sorted = [...items.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))

      return {
        category,
        label: CATEGORY_LABEL[category],
        total: sorted.reduce((sum, item) => sum + item.count, 0),
        items: sorted,
      } satisfies ToolActivity
    })
    .filter((x): x is ToolActivity => x !== null)
}
