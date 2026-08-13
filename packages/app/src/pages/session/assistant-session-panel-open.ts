import type { Accessor } from "solid-js"
import type { AssistantPanelTab } from "@/utils/assistant-panel"

export type { AssistantPanelState, AssistantPanelTab } from "@/utils/assistant-panel"

/**
 * 会话级面板状态（会话内 scope，类比 useSessionLayout 的 view/tabs）：
 * `{ opened, tab, target }`。由 layout store 提供（layout.assistant(sessionKey)）。
 */
export type AssistantPanelHandle = {
  opened: Accessor<boolean>
  tab: Accessor<AssistantPanelTab>
  target: Accessor<string | undefined>
  open: (tab: AssistantPanelTab, target?: string) => void
  close: () => void
}

/**
 * 打开右栏指定 Tab 并定位条目（D3，对齐 open-session-context.ts 纯函数模式）。
 * 调用方：左栏实体列表点击（批次 2）+ 引文角标（批次 4）。
 */
export function openEntityPanel(handle: AssistantPanelHandle, kind: AssistantPanelTab, itemId?: string) {
  handle.open(kind, itemId)
}

/**
 * 上下文圆环 toggle（D2，复用 session-context-usage 模式）：同 Tab 打开中 →
 * 关闭，否则打开。上下文 Tab 与中栏标题用量圆环联动。
 */
export function toggleEntityPanel(handle: AssistantPanelHandle, kind: AssistantPanelTab) {
  if (handle.opened() && handle.tab() === kind) {
    handle.close()
    return
  }
  handle.open(kind)
}
