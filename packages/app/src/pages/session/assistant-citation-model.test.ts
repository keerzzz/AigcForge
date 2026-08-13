import { describe, expect, test } from "bun:test"
import { citationSummary, parseKbUri } from "./assistant-citation-model"

// 批次 4 G4（F2）：引文锚定纯逻辑 — kb:// URI 解析（宽容）+ 摘要截断。
// renderer 在 app 层 timeline 后处理（mode 门控，仅 assistant 会话）。

describe("parseKbUri", () => {
  test("parses kb:// note ids", () => {
    expect(parseKbUri("kb://kb_123abc")).toBe("kb_123abc")
  })

  test("tolerates trailing whitespace and query noise", () => {
    expect(parseKbUri(" kb://kb_1 ")).toBe("kb_1")
  })

  test("returns undefined for malformed or foreign uris (宽容：不渲染角标)", () => {
    expect(parseKbUri("https://example.com")).toBeUndefined()
    expect(parseKbUri("kb://")).toBeUndefined()
    expect(parseKbUri("kb://has space")).toBeUndefined()
    expect(parseKbUri("")).toBeUndefined()
  })

  test("accepts any opaque id after kb:// without requiring the kb_ prefix", () => {
    expect(parseKbUri("kb://note-42")).toBe("note-42")
  })
})

describe("citationSummary", () => {
  test("keeps short content verbatim", () => {
    expect(citationSummary("short note", 200)).toBe("short note")
  })

  test("truncates long content at the word boundary with an ellipsis", () => {
    const content = "word ".repeat(100)
    const summary = citationSummary(content, 30)
    expect(summary.length).toBeLessThanOrEqual(31)
    expect(summary.endsWith("…")).toBe(true)
  })

  test("handles empty content", () => {
    expect(citationSummary("", 200)).toBe("")
  })
})
