import { describe, expect, test } from "bun:test"
import { createMarkedParser, mermaidPlaceholder } from "./marked"

describe("mermaidPlaceholder", () => {
  test("wraps percent-encoded source into a data-mermaid div", () => {
    expect(mermaidPlaceholder("graph TD; A-->B")).toBe('<div data-mermaid="graph%20TD%3B%20A--%3EB"></div>')
  })

  test("round-trips through attribute parsing and decodeURIComponent", () => {
    const src = 'graph TD\n  A["say <hi> & bye"]-->B'
    const escaped = mermaidPlaceholder(src)
    expect(escaped).not.toContain("-->")
    const value = escaped.match(/data-mermaid="([^"]+)"/)![1]
    expect(value).not.toContain("<")
    expect(value).not.toContain(">")
    expect(value).not.toContain('"')
    expect(decodeURIComponent(value)).toBe(src)
  })
})

describe("createMarkedParser link escaping", () => {
  const parser = createMarkedParser()

  test("escapes a double quote in the link title instead of closing the attribute", async () => {
    const html = await parser.parse("[x](https://ok.example 'a\" style=\"position:fixed;inset:0')")
    expect(html).not.toContain('style="')
    expect(html).toContain("&quot;")
  })

  test("percent-encodes a double quote inside the link href", async () => {
    const html = await parser.parse('[x](https://a"style="b)')
    expect(html).not.toContain('style="')
    expect(html).toContain("%22")
  })
})
