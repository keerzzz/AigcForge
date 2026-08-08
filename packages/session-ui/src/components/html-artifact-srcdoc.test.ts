import { describe, expect, test } from "bun:test"
import { buildSrcdoc, sanitizeHtmlLite } from "./html-artifact-srcdoc"

describe("buildSrcdoc", () => {
  test("embeds the CSP meta with connect-src 'none' (defense 2)", () => {
    const srcdoc = buildSrcdoc("<div>hi</div>", [])
    expect(srcdoc).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain("script-src 'unsafe-inline'")
    expect(srcdoc).toContain("style-src 'unsafe-inline'")
    expect(srcdoc).toContain("img-src 'self' data:")
    expect(srcdoc).toContain("connect-src 'none'")
  })

  test("injects the storage mock polyfill into the head (defense 3)", () => {
    const srcdoc = buildSrcdoc("<div>hi</div>", [])
    expect(srcdoc).toContain('Object.defineProperty(window, "localStorage"')
    expect(srcdoc.indexOf("localStorage")).toBeGreaterThan(srcdoc.indexOf("<head>"))
    expect(srcdoc.indexOf("localStorage")).toBeLessThan(srcdoc.indexOf("</head>"))
  })

  test("injects the storage polyfill before library scripts", () => {
    const srcdoc = buildSrcdoc("", ["var lib = 1"])
    expect(srcdoc.indexOf('Object.defineProperty(window, "localStorage"')).toBeLessThan(srcdoc.indexOf("var lib = 1"))
  })

  test("inlines library sources as <script> blocks (zero external script tags)", () => {
    const lib = "var chartLibMarker = 1;"
    const srcdoc = buildSrcdoc("<div>hi</div>", [lib])
    expect(srcdoc).toContain(`<script>${lib}</script>`)
    expect(srcdoc).not.toContain('<script src=')
  })

  test("keeps the artifact body intact", () => {
    const html = '<div id="root">hello</div>'
    const srcdoc = buildSrcdoc(html, [])
    expect(srcdoc).toContain(`<body>${html}</body>`)
    expect(srcdoc).toContain("<!DOCTYPE html>")
  })

  test("storage polyfill provides the in-memory Map API surface", () => {
    const srcdoc = buildSrcdoc("", [])
    // 功能 round-trip 由 e2e 在真实沙箱 iframe 验证（localStorage 不抛
    // SecurityError）；这里断言 API 面（getItem/setItem/removeItem/clear）。
    expect(srcdoc).toMatch(/getItem: function\(k\) \{ return store\[k\] \|\| null; \}/)
    expect(srcdoc).toMatch(/setItem: function\(k, v\) \{ store\[k\] = String\(v\); \}/)
    expect(srcdoc).toMatch(/removeItem: function\(k\) \{ delete store\[k\]; \}/)
    expect(srcdoc).toMatch(/clear: function\(\) \{ store = \{\}; \}/)
    expect(srcdoc).toContain("try { Object.defineProperty(window, \"localStorage\"")
    expect(srcdoc).toContain("try { Object.defineProperty(window, \"sessionStorage\"")
  })
})

describe("sanitizeHtmlLite", () => {
  test("strips external <script src> tags", () => {
    const out = sanitizeHtmlLite('<script src="https://evil.example/x.js"></script><p>ok</p>')
    expect(out).not.toContain("<script")
    expect(out).toContain("<p>ok</p>")
  })

  test("strips javascript: URLs", () => {
    const out = sanitizeHtmlLite('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain("javascript:")
  })

  test("strips event handler attributes", () => {
    const out = sanitizeHtmlLite('<div onclick="alert(1)" onload="x()">hi</div>')
    expect(out).not.toContain("onclick")
    expect(out).not.toContain("onload")
  })

  test("keeps inline scripts (library-style) and data attributes", () => {
    const out = sanitizeHtmlLite('<script>const x = 1</script><div data-x="1">hi</div>')
    expect(out).toContain("<script>const x = 1</script>")
    expect(out).toContain('data-x="1"')
  })
})
