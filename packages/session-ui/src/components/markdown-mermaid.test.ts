import { describe, expect, test } from "bun:test"
import { createMarkedParser } from "@aigcfroge/ui/context/marked"
import { sanitizeMarkdown } from "./markdown-cache"
import { renderMermaidBlocks } from "./mermaid"

SVGGraphicsElement.prototype.getBBox = () => new DOMRect(0, 0, 100, 30)
SVGSVGElement.prototype.getBBox = () => new DOMRect(0, 0, 400, 200)
const parseHtml = DOMParser.prototype.parseFromString.bind(DOMParser.prototype)
DOMParser.prototype.parseFromString = function (html: string, type: DOMParserSupportedType) {
  const withoutSvgStyle = html.replace(/<style>[\s\S]*?<\/style>/g, "")
  return parseHtml(withoutSvgStyle, type)
}

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
  })
})
