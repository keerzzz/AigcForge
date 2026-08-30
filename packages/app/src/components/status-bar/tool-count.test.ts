import { describe, expect, test } from "bun:test"
import { toolCountFromParts } from "./tool-count"
import type { Message, Part } from "@aigcfroge/sdk/v2/client"

function toolPart(messageID: string, id: string, tool: string): Part {
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 0, end: 0 } },
  }
}

function textPart(messageID: string, id: string, text: string): Part {
  return { id, sessionID: "s1", messageID, type: "text", text }
}

function reasoningPart(messageID: string, id: string, text: string): Part {
  return { id, sessionID: "s1", messageID, type: "reasoning", text, time: { start: 0 } }
}

describe("toolCountFromParts", () => {
  test("returns 0 for no messages", () => {
    expect(toolCountFromParts({}, [])).toBe(0)
  })

  test("returns 0 when there are no assistant messages", () => {
    const messages = [{ id: "m1", sessionID: "s1", role: "user", time: { created: 0 } }] as Message[]
    expect(toolCountFromParts({}, messages)).toBe(0)
  })

  test("counts tool parts from assistant messages", () => {
    const messages = [
      { id: "m1", sessionID: "s1", role: "assistant", time: { created: 0 } } as Message,
      { id: "m2", sessionID: "s1", role: "assistant", time: { created: 0 } } as Message,
    ]
    const parts: Record<string, Part[]> = {
      m1: [toolPart("m1", "p1", "read"), textPart("m1", "p2", "hello")],
      m2: [toolPart("m2", "p3", "edit"), toolPart("m2", "p4", "grep")],
    }
    expect(toolCountFromParts(parts, messages)).toBe(3)
  })

  test("skips non-tool parts", () => {
    const messages = [{ id: "m1", sessionID: "s1", role: "assistant", time: { created: 0 } }] as Message[]
    const parts: Record<string, Part[]> = {
      m1: [textPart("m1", "p1", "hello"), reasoningPart("m1", "p2", "thinking")],
    }
    expect(toolCountFromParts(parts, messages)).toBe(0)
  })

  test("handles missing parts for a message", () => {
    const messages = [{ id: "m1", sessionID: "s1", role: "assistant", time: { created: 0 } }] as Message[]
    expect(toolCountFromParts({}, messages)).toBe(0)
  })

  test("skips user messages even if they have parts", () => {
    const messages = [{ id: "m1", sessionID: "s1", role: "user", time: { created: 0 } }] as Message[]
    const parts: Record<string, Part[]> = {
      m1: [toolPart("m1", "p1", "read")],
    }
    expect(toolCountFromParts(parts, messages)).toBe(0)
  })
})
