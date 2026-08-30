import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createMarkedParser } from "@aigcfroge/ui/context/marked"
import { sanitizeMarkdown } from "./markdown-cache"
import { renderMermaidBlocks } from "./mermaid"

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

const markdown = `# PRD

## 业务流程

\`\`\`mermaid
graph TD; A-->B
\`\`\`

## 实现

\`\`\`ts
const x = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`

describe("markdown -> mermaid integration", () => {
  // Mermaid's lazy chunk load starves past bun's 5s default under turbo
  // parallel load (observed 5.6s); the assertions themselves are not slow.
  test("mermaid block becomes svg while ts block stays shiki-highlighted", async () => {
    const parser = createMarkedParser()
    const html = await Promise.resolve(parser.parse(markdown))
    expect(html).toContain("data-mermaid=")

    const safe = sanitizeMarkdown(html)
    expect(safe).toContain("data-mermaid=")

    const final = await renderMermaidBlocks(safe)
    expect(final).toContain("<svg")
    expect(final).toContain("url(#")
    expect(final).toContain('<pre class="shiki')
    expect(final).toContain("<text")
    expect(final).not.toContain("foreignObject")
  }, 15_000)
})
