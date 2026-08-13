import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 批次 4 G4（F2）：引文锚定 — prompt 引用格式约定 + timeline app 层后处理
// （mode 门控，仅 assistant 会话启用；coding/chat/work 文本渲染不受影响）。
// 纯逻辑（kb:// 解析/摘要）由 assistant-citation-model.test.ts 行为覆盖。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const timeline = read("timeline/message-timeline.tsx")
const orchestrator = read("../../../../core/src/agent/prompt/assistant-orchestrator.ts")

describe("assistant-orchestrator citation contract (batch 4 G4)", () => {
  test("prompt mandates the [note title](kb://<noteID>) citation format", () => {
    expect(orchestrator).toContain("[note title](kb://<noteID>)")
  })

  test("prompt forbids inventing note ids and demands saying so when nothing matches", () => {
    expect(orchestrator).toContain("never invent or guess an ID")
    expect(orchestrator).toContain("no relevant record, say so explicitly")
  })
})

describe("MessageTimeline citation post-processing (app layer, mode-gated)", () => {
  test("intercepts kb:// links through a delegated click handler", () => {
    expect(timeline).toContain("handleCitationClick")
    expect(timeline).toContain('a[href^="kb://"]')
    expect(timeline).toContain("event.preventDefault()")
  })

  test("is gated to assistant mode so shared rendering stays untouched", () => {
    expect(timeline).toContain('mode.currentMode === "assistant"')
    expect(timeline).toContain("citationEnabled()")
  })

  test("opens the kb tab with the cited note id via openEntityPanel", () => {
    expect(timeline).toContain('openEntityPanel(assistant(), "kb", id)')
  })

  test("expands an inline summary of the cited note (宽容：无记录不渲染)", () => {
    expect(timeline).toContain("citationSummary")
    expect(timeline).toContain('data-component="assistant-citation"')
    expect(timeline).toContain("client.kb.get({ id })")
  })

  test("keeps the shared session-ui render path untouched (F2)", () => {
    const messagePart = read("../../../../session-ui/src/components/message-part.tsx")
    expect(messagePart).not.toContain("kb://")
    expect(messagePart).not.toContain("openEntityPanel")
    expect(timeline).toContain("parseKbUri")
  })
})
