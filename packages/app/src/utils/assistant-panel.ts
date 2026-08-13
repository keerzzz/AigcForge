/** Shared panel types keep the layout context independent from page modules. */
export type AssistantPanelTab = "reminders" | "memory" | "kb" | "editor" | "context"

/** Session-scoped panel state. */
export type AssistantPanelState = {
  opened?: boolean
  tab?: AssistantPanelTab
  target?: string
}
