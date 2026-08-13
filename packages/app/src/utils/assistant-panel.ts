/**
 * Assistant 右栏面板共享常量/类型（LOW-1 修正）：layout store（context 层）
 * 与面板组件（pages 层）都依赖这些定义，统一放在 utils 层避免 context →
 * pages 的逆向导入。
 */

export const ASSISTANT_PANEL_MIN_WIDTH = 480
export const ASSISTANT_PANEL_DEFAULT_WIDTH = 520

/** 右栏 Tab（PRD §8.2 五 Tab；fileTree 不在此槽位渲染）。 */
export type AssistantPanelTab = "reminders" | "memory" | "kb" | "editor" | "context"

/** 会话级面板状态（会话内 scope，类比 sessionTabs/sessionView）。 */
export type AssistantPanelState = {
  opened?: boolean
  tab?: AssistantPanelTab
  target?: string
}
