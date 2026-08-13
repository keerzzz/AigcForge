import { describe, expect, test } from "bun:test"
import { decorateWikilinks, wikilinkSpans } from "./assistant-wikilink-decorate"

// 批次 3 G4：预览中的 [[wikilink]] 装饰 — 悬空高亮（目标不存在）+ 已解析标记。
// 在 DOM 上运行（happydom），Markdown 渲染后由 MutationObserver 触发。

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g

function render(text: string) {
  const root = document.createElement("div")
  root.innerHTML = text
  return root
}

describe("decorateWikilinks", () => {
  test("wraps resolved wikilinks with data-wikilink and data-dangling=false", () => {
    const root = render("see [[Project Alpha]] here")
    decorateWikilinks(root, (title) => (title === "Project Alpha" ? "kb_1" : undefined))
    const spans = wikilinkSpans(root)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.getAttribute("data-dangling")).toBe("false")
    expect(spans[0]?.getAttribute("data-title")).toBe("Project Alpha")
  })

  test("marks dangling wikilinks (target title does not exist)", () => {
    const root = render("missing [[Ghost]] link")
    decorateWikilinks(root, () => undefined)
    const spans = wikilinkSpans(root)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.getAttribute("data-dangling")).toBe("true")
  })

  test("is idempotent across repeated runs (observer re-entry)", () => {
    const root = render("a [[Foo]] b [[Bar]]")
    decorateWikilinks(root, (title) => (title === "Foo" ? "kb_1" : undefined))
    decorateWikilinks(root, (title) => (title === "Foo" ? "kb_1" : undefined))
    expect(wikilinkSpans(root)).toHaveLength(2)
  })

  test("skips wikilinks inside code blocks", () => {
    const root = render("<pre>[[NotARealLink]]</pre>")
    decorateWikilinks(root, () => undefined)
    expect(wikilinkSpans(root)).toHaveLength(0)
  })

  test("leaves plain text untouched", () => {
    const root = render("plain text without links")
    decorateWikilinks(root, () => undefined)
    expect(root.textContent).toBe("plain text without links")
  })
})
