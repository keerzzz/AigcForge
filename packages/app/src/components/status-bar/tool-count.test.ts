import { describe, expect, test } from "bun:test"
import { toolCountFromParts } from "./tool-count"
import type { Message, Part } from "@aigcfroge/sdk/v2/client"

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
      m1: [{ id: "p1", type: "tool", tool: "read" } as Part, { id: "p2", type: "text", text: "hello" } as Part],
      m2: [{ id: "p3", type: "tool", tool: "edit" } as Part, { id: "p4", type: "tool", tool: "grep" } as Part],
    }
    expect(toolCountFromParts(parts, messages)).toBe(3)
  })

  test("skips non-tool parts", () => {
    const messages = [{ id: "m1", sessionID: "s1", role: "assistant", time: { created: 0 } }] as Message[]
    const parts: Record<string, Part[]> = {
      m1: [
        { id: "p1", type: "text", text: "hello" } as Part,
        { id: "p2", type: "reasoning", text: "thinking" } as Part,
      ],
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
      m1: [{ id: "p1", type: "tool", tool: "read" } as Part],
    }
    expect(toolCountFromParts(parts, messages)).toBe(0)
  })
})
