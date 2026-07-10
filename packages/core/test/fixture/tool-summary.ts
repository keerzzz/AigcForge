export * as ToolSummaryFixture from "./tool-summary"

import { Schema } from "effect"
import { SessionMessage } from "../../src/session/message"

export function makeToolCall(overrides: {
  name: string
  status?: "pending" | "running" | "completed" | "error"
  input?: Record<string, unknown>
  created?: number
  completed?: number
}): SessionMessage.AssistantTool {
  const now = Date.now()
  const status = overrides.status ?? "completed"
  const input = overrides.input ?? {}
  const created = overrides.created ?? now
  const completed = overrides.completed ?? now + 1000

  const makeState = () => {
    switch (status) {
      case "pending":
        return { status: "pending" as const, input: JSON.stringify(input) }
      case "running":
        return { status: "running" as const, input, structured: {} as Record<string, unknown>, content: [] }
      case "completed":
        return { status: "completed" as const, input, structured: {} as Record<string, unknown>, content: [] }
      case "error":
        return {
          status: "error" as const,
          input,
          content: [],
          structured: {} as Record<string, unknown>,
          error: { type: "unknown" as const, message: "tool failed" },
        }
    }
  }

  return Schema.decodeUnknownSync(SessionMessage.AssistantTool)({
    type: "tool",
    id: `tool_${overrides.name}_${now}`,
    name: overrides.name,
    state: makeState(),
    time: { created, ran: completed, completed },
  })
}

export function makeAssistantMessage(
  agent: string,
  toolPlainObjects: ReturnType<typeof makeToolCallPlain>[],
): SessionMessage.Assistant {
  return Schema.decodeUnknownSync(SessionMessage.Assistant)({
    type: "assistant",
    id: `msg_${agent}_${Date.now()}`,
    agent,
    model: { id: "claude-sonnet-4", providerID: "anthropic", variant: "default" },
    content: toolPlainObjects,
    finish: "end_turn",
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    time: { created: Date.now() },
  })
}

/**
 * Creates a plain tool call object (not decoded) for use in batch decoding.
 */
export function makeToolCallPlain(overrides: {
  name: string
  status?: "pending" | "running" | "completed" | "error"
  input?: Record<string, unknown>
  created?: number
  completed?: number
}) {
  const now = Date.now()
  const status = overrides.status ?? "completed"
  const input = overrides.input ?? {}
  const created = overrides.created ?? now
  const completed = overrides.completed ?? now + 1000

  const makeState = () => {
    switch (status) {
      case "pending":
        return { status: "pending" as const, input: JSON.stringify(input) }
      case "running":
        return { status: "running" as const, input, structured: {} as Record<string, unknown>, content: [] }
      case "completed":
        return { status: "completed" as const, input, structured: {} as Record<string, unknown>, content: [] }
      case "error":
        return {
          status: "error" as const,
          input,
          content: [],
          structured: {} as Record<string, unknown>,
          error: { type: "unknown" as const, message: "tool failed" },
        }
    }
  }

  return {
    type: "tool" as const,
    id: `tool_${overrides.name}_${now}`,
    name: overrides.name,
    state: makeState(),
    time: { created, ran: completed, completed },
  }
}

export function assistantWithTools(
  agent: string,
  tools: ReturnType<typeof makeToolCallPlain>[],
): SessionMessage.Assistant {
  return makeAssistantMessage(agent, tools)
}
