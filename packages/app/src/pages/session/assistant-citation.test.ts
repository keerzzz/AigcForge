import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { createMarkedParser } from "@aigcfroge/ui/context/marked"
import { sanitizeMarkdown } from "@aigcfroge/session-ui/markdown-cache"
import { citationSummary, kbCitationHref, parseKbUri } from "./assistant-citation-model"

// 批次 4 G4（F2）：引文锚定 — 真实 DOM 渲染断言（HIGH 修复回归门禁）：
// kb:// href 必须存活于共享 sanitize 管线，点击委托才能匹配并解析。
// 源码级门控断言保留（mode 门控 + session-ui 零改动）。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const timeline = read("timeline/message-timeline.tsx")
const orchestrator = read("../../../../core/src/agent/prompt/assistant-orchestrator.ts")

function renderMarkdown(html: string): HTMLAnchorElement[] {
  const root = document.createElement("div")
  root.innerHTML = sanitizeMarkdown(html)
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="kb://"]'))
}

describe("assistant-orchestrator citation contract (batch 4 G4)", () => {
  test("prompt mandates the [note title](kb://<noteID>) citation format", () => {
    expect(orchestrator).toContain("[note title](kb://<noteID>)")
  })

  test("prompt forbids inventing note ids and demands saying so when nothing matches", () => {
    expect(orchestrator).toContain("never invent or guess an ID")
    expect(orchestrator).toContain("no relevant record, say so explicitly")
  })
})

describe("kb:// citation survival through the sanitize pipeline (HIGH fix regression)", () => {
  test("kb:// href survives DOMPurify like the real markdown renderer output", () => {
    const links = renderMarkdown(
      '<a href="kb://kb_123abc" class="external-link" target="_blank" rel="noopener noreferrer">Note title</a>',
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute("href")).toBe("kb://kb_123abc")
  })

  test("a normal external link stays intact next to a kb:// link", () => {
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown('<a href="https://example.com">web</a><a href="kb://kb_9">note</a>')
    const kb = root.querySelector<HTMLAnchorElement>('a[href^="kb://"]')
    const web = root.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')
    expect(kb?.getAttribute("href")).toBe("kb://kb_9")
    expect(web?.getAttribute("href")).toBe("https://example.com")
  })

  test("unsafe protocols stay stripped while kb:// is allowed", () => {
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown('<a href="javascript:alert(1)">bad</a><a href="kb://kb_1">good</a>')
    expect(root.innerHTML).not.toContain("javascript:")
    expect(root.querySelector('a[href^="kb://"]')).not.toBeNull()
  })

  test("end-to-end: real marked renderer output keeps the kb:// href through sanitize", async () => {
    const parser = createMarkedParser()
    const html = await parser.parse("See [Meeting notes](kb://kb_123abc) for details.")
    expect(html).toContain('href="kb://kb_123abc"')
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown(html)
    expect(root.querySelector('a[href^="kb://"]')?.getAttribute("href")).toBe("kb://kb_123abc")
  })

  test("kbCitationHref resolves a real clicked kb:// anchor and tolerates misses", () => {
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown('<a href="kb://kb_42" class="external-link">t</a>')
    const link = root.querySelector("a")
    expect(kbCitationHref(link)).toBe("kb_42")
    expect(kbCitationHref(null)).toBeUndefined()
    expect(kbCitationHref(document.body)).toBeUndefined()
  })
})

describe("parseKbUri / citationSummary (pure logic)", () => {
  test("parses kb:// note ids and rejects malformed or foreign uris", () => {
    expect(parseKbUri("kb://kb_123abc")).toBe("kb_123abc")
    expect(parseKbUri(" kb://kb_1 ")).toBe("kb_1")
    expect(parseKbUri("kb://note-42")).toBe("note-42")
    expect(parseKbUri("https://example.com")).toBeUndefined()
    expect(parseKbUri("kb://")).toBeUndefined()
    expect(parseKbUri("")).toBeUndefined()
  })

  test("keeps short content and truncates long content at the word boundary", () => {
    expect(citationSummary("short note", 200)).toBe("short note")
    const summary = citationSummary("word ".repeat(100), 30)
    expect(summary.length).toBeLessThanOrEqual(31)
    expect(summary.endsWith("…")).toBe(true)
    expect(citationSummary("", 200)).toBe("")
  })
})

describe("MessageTimeline citation wiring (app layer, mode-gated)", () => {
  test("intercepts kb:// links through a delegated click handler using kbCitationHref", () => {
    expect(timeline).toContain("kbCitationHref")
    expect(timeline).toContain("handleCitationClick")
    expect(timeline).toContain("event.preventDefault()")
  })

  test("is gated to assistant mode so shared rendering stays untouched", () => {
    expect(timeline).toContain('mode.currentMode === "assistant"')
    expect(timeline).toContain("citationEnabled()")
  })

  test("opens the kb tab with the cited note id via openEntityPanel", () => {
    expect(timeline).toContain('kind: "kb", itemId: id')
  })

  test("expands an inline summary of the cited note (宽容：无记录不渲染)", () => {
    expect(timeline).toContain("citationSummary")
    expect(timeline).toContain('data-component="assistant-citation"')
    expect(timeline).toContain("client.kb.get({ id })")
  })

  test("keeps the shared session-ui render path untouched apart from the sanitize allowlist (F2)", () => {
    const messagePart = read("../../../../session-ui/src/components/message-part.tsx")
    expect(messagePart).not.toContain("kb://")
    expect(messagePart).not.toContain("openEntityPanel")
  })
})
