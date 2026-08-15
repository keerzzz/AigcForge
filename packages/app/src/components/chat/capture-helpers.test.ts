import { describe, expect, test } from "bun:test"
import { extractMessageContent, wrapCaptureContent, captureSeedPrompt } from "./capture-helpers"

function textPart(text: string, overrides?: Partial<{ synthetic: boolean; ignored: boolean }>) {
  return { type: "text" as const, text, id: "mid", sessionID: "sid", messageID: "mid", ...overrides }
}

function toolPart(name: string, status = "completed") {
  return {
    type: "tool" as const,
    id: "tid",
    sessionID: "sid",
    messageID: "mid",
    callID: "cid",
    tool: name,
    state: { status, input: {} },
  }
}

function reasoningPart(text: string) {
  return { type: "reasoning" as const, id: "rid", sessionID: "sid", messageID: "mid", text, time: { start: 0, end: 1 } }
}

describe("extractMessageContent", () => {
  test("extracts text from message parts", () => {
    const parts = [textPart("hello"), toolPart("read"), textPart("world")]
    expect(extractMessageContent(parts)).toBe("hello\n\nworld")
  })

  test("excludes reasoning parts by default and includes when includeReasoning is true", () => {
    const parts = [reasoningPart("step by step"), toolPart("read"), textPart("result")]
    expect(extractMessageContent(parts)).toBe("result")
    expect(extractMessageContent(parts, true)).toBe("step by step\n\nresult")
  })

  test("filters interactive UI parts", () => {
    const parts = [textPart("visible"), { type: "question", id: "q" }, { type: "confirm", id: "c" }, textPart("also visible")]
    expect(extractMessageContent(parts)).toBe("visible\n\nalso visible")
  })

  test("handles empty parts gracefully", () => {
    expect(extractMessageContent([])).toBe("")
  })

  test("filters synthetic and ignored text parts", () => {
    const parts = [textPart("real"), textPart("fake", { synthetic: true }), textPart("ignored", { ignored: true })]
    expect(extractMessageContent(parts)).toBe("real")
  })
})

describe("wrapCaptureContent", () => {
  test("wraps content with capture markers", () => {
    const result = wrapCaptureContent("hello world", { sessionID: "s1", messageID: "m1" })
    expect(result).toContain("<captured_content")
    expect(result).toContain('source_session="s1"')
    expect(result).toContain('source_message="m1"')
    expect(result).toContain("hello world")
    expect(result).toContain("</captured_content>")
  })
})

describe("captureSeedPrompt", () => {
  test("generates seed prompt with capture instruction", () => {
    const t = (key: string) => {
      if (key === "chatCapture.instruction") return "Process this captured content and propose the best asset type."
      return key
    }
    const result = captureSeedPrompt("some content", { sessionID: "s1", messageID: "m1" }, t)
    expect(result).toContain("<captured_content")
    expect(result).toContain("some content")
    expect(result).toContain("Process this captured content")
  })
})
