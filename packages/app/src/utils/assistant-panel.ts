/** Assistant entity tabs; the shared "context" tab lives in the session tab store. */
export type AssistantPanelTab = "reminders" | "memory" | "kb" | "editor"

/** Session-scoped Assistant panel state. */
export type AssistantPanelState = {
  target?: string
}
