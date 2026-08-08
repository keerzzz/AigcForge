import { describe, expect, test } from "bun:test"
import { mermaidPlaceholder } from "./marked"

describe("mermaidPlaceholder", () => {
  test("wraps percent-encoded source into a data-mermaid div", () => {
    expect(mermaidPlaceholder("graph TD; A-->B")).toBe(
      '<div data-mermaid="graph%20TD%3B%20A--%3EB"></div>',
    )
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
