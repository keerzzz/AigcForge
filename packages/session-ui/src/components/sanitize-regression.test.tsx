import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "./markdown-cache"

describe("sanitize regression", () => {
  test("script tag is stripped", () => {
    const result = sanitizeMarkdown("<script>alert(1)</script><p>hello</p>")
    expect(result).not.toContain("<script>")
    expect(result).toContain("<p>hello</p>")
  })

  test("<svg><foreignObject> is stripped", () => {
    const result = sanitizeMarkdown('<svg><foreignObject><div>bad</div></foreignObject></svg>')
    expect(result).not.toContain("<foreignObject>")
  })

  test("javascript: URL is stripped from href", () => {
    const result = sanitizeMarkdown('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain("javascript:")
  })

  test("custom elements are stripped", () => {
    const result = sanitizeMarkdown("<evil-el onclick='alert(1)'>bad</evil-el>")
    expect(result).not.toContain("<evil-el>")
  })

  test("target=\"_blank\" gets noopener noreferrer", () => {
    const result = sanitizeMarkdown('<a href="https://safe.com" target="_blank">link</a>')
    expect(result).toContain("noopener")
    expect(result).toContain("noreferrer")
  })

  test("normal markdown HTML is preserved", () => {
    const result = sanitizeMarkdown("<p>hello <strong>world</strong></p>")
    expect(result).toContain("<p>hello")
    expect(result).toContain("<strong>world</strong>")
    expect(result).toContain("</p>")
  })

  test("empty input returns empty", () => {
    expect(sanitizeMarkdown("")).toBe("")
  })
})
