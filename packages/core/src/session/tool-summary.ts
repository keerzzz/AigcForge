export * as ToolSummary from "./tool-summary"

import { DateTime, Schema } from "effect"
import { SessionMessage } from "./message"

export class Entry extends Schema.Class<Entry>("ToolSummary.Entry")({
  tool: Schema.String,
  file: Schema.String.pipe(Schema.optional),
  count: Schema.Int,
  duration: Schema.Int.pipe(Schema.optional),
  status: Schema.String,
}) {}

export class Summary extends Schema.Class<Summary>("ToolSummary.Summary")({
  agent: Schema.String,
  engine: Schema.String,
  tools: Schema.Array(Entry),
  totalDuration: Schema.Int,
  totalTokens: Schema.Int.pipe(Schema.optional),
}) {}

function extractFile(input: Record<string, unknown> | string | undefined): string | undefined {
  if (!input || typeof input === "string") return undefined
  const path = input["path"]
  if (typeof path === "string") return path
  const workdir = input["workdir"]
  if (typeof workdir === "string") return workdir
  return undefined
}

function toMillis(value: DateTime.DateTime | number): number {
  if (typeof value === "number") return value
  return DateTime.toEpochMillis(value)
}

function getDuration(tool: { time: { created: DateTime.DateTime | number; completed?: DateTime.DateTime | number } }): number | undefined {
  if (tool.time.completed === undefined) return undefined
  return toMillis(tool.time.completed) - toMillis(tool.time.created)
}

/**
 * Extract tool summaries from session assistant messages.
 * Pure function — no Effect dependencies.
 */
export function fromMessages(messages: SessionMessage.Message[]): Summary[] {
  const assistantMessages = messages.filter((m): m is SessionMessage.Assistant => m.type === "assistant")
  if (assistantMessages.length === 0) return []

  return assistantMessages.map((msg) => {
    const tools = msg.content.filter((c): c is SessionMessage.AssistantTool => c.type === "tool")
    if (tools.length === 0) {
      return Summary.make({
        agent: msg.agent,
        engine: "subagent",
        tools: [],
        totalDuration: 0,
      })
    }

    // Group by (tool name, file path) -> aggregate
    const groups = new Map<
      string,
      { tool: string; file: string | undefined; count: number; duration: number; status: string }
    >()
    for (const tool of tools) {
      const input = tool.state.input as Record<string, unknown> | string | undefined
      const file = extractFile(input)
      const key = `${tool.name}|${file ?? ""}`
      const existing = groups.get(key)
      const dur = getDuration(tool as unknown as { time: { created: number; completed?: number } }) ?? 0
      const status = tool.state.status

      if (existing) {
        existing.count++
        existing.duration += dur
        // Upgrade status: "running" < "completed" < "failed"
        if (status === "error") existing.status = "failed"
        else if (status === "completed" && existing.status !== "failed") existing.status = "completed"
      } else {
        groups.set(key, {
          tool: tool.name,
          file,
          count: 1,
          duration: dur,
          status: status === "error" ? "failed" : status === "completed" ? "completed" : "running",
        })
      }
    }

    const entries = Array.from(groups.values()).map((g) =>
      Entry.make({
        tool: g.tool,
        file: g.file,
        count: g.count,
        duration: g.duration > 0 ? g.duration : undefined,
        status: g.status,
      }),
    )

    const totalDuration = entries.reduce((acc, e) => acc + (e.duration ?? 0), 0)

    return Summary.make({
      agent: msg.agent,
      engine: "subagent",
      tools: entries,
      totalDuration,
    })
  })
}
