import { describe, expect, test } from "bun:test"
import type { Part } from "@aigcfroge/sdk/v2/client"
import { aggregateToolActivity } from "./session-tool-activity-model"

const toolPart = (tool: string): Part =>
  ({
    id: `p-${tool}`,
    sessionID: "s1",
    messageID: "m1",
    type: "tool",
    callID: `c-${tool}`,
    tool,
    state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 0, end: 0 } },
  }) satisfies Part

describe("aggregateToolActivity", () => {
  test("classifies built-in tools by intent", () => {
    const parts = [
      toolPart("read"),
      toolPart("glob"),
      toolPart("grep"),
      toolPart("edit"),
      toolPart("write"),
      toolPart("apply_patch"),
      toolPart("webfetch"),
      toolPart("websearch"),
      toolPart("question"),
      toolPart("todowrite"),
      toolPart("bash"),
      toolPart("skill"),
      toolPart("task"),
      toolPart("list_mcp_resources"),
      toolPart("read_mcp_resource"),
    ]

    const activities = aggregateToolActivity(parts)
    const categories = activities.map((a) => a.category)

    expect(categories).toContain("general")
    expect(categories).toContain("command")
    expect(categories).toContain("skill")
    expect(categories).toContain("agent")
    expect(categories).toContain("mcp")

    const general = activities.find((a) => a.category === "general")
    expect(general?.items.length).toBe(10)

    const command = activities.find((a) => a.category === "command")
    expect(command?.items).toEqual([{ name: "bash", count: 1 }])

    const agent = activities.find((a) => a.category === "agent")
    expect(agent?.items).toEqual([{ name: "task", count: 1 }])
  })

  test("classifies chat asset tools as asset, not their execution counterparts", () => {
    const parts = [
      toolPart("list_assets"),
      toolPart("propose_prompt_asset"),
      toolPart("propose_skill_asset"),
      toolPart("propose_mcp_asset"),
      toolPart("propose_command_asset"),
      toolPart("propose_agent_asset"),
      toolPart("propose_workflow_asset"),
      toolPart("propose_plugin_asset"),
    ]

    const activities = aggregateToolActivity(parts)
    const categories = activities.map((a) => a.category)

    expect(categories).toEqual(["asset"])
    expect(activities[0].total).toBe(8)
    expect(activities[0].items.length).toBe(8)
  })

  test("does not classify propose_mcp_asset as mcp", () => {
    const activities = aggregateToolActivity([toolPart("propose_mcp_asset")])

    expect(activities).toHaveLength(1)
    expect(activities[0].category).toBe("asset")
  })

  test("ignores non-completed tool parts", () => {
    const pending: Part = { id: "p-read", sessionID: "s1", messageID: "m1", type: "tool", callID: "c-read", tool: "read", state: { status: "pending", input: {}, raw: "" } }
    const activities = aggregateToolActivity([pending])

    expect(activities).toHaveLength(0)
  })

  test("returns empty array when no tools", () => {
    expect(aggregateToolActivity([])).toEqual([])
  })
})
