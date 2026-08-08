import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Mermaid } from "./mermaid"
import { escapeHtml, sanitizeMarkdown } from "./markdown-cache"

// happy-dom lacks SVGGraphicsElement.getBBox (mermaid layout needs it) and its
// HTML parser drops SVG children when a <style> element is present. Shim both
// for this suite only and restore afterwards so other tests see the real
// prototypes (AGENTS.md: no globalThis.* mocks that leak across suites).
// Bracket access avoids the unbound-method lint rule (dot access only).
const origGetBBoxGraphics = SVGGraphicsElement.prototype["getBBox"]
const origGetBBoxSVG = SVGSVGElement.prototype["getBBox"]
const origParseFromString = DOMParser.prototype["parseFromString"]

beforeAll(() => {
  SVGGraphicsElement.prototype["getBBox"] = () => new DOMRect(0, 0, 100, 30)
  SVGSVGElement.prototype["getBBox"] = () => new DOMRect(0, 0, 400, 200)
  DOMParser.prototype["parseFromString"] = function (this: DOMParser, html: string, type: DOMParserSupportedType) {
    return origParseFromString.call(this, html.replace(/<style>[\s\S]*?<\/style>/g, ""), type)
  }
})

afterAll(() => {
  SVGGraphicsElement.prototype["getBBox"] = origGetBBoxGraphics
  SVGSVGElement.prototype["getBBox"] = origGetBBoxSVG
  DOMParser.prototype["parseFromString"] = origParseFromString
})

const placeholder = (src: string) => `<div data-mermaid="${encodeURIComponent(src)}"></div>`

describe("renderMermaidBlocks", () => {
  test("renders a flowchart placeholder into an <svg> preserving url(#) references", async () => {
    const html = `<p>before</p>${placeholder("graph TD; A-->B")}<p>after</p>`
    const result = await Mermaid.renderMermaidBlocks(html)
    expect(result).toContain("<svg")
    expect(result).toContain("url(#")
  })

  test("renders at least 4 diagram types into <svg>", async () => {
    const diagrams = [
      "graph TD; A-->B",
      "sequenceDiagram\n  Alice->>Bob: hello\n  Bob-->>Alice: hi",
      "gantt\n  title Schedule\n  section S1\n  task1 :a1, 2026-01-01, 5d",
      "pie title Distribution\n  \"A\" : 40\n  \"B\" : 60",
    ]
    for (const src of diagrams) {
      const result = await Mermaid.renderMermaidBlocks(placeholder(src))
      expect(result).toContain("<svg")
    }
  })

  test("returns non-placeholder HTML unchanged", async () => {
    const html = "<p>plain markdown</p><pre><code>const x = 1</code></pre>"
    expect(await Mermaid.renderMermaidBlocks(html)).toBe(html)
  })

  test("falls back to a source code block on invalid syntax without throwing", async () => {
    const src = "not-a-diagram\n  just text"
    const result = await Mermaid.renderMermaidBlocks(placeholder(src))
    expect(result).toContain('<pre><code class="language-mermaid">')
    expect(result).toContain("not-a-diagram")
  })

  test("falls back with escaped source so unsafe characters stay inert", async () => {
    const src = "flowchart TD\n  A-->B\n<script>alert(1)</script>"
    const result = await Mermaid.renderMermaidBlocks(placeholder(src))
    expect(result).toContain("&lt;script&gt;")
    expect(result).not.toContain("<script>alert(1)</script>")
  })

  test("does not leak mermaid's DOMPurify hooks into global markdown sanitize", async () => {
    await Mermaid.renderMermaidBlocks(placeholder("graph TD; A-->B"))
    const out = sanitizeMarkdown('<a href="https://safe.com" target="_blank">link</a>')
    expect(out).toContain("noopener")
    expect(out).toContain("noreferrer")
  })
})

describe("sanitizeMermaidSvg", () => {
  test("strips script, foreignObject, and style but keeps svg elements and id", () => {
    const svg = `<svg id="root"><script/><defs><marker id="arrowhead"><path d="M0,0"/></marker></defs><g id="g1"><text id="t1">hi</text><rect id="r1" x="0" y="0" width="10" height="10"/><path id="p1" d="M0,0"/><circle id="c1" cx="1" cy="1" r="1"/></g><foreignObject><div>bad</div></foreignObject><style>.x{color:red}</style></svg>`
    const result = Mermaid.sanitizeMermaidSvg(svg)
    expect(result).toContain("<svg")
    expect(result).toContain('id="arrowhead"')
    expect(result).toContain("<g")
    expect(result).toContain("<text")
    expect(result).toContain("<rect")
    expect(result).toContain("<path")
    expect(result).toContain("<circle")
    expect(result).not.toContain("<script")
    expect(result).not.toContain("foreignObject")
    expect(result).not.toContain("<style")
  })

  test("strips event handler attributes", () => {
    const result = Mermaid.sanitizeMermaidSvg('<svg id="x" onload="alert(1)"><rect onclick="x()"/></svg>')
    expect(result).not.toContain("onload")
    expect(result).not.toContain("onclick")
  })
})

describe("escapeHtml", () => {
  test("escapes & < > quotes", () => {
    expect(escapeHtml('&<>"\'')).toBe("&amp;&lt;&gt;&quot;&#39;")
  })
})
