import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 批次 1 G2：AssistantSessionPanel 骨架 + 槽位接入 + 宽度机制。App 无
// solid-testing-library（agent-task-hub.test.tsx 先例），测试校验源码级 wiring
// 契约；纯状态迁移由 assistant-session-panel-open.test.ts 行为覆盖。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const panel = read("assistant-session-panel.tsx")
const sidePanel = read("session-side-panel.tsx")

describe("AssistantSessionPanel (right panel, batch 1 G2)", () => {
  test("exports the AssistantSessionPanel component", () => {
    expect(panel).toContain("export function AssistantSessionPanel")
  })

  test("renders the five-tab bar (提醒/记忆/知识库/笔记编辑器/上下文) behind i18n keys", () => {
    for (const key of [
      "assistant.panel.tab.reminders",
      "assistant.panel.tab.memory",
      "assistant.panel.tab.kb",
      "assistant.panel.tab.editor",
      "assistant.panel.tab.context",
    ]) {
      expect(panel).toContain(`label: "${key}"`)
      expect(panel).toContain(`language.t(item.label)`)
    }
  })

  test("supports the close button (top-right X)", () => {
    expect(panel).toContain('language.t("assistant.panel.close")')
    expect(panel).toContain("assistant().close()")
  })

  test("implements the width mechanism: ResizeHandle drag with min 480px", () => {
    expect(panel).toContain("<ResizeHandle")
    expect(panel).toContain("direction=\"horizontal\"")
    expect(panel).toContain("edge=\"start\"")
    expect(panel).toContain("ASSISTANT_PANEL_MIN_WIDTH")
    expect(panel).toContain("min={ASSISTANT_PANEL_MIN_WIDTH}")
  })

  test("closed panel renders zero width and no empty placeholder content", () => {
    expect(panel).toContain('width: opened() ? `${width()}px` : "0px"')
    expect(panel).toContain("<Show when={opened()}>")
  })

  test("never renders a fileTree in the assistant slot", () => {
    expect(panel).not.toContain("FileTree")
    expect(panel).not.toContain("SessionFileTree")
  })

  test("reuses the shared entity lists and the context tab", () => {
    expect(panel).toContain("<ReminderList")
    expect(panel).toContain("<MemoryInspector")
    expect(panel).toContain("<DeliveryList")
    expect(panel).toContain("<SessionContextTab")
  })

  test("reminders tab sources session-scoped schedule.list + delivery.inbox", () => {
    expect(panel).toContain("client.schedule.list")
    expect(panel).toContain("client.delivery.inbox")
  })

  test("targets entities through openEntityPanel state (targetId to lists)", () => {
    expect(panel).toContain("target()")
    expect(panel).toContain("targetId={target()}")
  })
})

describe("SessionSidePanel assistant slot (batch 1 G2)", () => {
  test("renders AssistantSessionPanel instead of the placeholder", () => {
    expect(sidePanel).toContain("<AssistantSessionPanel")
    expect(sidePanel).not.toContain("<PlaceholderPanel")
  })

  test("keeps the render-all + display:none slot model for assistant", () => {
    expect(sidePanel).toContain('mode.currentMode === "assistant"')
    expect(sidePanel).toContain('style={{ display: mode.currentMode === "assistant" ? "" : "none" }}')
  })

  test("the assistant slot contains no fileTree rendering (no B-zone empty placeholder)", () => {
    const slotStart = sidePanel.indexOf("mode.currentMode === \"assistant\"")
    const slot = sidePanel.slice(slotStart, slotStart + 600)
    expect(slot).not.toContain("FileTree")
    expect(slot).not.toContain("reviewPanel")
  })
})
