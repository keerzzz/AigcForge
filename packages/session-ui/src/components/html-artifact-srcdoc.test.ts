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
    expect(srcdoc).toContain("window.localStorage = window.sessionStorage =")
    expect(srcdoc.indexOf("window.localStorage")).toBeGreaterThan(srcdoc.indexOf("<head>"))
    expect(srcdoc.indexOf("window.localStorage")).toBeLessThan(srcdoc.indexOf("</head>"))
  })

  test("injects the storage polyfill before library scripts", () => {
    const srcdoc = buildSrcdoc("", ["var lib = 1"])
    expect(srcdoc.indexOf("window.localStorage")).toBeLessThan(srcdoc.indexOf("var lib = 1"))
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

  test("storage polyfill round-trips values in an in-memory map", () => {
    const srcdoc = buildSrcdoc("", [])
    const script = srcdoc.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeDefined()
    const run = new Function("window", script!)
    const fakeWindow: Record<string, unknown> = {}
    run(fakeWindow)
    const storage = fakeWindow.localStorage as {
      getItem: (key: string) => string | null
      setItem: (key: string, value: string) => void
      removeItem: (key: string) => void
      clear: () => void
    }
    expect(fakeWindow.sessionStorage).toBe(fakeWindow.localStorage)
    expect(storage.getItem("missing")).toBeNull()
    storage.setItem("k", "v")
    expect(storage.getItem("k")).toBe("v")
    storage.setItem("n", 42 as unknown as string)
    expect(storage.getItem("n")).toBe("42")
    storage.removeItem("k")
    expect(storage.getItem("k")).toBeNull()
    storage.setItem("a", "1")
    storage.clear()
    expect(storage.getItem("a")).toBeNull()
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
